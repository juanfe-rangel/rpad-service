import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EvidenceStatus, ReportStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Actor } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { UploadIntentDto } from '../dto/report.dto';
import { BlobStorageService } from './blob-storage.service';
import { ReportsService } from '../reports/reports.service';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService, private readonly storage: BlobStorageService, private readonly reports: ReportsService) {}

  async createUploadIntent(reportId: string, dto: UploadIntentDto, actor: Actor) {
    const report = await this.reports.assertAccess(reportId, actor, false);
    if (report.status === ReportStatus.RESOLVED) throw new ConflictException('Evidence uploads are closed after decision');
    const image = dto.mimeType.startsWith('image/');
    if (dto.sizeBytes > (image ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)) throw new ConflictException('Evidence exceeds the per-file size limit');
    const id = randomUUID();
    const storageKey = 'reports/' + reportId + '/' + id;
    const upload = await this.storage.createUploadUrl(storageKey, dto.mimeType);
    const row = await this.prisma.reportEvidence.create({ data: { id, reportId, uploadedBy: actor.userId, originalFilename: dto.originalFilename, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes, storageKey } });
    try {
      await this.prisma.auditEvent.create({ data: { reportId, actorId: actor.userId, action: 'EVIDENCE_UPLOAD_INTENT_CREATED', metadata: { evidenceId: id, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes } } });
      return { evidenceId: row.id, ...upload };
    } catch (error) {
      await this.prisma.reportEvidence.update({ where: { id }, data: { status: EvidenceStatus.DELETE_PENDING } });
      throw error;
    }
  }

  async completeUpload(reportId: string, evidenceId: string, actor: Actor) {
    const report = await this.reports.assertAccess(reportId, actor, false);
    if (report.status === ReportStatus.RESOLVED) throw new ConflictException('Evidence uploads are closed after decision');
    const row = await this.prisma.reportEvidence.findFirst({ where: { id: evidenceId, reportId } });
    if (!row) throw new NotFoundException('Evidence not found');
    if (row.status !== EvidenceStatus.PENDING_UPLOAD) throw new ConflictException('Evidence is not awaiting upload');
    if (row.uploadedBy !== actor.userId && !this.reports.isService(actor)) throw new ForbiddenException();
    let sha256: string;
    try { sha256 = await this.storage.verifyAndHash(row.storageKey, row.mimeType, row.sizeBytes); }
    catch (error) {
      await this.storage.delete(row.storageKey).catch(() => undefined);
      await this.prisma.reportEvidence.update({ where: { id: evidenceId }, data: { status: EvidenceStatus.DELETE_PENDING } });
      await this.prisma.auditEvent.create({ data: { reportId, actorId: actor.userId, action: 'EVIDENCE_UPLOAD_REJECTED', metadata: { evidenceId, errorType: error instanceof Error ? error.name : 'unknown' } } });
      throw error;
    }
    const updated = await this.prisma.reportEvidence.update({ where: { id: evidenceId }, data: { status: EvidenceStatus.AVAILABLE, sha256 } });
    await this.prisma.auditEvent.create({ data: { reportId, actorId: actor.userId, action: 'EVIDENCE_UPLOAD_COMPLETED', metadata: { evidenceId, sha256, sizeBytes: row.sizeBytes, mimeType: row.mimeType } } });
    return updated;
  }

  async createReadUrl(reportId: string, evidenceId: string, actor: Actor) {
    await this.reports.assertAccess(reportId, actor, false);
    const row = await this.prisma.reportEvidence.findFirst({ where: { id: evidenceId, reportId, status: EvidenceStatus.AVAILABLE } });
    if (!row) throw new NotFoundException('Evidence not found');
    return { evidenceId, ...(await this.storage.createReadUrl(row.storageKey)) };
  }
}
