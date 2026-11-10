import { createChatHandler } from "@/ai/chat-handler";
import { getBookingCapability } from "@/infrastructure/booking-capability";

/** Conversational booking agent (AI SDK UI message stream for `useChat`). */
export const POST = createChatHandler({ getCapability: getBookingCapability });
