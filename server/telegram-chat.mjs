const token=process.env.TELEGRAM_BOT_TOKEN;
if(!token)throw new Error('Set TELEGRAM_BOT_TOKEN in the server environment first');
const response=await fetch('https://api.telegram.org/bot'+token+'/getUpdates',{signal:AbortSignal.timeout(10000)});
const result=await response.json();if(!result.ok)throw new Error('Telegram could not return updates');
const chats=new Map();
for(const update of result.result||[]){const chat=update.message?.chat;if(chat?.type==='private')chats.set(chat.id,{id:chat.id,first_name:chat.first_name,username:chat.username});}
console.log(JSON.stringify({private_chats:[...chats.values()],next_step:'Confirm Caesar chat ID; then configure TELEGRAM_CHAT_ID.'},null,2));
