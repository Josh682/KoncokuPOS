/**
 * Cashier Authentication Store
 * References:
 * - docs/ARCHITECTURE.md (Section 4)
 * - docs/specs/01-schema-and-dexie.md
 */

import { create } from 'zustand';
import { posRepository, type IPosRepository, type AuthUserInfo } from '../services/posRepository';

export interface AuthState {
  user: AuthUserInfo | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  loginWithPin: (pin: string, repo?: IPosRepository) => Promise<void>;
  logout: () => void;
  resetError: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  const initialUser = posRepository.getCurrentUser();
  const initialToken = posRepository.getAuthToken();

  return {
    user: initialUser,
    token: initialToken,
    isAuthenticated: Boolean(initialUser && initialToken),
    isLoading: false,
    error: null,

    loginWithPin: async (pin: string, repo: IPosRepository = posRepository) => {
      set({ isLoading: true, error: null });
      try {
        const { token, user } = await repo.loginWithPin(pin);
        set({
          user,
          token,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      } catch (err: unknown) {
        const message = (err as Error)?.message || 'PIN tidak valid';
        set({
          isLoading: false,
          error: message,
        });
        throw err;
      }
    },

    logout: () => {
      posRepository.logout();
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        error: null,
      });
    },

    resetError: () => {
      set({ error: null });
    },
  };
});