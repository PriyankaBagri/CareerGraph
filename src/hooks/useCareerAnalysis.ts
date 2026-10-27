import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useEvidence } from '../context/EvidenceContext';
import { actionService } from '../services/actions';
import { loadRemoteAnalysis } from '../services/analysisApi';
import { api } from '../services/api';
import { addNote } from '../services/diagStore';
import { careerService } from '../services/career';
import { readinessService } from '../services/readiness';
import type { Action, ActionStatus, CareerDataset, DashboardView } from '../types';
import { buildRoadmap, mergeActions, type ActionStore } from '../utils/actions';
import { evidenceKey } from '../utils/evidenceLink';
import { scoped, type Scoped } from '../utils/scoped';
import { useProfile } from './useProfile';

// The one derivation used by Dashboard, Skills, Skill detail, Roadmap, Career detail and Compare:
// career data + profile levels + shared evidence -> analysis -> actions (+ saved statuses) -> roadmap.
// careerId is the single input (profile.targetCareerId for the active career). Every async slot is tagged with the
// id it was loaded for, so a change of career can never render the previous career's data.
export function useCareerAnalysis(careerId: string) {
  const me = useProfile();
  const { user } = useAuth();
  const ev = useEvidence();
  const uid = user?.id ?? null;
  const storeKey = uid ? `${uid}|${careerId}` : '';
  // Backend mode: readiness/gaps/actions come from the server (custom careers exist only in this browser, so they stay local).
  const remote = !!careerId && api.useBackend('analysis') && !careerService.isLocalCustom(careerId);
  useEffect(() => { if (import.meta.env?.DEV && careerId && api.useBackend('analysis') && !remote) addNote(`Career "${careerId}" exists only in this browser (custom career), so it is analysed locally.`); }, [careerId, remote]);
  const [remoteSlot, setRemoteSlot] = useState<Scoped<DashboardView> | null>(null);
  const [dataSlot, setDataSlot] = useState<Scoped<CareerDataset> | null>(null);
  const [storeSlot, setStoreSlot] = useState<Scoped<ActionStore> | null>(null);
  const [errorFor, setErrorFor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!careerId || remote) return;
    let live = true;
    setErrorFor(null);
    careerService.getDataset(careerId).then((d) => live && setDataSlot({ id: careerId, value: d })).catch(() => live && setErrorFor(careerId));
    return () => { live = false; };
  }, [careerId, tick, remote]);

  useEffect(() => {
    if (!careerId || !uid) return;
    let live = true;
    actionService.getStore(careerId).then((s) => live && setStoreSlot({ id: storeKey, value: s })).catch(() => live && setErrorFor(careerId));
    return () => { live = false; };
  }, [careerId, uid, storeKey, tick]);

  // Re-fetched whenever the user's evidence or ratings change. `live` drops any response that arrives after a newer request started,
  // so a slow stale response can never overwrite newer data. The slot is tagged with user + career, so another career's or user's data is never shown.
  const items0 = ev.items;
  const ratingsKey = JSON.stringify(me?.profile.skillAssessments ?? []);
  const remoteKey = `${storeKey}|${ratingsKey}|${items0 ? evidenceKey(items0) : 'loading'}`;
  useEffect(() => {
    if (!remote || !uid || !items0 || !me) return;
    let live = true;
    setErrorFor(null);
    setRefreshing(true);
    loadRemoteAnalysis(careerId, items0).then((v) => live && setRemoteSlot({ id: storeKey, value: v })).catch(() => live && setErrorFor(careerId)).finally(() => { if (live) setRefreshing(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, careerId, uid, remoteKey, tick]);
  const remoteView = scoped<DashboardView>(remoteSlot, storeKey); // keeps the previous result for the same user+career while a newer one loads (no flicker)

  const data = scoped<CareerDataset>(dataSlot, careerId);
  const store = scoped<ActionStore>(storeSlot, storeKey);
  const levels = useMemo(() => Object.fromEntries((me?.profile.skillAssessments ?? []).map((a) => [a.skillId, a.currentLevel])), [me]);
  const isDemo = me?.profile.isDemo ?? false;
  const items = ev.items;
  const analysis = useMemo(() => remote ? remoteView : (data && items ? readinessService.analyze(data, levels, { includeExampleEvidence: isDemo, userEvidence: items, unassessedLevel: isDemo ? undefined : 0, assumeAssessed: isDemo }) : null), [remote, remoteView, data, items, levels, isDemo]);
  const actions = useMemo(() => (analysis && store ? mergeActions(analysis.actions, store) : null), [analysis, store]);
  const roadmap = useMemo(() => (actions ? buildRoadmap(careerId, actions) : null), [actions, careerId]);
  const view = analysis && store ? analysis : null;

  const reloadEvidence = ev.reload;
  const retry = useCallback(() => { setTick((t) => t + 1); reloadEvidence(); }, [reloadEvidence]);
  const setActionStatus = useCallback(async (action: Action, status: ActionStatus) => { const s = await actionService.setStatus(careerId, action, status); setStoreSlot({ id: storeKey, value: s }); }, [careerId, storeKey]);
  return { view, actions, roadmap, error: errorFor === careerId || ev.error, retry, setActionStatus, refreshing };
}
