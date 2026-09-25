import { GuestFreeItinerary } from "@/components/plan/GuestFreeItinerary";

export default function GuestItineraryPage() {
  return (
    <div className="safe-bottom min-w-0 bg-[#fbf8ef]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
        <GuestFreeItinerary />
        <div className="h-24 md:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
