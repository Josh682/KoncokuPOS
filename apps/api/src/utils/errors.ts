import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  );
}
