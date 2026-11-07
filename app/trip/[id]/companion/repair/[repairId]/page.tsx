import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BackHeader } from "@/components/roamly/BackHeader";
import { RepairReviewActions } from "@/components/trip/RepairReviewActions";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";

type PageParams = {
  params: Promise<{ id: string; repairId: string }>;
};

type ShiftView = {
  title: string;
  beforeStart: string;
  beforeEnd: string;
  afterStart: string;
  afterEnd: string;
  shiftMinutes: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clockOf(value: string): string {
  if (!value) return "—";
  const iso = value.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  return value;
}

function dateOf(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "";
}

function shiftDirection(minutes: number): string {
  if (minutes > 0) return "later";
  if (minutes < 0) return "earlier";
  return "";
}

export default async function RepairReviewPage({ params }: PageParams) {
  const { id, repairId } = await params;

  const current = await getCurrentUser();
  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/companion/repair/${repairId}`)}`);
  }
  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const proposalResult = await supabase
    .from("companion_repair_proposals")
    .select("*")
    .eq("id", repairId)
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .maybeSingle();

  const proposal = proposalResult.data ? record(proposalResult.data) : null;

  let eventTitle = "";
  let eventSummary = "";
  if (proposal) {
    const eventResult = await supabase
      .from("companion_events")
      .select("title,summary")
      .eq("id", String(proposal.companion_event_id || ""))
      .eq("trip_id", id)
      .eq("user_id", current.user.id)
      .maybeSingle();
    if (eventResult.data) {
      eventTitle = String(record(eventResult.data).title || "");
      eventSummary = String(record(eventResult.data).summary || "");
    }
  }

  const shifts: ShiftView[] = proposal
    ? (Array.isArray(proposal.proposed_changes_json) ? proposal.proposed_changes_json : [])
        .map(record)
        .filter((action) => String(action.action_type) === "SHIFT_ACTIVITY_TIMING")
        .map((action) => {
          const before = record(action.before);
          const after = record(action.after);
          return {
            title: String(after.title || before.title || "Planned stop"),
            beforeStart: String(before.start || ""),
            beforeEnd: String(before.end || ""),
            afterStart: String(after.new_start || ""),
            afterEnd: String(after.new_end || ""),
            shiftMinutes: typeof after.shift_minutes === "number" ? after.shift_minutes : 0
          };
        })
    : [];

  const status = proposal ? String(proposal.status || "") : "";
  const decided = ["applied", "rejected", "failed"].includes(status);
  const shiftMinutes = shifts.length ? shifts[0].shiftMinutes : 0;

  return (
    <div className="safe-bottom mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <BackHeader href={`/trip/${id}`} label="Trip" />
      </div>
      <section className="bui-enter overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-5 text-chead shadow-bui-hero sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Trip repair review</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-chead sm:text-4xl">
          {decided
            ? status === "applied"
              ? "Your plan was updated."
              : status === "rejected"
                ? "Original plan kept."
                : "This repair could not be applied."
            : "Your flight time changed."}
        </h1>
        <p className="mt-3 text-sm font-bold leading-6 text-cink">
          {eventTitle || "Roamly detected a flight schedule change."}{" "}
          {eventSummary ||
            "Times below come from the airline's updated schedule — Roamly never invents new times."}
        </p>
      </section>

      {!proposal ? (
        <BuiCard className="bui-enter mt-5 p-5">
          <h2 className="text-2xl font-black text-chead">Repair not found.</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-cink">
            This repair proposal does not exist or belongs to another trip.
          </p>
          <div className="mt-5">
            <BuiButtonLink href={`/trip/${id}/live`}>Open live trip</BuiButtonLink>
          </div>
        </BuiCard>
      ) : (
        <section className="mt-5">
          <BuiCard className="bui-enter p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">
              Proposed timing changes
            </p>
            {shifts.length === 0 ? (
              <p className="mt-3 text-sm font-bold text-cink">
                No timing shifts are attached to this proposal.
              </p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {shifts.map((shift, index) => (
                  <li
                    key={`${shift.title}-${index}`}
                    className="bui-enter rounded-bui-card border border-chair bg-white px-4 py-3 shadow-bui-card"
                    style={{ "--bui-delay": `${Math.min(index * 60, 240)}ms` } as CSSProperties}
                  >
                    <p className="text-sm font-black text-chead">{shift.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="bui-display-number rounded-lg bg-cbg px-2.5 py-1 font-bold text-cgray line-through">
                        {clockOf(shift.beforeStart)}
                        {shift.beforeEnd ? `–${clockOf(shift.beforeEnd)}` : ""}
                      </span>
                      <ArrowRight aria-hidden="true" size={16} strokeWidth={2.5} className="text-cblue" />
                      <span className="bui-display-number rounded-lg bg-csoft px-2.5 py-1 font-black text-cnavy">
                        {clockOf(shift.afterStart)}
                        {shift.afterEnd ? `–${clockOf(shift.afterEnd)}` : ""}
                      </span>
                      <span className="bui-display-number text-xs font-black uppercase tracking-wide text-cgray2">
                        {shift.shiftMinutes !== 0
                          ? `${Math.abs(shift.shiftMinutes)} min ${shiftDirection(shift.shiftMinutes)}`
                          : ""}
                        {dateOf(shift.afterStart) ? ` · ${dateOf(shift.afterStart)}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs font-bold leading-5 text-cgray">
              Only the airline&apos;s validated schedule change is applied —{" "}
              {shiftMinutes !== 0
                ? `a ${Math.abs(shiftMinutes)}-minute shift ${shiftDirection(shiftMinutes)}`
                : "matching the new flight time"}
              . Reservations keep their booked times; nothing is purchased, cancelled, or rebooked.
            </p>

            {decided ? (
              <div className="mt-5">
                <BuiButtonLink href={`/trip/${id}/live`}>Open live trip</BuiButtonLink>
              </div>
            ) : (
              <RepairReviewActions tripId={id} repairId={repairId} />
            )}
          </BuiCard>
        </section>
      )}
    </div>
  );
}
