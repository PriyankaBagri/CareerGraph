import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useAuth } from '../context/AuthContext';
import { useEvidence } from '../context/EvidenceContext';
import { api } from '../services/api';
import { dataService } from '../services/data';
import { findPending, importAvailable, importBrowserData, type PendingImport, type Resolutions } from '../services/browserData';
import { settingsService } from '../services/settings';
import BrowserImport from '../components/settings/BrowserImport';
import { useSettings } from '../hooks/useSettings';
import type { UserSettings } from '../types';

type Reset = 'actions' | 'evidence' | 'all';
const COPY: Record<Reset, { title: string; body: string; label: string }> = {
  actions: { title: 'Clear action progress?', body: 'Every action returns to "Not started" for all your careers. Your skills, evidence and careers are kept.', label: 'Clear progress' },
  evidence: { title: 'Delete all your evidence?', body: api.useBackend('evidence') ? 'All evidence in your account (and any saved in this browser) is permanently deleted. Readiness will drop where it depended on it.' : 'All evidence you added is permanently deleted from this browser. Readiness will drop where it depended on it.', label: 'Delete evidence' },
  all: { title: 'Reset all CareerGraph data?', body: api.useBackend('evidence') ? 'Your skill ratings, evidence, action progress, profile and settings in your account (and anything saved in this browser) are deleted, and you return to onboarding. Your custom careers are NOT deleted; remove them one by one from Explore.' : 'Your profile, skill levels, evidence, action progress, custom careers and settings are deleted from this browser. You will be taken back to onboarding.', label: 'Reset everything' },
};

export default function Settings() {
  const { user, logout, resetAccountData, refreshProfile } = useAuth();
  const ev = useEvidence();
  const navigate = useNavigate();
  const { settings: prefs, error: prefsError, reload: reloadPrefs } = useSettings();
  const [confirm, setConfirm] = useState<Reset | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => { document.title = 'Settings · CareerGraph'; }, []);
  useEffect(() => { // read-only check; a failure just hides the section
    if (!user || !importAvailable()) return;
    let live = true;
    findPending(user.id).then((p) => live && setPending(p)).catch(() => live && setPending(null));
    return () => { live = false; };
  }, [user]);
  async function runImport(choices: Resolutions) {
    if (!user) return;
    setBusy(true); setMsg(null);
    try {
      const r = await importBrowserData(user.id, choices);
      ev.reload(); await refreshProfile(); reloadPrefs();
      setPending(await findPending(user.id).catch(() => null));
      const done = `Copied ${r.careersCopied} career(s), ${r.ratingsCopied} skill rating(s), ${r.evidenceCopied} evidence item(s), ${r.profileFields} profile value(s), ${r.actionsCopied} action status(es) and ${r.settingsCopied} setting(s) to your account. ${r.skipped} already there (or kept as your account's version) were skipped.`;
      if (r.stopped === 'auth') setMsg({ ok: false, text: `${done} Your session expired, so the rest was not copied. Sign in and try again.` });
      else if (r.stopped === 'network') setMsg({ ok: false, text: `${done} The server could not be reached, so the rest was not copied. Try again when it is running.` });
      else if (r.failed > 0) setMsg({ ok: false, text: `${done} ${r.failed} item(s) could not be saved and remain in this browser.` });
      else setMsg({ ok: true, text: done });
    } catch { setMsg({ ok: false, text: "We couldn't copy your browser data. Nothing in this browser was changed; please try again." }); } finally { setBusy(false); setImportOpen(false); }
  }

  async function toggle(k: keyof UserSettings) {
    setMsg(null);
    try {
      const next = await settingsService.set({ [k]: !prefs[k] }); // saved to your account first; the switch only moves once that worked
      if (k === 'reduceMotion') document.documentElement.dataset.reduceMotion = String(next.reduceMotion);
    } catch { setMsg({ ok: false, text: "We couldn't save that setting. Nothing was changed; please try again." }); }
  }
  async function run() {
    if (!confirm) return;
    setBusy(true); setMsg(null);
    try {
      if (confirm === 'actions') { await dataService.clearActionProgress(); setMsg({ ok: true, text: 'Action progress cleared.' }); }
      if (confirm === 'evidence') { await dataService.clearEvidence(); ev.reload(); setMsg({ ok: true, text: 'Evidence deleted.' }); }
      if (confirm === 'all') { await resetAccountData(); ev.reload(); setMsg({ ok: true, text: 'Your data was reset.' }); }
    } catch { setMsg({ ok: false, text: "We couldn't complete that. Nothing else was changed; please try again." }); } finally { setBusy(false); setConfirm(null); }
  }
  const row = 'flex items-center justify-between gap-4 py-3';
  const Toggle = ({ k, label, hint }: { k: keyof UserSettings; label: string; hint: string }) => (
    <div className={row}><div><p className="font-medium">{label}</p><p className="text-sm text-bark2">{hint}</p></div>
      <button type="button" role="switch" aria-checked={prefs[k]} aria-label={label} onClick={() => toggle(k)} className={`rounded-full border px-3 py-1 text-sm font-semibold ${prefs[k] ? 'border-ember bg-ember text-ink' : 'border-sand'}`}>{prefs[k] ? 'On' : 'Off'}</button></div>
  );

  return (
    <div className="animate-rise space-y-6">
      <header><p className="eyebrow">Settings</p><h1 className="text-3xl font-semibold">Settings</h1></header>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-lg border p-3 text-sm ${msg.ok ? 'border-ok text-ok' : 'border-bad text-bad'}`}>{msg.ok ? '✓' : '⚠'} {msg.text}</p>}

      <section className="card" aria-labelledby="acc-h">
        <h2 id="acc-h" className="text-lg font-semibold">Account</h2>
        <dl className="mt-2 divide-y divide-sand text-sm">
          <div className={row}><dt className="text-bark2">Name</dt><dd className="font-medium">{user?.name}</dd></div>
          <div className={row}><dt className="text-bark2">Email</dt><dd className="font-medium">{user?.email}</dd></div>
          <div className={row}><dt className="text-bark2">Account type</dt><dd className="text-right font-medium">{api.useBackend('auth') ? 'Signed in to your CareerGraph account' : 'Local demo account, stored in this browser only'}</dd></div>
        </dl>
        <button className="mt-3 rounded-lg border border-sand px-4 py-2" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Log out</button>
      </section>

      <section className="card divide-y divide-sand" aria-labelledby="pref-h">
        <h2 id="pref-h" className="pb-2 text-lg font-semibold">Preferences</h2>
        {prefsError && <p role="alert" className="text-sm text-bad">We couldn't load your saved settings. <button className="underline" onClick={reloadPrefs}>Try again</button></p>}
        <Toggle k="reduceMotion" label="Reduce motion" hint="Turns off animations and transitions." />
        <Toggle k="assistantSuggestions" label="Assistant suggested questions" hint="Show suggested questions on the Assistant page." />
      </section>

      <section className="card" aria-labelledby="data-h">
        <h2 id="data-h" className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-bark2">{api.useBackend('evidence') ? 'Your profile, careers, skill ratings, evidence and progress are stored in your CareerGraph account. These controls only affect your own account.' : 'CareerGraph currently stores everything in this browser. These controls only affect your own account.'}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {(Object.keys(COPY) as Reset[]).map((r) => <button key={r} className="rounded-lg border border-bad px-4 py-2 text-sm font-semibold text-bad" onClick={() => setConfirm(r)}>{COPY[r].label}</button>)}
        </div>
      </section>
      {pending && <BrowserImport pending={pending} busy={busy} open={importOpen} setOpen={setImportOpen} onImport={(c) => void runImport(c)} />}
      {confirm && <ConfirmDialog title={COPY[confirm].title} confirmLabel={COPY[confirm].label} busy={busy} onConfirm={() => void run()} onCancel={() => setConfirm(null)}><p>{COPY[confirm].body}</p></ConfirmDialog>}
    </div>
  );
}
