export async function openDatabase({url=process.env.DATABASE_URL,sqlitePath}={}){
 let pool,sqlite,tail=Promise.resolve();
 if(url){const {default:pg}=await import('pg');pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:10000});}
 else if(sqlitePath!==undefined&&process.env.NODE_ENV!=='production'){const {DatabaseSync}=await import('node:sqlite');sqlite=new DatabaseSync(sqlitePath);sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');}
 else throw new Error('DATABASE_URL must be configured; production never uses ephemeral storage');
 async function query(sql,values=[],client){
  if(pool)return (client||pool).query(sql,values);
  const bindings=[];const converted=sql.replace(/\$(\d+)/g,(_,n)=>{bindings.push(values[Number(n)-1]);return '?';});
  const statement=sqlite.prepare(converted);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:statement.all(...bindings)};
  const result=statement.run(...bindings);return {rows:[],rowCount:Number(result.changes)};
 }
 async function tx(key,fn){
  if(pool){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);const result=await fn((s,v)=>query(s,v,client));await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  let unlock;const prior=tail;tail=new Promise(r=>unlock=r);await prior;
  try{sqlite.exec('BEGIN IMMEDIATE');const result=await fn(query);sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}finally{unlock();}
 }
 await query('CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, created_at BIGINT NOT NULL, data TEXT NOT NULL)');
 await query('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, lead_id TEXT, due_at BIGINT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0, data TEXT NOT NULL, last_error TEXT)');
 await query('CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status,due_at)');
 await query('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, data TEXT NOT NULL)');
 await query('CREATE TABLE IF NOT EXISTS rate_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL)');
 return {query,tx,close:async()=>{if(pool)await pool.end();else sqlite.close();}};
}
export async function enqueue(q,{id,kind,leadId=null,dueAt=Date.now(),data={}}){
 await q("INSERT INTO jobs (id,kind,lead_id,due_at,status,data) VALUES ($1,$2,$3,$4,'pending',$5) ON CONFLICT (id) DO NOTHING",[id,kind,leadId,dueAt,JSON.stringify(data)]);
}
export async function listLeads(db){return (await db.query('SELECT data FROM leads ORDER BY created_at DESC')).rows.map(row=>JSON.parse(row.data));}
export async function getLead(db,id){const row=(await db.query('SELECT data FROM leads WHERE id=$1',[id])).rows[0];return row?JSON.parse(row.data):null;}
export async function changeLead(db,id,change){
 return db.tx('lead:'+id,async q=>{const row=(await q('SELECT data FROM leads WHERE id=$1',[id])).rows[0];if(!row)return null;const lead=JSON.parse(row.data);await change(lead);await q('UPDATE leads SET data=$1 WHERE id=$2',[JSON.stringify(lead),id]);return lead;});
}
export async function rateLimit(db,key,limit,windowMs,now=Date.now()){
 return db.tx('rate:'+key,async q=>{
  const old=(await q('SELECT count,reset_at FROM rate_limits WHERE id=$1',[key])).rows[0];
  const fresh=!old||Number(old.reset_at)<=now;const count=fresh?1:Number(old.count)+1;
  await q('INSERT INTO rate_limits (id,count,reset_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at',[key,count,fresh?now+windowMs:Number(old.reset_at)]);
  return count<=limit;
 });
}
