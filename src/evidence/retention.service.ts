import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EvidenceStatus, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlobStorageService } from './blob-storage.service';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly storage: BlobStorageService) {}

  @Interval(15000)
  async purgeArchivedEvidence(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.prisma.reportEvidence.findMany({ where: { status: EvidenceStatus.DELETE_PENDING, report: { status: ReportStatus.ARCHIVED } }, take: 25, orderBy: { createdAt: 'asc' } });
      for (const item of pending) {
        try {
          await this.storage.delete(item.storageKey);
          await this.prisma.reportEvidence.update({ where: { id: item.id }, data: { status: EvidenceStatus.DELETED } });
          await this.prisma.auditEvent.create({ data: { reportId: item.reportId, actorId: 'system:rpad-retention', action: 'EVIDENCE_PURGED', metadata: { evidenceId: item.id, sha256: item.sha256 } } });
        } catch (error) {
          this.logger.warn('Evidence purge will retry for record ' + item.id + ': ' + (error instanceof Error ? error.name : 'unknown error'));
        }
      }
    } catch (error) {
      this.logger.error('Retention sweep failed: ' + (error instanceof Error ? error.name : 'unknown error'));
    } finally {
      this.running = false;
    }
  }
}
