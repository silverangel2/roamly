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
    <section id="customize" className="roamly-no-print scroll-mt-28 rounded-[1.5rem] border border-[#e8dfd0] bg-white px-4 py-4 shadow-[0_12px_34px_rgba(16,32,51,0.05)] sm:px-5 sm:py-5">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Your trip</p>
      <h2 className="mt-1 text-xl font-black tracking-tight text-ink sm:text-2xl">Customize your trip</h2>
      <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
        Tell us what to change — we’ll rebuild the parts that need it.
      </p>
      {notes ? (
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">
          <span className="font-black text-ink">Your notes. </span>
          {notes}
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          No personal notes yet. Add them with travelers and preferences.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-2">
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
      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
        On the itinerary, a flexible stop can be swapped or removed.
      </p>
    </section>
  );
}
