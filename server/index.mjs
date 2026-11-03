import {openDatabase} from './db.mjs';
import {createApp} from './app.mjs';
const db=await openDatabase();
const {server,wake}=createApp(db);
server.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>{console.log('Via 21 server is ready');wake();});
async function shutdown(){server.close(async()=>{await db.close();process.exit(0);});setTimeout(()=>process.exit(1),20000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
