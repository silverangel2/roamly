import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {bookingExactTiming} from '../lib/roamly/bookingDisplayTiming.ts';
import * as presentation from '../lib/roamly/itineraryPresentation.ts';
import * as bookingTruth from '../lib/roamly/bookingTruth.ts';
import * as placeDetail from '../lib/roamly/placeDetail.ts';
import * as itineraryHome from '../lib/roamly/itineraryHome.ts';
import * as daySummary from '../lib/roamly/daySummary.ts';
import * as activityDescription from '../lib/roamly/activityDescription.ts';
import * as marketStopDescription from '../lib/roamly/marketStopDescription.ts';
import * as planStayRow from '../lib/roamly/planStayRow.ts';
import * as navigationLinks from '../lib/roamly/navigationLinks.ts';
const require=createRequire(import.meta.url);
const compiled={exports:{}};
const fail=()=>{throw new Error('Unexpected rendering or external I/O in display adapter test')};
// Mock-map repair (2026-11-09): this map had gone stale against
// ItineraryDayPlan's import list — the suite failed AT LOAD on the
// untouched tree (missing bookingTruth / placeDetail /
// itineraryHome / daySummary / activityDescription /
// marketStopDescription / planStayRow / lucide-react), before any
// assertion ran. The map now mirrors the map-honesty suite's:
// real pure modules where the display chain calls them, inert
// stand-ins for components (never rendered here). The BoardUI
// accordion + badge imports the day card gained in the 2026-11-09
// BoardUI pass are stubbed the same way. No assertion changed.
const mocks={
 '@/lib/roamly/bookingDisplayTiming':{bookingExactTiming},
 '@/lib/roamly/itineraryPresentation':presentation,
 'lucide-react':{ChevronRight:()=>null},
 '@/lib/roamly/bookingTruth':bookingTruth,
 '@/components/roamly/PlanningConflictRepair':{default:fail},
 '@/components/roamly/CustomerActivityRemoval':{default:fail},
 '@/components/roamly/CustomerActivityReplacement':{default:fail},
 '@/components/trip/HotelPartnerChoices':{HotelPartnerChoices:fail},
 '@/lib/roamly/affiliateResolver':{resolveConfiguredHotelPartners:fail},
 '@/lib/roamly/navigationLinks':navigationLinks,
 '@/lib/roamly/placeDetail':placeDetail,
 '@/lib/roamly/itineraryRepair':{findRepairTarget:fail},
 '@/lib/roamly/confirmedItineraryAnchor':{isConfirmedItineraryBookingAnchor:()=>false},
 '@/lib/itinerary':{formatMoney:fail},
 '@/lib/roamly/itineraryHome':itineraryHome,
 '@/lib/roamly/daySummary':daySummary,
 '@/lib/roamly/activityDescription':activityDescription,
 '@/lib/roamly/marketStopDescription':marketStopDescription,
 '@/lib/roamly/planStayRow':planStayRow,
 '@/components/boardui/Accordion':{BuiAccordion:()=>null},
 '@/components/boardui/Badge':{BuiChip:()=>null,BuiBadge:()=>null}
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/trip/ItineraryDayPlan.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:compiled.exports,module:compiled,require:name=>name==='react/jsx-runtime'?require(name):mocks[name]||fail(),Date,Intl});
// Fixture repair (2026-11-09, same pass): the original dummy was a
// "Roamly QA Test Stay" with no provider evidence — under the
// booking-truth rule (providerConfirmationEvidence tier) a QA/test
// booking can NEVER consolidate, so the suite's premise went stale
// when the truth rule tightened. The fixture is now an ordinary
// evidenced booking (real provider, patterned confirmation code,
// email origin), which is what this suite exists to exercise: the
// rendered time must come from the BOOKING, not the stored plan.
const booking={id:'dummy',title:'Harbour Hotel — Montreal hotel booking',booking_type:'hotel',booking_status:'booked',traveler_confirmed:true,provider_name:'Booking.com',confirmation_number:'BK48291',source_type:'email',start_at:'2026-10-29T19:00:00Z',end_at:'2026-11-02T16:00:00Z',metadata:{timezone:'America/Toronto'}};
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
