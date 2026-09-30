-- Restrict the six confirmed SECURITY DEFINER RPC ACLs to their intended callers.
-- This migration changes function privileges only; it does not replace function bodies.

revoke execute on function public.roamly_claim_companion_notification_deliveries(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.roamly_claim_companion_notification_deliveries(text, integer, integer)
  to service_role;

revoke execute on function public.roamly_complete_companion_notification_delivery(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.roamly_complete_companion_notification_delivery(uuid, text, text, text, text)
  to service_role;

revoke execute on function public.roamly_release_companion_notification_delivery(uuid, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.roamly_release_companion_notification_delivery(uuid, text, text, timestamptz, text)
  to service_role;

revoke execute on function public.roamly_release_generation_layer(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.roamly_release_generation_layer(uuid, text, text)
  to service_role;

revoke execute on function public.roamly_skip_remaining_generation_layers(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.roamly_skip_remaining_generation_layers(uuid, text, text)
  to service_role;

revoke execute on function public.roamly_apply_verified_companion_repair(uuid, uuid)
  from public, anon;
grant execute on function public.roamly_apply_verified_companion_repair(uuid, uuid)
  to authenticated;
