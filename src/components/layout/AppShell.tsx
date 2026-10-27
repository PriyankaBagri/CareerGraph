import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Compass, FileCheck2, GitCompare, LayoutDashboard, MessageSquare, LogOut, Menu, Network, Route, Settings, User as UserIcon, X } from 'lucide-react';
import { useProfile } from '../../hooks/useProfile';
import { useAuth } from '../../context/AuthContext';
import DevDataSource from './DevDataSource';
import { useSettings } from '../../hooks/useSettings';
import { useOnline } from '../../hooks/useOnline';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard }, { to: '/career', label: 'Career Explorer', Icon: Compass },
  { to: '/skills', label: 'Skills', Icon: Network }, { to: '/evidence', label: 'Evidence', Icon: FileCheck2 },
  { to: '/roadmap', label: 'Roadmap', Icon: Route }, { to: '/compare', label: 'Compare Careers', Icon: GitCompare }, { to: '/assistant', label: 'Assistant', Icon: MessageSquare },
  { to: '/profile', label: 'Profile', Icon: UserIcon }, { to: '/settings', label: 'Settings', Icon: Settings },
];

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const me = useProfile();
  const navigate = useNavigate();
  const { logout: signOut } = useAuth();
  const logout = async () => { await signOut(); navigate('/login', { replace: true }); };
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-6 text-lg font-semibold tracking-tight">Career<span className="text-ember">Graph</span></div>
      <nav aria-label="Main" className="flex-1 space-y-1 px-3">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-ember/15 text-ember' : 'text-mute hover:bg-white/5 hover:text-white'}`}>
            <Icon size={18} aria-hidden />{label}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 flex items-center gap-3 rounded-xl border border-line p-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ember font-semibold text-ink" aria-hidden>{me?.user.initials ?? '…'}</div>
        <div className="min-w-0 flex-1"><div className="truncate text-sm">{me?.user.name ?? 'Loading'}</div><div className="truncate text-xs text-mute">{me?.profile.stage ?? ' '}</div></div>
        <button onClick={logout} aria-label="Log out" className="rounded-md p-2 text-mute hover:text-white"><LogOut size={16} /></button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [open, setOpen] = useState(false);
  const { settings } = useSettings();
  const online = useOnline();
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(settings.reduceMotion); }, [settings.reduceMotion]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only rounded-lg bg-ember px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50">Skip to main content</a>
      {!online && <p role="status" className="sticky top-0 z-40 bg-warn px-4 py-2 text-center text-sm font-semibold text-ink">You appear to be offline. Changes cannot be saved until your connection returns; nothing is being stored locally instead.</p>}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-ink/80 lg:block"><SideNav /></aside>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-ink/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="font-semibold">Career<span className="text-ember">Graph</span></span>
        <button onClick={() => setOpen(true)} aria-label="Open navigation" className="rounded-md p-2"><Menu /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-black/60" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 animate-rise bg-ink shadow-2xl">
            <button onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-4 p-1 text-mute"><X size={18} /></button>
            <SideNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <main id="main" tabIndex={-1} className="px-5 py-6 focus:outline-none sm:px-8 lg:pl-72 lg:pr-10"><div className="mx-auto max-w-6xl"><Outlet /><DevDataSource /></div></main>
    </div>
  );
}
