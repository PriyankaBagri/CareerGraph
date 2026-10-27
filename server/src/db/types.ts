export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Queryable { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> }
// The only database surface the rest of the server depends on. Postgres implements it (pool.ts); tests use a fake.
export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
