/* Browser tracking: no contact data or quiz answers are passed to fbq. */
(function(global){
 'use strict';
 global.createVia21LeadTracking=function({adSource='direct',fetchImpl=global.fetch.bind(global)}={}){
  let busy=false,completed=false,pending=null;
  const utms=Object.fromEntries([...new URLSearchParams(global.location.search)].filter(([key])=>key.startsWith('utm_')));
  const fbclid=new URLSearchParams(global.location.search).get('fbclid');
  const fallbackFbc=fbclid?'fb.1.'+Date.now()+'.'+fbclid:undefined;
  function cookie(name){const part=global.document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));if(!part)return undefined;try{return decodeURIComponent(part.slice(name.length+1));}catch{return undefined;}}
  return {
   get busy(){return busy;},get completed(){return completed;},
   async submit(endpoint,lead){
    if(busy||completed)return {ignored:true};
    busy=true;
    // Reuse an ID after a lost response; a changed lead is a new submission.
    const fingerprint=JSON.stringify({name:lead.name,phone:lead.phone,email:lead.email,answers:lead.answers});
    if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,eventId:global.crypto.randomUUID(),timestamp:lead.timestamp,eventTime:Math.floor(Date.now()/1000)};
    const eventId=pending.eventId;
    try{
     const payload={...lead,...utms,timestamp:pending.timestamp,event_id:eventId,lead_id:eventId,event_time:pending.eventTime,ad_source:adSource,utm:utms,event_source_url:global.location.href,fbp:cookie('_fbp'),fbc:cookie('_fbc')||fallbackFbc};
     const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':eventId},body:JSON.stringify(payload)});
     if(!response.ok)throw new Error('Lead delivery failed');
     // Accommodate plain 2xx webhook replies, but reject explicit application errors.
     if(response.headers?.get('content-type')?.includes('application/json')){
      const result=await response.json();
      if(result?.success===false||result?.ok===false||result?.error)throw new Error('Lead was not accepted');
      if(result?.event_id&&result.event_id!==eventId)throw new Error('Event ID mismatch');
     }
     completed=true;
     try{if(typeof global.fbq==='function')global.fbq('track','Lead',{content_name:'Via21 Tour Inquiry',content_category:'Apartment Tour',ad_source:adSource},{eventID:eventId});}catch{/* Tracking failure must not resubmit a saved lead. */}
     return {event_id:eventId};
    }finally{busy=false;}
   }
  };
 };
})(window);
