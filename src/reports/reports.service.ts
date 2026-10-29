import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { Prisma, ReportStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Actor } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ActionResultDto, CreateDecisionDto, CreateReportDto, ChatSnapshotDto } from '../dto/report.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  isAuditor(actor: Actor): boolean { return actor.roles.some((role) => ['AUDITOR', 'ADMIN'].includes(role)); }
  isService(actor: Actor): boolean { return actor.roles.some((role) => ['SERVICE', 'ADMIN'].includes(role)); }

  async create(dto: CreateReportDto, actor: Actor) {
    if (!this.isService(actor) && actor.userId !== dto.claimantId && actor.userId !== dto.providerId) throw new ForbiddenException();
    if (dto.claimantId === dto.providerId) throw new ConflictException('Report parties must be different');
    const snapshot = dto.chatSnapshot?.messages;
    const contentSha256 = snapshot ? createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') : undefined;
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.create({
        data: {
          claimantId: dto.claimantId, providerId: dto.providerId, chatId: dto.chatId, description: dto.description,
          status: snapshot ? ReportStatus.OPEN : ReportStatus.PENDING_CONTEXT,
          ...(snapshot ? { chatSnapshot: { create: { sourceChatId: dto.chatId, messages: snapshot as unknown as Prisma.InputJsonValue, contentSha256: contentSha256! } } } : {}),
        },
      });
      await tx.auditEvent.create({ data: { reportId: report.id, actorId: actor.userId, action: 'REPORT_CREATED', metadata: { chatSnapshotProvided: Boolean(snapshot) } } });
      return report;
    });
  }

  async list(actor: Actor, page = 1, pageSize = 20, status?: string) {
    if (status && !Object.values(ReportStatus).includes(status as ReportStatus)) throw new BadRequestException('Invalid report status');
    const reportStatus = status as ReportStatus | undefined;
    const safePage = Math.max(1, page);
    const safeSize = Math.min(100, Math.max(1, pageSize));
    const where: Prisma.ReportWhereInput = this.isAuditor(actor)
      ? { ...(reportStatus ? { status: reportStatus } : {}) }
      : { OR: [{ claimantId: actor.userId }, { providerId: actor.userId }], ...(status ? { status } : {}) };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.report.count({ where }),
      this.prisma.report.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (safePage - 1) * safeSize, take: safeSize, include: { decision: true, actions: true, evidence: { select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, sha256: true, status: true, createdAt: true } } } }),
    ]);
    return { page: safePage, pageSize: safeSize, total, items };
  }

  async findReport(id: string) {
    const report = await this.prisma.report.findUnique({ where: { id }, include: { decision: true, actions: true, evidence: { select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, sha256: true, status: true, createdAt: true } } } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async assertAccess(id: string, actor: Actor, allowArchived = true) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (!this.isAuditor(actor) && actor.userId !== report.claimantId && actor.userId !== report.providerId && !this.isService(actor)) throw new NotFoundException('Report not found');
    if (!allowArchived && report.status === ReportStatus.ARCHIVED) throw new GoneException('Report evidence has been archived and purged');
    return report;
  }

  async getChat(id: string, actor: Actor) {
    await this.assertAccess(id, actor, false);
    const snapshot = await this.prisma.chatSnapshot.findUnique({ where: { reportId: id } });
    if (!snapshot) throw new ConflictException('Chat context has not been captured');
    return snapshot;
  }

  async addChatSnapshot(id: string, dto: ChatSnapshotDto, actor: Actor) {
    if (!this.isService(actor)) throw new ForbiddenException();
    const report = await this.findReport(id);
    if (report.status === ReportStatus.ARCHIVED) throw new GoneException('Archived report');
    const existing = await this.prisma.chatSnapshot.findUnique({ where: { reportId: id } });
    if (existing) throw new ConflictException('Chat snapshot is immutable once captured');
    const contentSha256 = createHash('sha256').update(JSON.stringify(dto.messages)).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.chatSnapshot.create({ data: { reportId: id, sourceChatId: report.chatId, messages: dto.messages as unknown as Prisma.InputJsonValue, contentSha256 } });
      await tx.report.update({ where: { id }, data: { status: ReportStatus.OPEN } });
      await tx.auditEvent.create({ data: { reportId: id, actorId: actor.userId, action: 'CHAT_SNAPSHOT_CAPTURED', metadata: { messageCount: dto.messages.length, contentSha256 } } });
      return snapshot;
    });
  }

  async decide(id: string, dto: CreateDecisionDto, actor: Actor) {
    if (!this.isAuditor(actor)) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({ where: { id }, include: { chatSnapshot: true } });
      if (!report) throw new NotFoundException('Report not found');
      if (![ReportStatus.OPEN, ReportStatus.UNDER_REVIEW].includes(report.status)) throw new ConflictException('Report is not ready for a decision');
      if (dto.outcome === 'NO_FAULT' && dto.actions.length > 0) throw new BadRequestException('NO_FAULT decisions cannot include sanctions or restorations');
      if (dto.actions.some((action) => action.type === 'SANCTION' && action.targetId !== report.claimantId && action.targetId !== report.providerId)) throw new BadRequestException('A sanction must target one of the report parties');
      if (!report.chatSnapshot) throw new ConflictException('Chat context must be captured before decision');
      const actions = dto.actions as unknown as Prisma.InputJsonValue;
      const decision = await tx.reportDecision.create({ data: { reportId: id, outcome: dto.outcome, justification: dto.justification, auditorId: actor.userId, actions } });
      const savedActions = [];
      for (const action of dto.actions) savedActions.push(await tx.decisionAction.create({ data: { reportId: id, type: action.type, targetId: action.targetId, description: action.description } }));
      await tx.report.update({ where: { id }, data: { status: ReportStatus.RESOLVED } });
      await tx.auditEvent.create({ data: { reportId: id, actorId: actor.userId, action: 'DECISION_RECORDED', metadata: { outcome: dto.outcome, actionCount: dto.actions.length } } });
      await tx.outboxEvent.create({ data: { aggregateId: id, type: 'rpad.decision.recorded', payload: { reportId: id, outcome: dto.outcome, justification: dto.justification, auditorId: actor.userId, actions: savedActions } as unknown as Prisma.InputJsonValue } });
      return { decision, actions: savedActions, status: ReportStatus.RESOLVED };
    });
  }

  async recordActionResult(id: string, actionId: string, dto: ActionResultDto, actor: Actor) {
    if (!this.isService(actor)) throw new ForbiddenException();
    const action = await this.prisma.decisionAction.findFirst({ where: { id: actionId, reportId: id } });
    if (!action) throw new NotFoundException('Decision action not found');
    if (action.status === 'SUCCEEDED' && dto.status !== 'SUCCEEDED') throw new ConflictException('A successful action cannot be downgraded');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.decisionAction.update({ where: { id: actionId }, data: { status: dto.status, resultNote: dto.resultNote || null } });
      await tx.auditEvent.create({ data: { reportId: id, actorId: actor.userId, action: 'DECISION_ACTION_RESULT_RECORDED', metadata: { actionId, type: action.type, status: dto.status, resultNote: dto.resultNote || null } } });
      return result;
    });
    return updated;
  }

  async startReview(id: string, actor: Actor) {
    if (!this.isAuditor(actor)) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({ where: { id } });
      if (!report) throw new NotFoundException('Report not found');
      if (report.status !== ReportStatus.OPEN) throw new ConflictException('Only an open report can enter review');
      const snapshot = await tx.chatSnapshot.findUnique({ where: { reportId: id } });
      if (!snapshot) throw new ConflictException('Chat context must be captured before review');
      await tx.report.update({ where: { id }, data: { status: ReportStatus.UNDER_REVIEW } });
      await tx.auditEvent.create({ data: { reportId: id, actorId: actor.userId, action: 'REVIEW_STARTED', metadata: {} } });
      return { reportId: id, status: ReportStatus.UNDER_REVIEW };
    });
  }

  async archive(id: string, actor: Actor) {
    if (!this.isAuditor(actor)) throw new ForbiddenException();
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.findUnique({ where: { id }, include: { evidence: true } });
      if (!report) throw new NotFoundException('Report not found');
      if (report.status !== ReportStatus.RESOLVED) throw new ConflictException('Only a resolved report can be archived');
      const pendingActions = await tx.decisionAction.count({ where: { reportId: id, status: { not: 'SUCCEEDED' } } });
      if (pendingActions > 0) throw new ConflictException('All sanction and restoration actions must succeed before archive');
      const archivedAt = new Date();
      await tx.report.update({ where: { id }, data: { status: ReportStatus.ARCHIVED, archivedAt } });
      await tx.chatSnapshot.deleteMany({ where: { reportId: id } });
      await tx.reportEvidence.updateMany({ where: { reportId: id, status: { not: 'DELETED' } }, data: { status: 'DELETE_PENDING' } });
      await tx.auditEvent.create({ data: { reportId: id, actorId: actor.userId, action: 'REPORT_ARCHIVED', metadata: { archivedAt: archivedAt.toISOString(), evidenceCount: report.evidence.length } } });
      const event = { reportId: id, chatId: report.chatId, claimantId: report.claimantId, providerId: report.providerId, archivedAt: archivedAt.toISOString() };
      await tx.outboxEvent.createMany({ data: [
        { aggregateId: id, type: 'rpad.report.archived', payload: event as unknown as Prisma.InputJsonValue },
        { aggregateId: id, type: 'rpad.source-chat.purge.requested', payload: event as unknown as Prisma.InputJsonValue },
      ] });
      return { reportId: id, status: ReportStatus.ARCHIVED, archivedAt, sourceChatPurge: 'PENDING', evidencePurge: 'PENDING' };
    });
  }

  async confirmSourcePurge(id: string, sourceService: string, confirmationReference: string | undefined, actor: Actor) {
    if (!this.isService(actor)) throw new ForbiddenException();
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.ARCHIVED) throw new ConflictException('Report must be archived first');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({ where: { id }, data: { sourceChatPurgedAt: new Date() } });
      await tx.auditEvent.create({ data: { reportId: id, actorId: actor.userId, action: 'SOURCE_CHAT_PURGED', metadata: { sourceService, confirmationReference: confirmationReference || null } } });
      return { reportId: updated.id, sourceChatPurgedAt: updated.sourceChatPurgedAt };
    });
  }

  async history(id: string, actor: Actor) {
    await this.assertAccess(id, actor);
    return this.prisma.auditEvent.findMany({ where: { reportId: id }, orderBy: { createdAt: 'asc' } });
  }
}
