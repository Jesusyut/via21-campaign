import {enqueue,getLead,listLeads} from './db.mjs';
import {buildLeadEvent,sendLeadEvent} from './meta-capi.mjs';
import {metaRecord,phoenixDate} from './pipeline.mjs';
function missing(name){return Object.assign(new Error(name+' is not configured'),{configuration:true});}
export function notification(lead,origin){
 return '🔑 New Via 21 lead\n'+lead.first_name+' '+lead.last_name+' — '+lead.bedrooms+'BR, '+lead.move_in+', '+lead.furnished+'\n📞 +'+lead.phone+'\nSource: '+lead.ad_source+'\nOpen: '+origin+'/admin/leads/'+lead.id;
}
async function checkedFetch(url,options){const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Notification provider rejected request');return response;}
export async function telegram(text,env=process.env){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw missing('Telegram');
 const response=await checkedFetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:text.length>4000?text.slice(0,3970)+"\n… (see /admin for more)":text,link_preview_options:{is_disabled:true}})});
 if(!(await response.json()).ok)throw new Error('Telegram did not accept notification');
}
export async function email(text,key,env=process.env){
 if(!env.RESEND_API_KEY||!env.ALERT_EMAIL||!env.EMAIL_FROM)throw missing('Email');
 const response=await checkedFetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:env.EMAIL_FROM,to:[env.ALERT_EMAIL],subject:text.startsWith('⏰')?'Via 21 contact reminder':text.startsWith('Via 21 daily')?'Via 21 daily digest':'New Via 21 lead',text})});
 if(!(await response.json()).id)throw new Error('Email provider did not accept notification');
}
export function digest(leads,now=new Date()){
 const time=now.getTime(),today=phoenixDate(now);
 const recent=leads.filter(l=>time-Date.parse(l.created_at)<=86400000);
 const stuck=leads.filter(l=>['New','Contacted'].includes(l.stage)&&time-Date.parse(l.stage_changed_at||l.created_at)>172800000);
 const tours=leads.filter(l=>l.stage==='Tour Scheduled'&&l.tour_at&&phoenixDate(l.tour_at)===today);
 const names=items=>items.length?items.map(l=>l.first_name+' '+l.last_name+' ('+l.stage+')').join(', '):'None';
 return 'Via 21 daily digest — '+today+'\nNew leads in the last 24h: '+recent.length+'\n'+names(recent)+'\nStuck in New/Contacted >48h: '+stuck.length+'\n'+names(stuck)+'\nTours scheduled today: '+tours.length+'\n'+names(tours);
}
export async function queueDailyDigest(db,now=new Date()){
 const day=phoenixDate(now),dueAt=Date.parse(day+'T08:00:00-07:00');
 for(const kind of ['digest_telegram','digest_email'])await enqueue(db.query,{id:kind+':'+day,kind,dueAt,data:{day}});
}
export async function claimJobs(db,now=Date.now()){
 return db.tx('job-claims',async q=>{
  const result=await q("SELECT * FROM jobs WHERE (status='pending' AND due_at<=$1) OR (status='running' AND locked_until<$1) ORDER BY due_at LIMIT 8",[now]);
  for(const job of result.rows)await q("UPDATE jobs SET status='running',locked_until=$1,attempts=attempts+1 WHERE id=$2",[now+60000,job.id]);
  return result.rows;
 });
}
export async function runJobs(db,{env=process.env,now=()=>Date.now(),sendTelegram=telegram,sendEmail=email,sendCapi=sendLeadEvent}={}){
 await queueDailyDigest(db,new Date(now()));
 const jobs=await claimJobs(db,now());
 await Promise.all(jobs.map(async job=>{
  try{
   const lead=job.lead_id?await getLead(db,job.lead_id):null,data=JSON.parse(job.data);
   const origin=env.PUBLIC_ORIGIN;
   if(job.lead_id&&!lead)throw new Error('Lead no longer exists');
   if(job.kind==='capi'){if(!env.META_CAPI_ACCESS_TOKEN)throw missing('CAPI');await sendCapi(buildLeadEvent(metaRecord(lead),data.context),{accessToken:env.META_CAPI_ACCESS_TOKEN,apiVersion:env.META_GRAPH_VERSION||'v26.0',testEventCode:env.META_TEST_EVENT_CODE});}
   else if(job.kind==='telegram')await sendTelegram(notification(lead,origin),env);
   else if(job.kind==='email')await sendEmail(notification(lead,origin),job.id,env);
   else if(job.kind==='sheet'){
    if(!env.SHEET_BACKUP_URL){await db.query("UPDATE jobs SET status='disabled',last_error='Optional backup disabled' WHERE id=$1",[job.id]);return;}
    // Apps Script must upsert by id; the DB is always authoritative.
    const {fingerprint,...safeLead}=lead;
    const response=await checkedFetch(env.SHEET_BACKUP_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.SHEET_BACKUP_SECRET,lead:safeLead})});
    const accepted=await response.json();if(accepted.success!==true)throw new Error('Sheet backup did not acknowledge row');
   }
   else if(job.kind==='reminder'){
    if(lead.stage==='New'&&!lead.first_contacted_at){const message='⏰ '+lead.first_name+" hasn't been contacted yet.\n"+origin+'/admin/leads/'+lead.id;if(env.TELEGRAM_BOT_TOKEN)await sendTelegram(message,env);else await sendEmail(message,job.id,env);}
   }
   else if(job.kind.startsWith('digest_')){
    const text=digest(await listLeads(db),new Date(now()))+'\nOpen: '+origin+'/admin';
    if(job.kind==='digest_telegram')await sendTelegram(text,env);else await sendEmail(text,job.id,env);
   }
   await db.query("UPDATE jobs SET status='done',locked_until=0,last_error=NULL WHERE id=$1",[job.id]);
  }catch(error){
   // Never persist provider response bodies, request URLs, tokens or PII in job errors.
   const wait=error.configuration?60000:Math.min(3600000,5000*2**Math.min(Number(job.attempts),9));
   await db.query("UPDATE jobs SET status='pending',locked_until=0,due_at=$1,last_error=$2 WHERE id=$3",[now()+wait,error.configuration?error.message:'Delivery failed; queued for retry',job.id]);
  }
 }));
 return jobs.length;
}
