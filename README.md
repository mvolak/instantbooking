# InstantBooking

**Booking in Action.** A small, capability-native booking engine: one deterministic
booking capability, independent of the interfaces that will expose it (web, AI
conversations, generative UI, X, Microsoft Teams, …).

This is **M1 — Foundation & Booking Engine**: persistence, the four booking
operations, a REST API and tests. There is no AI, UI, authentication or channel
adapter yet.

## Stack

Node.js 24 · TypeScript (strict) · Next.js 16 App Router (Route Handlers) ·
Supabase PostgreSQL · [postgres.js](https://github.com/porsager/postgres) · Zod 4 · Vitest

## Architecture

```text
src/
├── domain/booking/          # The capability. No Next.js, no SQL, no channel code.
│   ├── capability.ts        #   listServices · findAvailableSlots · createBooking · getBooking
│   ├── types.ts             #   entities + BookingRepository port
│   ├── errors.ts            #   BookingError with channel-neutral codes
│   └── tokens.ts            #   management token generation / hashing
├── schemas/booking.ts       # Zod input schemas shared by domain and adapters
├── infrastructure/
│   ├── db/client.ts         # server-only Postgres pool (DATABASE_URL)
│   ├── db/booking-repository.ts  # SQL implementation of the port
│   └── booking-capability.ts     # production wiring (repo + system clock)
└── app/api/                 # REST adapter: thin Route Handlers → capability
supabase/
├── migrations/              # schema, constraints, demo seed function
└── seed.sql                 # fixed, deterministic seed window
scripts/seed-demo.mts        # refresh demo data for upcoming dates
tests/
├── unit/                    # tokens, schemas, validation (no DB)
└── integration/             # real PostgreSQL: capability, concurrency, constraints, API
```

A future adapter (AI tool, Teams bot, …) calls the same `BookingCapability`
from `getBookingCapability()` and maps `BookingError.code` to its own medium,
as `src/app/api/_lib/http.ts` does for HTTP.

### Consistency is enforced by PostgreSQL

| Guarantee | Mechanism |
|---|---|
| No double booking | partial unique index `bookings_one_confirmed_per_slot` on `bookings(slot_id) WHERE status = 'confirmed'` |
| No overlapping slots per provider | GiST exclusion constraint `slots_no_overlap_per_provider` (`provider_id =`, `tstzrange(starts_at, ends_at) &&`, active slots only) |
| One booking per idempotency key | unique `bookings(idempotency_key_hash)` |
| Atomic booking | a single `INSERT … SELECT` checks availability (slot, service, provider active; slot in the future) and inserts in one statement; unique violations are mapped to `409` |
| Valid data | FKs, `CHECK`s (status, `ends_at > starts_at`, hash format, name lengths), timezone validation trigger |
| No Data API exposure | RLS enabled with no policies, privileges revoked from `anon`/`authenticated`; the app connects server-side only |

### Management tokens and idempotent retries

- `createBooking` generates a 256-bit random token (base64url, 43 chars). Only
  its SHA-256 hash is stored; the token is returned **once**, to the caller.
- Every create request carries a client-generated `Idempotency-Key` (use a UUID v4,
  at least 16 characters). It is stored only as a SHA-256 hash.
- **Retrying** with the same key and the same payload (`slotId`, `guestName`)
  returns the same booking with HTTP `200`, header `Idempotent-Replayed: true`,
  and a **new** management token. The previous token stops working. Because the
  original token can't be recovered from its hash, the token is replaced
  instead of the retry silently returning a booking nobody can access. Only the
  holder of the secret idempotency key can trigger this, and that is the
  original caller.
- Reusing a key with a different payload gives `409 IDEMPOTENCY_KEY_REUSED`.
- If several retries race, each response carries a different token and only the
  most recently issued one is valid. Clients should keep the token from the
  last response they received.

## Getting started (from scratch)

### Prerequisites

- Node.js 24 (`.nvmrc`). Node 22.18+ also works.
- Docker Desktop, running (for the local Supabase stack)
- npm

### 1. Install and configure

```bash
npm install
cp .env.example .env.local
```

### 2. Start Supabase, apply migrations, seed

```bash
npm run db:start      # starts local Supabase; first run applies migrations + seed.sql
npm run db:reset      # (any time) drop, re-apply all migrations, re-run seed.sql
npm run db:seed:demo  # add demo slots for the next ten working days
```

Local ports are moved to the **553xx** range (`supabase/config.toml`) so this
project can run alongside other local Supabase projects that use the defaults:

| Service | URL |
|---|---|
| Postgres | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |
| Studio | http://127.0.0.1:55323 |
| API gateway (unused by the app) | http://127.0.0.1:55321 |

### 3. Run

```bash
npm run dev           # http://localhost:3000
curl http://localhost:3000/api/health
```

### Hosted Supabase (optional)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push            # apply migrations
npm run db:seed:demo            # with DATABASE_URL pointing at the hosted DB
```

Set `DATABASE_URL` to the **Transaction pooler** string from *Project → Connect*.
The client already uses `prepare: false`, which the pooler requires.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Server-side only, never prefix with `NEXT_PUBLIC_`. |
| `DATABASE_POOL_MAX` | no | Max pool connections (default `10`). |
| `TEST_DATABASE_URL` | no | Database for `npm test` (defaults to `DATABASE_URL`, then local Supabase). Tests create and delete their own rows, but **never point it at production**. |

M1 doesn't need Supabase API keys (anon/service role), because the app talks to
Postgres directly.

## Seed data

`supabase/seed.sql` calls `internal.seed_demo_data('2026-03-23')`, which creates:

- Provider **Motion Studio** (`11111111-1111-4111-8111-111111111111`), timezone `Europe/Prague`
- Service **Initial Physiotherapy Consultation**, 30 min (`22222222-2222-4222-8222-222222222222`)
- 10 working days × 14 slots (09:00–12:00 and 13:00–17:00 local), **Mon 2026-03-23 – Fri 2026-04-03**
- 6 occupied slots

The fixed window spans the CET→CEST switch (29 March 2026) and is what the tests
assert against. Its dates are in the past, so the live API (real clock) doesn't
offer them. For demos, `npm run db:seed:demo [-- YYYY-MM-DD]` generates the same
pattern starting tomorrow (Prague time) or on the given date.

All ids are derived deterministically and inserts tolerate conflicts, so both
seeds can be re-run any number of times without creating duplicates. (Demo
bookings' tokens are `seed-token-<bookingId>`. That's demo data only.)

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | all tests (unit + integration; needs the database) |
| `npm run test:unit` | unit tests only (no database) |
| `npm run test:integration` | real-PostgreSQL tests |
| `npm run test:fresh` | rebuild the local DB from migrations + seed, run all tests, re-add demo data |
| `npm run check` | typecheck + lint + test + build |
| `npm run db:start` / `db:stop` / `db:status` | local Supabase stack |
| `npm run db:reset` | re-create the local DB from migrations + seed |
| `npm run db:migrate` | apply pending migrations to the local DB |
| `npm run db:seed:demo` | upcoming-dates demo data |

## API

All responses are JSON with `Cache-Control: no-store`.

```text
success: { "data": … }
failure: { "error": { "code": "…", "message": "…", "details"?: [{ "path": "…", "message": "…" }] } }
```

| Status | Codes |
|---|---|
| 400 | `INVALID_INPUT` |
| 401 | `UNAUTHORIZED` (no `Authorization: Bearer` header) |
| 403 | `BOOKING_ACCESS_DENIED` (wrong token *or* unknown booking, deliberately indistinguishable) |
| 404 | `SERVICE_NOT_FOUND`, `SLOT_NOT_FOUND` |
| 409 | `SLOT_ALREADY_BOOKED`, `SLOT_UNAVAILABLE` (past/inactive), `IDEMPOTENCY_KEY_REUSED` |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE` (health check only) |

### `GET /api/health`

```json
{ "data": { "status": "ok", "database": "ok", "time": "2026-11-10T11:18:03.548Z" } }
```

### `GET /api/services`

```bash
curl http://localhost:3000/api/services
```

```json
{
  "data": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "Initial Physiotherapy Consultation",
      "description": "A 30-minute first visit: assessment of your condition, goals and a treatment plan.",
      "durationMinutes": 30,
      "active": true
    }
  ]
}
```

### `GET /api/slots?serviceId=…&date=YYYY-MM-DD`

`date` is a calendar day in **the provider's timezone**. Past, inactive and booked
slots are excluded.

Times are stored as `timestamptz` and returned twice: `startsAt`/`endsAt` in
ISO 8601 UTC (`Z`), and `startsAtLocal`/`endsAtLocal` in the provider's
timezone with its offset at that moment (e.g. `+01:00` CET, `+02:00` CEST).
Both denote the same instant. Use the local value for display, and the UTC
value for computation.

```bash
curl "http://localhost:3000/api/slots?serviceId=22222222-2222-4222-8222-222222222222&date=2026-11-12"
```

```json
{
  "data": [
    {
      "id": "6ccc258f-79dd-07cc-3aa5-a3e72c24610b",
      "serviceId": "22222222-2222-4222-8222-222222222222",
      "providerId": "11111111-1111-4111-8111-111111111111",
      "providerName": "Motion Studio",
      "providerTimezone": "Europe/Prague",
      "startsAt": "2026-11-12T08:00:00.000Z",
      "endsAt": "2026-11-12T08:30:00.000Z",
      "startsAtLocal": "2026-11-12T09:00:00+01:00",
      "endsAtLocal": "2026-11-12T09:30:00+01:00"
    }
  ]
}
```

### `POST /api/bookings`

```bash
curl -i -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3f0c9a3e-8d0e-4c43-9a51-2f7e3c1d9b10" \
  -d '{"slotId":"6ccc258f-79dd-07cc-3aa5-a3e72c24610b","guestName":"Jana Novakova"}'
```

`201 Created` (`Location: /api/bookings/<id>`), or `200 OK` with
`Idempotent-Replayed: true` for a retry:

```json
{
  "data": {
    "booking": {
      "id": "5e3d1753-029d-4093-820a-86127db983a8",
      "slotId": "6ccc258f-79dd-07cc-3aa5-a3e72c24610b",
      "serviceId": "22222222-2222-4222-8222-222222222222",
      "serviceName": "Initial Physiotherapy Consultation",
      "providerId": "11111111-1111-4111-8111-111111111111",
      "providerName": "Motion Studio",
      "providerTimezone": "Europe/Prague",
      "startsAt": "2026-11-12T08:00:00.000Z",
      "endsAt": "2026-11-12T08:30:00.000Z",
      "startsAtLocal": "2026-11-12T09:00:00+01:00",
      "endsAtLocal": "2026-11-12T09:30:00+01:00",
      "guestName": "Jana Novakova",
      "status": "confirmed",
      "createdAt": "2026-11-10T11:18:04.012Z"
    },
    "managementToken": "06jlcjuno0rETaxUEv5DJFMxrdE5Vy-SRuj-CbCL5Ps"
  }
}
```

Conflict:

```json
{ "error": { "code": "SLOT_ALREADY_BOOKED", "message": "Slot has already been booked" } }
```

### `GET /api/bookings/{id}`

The management token goes in the `Authorization` header, never in the URL.

```bash
curl http://localhost:3000/api/bookings/5e3d1753-029d-4093-820a-86127db983a8 \
  -H "Authorization: Bearer 06jlcjuno0rETaxUEv5DJFMxrdE5Vy-SRuj-CbCL5Ps"
```

`200` returns `{ "data": <booking> }` (same shape as above, never any hash),
`401` if the header is missing, and `403` if the token is wrong.

> On Windows Git Bash, curl may not send non-ASCII names (e.g. `Nováková`) as UTF-8.
> Use `--data-binary @body.json` with a UTF-8 file if you need diacritics.

## Testing

```bash
npm run db:start   # integration tests need the local database
npm test           # against the current local DB
npm run test:fresh # proves the DB can be recreated: db reset → all tests → demo data
```

`test:fresh` wipes the local database, including any bookings you made by hand.

Integration tests run against real PostgreSQL. They create isolated fixtures
(fresh providers and services) and delete them afterwards, and they read the
fixed seed window. They inject a fixed clock into the capability, so results
don't depend on today's date. Coverage includes service listing, slot retrieval,
booked/past/inactive exclusion, DST and day-boundary handling (Europe/Prague and
America/New_York), UTC storage plus Prague-local rendering on both sides of the
DST switch, successful booking, double-booking rejection, 20-way concurrent
booking races, concurrent idempotent retries, token rotation, authorized and
unauthorized retrieval, database constraints applied directly via SQL, Data-API
role lockdown, and the HTTP layer (status codes, headers, envelopes).

## Known limitations (M1)

- No cancellation endpoint yet. The `cancelled` status exists and frees the slot.
- Slot creation has no API. Slots come from seed functions or SQL; overlap is
  still prevented by the database.
- Slot duration isn't cross-checked against `services.duration_minutes`.
- No rate limiting on booking creation or token guessing (tokens have 256 bits of entropy).
