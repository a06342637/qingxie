const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
async function createHarness() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'light-type-window-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', executablePath: process.env.CHROME_PATH || undefined, headless: true,
    viewport: null, ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--screen-info={1920x1080}', ...(process.env.CHROME_PATH ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${root}`, `--load-extension=${root}`])]
  });
  let driver, id;
  async function install() {
    if(process.env.CHROME_PATH) {
      const cdp=await context.browser().newBrowserCDPSession();
      id=(await cdp.send('Extensions.loadUnpacked',{path:root})).id;await cdp.detach();
    } else id=new URL((context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')).url()).host;
    driver=await context.newPage();await driver.goto(`chrome-extension://${id}/tests/driver.html`);
    await driver.evaluate(async()=>{const w=await chrome.windows.getCurrent();await chrome.windows.update(w.id,{width:1280,height:1040,state:'normal'})});
  }
  async function target(url) {
    return driver.evaluate(async url=>(await chrome.tabs.query({url}))[0],url);
  }
  async function open(tabId) {
    const result=await driver.evaluate(async tabId=>{
      const tab=await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId,{focused:true});
      await chrome.tabs.update(tabId,{active:true});
      await chrome.action.openPopup({windowId:tab.windowId});
      return {windowId:tab.windowId};
    },tabId);
    // Chrome exposes action popups as targets that Playwright does not auto-attach to.
    const cdp=await context.browser().newBrowserCDPSession();
    const target=await until(async()=>(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/panel.html?popup=1`));
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
    const pending=new Map();let sequence=0;
    cdp.on('Target.receivedMessageFromTarget',event=>{
      if(event.sessionId!==sessionId)return;
      const message=JSON.parse(event.message),request=pending.get(message.id);
      if(!request)return;pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result);
    });
    const call=(method,params={})=>new Promise((resolve,reject)=>{
      const requestId=++sequence;
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error('Popup protocol timed out: '+method))},10000);
      pending.set(requestId,{resolve,reject,timer});
      cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:requestId,method,params})}).catch(error=>{pending.delete(requestId);clearTimeout(timer);reject(error)});
    });
    const evaluate=async(fn,arg)=>{
      const reply=await call('Runtime.evaluate',{expression:`(${fn.toString()})(${arg===undefined?'undefined':JSON.stringify(arg)})`,returnByValue:true,awaitPromise:true});
      if(reply.exceptionDetails)throw new Error(reply.exceptionDetails.exception?.description||reply.exceptionDetails.text);
      return reply.result.value;
    };
    const page={
      evaluate,
      click:selector=>evaluate(selector=>document.querySelector(selector).click(),selector),
      fill:(selector,value)=>evaluate(({selector,value})=>{const el=document.querySelector(selector);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))},{selector,value}),
      value:selector=>evaluate(selector=>document.querySelector(selector).value,selector),
      visible:selector=>evaluate(selector=>{const el=document.querySelector(selector);if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight},selector),
      scroll:selector=>evaluate(selector=>document.querySelector(selector).scrollIntoView({block:'nearest'}),selector),
      screenshot:async({path:output})=>{const result=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(output,Buffer.from(result.data,'base64'))},
      close:async()=>{await cdp.send('Target.closeTarget',{targetId:target.targetId});await cdp.detach()}
    };
    await until(()=>page.evaluate(()=>!!document.querySelector('#connection-dot.online')));
    return {page,...result};
  }
  const message=(tabId,payload)=>driver.evaluate(async({tabId,payload})=>chrome.tabs.sendMessage(tabId,payload),{tabId,payload});
  const load=()=>driver.evaluate(()=>chrome.runtime.sendMessage({type:'LIGHT_LOAD'}));
  const save=(data)=>driver.evaluate(data=>chrome.runtime.sendMessage({type:'LIGHT_SAVE',...data}),data);
  async function close() {
    await context.close();
    const p=path.resolve(profile),temp=path.resolve(os.tmpdir());
    if(path.dirname(p)===temp&&path.basename(p).startsWith('light-type-window-'))fs.rmSync(p,{recursive:true,force:true});
  }
  return {context,install,target,open,message,load,save,close,get driver(){return driver},get id(){return id}};
}
async function until(fn) {
  for(let i=0;i<300;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,50));}
  throw new Error('Window test condition timed out');
}
module.exports={createHarness,until,root};
