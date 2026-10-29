import { Module } from '@nestjs/common';
import { OutboxPublisher } from './outbox.service';

@Module({ providers: [OutboxPublisher] })
export class OutboxModule {}
