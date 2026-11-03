import {createHash} from 'node:crypto';

const PIXEL_ID='2550232255445742';
const normalized=value=>String(value||'').trim().toLowerCase();
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalizeName=value=>normalized(value).normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu,'');

// Pure event builder. Transmit this event only AFTER durable lead storage succeeds.
export function buildLeadEvent(savedLead,context={}){
 if(!savedLead.event_id||savedLead.lead_id!==savedLead.event_id)throw new Error('Saved event ID required');
 const email=normalized(savedLead.email);
 let phone=String(savedLead.phone||'').replace(/\D/g,'');
 if(phone.length===10)phone='1'+phone;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^1[2-9]\d{2}[2-9]\d{6}$/.test(phone))throw new Error('Valid saved contact required');
 const names=String(savedLead.name||'').trim().split(/\s+/);
 const first=normalizeName(names[0]),last=normalizeName(names.slice(1).join(' '));
 if(!first||!last)throw new Error('First and last name required');
 const eventTime=Number(savedLead.event_time);
 if(!Number.isInteger(eventTime)||eventTime<=0)throw new Error('Saved event timestamp required');
 const source=new URL(savedLead.event_source_url);
 if(!['https:','http:'].includes(source.protocol))throw new Error('Invalid source URL');
 const userData={em:[hash(email)],ph:[hash(phone)],fn:[hash(first)],ln:[hash(last)]};
 // Obtain IP/UA from the receiving server's trusted request/proxy configuration.
 if(context.clientIp)userData.client_ip_address=context.clientIp;
 if(context.userAgent)userData.client_user_agent=context.userAgent;
 if(savedLead.fbp)userData.fbp=savedLead.fbp;
 if(savedLead.fbc)userData.fbc=savedLead.fbc;
 // Strict allowlist: answers, UTM parameters and raw contact values never go to Meta.
 return {event_name:'Lead',event_time:eventTime,event_id:savedLead.event_id,action_source:'website',event_source_url:source.href,user_data:userData,custom_data:{content_name:'Via21 Tour Inquiry',content_category:'Apartment Tour',ad_source:savedLead.ad_source||'direct'}};
}

export async function sendLeadEvent(event,{accessToken=process.env.META_CAPI_ACCESS_TOKEN,apiVersion=process.env.META_GRAPH_VERSION||'v26.0',testEventCode=process.env.META_TEST_EVENT_CODE,fetchImpl=fetch}={}){
 if(!accessToken)throw new Error('META_CAPI_ACCESS_TOKEN is not configured');
 if(!/^v\d+\.\d+$/.test(apiVersion))throw new Error('Invalid Graph API version');
 const payload={data:[event]};
 if(testEventCode)payload.test_event_code=testEventCode;
 const response=await fetchImpl('https://graph.facebook.com/'+apiVersion+'/'+PIXEL_ID+'/events',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
 let result;try{result=await response.json();}catch{throw new Error('Meta returned an invalid response');}
 if(!response.ok||result.error||result.events_received!==1)throw new Error('Meta CAPI did not accept the event');
 // Return only non-sensitive diagnostics; never log the token or payload.
 return {events_received:result.events_received,messages:result.messages||[]};
}
