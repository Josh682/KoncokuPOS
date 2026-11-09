import { Hono } from 'hono';
import { LoginRequestSchema, hashPin, type UserEntity } from '@koncoku/shared';
import type { AppContext } from '../types';
import { errorResponse } from '../utils/errors';
import { createAuthToken, DEFAULT_JWT_SECRET } from '../middleware/auth';

export const authRouter = new Hono<AppContext>();

authRouter.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'VALIDATION_ERROR', 'Format JSON request tidak valid');
  }

  const parseResult = LoginRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return errorResponse(
      c,
      400,
      'VALIDATION_ERROR',
      parseResult.error.errors[0]?.message || 'Data login tidak valid',
      { errors: parseResult.error.flatten() as unknown as Record<string, unknown> }
    );
  }

  const { userId, pin } = parseResult.data;
  const pinHash = await hashPin(pin);

  let user: Pick<UserEntity, 'id' | 'name' | 'role' | 'pin_hash' | 'is_active'> | null = null;

  if (userId) {
    user = await c.env.DB
      .prepare('SELECT id, name, role, pin_hash, is_active FROM users WHERE id = ? AND is_active = 1')
      .bind(userId)
      .first<Pick<UserEntity, 'id' | 'name' | 'role' | 'pin_hash' | 'is_active'>>();
  } else {
    user = await c.env.DB
      .prepare('SELECT id, name, role, pin_hash, is_active FROM users WHERE pin_hash = ? AND is_active = 1 LIMIT 1')
      .bind(pinHash)
      .first<Pick<UserEntity, 'id' | 'name' | 'role' | 'pin_hash' | 'is_active'>>();
  }

  if (!user || user.pin_hash !== pinHash || user.is_active !== 1) {
    return errorResponse(c, 401, 'UNAUTHORIZED', 'PIN tidak valid atau pengguna tidak aktif');
  }

  const secret = c.env.SYSTEM_SECRET || DEFAULT_JWT_SECRET;
  const token = await createAuthToken(
    {
      id: user.id,
      name: user.name,
      role: user.role,
    },
    secret
  );

  return c.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
    },
  });
});
