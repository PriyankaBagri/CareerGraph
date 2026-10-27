import type { Action, ActionStatus } from '../types';
import type { ActionStore } from '../utils/actions';
import { api } from './api';
import { authService } from './auth';
import { toActionStore, toSnapshot } from './actionMap';
import { careerService } from './career';
import { coreApi } from './coreApi';

// Backend mode: progress is stored on the server for the signed-in user and career (action-progress routes). Local mode (no VITE_API_URL) keeps it in
// localStorage, isolated by user AND career: careergraph:user:<uid>:career:<careerId>:actions. Legacy local progress is only read by the explicit import.
// A legacy browser-only career has no server record, so its progress stays in this browser until the user imports the career.
const remote = (careerId: string): boolean => api.useBackend('progress') && !careerService.isLocalCustom(careerId);
const key = (uid: string, careerId: string) => `careergraph:user:${uid}:career:${careerId}:actions`;
const uid = (): string => { const u = authService.getCurrentUser(); if (!u) throw new Error('Not signed in'); return u.id; };
const read = (id: string, careerId: string): ActionStore => { try { const v = localStorage.getItem(key(id, careerId)); return v ? (JSON.parse(v) as ActionStore) : {}; } catch { return {}; } };

export const actionService = {
  // Read-only look at progress saved in THIS browser (legacy data) for the explicit import. Never writes.
  peekLocal(userId: string, careerId: string): ActionStore { return read(userId, careerId); },
  // Every career id that has progress saved in THIS browser for the user (legacy data), for the explicit import. Never writes.
  peekLocalCareerIds(userId: string): string[] {
    const prefix = `careergraph:user:${userId}:career:`, out: string[] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i) ?? ''; if (k.startsWith(prefix) && k.endsWith(':actions')) out.push(k.slice(prefix.length, -':actions'.length)); } } catch { /* storage unavailable */ }
    return out;
  },
  async getStore(careerId: string): Promise<ActionStore> {
    if (remote(careerId)) return toActionStore(await coreApi.listProgress(careerId));
    return read(uid(), careerId);
  },
  // Completing an action only records the user's statement; it never edits skill levels or evidence.
  async setStatus(careerId: string, action: Action, status: ActionStatus): Promise<ActionStore> {
    if (remote(careerId)) {
      if (status === 'not_started') await coreApi.clearProgress(careerId, action.id);
      else await coreApi.putProgress(careerId, action.id, status, toSnapshot(action));
      return toActionStore(await coreApi.listProgress(careerId));
    }
    const id = uid();
    const store = read(id, careerId);
    if (status === 'not_started') delete store[action.id];
    else store[action.id] = { status, updatedAt: new Date().toISOString(), action: { ...action, status } };
    localStorage.setItem(key(id, careerId), JSON.stringify(store));
    return store;
  },
};
