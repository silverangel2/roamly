-- Remove email header metadata previously stored for messages the travel
-- filter classified as ignored or insufficiently relevant. Apply only after
-- deploying the code that skips these messages before storage.
-- Rows linked to booking extraction results are deliberately preserved for
-- manual review; the precheck requires this set to be empty.
delete from public.travel_email_messages as email_message
where email_message.processing_result in ('ignored', 'filtered')
  and not exists (
    select 1
    from public.booking_extraction_results as extraction
    where extraction.email_message_id = email_message.id
  );
