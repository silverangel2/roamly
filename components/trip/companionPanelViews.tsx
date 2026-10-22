/*
 * Build 2 Live Companion — panel v2 presentational views
 * (DESIGN-PRODUCTION.md Phase 7). Pure components over the
 * companionPanel.ts view models; the interactive client
 * (CompanionPanel.tsx) and the Phase 7 render harness render THESE
 * components, so what is measured is what ships.
 *
 * Owner scale law (BUILD2-SPEC §4.2, accepted renders): push <= 110px
 * tall at 358px wide, pinned strip <= 112px, compact rows <= 88px,
 * collapsed lines slim. Map choices live behind ONE Directions
 * control opening the chooser sheet — never button rows.
 */
import Image from "next/image";
import { ROAMLY_ICON_PATH } from "@/lib/roamly/companionPanel";
import type {
  ActivityDetailView,
  CompactPushView,
  CompactRowView,
  CompactStripView,
  DirectionsControl,
  PanelAction,
  WalletPassView
} from "@/lib/roamly/companionPanel";

export type PanelActionHandler = (action: PanelAction, itemId: string | null) => void;

const noop: PanelActionHandler = () => {};

/* ------------------------------------------------------------------ */
/* Push card (the collapsed OS-style notification)                     */
/* ------------------------------------------------------------------ */

export function CompanionPushCardView({
  push,
  onAction = noop
}: {
  push: CompactPushView;
  onAction?: PanelActionHandler;
}) {
  return (
    <article
      data-measure="push"
      className="mx-auto grid w-[358px] max-w-full grid-cols-[34px_1fr] gap-[9px] rounded-[22px] bg-white/95 px-[11px] py-[9px] shadow-[0_14px_34px_rgba(10,40,30,0.28)]"
    >
      <Image
        src={ROAMLY_ICON_PATH}
        alt="Roamly"
        width={34}
        height={34}
        className="h-[34px] w-[34px] rounded-[9px] object-contain"
      />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#5d726c]">
          <span>Roamly</span>
          <span className="font-semibold normal-case tracking-normal">{push.ageLabel}</span>
        </div>
        <p className="mt-[2px] line-clamp-2 text-[14px] font-semibold leading-[1.18] text-ink">
          {push.headline}
        </p>
        <p className="mt-[3px] truncate text-[12px] leading-[1.25] text-[#44605a]">
          {push.practicalLine}
        </p>
        <div className="mt-[4px] flex gap-[14px] text-[11.5px] font-bold leading-[1.2] text-ocean">
          {push.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onAction(action.id, push.itemId)}
              className="whitespace-nowrap"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Pinned strip                                                        */
/* ------------------------------------------------------------------ */

function StripActions({
  strip,
  onAction
}: {
  strip: CompactStripView;
  onAction: PanelActionHandler;
}) {
  return (
    <div className="mt-[7px] flex gap-[8px]">
      {strip.checkIn ? (
        strip.checkIn.mode === "available" ? (
          <button
            type="button"
            onClick={() => onAction("check-in", strip.itemId)}
            className="inline-flex h-8 items-center justify-center rounded-[10px] bg-ocean px-3 text-[12.5px] font-bold text-white"
          >
            Check in
          </button>
        ) : (
          <span className="inline-flex h-8 items-center justify-center rounded-[10px] border-[1.5px] border-[#c4d6d0] px-3 text-[12.5px] font-semibold text-[#7a8f88]">
            {strip.checkIn.label}
          </span>
        )
      ) : null}
      {strip.directions ? (
        <button
          type="button"
          onClick={() => onAction("directions", strip.itemId)}
          className="inline-flex h-8 items-center justify-center rounded-[10px] border-[1.5px] border-ocean px-3 text-[12.5px] font-bold text-ocean"
        >
          Directions
        </button>
      ) : null}
      {strip.skip ? (
        <button
          type="button"
          onClick={() => onAction("skip", strip.itemId)}
          className="inline-flex h-8 items-center justify-center rounded-[10px] border-[1.5px] border-[#c4d6d0] px-3 text-[12.5px] font-semibold text-ink"
        >
          Skip
        </button>
      ) : null}
    </div>
  );
}

export function CompanionStripView({
  strip,
  onAction = noop
}: {
  strip: CompactStripView;
  onAction?: PanelActionHandler;
}) {
  return (
    <section
      data-measure="strip"
      className="mx-auto w-[358px] max-w-full overflow-hidden rounded-[18px] border border-[#dce7e3] bg-white px-3 py-[6px] shadow-[0_8px_22px_rgba(13,60,45,0.13)]"
    >
      <div className="flex items-baseline justify-between text-[10.5px] font-extrabold uppercase leading-none tracking-[0.05em] text-ocean">
        <span>{strip.stateLabel}</span>
      </div>
      <h2 className="mt-[2px] truncate text-[15.5px] font-bold leading-[1.16] text-ink">
        {strip.name}
      </h2>
      <p className="mt-[2px] truncate text-[12px] leading-[1.2] text-[#44605a]">
        {strip.leaveByLine}
      </p>
      <StripActions strip={strip} onAction={onAction} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Compact rows + slim collapsed lines                                 */
/* ------------------------------------------------------------------ */

export function CompanionSlimLineView({
  line,
  affordances,
  itemId,
  onAction = noop
}: {
  line: string;
  affordances: PanelAction[];
  itemId: string | null;
  onAction?: PanelActionHandler;
}) {
  return (
    <div
      data-measure="slim"
      className="mx-auto flex h-10 w-[358px] max-w-full items-center gap-2 rounded-xl border border-[#dce7e3] bg-[#eef6f2] px-[11px] text-[12.5px]"
    >
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ocean text-[12px] font-extrabold text-white">
        ✓
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{line}</span>
      {affordances.includes("undo") ? (
        <button
          type="button"
          onClick={() => onAction("undo", itemId)}
          className="shrink-0 text-[11.5px] font-bold text-ocean"
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}

export function CompanionRowView({
  row,
  onAction = noop
}: {
  row: CompactRowView;
  onAction?: PanelActionHandler;
}) {
  if (row.mode === "slim") {
    return (
      <CompanionSlimLineView
        line={row.line || row.name}
        affordances={row.affordances}
        itemId={row.itemId}
        onAction={onAction}
      />
    );
  }
  const warn = row.state === "leave-by" || row.state === "collision";
  const timeHead = row.timeLabel.split("·")[0].trim();
  return (
    <article
      data-measure="row"
      className="mx-auto w-[358px] max-w-full overflow-hidden rounded-2xl border border-[#dce7e3] bg-white px-[11px] py-[7px]"
    >
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-[12px] font-extrabold text-ocean">{timeHead}</span>
        <h3 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold leading-[1.2] text-ink">
          {row.name}
        </h3>
        {warn ? (
          <span className="shrink-0 rounded-full bg-[#fff0d9] px-[6px] py-[2px] text-[9.5px] font-extrabold uppercase tracking-[0.04em] text-[#8a5a00]">
            {row.state === "collision" ? "Heads up" : "Leave by"}
          </span>
        ) : row.state === "current" ? (
          <span className="shrink-0 rounded-full bg-[#e2f2ec] px-[6px] py-[2px] text-[9.5px] font-extrabold uppercase tracking-[0.04em] text-ocean">
            Now
          </span>
        ) : null}
      </div>
      <p className="mt-[2px] truncate text-[12px] leading-[1.25] text-[#44605a]">{row.statusLine}</p>
      <div className="mt-[5px] flex items-center gap-[7px]">
        {row.checkIn ? (
          row.checkIn.mode === "available" ? (
            <button
              type="button"
              onClick={() => onAction("check-in", row.itemId)}
              className="inline-flex h-[27px] items-center justify-center rounded-[9px] bg-ocean px-[10px] text-[11.5px] font-bold text-white"
            >
              Check in
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-[#7a8f88]">{row.checkIn.label}</span>
          )
        ) : null}
        {row.directions ? (
          <button
            type="button"
            onClick={() => onAction("directions", row.itemId)}
            className="inline-flex h-[27px] items-center justify-center rounded-[9px] border-[1.5px] border-[#c4d6d0] px-[10px] text-[11.5px] font-semibold text-ink"
          >
            Directions
          </button>
        ) : null}
        {row.skip ? (
          <button
            type="button"
            onClick={() => onAction("skip", row.itemId)}
            className="inline-flex h-[27px] items-center justify-center rounded-[9px] border-[1.5px] border-ocean px-[10px] text-[11.5px] font-bold text-ocean"
          >
            Skip
          </button>
        ) : null}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Directions chooser (a sheet OVER the panel — the panel behind it    */
/* is unchanged; returning restores the identical item)                */
/* ------------------------------------------------------------------ */

export function DirectionsChooserView({
  control,
  placeName,
  onClose
}: {
  control: DirectionsControl;
  placeName: string;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-x-4 bottom-[14px] rounded-[20px] bg-white px-[14px] pb-3 pt-[10px] shadow-[0_18px_44px_rgba(10,40,30,0.30)]">
      <div className="mx-auto mb-2 h-1 w-[38px] rounded-full bg-[#d5e2dd]" />
      <div className="flex items-baseline justify-between">
        <h3 className="text-[14.5px] font-bold text-ink">Directions to {placeName}</h3>
        <button type="button" onClick={onClose} className="text-[12px] font-bold text-ocean">
          Close
        </button>
      </div>
      <p className="mt-[2px] text-[11.5px] text-[#5d726c]">
        Pick your map — your place in the day stays right here.
      </p>
      {control.options.map((option) =>
        option.available && option.url ? (
          <a
            key={option.provider}
            href={option.url}
            target="_blank"
            rel="noreferrer"
            className={`mt-[7px] flex h-[38px] items-center gap-[9px] rounded-xl border px-[11px] text-[13px] ${
              option.recommended ? "border-ocean bg-[#e9f5f1]" : "border-[#e3ece8]"
            }`}
          >
            <span className="font-bold text-ink">{option.label}</span>
            <span className="flex-1 text-right text-[11.5px] text-[#5d726c]">{option.note}</span>
            {option.recommended ? (
              <span className="rounded-full bg-ocean px-[6px] py-[1px] text-[9.5px] font-extrabold uppercase tracking-[0.04em] text-white">
                Best
              </span>
            ) : null}
          </a>
        ) : (
          <div
            key={option.provider}
            className="mt-[7px] flex h-[38px] items-center gap-[9px] rounded-xl border border-[#e3ece8] px-[11px] text-[13px] opacity-50"
            aria-disabled="true"
          >
            <span className="font-bold text-ink">{option.label}</span>
            <span className="flex-1 text-right text-[11.5px] text-[#5d726c]">{option.note}</span>
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity detail (the tap-through)                                   */
/* ------------------------------------------------------------------ */

export function ActivityDetailView({
  detail,
  onAction = noop,
  onDirections
}: {
  detail: ActivityDetailView;
  onAction?: PanelActionHandler;
  onDirections?: (itemId: string) => void;
}) {
  const fields = detail.fields;
  return (
    <section className="mx-auto w-[358px] max-w-full rounded-[20px] border border-[#dce7e3] bg-white p-4">
      <p className="text-[15px] font-bold leading-snug text-ink">{detail.headline}</p>
      <dl className="mt-3 space-y-[6px] text-[13px] text-[#44605a]">
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-ink">When</dt>
          <dd>
            {fields.dateLabel} · {fields.startLabel}–{fields.endLabel}
          </dd>
        </div>
        {fields.boardingLabel ? (
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-ink">Boarding</dt>
            <dd>{fields.boardingLabel}</dd>
          </div>
        ) : null}
        {fields.address ? (
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-ink">Address</dt>
            <dd className="text-right">{fields.address}</dd>
          </div>
        ) : null}
        {fields.bookingRef ? (
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-ink">Booking ref</dt>
            <dd>{fields.bookingRef}</dd>
          </div>
        ) : null}
        {detail.leaveBy ? (
          <div className="flex justify-between gap-3">
            <dt className="font-semibold text-ink">Leave by</dt>
            <dd>{detail.leaveBy.leaveByLabel}</dd>
          </div>
        ) : null}
      </dl>
      {detail.leaveBy ? (
        <p className="mt-3 rounded-xl bg-[#eef6f2] px-3 py-2 text-[12.5px] font-semibold text-ink">
          {detail.leaveBy.voice}
        </p>
      ) : null}
      <p className="mt-3 text-[11.5px] text-[#5d726c]">{fields.provenanceLabel}</p>
      <div className="mt-3 flex gap-[8px]">
        {detail.actions.includes("check-in") ? (
          <button
            type="button"
            onClick={() => onAction("check-in", detail.itemId)}
            className="inline-flex h-9 items-center justify-center rounded-[10px] bg-ocean px-4 text-[13px] font-bold text-white"
          >
            Check in
          </button>
        ) : null}
        {detail.actions.includes("directions") && onDirections ? (
          <button
            type="button"
            onClick={() => onDirections(detail.itemId)}
            className="inline-flex h-9 items-center justify-center rounded-[10px] border-[1.5px] border-ocean px-4 text-[13px] font-bold text-ocean"
          >
            Directions
          </button>
        ) : null}
        {detail.actions.includes("skip") ? (
          <button
            type="button"
            onClick={() => onAction("skip", detail.itemId)}
            className="inline-flex h-9 items-center justify-center rounded-[10px] border-[1.5px] border-[#c4d6d0] px-4 text-[13px] font-semibold text-ink"
          >
            Skip
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Wallet pass card (the pass page surface)                            */
/* ------------------------------------------------------------------ */

export function WalletPassCardView({ pass }: { pass: WalletPassView }) {
  const next = pass.nextActivity;
  return (
    <section
      data-measure="pass"
      className="mx-auto w-[358px] max-w-full overflow-hidden rounded-[26px] bg-[#0b3d2b] text-white shadow-[0_20px_44px_rgba(8,44,32,0.35)]"
    >
      <div className="flex items-center gap-[9px] px-5 pt-5">
        <Image
          src={ROAMLY_ICON_PATH}
          alt="Roamly logo"
          width={38}
          height={38}
          className="h-[38px] w-[38px] rounded-[10px]"
        />
        <div>
          <p className="text-[17px] font-extrabold leading-none">Roamly</p>
          <p className="mt-[3px] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#cfe3d8]">
            {pass.passTypeLabel}
          </p>
        </div>
        <span className="ml-auto text-right text-[11.5px] font-semibold text-[#cfe3d8]">
          {pass.destination}
          <br />
          {pass.dateLabel}
        </span>
      </div>
      <div className="px-5 pb-2 pt-4">
        <p className="text-[16px] font-bold leading-snug">{pass.headline}</p>
        {next ? (
          <div className="mt-3 rounded-2xl bg-white/10 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#cfe3d8]">Next up</p>
            <p className="mt-1 text-[15px] font-bold leading-snug">{next.name}</p>
            <p className="mt-[2px] text-[12.5px] text-[#cfe3d8]">
              {next.startLabel}–{next.endLabel}
              {next.bookingRef ? ` · Ref ${next.bookingRef}` : ""}
            </p>
          </div>
        ) : null}
        <dl className="mt-3 space-y-[5px] pb-3 text-[12.5px]">
          {pass.travelerName ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#cfe3d8]">Traveler</dt>
              <dd className="font-semibold">
                {pass.travelerName}
                {pass.partyLabel ? ` · ${pass.partyLabel}` : ""}
              </dd>
            </div>
          ) : null}
          {pass.essentials.hotelName ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#cfe3d8]">Staying at</dt>
              <dd className="font-semibold">{pass.essentials.hotelName}</dd>
            </div>
          ) : null}
          {pass.essentials.flightLabel ? (
            <div className="flex justify-between gap-3">
              <dt className="text-[#cfe3d8]">Flight</dt>
              <dd className="font-semibold">
                {pass.essentials.flightLabel}
                {pass.essentials.flightBookingRef ? ` · ${pass.essentials.flightBookingRef}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="border-t border-dashed border-white/25 px-5 py-3">
        <p className="text-[11px] leading-[1.35] text-[#cfe3d8]">{pass.offline.rule}</p>
      </div>
    </section>
  );
}
