const $=s=>document.querySelector(s),stages=['New','Contacted','Tour Scheduled','Toured','Applied','Leased','Lost'];
let csrf='',leads=[],view='board',sortKey='created_at',sortDirection=-1,currentId=null,status={};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/Phoenix',dateStyle:'medium',timeStyle:'short'})+' MST':'—';
function age(value){const m=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return m<1?'Just now':m<60?m+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';}
function sms(lead){return 'sms:+'+lead.phone+(/iPad|iPhone|iPod/.test(navigator.userAgent)?'&body=':'?body=')+encodeURIComponent("Hey "+lead.first_name+", it's Caesar with Via 21. Saw you're looking for a "+lead.bedrooms+"BR. I've got tour times tomorrow. What works for you?");}
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3500);}
async function api(path,options={}){
 const response=await fetch('/api/admin'+path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,...options.headers}});
 const data=await response.json();if(!response.ok){if(response.status===401)showLogin();throw Error(data.error||'Request failed');}return data;
}
function showLogin(){$('#login').hidden=false;$('#dashboard').hidden=true;if($('#detail').open)$('#detail').close();csrf='';leads=[];}
async function start(){try{const session=await api('/session');csrf=session.csrf;$('#login').hidden=true;$('#dashboard').hidden=false;await load();const match=location.pathname.match(/^\/admin\/leads\/([^/]+)$/);if(match)await openDetail(match[1]);}catch{showLogin();}}
async function load(){
 const data=await api('/leads');leads=data.leads;
 status=await api('/status');
 $('#stats').innerHTML=[['Leads this week',data.stats.leads_this_week],['Avg. first contact',data.stats.average_minutes_to_first_contact===null?'—':data.stats.average_minutes_to_first_contact.toFixed(1)+' min'],['Active pipeline',leads.filter(l=>!['Leased','Lost'].includes(l.stage)).length],['Commission earned','$'+data.stats.commission_earned.toLocaleString()]].map(([label,value])=>'<div class="stat"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('');
 $('#sources').textContent='By source: '+(Object.entries(data.stats.by_source).map(([k,v])=>k+' '+v).join(' · ')||'No leads yet')+'   |   '+Object.entries(data.stats.by_stage).map(([k,v])=>k+' '+v).join(' · ');
 const missing=[];if(!status.telegram_configured)missing.push('Telegram');if(!status.email_configured)missing.push('Email');if(!status.capi_configured)missing.push('CAPI');if(!status.office_email_configured)missing.push('Office email');
 $('#status').textContent=(status.free_test_mode?'Free test hosting: service sleep can delay notifications and scheduled jobs. ':'')+(missing.length?'Setup pending: '+missing.join(', ')+'. ':'All primary integrations configured. ')+(status.sheet_enabled?'Sheet backup enabled.':'Optional Sheet backup off.');
 render();$('#last-updated').textContent='Updated '+new Date().toLocaleTimeString()+' · Times shown in Phoenix time';
}
function filtered(){const query=$('#search').value.toLowerCase(),stage=$('#stage-filter').value;return leads.filter(l=>(!stage||l.stage===stage)&&[l.first_name,l.last_name,l.phone,l.email].join(' ').toLowerCase().includes(query));}
function render(){
 const items=filtered();$('#board').hidden=view!=='board';$('#list').hidden=view!=='list';
 $('#board-view').setAttribute('aria-pressed',view==='board');$('#list-view').setAttribute('aria-pressed',view==='list');
 if(view==='list'){renderList(items);return;}
 $('#board').innerHTML=stages.filter(s=>!$('#stage-filter').value||$('#stage-filter').value===s).map(stage=>{
  const subset=items.filter(l=>l.stage===stage);
  return '<section class="column" data-stage="'+esc(stage)+'"><div class="column-heading">'+esc(stage)+'<span>'+subset.length+'</span></div>'+subset.map(card).join('')+(subset.length?'':'<div class="empty">No leads</div>')+'</section>';
 }).join('');
 document.querySelectorAll('.card').forEach(node=>{
  const lead=leads.find(l=>l.id===node.dataset.id);
  node.onclick=e=>{if(!e.target.closest('a,select'))openDetail(lead.id);};
  node.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&e.target===node){e.preventDefault();openDetail(lead.id);}};
  node.ondragstart=e=>{e.dataTransfer.setData('text/plain',lead.id);e.dataTransfer.effectAllowed='move';};
  node.querySelector('select').onchange=async e=>{try{await move(lead,e.target.value);}catch(error){toast(error.message);render();}};
 });
 document.querySelectorAll('.column').forEach(node=>{
  node.ondragover=e=>{e.preventDefault();node.classList.add('drag-over');};
  node.ondragleave=()=>node.classList.remove('drag-over');
  node.ondrop=async e=>{e.preventDefault();node.classList.remove('drag-over');const lead=leads.find(l=>l.id===e.dataTransfer.getData('text/plain'));if(lead)try{await move(lead,node.dataset.stage);}catch(error){toast(error.message);}};
 });
}
function card(l){const overdue=l.stage==='New'&&Date.now()-Date.parse(l.created_at)>300000;
 return '<article class="card" data-id="'+l.id+'" tabindex="0" draggable="true" aria-label="'+esc(l.first_name+' '+l.last_name)+'"><div class="card-top"><span class="card-name">'+esc(l.first_name+' '+l.last_name)+'</span><span class="age '+(overdue?'overdue':'')+'">'+age(l.created_at)+'</span></div><p>'+l.bedrooms+' bedroom · '+esc(l.move_in)+'</p><span class="badge">'+esc(l.ad_source)+'</span><div class="card-actions"><a href="tel:+'+l.phone+'">Call ↗</a><a href="'+esc(sms(l))+'">Text ↗</a></div><select class="card-stage" aria-label="Stage for '+esc(l.first_name)+'">'+stages.map(s=>'<option '+(s===l.stage?'selected':'')+'>'+s+'</option>').join('')+'</select></article>';
}
async function move(lead,stage,extras={}){
 if(stage===lead.stage&&!Object.keys(extras).length)return;
 const data={stage,...extras};
 if(stage==='Lost'&&!lead.lost_reason&&!data.lost_reason){const reason=prompt('Why was this lead lost?');if(!reason?.trim())throw Error('A lost reason is required');data.lost_reason=reason;}
 if(stage==='Tour Scheduled'&&!lead.tour_at&&!data.tour_at){const when=prompt('Tour date and time in Phoenix (YYYY-MM-DDTHH:MM)');if(!when||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)||!Number.isFinite(Date.parse(when+'-07:00')))throw Error('Enter a valid Phoenix tour date/time');data.tour_at=new Date(when+'-07:00').toISOString();}
 await api('/leads/'+lead.id,{method:'PATCH',body:JSON.stringify(data)});await load();toast('Lead updated');
}
function renderList(items){
 items.sort((a,b)=>{let av=sortKey==='name'?a.first_name+' '+a.last_name:a[sortKey],bv=sortKey==='name'?b.first_name+' '+b.last_name:b[sortKey];return (typeof av==='number'?av-bv:String(av||'').localeCompare(String(bv||'')))*sortDirection;});
 const cols=[['name','Name'],['bedrooms','Beds'],['move_in','Move-in'],['ad_source','Source'],['stage','Stage'],['created_at','Submitted'],['sent_to_office_at','Sent to office']];
 $('#list').innerHTML='<table><thead><tr>'+cols.map(([key,label])=>'<th><button data-sort="'+key+'">'+label+(sortKey===key?(sortDirection===1?' ↑':' ↓'):' ↕')+'</button></th>').join('')+'</tr></thead><tbody>'+items.map(l=>'<tr data-id="'+l.id+'" tabindex="0">'+cols.map(([key])=>'<td>'+esc(key==='name'?l.first_name+' '+l.last_name:key.endsWith('_at')?date(l[key]):l[key])+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 $('#list').querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sortDirection=sortKey===b.dataset.sort?-sortDirection:1;sortKey=b.dataset.sort;render();});
 $('#list').querySelectorAll('tbody tr').forEach(r=>{r.onclick=()=>openDetail(r.dataset.id);r.onkeydown=e=>{if(e.key==='Enter')openDetail(r.dataset.id);};});
}
async function openDetail(id){
 try{const {lead:l}=await api('/leads/'+id);currentId=id;history.replaceState(null,'','/admin/leads/'+id);
 const extra=Object.fromEntries(Object.entries(l).filter(([k])=>k.startsWith('utm_')));
 const fields=[['Phone','+'+l.phone],['Email',l.email],['Furnished',l.furnished],['Bedrooms',l.bedrooms],['Move-in',l.move_in],['Source',l.ad_source],['Stage',l.stage],['Submitted',date(l.created_at)],['First contacted',date(l.first_contacted_at)],['Sent to office',date(l.sent_to_office_at)],['Tour time',date(l.tour_at)],['Lost reason',l.lost_reason||'—'],...Object.entries(extra),['Lead / Meta event ID',l.id],['Page URL',l.event_source_url],['Stage changed',date(l.stage_changed_at)],['Meta browser ID',l.fbp||'—'],['Meta click ID',l.fbc||'—']];
 $('#detail-content').innerHTML='<h2>'+esc(l.first_name+' '+l.last_name)+'</h2><p class="detail-meta">'+esc(l.bedrooms+'BR · '+l.move_in+' · '+l.ad_source)+'</p><div class="detail-actions"><a href="tel:+'+l.phone+'">Call ↗</a><a href="'+esc(sms(l))+'">Text ↗</a><a href="mailto:'+encodeURIComponent(l.email)+'">Email ↗</a></div><dl>'+fields.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><section class="section"><h3>Update pipeline</h3><label>Stage<select id="detail-stage">'+stages.map(s=>'<option '+(s===l.stage?'selected':'')+'>'+s+'</option>').join('')+'</select></label><label>Tour date/time (Phoenix)<input id="tour-at" type="datetime-local"></label><label>Lost reason<input id="lost-reason" maxlength="1000" value="'+esc(l.lost_reason||'')+'"></label><button id="save-stage" class="primary">Save changes</button></section><section class="section"><h3>Office handoff</h3><button id="handoff">Mark sent to office ↗</button><p class="office-help">Opens a prefilled email in your email client and records the handoff timestamp. Send the email from your client; this log cannot verify delivery.'+(!status.office_email_configured?' Leasing-office email setup is pending.':'')+'</p></section><section class="section"><h3>Notes</h3><form id="note-form"><label>Add a note<textarea id="note" required maxlength="5000"></textarea></label><button class="primary">Save note</button></form><ul class="history">'+(l.notes.length?l.notes.map(n=>'<li>'+esc(n.text)+'<small>'+date(n.at)+' · '+esc(n.author)+'</small></li>').join(''):'<li>No notes yet.</li>')+'</ul></section><section class="section"><h3>Stage history</h3><ul class="history">'+l.stage_log.map(log=>'<li>'+esc((log.from?log.from+' → ':'')+log.to)+'<small>'+date(log.at)+' · '+esc(log.actor)+'</small></li>').join('')+'</ul></section>'+(l.office_handoff_log?.length?'<section class="section"><h3>Office handoff history</h3><ul class="history">'+l.office_handoff_log.map(log=>'<li>'+esc(log.action+' · '+log.recipient)+'<small>'+date(log.at)+'</small></li>').join('')+'</ul></section>':'');
 if(l.tour_at){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(l.tour_at));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));$('#tour-at').value=p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;}
 $('#save-stage').onclick=async()=>{try{const extras={lost_reason:$('#lost-reason').value,tour_at:$('#tour-at').value?new Date($('#tour-at').value+'-07:00').toISOString():null};await move(l,$('#detail-stage').value,extras);await openDetail(id);}catch(e){toast(e.message);}};
 $('#note-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('/leads/'+id,{method:'PATCH',body:JSON.stringify({note:$('#note').value})});await load();await openDetail(id);}catch(e){toast(e.message);b.disabled=false;}};
 $('#handoff').onclick=async()=>{try{const {mailto}=await api('/leads/'+id+'/handoff',{method:'POST',body:'{}'});location.href=mailto;await load();await openDetail(id);}catch(e){toast(e.message);}};
 if(!$('#detail').open)$('#detail').showModal();
 }catch(error){toast(error.message);}
}
$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{const data=await api('/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});csrf=data.csrf;$('#password').value='';$('#login-error').textContent='';await start();}catch(error){$('#login-error').textContent=error.message;}finally{b.disabled=false;}};
$('#logout').onclick=async()=>{await api('/logout',{method:'POST',body:'{}'});showLogin();history.replaceState(null,'','/admin');};
$('#close-detail').onclick=()=>$('#detail').close();
$('#detail').onclose=()=>{currentId=null;history.replaceState(null,'','/admin');};
$('#board-view').onclick=()=>{view='board';render();};$('#list-view').onclick=()=>{view='list';render();};
$('#search').oninput=render;$('#stage-filter').onchange=render;
for(const stage of stages){const option=document.createElement('option');option.value=stage;option.textContent=stage;$('#stage-filter').append(option);}
setInterval(()=>{if(csrf)load().catch(e=>{$('#board-error').textContent=e.message;});},30000);
start();
