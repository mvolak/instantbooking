import { connection } from "next/server";
import { getBookingCapability } from "@/infrastructure/booking-capability";
import { jsonData, respond } from "../_lib/http";

export async function GET() {
  await connection(); // always query at request time, never at build time
  return respond(async () => jsonData(await getBookingCapability().listServices()));
}
