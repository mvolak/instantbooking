import { BookingWidget } from "@/components/booking/BookingWidget";
import { AboutStudio } from "@/components/landing/AboutStudio";
import { ChatSection } from "@/components/landing/ChatSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingHero } from "@/components/landing/LandingHero";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <LandingHero booking={<BookingWidget />} />
        <ChatSection />
        <HowItWorks />
        <AboutStudio />
      </main>
      <SiteFooter />
    </>
  );
}
