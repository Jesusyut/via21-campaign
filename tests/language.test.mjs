import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const dictionary=readFileSync(new URL('../dist/i18n.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function page({query='',stored,storageBlocked=false}={}){
 const map=new Map(),payloads=[];let submissions=0;
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.value='';this.hidden=false;this.attributes={};this.scoped={};}
  set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text||this.children.map(c=>c.textContent||'').join('');}
  set innerHTML(value){this.html=value;this.children=[];if(value.includes('success-mark')){this.scoped.h2=new Element('h2');this.scoped['.success-body']=new Element('p');const anchor=new Element('a');map.set('.calendar',anchor);}}
  get innerHTML(){return this.html||'';}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}
  setAttribute(k,v){this.attributes[k]=String(v);}focus(){}
  querySelector(s){return this.scoped[s]||map.get(s);}
  querySelectorAll(s){return this.fields||[];}
  setCustomValidity(value){this.validation=value;}reportValidity(){}
  addEventListener(){}
  showModal(){this.open=true;}close(){this.open=false;}
  insertAdjacentHTML(where,html){
   const form=new Element('form');form.elements=Object.fromEntries(['name','phone','email','website'].map(k=>[k,new Element('input')]));
   form.fields=['blank','name','phone','email'].map(key=>{const node=new Element('span');node.dataset.field=key;return node;});
   form.scoped.button=new Element('button');map.set('#lead-form',form);
   for(const key of ['#form-error','#form-privacy','.consent span'])map.set(key,new Element());
  }
 }
 for(const key of ['#headline','#subheadline','#year','#back','#privacy','#close-privacy','#privacy h2','#privacy p','#landing','#quiz','#step-label','#progress-fill','#quiz-content','.quiz-top','.progress','.brand','.brand span','#privacy-link'])map.set(key,new Element());
 const start=new Element('button'),english=new Element('button'),spanish=new Element('button');english.dataset.language='en';spanish.dataset.language='es';
 const staticNodes=['micro','privacy','housing','disclaimer'].map(key=>{const node=new Element('span');node.dataset.i18n=key;return node;});
 const document={documentElement:{},querySelector:key=>map.get(key),querySelectorAll:key=>key==='[data-language]'?[english,spanish]:key==='[data-start]'?[start]:key==='[data-i18n]'?staticNodes:[],createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
 const location={href:'https://via21-pipeline-test.onrender.com/'+query,search:query};
 const tracker={busy:false,completed:false,async submit(url,lead){submissions++;payloads.push(lead);this.completed=true;}};
 const window={CAMPAIGN:{price:'$1,650',offer:'up to 1 month free',furnishedQuestion:true,webhook:'/api/leads',calendarUrl:'https://via21apartments.com'},createVia21LeadTracking:({adSource})=>{tracker.adSource=adSource;return tracker;},scrollTo(){}};
 const localStorage={getItem(){if(storageBlocked)throw Error();return stored;},setItem(key,value){if(storageBlocked)throw Error();stored=value;}};
 const history={replaceState(a,b,url){location.href=String(url);location.search=new URL(url).search;}};
 const ctx=vm.createContext({window,document,location,localStorage,history,URL,URLSearchParams,Date});
 vm.runInContext(dictionary,ctx);vm.runInContext(source,ctx);
 return {ctx,map,start,english,spanish,document,location,tracker,payloads,get submissions(){return submissions;},answer(index){const buttons=map.get('#quiz-content').children.filter(n=>n.tagName==='BUTTON');buttons[index].onclick();}};
}
test('English default and explicit/saved Spanish selection preserve ad attribution',()=>{
 let p=page({query:'?ad=area'});assert.equal(p.document.documentElement.lang,'en');assert.equal(p.map.get('#headline').innerHTML,'Prime Location<br>Apartments in PHX');assert.equal(p.tracker.adSource,'area');
 p=page({query:'?ad=offer&lang=es',stored:'en'});assert.equal(p.document.documentElement.lang,'es');assert.equal(p.tracker.adSource,'offer');assert.ok(p.map.get('#subheadline').textContent.includes('hasta 1 mes gratis'));
 p=page({stored:'es'});assert.equal(p.document.documentElement.lang,'es');
 p=page({storageBlocked:true});assert.equal(p.document.documentElement.lang,'en');
});
test('switching at contact preserves inputs and canonical answers; confirmation toggle does not resubmit',async()=>{
 const p=page({query:'?ad=offer&utm_source=meta'});p.spanish.onclick();p.start.onclick();p.answer(1);p.answer(0);p.answer(1);
 let form=p.map.get('#lead-form');
 for(const [key,value] of Object.entries({name:'María Pérez',phone:'6025550123',email:'maria@example.com'})){form.elements[key].value=value;form.elements[key].oninput({target:form.elements[key]});}
 p.english.onclick();form=p.map.get('#lead-form');
 assert.equal(form.elements.name.value,'María Pérez');assert.equal(form.elements.phone.value,'6025550123');assert.equal(form.elements.email.value,'maria@example.com');
 p.spanish.onclick();form=p.map.get('#lead-form');await form.onsubmit({preventDefault(){}});
 assert.equal(p.submissions,1);
 const answers=p.payloads[0].answers;
 assert.equal(answers['Furnished or unfurnished?'],'Unfurnished');assert.equal(answers['How many bedrooms?'],'1 bedroom');assert.equal(answers['When do you want to move in?'],'Next month');
 assert.equal(p.tracker.adSource,'offer');assert.equal(new URL(p.location.href).searchParams.get('utm_source'),'meta');
 assert.equal(vm.runInContext('view',p.ctx),'success');assert.equal(p.map.get('#quiz-content').querySelector('h2').textContent,'¡Todo listo!');
 p.english.onclick();assert.equal(p.map.get('#quiz-content').querySelector('h2').textContent,"You're All Set");assert.equal(p.submissions,1);
});
test('invalid phone in Spanish cannot submit and language switch retains the entered number',async()=>{
 const p=page({query:'?lang=es'});p.start.onclick();p.answer(0);p.answer(0);p.answer(0);
 let form=p.map.get('#lead-form');
 for(const [key,value] of Object.entries({name:'Test Person',phone:'123',email:'test@example.com'})){form.elements[key].value=value;form.elements[key].oninput({target:form.elements[key]});}
 await form.onsubmit({preventDefault(){}});assert.equal(p.submissions,0);assert.ok(form.elements.phone.validation.includes('Estados Unidos'));
 p.english.onclick();form=p.map.get('#lead-form');assert.equal(form.elements.phone.value,'123');
});
