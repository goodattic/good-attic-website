import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root=fileURLToPath(new URL('../',import.meta.url));
assert.ok(process.argv[2], 'Pass an external output directory for test reports/screenshots.');
const out=pathToFileURL(path.resolve(process.argv[2])+'/');
assert.ok(!fileURLToPath(out).startsWith(root), 'Keep generated evidence outside the website tree.');
await mkdir(new URL('screenshots/',out),{recursive:true});
const origin='https://modal-review.invalid';
const routes=['/','/resources/attic-insulation-removal-after-mice/','/resources/bat-guano-attic-insulation-removal/','/resources/wet-attic-insulation-remove-or-dry/','/resources/replace-attic-insulation-when-replacing-roof/','/resources/blown-insulation-vs-rolled-insulation/'];
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp4':'video/mp4','.json':'application/json'};
const report={startedAt:new Date().toISOString(),network:'All requests intercepted. No external network allowed. API submissions mocked in memory.',rows:[],limitations:['Chromium desktop and mobile/touch emulation, not physical iOS/Android.','No assistive-technology speech/VoiceOver certification; accessible dialog semantics checked in the browser.','Places suggestions use an in-memory library stub; no Google API call. Native date input tested in Chromium, not all OS pickers.']};
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1});
  for(const route of routes){
   const page=await context.newPage(),requests=[],errors=[],posts=[];
   let failSubmission=false;
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async intercepted=>{
    const req=intercepted.request(),url=new URL(req.url());requests.push({url:req.url(),method:req.method()});
    if(url.origin!==origin)return intercepted.fulfill({status:200,contentType:'text/javascript',body:''});
    if(url.pathname==='/api/site-config')return intercepted.fulfill({json:{googleMapsBrowserKey:'isolated-test-key'}});
    if(url.pathname.startsWith('/api/')){
     assert.equal(url.pathname,'/api/leads');assert.equal(req.method(),'POST');posts.push(req.postDataJSON());
     return intercepted.fulfill({status:failSubmission?503:200,json:{ok:!failSubmission}});
    }
    let file=path.join(root,url.pathname);
    if(url.pathname.endsWith('/'))file=path.join(file,'index.html');
    try{return intercepted.fulfill({status:200,body:await readFile(file),contentType:mime[path.extname(file)]||'application/octet-stream'});}catch{return intercepted.fulfill({status:404,body:''});}
   });
   await page.addInitScript(()=>{
    const originalAdd=EventTarget.prototype.addEventListener,originalRemove=EventTarget.prototype.removeEventListener;
    const listeners=new Map();window.__focusListenerCounts=()=>Object.fromEntries([...listeners].map(([k,v])=>[k,v.size]));
    EventTarget.prototype.addEventListener=function(type,fn,opts){if(this===document&&['containModalFocus','containModalTab'].includes(fn?.name)){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);}return originalAdd.call(this,type,fn,opts);};
    EventTarget.prototype.removeEventListener=function(type,fn,opts){if(this===document)listeners.get(type)?.delete(fn);return originalRemove.call(this,type,fn,opts);};
    const component=(type,longText,shortText=longText)=>({types:[type],longText,shortText});
    window.google={maps:{importLibrary:async()=>({AutocompleteSessionToken:class{},AutocompleteSuggestion:{fetchAutocompleteSuggestions:async()=>({suggestions:[{placePrediction:{text:'123 Test Street, Salt Lake City, UT 84101',toPlace:()=>({fetchFields:async()=>{},addressComponents:[component('street_number','123'),component('route','Test Street'),component('locality','Salt Lake City'),component('administrative_area_level_1','Utah','UT'),component('postal_code','84101'),component('country','United States','US')]})}}]})}})}};
   });
   await page.goto(origin+route);await page.waitForFunction(()=>typeof openModal==='function'&&!!document.querySelector('.mobile-quote-button'));
   const slug=route==='/'?'home':route.split('/').filter(Boolean).at(-1);
   const row={route,mobile,checks:[],screenshots:[]};report.rows.push(row);
   const modal=page.locator('[data-modal]'),close=modal.locator('button[data-close-modal]');
   const header=mobile?page.locator('.mobile-quote-button'):page.locator('header [data-open-modal]').last();
   const conversionEvents=()=>page.evaluate(()=>Array.from(window.dataLayer||[]).map(x=>Array.from(x)).filter(x=>x[0]==='event'&&['conversion','generate_lead'].includes(x[1])));
   const inside=()=>page.evaluate(()=>document.querySelector('[data-modal]').contains(document.activeElement));
   const assertOpen=async()=>{assert.equal(await modal.getAttribute('aria-hidden'),'false');await page.waitForFunction(()=>document.querySelector('[data-modal]').contains(document.activeElement),{},{timeout:2000});assert.equal(await close.evaluate(el=>el===document.activeElement),true);assert.deepEqual(await page.evaluate(()=>window.__focusListenerCounts()),{focusin:1,keydown:1});assert.equal(await page.evaluate(()=>!!document.querySelector('[data-modal]').closest('[inert]')),false);assert.ok(await page.locator('main').evaluate(el=>!!el.closest('[inert]')));};
   const assertClosed=async opener=>{assert.equal(await modal.getAttribute('aria-hidden'),'true');assert.deepEqual(await page.evaluate(()=>window.__focusListenerCounts()),{focusin:0,keydown:0});if(opener)assert.equal(await opener.evaluate(el=>el===document.activeElement),true);};
   const trap=async()=>{
    await close.focus();await page.keyboard.press('Shift+Tab');assert.ok(await inside());assert.equal(await modal.locator('button[type=submit]').evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Tab');assert.equal(await close.evaluate(el=>el===document.activeElement),true);
    const traversed=[];
    for(let n=0;n<35;n++){await page.keyboard.press('Tab');assert.ok(await inside());traversed.push(await page.evaluate(()=>document.activeElement.name||document.activeElement.className));}
    for(let n=0;n<35;n++){await page.keyboard.press('Shift+Tab');assert.ok(await inside());}
    return [...new Set(traversed)];
   };
   await header.focus();await page.keyboard.press('Enter');await assertOpen();row.tabControls=await trap();
   await page.keyboard.press('Escape');await assertClosed(header);row.checks.push('header keyboard opening; initial close-button focus; forward/reverse containment; Escape; opener restoration');
   for(let n=0;n<3;n++){if(mobile)await header.tap();else await header.click();await assertOpen();await close.click();await assertClosed(header);}
   await header.click();await assertOpen();assert.equal(await page.getByRole('dialog',{name:'Request your free attic quote.'}).count(),1);await modal.locator('.modal-backdrop').click({position:{x:1,y:1}});await assertClosed(header);
   await header.evaluate(el=>{openModal({currentTarget:el});closeModal();});await page.waitForTimeout(50);await assertClosed(header);
   row.checks.push('accessible named dialog; backdrop close; immediate open/close cancels pending focus');
   row.checks.push('three repeated pointer/touch and close-button cycles; handlers exactly one while open and zero when closed');
   const guide=page.locator('main [data-open-modal]').last();
   if(await guide.count()){
    await guide.scrollIntoViewIfNeeded();await guide.focus();await page.keyboard.press('Enter');await assertOpen();await page.keyboard.press('Escape');await assertClosed(guide);
    if(mobile)await guide.tap();else await guide.click();await assertOpen();
    const scroll=await page.evaluate(()=>({x:modalInteractionState.scrollX,y:modalInteractionState.scrollY}));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-modal]')).opacity==='1');
    const screenshot=`screenshots/${slug}-${mobile?'mobile':'desktop'}-modal.png`;await page.screenshot({path:new URL(screenshot,out).pathname,animations:'disabled'});row.screenshots.push(screenshot);
    await close.click();await assertClosed(guide);await page.waitForFunction(({x,y})=>Math.abs(window.scrollY-y)<2&&Math.abs(window.scrollX-x)<2,scroll,{timeout:3000});
    row.checks.push('guide CTA keyboard and pointer/touch opening; scroll restoration');
   }
   assert.deepEqual(await conversionEvents(),[]);assert.equal(posts.length,0);
   if(route==='/resources/attic-insulation-removal-after-mice/'){
    await header.click();await assertOpen();
    const source=modal.locator('[name=self_reported_source]'),detail=modal.locator('[name=self_reported_source_detail]');
    await source.selectOption('ai_search');await detail.selectOption('chatgpt');assert.ok(await detail.isVisible());assert.equal(await detail.isEnabled(),true);await source.focus();await page.keyboard.press('Tab');assert.equal(await detail.evaluate(el=>el===document.activeElement),true);
    await source.selectOption('referral');assert.equal(await detail.isVisible(),false);assert.equal(await detail.isEnabled(),false);await source.focus();await page.keyboard.press('Tab');assert.equal(await modal.locator('[name=additional_notes]').evaluate(el=>el===document.activeElement),true);
    row.checks.push('AI detail appears in Tab order; referral hides/disables AI detail and removes it from Tab order');
    const street=modal.locator('[name=street_address]');await street.focus();await page.waitForFunction(()=>document.querySelector('[data-modal] [name=street_address]').hasAttribute('aria-controls'));await street.fill('123 Test');await modal.locator('.address-suggestion').waitFor({state:'visible'});
    assert.equal(await modal.locator('.address-suggestion').evaluate(el=>!!el.closest('[inert]')),false);
    await street.press('ArrowDown');await street.press('Enter');await page.waitForFunction(()=>document.querySelector('[data-modal] [name=zip]').value==='84101');assert.equal(await street.evaluate(el=>el===document.activeElement),true);
    await street.fill('123 Other');await modal.locator('.address-suggestion').waitFor({state:'visible'});await modal.locator('.address-suggestion').click();await page.waitForFunction(()=>document.querySelector('[data-modal] [name=street_address]').value==='123 Test Street');assert.ok(await inside());
    row.checks.push('address suggestions stay non-inert; arrow/Enter and pointer selection update address and restore input focus');
    const date=modal.locator('[name=preferred_day]');await date.fill('2026-10-15');await date.focus();await date.press('ArrowUp');await date.press('Tab');assert.ok(await inside());assert.ok(await date.inputValue());row.checks.push('native date input accepts value and keyboard segment navigation inside dialog');
    await modal.locator('button[type=submit]').click();assert.equal(posts.length,0);assert.ok(await inside());row.checks.push('native required-field validation causes no request');
    for(const [name,value]of Object.entries({first_name:'Isolated',last_name:'Fixture',phone:'8015550100',email:'fixture@example.invalid'}))await modal.locator(`[name=${name}]`).fill(value);
    await modal.locator('button[type=submit]').click();assert.equal(posts.length,0);assert.ok(await inside());
    await modal.locator('[name=project_type]').first().check();
    failSubmission=true;await modal.locator('button[type=submit]').click();await modal.locator('[data-form-status]').getByText('Something went wrong.',{exact:false}).waitFor();assert.equal(posts.length,1);assert.deepEqual(await conversionEvents(),[]);assert.ok(await inside());
    failSubmission=false;await modal.locator('button[type=submit]').click();await page.locator('[data-lead-thank-you-modal].is-open').waitFor();assert.equal(posts.length,2);assert.equal(await modal.getAttribute('aria-hidden'),'true');assert.deepEqual(await page.evaluate(()=>window.__focusListenerCounts()),{focusin:0,keydown:0});
    const events=await conversionEvents();assert.equal(events.filter(e=>e[1]==='conversion').length,1);assert.equal(events.filter(e=>e[1]==='generate_lead').length,1);row.mockedSubmission={failed:1,succeeded:1,adsConversion:1,ga4Lead:1};
    await page.keyboard.press('Escape');row.checks.push('project validation; mocked failure retains dialog/re-enables submit with zero conversions; one mocked success triggers existing thank-you and exactly one event per destination');
    await page.evaluate(()=>{document.querySelector('footer').setAttribute('inert','preserved');document.body.classList.add('nav-open');document.querySelector('[data-menu-toggle]').setAttribute('aria-expanded','true');document.body.style.setProperty('--modal-scroll-lock-top','-7px','important');});
    await header.click();await assertOpen();await page.evaluate(()=>{const button=document.createElement('button');button.id='late-background';document.body.append(button);});await page.waitForFunction(()=>document.querySelector('#late-background').inert);await close.click();assert.equal(await page.locator('footer').getAttribute('inert'),'preserved');assert.ok(await page.locator('body').evaluate(el=>el.classList.contains('nav-open')));assert.equal(await page.locator('#late-background').getAttribute('inert'),null);assert.equal(await page.evaluate(()=>document.body.style.getPropertyPriority('--modal-scroll-lock-top')),'important');row.checks.push('prior inert value, navigation and scroll-lock property restored; late background node isolated and restored');
    await page.evaluate(()=>{document.querySelector('footer').removeAttribute('inert');document.body.classList.remove('nav-open');document.querySelector('[data-menu-toggle]').setAttribute('aria-expanded','false');document.body.style.removeProperty('--modal-scroll-lock-top');});
    await header.click();await page.evaluate(()=>{document.querySelectorAll('[data-open-modal]').forEach(el=>el.remove());document.querySelector('[data-menu-toggle]').hidden=true;});await close.click();assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('header .brand')),true);assert.equal(await page.locator('main').getAttribute('tabindex'),null);row.checks.push('removed-opener fallback focuses existing home link without modifying tabindex');
   }
   if(mobile&&route!=='/resources/attic-insulation-removal-after-mice/'){
    const toggle=page.locator('.mobile-header-phone [data-phone-dropdown-toggle]');await toggle.tap();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');row.checks.push('mobile phone-menu touch/Escape unchanged');
   }
   assert.deepEqual(errors,[]);row.consoleErrors=errors;row.mockedPostCount=posts.length;row.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(row.horizontalOverflow,false);
   await writeFile(new URL('browser-verification.json',out),JSON.stringify(report,null,2)+'\n');
   console.log(`PASS ${mobile?'mobile':'desktop'} ${route}`);await page.close();
  }
  await context.close();
 }
 report.finishedAt=new Date().toISOString();report.passed=true;await writeFile(new URL('browser-verification.json',out),JSON.stringify(report,null,2)+'\n');
}catch(error){report.failure=error.stack;await writeFile(new URL('browser-verification.json',out),JSON.stringify(report,null,2)+'\n');throw error;}finally{await browser.close();}
