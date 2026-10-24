import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {bookingExactTiming} from '../lib/roamly/bookingDisplayTiming.ts';
import * as presentation from '../lib/roamly/itineraryPresentation.ts';
const require=createRequire(import.meta.url);
const compiled={exports:{}};
const fail=()=>{throw new Error('Unexpected rendering or external I/O in display adapter test')};
const mocks={
 '@/lib/roamly/bookingDisplayTiming':{bookingExactTiming},
 '@/lib/roamly/itineraryPresentation':presentation,
 '@/components/roamly/PlanningConflictRepair':{default:fail},
 '@/components/roamly/CustomerActivityRemoval':{default:fail},
 '@/components/roamly/CustomerActivityReplacement':{default:fail},
 '@/components/trip/HotelPartnerChoices':{HotelPartnerChoices:fail},
 '@/lib/roamly/affiliateResolver':{resolveConfiguredHotelPartners:fail},
 '@/lib/roamly/navigationLinks':{buildNavigationLinks:fail},
 '@/lib/roamly/itineraryRepair':{findRepairTarget:fail},
 '@/lib/roamly/confirmedItineraryAnchor':{isConfirmedItineraryBookingAnchor:()=>false},
 '@/lib/itinerary':{formatMoney:fail}
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/trip/ItineraryDayPlan.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:compiled.exports,module:compiled,require:name=>name==='react/jsx-runtime'?require(name):mocks[name]||fail(),Date,Intl});
const booking={id:'dummy',title:'Roamly QA Test Stay — Montreal hotel booking',booking_type:'hotel',booking_status:'booked',traveler_confirmed:true,start_at:'2026-10-29T19:00:00Z',end_at:'2026-11-02T16:00:00Z',metadata:{timezone:'America/Toronto'}};
assert.deepEqual(bookingExactTiming(booking),{date:'2026-10-29',start:'15:00',end:''});
const {buildDisplayTimelineItems}=compiled.exports;
for (const items of [[],[{title:booking.title,item_type:'booking',startTime:'15:00',time_label:'3:00 PM',booking_id:'dummy'}]]) {
 const result=buildDisplayTimelineItems({date:'2026-10-29',live_timeline:items},[booking]);
 assert.equal(result.items.length,1);assert.match(result.items[0].time,/3:00/);assert.doesNotMatch(result.items[0].time,/7:00/);assert.equal(result.items[0].sortMinutes,900);assert.equal(result.items[0].timeFromBooking,true);
}
const overnight={...booking,start_at:'2026-10-28T17:00:00Z',metadata:{timezone:'Asia/Manila'}};
assert.equal(buildDisplayTimelineItems({date:'2026-10-29',live_timeline:[]},[overnight]).items[0].sortMinutes,60);
assert.equal(buildDisplayTimelineItems({date:'2026-10-28',live_timeline:[]},[overnight]).items.length,0);
console.log('PASS: actual itinerary display adapter preserves 15:00 Montreal booking time, inserts missing bookings in local time, and assigns overnight bookings to the local day.');
