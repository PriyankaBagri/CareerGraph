import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Skeleton from '../components/ui/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useCareerAnalysis } from '../hooks/useCareerAnalysis';
import { useProfile } from '../hooks/useProfile';
import { api } from '../services/api';
import { careerService } from '../services/career';
import type { CareerSummary, ExperienceLevel } from '../types';
import { EXPERIENCE_LEVELS } from '../utils/constants';
import { profileProgress, ratingSummary } from '../utils/profileStatus';

const input = 'w-full rounded-lg border border-sand bg-white px-3 py-2';

export default function Profile() {
  const me = useProfile();
  const { setTargetCareer, saveProfile } = useAuth();
  const targetId = me?.profile.targetCareerId ?? '';
  const { view } = useCareerAnalysis(targetId);
  const [careers, setCareers] = useState<CareerSummary[]>([]);
  const [pick, setPick] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<'ok' | 'err' | null>(null);
  const [form, setForm] = useState<{ level: ExperienceLevel; education: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<'ok' | 'err' | null>(null);
  useEffect(() => { document.title = 'Profile · CareerGraph'; careerService.list().then(setCareers).catch(() => {}); }, []);
  const profile = me?.profile;
  useEffect(() => { if (profile) setForm({ level: profile.experienceLevel, education: profile.education, note: profile.experienceSummary }); }, [profile]);
  if (!me || !form) return <Skeleton className="h-64" />;

  const { user } = me;
  const current = careers.find((c) => c.id === me.profile.targetCareerId);
  const selectedId = pick || me.profile.targetCareerId;
  const selected = careers.find((c) => c.id === selectedId);
  const onTrack = view?.skills.filter((s) => s.status === 'on_track').length;
  const ratings = ratingSummary(view?.skills ?? [], me.profile.skillAssessments.length);
  const progress = profileProgress(me.profile, view?.skills ?? null, view ? view.evidence.length : null);

  async function change() {
    setBusy(true); setMsg(null);
    try { await setTargetCareer(selectedId); setPick(''); setMsg('ok'); } catch { setMsg('err'); } finally { setBusy(false); setConfirm(false); }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true); setSaved(null);
    try { await saveProfile({ experienceLevel: form.level, stage: EXPERIENCE_LEVELS.find((l) => l.value === form.level)?.label ?? '', education: form.education.trim(), experienceSummary: form.note.trim() }); setSaved('ok'); } catch { setSaved('err'); } finally { setSaving(false); }
  }

  return (
    <div className="animate-rise space-y-6">
      <header><p className="eyebrow">Profile</p><h1 className="text-3xl font-semibold">{user.name}</h1><p className="text-mute">{user.email}</p></header>

      <section className="card-dark" id="target-career" aria-labelledby="tc-h">
        <h2 id="tc-h" className="text-lg font-semibold">Target career</h2>
        <p className="mt-1 text-mute">Your skills, readiness, gaps, actions and graph all follow this career.</p>
        <p className="mt-3 text-2xl font-semibold">{current?.name ?? '…'}</p>
        {current && <p className="max-w-2xl text-sm text-mute">{current.description}</p>}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div><label htmlFor="tc" className="mb-1 block text-sm text-mute">Change to</label>
            <select id="tc" value={selectedId} onChange={(e) => { setPick(e.target.value); setMsg(null); }} className="rounded-lg border border-line bg-ink px-3 py-2 text-white">{careers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <button className="btn" disabled={!selected || selectedId === me.profile.targetCareerId} onClick={() => setConfirm(true)}>Change Target Career</button>
        </div>
        {msg === 'ok' && <p role="status" className="mt-3 text-sm text-ok">✓ Target career updated. <Link to="/dashboard" className="underline">View dashboard</Link></p>}
        {msg === 'err' && <p role="alert" className="mt-3 text-sm text-bad">⚠ We couldn't change your target career. Please try again.</p>}
        <p className="mt-4 text-sm text-mute">Want a career that isn't listed? <Link to="/career" className="text-ember underline">Create a career model</Link>.</p>
      </section>

      <section className="card" aria-labelledby="pi-h">
        <h2 id="pi-h" className="text-lg font-semibold">Personal information</h2>
        <dl className="mt-2 divide-y divide-sand text-sm">
          <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Name</dt><dd className="font-medium">{user.name}</dd></div>
          <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Email</dt><dd className="font-medium">{user.email}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-bark2">{api.useBackend('auth') ? 'Name and email come from your CareerGraph account sign-in and cannot be edited here. Your profile, target career, ratings and progress are saved to your account.' : "Name and email belong to your local demo account and can't be edited here."}</p>
      </section>

      <section className="card" aria-labelledby="bg-h">
        <h2 id="bg-h" className="text-lg font-semibold">Experience and background</h2>
        <form onSubmit={save} className="mt-3 grid gap-4 md:grid-cols-2" noValidate>
          <div><label htmlFor="pl" className="mb-1 block text-sm font-medium">Experience level</label><select id="pl" className={input} value={form.level} onChange={(e) => { setForm({ ...form, level: e.target.value as ExperienceLevel }); setSaved(null); }}>{EXPERIENCE_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></div>
          <div><label htmlFor="pe" className="mb-1 block text-sm font-medium">Education</label><input id="pe" className={input} maxLength={120} value={form.education} placeholder="e.g. BA, Interaction Design" onChange={(e) => { setForm({ ...form, education: e.target.value }); setSaved(null); }} /></div>
          <div className="md:col-span-2"><label htmlFor="pn" className="mb-1 block text-sm font-medium">About you (your own note)</label><textarea id="pn" rows={2} className={input} maxLength={200} value={form.note} onChange={(e) => { setForm({ ...form, note: e.target.value }); setSaved(null); }} /><p className="mt-1 text-xs text-bark2">This is free text you wrote. It does not change with your target career.</p></div>
          <div className="flex flex-wrap items-center gap-3 md:col-span-2"><button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            {saved === 'ok' && <p role="status" className="text-sm text-ok">✓ Saved</p>}{saved === 'err' && <p role="alert" className="text-sm text-bad">⚠ We couldn't save. Try again.</p>}</div>
        </form>
      </section>

      <section className="card" aria-labelledby="sk-h">
        <h2 id="sk-h" className="text-lg font-semibold">Skills and profile information</h2>
        <dl className="mt-2 divide-y divide-sand text-sm">
          <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Skills rated for {current?.name ?? 'your target'}</dt><dd className="font-medium">{view ? `${ratings.forCareer} of ${ratings.total}` : '…'}</dd></div>
          {view && ratings.other > 0 && <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Ratings kept for other careers</dt><dd className="font-medium">{ratings.other}</dd></div>}
          <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">On track for {current?.name ?? 'your target'}</dt><dd className="font-medium">{view ? `${onTrack} of ${view.skills.length} skills` : '…'}</dd></div>
          <div className="flex justify-between gap-4 py-2"><dt className="text-bark2">Profile completeness</dt><dd className="font-medium">{progress.total ? `${progress.done} of ${progress.total} (${progress.percent}%)` : '…'}</dd></div>
          {progress.missing.length > 0 && <div className="py-2 text-bark2">Still to add: {progress.missing.join(', ')}.</div>}
        </dl>
        <p className="mt-2 text-sm"><Link to="/skills" className="text-ember underline">Review skills</Link> · <Link to="/evidence" className="text-ember underline">Manage evidence</Link></p>
      </section>

      {confirm && (
        <ConfirmDialog title="Change target career?" confirmLabel="Change Career" busy={busy} onConfirm={change} onCancel={() => setConfirm(false)}>
          <p>Changing your target career to <b>{selected?.name}</b> will update your skills, readiness, gaps, actions, and CareerGraph to match the new career. Your evidence is kept.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
