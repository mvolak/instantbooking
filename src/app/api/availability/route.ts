import type { NextRequest } from "next/server";
import { getBookingCapability } from "@/infrastructure/booking-capability";
import { jsonData, respond } from "../_lib/http";

const DEFAULT_DAYS = 14;

/**
 * GET /api/availability?serviceId=<uuid>[&days=14]
 * Free-slot counts per provider-local day, from today, for `days` days (1–31).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawDays = params.get("days");
  return respond(async () =>
    jsonData(
      await getBookingCapability().findAvailableDates(
        params.get("serviceId") ?? "",
        rawDays === null ? DEFAULT_DAYS : Number(rawDays),
      ),
    ),
  );
}
