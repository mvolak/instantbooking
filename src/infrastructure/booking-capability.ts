import "server-only";
import { createBookingCapability, type BookingCapability } from "@/domain/booking";
import { createBookingRepository } from "./db/booking-repository";
import { getSql } from "./db/client";

let capability: BookingCapability | undefined;

/** The production-wired booking capability (Postgres + system clock). */
export function getBookingCapability(): BookingCapability {
  capability ??= createBookingCapability({ repository: createBookingRepository(getSql()) });
  return capability;
}
