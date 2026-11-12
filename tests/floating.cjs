// Exercise the actual toolbar popup with an isolated profile and local page fixtures.
const { createHarness,until,root }=require('./window-harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let h;
(async()=>{
  h=await createHarness();
  await h.context.route('https://login.linode.com/**',route=>route.fulfill({contentType:'text/html',body:'<form><input id="email" type="email"><input id="username"><input id="password" type="password"></form>'}));
  const site=await h.context.newPage();await site.goto('https://login.linode.com/signup');
  await h.install();await site.bringToFront();const tab=await h.target(site.url());
  let panel=(await h.open(tab.id)).page;
  const cases=[];const check=async(name,fn)=>{await fn();cases.push(name);console.log('PASS '+name)};
  await check('toolbar opens a 720 x 600 native popup without an independent window',async()=>{
    const shape=await panel.evaluate(()=>({width:innerWidth,height:innerHeight,native:chrome.extension.getViews({type:'popup'}).includes(window),popupClass:document.documentElement.classList.contains('popup')}));
    console.log(JSON.stringify(shape));assert.equal(shape.width,720);assert.equal(shape.height,600);assert.ok(shape.native);assert.ok(shape.popupClass);
    const windows=await h.driver.evaluate(()=>chrome.windows.getAll());assert.equal(windows.filter(w=>w.type==='popup').length,0);
    assert.equal((await h.message(tab.id,{type:'LIGHT_INSPECT'})).stage,'signup');
  });
  await check('all five navigation steps and form fields fit without sidebar scrolling',async()=>{
    for(const step of ['signup','email','phone','profile','card']) {
      await panel.click(`[data-step="${step}"]`);
      const shape=await panel.evaluate(()=>{
        const main=document.querySelector('main').getBoundingClientRect(),side=document.querySelector('.sidebar').getBoundingClientRect();
        const inside=(el,r)=>{const b=el.getBoundingClientRect();return b.top>=r.top&&b.bottom<=r.bottom};
        return {fields:[...document.querySelectorAll('[data-field]')].every(el=>inside(el,main)),contentFits:document.querySelector('main').scrollHeight<=document.querySelector('main').clientHeight,steps:[...document.querySelectorAll('.step')].every(el=>inside(el,side)),sidebarOverflow:getComputedStyle(document.querySelector('.sidebar')).overflowY,outside:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight};
      });
      assert.ok(shape.fields,step+' fields');assert.ok(shape.contentFits,step+' complete form');assert.ok(shape.steps,step+' steps');assert.equal(shape.sidebarOverflow,'clip');assert.equal(shape.outside,false);
      if(step==='profile')await panel.screenshot({path:path.join(root,'test-results/toolbar-profile.png')});
    }
    await panel.click('[data-step="signup"]');
    await panel.screenshot({path:path.join(root,'test-results/toolbar-popup.png')});
  });
  await check('non-Linode sections retain the same usable popup size',async()=>{
    await panel.click('[data-platform="aws"]');
    assert.deepEqual(await panel.evaluate(()=>[innerWidth,innerHeight]),[720,600]);
    assert.ok(await panel.evaluate(()=>document.body.innerText.includes('已预留位置')));
    await panel.click('[data-platform="linode"]');
  });
  await check('closing and reopening preserves drafts without creating another window',async()=>{
    await panel.click('summary');await panel.fill('#paste','邮箱：draft@example.com');await panel.close();
    panel=(await h.open(tab.id)).page;assert.equal(await panel.value('#paste'),'邮箱：draft@example.com');
    const windows=await h.driver.evaluate(()=>chrome.windows.getAll());assert.equal(windows.filter(w=>w.type==='popup').length,0);
  });
  await check('the webpage keeps filling after the toolbar popup closes',async()=>{
    await panel.fill('#field-email','popup@example.com');await panel.fill('#field-username','popup_test');await panel.fill('#field-password','PopupTest123!');
    await panel.click('#start');await until(async()=>(await h.message(tab.id,{type:'LIGHT_INSPECT'})).state==='running');await panel.close();
    await until(async()=>{const s=await h.message(tab.id,{type:'LIGHT_INSPECT'});if(s.state==='error'||s.state==='paused')throw new Error(s.message);return s.state==='done'});
    assert.equal(await site.locator('#email').inputValue(),'popup@example.com');assert.equal(await site.locator('#username').inputValue(),'popup_test');assert.equal(await site.locator('#password').inputValue(),'PopupTest123!');
    panel=(await h.open(tab.id)).page;assert.equal(await panel.value('#field-password'),'');
  });
  await check('expanded paste and settings remain reachable',async()=>{
    await panel.click('summary');await panel.scroll('#parse');assert.ok(await panel.visible('#parse'));
    await panel.click('[data-platform="settings"]');await panel.scroll('#clear-data');assert.ok(await panel.visible('#clear-data'));
  });
  const manager=await h.context.newPage();await manager.goto('chrome://extensions/');
  const rows=await manager.locator('extensions-item').evaluateAll(els=>els.map(el=>({id:el.id,errors:el.data.runtimeErrors,manifestErrors:el.data.manifestErrors})));
  const current=rows.find(x=>x.id===h.id);assert.deepEqual(current.errors,[]);assert.deepEqual(current.manifestErrors,[]);
  fs.writeFileSync(path.join(root,'test-results/toolbar-popup-report.json'),JSON.stringify({passed:cases.length,cases},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>h?.close());
