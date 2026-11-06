'use strict';
// Optional browser acceptance test: NODE_PATH=<playwright modules> node app/tests/dock-double-home-browser.cjs
const assert=require('assert').strict,http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const {chromium}=require('playwright'),dashboard=require('../service/dashboard');
(async()=>{
 let browser,server;
 const output=process.env.VETRO_PREVIEW_DIR||path.join(os.tmpdir(),'vetro-permissions-preview');fs.mkdirSync(output,{recursive:true});
 const apps=[{appId:'GlassHome1.GlassHome',name:'Glass Home',show:true,disabled:false},{appId:'org.tizen.netflix-app',name:'Netflix',show:true,disabled:false}];
 let dock={installed:true,enabled:true,running:true,busy:false,doublePressHome:true,doublePressHomeTarget:null,homeShortcut:null,entries:[],inputs:[],home:{launcher:true,ready:true}};
 try{
  server=http.createServer(async(req,res)=>{
   const route=req.url.split('?')[0];res.setHeader('Content-Type','application/json');
   if(route==='/'){res.setHeader('Content-Type','text/html');return res.end(dashboard());}
   if(route==='/icon.png'){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync(path.join(__dirname,'../icon.png')));}
   if(route==='/dock'){
    if(req.method==='POST'){
     let body='';for await(const part of req)body+=part;const p=JSON.parse(body);
     if(p.action==='doublePressHomeTarget')dock.doublePressHomeTarget=p.appId?{appId:p.appId,label:p.appId==='com.samsung.tv.csfs'?'Samsung Home':apps.find(a=>a.appId===p.appId).name}:null;
    }
    return res.end(JSON.stringify(dock));
   }
   const data=route==='/apps'?{apps,summary:{total:apps.length}}:route==='/remap'?{rules:[]}:route==='/dns'?{enabled:false,domains:[]}:route==='/wins'?{items:[]}:route==='/leftovers'?{items:[],totalBytes:0}:route==='/input'?{devices:[],status:{policy:{mode:'off'},events:[]}}:{};
   res.end(JSON.stringify(data));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1365,height:1024}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-tab="dock"]').click();
  await page.locator('#dockDoubleHomeMode').waitFor();assert.equal(await page.locator('#dockDoubleHomeMode').inputValue(),'shortcut');assert.equal(await page.locator('#dockDoubleHomeApp').count(),0);
  await page.locator('#dockDoubleHomeMode').selectOption('app');
  assert.equal(await page.locator('[data-dock-double-home-save]').isDisabled(),true);
  await page.locator('#dockDoubleHomeApp').selectOption('GlassHome1.GlassHome');
  assert.equal(await page.locator('[data-dock-double-home-save]').isEnabled(),true);
  await page.locator('[data-dock-double-home-save]').click();
  await page.waitForFunction(()=>dockDoubleHomeDraft===null&&dockBusy===false);
  assert.equal(dock.doublePressHomeTarget.appId,'GlassHome1.GlassHome');assert.equal(dock.homeShortcut,null);
  await page.reload();await page.locator('[data-tab="dock"]').click();await page.locator('#dockDoubleHomeApp').waitFor();
  assert.equal(await page.locator('#dockDoubleHomeApp').inputValue(),'GlassHome1.GlassHome');
  dock.homeShortcut={appId:'org.tizen.netflix-app',label:'Netflix'};
  await page.locator('[data-dock-reload]').click();
  await page.waitForFunction(()=>dockData.homeShortcut&&dockData.homeShortcut.label==='Netflix');
  const card=page.locator('.quick-item').filter({has:page.getByRole('heading',{name:'Double-press Home',exact:true})});
  assert.match(await card.textContent(),/Press Home twice quickly to open Glass Home/);
  await page.locator('#dockDoubleHomeMode').selectOption('shortcut');assert.equal(await page.locator('#dockDoubleHomeApp').count(),0);
  await page.locator('[data-dock-double-home-save]').click();await page.waitForFunction(()=>dockDoubleHomeDraft===null&&dockBusy===false);
  assert.equal(dock.doublePressHomeTarget,null);assert.match(await card.textContent(),/Press Home twice quickly to open Netflix/);
  await page.locator('#dockDoubleHomeMode').selectOption('app');await page.locator('#dockDoubleHomeApp').selectOption('com.samsung.tv.csfs');
  await page.locator('[data-dock-double-home-save]').click();await page.waitForFunction(()=>dockDoubleHomeDraft===null&&dockBusy===false);
  assert.equal(dock.doublePressHomeTarget.appId,'com.samsung.tv.csfs');assert.equal(dock.homeShortcut.appId,'org.tizen.netflix-app');
  await card.screenshot({path:path.join(output,'double-home-desktop.png')});
  await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();await card.screenshot({path:path.join(output,'double-home-mobile.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow on a phone');assert.deepEqual(errors,[]);
  console.log('PASS browser: conditional picker, save, reload persistence, independent target, follow shortcut, Samsung Home, desktop and phone layout; no page errors.');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
