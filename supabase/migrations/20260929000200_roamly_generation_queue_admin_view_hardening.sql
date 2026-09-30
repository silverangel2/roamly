-- Restrict the generation queue admin view to the trusted server boundary.
-- Preserve the existing view definition and queue semantics.

alter view public.roamly_generation_queue_admin
  set (security_invoker = true);

revoke all on table public.roamly_generation_queue_admin from public;
revoke all on table public.roamly_generation_queue_admin from anon;
revoke all on table public.roamly_generation_queue_admin from authenticated;
grant select on table public.roamly_generation_queue_admin to service_role;

notify pgrst, 'reload schema';
