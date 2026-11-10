# InstantBooking

**Booking in Action.** A small, capability-native booking engine: one deterministic
booking capability, independent of the interfaces that will expose it (web, AI
conversations, generative UI, X, Microsoft Teams, …).

Milestones so far:

- **M1 — Foundation & Booking Engine:** persistence, the booking operations, a REST API and tests.
- **M2 — Content + Actionable Landing Page:** a landing page for the fictional
  *Motion Studio*. The page itself is the booking interface, built on the M1 REST API.
- **M3 — Conversational Booking Agent:** a chat panel on the landing page. An AI
  agent (Vercel AI SDK + AI Gateway) finds services and real availability in
  natural language and books through the same capability, only after the guest
  approves a server-validated booking card.

There is no authentication or external channel adapter yet.

## Stack

Node.js 24 · TypeScript (strict) · Next.js 16 App Router · React 19 · Tailwind CSS 4 ·
lucide-react · Supabase PostgreSQL · [postgres.js](https://github.com/porsager/postgres) · Zod 4 ·
Vercel AI SDK 7 (`ai`, `@ai-sdk/react`) via Vercel AI Gateway ·
Vitest + React Testing Library · Playwright

## Architecture

```text
src/
├── domain/booking/          # The capability. No Next.js, no SQL, no channel code.
│   ├── capability.ts        #   listServices · findAvailableDates · findAvailableSlots
│   │                        #   · getSlot · createBooking · getBooking
│   ├── types.ts             #   entities + BookingRepository port
│   ├── errors.ts            #   BookingError with channel-neutral codes
│   ├── tokens.ts            #   management token generation / hashing
│   └── time.ts              #   UTC → provider-local ISO 8601
├── schemas/booking.ts       # Zod input schemas shared by domain and adapters
├── infrastructure/
│   ├── db/client.ts         # server-only Postgres pool (DATABASE_URL)
│   ├── db/booking-repository.ts  # SQL implementation of the port
│   └── booking-capability.ts     # production wiring (repo + system clock)
├── ai/                      # Conversational adapter (M3) → capability
│   ├── booking-tools.ts     #   AI SDK tools, approval policy, input refinement
│   ├── booking-agent.ts     #   streamText turn → UI message stream
│   ├── booking-instructions.ts  # system prompt with an authoritative calendar
│   ├── chat-handler.ts      #   POST /api/chat: config, rate limit, validation, bounds
│   ├── secrets.ts           #   approval signing, idempotency keys, sealed credentials
│   └── calendar.ts · config.ts · rate-limit.ts
├── app/api/                 # REST adapter: thin Route Handlers → capability (+ /api/chat)
├── app/page.tsx             # landing page (static content + booking widget)
├── lib/booking-client.ts    # typed, framework-free client for the REST API
└── components/
    ├── landing/             # SiteHeader, LandingHero, ChatSection, HowItWorks, AboutStudio, SiteFooter
    ├── chat/                # BookingChat (useChat), BookingApproval, ToolActivity
    └── booking/             # BookingWidget, ServiceCard, DateSelector, AvailableSlots,
                             # GuestDetails, BookingConfirmation; booking-flow.ts = state machine
supabase/
├── migrations/              # schema, constraints, demo seed function
└── seed.sql                 # fixed, deterministic seed window
scripts/seed-demo.mts        # refresh demo data for upcoming dates
tests/
├── unit/                    # tokens, schemas, time, API client (no DB)
├── integration/             # real PostgreSQL: capability, concurrency, constraints, API,
│                            # agent (mock LLM + real DB), /api/chat handler
└── components/              # React Testing Library (jsdom) against a fake API / fake chat stream
e2e/                         # Playwright smoke tests (real build + real DB, desktop + mobile)
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

| `AI_GATEWAY_API_KEY` | for chat | Vercel AI Gateway key. On Vercel the deployment's OIDC token works instead. |
| `CHAT_SIGNING_SECRET` | for chat | ≥ 32 random chars (`openssl rand -base64 32`). Signs booking approvals, derives idempotency keys and seals booking credentials. Same value on every instance; rotating it invalidates pending approvals. |
| `BOOKING_AI_MODEL` | no | Gateway model id (default `anthropic/claude-haiku-5.5`, an economical tool-capable model). |

The app doesn't need Supabase API keys (anon/service role), because it talks to
Postgres directly. Without the two chat variables the chat panel answers
"not available" and everything else works as before. All of these are
server-side only; none is sent to the browser.

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
| `npm run test:e2e` | refresh demo data, build, run Playwright on desktop + mobile (first time: `npx playwright install chromium`) |
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

### `GET /api/availability?serviceId=…[&days=14]`

Added in M2. Returns free-slot counts per provider-local day, from today, for
`days` days (1–31, default 14). Days without availability are included with `0`.
The landing page uses this to open on the next bookable day; an AI agent can use
it to answer "when is the next free slot?".

```json
{ "data": [ { "date": "2026-11-10", "availableSlots": 0 }, { "date": "2026-11-11", "availableSlots": 12 } ] }
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

```bash
npm run test:e2e   # Playwright: builds the app, books real demo slots
```

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

Component tests (`tests/components`) render the booking widget against an
in-memory fake of the REST API at the `fetch` level, so the real client and the
real UI are tested together. They cover service loading, date defaulting and
selection, stale-response protection, local-time slot rendering, empty and error
states, name validation (client and server), successful booking, double-submit
prevention, idempotency-key reuse on retry, conflict recovery, confirmation
details taken from the server, keyboard-only booking and accessible labelling.

The Playwright smoke test (`e2e/`) runs on a desktop and a mobile viewport. It
books a real slot, races a real conflicting booking through the API, checks that
the management token never reaches the URL, page or storage, and checks that
nothing overflows the viewport. The chat e2e tests answer `/api/chat` with a
scripted stream, so they check the browser UI without calling a model.

Agent tests (`tests/integration/booking-agent.test.ts`) drive the real agent with
the AI SDK's `MockLanguageModelV4`, scripted turn by turn, against the real
database and a fixed clock. **No test calls a paid LLM.** They cover service
discovery, Thursday-afternoon lookup with Prague-local times, the calendar the
model receives, follow-up context, empty days, past/out-of-horizon dates,
malformed tool arguments, a missing name, approval required / rejected /
approved, server-filled review details, conflicts before and during approval,
idempotent retries of an approved call, tampered and forged approvals,
session-scoped `getBooking` (including forged credentials) and model failures.
`tests/integration/chat-route.test.ts` covers the HTTP side: streaming
headers, 503 without configuration, rate limiting, input validation, history
bounds and safe errors.

## Landing page and booking widget (M2)

- **Visible straight away:** the widget sits in the hero, beside the copy on
  desktop and right under it on mobile.
- **Live data:** service, dates and times all come from the API. The widget
  opens on the next date with free times, and full days are disabled.
- **Local times:** times are shown in the provider's timezone (from
  `startsAtLocal`), not the visitor's browser timezone.
- **Predictable state:** `booking-flow.ts` is a pure reducer. Requests for an
  old date are cancelled and stale responses are ignored.
- **Safe booking:** each attempt (slot + name) gets an idempotency key. A retry
  after a network or server error reuses the key, so it can't double-book. A
  synchronous guard and a disabled button stop double clicks.
- **Conflicts:** a 409 shows a notice, keeps the name, and reloads availability.
- **Token handling:** the management token returned by the API is dropped
  straight away. It is never stored, logged, shown or put in a URL. The
  reference shown is the first 8 characters of the booking id; it grants no
  access.

## Conversational booking agent (M3)

The chat panel (`#chat`, below the hero) uses `useChat()`, which talks to
`POST /api/chat`. That route runs `streamText()` with five tools. Each tool is a
thin adapter over `BookingCapability` and is called in-process, not over HTTP:

| Tool | Domain operation | Notes |
|---|---|---|
| `listServices` | `listServices` | |
| `findAvailableDates` | `findAvailableDates` | free-slot counts per day, to find "the next free appointment" |
| `findAvailableSlots` | `findAvailableSlots` | `date` (YYYY-MM-DD) plus an optional `from`/`to` local time window; rejects past dates and dates beyond 31 days; empty days suggest other days |
| `createBooking` | `getSlot` + `createBooking` | **approval-gated**, see below |
| `getBooking` | `getBooking` | only bookings made in this conversation |

The LLM interprets language and chooses read operations. All validation,
availability, concurrency and authorization stay in the domain and database.

**Dates.** The system prompt gives the model the current Prague date and time
from the server clock, plus an explicit 14-day list of weekday → date. "Thursday"
is resolved from that list rather than computed by the model. Ambiguous dates
make it ask. Tools validate the date range on the server.

**Booking approval.** `createBooking` uses the AI SDK's native tool approval
(`toolApproval`), so it cannot execute until the guest presses **Confirm
booking**:

1. The model proposes `{ slotId, guestName }`.
2. `experimental_refineToolInput` looks the slot up through `getSlot` and fills
   in a `review`: service, provider, date, time and timezone. Whatever the model
   wrote there is overwritten, so the card the guest sees comes from the server.
3. If the slot is already gone, the request is denied up front. Otherwise the
   guest gets an approval card.
4. The approval request is HMAC-signed (`experimental_toolApprovalSecret`) over
   the tool call id and the exact refined input (slot, name, service, time).
   When the approval comes back, the signature is verified and the input
   re-derived. A forged approval, or one whose details were edited in the
   browser, is rejected before anything executes. There is a test for each case.
5. On execution, the idempotency key is `HMAC(secret, toolCallId)`. It is
   generated by the server, never taken from the model. A retried or replayed
   approval therefore replays the same booking instead of creating a second
   one. A tool call that already has a result is never executed again.
6. Conflicts come back as `slot_unavailable` from the database's uniqueness
   guarantee. The agent then explains and offers to search again.

**Credentials.** The management token never reaches the model, logs or the
screen. The server seals it with AES-256-GCM into the tool result, and
`toModelOutput` strips it from what the model sees. The browser holds it only in
the in-memory conversation. `getBooking` accepts a booking reference and
authorizes only through such sealed credentials from the current conversation,
so other bookings are unreachable. A reference alone grants nothing.

**Limits.**
- 20 requests per minute per IP.
- At most 6 model steps and 8 tool executions per request.
- At most 1,024 output tokens per reply.
- Only the last 30 messages are sent to the model.
- A message can be at most 2,000 characters, and a request body at most 200 KB.
- Client-supplied `system` messages are rejected.
- Errors shown to visitors are generic; details go to server logs only.

### Manual test script

With `AI_GATEWAY_API_KEY` and `CHAT_SIGNING_SECRET` in `.env.local`, run
`npm run db:seed:demo`, then `npm run dev`, and open the chat:

1. "What kind of appointments do you offer?" lists the consultation, 30 min.
2. "Do you have anything on Thursday afternoon?" gives real times after 12:00
   for the coming Thursday. Compare them with the booking form above.
3. "What about Friday instead?" uses the same service and the afternoon again.
4. "Book the 16:30" (or any listed time) makes the agent ask for your name.
5. Give a name. A confirmation card appears and nothing is booked yet: the time
   is still free in the form after reloading the form's date.
6. Press **Cancel**. Nothing is booked, and the agent doesn't retry.
7. Ask again and press **Confirm booking**. The card shows a reference and
   "Confirmed", and the time disappears from the booking form.
8. Conflict: prepare a booking card, book the same time with the form in
   another tab, then confirm in the chat. You get "no longer available" and an
   offer to search again.
9. "What did I book?" returns the booking. Asking for another reference gets a
   refusal.
10. Without the env variables, the chat says the assistant is unavailable and
    the form still works.

## Known limitations

- No cancellation endpoint yet. The `cancelled` status exists and frees the slot.
- Slot creation has no API. Slots come from seed functions or SQL; overlap is
  still prevented by the database.
- Slot duration isn't cross-checked against `services.duration_minutes`.
- No rate limiting on booking creation or token guessing (tokens have 256 bits of entropy).
- Because the management token is discarded, guests can't view or manage a
  booking after leaving the page. Booking management is out of scope for M2.
- Page content is static; only the booking data is live.
- **Chat (M3):**
  - **Anonymous bookings:** anyone can book under any name. There is no
    verification and no contact channel. Booking access lasts only for the
    conversation, and reloading the page loses it.
  - **Client-held history:** the conversation lives in the browser and is
    resent on every turn. Bookings are protected by the signed approvals, but a
    modified client can feed fake history to its own session's model, which
    only misleads that visitor.
  - **Rate limiting:** the rate limiter is in memory, so it applies per server
    instance. Use a shared store (e.g. Redis) in production.
  - **Signing secret:** rotating `CHAT_SIGNING_SECRET` invalidates approvals
    still pending in open chats.
  - **Model behaviour:** a model can still phrase things badly, so treat
    language quality as best-effort. The booking card and confirmation always
    come from the server, so the agent cannot make a booking or a
    confirmation appear unless the database actually made it.
  - **Scope:** English only; no conversation persistence.
  - **No live-model CI:** automated tests use a mock model. The real model is
    exercised manually with the script above.
