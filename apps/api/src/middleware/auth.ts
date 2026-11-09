import type { Context, Next } from 'hono';
import { sign, verify } from 'hono/jwt';
import type { UserRole } from '@koncoku/shared';
import type { AuthUser, AppContext } from '../types';
import { errorResponse } from '../utils/errors';

export const DEFAULT_JWT_SECRET = 'koncoku_dev_jwt_secret_key_2026';

export async function createAuthToken(
  user: AuthUser,
  secret: string = DEFAULT_JWT_SECRET,
  expiresInSeconds = 7 * 24 * 3600
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + expiresInSeconds,
  };
  return sign(payload, secret, 'HS256');
}

export function requireAuth() {
  return async (c: Context<AppContext>, next: Next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // In testing environment if anonymous checkout flag is enabled, fallback to default cashier
      if (c.env.ALLOW_ANONYMOUS_CHECKOUT_FOR_TEST === 'true') {
        c.set('user', {
          id: '01931000-0000-7000-8000-000000000002',
          name: 'Kasir Utama',
          role: 'CASHIER',
        });
        return await next();
      }
      return errorResponse(
        c,
        401,
        'UNAUTHORIZED',
        'Token otentikasi Bearer wajib disertakan pada header Authorization'
      );
    }

    const token = authHeader.slice(7).trim();
    const secret = c.env.SYSTEM_SECRET || DEFAULT_JWT_SECRET;

    try {
      const payload = (await verify(token, secret, 'HS256')) as unknown as {
        sub: string;
        name: string;
        role: UserRole;
      };

      if (!payload || !payload.sub || !payload.role) {
        return errorResponse(c, 401, 'UNAUTHORIZED', 'Payload token otentikasi tidak valid');
      }

      c.set('user', {
        id: payload.sub,
        name: payload.name || '',
        role: payload.role,
      });

      return await next();
    } catch {
      return errorResponse(
        c,
        401,
        'UNAUTHORIZED',
        'Sesi kasir kedaluwarsa atau token tidak valid'
      );
    }
  };
}

export function requireRole(allowedRoles: UserRole[]) {
  return async (c: Context<AppContext>, next: Next) => {
    const user = c.get('user');
    if (!user) {
      return errorResponse(c, 401, 'UNAUTHORIZED', 'Akses memerlukan otentikasi');
    }

    if (!allowedRoles.includes(user.role)) {
      return errorResponse(
        c,
        403,
        'FORBIDDEN',
        `Akses ditolak: peran '${user.role}' tidak memiliki izin untuk operasi ini`
      );
    }

    return await next();
  };
}
