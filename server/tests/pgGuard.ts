// Safety rules for the opt-in real-PostgreSQL suite. Returns the database name, or throws before anything connects.
export function assertSafeTestDatabase(testUrl: string, mainUrl: string | undefined): string {
  let name: string;
  try { name = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, '')); } catch { throw new Error('TEST_DATABASE_URL cannot be parsed (percent-encode special characters in the password and wrap the value in double quotes).'); }
  if (!/_test$/.test(name)) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in "_test". Refusing to run against anything else.');
  if (testUrl.trim() === (mainUrl ?? '').trim()) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL. Refusing to run.');
  return name;
}
