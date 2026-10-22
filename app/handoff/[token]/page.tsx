import { HandoffLanding } from "@/components/roamly/HandoffLanding";

export const runtime = "nodejs";

/**
 * The phone landing for a desktop handoff pass (Phase 6). The page
 * itself redeems nothing — the client component POSTs the redemption
 * on mount, so link previews and crawlers cannot burn the pass.
 */
export default async function HandoffPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return <HandoffLanding token={token} />;
}
