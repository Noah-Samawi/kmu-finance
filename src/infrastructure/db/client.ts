import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Ein Pool pro Prozess. In der Entwicklung überlebt er Hot-Reloads.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const connectionString = process.env.DATABASE_URL;
const useSsl =
  !!connectionString &&
  (/neon\.tech/i.test(connectionString) || /sslmode=require/i.test(connectionString));

export const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString,
    max: 10,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
