import { redirect } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
      <section className="rounded-[2rem] border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#ffffff_56%,#fff7ed_100%)] p-5 text-ink shadow-soft sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Trip repair review</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-4xl">
          {decided
            ? status === "applied"
              ? "Your plan was updated."
              : status === "rejected"
                ? "Original plan kept."
                : "This repair could not be applied."
            : "Your flight time changed."}
        </h1>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-600">
          {eventTitle || "Roamly detected a flight schedule change."}{" "}
          {eventSummary ||
            "Times below come from the airline's updated schedule — Roamly never invents new times."}
        </p>
      </section>

      {!proposal ? (
        <Card>
          <h2 className="text-2xl font-black text-ink">Repair not found.</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            This repair proposal does not exist or belongs to another trip.
          </p>
          <div className="mt-5">
            <Button href={`/trip/${id}/live`}>Open live trip</Button>
          </div>
        </Card>
      ) : (
        <section className="mt-5">
          <Card>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
              Proposed timing changes
            </p>
            {shifts.length === 0 ? (
              <p className="mt-3 text-sm font-bold text-slate-600">
                No timing shifts are attached to this proposal.
              </p>
            ) : (
              <ul className="mt-4 grid gap-3">
                {shifts.map((shift, index) => (
                  <li
                    key={`${shift.title}-${index}`}
                    className="rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
                  >
                    <p className="text-sm font-black text-ink">{shift.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold text-slate-500 line-through">
                        {clockOf(shift.beforeStart)}
                        {shift.beforeEnd ? `–${clockOf(shift.beforeEnd)}` : ""}
                      </span>
                      <span aria-hidden className="font-black text-ocean">→</span>
                      <span className="rounded-lg bg-ocean/10 px-2.5 py-1 font-black text-ocean">
                        {clockOf(shift.afterStart)}
                        {shift.afterEnd ? `–${clockOf(shift.afterEnd)}` : ""}
                      </span>
                      <span className="text-xs font-black uppercase tracking-wide text-slate-400">
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
            <p className="mt-4 text-xs font-bold leading-5 text-slate-500">
              Only the airline&apos;s validated schedule change is applied —{" "}
              {shiftMinutes !== 0
                ? `a ${Math.abs(shiftMinutes)}-minute shift ${shiftDirection(shiftMinutes)}`
                : "matching the new flight time"}
              . Reservations keep their booked times; nothing is purchased, cancelled, or rebooked.
            </p>

            {decided ? (
              <div className="mt-5">
                <Button href={`/trip/${id}/live`}>Open live trip</Button>
              </div>
            ) : (
              <RepairReviewActions tripId={id} repairId={repairId} />
            )}
          </Card>
        </section>
      )}
    </div>
  );
}
