sessionStorage.clear(); localStorage.clear();
window.lpResult={path:location.pathname+location.search,errors:[],checks:[],requests:[],signals:[]};
addEventListener('error',e=>lpResult.errors.push(e.message));
addEventListener('unhandledrejection',e=>lpResult.errors.push(String(e.reason)));
const realError=console.error;console.error=(...args)=>{lpResult.errors.push(args.join(' '));realError(...args);};
const realFetch=window.fetch.bind(window);
window.fetch=async (url,options)=>{
 if(url==='/api/leads'){const body=JSON.parse(options.body);lpResult.requests.push(body);return Response.json({ok:true,transaction_id:body.submission_id,transaction_confirmed:true});}
 if(url==='/api/leads/conversion-signal'){lpResult.signals.push(JSON.parse(options.body));return new Response(null,{status:204});}
 throw Error('Unexpected API request: '+url);
};
const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
const check=(condition,name)=>{if(!condition)throw Error(name);lpResult.checks.push(name);};
addEventListener('load',async()=>{
 try{
  await frame();check(innerWidth===375,'phone viewport 375px');check(lpResult.errors.length===0,'zero load errors');
  const hidden=document.querySelector('[data-lp-script-compat]');
  check(hidden.hidden&&hidden.inert&&hidden.getAttribute('aria-hidden')==='true'&&hidden.getClientRects().length===0,'compatibility nodes invisible and inert');
  const nav=document.querySelector('[data-menu-toggle]');nav.focus();check(nav.disabled&&nav.tabIndex===-1&&document.activeElement!==nav,'compatibility button cannot focus');
  const form=document.querySelector('[data-lead-form]');
  document.querySelector('.lp-optional summary').click();await frame();check(document.querySelector('.lp-optional').open,'Add a note expands');
  const note=form.elements.additional_notes;check(note.getClientRects().length>0,'notes field visible');
  const picker=document.querySelector('[data-service-picker]');picker.querySelector('summary').click();await frame();check(picker.open&&picker.querySelector('.lp-service-options').matches(':popover-open'),'services popover opens');
  const options=picker.querySelectorAll('input');options[0].click();options[1].click();window.dispatchEvent(new Event('scroll'));await frame();check(picker.open,'services stay open on scroll');
  picker.querySelector('[data-service-apply]').click();await frame();check(!picker.open&&options[0].checked&&options[1].checked,'Apply preserves multiple choices and closes');
  const phone={'ut':'+13853364442','mo_stl':'+13149312620','mo_kc':'+18164340308'}[document.documentElement.dataset.lpMarket];
  const call=document.querySelector('[data-lp-call]'),text=document.querySelector('[data-lp-text]');check(call.getAttribute('href')==='tel:'+phone&&text.getAttribute('href')==='sms:'+phone,'market Call and Text links correct');
  const clicked=[];document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&/^(tel|sms):/.test(a.getAttribute('href'))){clicked.push(a.getAttribute('href'));e.preventDefault();}},true);
  call.click();text.click();check(clicked.length===2,'Call and Text activate their links without dialing during test');
  const phoneConfigs=dataLayer.filter(args=>args[0]==='config'&&String(args[1]).startsWith('AW-11103039262/'));
  check(phoneConfigs.length===3,'existing three phone configs remain');
  const activePhoneConfigs=phoneConfigs.filter(args=>typeof args[2].phone_conversion_callback==='function');
  check(activePhoneConfigs.length===1,'only market phone config has Google callback');
  activePhoneConfigs[0][2].phone_conversion_callback('800-555-0199','+18005550199');
  check([...document.querySelectorAll('[data-lp-call]')].every(link=>link.getAttribute('href')==='tel:+18005550199')&&text.getAttribute('href')==='sms:'+phone,'Google callback swaps every Call and preserves Text');
  if(location.search.includes('1026920'))check(document.querySelector('h1').textContent.includes('Draper'),'Draper town detection');
  for(const [name,value] of Object.entries({name:'Browser Mock Only',phone:'8015550101',zip:'84020',additional_notes:'Mock note preserved'})){form.elements[name].value=value;form.elements[name].dispatchEvent(new Event('input',{bubbles:true}));}
  form.querySelector('button[type=submit]').click();
  for(let i=0;i<100&&!document.querySelector('[data-lead-thank-you-modal].is-open');i++)await frame();
  check(lpResult.requests.length===1,'real full script attached one form handler');
  const payload=lpResult.requests[0];check(payload.additional_notes==='Mock note preserved'&&payload.project_type.length===2,'notes and selected services reach mocked API');
  const conversions=dataLayer.filter(args=>args[0]==='event'&&args[1]==='conversion'&&args[2].send_to==='AW-11103039262/SDRICJin3tIaEJ7eq64p');
  check(conversions.length===1&&conversions[0][2].transaction_id===payload.submission_id&&/^[0-9a-f-]{36}$/.test(payload.submission_id),'DA - Submit Lead Form gets the confirmed transaction ID once');
  check(lpResult.signals.length===1&&lpResult.signals[0].transaction_id===payload.submission_id,'conversion signal carries same transaction ID');
  check(document.querySelector('[data-lead-thank-you-modal].is-open'),'successful thank-you opens');
  document.querySelector('button[data-close-lead-thank-you]').click();check(!document.querySelector('[data-lead-thank-you-modal].is-open'),'thank-you closes');
  check(lpResult.errors.length===0,'zero errors through interactions and submission');lpResult.pass=true;
 }catch(e){lpResult.pass=false;lpResult.failure=String(e);}
 parent.postMessage({lpBrowserTest:lpResult},location.origin);
});
