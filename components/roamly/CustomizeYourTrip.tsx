import { BuiCard } from "@/components/boardui/Card";
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
    <BuiCard id="customize" className="roamly-no-print scroll-mt-28 px-5 py-6 sm:px-6 sm:py-7">
      <h2 className="text-[1.45rem] font-semibold tracking-[-0.03em] text-ink">Customize your trip</h2>
      <p className="mt-1.5 max-w-md text-[0.9375rem] leading-6 text-cgray">
        Tell us what to change — we’ll rebuild the parts that need it.
      </p>
      {notes ? (
        <p className="mt-4 max-w-md text-sm leading-6 text-cgray">
          <span className="font-medium text-ink">Your notes. </span>
          {notes}
        </p>
      ) : null}
      <div className="mt-5 overflow-hidden rounded-bui-card bg-csoft">
        <div className="divide-y divide-chair">
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
      </div>
      <p className="mt-4 max-w-md text-[0.8125rem] leading-5 text-cgray2">
        On the itinerary, a flexible stop can be swapped or removed.
      </p>
    </BuiCard>
  );
}
