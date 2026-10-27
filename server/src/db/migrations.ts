import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './types';

export interface MigrationFile { name: string; sql: string; checksum: string }
const NAME = /^\d{3,}_[a-z0-9_]+\.sql$/;
const LOCK_ID = 727274; // arbitrary constant: only one migration runner at a time

export function readMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => {
    if (!NAME.test(name)) throw new Error(`Migration file "${name}" must be named like 001_description.sql.`);
    const sql = readFileSync(join(dir, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

// Applies pending migrations in order inside ONE transaction (all or nothing), guarded by an advisory lock.
// Already-applied migrations are never re-run; if one was edited after being applied, we stop instead of guessing.
export async function runMigrations(db: Db, migrations: MigrationFile[], log: (m: string) => void = () => {}): Promise<{ applied: string[]; skipped: string[] }> {
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Map((await tx.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]));
    const applied: string[] = [], skipped: string[] = [];
    for (const m of migrations) {
      const prev = done.get(m.name);
      if (prev !== undefined) {
        if (prev !== m.checksum) throw new Error(`Migration ${m.name} was changed after it was applied. Add a new migration instead of editing it.`);
        skipped.push(m.name); continue;
      }
      log(`applying ${m.name}`);
      await tx.query(m.sql);
      await tx.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
      applied.push(m.name);
    }
    return { applied, skipped };
  });
}
