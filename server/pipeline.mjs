import {createHash,randomUUID} from 'node:crypto';
import {enqueue,changeLead,listLeads} from './db.mjs';
export const STAGES=['New','Contacted','Tour Scheduled','Toured','Applied','Leased','Lost'];
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function problem(message,status=400){return Object.assign(new Error(message),{status});}
function text(value,max=200){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw problem('Invalid input');return value.trim();}
export function validateLead(input,origin){
 if(input.website)return {spam:true};
 const id=input.event_id||input.id;if(!UUID.test(id||''))throw problem('Invalid submission ID');
 const names=text(input.name||[input.first_name,input.last_name].filter(Boolean).join(' '),120).split(/\s+/);
 if(names.length<2||!names.every(n=>n.length>0))throw problem('First and last name are required');
 const first_name=names.shift(),last_name=names.join(' ');
 let phone=text(input.phone,30).replace(/\D/g,'');if(phone.length===10)phone='1'+phone;
 if(!/^1[2-9]\d{2}[2-9]\d{6}$/.test(phone))throw problem('Enter a valid US mobile number');
 const email=text(input.email,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw problem('Enter a valid email');
 const answers=input.answers||{};
 const furnished=text(input.furnished??answers['Furnished or unfurnished?']??'',30);
 const bedrooms=Number(input.bedrooms??String(answers['How many bedrooms?']||'').slice(0,1));
 const move_in=text(input.move_in??answers['When do you want to move in?']??'',30);
 if(!['Furnished','Unfurnished','Open to either'].includes(furnished)||![1,2].includes(bedrooms)||!['This month','Next month','2+ months out'].includes(move_in))throw problem('Answer all three apartment questions');
 const ad_source=text(input.ad_source||'direct',100);
 const utm={};for(const [key,value] of Object.entries({...input,...input.utm})){if(/^utm_[a-z0-9_]+$/i.test(key))utm[key]=text(value,500);}
 let source;try{source=new URL(input.event_source_url||origin);if(source.origin!==origin)throw Error();}catch{throw problem('Invalid page URL');}
 const record={id,event_id:id,created_at:new Date().toISOString(),first_name,last_name,phone,email,furnished,bedrooms,move_in,ad_source,utm,...utm,stage:'New',first_contacted_at:null,sent_to_office_at:null,notes:[],lost_reason:null,tour_at:null,stage_log:[],stage_changed_at:new Date().toISOString(),event_time:Math.floor(Date.now()/1000),event_source_url:source.href};
 for(const key of ['fbp','fbc'])if(input[key]){const value=text(input[key],500);if(/^fb\.\d+\.\d+\..+$/.test(value))record[key]=value;}
 return record;
}
export function metaRecord(lead){return {name:lead.first_name+' '+lead.last_name,email:lead.email,phone:lead.phone,event_id:lead.id,lead_id:lead.id,event_time:lead.event_time,event_source_url:lead.event_source_url,ad_source:lead.ad_source,fbp:lead.fbp,fbc:lead.fbc};}
export async function saveLead(db,input,origin,context={}){
 const lead=validateLead(input,origin);if(lead.spam)return {spam:true};
 const fingerprint=createHash('sha256').update(JSON.stringify([lead.first_name,lead.last_name,lead.email,lead.phone,lead.furnished,lead.bedrooms,lead.move_in])).digest('hex');
 lead.fingerprint=fingerprint;lead.stage_log=[{at:lead.created_at,from:null,to:'New',actor:'Form'}];
 return db.tx('lead:'+lead.id,async q=>{
  const existing=(await q('SELECT data FROM leads WHERE id=$1',[lead.id])).rows[0];
  if(existing){const stored=JSON.parse(existing.data);if(stored.fingerprint!==fingerprint)throw problem('Submission ID was already used',409);return {lead:stored,duplicate:true};}
  await q('INSERT INTO leads (id,created_at,data) VALUES ($1,$2,$3)',[lead.id,Date.parse(lead.created_at),JSON.stringify(lead)]);
  for(const kind of ['capi','telegram','email','sheet'])await enqueue(q,{id:kind+':'+lead.id,kind,leadId:lead.id,data:kind==='capi'?{context}:{}});
  await enqueue(q,{id:'reminder:'+lead.id,kind:'reminder',leadId:lead.id,dueAt:Date.parse(lead.created_at)+600000});
  return {lead,duplicate:false};
 });
}
export async function updateLead(db,id,input,now=new Date()){
 return changeLead(db,id,lead=>{
  const at=now.toISOString();
  if(input.stage!==undefined){
   if(!STAGES.includes(input.stage))throw problem('Invalid stage');
   if(input.stage==='Lost'&&!String(input.lost_reason||lead.lost_reason||'').trim())throw problem('Lost reason is required');
   if(input.stage!==lead.stage){if(!lead.first_contacted_at&&lead.stage==='New')lead.first_contacted_at=at;lead.stage_log.push({at,from:lead.stage,to:input.stage,actor:'Caesar'});lead.stage=input.stage;lead.stage_changed_at=at;}
  }
  if(input.lost_reason!==undefined)lead.lost_reason=text(input.lost_reason,1000)||null;
  if(lead.stage==='Lost'&&!lead.lost_reason)throw problem('Lost reason is required');
  if(input.tour_at!==undefined){if(input.tour_at!==null&&input.tour_at!==''&&!Number.isFinite(Date.parse(input.tour_at)))throw problem('Invalid tour date');lead.tour_at=input.tour_at?new Date(input.tour_at).toISOString():null;}
  if(lead.stage==='Tour Scheduled'&&!lead.tour_at)throw problem('Tour date and time are required');
  if(input.note!==undefined){const body=text(input.note,5000);if(!body)throw problem('Note is empty');lead.notes.push({id:randomUUID(),at,author:'Caesar',text:body});}
 });
}
export function handoff(lead,officeEmail,now=new Date()){
 if(!officeEmail||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officeEmail))throw problem('Leasing-office email is not configured',503);
 const body=[lead.first_name+' '+lead.last_name,'Phone: +'+lead.phone,'Email: '+lead.email,'Bedrooms: '+lead.bedrooms,'Move-in: '+lead.move_in,'Submitted: '+lead.created_at,'','Referred by Caesar Mora / Local Insider'].join('\n');
 const mailto='mailto:'+encodeURIComponent(officeEmail)+'?subject='+encodeURIComponent('Via 21 tour inquiry — '+lead.first_name+' '+lead.last_name)+'&body='+encodeURIComponent(body);
 // Opening a mail client is the requested handoff action; it cannot prove actual email delivery.
 lead.sent_to_office_at ||= now.toISOString();lead.office_handoff_log ||= [];lead.office_handoff_log.push({at:now.toISOString(),action:'Email draft opened',recipient:officeEmail});
 return mailto;
}
export function phoenixDate(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function stats(leads,now=new Date()){
 const day=phoenixDate(now);const midnight=Date.parse(day+'T00:00:00-07:00');const weekday=new Date(midnight-7*3600000).getUTCDay();const week=midnight-((weekday+6)%7)*86400000;
 const byStage=Object.fromEntries(STAGES.map(s=>[s,0])),bySource={};const contact=[];
 for(const l of leads){byStage[l.stage]++;bySource[l.ad_source]=(bySource[l.ad_source]||0)+1;if(l.first_contacted_at)contact.push((Date.parse(l.first_contacted_at)-Date.parse(l.created_at))/60000);}
 return {leads_this_week:leads.filter(l=>Date.parse(l.created_at)>=week).length,average_minutes_to_first_contact:contact.length?contact.reduce((a,b)=>a+b,0)/contact.length:null,by_stage:byStage,by_source:bySource,commission_earned:byStage.Leased*1000};
}
export function csv(leads){
 const fields=['id','created_at','first_name','last_name','phone','email','furnished','bedrooms','move_in','ad_source','utm_source','utm_campaign','utm_content','stage','first_contacted_at','sent_to_office_at','tour_at','lost_reason','notes'];
 const cell=value=>{let s=typeof value==='object'?JSON.stringify(value):String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 return '\ufeff'+[fields.join(','),...leads.map(l=>fields.map(k=>cell(l[k])).join(','))].join('\r\n');
}
