"use client";

import { JsonRenderDevtools } from "@json-render/devtools-react";
import { StateProvider } from "@json-render/react";
import type { BookingUIMessage } from "@/ai/booking-agent";
import { bookingCatalog } from "./catalog";

/**
 * json-render devtools panel (development only): inspect each generated spec,
 * the patch stream, actions and the catalog. Toggle with Ctrl/Cmd+Shift+J.
 *
 * Loaded through `next/dynamic` behind a NODE_ENV check (see BookingChat), so
 * production bundles never include it. Our specs use no json-render state;
 * the empty StateProvider only satisfies the panel's State tab.
 */
export default function GenUIDevtools({ messages }: { messages: BookingUIMessage[] }) {
  return (
    <StateProvider>
      <JsonRenderDevtools catalog={bookingCatalog} messages={messages} position="right" />
    </StateProvider>
  );
}
