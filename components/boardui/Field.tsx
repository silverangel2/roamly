/**
 * BoardUI Field — Roamly foundation pattern for form fields.
 *
 * Purpose (owner form rules, 2026-11-03 — "FORM RULES — 5 FORM
 * MISTAKES", ~/AGENTS.md): three of the five rules are field-level
 * behaviour, and this file is their one home in the foundation:
 *
 * - Rule 2 (validate on blur, not on keystroke): `useBuiField` runs
 *   the field's validator on BLUR only. Typing into an untouched
 *   field can never paint it red. Once a field HAS shown an error,
 *   the hook keeps watching: every later keystroke re-checks, so
 *   the error clears the moment the value is fixed.
 * - Rule 3 (the submit button never moves): `BuiFieldError` ALWAYS
 *   renders its slot — one line of reserved height under the field,
 *   empty or not — so an error appearing never pushes the layout
 *   (or the submit button) down. `BuiErrorSummary` is the rule's
 *   submit-time half: a summary at the top of the form whose links
 *   jump to (and focus) every broken field.
 * - Rule 1 support (never placeholder-as-label): adopters pair these
 *   pieces with a persistent visible label above the field; the
 *   error slot sits under the input, inside the same label block,
 *   so label, field and error read as one unit.
 *
 * Craft follows the BoardUI form family (BoardUI/boardui, MIT) as
 * ported by this branch's foundation: Roamly tokens only, no black,
 * human words for every message (vibe-tells checklist #4).
 */
import { useCallback, useRef, useState } from "react";
import { BuiNotice } from "./Notice";
import { cx } from "./cx";

export interface BuiField {
  /** The field's current error message, or "" when valid/untouched. */
  error: string;
  /** True once the field has shown an error at least once. */
  watching: boolean;
  /**
   * Feels-right set (2026-11-04): increments every time a NEW error
   * lands (a valid/untouched field fails, or a different message
   * replaces the old one). Adopters put `key={shakeKey}` + the
   * `bui-shake` class on the field's wrapper block: the remount
   * restarts the shake animation, so the "no" is FELT at the same
   * moment the human message appears — alongside it, never instead
   * of it. Clearing an error never shakes.
   */
  shakeKey: number;
  /** Rule 2: validate on blur. Never fires from a keystroke. */
  onBlur: (value: string) => void;
  /** Rule 2, second half: after a first error, re-check per keystroke. */
  onChange: (value: string) => void;
  /** Validate now (submit time) and return the message. */
  runValidation: (value: string) => string;
}

export function useBuiField(validate: (value: string) => string): BuiField {
  const [error, setError] = useState("");
  const [watching, setWatching] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const errorRef = useRef("");
  errorRef.current = error;

  const runValidation = useCallback((value: string) => {
    const message = validateRef.current(value);
    if (message && message !== errorRef.current) {
      setShakeKey((current) => current + 1);
    }
    setError(message);
    if (message) setWatching(true);
    return message;
  }, []);

  const onBlur = useCallback(
    (value: string) => {
      runValidation(value);
    },
    [runValidation]
  );

  const onChange = useCallback(
    (value: string) => {
      if (watching) runValidation(value);
    },
    [runValidation, watching]
  );

  return { error, watching, shakeKey, onBlur, onChange, runValidation };
}

/**
 * The reserved per-field error slot (rule 3). Always rendered, one
 * line tall (min-h-5 = the text-sm/leading-5 line it carries), so
 * the space exists before the error does. `reserveLines={2}` opts a
 * field into a two-line reservation: the plan form uses it, because
 * its messages are full sentences that wrap to two lines at phone
 * width (measured 2026-11-03), so a one-line slot would still let
 * the block below shift when the full message lands. Adopters keep
 * the two ids side by side: the input's own id (the summary link's
 * target, e.g. "auth-email") and this slot's id (the input's
 * aria-describedby, e.g. "auth-email-error").
 */
export function BuiFieldError({ id, message, reserveLines = 1 }: { id: string; message?: string; reserveLines?: 1 | 2 }) {
  return (
    <p id={id} aria-live="polite" className={cx(reserveLines === 2 ? "mt-1.5 min-h-10 text-sm font-semibold leading-5" : "mt-1.5 min-h-5 text-sm font-semibold leading-5", message ? "text-cred" : undefined)}>
      {message ?? ""}
    </p>
  );
}

export interface BuiErrorSummaryItem {
  /** The broken input's element id — the link jumps to it and focuses it. */
  fieldId: string;
  /** The field's visible label, so the link names what the traveller sees. */
  label: string;
  message: string;
}

/**
 * The submit-time error summary (rule 3, second half): rendered at
 * the TOP of the form after a submit attempt, one link per broken
 * field. Renders nothing when every field is valid.
 */
export function BuiErrorSummary({ errors, title = "Check these fields:" }: { errors: BuiErrorSummaryItem[]; title?: string }) {
  if (errors.length === 0) return null;
  return (
    <BuiNotice tone="error" title={title}>
      <ul className="grid gap-1">
        {errors.map((item) => (
          <li key={item.fieldId}>
            <a
              href={`#${item.fieldId}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(item.fieldId)?.focus();
              }}
              className="font-bold text-cblue underline decoration-cblue/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
            >
              {item.label}: {item.message}
            </a>
          </li>
        ))}
      </ul>
    </BuiNotice>
  );
}
