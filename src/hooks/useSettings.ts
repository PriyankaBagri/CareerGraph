import { useCallback, useEffect, useState } from 'react';
import type { UserSettings } from '../types';
import { settingsService } from '../services/settings';
import { useAuth } from '../context/AuthContext';

// Reactive view of the signed-in user's settings. Loads them from the server (backend mode) and stays in sync with changes made on the Settings page.
export function useSettings() {
  const { user } = useAuth();
  const uid = user?.id;
  const [settings, setSettings] = useState<UserSettings>(() => settingsService.get());
  const [error, setError] = useState(false);
  useEffect(() => settingsService.subscribe(() => setSettings(settingsService.get())), []);
  const load = useCallback(() => {
    setSettings(settingsService.get());
    if (!uid) return;
    settingsService.load().then((s) => { setSettings(s); setError(false); }).catch(() => setError(true)); // keeps defaults; the Settings page offers a retry
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  return { settings, error, reload: load };
}
