import type { INotificationProvider } from './providers/notification';
import type { UserRole } from '@koncoku/shared';

export interface Env {
  DB: D1Database;
  SYSTEM_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
  WA_GATEWAY_URL?: string;
  WA_API_KEY?: string;
  NOTIFICATION_PROVIDER?: 'telegram' | 'mock';
  NOTIFICATION_PROVIDER_INSTANCE?: INotificationProvider;
  NODE_ENV?: string;
  ALLOW_ANONYMOUS_CHECKOUT_FOR_TEST?: string;
}

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}

export interface AppVariables {
  user?: AuthUser;
  notificationProvider?: INotificationProvider;
}

export type AppContext = {
  Bindings: Env;
  Variables: AppVariables;
};
