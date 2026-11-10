import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "InstantBooking",
  description: "Booking in Action — capability-native booking engine",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
