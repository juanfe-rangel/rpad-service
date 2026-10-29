import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { ServiceBusClient } from '@azure/service-bus';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly client?: ServiceBusClient;
  private running = false;
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    const connection = this.config.get<string>('AZURE_SERVICE_BUS_CONNECTION_STRING');
    if (connection) this.client = new ServiceBusClient(connection);
  }

  @Interval(5000)
  async publishPending(): Promise<void> {
    if (!this.client || this.running) return;
    this.running = true;
    const sender = this.client.createSender(this.config.get<string>('AZURE_SERVICE_BUS_TOPIC') || 'rpad-events');
    try {
      const events = await this.prisma.outboxEvent.findMany({ where: { status: OutboxStatus.PENDING }, take: 25, orderBy: { createdAt: 'asc' } });
      for (const event of events) {
        try {
          await sender.sendMessages({ body: event.payload, subject: event.type, messageId: event.id, contentType: 'application/json' });
          await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxStatus.DISPATCHED, dispatchedAt: new Date() } });
        } catch (error) {
          this.logger.warn('Outbox dispatch will retry for event ' + event.id + ': ' + (error instanceof Error ? error.name : 'unknown error'));
          break;
        }
      }
    } catch (error) {
      this.logger.error('Outbox sweep failed: ' + (error instanceof Error ? error.name : 'unknown error'));
    } finally {
      await sender.close().catch(() => undefined);
      this.running = false;
    }
  }

  async onModuleDestroy(): Promise<void> { await this.client?.close(); }
}
