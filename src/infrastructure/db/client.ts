import "server-only";
import postgres, { type Sql } from "postgres";

const globalForDb = globalThis as typeof globalThis & { __instantBookingSql?: Sql };

/**
 * Lazily created, process-wide Postgres pool. Server-only: `DATABASE_URL`
 * contains credentials and must never reach browser code.
 */
export function getSql(): Sql {
  if (!globalForDb.__instantBookingSql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. See .env.example.");
    }
    globalForDb.__instantBookingSql = postgres(url, {
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idle_timeout: 20,
      // Compatible with the Supabase transaction-mode pooler (port 6543).
      prepare: false,
    });
  }
  return globalForDb.__instantBookingSql;
}
