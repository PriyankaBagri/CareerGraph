import { useState } from 'react';
import { LEVELS } from '../../utils/readiness';
import { LEVEL_MEANING } from '../../utils/skillText';

export default function LevelEditor({ current, assessed = true, onSave }: { current: number; assessed?: boolean; onSave: (level: number) => Promise<void> }) {
  // An unrated skill starts with NO choice. Pre-selecting "None" would let one click record a genuine 0 the student never picked.
  const [value, setValue] = useState<number | null>(assessed ? current : null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  async function save() {
    setBusy(true); setState('idle');
    try { if (value === null) return; await onSave(value); setState('saved'); } catch { setState('error'); } finally { setBusy(false); }
  }
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div><label htmlFor="lvl" className="mb-1 block text-sm font-medium">{assessed ? 'Update your level' : 'Set your current level'}</label>
        <select id="lvl" value={value ?? ''} onChange={(e) => { setValue(e.target.value === '' ? null : Number(e.target.value)); setState('idle'); }} className="rounded-lg border border-sand bg-white px-3 py-2">{value === null && <option value="">Choose a level…</option>}{LEVELS.map((l, i) => <option key={l} value={i}>{i} · {l}</option>)}</select>
        {value !== null && <p className="mt-1 max-w-xs text-xs text-bark2">{LEVEL_MEANING[value]}</p>}</div>
      <button className="btn" onClick={save} disabled={busy || value === null || (assessed && value === current)}>{busy ? 'Saving…' : assessed ? 'Save level' : 'Save assessment'}</button>
      {state === 'saved' && <p role="status" className="text-sm text-ok">✓ Saved</p>}
      {state === 'error' && <p role="alert" className="text-sm text-bad">⚠ We couldn't save your level. Try again.</p>}
    </div>
  );
}
