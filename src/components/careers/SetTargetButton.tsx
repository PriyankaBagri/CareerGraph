import { useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../hooks/useProfile';

interface Props { careerId: string; careerName: string; label?: string; beforeActivate?: () => Promise<string | void>; /* may return the saved career's final id */ onDone?: () => void }

// The only way exploration can change the target career, and always behind a confirmation.
export default function SetTargetButton({ careerId, careerName, label = 'Set as Target Career', beforeActivate, onDone }: Props) {
  const me = useProfile();
  const { setTargetCareer } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (me?.profile.targetCareerId === careerId) return <p role="status" className="text-sm font-semibold text-ok">✓ This is your current target career. <Link to="/dashboard" className="underline">View dashboard</Link></p>;

  async function run() {
    setBusy(true); setFailed(false);
    try { const finalId = await beforeActivate?.(); await setTargetCareer(typeof finalId === 'string' ? finalId : careerId); onDone?.(); } catch { setFailed(true); } finally { setBusy(false); setConfirm(false); }
  }
  return (
    <div>
      <button className="btn" onClick={() => setConfirm(true)} disabled={!me}>{label}</button>
      {failed && <p role="alert" className="mt-2 text-sm text-bad">⚠ We couldn't change your target career. Please try again.</p>}
      {confirm && (
        <ConfirmDialog title="Change target career?" confirmLabel="Change Career" busy={busy} onConfirm={run} onCancel={() => setConfirm(false)}>
          <p>Switching to <b>{careerName}</b> will update your capabilities, skills, readiness, gaps, actions, roadmap and career graph to match it. Your evidence is kept.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
