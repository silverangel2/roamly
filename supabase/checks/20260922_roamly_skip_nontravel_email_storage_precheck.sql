-- Read-only aggregate precheck. Returns no traveler, message, or trip details.
with stats as (
  select
    count(*) filter (where processing_result in ('ignored', 'filtered')) as cleanup_candidates,
    count(*) filter (
      where processing_result in ('ignored', 'filtered')
        and exists (
          select 1
          from public.booking_extraction_results as extraction
          where extraction.email_message_id = travel_email_messages.id
        )
    ) as candidates_with_extraction_results,
    count(*) filter (where raw_body_retained) as raw_body_rows,
    count(*) filter (where processing_result not in ('ignored', 'filtered', 'relevant', 'extracted', 'error')) as unknown_status_rows
  from public.travel_email_messages
),
checks as (
  select 'travel email table exists' as check_name, (to_regclass('public.travel_email_messages') is not null)::text as observed, to_regclass('public.travel_email_messages') is not null as passed, true as mandatory, 10 as sort_key
  union all
  select 'non-travel metadata rows eligible for cleanup', cleanup_candidates::text, null::boolean, false, 20 from stats
  union all
  select 'eligible rows linked to extraction results', candidates_with_extraction_results::text, candidates_with_extraction_results = 0, true, 30 from stats
  union all
  select 'raw email bodies retained', raw_body_rows::text, raw_body_rows = 0, true, 40 from stats
  union all
  select 'unknown processing statuses', unknown_status_rows::text, unknown_status_rows = 0, true, 50 from stats
),
output_rows as (
  select check_name, observed, passed, sort_key from checks
  union all
  select
    'PRE_MIGRATION_VERIFICATION',
    case when coalesce(bool_and(passed), false) then 'PASS' else 'FAIL' end,
    coalesce(bool_and(passed), false),
    999
  from checks
  where mandatory
)
select check_name, observed, passed
from output_rows
order by sort_key, check_name;
