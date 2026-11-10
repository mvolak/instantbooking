import { getBookingCapability } from "@/infrastructure/booking-capability";
import { bearerToken, jsonData, respond } from "../../_lib/http";

/**
 * GET /api/bookings/{id}
 * Headers: Authorization: Bearer <managementToken>
 */
export async function GET(request: Request, ctx: RouteContext<"/api/bookings/[id]">) {
  const { id } = await ctx.params;
  return respond(async () => jsonData(await getBookingCapability().getBooking(id, bearerToken(request))));
}
