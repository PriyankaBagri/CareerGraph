// Turns a server 'error' event into one clear, secret-free sentence (no stack trace, no environment values).
export function describeListenError(err: NodeJS.ErrnoException, port: number): string {
  if (err.code === 'EADDRINUSE') return `Port ${port} is already in use (probably another CareerGraph backend). Close it, or set a different PORT in server/.env.`;
  if (err.code === 'EACCES') return `Not allowed to listen on port ${port}. Choose a port above 1024 in server/.env.`;
  return `The server could not start listening on port ${port} (${err.code ?? 'unknown error'}).`;
}
