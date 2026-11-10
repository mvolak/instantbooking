import { afterAll, describe, expect, it } from "vitest";
import { capabilityAt, createTestSql, SEED } from "../helpers/db";

const sql = createTestSql(2);
afterAll(() => sql.end());

// Before the seed window, so every seed slot is in the future.
const capability = capabilityAt(sql, "2026-03-20T12:00:00Z");

describe("seed data (fixed window 2026-03-23 – 2026-04-03)", () => {
  it("contains Motion Studio and the consultation service", async () => {
    const [provider] = await sql`select display_name, timezone, active from public.providers where id = ${SEED.providerId}`;
    expect(provider).toEqual({ display_name: "Motion Studio", timezone: "Europe/Prague", active: true });

    const services = await capability.listServices();
    expect(services).toContainEqual(
      expect.objectContaining({
        id: SEED.serviceId,
        name: "Initial Physiotherapy Consultation",
        durationMinutes: 30,
        active: true,
      }),
    );
  });

  it("has ten working days of 14 slots and six occupied slots", async () => {
    const [counts] = await sql<{ slots: number; days: number; booked: number }[]>`
      select count(*)::int as slots,
             count(distinct (starts_at at time zone 'Europe/Prague')::date)::int as days,
             count(*) filter (where exists (
               select 1 from public.bookings b where b.slot_id = s.id and b.status = 'confirmed'
             ))::int as booked
      from public.slots s
      where provider_id = ${SEED.providerId}
        and starts_at >= '2026-03-23 00:00 Europe/Prague' and starts_at < '2026-04-04 00:00 Europe/Prague'
    `;
    expect(counts).toEqual({ slots: 140, days: 10, booked: 6 });
  });

  it("is repeatable without creating duplicates", async () => {
    const [{ result }] = await sql`select internal.seed_demo_data(${SEED.firstDay}::date) as result`;
    expect(result).toEqual({ firstDay: SEED.firstDay, lastDay: SEED.lastDay, slotsInserted: 0, bookingsInserted: 0 });
  });

  it("returns slots in UTC, honouring CET before and CEST after the DST switch", async () => {
    // Mon 2026-03-23 is CET (UTC+1): 09:00 local = 08:00Z. 09:00 and 10:30 are booked.
    const monday = await capability.findAvailableSlots(SEED.serviceId, "2026-03-23");
    expect(monday).toHaveLength(12);
    expect(monday[0].startsAt).toBe("2026-03-23T08:30:00.000Z");
    expect(monday.map((s) => s.startsAt)).not.toContain("2026-03-23T08:00:00.000Z");
    expect(monday.map((s) => s.startsAt)).not.toContain("2026-03-23T09:30:00.000Z");
    expect(monday.at(-1)?.startsAt).toBe("2026-03-23T15:30:00.000Z");

    // Mon 2026-03-30 is CEST (UTC+2): 09:00 local = 07:00Z. Nothing booked.
    const nextMonday = await capability.findAvailableSlots(SEED.serviceId, "2026-03-30");
    expect(nextMonday).toHaveLength(14);
    expect(nextMonday[0]).toMatchObject({
      startsAt: "2026-03-30T07:00:00.000Z",
      endsAt: "2026-03-30T07:30:00.000Z",
      providerName: "Motion Studio",
      providerTimezone: "Europe/Prague",
    });
    expect(nextMonday.at(-1)?.startsAt).toBe("2026-03-30T14:30:00.000Z");

    // Weekend: no slots.
    expect(await capability.findAvailableSlots(SEED.serviceId, "2026-03-28")).toEqual([]);
  });

  it("stores UTC and displays the same Prague-local schedule on both sides of the DST switch", async () => {
    const localTimes = (slots: { startsAtLocal: string }[]) => slots.map((s) => s.startsAtLocal.slice(11));
    const expectedDay = [
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
      "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
    ];

    // CEST week (nothing booked on Mon 30 March): UTC is 07:00–14:30, local is 09:00–16:30.
    const cest = await capability.findAvailableSlots(SEED.serviceId, "2026-03-30");
    expect(localTimes(cest)).toEqual(expectedDay.map((t) => `${t}:00+02:00`));
    expect(cest[0]).toMatchObject({
      startsAt: "2026-03-30T07:00:00.000Z",
      startsAtLocal: "2026-03-30T09:00:00+02:00",
      endsAtLocal: "2026-03-30T09:30:00+02:00",
    });

    // CET week (Fri 27 March, nothing booked): UTC is 08:00–15:30, local is still 09:00–16:30.
    const cet = await capability.findAvailableSlots(SEED.serviceId, "2026-03-27");
    expect(localTimes(cet)).toEqual(expectedDay.map((t) => `${t}:00+01:00`));
    expect(cet[0]).toMatchObject({ startsAt: "2026-03-27T08:00:00.000Z", startsAtLocal: "2026-03-27T09:00:00+01:00" });

    // Every UTC value and its local rendering denote the same instant.
    for (const slot of [...cet, ...cest]) {
      expect(slot.startsAt.endsWith("Z")).toBe(true);
      expect(new Date(slot.startsAtLocal).toISOString()).toBe(slot.startsAt);
      expect(new Date(slot.endsAtLocal).toISOString()).toBe(slot.endsAt);
    }
  });

  it("excludes slots that are already in the past", async () => {
    const midMorning = capabilityAt(sql, "2026-03-23T08:45:00Z"); // 09:45 in Prague
    const slots = await midMorning.findAvailableSlots(SEED.serviceId, "2026-03-23");
    expect(slots[0].startsAt).toBe("2026-03-23T09:00:00.000Z");
    expect(slots).toHaveLength(11);

    const afterWindow = capabilityAt(sql, "2026-05-01T00:00:00Z");
    expect(await afterWindow.findAvailableSlots(SEED.serviceId, "2026-03-30")).toEqual([]);
  });
});
