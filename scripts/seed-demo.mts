/**
 * Refreshes demo data for interactive use: generates the Motion Studio provider,
 * service and ten working days of slots starting tomorrow (Europe/Prague), with
 * a few slots pre-booked. Idempotent — safe to run any number of times.
 *
 * Usage: npm run db:seed:demo [-- YYYY-MM-DD]   (optional explicit first day)
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

const explicitDay = process.argv[2];
if (explicitDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(explicitDay)) {
  console.error(`Invalid date "${explicitDay}", expected YYYY-MM-DD`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
  const [row] = explicitDay
    ? await sql`select internal.seed_demo_data(${explicitDay}::date) as result`
    : await sql`select internal.seed_demo_data(((now() at time zone 'Europe/Prague')::date + 1)) as result`;
  console.log("Demo data ready:", row.result);
} finally {
  await sql.end();
}
