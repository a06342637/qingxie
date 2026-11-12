// Opt-in live verification: fills fictitious data only; never clicks submit.
const {createHarness,until,root}=require('./window-harness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
let h;
(async()=>{
  h=await createHarness();
  const site=await h.context.newPage();
  const response=await site.goto('https://login.linode.com/signup',{waitUntil:'domcontentloaded',timeout:45000});
  await site.locator('#email').waitFor({timeout:20000});
  const signupPosts=[];
  site.on('request',req=>{if(req.method()==='POST'&&new URL(req.url()).origin==='https://login.linode.com'&&new URL(req.url()).pathname.startsWith('/signup'))signupPosts.push(new URL(req.url()).pathname)});
  await site.evaluate(()=>{
    window.lightTypeCheck={submits:0,inputs:{}};
    document.addEventListener('submit',()=>window.lightTypeCheck.submits++,true);
    document.addEventListener('input',e=>{if(['email','username','password'].includes(e.target.id))window.lightTypeCheck.inputs[e.target.id]=(window.lightTypeCheck.inputs[e.target.id]||0)+1},true);
  });
  await h.install();await site.bringToFront();const tab=await h.target(site.url());
  const {page:panel}=await h.open(tab.id);
  const sample={email:'lighttype-check@example.com',username:'lighttypecheck261011',password:'LtDemo_261011!abc'};
  for(const [key,value] of Object.entries(sample))await panel.fill('#field-'+key,value);
  await panel.click('#start');
  const done=await until(async()=>{const s=await h.message(tab.id,{type:'LIGHT_INSPECT'});if(s.state==='error'||s.state==='paused')throw new Error(s.message);return s.state==='done'?s:null});
  const result=await site.evaluate(expected=>({
    matched:Object.fromEntries(Object.entries(expected).map(([key,value])=>[key,document.getElementById(key).value===value])),
    validity:Object.fromEntries(Object.keys(expected).map(key=>[key,document.getElementById(key).validity.valid])),
    events:window.lightTypeCheck,
    buttonClicked:false
  }),sample);
  assert.ok(Object.values(result.matched).every(Boolean));assert.ok(Object.values(result.validity).every(Boolean));
  assert.ok(Object.values(result.events.inputs).every(n=>n>1));assert.equal(result.events.submits,0);assert.deepEqual(signupPosts,[]);
  assert.equal(site.url(),'https://login.linode.com/signup');
  await until(async()=>!(JSON.stringify(await h.load()).includes(sample.password)));
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await site.screenshot({path:path.join(root,'test-results/live-signup.png'),fullPage:true});
  await panel.screenshot({path:path.join(root,'test-results/live-floating-window.png')});
  const report={url:site.url(),httpStatus:response.status(),title:await site.title(),state:done.state,...result,signupPosts,realPage:true,submitted:false};
  fs.writeFileSync(path.join(root,'test-results/live-signup-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>h?.close());
