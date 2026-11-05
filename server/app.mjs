import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {rateLimit,listLeads,getLead,changeLead} from './db.mjs';
import {saveLead,updateLead,handoff,stats,csv,UUID,problem} from './pipeline.mjs';
import {runJobs} from './jobs.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const SESSION_SECONDS=30*24*60*60;
const SESSION_MS=SESSION_SECONDS*1000;
const SESSION_RENEW_WINDOW=29*24*60*60*1000;
function sessionCookie(token,production){return 'via21_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+SESSION_SECONDS+'; Expires='+new Date(Date.now()+SESSION_MS).toUTCString()+(production?'; Secure':'');}
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw problem('JSON required',415);
 let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>24576)throw problem('Request is too large',413);}
 try{const parsed=JSON.parse(raw);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error();return parsed;}catch{throw problem('Invalid JSON');}
}
function cookie(req,name){return String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';}
export function createApp(db,{env=process.env}={}){
 const origin=env.PUBLIC_ORIGIN,adminPassword=env.ADMIN_PASSWORD;
 if(!origin||!adminPassword||adminPassword.length<16)throw new Error('PUBLIC_ORIGIN and a strong ADMIN_PASSWORD are required');
 const allowed=new Set([new URL(origin).origin,...String(env.ALLOWED_FORM_ORIGINS||'').split(',').filter(Boolean).map(x=>new URL(x).origin)]);
 const salt=randomBytes(32),expected=scryptSync(adminPassword,salt,64);
 let workerRunning=false;
 const wake=()=>{if(!workerRunning){workerRunning=true;runJobs(db,{env}).catch(()=>{}).finally(()=>workerRunning=false);}};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,origin),pathname=url.pathname;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  const privateRoute=pathname.startsWith('/admin')||pathname.startsWith('/api/admin');
  if(privateRoute){res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");}
  try{
   const ip=(env.NODE_ENV==='production'?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').at(-1):req.socket.remoteAddress)?.trim()||'unknown';
   if(pathname==='/api/leads'){
    const requestOrigin=req.headers.origin;
    if(requestOrigin&&!allowed.has(requestOrigin))throw problem('Origin not allowed',403);
    if(requestOrigin){res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Idempotency-Key');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');}
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    if(req.method!=='POST')throw problem('Method not allowed',405);
    if(!await rateLimit(db,'lead:'+digest(ip),10,600000))throw problem('Too many requests. Try again shortly.',429);
    const input=await body(req);
    const pageOrigin=requestOrigin||origin;
    const result=await saveLead(db,input,pageOrigin,{clientIp:ip,userAgent:String(req.headers['user-agent']||'').slice(0,1000)});
    if(result.spam)return json(res,202,{success:false});
    json(res,result.duplicate?200:201,{success:true,event_id:result.lead.id});
    setImmediate(wake);return;
   }
   if(pathname==='/healthz'){await db.query('SELECT 1 AS healthy');return json(res,200,{ok:true});}
   if(pathname==='/api/admin/login'&&req.method==='POST'){
    if(!await rateLimit(db,'login:'+digest(ip),8,900000))throw problem('Too many login attempts',429);
    const data=await body(req);
    if(req.headers.origin&&req.headers.origin!==origin)throw problem('Origin not allowed',403);
    const supplied=typeof data.password==='string'&&data.password.length<=200?data.password:'';
    const valid=timingSafeEqual(scryptSync(supplied,salt,64),expected);
    if(data.username!==(env.ADMIN_USERNAME||'caesar')||!valid)throw problem('Incorrect login',401);
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
    await db.query('INSERT INTO sessions (id,expires_at,data) VALUES ($1,$2,$3)',[digest(token),Date.now()+SESSION_MS,JSON.stringify({csrf})]);
    res.setHeader('Set-Cookie',sessionCookie(token,env.NODE_ENV==='production'));
    return json(res,200,{csrf});
   }
   let session;
   if(pathname.startsWith('/api/admin')){
    const token=cookie(req,'via21_session');
    if(!/^[0-9a-f]{64}$/.test(token))throw problem('Login required',401);
    const row=(await db.query('SELECT data,expires_at FROM sessions WHERE id=$1',[digest(token)])).rows[0];
    if(!row||Number(row.expires_at)<=Date.now())throw problem('Login required',401);
    session=JSON.parse(row.data);
    // Refresh once a day; also upgrades still-valid legacy 12-hour sessions.
    if(Number(row.expires_at)-Date.now()<SESSION_RENEW_WINDOW){
     await db.query('UPDATE sessions SET expires_at=$1 WHERE id=$2',[Date.now()+SESSION_MS,digest(token)]);
     res.setHeader('Set-Cookie',sessionCookie(token,env.NODE_ENV==='production'));
    }
    if(!['GET','HEAD'].includes(req.method)&&(req.headers['x-csrf-token']!==session.csrf||(req.headers.origin&&req.headers.origin!==origin)))throw problem('Invalid session request',403);
    if(pathname==='/api/admin/session')return json(res,200,{csrf:session.csrf,username:env.ADMIN_USERNAME||'caesar'});
    if(pathname==='/api/admin/logout'&&req.method==='POST'){await db.query('DELETE FROM sessions WHERE id=$1',[digest(token)]);res.setHeader('Set-Cookie','via21_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'+(env.NODE_ENV==='production'?'; Secure':''));return json(res,200,{ok:true});}
    if(pathname==='/api/admin/leads'&&req.method==='GET'){const leads=await listLeads(db);return json(res,200,{leads,stats:stats(leads)});}
    if(pathname==='/api/admin/export.csv'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="via21-leads.csv"'});return res.end(csv(await listLeads(db)));}
    if(pathname==='/api/admin/status'&&req.method==='GET'){
     const counts=(await db.query("SELECT kind,status,COUNT(*) AS count FROM jobs GROUP BY kind,status")).rows;
     return json(res,200,{office_email_configured:!!env.OFFICE_EMAIL,telegram_configured:!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID),email_configured:!!(env.RESEND_API_KEY&&env.ALERT_EMAIL&&env.EMAIL_FROM),capi_configured:!!env.META_CAPI_ACCESS_TOKEN,sheet_enabled:!!env.SHEET_BACKUP_URL,free_test_mode:env.FREE_TEST_MODE==='true',jobs:counts});
    }
    const match=pathname.match(/^\/api\/admin\/leads\/([0-9a-f-]+)(\/handoff)?$/i);
    if(match&&UUID.test(match[1])){
     if(match[2]&&req.method==='POST'){let mailto;const lead=await changeLead(db,match[1],l=>{mailto=handoff(l,env.OFFICE_EMAIL);});if(!lead)throw problem('Lead not found',404);return json(res,200,{lead,mailto});}
     if(!match[2]&&req.method==='GET'){const lead=await getLead(db,match[1]);if(!lead)throw problem('Lead not found',404);return json(res,200,{lead});}
     if(!match[2]&&req.method==='PATCH'){const lead=await updateLead(db,match[1],await body(req));if(!lead)throw problem('Lead not found',404);return json(res,200,{lead});}
    }
    throw problem('Not found',404);
   }
   if(req.method!=='GET'&&req.method!=='HEAD')throw problem('Method not allowed',405);
   let filename;
   if(pathname==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('User-agent: *\nDisallow: /admin\nDisallow: /api/\n');}
   if(pathname==='/settings.js'){
    // Only public campaign settings are returned. Tokens and admin credentials never enter this object.
    const publicSettings={price:env.CAMPAIGN_PRICE||'$1,650',offer:env.CAMPAIGN_OFFER||'up to 1 month free',furnishedQuestion:true,webhook:'/api/leads',privacyUrl:env.PRIVACY_URL||'',calendarUrl:env.CALENDAR_URL||'https://via21apartments.com'};
    res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});return res.end('window.CAMPAIGN = '+JSON.stringify(publicSettings)+';');
   }
   if(pathname.startsWith('/admin'))filename=pathname==='/admin/admin.js'||pathname==='/admin/admin.css'?path.join(root,'admin',pathname.split('/').at(-1)):path.join(root,'admin/index.html');
   else {const relative=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1);filename=path.resolve(root,'dist',relative);if(!filename.startsWith(path.join(root,'dist')+path.sep))throw problem('Not found',404);}
   let content;try{content=await readFile(filename);}catch{throw problem('Not found',404);}
   const ext=path.extname(filename),types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};
   res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':privateRoute?'no-store':ext==='.html'?'no-cache':'public, max-age=60'});
   return res.end(req.method==='HEAD'?undefined:content);
  }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'Server error. Please try again.'});else res.end();}
 });
 const timer=setInterval(wake,2000);timer.unref();
 server.on('close',()=>clearInterval(timer));
 return {server,wake};
}
