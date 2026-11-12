const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'test-results');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'light-type-test-'));
const cases = [];
const errors = [];
const inputs = (list) => list.map(([id, type = 'text', extra = '']) => `<label>${id}<input id="${id}" name="${id}" type="${type}" ${extra}></label>`).join('');
const country = id => `<label>${id}<select id="${id}"><option value="-">Please choose</option><option value="US">United States</option><option value="CN">China</option><option value="GB">United Kingdom</option></select></label>`;
const form = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:16px sans-serif;padding:30px}label{display:block;margin:12px}input,select{margin-left:15px;padding:6px}.hidden{display:none}</style></head><body><form>${body}<input type="checkbox" id="terms"><button type="submit">Continue</button></form><script>window.events=[];window.submissions=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();submissions++};document.addEventListener('input',e=>events.push({id:e.target.id,type:e.inputType,value:e.target.value}));${script}</script></body></html>`;
const fixtures = {
  '/signup': form(inputs([['email', 'email', 'maxlength="128"'], ['username', 'text', 'maxlength="128"'], ['password', 'password', 'maxlength="128"']])),
  '/signup/verify-email': form(inputs([['otp', 'text', 'maxlength="6"'] ])),
  '/welcome/identification': form(country('iso_code') + inputs([['phone_number','tel'], ['otp', 'text', 'maxlength="6" disabled']])),
  '/welcome/billing': form(country('country') + inputs([['first_name'],['last_name'],['company_name'],['address_1'],['address_2'],['city']]) + '<label>state<select id="state"><option value="-">Please choose</option></select></label>' + inputs([['zip_code'],['tax_id'],['phone','text','disabled']]), `document.querySelector('#country').addEventListener('change',()=>{document.querySelector('#state').innerHTML='<option value="-">Loading...</option>';setTimeout(()=>document.querySelector('#state').innerHTML='<option value="-">Please choose</option><option value="California~CA">California</option><option value="New York~NY">New York</option>',350)});`),
  '/welcome/billing-card': form('<div class="hidden">' + inputs([['first_name','text','readonly']]) + '</div>' + inputs([['cc_number'], ['cc_expiration'], ['cvv','text','maxlength="4"']]), `document.querySelector('#cc_number').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\\D/g,'').replace(/(.{4})/g,'$1 ').trim()});document.querySelector('#cc_expiration').addEventListener('input',e=>{const n=e.target.value.replace(/\\D/g,'');e.target.value=n.length>2?n.slice(0,2)+'/'+n.slice(2,6):n})`)
};
const fast = { interval: 20, jitter: 0, fieldDelay: 0, existing: 'replace' };
const cleave = fs.readFileSync(path.join(__dirname, 'vendor', 'cleave.min.js'), 'utf8');
fixtures['/welcome/billing-card'] = form('<div class="hidden">' + inputs([['first_name','text','readonly']]) + '</div>' + inputs([['cc_number'], ['cc_expiration'], ['cvv','text','maxlength="4"']]), cleave + `;new Cleave('#cc_number',{creditCard:true});new Cleave('#cc_expiration',{date:true,datePattern:['m','Y']});new Cleave('#cvv',{numeral:true,numeralThousandsGroupStyle:'none',numeralPositiveOnly:true,stripLeadingZeroes:false,numeralDecimalScale:0,numeralIntegerScale:4});`);
let context;
(async () => {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.CHROME_PATH || undefined, headless: true, viewport: { width: 1000, height: 900 }, ignoreDefaultArgs: ['--disable-extensions'], args: process.env.CHROME_PATH ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${root}`, `--load-extension=${root}`] });
  let loadedId;
  if (process.env.CHROME_PATH) {
    const cdp = await context.browser().newBrowserCDPSession();
    loadedId = (await cdp.send('Extensions.loadUnpacked', { path: root })).id;
    await cdp.detach();
  }
  await context.route('https://login.linode.com/**', route => {
    const key = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtures[key] || form('No form') });
  });
  let worker;
  if (loadedId) {
    worker = await context.newPage();
    await worker.goto(`chrome-extension://${loadedId}/panel.html`);
    await worker.locator('#start').waitFor();
  } else worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
  const id = loadedId || new URL(worker.url()).host;
  const site = await context.newPage(); site.on('pageerror', e => errors.push(e.message));
  const send = msg => worker.evaluate(async msg => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, msg);
  }, msg);
  async function load(url, stage) {
    await site.goto('https://login.linode.com' + url); await site.bringToFront();
    for (let i = 0; i < 50; i++) {
      try { const s = await send({ type: 'LIGHT_INSPECT' }); if (s.stage === stage) return; } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Stage not detected: ' + stage);
  }
  const start = (stage, values, settings = fast) => send({ type: 'LIGHT_START', stage, values, settings });
  const corrections = { ...fast, typoEnabled: true, typoRate: 100, correctionDelay: 80 };
  const fixedRandom = value => worker.evaluate(async value => {
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    await chrome.scripting.executeScript({target:{tabId:tab.id},func:value=>{Math.random=()=>value},args:[value]});
  }, value);
  async function finish(expected = 'done') {
    for (let i=0; i<250; i++) {
      const s = await send({ type: 'LIGHT_INSPECT' });
      if (['done','error','stopped'].includes(s.state)) { assert.equal(s.state, expected, s.message); return s; }
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('Typing timeout');
  }
  async function check(name, fn) { await fn(); cases.push(name); process.stdout.write('PASS ' + name + '\n'); }
  await check('manifest, service worker and content script load', async () => { await load('/signup','signup'); assert.ok(id); });
  await check('signup types character by character without submit or terms click', async () => {
    assert.equal((await start('signup',{email:'test@example.com', username:'tester', password:'Test123!'})).ok,true);
    assert.equal((await start('signup',{username:'second'})).ok,false);
    await finish();
    assert.equal(await site.locator('#email').inputValue(),'test@example.com');
    assert.equal(await site.locator('#password').inputValue(),'Test123!');
    assert.equal(await site.evaluate(()=>events.filter(e=>e.id==='username').length),6);
    assert.equal(await site.evaluate(()=>submissions),0); assert.equal(await site.locator('#terms').isChecked(),false);
  });
  await check('skip existing content and append ordinary text', async () => {
    await start('signup',{username:'ignored'},{...fast,existing:'skip'}); assert.equal((await finish()).skipped,1);
    assert.equal(await site.locator('#username').inputValue(),'tester');
    await start('signup',{username:'_two'},{...fast,existing:'append'}); await finish();
    assert.equal(await site.locator('#username').inputValue(),'tester_two');
  });
  await check('stage mismatch, maxlength and missing fields fail before mutation', async () => {
    assert.equal((await start('email',{otp:'123456'})).ok,false);
    assert.equal((await start('signup',{email:'new@example.com',username:'x'.repeat(129)})).ok,false);
    assert.equal(await site.locator('#email').inputValue(),'test@example.com');
    await site.locator('#username').evaluate(el=>el.remove());
    assert.equal((await start('signup',{email:'new@example.com',username:'short'})).ok,false);
    assert.equal(await site.locator('#email').inputValue(),'test@example.com');
  });
  await check('pause, resume and stop preserve partial content', async () => {
    await load('/signup','signup'); await start('signup',{username:'abcdefghijklmno'},{...fast,interval:70});
    await new Promise(r=>setTimeout(r,180)); await send({type:'LIGHT_PAUSE'});
    await new Promise(r=>setTimeout(r,100)); const paused=await site.locator('#username').inputValue();
    await new Promise(r=>setTimeout(r,200)); assert.equal(await site.locator('#username').inputValue(),paused);
    await send({type:'LIGHT_PAUSE'}); await finish(); assert.equal(await site.locator('#username').inputValue(),'abcdefghijklmno');
    await start('signup',{username:'12345678901234567890'},{...fast,interval:80});
    await new Promise(r=>setTimeout(r,200)); await send({type:'LIGHT_STOP'}); await finish('stopped');
    const stopped=await site.locator('#username').inputValue(); await new Promise(r=>setTimeout(r,150)); assert.equal(await site.locator('#username').inputValue(),stopped); assert.ok(stopped.length<20);
  });
  await check('hiding target tab automatically pauses typing', async () => {
    await load('/signup','signup'); await start('signup',{username:'tab_switch_check'},{...fast,interval:80});
    const other = await context.newPage(); await other.bringToFront(); await new Promise(r=>setTimeout(r,350));
    await site.bringToFront(); assert.equal((await send({type:'LIGHT_INSPECT'})).state,'paused');
    await send({type:'LIGHT_PAUSE'}); await finish(); await other.close();
  });
  await check('numeric typo runs delete two characters and rewrite the correct suffix', async () => {
    await load('/signup','signup'); await fixedRandom(0.5);
    await site.locator('#username').evaluate(el=>{el.value='123';el.maxLength=5});
    await start('signup',{username:'45'},{...corrections,existing:'append'}); await finish();
    const sequence=await site.evaluate(()=>events.filter(e=>e.id==='username'));
    assert.deepEqual(sequence.map(e=>e.value),['1235','12354','1235','123','1234','12345']);
    assert.deepEqual(sequence.filter(e=>e.type==='deleteContentBackward').map(e=>e.value),['1235','123']);
    assert.ok(sequence.every(e=>e.value.length<=5));
    for (const stop of [false,true]) {
      await site.locator('#username').evaluate(el=>{el.value='123';window.events=[]});
      await start('signup',{username:'45'},{...corrections,existing:'append',correctionDelay:1000});
      await site.waitForFunction(()=>events.length>=2);
      await send({type:stop?'LIGHT_STOP':'LIGHT_PAUSE'});
      if(stop) await finish('stopped');
      const current=await site.locator('#username').inputValue();
      await site.waitForTimeout(180);assert.equal(await site.locator('#username').inputValue(),current);
      if(!stop){await send({type:'LIGHT_PAUSE'});await finish();assert.equal(await site.locator('#username').inputValue(),'12345')}
    }
  });
  await check('email and password correct symbols and Unicode without changing final values', async () => {
    await load('/signup','signup');await fixedRandom(0.5);
    const values={email:'typo@example.com',username:'user123',password:'  Ab中😀e\u0301|12!  '};
    await start('signup',values,corrections);await finish();
    for(const [id,value] of Object.entries(values)) {
      assert.equal(await site.locator('#'+id).inputValue(),value);
      assert.ok(await site.evaluate(id=>events.some(e=>e.id===id&&e.type==='deleteContentBackward'),id));
    }
    assert.equal(await site.evaluate(()=>submissions),0);
  });
  await check('email OTP corrects mistakes within maxlength and retains leading zeros', async () => {
    await load('/signup/verify-email','email');await fixedRandom(0.5);
    await start('email',{otp:'001234'},corrections);await finish();
    assert.equal(await site.locator('#otp').inputValue(),'001234');
    assert.equal(await site.evaluate(()=>events.filter(e=>e.type==='deleteContentBackward').length),6);
    assert.ok(await site.evaluate(()=>events.every(e=>e.value.length<=6)));
  });
  await check('phone country, number and disabled OTP use separate actions', async () => {
    await load('/welcome/identification','phone'); assert.equal((await start('phone',{iso_code:'US',phone_number:'2025550100',otp:'123456'})).ok,false);
    assert.equal(await site.locator('#phone_number').inputValue(),'');
    await fixedRandom(0.5);
    await start('phone',{iso_code:'US',phone_number:'+12025550100'},corrections); await finish();
    assert.equal(await site.locator('#iso_code').inputValue(),'US'); assert.equal(await site.locator('#phone_number').inputValue(),'+12025550100');
    assert.ok(await site.evaluate(()=>events.some(e=>e.id==='phone_number'&&e.type==='deleteContentBackward')));
    await site.locator('#otp').evaluate(el=>el.disabled=false); await start('phone',{otp:'009988'},corrections); await finish();
    assert.equal(await site.locator('#otp').inputValue(),'009988');
  });
  await check('profile waits for dynamic states, supports codes, and corrects typos', async () => {
    await load('/welcome/billing','profile');
    await site.evaluate(()=>{Math.random=()=>0});
    // Force deterministic random in the extension's isolated world through the extension API.
    await worker.evaluate(async()=>{const [t]=await chrome.tabs.query({active:true});await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>{Math.random=()=>0}})});
    const values={country:'US',first_name:'Alice',last_name:'Chen',company_name:'A',address_1:'12 Test St',address_2:'B',city:'Oakland',state:'CA',zip_code:'94612',tax_id:'001'};
    await start('profile',values,{...fast,typoRate:15,correctionDelay:80});
    await finish(); assert.equal(await site.locator('#state').inputValue(),'California~CA'); assert.equal(await site.locator('#first_name').inputValue(),'Alice');
    for(const [id,value] of Object.entries(values)) if(!['country','state'].includes(id)) {
      assert.equal(await site.locator('#'+id).inputValue(),value);
      assert.ok(await site.evaluate(id=>events.some(e=>e.id===id&&e.type==='deleteContentBackward'),id));
    }
    assert.equal(await site.locator('#phone').isDisabled(),true);
  });
  await check('readonly profile fields are never unlocked', async () => {
    await site.locator('#first_name').evaluate(el=>el.readOnly=true);
    assert.equal((await start('profile',{first_name:'Different'})).ok,false); assert.equal(await site.locator('#first_name').inputValue(),'Alice');
  });
  await check('formatted payment inputs retain exact number, full year and zero CVV', async () => {
    for(const [number,expiry,cvv] of [['4111111111111111','09/2029','001'],['378282246310005','12/2031','0001'],['4111111111111111','01/2030','000']]) {
      await load('/welcome/billing-card','card');await fixedRandom(expiry==='01/2030'?0.9:0.5);
      await start('card',{cc_number:number,cc_expiration:expiry,cvv},corrections);await finish();
      assert.equal((await site.locator('#cc_number').inputValue()).replace(/\s/g,''),number);
      assert.equal(await site.locator('#cc_expiration').inputValue(),expiry);assert.equal(await site.locator('#cvv').inputValue(),cvv);
      for(const id of ['cc_number','cc_expiration','cvv']) assert.ok(await site.evaluate(id=>events.some(e=>e.id===id&&e.type==='deleteContentBackward'),id));
      assert.equal(await site.evaluate(()=>submissions),0);
    }
  });
  await check('panel start button connects to the active target and clears completed secrets', async () => {
    await load('/signup','signup');
    const panel = worker.url().endsWith('panel.html') ? worker : await context.newPage();
    if (!panel.url().endsWith('panel.html')) await panel.goto(`chrome-extension://${id}/panel.html`);
    await site.bringToFront();
    await panel.evaluate(() => document.querySelector('#refresh').click());
    await panel.locator('#start:not([disabled])').waitFor();
    await panel.evaluate(() => {
      for (const [key,value] of Object.entries({email:'ui@example.com',username:'ui_test',password:'SecretUI123!'})) {
        const input=document.querySelector('#field-'+key);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
      }
      document.querySelector('#start').click();
    });
    await finish();
    assert.equal(await site.locator('#username').inputValue(),'ui_test');
    await panel.waitForTimeout(350);
    assert.equal(await panel.locator('#field-password').inputValue(),'');
    const local=await panel.evaluate(async()=>await chrome.storage.local.get(null));
    assert.ok(!JSON.stringify(local).includes('SecretUI123!'));
  });
  await check('panel offers three-line signup and four-part card formats', async () => {
    const panel=await context.newPage(); panel.on('pageerror',e=>errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.locator('[data-step="signup"]').click(); await panel.locator('summary').click();
    await panel.locator('#example').click();
    assert.equal((await panel.locator('#paste').inputValue()).split('\n').length,3);
    await panel.locator('#paste').fill('paste@example.com\npaste_user\n  ab|cd----ef:=gh  ');
    await panel.locator('#parse').click();
    assert.equal(await panel.locator('#field-email').inputValue(),'paste@example.com');
    assert.equal(await panel.locator('#field-username').inputValue(),'paste_user');
    assert.equal(await panel.locator('#field-password').inputValue(),'  ab|cd----ef:=gh  ');
    await panel.locator('[data-step="card"]').click(); await panel.locator('summary').click();
    await panel.locator('#example').click();
    assert.equal(await panel.locator('#paste').inputValue(),'卡号|月份|年份|cvv');
    await panel.locator('#paste').fill('4111111111111111|9|2029|001');
    await panel.locator('#parse').click();
    assert.equal(await panel.locator('#field-cc_number').inputValue(),'4111111111111111');
    assert.equal(await panel.locator('#field-cc_expiration').inputValue(),'09/2029');
    assert.equal(await panel.locator('#field-cvv').inputValue(),'001');
    const local=await panel.evaluate(async()=>await chrome.storage.local.get(null));
    assert.ok(!JSON.stringify(local).includes('4111111111111111'));
    await panel.locator('#paste').fill('4111111111111111|13|2029|001');
    await panel.locator('#parse').click();
    assert.equal(await panel.locator('#field-cc_expiration').inputValue(),'09/2029');
    assert.ok((await panel.locator('#toast').textContent()).includes('月份'));
    await panel.close();
  });
  await check('invalid country paste preserves profile fields and shows an inline error', async () => {
    const panel=await context.newPage(); panel.on('pageerror',e=>errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/panel.html`);
    await panel.locator('[data-step="profile"]').click();
    await panel.locator('#field-country').fill('JP');
    await panel.locator('#field-city').fill('Existing city');
    await panel.locator('summary').click();
    const raw='〒000-0000 テスト住所１丁目';
    await panel.locator('#paste').fill(raw); await panel.locator('#parse').click();
    assert.equal(await panel.locator('#field-country').inputValue(),'JP');
    assert.equal(await panel.locator('#field-city').inputValue(),'Existing city');
    assert.equal(await panel.locator('#paste').inputValue(),raw);
    assert.ok((await panel.locator('#parse-result').textContent()).includes('带字段名'));
    await panel.locator('#paste').fill('国家：JP\n地址：123 Example Street');
    await panel.locator('#parse').click();
    assert.equal(await panel.locator('#field-address_1').inputValue(),'123 Example Street');
    assert.equal(await panel.locator('#paste').inputValue(),'');
    await panel.close();
  });
  await check('correction settings persist 1–100 percent and an independent switch', async () => {
    const panel=await context.newPage(); panel.on('pageerror',e=>errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/panel.html#settings`);
    assert.equal(await panel.locator('#setting-typoRate').getAttribute('min'),'1');
    assert.equal(await panel.locator('#setting-typoRate').getAttribute('max'),'100');
    assert.ok(await panel.locator('#setting-typoRate').isDisabled());
    await panel.locator('#setting-typoEnabled').check();
    assert.ok(await panel.locator('#setting-typoRate').isEnabled());
    await panel.locator('#setting-typoRate').evaluate(el=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}))});
    await panel.waitForFunction(async()=>{const {settings}=await chrome.storage.local.get('settings');return settings.typoRate===100&&settings.typoEnabled});
    await panel.reload();
    assert.ok(await panel.locator('#setting-typoEnabled').isChecked());
    assert.equal(await panel.locator('#setting-typoRate').inputValue(),'100');
    await panel.locator('#setting-typoEnabled').uncheck();
    await panel.waitForFunction(async()=>{const {settings}=await chrome.storage.local.get('settings');return !settings.typoEnabled&&settings.typoRate===100});
    await panel.locator('[data-preset="fast"]').click();
    assert.ok(await panel.locator('#setting-typoRate').isDisabled());
    assert.ok(await panel.locator('#setting-correctionDelay').isDisabled());
    await panel.close();
  });
  await check('panel navigation, parsing, settings and local privacy', async () => {
    const panel=await context.newPage(); panel.on('pageerror',e=>errors.push(e.message)); await panel.goto(`chrome-extension://${id}/panel.html`); await panel.setViewportSize({width:560,height:900});
    await panel.locator('[data-platform="linode"]').click();
    await panel.locator('[data-step="signup"]').click(); await panel.locator('summary').click();
    await panel.locator('#paste').fill('邮箱：test@example.com\n用户名：tester\n密码：Test123!'); await panel.locator('#parse').click();
    assert.equal(await panel.locator('#field-password').inputValue(),'Test123!');
    await panel.waitForTimeout(500);
    const storage=await worker.evaluate(async()=>({local:await chrome.storage.local.get(null),session:await chrome.storage.session.get(null)}));
    assert.ok(!JSON.stringify(storage.local).includes('Test123!')); assert.ok(JSON.stringify(storage.session).includes('Test123!'));
    await panel.locator('[data-platform="aws"]').click(); assert.ok(await panel.getByText('已预留位置').isVisible());
    await panel.locator('[data-platform="settings"]').click(); await panel.locator('[data-preset="fast"]').click(); assert.equal(await panel.locator('#setting-interval').inputValue(),'35');
    await panel.locator('#toast').waitFor({state:'hidden'});
    await panel.screenshot({path:path.join(out,'settings.png'),fullPage:true});
    await panel.locator('[data-platform="linode"]').click(); await panel.locator('[data-step="profile"]').click();
    for (const [key,value] of Object.entries({country:'US',first_name:'Alice',last_name:'Chen',address_1:'12 Test Street',city:'Oakland',state:'CA',zip_code:'94612'})) await panel.locator('#field-'+key).fill(value);
    await load('/welcome/billing','profile');
    await panel.evaluate(()=>document.querySelector('#refresh').click());
    await panel.locator('#connection-dot.online').waitFor();
    await panel.screenshot({path:path.join(out,'panel-560.png'),fullPage:true});
    for (const width of [360,420,560]) { await panel.setViewportSize({width,height:900}); assert.ok(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`); }
    await panel.setViewportSize({width:360,height:780}); await panel.screenshot({path:path.join(out,'panel-360.png'),fullPage:true});
    await panel.locator('[data-platform="settings"]').click(); await panel.locator('#clear-data').click();
    await panel.waitForTimeout(400);
    const cleared=await worker.evaluate(async()=>({local:await chrome.storage.local.get('drafts'),session:await chrome.storage.session.get('draftSession')}));
    assert.ok(!JSON.stringify(cleared).includes('Test123!')); assert.ok(!JSON.stringify(cleared).includes('test@example.com'));
    await panel.locator('#setting-remember').uncheck(); await panel.waitForTimeout(400); assert.equal(await worker.evaluate(async()=>Object.hasOwn(await chrome.storage.local.get('drafts'),'drafts')),false);
    await panel.close();
  });
  await check('Chrome reports no manifest or extension runtime errors', async () => {
    const page=await context.newPage();await page.goto('chrome://extensions/');
    const item=page.locator('extensions-item').filter({has:page.locator('#name-and-version')});
    const rows=await page.locator('extensions-item').evaluateAll(els=>els.map(el=>({id:el.id,state:el.data.state,manifestErrors:el.data.manifestErrors,runtimeErrors:el.data.runtimeErrors})));
    const loaded=rows.find(r=>r.id===id);assert.ok(loaded);assert.equal(loaded.state,'ENABLED');assert.deepEqual(loaded.manifestErrors,[]);assert.deepEqual(loaded.runtimeErrors,[]);await page.close();
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:cases.length,cases,errors},null,2));
  process.stdout.write(`\n${cases.length} browser checks passed. Extension ID: ${id}\n`);
})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1}).finally(async()=>{
  await context?.close();
  // This uniquely-created disposable profile is the only directory removed.
  const target=path.resolve(profile),base=path.resolve(os.tmpdir());
  if(path.dirname(target)===base&&path.basename(target).startsWith('light-type-test-'))fs.rmSync(target,{recursive:true,force:true});
});
