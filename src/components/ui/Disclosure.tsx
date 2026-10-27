import { useState, type ReactNode } from 'react';

// A collapsed section for secondary detail: a one-line header that expands to the full content. Children mount only once it is opened, so heavy
// content (like the graph, which measures its container) is built when it is visible. The header is the only chrome; the content keeps its own card.
export default function Disclosure({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={defaultOpen} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="disclosure">
      <summary className="cursor-pointer rounded-xl border border-line bg-panel px-4 py-3 font-semibold hover:border-ember">{title}{hint && <span className="ml-2 text-sm font-normal text-mute">{hint}</span>}</summary>
      {open && <div className="mt-3">{children}</div>}
    </details>
  );
}
