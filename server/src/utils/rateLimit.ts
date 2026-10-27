// Sliding-window limiter, in memory and per process. Fine for one API instance; a multi-instance deployment needs a shared store (documented limitation).
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}
  // Returns 0 when the call is allowed (and records it), otherwise the whole seconds to wait.
  take(key: string): number {
    const t = this.now(), from = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return Math.max(1, Math.ceil((recent[0] + this.windowMs - t) / 1000)); }
    recent.push(t); this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(from);
    return 0;
  }
  // Read-only check (does not record) plus explicit record/clear: used to count only FAILED logins.
  wait(key: string): number {
    const t = this.now(), recent = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    return recent.length >= this.limit ? Math.max(1, Math.ceil((recent[0] + this.windowMs - t) / 1000)) : 0;
  }
  record(key: string): void { const t = this.now(); this.hits.set(key, [...(this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs), t]); if (this.hits.size > 5000) this.sweep(t - this.windowMs); }
  clear(key: string): void { this.hits.delete(key); }
  private sweep(from: number) { for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k); }
}
