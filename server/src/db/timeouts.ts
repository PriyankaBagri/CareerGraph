// A new connection (TCP + TLS/SCRAM login) may legitimately take a few seconds on a busy machine. The health check waits slightly LONGER
// than the pool's connect timeout, so a slow-but-working database is reported by the pool's own result instead of being declared down by a shorter timer.
// 10 s (was 5 s): a hosted database that has been idle (for example a free-tier Neon project) must wake up before it accepts the login, from a server in another region.
// This only lengthens the wait for ONE connection attempt. Nothing is retried, so a write is never repeated.
export const CONNECT_TIMEOUT_MS = 10_000;
export const HEALTH_TIMEOUT_MS = CONNECT_TIMEOUT_MS + 1_000;
