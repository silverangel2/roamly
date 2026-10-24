import assert from 'node:assert/strict';
import { hotelEmailFacts } from '../lib/roamly/emailBookingFacts.ts';
import { filterTravelEmail } from '../lib/roamly/travelEmailFiltering.ts';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const external = () => { throw new Error('Unexpected external I/O'); };
const mocks={
 '@/lib/roamly/emailBookingFacts':{hotelEmailFacts},
 'openai':{default:class {constructor(){external()}}},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>null},
 '@/lib/roamly/bookingWallet':{createTripBooking:external},
 '@/lib/roamly/brain/bookingReconciliation':{reconcileTripBookings:external},
 '@/lib/roamly/reconciliationLane':{build2ReconciliationLaneActive:()=>true}
};
const compiled={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/roamly/bookingExtraction.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports:compiled.exports,module:compiled,require:name=>{assert.ok(name in mocks,`Unexpected import ${name}`);return mocks[name]},Date,console});
const {deterministicBookingExtraction}=compiled.exports;
const body=`ROAMLY QA TEST — NOT A REAL RESERVATION
Provider: Roamly QA Test Provider
Confirmation number: TEST-RMLY-1024-BORA
Test booking status: Confirmed
Guest: Roamly HQ
Hotel: Roamly QA Test Stay — Boracay
Destination: Boracay, Aklan, Philippines
Check-in: November 10, 2026 at 15:00 (Asia/Manila, UTC+08:00)
Check-out: November 14, 2026 at 11:00 (Asia/Manila, UTC+08:00)
Room: 1 standard room, 1 adult
Test total: PHP 4,000.00 for 4 nights (synthetic amount; no charge)
Roamly test trip ID: ab03e21e-b61e-4881-a785-b7c65fb37984`;
for(const text of [body,body.replaceAll('\n',' ')]) {
 const metadata={provider:'gmail',messageId:'synthetic',sender:'Junel <qa@gmail.com>',subject:'[ROAMLY QA TEST — NOT A REAL RESERVATION] Hotel booking confirmation — Boracay Nov 10–14 — TEST-RMLY-1024-BORA',bodyText:text};
 const filter=filterTravelEmail(metadata);const result=deterministicBookingExtraction({metadata,filter});
 assert.equal(result.booking.confirmationCode,'TEST-RMLY-1024-BORA');
 assert.equal(result.booking.startTime,'2026-11-10T07:00:00.000Z');
 assert.equal(result.booking.endTime,'2026-11-14T03:00:00.000Z');
 assert.equal(result.booking.destination,'Boracay, Aklan, Philippines');
 assert.equal(result.booking.title,'Roamly QA Test Stay — Boracay hotel booking');
 assert.equal(result.booking.provider,'Roamly QA Test Provider');
 assert.equal(result.booking.currency,'PHP');assert.equal(result.booking.totalPrice,4000);
 assert.equal(result.requiresUserApproval,false);
}
const uncertain=hotelEmailFacts('Check-in: 2026-11-10 at 15:00\nCheck-out: 2026-11-14 at 11:00');assert.equal(uncertain.start,null);assert.equal(uncertain.unresolved,true);
const dst=hotelEmailFacts('Check-in: 2026-11-01 at 01:30 America/New_York\nCheck-out: 2026-11-02 at 11:00 America/New_York');assert.equal(dst.start,null);assert.equal(dst.unresolved,true);
console.log('PASS: actual Gmail fixture keeps exact reference, independent hotel fields, PHP total, and Manila UTC instants; unknown or ambiguous zones remain unresolved.');
const target={id:'target',user_id:'owner',title:'Boracay trip',destination_name:'Boracay, Philippines',start_date:'2026-11-10',end_date:'2026-11-14'};
const old=Array.from({length:25},(_,i)=>({...target,id:`old-${i}`,destination_name:'Toronto',title:'Old trip',start_date:'2026-08-01',end_date:'2026-08-05'}));
let saved=[];let persisted=[];
mocks['@/lib/roamly/bookingWallet'].createTripBooking=async params=>{saved.push(params);return {booking:{id:'test-booking'}}};
mocks['@/lib/roamly/brain/bookingReconciliation'].reconcileTripBookings=async()=>({ok:true});
function database(trips,fail=false){return {from(table){let rows=table==='roamly_trips'?trips:[];const query={select(){return this},eq(k,v){rows=rows.filter(r=>r[k]===v);return this},neq(){return this},is(){return this},in(){return this},lte(k,v){rows=rows.filter(r=>r[k]<=v);return this},or(value){const earliest=value.match(/end_date.gte.([0-9-]+)/)?.[1];assert.ok(earliest);rows=rows.filter(r=>(r.end_date||r.start_date)>=earliest);return this},order(){rows.sort((a,b)=>String(a.start_date).localeCompare(String(b.start_date)));return this},limit(n){rows=rows.slice(0,n);return this},then(resolve,reject){return Promise.resolve({data:rows,error:fail&&table==='roamly_trips'?{message:'database unavailable'}:null}).then(resolve,reject)},upsert(payload){persisted.push(payload);return Promise.resolve({error:null})}};return query}}}
const metadata={provider:'gmail',messageId:'synthetic-match',sender:'qa@gmail.com',subject:'Hotel booking confirmation',bodyText:body};
const params={connection:{id:'connection',user_id:'owner',provider:'gmail'},metadata,filter:filterTravelEmail(metadata),emailMessageId:'message'};
const attached=await compiled.exports.extractAndMatchTravelEmailBooking({...params,supabase:database([...old,target,{...target,id:'other-owner',user_id:'other'}])});
assert.equal(attached.status,'attached');assert.equal(attached.tripId,'target');assert.equal(saved.length,1);assert.equal(saved[0].input.checkInTime,'2026-11-10T07:00:00.000Z');assert.equal(persisted.at(-1).matched_booking_id,'test-booking');
saved=[];
const ambiguous=await compiled.exports.extractAndMatchTravelEmailBooking({...params,supabase:database([...old,target,{...target,id:'second-match'}])});assert.equal(ambiguous.status,'unmatched');assert.equal(saved.length,0);
await assert.rejects(()=>compiled.exports.extractAndMatchTravelEmailBooking({...params,supabase:database([target],true)}),/temporarily unavailable/);
console.log('PASS: orchestration finds a current owned trip beyond 25 old trips, rejects tied matches and surfaces database failure.');

const boracayExtraction=deterministicBookingExtraction({metadata,filter:filterTravelEmail(metadata)});
assert.equal(compiled.exports.scoreTripForEmailLookbackMatch({...target,destination_name:'Manila, Philippines'},boracayExtraction,2).reasons.includes('destination_text_match'),false,'sharing a country cannot match a different city');
