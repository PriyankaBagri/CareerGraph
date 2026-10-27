import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { evidenceService } from '../services/evidence';
import type { Evidence, EvidenceInput } from '../types';
import { useAuth } from './AuthContext';

// Single source of truth for the signed-in user's evidence. Dashboard, graph, readiness and the
// Evidence page all read from here, so create/update/remove propagate immediately with no reload.
interface EvidenceValue {
  items: Evidence[] | null; // null while loading, or while data belongs to a different user
  error: boolean;
  reload: () => void;
  create: (input: EvidenceInput) => Promise<Evidence>;
  update: (id: string, input: EvidenceInput) => Promise<Evidence>;
  remove: (id: string) => Promise<void>;
  setSkillLink: (e: Evidence, skillId: string, link: boolean) => Promise<Evidence>;
}
const Ctx = createContext<EvidenceValue | null>(null);

export function EvidenceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [data, setData] = useState<{ uid: string; items: Evidence[] } | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setError(false);
    if (!uid) { setData(null); return; }
    let live = true;
    evidenceService.getEvidence().then((items) => live && setData({ uid, items })).catch(() => live && setError(true));
    return () => { live = false; };
  }, [uid, tick]);

  const patch = useCallback((owner: string | null, fn: (items: Evidence[]) => Evidence[]) => setData((p) => (p && p.uid === owner ? { uid: p.uid, items: fn(p.items) } : p)), []);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const create = useCallback(async (input: EvidenceInput) => { const e = await evidenceService.createEvidence(input); patch(uid, (l) => [e, ...l]); return e; }, [uid, patch]);
  const update = useCallback(async (id: string, input: EvidenceInput) => { const e = await evidenceService.updateEvidence(id, input); patch(uid, (l) => l.map((x) => (x.id === id ? e : x))); return e; }, [uid, patch]);
  const remove = useCallback(async (id: string) => { await evidenceService.deleteEvidence(id); patch(uid, (l) => l.filter((x) => x.id !== id)); }, [uid, patch]);

  const setSkillLink = useCallback(async (e: Evidence, skillId: string, link: boolean) => { const out = await evidenceService.setSkillLink(e, skillId, link); patch(uid, (l) => l.map((x) => (x.id === e.id ? out : x))); return out; }, [uid, patch]);

  const items = data && data.uid === uid ? data.items : null; // never expose another user's evidence
  const value = useMemo(() => ({ items, error, reload, create, update, remove, setSkillLink }), [items, error, reload, create, update, remove, setSkillLink]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEvidence(): EvidenceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEvidence must be used inside EvidenceProvider');
  return v;
}
