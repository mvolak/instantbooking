import { connection } from "next/server";
import { getSql } from "@/infrastructure/db/client";
import { jsonData, jsonError } from "../_lib/http";

export async function GET() {
  await connection();
  try {
    await getSql()`select 1`;
    return jsonData({ status: "ok", database: "ok", time: new Date().toISOString() });
  } catch (error) {
    console.error("Health check failed", error);
    return jsonError(503, "SERVICE_UNAVAILABLE", "Database is unreachable");
  }
}
