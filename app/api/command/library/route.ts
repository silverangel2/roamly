import { NextResponse } from 'next/server';
import { sophieAuthError } from '@/lib/sophieCommand';
import { listContributions } from '@/lib/sophieContributionStore';
export const runtime='nodejs';export const dynamic='force-dynamic';
// This is the reviewed RESEARCH collection, never the booking-proven traveler library.
export async function GET(r:Request){if(sophieAuthError(r))return NextResponse.json({ok:false,error:'Unauthorized'},{status:401});try{const destination=(new URL(r.url).searchParams.get('destination')||'').trim().toLowerCase();if(destination.length>200)return NextResponse.json({ok:false,error:'Destination too long'},{status:422});const rows=await listContributions('accepted');return NextResponse.json({ok:true,collection:'reviewed_research',bookingProven:false,candidates:rows.filter(row=>!destination||String(row.payload.destination).toLowerCase()===destination).map(row=>({...row,requiresFreshVerification:true})),note:'Human-reviewed research only. Prices and availability need rechecking. No traveler booking or consent is implied.'},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({ok:false,error:'Research collection unavailable'},{status:503})}}
