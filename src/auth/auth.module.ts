import { Module } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard } from './auth.guards';

@Module({ providers: [JwtAuthGuard, RolesGuard], exports: [JwtAuthGuard, RolesGuard] })
export class AuthModule {}
