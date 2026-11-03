import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import {buildLeadEvent,sendLeadEvent} from '../server/meta-capi.mjs';
import {acceptTourInquiry,deliverMetaOutboxJob} from '../server/tour-inquiry.mjs';

const browserSource=readFileSync(new URL('../dist/lead-tracking.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const lead={timestamp:new Date().toISOString(),name:'Test Person',phone:'+16025550123',email:'test@example.com',answers:{bedrooms:'2 bedrooms'}};
const hash=value=>createHash('sha256').update(value).digest('hex');
function browser(fetchImpl,{query='?ad=offer&utm_source=meta&utm_medium=paid&utm_term=apartments&fbclid=click123',cookie=''}={}){
 const events=[];
 const window={location:{search:query,href:'https://via21-campaign-test.onrender.com/'+query},document:{cookie},crypto:{randomUUID},fetch:fetchImpl,fbq:(...args)=>events.push(args)};
 const ctx=vm.createContext({window,URLSearchParams,Date});
 vm.runInContext(browserSource,ctx);
 return {tracker:window.createVia21LeadTracking({adSource:new URLSearchParams(query).get('ad')||'direct'}),events,window};
}
const ok=()=>({ok:true,headers:{get:()=>null}});
test('base snippet queues one init and PageView without advanced matching',()=>{
 assert.equal((html.match(/<!-- Meta Pixel Code -->/g)||[]).length,1);
 assert.equal((html.match(/fbq\('init'/g)||[]).length,1);
 assert.ok(html.indexOf('Meta Pixel Code')<html.indexOf('name="viewport"'));
 assert.ok(html.includes('noscript=1'));
 const inserted=[];
 const document={createElement:()=>({}),getElementsByTagName:()=>[{parentNode:{insertBefore:node=>inserted.push(node)}}]};
 const window={};
 const ctx=vm.createContext({window,document});
 // fbq in a real browser is a window global; expose the same binding in the VM.
 Object.defineProperty(ctx,'fbq',{get:()=>window.fbq});
 vm.runInContext(html.match(/<!-- Meta Pixel Code -->\s*<script>([\s\S]*?)<\/script>/)[1],ctx);
 assert.equal(inserted.length,1);
 assert.equal(inserted[0].src,'https://connect.facebook.net/en_US/fbevents.js');
 assert.deepEqual(Array.from(window.fbq.queue[0]),['init','2550232255445742']);
 assert.deepEqual(Array.from(window.fbq.queue[1]),['track','PageView']);
 assert.equal(window.fbq.queue.length,2);
});
test('no Lead before successful acknowledgement; concurrent and subsequent submits ignored',async()=>{
 let resolve,calls=0,payload;
 const {tracker,events}=browser(async(url,options)=>{calls++;payload=JSON.parse(options.body);return new Promise(r=>resolve=r);});
 assert.equal(events.length,0);
 const sending=tracker.submit('/lead',lead);
 assert.equal(tracker.busy,true);
 assert.equal(events.length,0);
 assert.equal((await tracker.submit('/lead',lead)).ignored,true);
 resolve(ok());const result=await sending;
 assert.equal(calls,1);assert.equal(events.length,1);
 assert.equal(events[0][1],'Lead');assert.equal(events[0][2].ad_source,'offer');
 assert.equal(result.event_id,payload.event_id);assert.equal(payload.lead_id,payload.event_id);
 assert.equal(events[0][3].eventID,payload.event_id);
 assert.deepEqual(Object.keys(events[0][2]).sort(),['ad_source','content_category','content_name']);
 assert.equal(payload.utm.utm_term,'apartments');assert.equal(payload.utm_medium,'paid');
 assert.match(payload.fbc,/^fb\.1\.\d+\.click123$/);
 await tracker.submit('/lead',lead);assert.equal(calls,1);
});
test('failed HTTP/JSON submissions do not fire Lead and retries reuse event ID',async()=>{
 const payloads=[];let attempt=0;
 const {tracker,events}=browser(async(url,options)=>{
  payloads.push(JSON.parse(options.body));attempt++;
  if(attempt===1)return {ok:false};
  if(attempt===2)return {ok:true,headers:{get:()=>'application/json'},json:async()=>({success:false})};
  return ok();
 });
 await assert.rejects(tracker.submit('/lead',lead));
 await assert.rejects(tracker.submit('/lead',lead));
 assert.equal(events.length,0);assert.equal(tracker.busy,false);
 await tracker.submit('/lead',lead);
 assert.equal(events.length,1);assert.equal(new Set(payloads.map(p=>p.event_id)).size,1);
});
test('existing Meta cookies survive and direct/UTM attribution is preserved',async()=>{
 let payload;
 const {tracker}=browser(async(url,options)=>{payload=JSON.parse(options.body);return ok();},{query:'?utm_content=test',cookie:'_fbp=fb.1.123.browser; _fbc=fb.1.456.existing'});
 await tracker.submit('/lead',lead);
 assert.equal(payload.ad_source,'direct');assert.equal(payload.utm_content,'test');
 assert.equal(payload.fbp,'fb.1.123.browser');assert.equal(payload.fbc,'fb.1.456.existing');
});
test('Meta blocking does not turn a saved lead into a retry',async()=>{
 let calls=0;
 const {tracker,window}=browser(async()=>{calls++;return ok();});
 window.fbq=()=>{throw new Error('Pixel blocked');};
 await tracker.submit('/lead',lead);await tracker.submit('/lead',lead);
 assert.equal(calls,1);assert.equal(tracker.completed,true);
});
const saved={...lead,email:' Test@Example.COM ',name:' Test Person ',phone:'(602) 555-0123',event_id:randomUUID(),event_time:Math.floor(Date.now()/1000),ad_source:'offer',event_source_url:'https://via21-campaign-test.onrender.com/?ad=offer',fbp:'fb.1.1.browser',fbc:'fb.1.2.click',utm:{utm_source:'meta'},income:'must not transmit'};
saved.lead_id=saved.event_id;
test('CAPI hashes normalized identifiers, preserves matching ID and excludes answers/traits',()=>{
 const event=buildLeadEvent(saved,{clientIp:'192.0.2.1',userAgent:'Test UA'});
 assert.equal(event.event_id,saved.event_id);assert.equal(event.event_name,'Lead');
 assert.deepEqual(event.user_data.em,[hash('test@example.com')]);
 assert.deepEqual(event.user_data.ph,[hash('16025550123')]);
 assert.deepEqual(event.user_data.fn,[hash('test')]);assert.deepEqual(event.user_data.ln,[hash('person')]);
 assert.equal(event.user_data.client_ip_address,'192.0.2.1');assert.equal(event.user_data.client_user_agent,'Test UA');
 assert.equal(event.user_data.fbc,saved.fbc);
 const serialized=JSON.stringify(event);
 for(const excluded of ['answers','bedrooms','income','utm_source','test@example.com','16025550123'])assert.ok(!serialized.includes(excluded));
 assert.deepEqual(Object.keys(event.custom_data).sort(),['ad_source','content_category','content_name']);
});
test('CAPI uses server credentials and Test events code; rejects Meta errors',async()=>{
 let url,options;
 const event=buildLeadEvent(saved);
 const result=await sendLeadEvent(event,{accessToken:'FAKE_TEST_TOKEN',testEventCode:'TEST_CODE',fetchImpl:async(u,o)=>{url=u;options=o;return {ok:true,json:async()=>({events_received:1,messages:[]})};}});
 assert.equal(result.events_received,1);assert.equal(url,'https://graph.facebook.com/v26.0/2550232255445742/events');
 assert.ok(!url.includes('FAKE_TEST_TOKEN'));assert.equal(options.headers.Authorization,'Bearer FAKE_TEST_TOKEN');
 assert.equal(JSON.parse(options.body).test_event_code,'TEST_CODE');
 assert.equal(JSON.parse(options.body).data[0].event_id,event.event_id);
 await assert.rejects(sendLeadEvent(event,{accessToken:'',fetchImpl:()=>{throw Error('must not call');}}));
 await assert.rejects(sendLeadEvent(event,{accessToken:'FAKE',fetchImpl:async()=>({ok:true,json:async()=>({events_received:0})})}));
});
test('lead acceptance waits for durable save/outbox acknowledgement and preserves attribution',async()=>{
 let queued;
 const result=await acceptTourInquiry(saved,{clientIp:'192.0.2.1',userAgent:'UA'},{persistWithOutbox:async job=>{queued=job;return job.record;}});
 assert.equal(result.event_id,saved.event_id);
 assert.equal(queued.record.utm.utm_source,'meta');assert.equal(queued.event.event_id,queued.record.event_id);
 assert.deepEqual(queued.record.answers,saved.answers);
 await assert.rejects(acceptTourInquiry(saved,{}, {persistWithOutbox:async()=>{throw Error('store offline');}}));
 await assert.rejects(acceptTourInquiry(saved,{}, {persistWithOutbox:async()=>({})}));
 let sent=false;
 await deliverMetaOutboxJob(queued,{accessToken:'FAKE',fetchImpl:async()=>{sent=true;return {ok:true,json:async()=>({events_received:1})};}});
 assert.equal(sent,true);
});
