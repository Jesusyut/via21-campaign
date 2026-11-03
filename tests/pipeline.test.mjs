process.env.NODE_ENV='test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase,getLead,listLeads,changeLead} from '../server/db.mjs';
import {saveLead,updateLead,handoff,stats,csv} from '../server/pipeline.mjs';
import {runJobs,digest} from '../server/jobs.mjs';
import {createApp} from '../server/app.mjs';
const origin='https://via21.test';
const input=(extra={})=>({event_id:randomUUID(),name:'Pipeline Test',phone:'6025550123',email:'pipeline@example.com',furnished:'Unfurnished',bedrooms:2,move_in:'Next month',ad_source:'offer',utm:{utm_source:'meta',utm_campaign:'test',utm_content:'example',utm_term:'all preserved'},event_source_url:origin+'/?ad=offer',...extra});
async function db(){return openDatabase({sqlitePath:':memory:'});}

test('lead and delivery jobs save atomically; idempotent retry creates one row',async()=>{
 const store=await db();try{
  const data=input();const first=await saveLead(store,data,origin);const second=await saveLead(store,data,origin);
  assert.equal(first.lead.id,data.event_id);assert.equal(first.lead.phone,'16025550123');assert.equal(first.lead.stage,'New');
  assert.equal(second.duplicate,true);assert.equal((await listLeads(store)).length,1);
  assert.equal((await store.query('SELECT * FROM jobs')).rows.length,5);
  assert.equal(first.lead.utm_term,'all preserved');
  await assert.rejects(saveLead(store,{...data,phone:'6025550199'},origin),/already used/);
  await assert.rejects(saveLead(store,input({bedrooms:5}),origin),/three apartment/);
  const spam=await saveLead(store,{website:'spam'},origin);assert.equal(spam.spam,true);
 }finally{await store.close();}
});
test('failed storage rolls back the lead and outbox together',async()=>{
 const store=await db();try{
  const data=input();
  const broken={...store,tx:async(key,fn)=>store.tx(key,async q=>fn(async(sql,values)=>{if(sql.startsWith('INSERT INTO jobs'))throw Error('disk error');return q(sql,values);}))};
  await assert.rejects(saveLead(broken,data,origin),/disk error/);
  assert.equal((await listLeads(store)).length,0);
 }finally{await store.close();}
});
test('first-contact time set once; notes, stage log, lost reason and office handoff persist',async()=>{
 const store=await db();try{
  const {lead}=await saveLead(store,input(),origin);
  const time=new Date(Date.parse(lead.created_at)+120000);
  let changed=await updateLead(store,lead.id,{stage:'Contacted',note:'Called; requested tomorrow.'},time);
  assert.equal(changed.first_contacted_at,time.toISOString());assert.equal(changed.notes.length,1);
  changed=await updateLead(store,lead.id,{stage:'Tour Scheduled',tour_at:'2026-11-05T10:00:00-07:00'},new Date(time.getTime()+60000));
  assert.equal(changed.first_contacted_at,time.toISOString());assert.equal(changed.stage_log.length,3);
  await assert.rejects(updateLead(store,lead.id,{stage:'Lost'}),/Lost reason/);
  changed=await updateLead(store,lead.id,{stage:'Lost',lost_reason:'Timing changed'});assert.equal(changed.lost_reason,'Timing changed');
  let mailto;await changeLead(store,lead.id,l=>{mailto=handoff(l,'office@example.com');});
  assert.match(mailto,/^mailto:office%40example.com/);assert.ok(decodeURIComponent(mailto).includes('Referred by Caesar Mora / Local Insider'));
  const persisted=await getLead(store,lead.id);assert.ok(persisted.sent_to_office_at);assert.equal(persisted.office_handoff_log.length,1);
 }finally{await store.close();}
});
test('provider failures do not lose a lead, and one reminder is scheduled then completed',async()=>{
 const store=await db();try{
  const {lead}=await saveLead(store,input(),origin);
  let notices=0;
  const env={PUBLIC_ORIGIN:origin,TELEGRAM_BOT_TOKEN:'TEST',TELEGRAM_CHAT_ID:'TEST',ALERT_EMAIL:'test@example.com'};
  await runJobs(store,{env,sendTelegram:async()=>{throw Error('network down');}});
  assert.equal((await listLeads(store)).length,1);
  assert.equal((await store.query("SELECT status FROM jobs WHERE kind='telegram'")).rows[0].status,'pending');
  await store.query("UPDATE jobs SET status='done' WHERE kind<>'reminder'");
  const when=Date.parse(lead.created_at)+601000;
  await runJobs(store,{env,now:()=>when,sendTelegram:async text=>{assert.match(text,/hasn't been contacted/);notices++;}});
  await runJobs(store,{env,now:()=>when+1000,sendTelegram:async()=>notices++});
  assert.equal(notices,1);
 }finally{await store.close();}
});
test('contacted leads get no reminder; Phoenix digest uses scheduled tour dates',async()=>{
 const store=await db();try{
  const {lead}=await saveLead(store,input(),origin);
  await updateLead(store,lead.id,{stage:'Contacted'});
  await store.query("UPDATE jobs SET status='done' WHERE kind<>'reminder'");
  let notices=0;const when=Date.parse(lead.created_at)+601000;
  await runJobs(store,{env:{PUBLIC_ORIGIN:origin,TELEGRAM_BOT_TOKEN:'TEST'},now:()=>when,sendTelegram:async text=>{if(text.startsWith('⏰'))notices++;}});assert.equal(notices,0);
  const text=digest([{...lead,stage:'Tour Scheduled',tour_at:'2026-11-05T23:30:00-07:00'}],new Date('2026-11-06T05:00:00Z'));
  assert.ok(text.includes('Tours scheduled today: 1'));
 }finally{await store.close();}
});
test('stats compute commission and contact speed; CSV neutralizes spreadsheet formulas',()=>{
 const now=new Date('2026-11-04T12:00:00-07:00');
 const records=[{id:'1',created_at:'2026-11-03T10:00:00-07:00',first_contacted_at:'2026-11-03T10:04:00-07:00',stage:'Leased',ad_source:'offer',first_name:'=HYPERLINK("bad")'}];
 const result=stats(records,now);assert.equal(result.leads_this_week,1);assert.equal(result.commission_earned,1000);assert.equal(result.average_minutes_to_first_contact,4);assert.equal(result.by_stage.Leased,1);assert.ok(csv(records).includes("'=HYPERLINK"));
});
test('HTTP authentication, CSRF, lead submit, noindex, notes and handoff',async()=>{
 const store=await db(),env={PUBLIC_ORIGIN:origin,ADMIN_PASSWORD:'test-password-at-least-24-chars',NODE_ENV:'test',OFFICE_EMAIL:'office@example.com',FREE_TEST_MODE:'true'};
 const {server}=createApp(store,{env});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  let response=await fetch(base+'/api/admin/leads');assert.equal(response.status,401);
  response=await fetch(base+'/admin');assert.equal(response.status,200);assert.match(response.headers.get('x-robots-tag'),/noindex/);
  response=await fetch(base+'/server/meta-capi.mjs');assert.equal(response.status,404);
  response=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'caesar',password:env.ADMIN_PASSWORD})});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0],{csrf}=await response.json();
  response=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:JSON.stringify(input())});assert.equal(response.status,201);const {event_id:id}=await response.json();
  response=await fetch(base+'/api/admin/leads/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','Cookie':cookie},body:JSON.stringify({stage:'Contacted'})});assert.equal(response.status,403);
  response=await fetch(base+'/api/admin/leads/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','Cookie':cookie,'X-CSRF-Token':csrf},body:JSON.stringify({stage:'Contacted',note:'Test note'})});assert.equal(response.status,200);
  response=await fetch(base+'/api/admin/leads/'+id+'/handoff',{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookie,'X-CSRF-Token':csrf},body:'{}'});assert.equal(response.status,200);assert.ok((await response.json()).mailto.startsWith('mailto:'));
  response=await fetch(base+'/api/admin/export.csv',{headers:{Cookie:cookie}});assert.equal(response.status,200);
  response=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://evil.example'},body:JSON.stringify(input())});assert.equal(response.status,403);
 }finally{await new Promise(resolve=>server.close(resolve));await store.close();}
});
