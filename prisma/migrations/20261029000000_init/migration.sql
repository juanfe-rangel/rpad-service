CREATE TYPE "ReportStatus" AS ENUM ('PENDING_CONTEXT', 'OPEN', 'UNDER_REVIEW', 'RESOLVED', 'ARCHIVED');
CREATE TYPE "EvidenceStatus" AS ENUM ('PENDING_UPLOAD', 'AVAILABLE', 'DELETE_PENDING', 'DELETED');
CREATE TYPE "DecisionOutcome" AS ENUM ('CLAIMANT_FAVORED', 'PROVIDER_FAVORED', 'NO_FAULT');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED');
CREATE TYPE "ActionType" AS ENUM ('SANCTION', 'RESTORATION');
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "Report" (
  "id" UUID NOT NULL,
  "claimantId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'PENDING_CONTEXT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "sourceChatPurgedAt" TIMESTAMP(3),
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ChatSnapshot" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "sourceChatId" TEXT NOT NULL,
  "messages" JSONB NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReportDecision" (
  "reportId" UUID NOT NULL,
  "outcome" "DecisionOutcome" NOT NULL,
  "justification" TEXT NOT NULL,
  "auditorId" TEXT NOT NULL,
  "actions" JSONB NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportDecision_pkey" PRIMARY KEY ("reportId")
);
CREATE TABLE "DecisionAction" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "type" "ActionType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
  "resultNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecisionAction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReportEvidence" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT,
  "status" "EvidenceStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportEvidence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "reportId" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OutboxEvent" (
  "id" UUID NOT NULL,
  "aggregateId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3),
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatSnapshot_reportId_key" ON "ChatSnapshot"("reportId");
CREATE UNIQUE INDEX "ReportEvidence_storageKey_key" ON "ReportEvidence"("storageKey");
CREATE INDEX "Report_claimantId_createdAt_idx" ON "Report"("claimantId", "createdAt");
CREATE INDEX "Report_providerId_createdAt_idx" ON "Report"("providerId", "createdAt");
CREATE INDEX "Report_chatId_idx" ON "Report"("chatId");
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");
CREATE INDEX "DecisionAction_reportId_status_idx" ON "DecisionAction"("reportId", "status");
CREATE INDEX "ReportEvidence_reportId_status_idx" ON "ReportEvidence"("reportId", "status");
CREATE INDEX "AuditEvent_reportId_createdAt_idx" ON "AuditEvent"("reportId", "createdAt");
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

ALTER TABLE "ChatSnapshot" ADD CONSTRAINT "ChatSnapshot_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportDecision" ADD CONSTRAINT "ReportDecision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DecisionAction" ADD CONSTRAINT "DecisionAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportEvidence" ADD CONSTRAINT "ReportEvidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_aggregateId_fkey" FOREIGN KEY ("aggregateId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
