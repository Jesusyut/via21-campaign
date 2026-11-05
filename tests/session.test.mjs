process.env.NODE_ENV='test';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/app.mjs';

const env={NODE_ENV:'production',PUBLIC_ORIGIN:'https://via21.example',ADMIN_PASSWORD:'remember-test-password-32-characters'};
const headers={'Content-Type':'application/json'};
async function launch(db){const {server}=createApp(db,{env});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port};}
const stop=server=>new Promise(r=>server.close(r));
const login=async url=>{const response=await fetch(url+'/api/admin/login',{method:'POST',headers,body:JSON.stringify({username:'caesar',password:env.ADMIN_PASSWORD})});assert.equal(response.status,200);const setCookie=response.headers.get('set-cookie');return {cookie:setCookie.split(';')[0],setCookie,...await response.json()};};
test('remembered device survives a new server instance, renews legacy sessions, and signs out immediately',async()=>{
 const db=await openDatabase({sqlitePath:':memory:'});let running=await launch(db);
 try{
  const auth=await login(running.url);
  assert.match(auth.setCookie,/Max-Age=2592000/);assert.match(auth.setCookie,/Expires=/);assert.match(auth.setCookie,/HttpOnly/);assert.match(auth.setCookie,/SameSite=Strict/);assert.match(auth.setCookie,/Secure/);
  const token=auth.cookie.split('=')[1],id=createHash('sha256').update(token).digest('hex');
  const row=(await db.query('SELECT expires_at FROM sessions WHERE id=$1',[id])).rows[0];
  assert.ok(Number(row.expires_at)>Date.now()+29*86400000);
  // The same persistent browser cookie is accepted after restart/deploy.
  await stop(running.server);running=await launch(db);
  let response=await fetch(running.url+'/api/admin/session',{headers:{Cookie:auth.cookie}});assert.equal(response.status,200);assert.equal((await response.json()).csrf,auth.csrf);
  // A still-valid old short session gets upgraded without asking for a password.
  await db.query('UPDATE sessions SET expires_at=$1 WHERE id=$2',[Date.now()+3600000,id]);
  response=await fetch(running.url+'/api/admin/session',{headers:{Cookie:auth.cookie}});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=2592000/);
  assert.ok(Number((await db.query('SELECT expires_at FROM sessions WHERE id=$1',[id])).rows[0].expires_at)>Date.now()+29*86400000);
  response=await fetch(running.url+'/api/admin/logout',{method:'POST',headers:{...headers,Cookie:auth.cookie,'X-CSRF-Token':auth.csrf},body:'{}'});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
  response=await fetch(running.url+'/api/admin/session',{headers:{Cookie:auth.cookie}});assert.equal(response.status,401);
  // Inactive/expired sessions must not be resurrected by rolling renewal.
  const second=await login(running.url);const secondId=createHash('sha256').update(second.cookie.split('=')[1]).digest('hex');
  await db.query('UPDATE sessions SET expires_at=$1 WHERE id=$2',[Date.now()-1000,secondId]);
  response=await fetch(running.url+'/api/admin/session',{headers:{Cookie:second.cookie}});assert.equal(response.status,401);
 }finally{await stop(running.server);await db.close();}
});
test('a temporary startup connection failure retries the saved session instead of showing login',async()=>{
 const source=readFileSync(new URL('../admin/admin.js',import.meta.url),'utf8').match(/async function start\(\)[^\n]+/)[0];
 const nodes=Object.fromEntries(['#login','#dashboard','#session-status','#detail','#board-error'].map(k=>[k,{hidden:k!=='#login',open:false,textContent:''}]));
 let retry,attempts=0,loginShown=0,loaded=0;
 const context={csrf:'',reconnectTimer:undefined,$:key=>nodes[key],api:async()=>{if(++attempts===1)throw Error('Network unavailable');return {csrf:'saved-session-csrf'};},showLogin:()=>loginShown++,load:async()=>loaded++,location:{pathname:'/admin'},openDetail:async()=>{},clearTimeout(){},setTimeout(fn){retry=fn;return 1;}};
 vm.createContext(context);vm.runInContext(source,context);
 await vm.runInContext('start()',context);
 assert.equal(loginShown,0);assert.equal(nodes['#login'].hidden,true);assert.equal(nodes['#session-status'].hidden,false);assert.equal(typeof retry,'function');
 await retry();assert.equal(loaded,1);assert.equal(nodes['#dashboard'].hidden,false);assert.equal(nodes['#session-status'].hidden,true);assert.equal(context.csrf,'saved-session-csrf');
});
