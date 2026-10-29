import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { Actor, ROLES_KEY } from './auth.decorators';

type AuthRequest = Request & { user?: Actor };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly jwks: ReturnType<typeof jwksClient> | undefined;
  constructor(private readonly config: ConfigService) {
    const uri = this.config.get<string>('AUTH_JWKS_URI');
    if (uri) this.jwks = jwksClient({ jwksUri: uri, cache: true, rateLimit: true, jwksRequestsPerMinute: 10 });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer token required');
    const issuer = this.config.get<string>('AUTH_ISSUER');
    const audience = this.config.get<string>('AUTH_AUDIENCE');
    if (!this.jwks || !issuer || !audience) throw new ServiceUnavailableException('JWT validation is not configured');
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string' || !decoded.header.kid) throw new Error('Missing key id');
      const key = await new Promise<string>((resolve, reject) => {
        this.jwks!.getSigningKey(decoded.header.kid, (error, signingKey) => {
          if (error || !signingKey) reject(error || new Error('Signing key unavailable'));
          else resolve(signingKey.getPublicKey());
        });
      });
      const payload = jwt.verify(token, key, { algorithms: ['RS256'], issuer, audience }) as jwt.JwtPayload;
      const rolesClaim = this.config.get<string>('AUTH_ROLES_CLAIM') || 'roles';
      const idClaim = this.config.get<string>('AUTH_USER_ID_CLAIM') || 'sub';
      const id = payload[idClaim];
      const rawRoles = payload[rolesClaim];
      if (typeof id !== 'string' || !id) throw new Error('Missing identity claim');
      const roles = Array.isArray(rawRoles) ? rawRoles.filter((role): role is string => typeof role === 'string') : typeof rawRoles === 'string' ? [rawRoles] : [];
      request.user = { userId: id, roles: roles.map((role) => role.toUpperCase()) };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const actor = context.switchToHttp().getRequest<AuthRequest>().user;
    if (actor && required.some((role) => actor.roles.includes(role))) return true;
    throw new ForbiddenException('Insufficient role');
  }
}
