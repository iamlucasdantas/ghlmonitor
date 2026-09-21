import pg from 'pg';

const { Pool } = pg;

// numeric/int8 come back as strings by default; every numeric column in this schema
// fits comfortably in a double, and the callers all treat them as numbers.
pg.types.setTypeParser(1700, (v: string) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v: string) => (v === null ? null : Number(v)));

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString,
      max: Number(process.env['PG_POOL_MAX'] ?? 10),
      idleTimeoutMillis: 30_000,
      // Supabase terminates idle TLS connections; keepalive avoids surprise resets.
      keepAlive: true,
    });
    pool.on('error', (err) => console.error({ err: err.message }, 'pg pool error'));
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await db().query<T>(sql, params as never[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
