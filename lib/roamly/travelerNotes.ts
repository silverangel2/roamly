/**
 * Display the traveler's own notes as constraints.
 * Does not pretend a note booked a hotel, flight, or festival.
 */

export type TravelerNoteDisplay = {
  text: string;
  constraints: string[];
  gaps: string[];
};

export function travelerNoteDisplay(notes: string | null | undefined): TravelerNoteDisplay {
  const text = (notes || "").trim();
  if (!text) return { text: "", constraints: [], gaps: [] };
  const constraints = [text];
  const gaps: string[] = [];
  if (/\bhotel|stay|airbnb|neighborhood|property\b/i.test(text)) {
    gaps.push("A hotel note stays with this trip. It does not filter hotel inventory.");
  }
  if (/\bflight|airline|seat|layover|airport\b/i.test(text)) {
    gaps.push("A flight note stays with this trip. It does not filter airlines, fares, or seats.");
  }
  if (/\bfestival|concert|event|nightlife\b/i.test(text)) {
    constraints.push("Roamly will not invent a festival or event when none is confirmed.");
    gaps.push("“Festival if any” does not confirm a festival, and it does not add one to the plan.");
  }
  return { text, constraints, gaps };
}
