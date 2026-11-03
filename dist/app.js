const config=window.CAMPAIGN;
const $=s=>document.querySelector(s);
const params=new URLSearchParams(location.search),ad=params.get('ad')||'direct';
const leadTracking=window.createVia21LeadTracking({adSource:ad});
const variants={free:[`1 Month Free in the Biltmore`,`Remodeled 1 & 2 bedrooms from ${config.price}. Only a few left at this price.`],renewal:[`Don't Renew Until You Compare`,`Phoenix rents are dropping. See what ${config.price} gets you in the Biltmore.`],holiday:[`Move In Before the Holidays`,`Tour this week, apply online in minutes, move in by December.`],location:[`Biltmore Location. Not Biltmore Rent.`,`Minutes from Biltmore shopping and Camelback, 13 minutes to Sky Harbor.`],checklist:[`Your Apartment Checklist, Checked`,`Biltmore area, washer and dryer, pets OK, under $1,700.`]};
variants['1-month-free']=variants.free;
variants.offer=variants.free;
variants.area=["Close to Everything. Quiet at Home.","Minutes from Downtown and Old Town Scottsdale. Furnished homes available. Answer 3 quick questions and we'll text you tour times."];
if(variants[ad]){ $('#headline').textContent=variants[ad][0];$('#subheadline').textContent=variants[ad][1]; }else{$('#headline').innerHTML='Prime Location<br>Apartments in PHX';$('#subheadline').textContent=`Remodeled 1 & 2 bedrooms from ${config.price} with ${config.offer}. Answer 3 quick questions and we'll text you open tour times.`;}
$('#year').textContent=new Date().getFullYear();
function privacy(e){if(config.privacyUrl){location.href=config.privacyUrl;return;}e.preventDefault();$('#privacy').showModal();}
$('#privacy-link').onclick=privacy;$('#close-privacy').onclick=()=>$('#privacy').close();
let step=0,answers=[],contact={name:'',phone:'',email:''};
const questions=[config.furnishedQuestion?['Furnished or unfurnished?',['Furnished','Unfurnished','Open to either']]:['Do you have pets?',['Yes','No']],['How many bedrooms?',['1 bedroom','2 bedrooms']],['When do you want to move in?',['This month','Next month','2+ months out']]];
function render(){
 $('#step-label').textContent=`Step ${step+1} of 4`;$('#progress-fill').style.width=`${(step+1)*25}%`;
 const root=$('#quiz-content');root.replaceChildren();
 const kicker=document.createElement('div');kicker.className='question-kicker';kicker.textContent=step<3?'A PLACE THAT FITS YOUR PLANS':'ONE LAST STEP';root.append(kicker);
 const h=document.createElement('h2');h.tabIndex=-1;h.textContent=step<3?questions[step][0]:'Where should we text your tour times?';root.append(h);
 if(step<3){questions[step][1].forEach(answer=>{const b=document.createElement('button');b.className='answer'+(answers[step]===answer?' selected':'');b.append(document.createTextNode(answer));const arrow=document.createElement('span');arrow.textContent='→';b.append(arrow);b.onclick=()=>{answers[step]=answer;step++;render();};root.append(b);});}
 else {root.insertAdjacentHTML('beforeend',`<form id="lead-form"><div class="honeypot" aria-hidden="true"><label>Leave this blank<input name="website" tabindex="-1" autocomplete="off"></label></div><label>First and last name<input name="name" autocomplete="name" required maxlength="120" placeholder="Your full name"></label><label>Mobile phone<input name="phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="(602) 555-0123"></label><label>Email<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label><p class="error" role="alert" id="form-error"></p><button class="primary form-submit" type="submit">Get My Tour Times <span>↗</span></button><p class="consent">By submitting, you agree your info will be shared with the Via 21 leasing team to schedule your tour. Equal Housing Opportunity. <a href="#privacy" id="form-privacy">Privacy Policy</a></p></form>`);
 const form=$('#lead-form');Object.keys(contact).forEach(key=>{form.elements[key].value=contact[key];form.elements[key].oninput=e=>{contact[key]=e.target.value;e.target.setCustomValidity('');};});$('#form-privacy').onclick=privacy;
 form.onsubmit=async e=>{e.preventDefault();if(leadTracking.busy||leadTracking.completed)return;const digits=contact.phone.replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'');if(!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)){form.elements.phone.setCustomValidity('Enter a valid 10-digit US mobile phone number.');form.elements.phone.reportValidity();return;}if(contact.name.trim().split(/\s+/).length<2){form.elements.name.setCustomValidity('Enter your first and last name.');form.elements.name.reportValidity();return;}
 if(!config.webhook){$('#form-error').textContent='Tour inquiries are not connected yet. Please contact the leasing team at via21apartments.com to arrange your tour.';return;}
 const button=form.querySelector('button');
 const lead={website:form.elements.website.value,timestamp:new Date().toISOString(),name:contact.name.trim(),phone:'+1'+digits,email:contact.email.trim(),answers:Object.fromEntries(questions.map((q,i)=>[q[0],answers[i]]))};
 button.disabled=true;button.textContent='Sending…';
 try{await leadTracking.submit(config.webhook,lead);success();}
 catch{$('#form-error').textContent='Your inquiry could not be sent. Please try again or contact via21apartments.com.';button.disabled=false;button.innerHTML='Get My Tour Times <span>↗</span>';}};
 }
 h.focus({preventScroll:true});
}
function success(){$('.quiz-top').hidden=true;$('.progress').hidden=true;$('#quiz-content').innerHTML='<div class="success-mark">✓</div><h2>You\'re All Set</h2><p class="success-body">Check your texts. We\'ll send open tour times shortly.</p><a class="primary calendar">Book My Tour Now <span>↗</span></a>';$('.calendar').href=config.calendarUrl;}
document.querySelectorAll('[data-start]').forEach(b=>b.onclick=()=>{$('#landing').hidden=true;$('#quiz').hidden=false;render();window.scrollTo(0,0);});
$('#back').onclick=()=>{if(step>0){step--;render();}else{$('#landing').hidden=false;$('#quiz').hidden=true;}};
