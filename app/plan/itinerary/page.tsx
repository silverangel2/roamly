import { GuestFreeItinerary } from "@/components/plan/GuestFreeItinerary";

export default function GuestItineraryPage() {
  return (
    <div className="safe-bottom bui-enter min-w-0 bg-cbg">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
        <GuestFreeItinerary />
        <div className="h-24 md:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
