import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Ein Pool pro Prozess. In der Entwicklung überlebt er Hot-Reloads.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;
const useSsl =
  !!connectionString &&
  (/neon\.tech/i.test(connectionString) || /sslmode=require/i.test(connectionString));

// Neon: DATABASE_URL sollte den Pooler-Host nutzen (…-pooler.…neon.tech).
// Auf Vercel Pool klein halten (Serverless); Timeout für Cold-Start/Wake.
export const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString,
    max: process.env.VERCEL ? 3 : 10,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 10_000,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

// Pool auch in Production cachen (Vercel Isolates wiederverwenden Connections)
globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
