import type { NextRequest } from "next/server";
import { getBookingCapability } from "@/infrastructure/booking-capability";
import { jsonData, respond } from "../_lib/http";

/** GET /api/slots?serviceId=<uuid>&date=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return respond(async () =>
    jsonData(
      await getBookingCapability().findAvailableSlots(params.get("serviceId") ?? "", params.get("date") ?? ""),
    ),
  );
}
