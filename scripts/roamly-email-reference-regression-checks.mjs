import assert from 'node:assert/strict';
import { filterTravelEmail } from '../lib/roamly/travelEmailFiltering.ts';
const reference='TEST-RMLY-1024-BORA';
const result=filterTravelEmail({provider:'gmail',messageId:'synthetic-only',sender:'QA <qa@example.test>',subject:'Hotel booking confirmation — Boracay',bodyText:`ROAMLY QA TEST ONLY. Confirmation number: ${reference}. Check-in: November 10, 2026 at 15:00. Check-out: November 14, 2026 at 11:00. Destination: Boracay, Philippines.`});
assert.equal(result.shouldProcess,true);
assert.deepEqual(result.extractedFacts.bookingReferenceCandidates,[reference]);
const generic=filterTravelEmail({provider:'gmail',messageId:'generic',sender:'qa@example.test',subject:'Your itinerary is ready',bodyText:'Booking options for your trip. Hotel booking confirmation information.'});
assert.equal(generic.extractedFacts.bookingReferenceCandidates,undefined);
console.log('PASS: complete synthetic confirmation retained; generic confirmation/options words are not booking references.');
