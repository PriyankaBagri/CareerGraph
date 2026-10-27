import type { UserSettings } from '../types';
import { api } from './api';
import { authService } from './auth';
import { coreApi } from './coreApi';

// Backend mode: settings are stored on the server for the signed-in user (GET/PUT /settings) and cached in memory for synchronous reads.
// Local mode (no VITE_API_URL): per-user localStorage key careergraph:user:<uid>:settings.
const DEFAULTS: UserSettings = { reduceMotion: false, assistantSuggestions: true };
const key = (uid: string) => `careergraph:user:${uid}:settings`;
let cache: { uid: string; value: UserSettings } | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const read = (uid: string): UserSettings => { try { const v = localStorage.getItem(key(uid)); return { ...DEFAULTS, ...(v ? (JSON.parse(v) as Partial<UserSettings>) : {}) }; } catch { return { ...DEFAULTS }; } };

export const settingsService = {
  // Synchronous read: server settings once loaded, otherwise defaults (never another user's values).
  get(): UserSettings {
    const u = authService.getCurrentUser();
    if (!u) return { ...DEFAULTS };
    if (api.useBackend('settings')) return cache && cache.uid === u.id ? { ...cache.value } : { ...DEFAULTS };
    return read(u.id);
  },
  // Backend mode: fetches the user's saved settings. A failure keeps defaults and is reported to the caller.
  async load(): Promise<UserSettings> {
    const u = authService.getCurrentUser();
    if (!u || !api.useBackend('settings')) return settingsService.get();
    const s = await coreApi.getSettings();
    cache = { uid: u.id, value: { reduceMotion: s.reduceMotion, assistantSuggestions: s.assistantSuggestions } };
    emit();
    return settingsService.get();
  },
  async set(patch: Partial<UserSettings>): Promise<UserSettings> {
    const u = authService.getCurrentUser();
    if (!u) throw new Error('Not signed in');
    if (api.useBackend('settings')) {
      const s = await coreApi.putSettings(patch); // saved on the server first; the screen only changes if this succeeds
      cache = { uid: u.id, value: { reduceMotion: s.reduceMotion, assistantSuggestions: s.assistantSuggestions } };
      emit();
      return settingsService.get();
    }
    const next = { ...read(u.id), ...patch };
    localStorage.setItem(key(u.id), JSON.stringify(next));
    return next;
  },
  clearCache() { cache = null; emit(); },
  subscribe(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
  // Local legacy settings for the explicit import (never written).
  peekLocal(uid: string): UserSettings | null { try { const v = localStorage.getItem(key(uid)); return v ? { ...DEFAULTS, ...(JSON.parse(v) as Partial<UserSettings>) } : null; } catch { return null; } },
};
