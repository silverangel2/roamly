-- Read-only aggregate postcheck. Returns no traveler, message, or trip details.
with stats as (
  select
    count(*) filter (where processing_result in ('ignored', 'filtered')) as non_travel_message_rows,
    count(*) filter (where raw_body_retained) as raw_body_rows,
    count(*) filter (where processing_result not in ('ignored', 'filtered', 'relevant', 'extracted', 'error')) as unknown_status_rows
  from public.travel_email_messages
),
checks as (
  select 'non-travel message metadata rows remain' as check_name, non_travel_message_rows::text as observed, non_travel_message_rows = 0 as passed, true as mandatory, 10 as sort_key from stats
  union all
  select 'raw email bodies retained', raw_body_rows::text, raw_body_rows = 0, true, 20 from stats
  union all
  select 'unknown processing statuses', unknown_status_rows::text, unknown_status_rows = 0, true, 30 from stats
),
output_rows as (
  select check_name, observed, passed, sort_key from checks
  union all
  select
    'POST_MIGRATION_VERIFICATION',
    case when coalesce(bool_and(passed), false) then 'PASS' else 'FAIL' end,
    coalesce(bool_and(passed), false),
    999
  from checks
  where mandatory
)
select check_name, observed, passed
from output_rows
order by sort_key, check_name;
