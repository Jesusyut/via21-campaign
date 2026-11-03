import {buildLeadEvent,sendLeadEvent} from './meta-capi.mjs';

// Host adapter contract: implement persistWithOutbox as ONE durable transaction:
// 1) upsert the lead by event_id (unique key), including every field in record;
// 2) upsert a pending CAPI job by event_id, containing the event below.
// Retries must return the ORIGINAL saved record and event without creating another row.
// Return HTTP 2xx {success:true,event_id} only after that transaction commits.
export async function acceptTourInquiry(input,context,{persistWithOutbox}){
 if(typeof persistWithOutbox!=='function')throw new Error('A durable lead destination is required');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.event_id||''))throw new Error('Invalid event ID');
 const utm=Object.fromEntries(Object.entries(input.utm||{}).filter(([key])=>key.startsWith('utm_')));
 const timestamp=new Date().toISOString();
 const record={timestamp,name:String(input.name||'').trim(),phone:String(input.phone||'').trim(),email:String(input.email||'').trim(),answers:input.answers||{},ad_source:input.ad_source||'direct',utm,event_id:input.event_id,lead_id:input.event_id,event_time:Math.floor(Date.now()/1000),event_source_url:input.event_source_url,fbp:input.fbp,fbc:input.fbc};
 const event=buildLeadEvent(record,context);
 const saved=await persistWithOutbox({record,event});
 if(saved?.event_id!==record.event_id)throw new Error('Durable lead acknowledgement required');
 return {success:true,event_id:saved.event_id};
}

// Run from a durable queue/outbox AFTER the lead transaction commits.
// On failure, leave the job pending and retry with the SAME event_id/time.
export async function deliverMetaOutboxJob(job,options){
 return sendLeadEvent(job.event,options);
}
