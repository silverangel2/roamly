import CustomerBudgetChange from "@/components/roamly/CustomerBudgetChange";
import CustomerDateChange from "@/components/roamly/CustomerDateChange";
import CustomerDestinationChange from "@/components/roamly/CustomerDestinationChange";
import CustomerTripIntentChange from "@/components/roamly/CustomerTripIntentChange";

type CustomizeYourTripProps = {
  tripId: string;
  status: string;
  budgetAmount: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  destinationLabel: string;
  adults: number;
  childrenCount: number;
  infants: number;
  travelStyle: string;
  interests: string[];
  accommodationPreference: string;
  transportationPreference: string;
  pace: string;
  walkingTolerance: string;
  specialNotes: string;
};

export function CustomizeYourTrip(props: CustomizeYourTripProps) {
  if (["archived", "cancelled", "completed"].includes(props.status)) return null;
  const notes = props.specialNotes.trim();

  return (
    <section id="customize" className="roamly-no-print scroll-mt-28 rounded-[1.35rem] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(16,32,51,0.045)] sm:px-5 sm:py-5">
      <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-ink">Customize your trip</h2>
      <p className="mt-1 max-w-lg text-sm leading-6 text-slate-500">
        Tell us what to change — we’ll rebuild the parts that need it.
      </p>
      {notes ? (
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600">
          <span className="font-medium text-ink">Your notes. </span>
          {notes}
        </p>
      ) : (
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-500">
          No personal notes yet. Add them with travelers and preferences.
        </p>
      )}
      <div className="mt-4 grid max-w-lg gap-2">
        <CustomerBudgetChange tripId={props.tripId} currentAmount={props.budgetAmount} currency={props.currency} />
        <CustomerDateChange tripId={props.tripId} startDate={props.startDate} endDate={props.endDate} status={props.status} />
        <CustomerDestinationChange tripId={props.tripId} currentLabel={props.destinationLabel} status={props.status} />
        <CustomerTripIntentChange
          tripId={props.tripId}
          status={props.status}
          adults={props.adults}
          childrenCount={props.childrenCount}
          infants={props.infants}
          travelStyle={props.travelStyle}
          interests={props.interests}
          accommodationPreference={props.accommodationPreference}
          transportationPreference={props.transportationPreference}
          pace={props.pace}
          walkingTolerance={props.walkingTolerance}
          specialNotes={props.specialNotes}
        />
      </div>
      <p className="mt-3 max-w-lg text-[0.8125rem] leading-5 text-slate-400">
        On the itinerary, a flexible stop can be swapped or removed.
      </p>
    </section>
  );
}
