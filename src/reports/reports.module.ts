import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlobStorageService } from '../evidence/blob-storage.service';
import { EvidenceService } from '../evidence/evidence.service';
import { RetentionService } from '../evidence/retention.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService, BlobStorageService, EvidenceService, RetentionService],
  exports: [ReportsService],
})
export class ReportsModule {}
