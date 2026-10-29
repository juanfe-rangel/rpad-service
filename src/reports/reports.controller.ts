import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Actor, Roles } from '../auth/auth.decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/auth.guards';
import { CreateDecisionDto, CreateReportDto, ChatSnapshotDto, PurgeConfirmationDto, UploadIntentDto } from '../dto/report.dto';
import { EvidenceService } from '../evidence/evidence.service';
import { ReportsService } from './reports.service';

@ApiTags('RPAD Reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly evidence: EvidenceService) {}

  @Post()
  create(@Body() dto: CreateReportDto, @CurrentActor() actor: Actor) { return this.reports.create(dto, actor); }

  @Get()
  list(@CurrentActor() actor: Actor, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('status') status?: string) {
    return this.reports.list(actor, Number(page || 1), Number(pageSize || 20), status as never);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentActor() actor: Actor) { await this.reports.assertAccess(id, actor); return this.reports.findReport(id); }

  @Post(':id/chat-snapshot')
  @Roles('SERVICE', 'ADMIN')
  snapshot(@Param('id') id: string, @Body() dto: ChatSnapshotDto, @CurrentActor() actor: Actor) { return this.reports.addChatSnapshot(id, dto, actor); }

  @Get(':id/chat')
  chat(@Param('id') id: string, @CurrentActor() actor: Actor) { return this.reports.getChat(id, actor); }

  @Post(':id/evidence/upload-intents')
  uploadIntent(@Param('id') id: string, @Body() dto: UploadIntentDto, @CurrentActor() actor: Actor) { return this.evidence.createUploadIntent(id, dto, actor); }

  @Post(':id/evidence/:evidenceId/complete')
  completeUpload(@Param('id') id: string, @Param('evidenceId') evidenceId: string, @CurrentActor() actor: Actor) { return this.evidence.completeUpload(id, evidenceId, actor); }

  @Get(':id/evidence/:evidenceId/url')
  evidenceUrl(@Param('id') id: string, @Param('evidenceId') evidenceId: string, @CurrentActor() actor: Actor) { return this.evidence.createReadUrl(id, evidenceId, actor); }

  @Post(':id/decisions')
  @Roles('AUDITOR', 'ADMIN')
  decide(@Param('id') id: string, @Body() dto: CreateDecisionDto, @CurrentActor() actor: Actor) { return this.reports.decide(id, dto, actor); }

  @Post(':id/archive')
  @Roles('AUDITOR', 'ADMIN')
  archive(@Param('id') id: string, @CurrentActor() actor: Actor) { return this.reports.archive(id, actor); }

  @Post(':id/chat-purge-confirmation')
  @Roles('SERVICE', 'ADMIN')
  confirmPurge(@Param('id') id: string, @Body() dto: PurgeConfirmationDto, @CurrentActor() actor: Actor) {
    return this.reports.confirmSourcePurge(id, dto.sourceService, dto.confirmationReference, actor);
  }

  @Get(':id/history')
  history(@Param('id') id: string, @CurrentActor() actor: Actor) { return this.reports.history(id, actor); }
}
