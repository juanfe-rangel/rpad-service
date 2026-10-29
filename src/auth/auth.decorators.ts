import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';

export const ROLES_KEY = 'rpad:roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export interface Actor {
  userId: string;
  roles: string[];
}

type AuthRequest = Request & { user?: Actor };
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): Actor =>
  context.switchToHttp().getRequest<AuthRequest>().user as Actor,
);
