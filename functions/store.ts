/** Minimal synchronous SQL boundary shared by the deployed actor and local SQLite tests. */
export interface SQL {
  exec(query: string, ...bindings: (string | number | null)[]): Iterable<Record<string, unknown>>;
}

/** Each showcase/test actor owns its records; mutations run in one synchronous transaction. */
export class RecordStore {
  constructor(readonly sql: SQL, readonly transaction: <T>(work: () => T) => T) {
    sql.exec('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))');
    sql.exec('CREATE TABLE IF NOT EXISTS credentials (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, patient INTEGER NOT NULL, expires INTEGER NOT NULL, generation TEXT NOT NULL, parent TEXT)');
    sql.exec('CREATE INDEX IF NOT EXISTS credentials_expiry ON credentials(expires)');
    sql.exec('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
  }
  all<T>(kind: string): T[] {
    return [...this.sql.exec('SELECT data FROM records WHERE kind=? ORDER BY id', kind)].map(row => JSON.parse(String(row.data)) as T);
  }
  get<T>(kind: string, id: number): T | undefined {
    const row = [...this.sql.exec('SELECT data FROM records WHERE kind=? AND id=?', kind, id)][0];
    return row ? JSON.parse(String(row.data)) as T : undefined;
  }
  put<T extends { id: number }>(kind: string, row: T): T {
    this.sql.exec('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data', kind, row.id, JSON.stringify(row));
    return row;
  }
  next(kind: string): number {
    return Number([...this.sql.exec('SELECT COALESCE(MAX(id),0)+1 AS id FROM records WHERE kind=?', kind)][0]?.id ?? 1);
  }
  limit(key: string, max: number, windowMs: number, now: number): boolean {
    this.sql.exec('DELETE FROM limits WHERE expires<=?', now);
    this.sql.exec('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + windowMs);
    return Number([...this.sql.exec('SELECT count FROM limits WHERE key=?', key)][0]?.count) <= max;
  }
}
