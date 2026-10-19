function text(v: unknown,max: number) { if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Invalid text');return v.trim(); }
export function validateTravelProposal(input: unknown, now = Date.now()) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected proposal object');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).some(k=>!['kind','title','destination','sourceUrl','observedAt','reason','price','currency','priceBasis','startDate','endDate','partySize'].includes(k)))throw new Error('Unexpected field; booking proof, ratings and publication flags are not accepted');
 if(!['hotel','activity','flight'].includes(String(b.kind)))throw new Error('Invalid candidate kind');
 const title=text(b.title,240),destination=text(b.destination,200),reason=text(b.reason,3000);
 const u=new URL(text(b.sourceUrl,2000));
 if(u.protocol!=='https:'||u.username||u.password||u.hash)throw new Error('Public HTTPS source without credentials or fragment required');
 if(!u.hostname.includes('.')||u.hostname==='localhost'||u.hostname.endsWith('.local')||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||u.hostname.includes(':'))throw new Error('Public source hostname required');
 const observed=text(b.observedAt,60);if(!/(Z|[+-]\d\d:\d\d)$/.test(observed))throw new Error('Source timestamp needs timezone');
 const t=Date.parse(observed);if(!Number.isFinite(t)||t>now+5000||now-t>24*3600000)throw new Error('Source observation must be within the last 24 hours');
 const hasPrice=b.price!==null&&b.price!==undefined;
 if(hasPrice&&(typeof b.price!=='number'||!Number.isFinite(b.price)||b.price<0))throw new Error('Invalid price');
 if(hasPrice&&(typeof b.currency!=='string'||! /^[A-Z]{3}$/.test(b.currency)))throw new Error('Price needs a currency');
 if(hasPrice&&!['per night','per person','total'].includes(String(b.priceBasis)))throw new Error('Price basis required');
 function date(v:unknown){if(v===null||v===undefined)return null;const s=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw new Error('Invalid travel date');return s}
 const startDate=date(b.startDate),endDate=date(b.endDate);
 if(endDate&&(!startDate||endDate<startDate))throw new Error('Invalid date range');
 if(hasPrice&&(!startDate||!Number.isInteger(b.partySize)||Number(b.partySize)<1||Number(b.partySize)>50))throw new Error('Quoted price needs date and party size');
 if(b.kind==='flight'&&!startDate)throw new Error('Flight research needs a departure date');
 return {kind:b.kind,title,destination,sourceUrl:u.href,observedAt:observed,reason,price:hasPrice?b.price:null,currency:hasPrice?b.currency:null,priceBasis:hasPrice?b.priceBasis:null,startDate,endDate,partySize:b.partySize??null,priceStatus:hasPrice?'ESTIMATED':'UNKNOWN',availabilityVerified:false,bookingProven:false,sourceIndependentlyVerified:false};
}
