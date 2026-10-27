// Shown instead of the sign-in form when the app has neither a backend URL nor an explicit demo setting. Fixing the configuration is the only way forward.
export default function SetupNotice() {
  return (
    <div role="alert" data-testid="setup-needed" className="space-y-3 rounded-lg border border-warn p-4 text-sm">
      <p className="font-semibold text-warn">CareerGraph is not connected to a server.</p>
      <p>This copy of the app has no server address, so it cannot sign you in or save anything. It will not quietly switch to fake demo data.</p>
      <ol className="list-decimal space-y-1 pl-5 text-bark2">
        <li>In the folder that contains <code>package.json</code>, create a file named <code>.env.local</code> containing <code>VITE_API_URL=http://localhost:4000/api</code>.</li>
        <li>Start the backend (<code>cd server</code>, then <code>npm run dev</code>).</li>
        <li>Stop and restart <code>npm run dev</code> for the app: Vite only reads this file at start-up.</li>
      </ol>
      <p className="text-bark2">To try the app with browser-only demo data instead, set <code>VITE_DEMO_MODE=true</code> in the same file and restart.</p>
    </div>
  );
}
