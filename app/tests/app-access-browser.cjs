'use strict';
// Optional browser acceptance test: NODE_PATH=<playwright modules> node app/tests/app-access-browser.cjs
const assert=require('assert').strict,http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const {chromium}=require('playwright'),fixture=require('./app-access-fixture.cjs'),dashboard=require('../service/dashboard');
(async()=>{const f=fixture();let browser,server;const output=process.env.VETRO_PREVIEW_DIR||path.join(os.tmpdir(),'vetro-permissions-preview');fs.mkdirSync(output,{recursive:true});
 try{
  f.installed['garage.app'].name='Garage Home';f.installed['media.app'].name='Media Controls';
  server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');const route=req.url.split('?')[0];
   if(route==='/'){res.setHeader('Content-Type','text/html');return res.end(dashboard());}
   if(route==='/icon.png'){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync(path.join(__dirname,'../icon.png')));}
   if(route==='/app-access'){try{let result;if(req.method==='POST'){let b='';for await(const part of req)b+=part;result=await f.access.admin(JSON.parse(b));}else result=f.access.snapshot();return res.end(JSON.stringify(result));}catch(e){res.statusCode=e.code==='conflict'?409:400;return res.end(JSON.stringify({error:e.message}));}}
   const data=route==='/apps'?{apps:[],summary:{total:0}}:route==='/remap'?{rules:[]}:route==='/dns'?{enabled:false,domains:[]}:route==='/wins'?{items:[]}:route==='/leftovers'?{items:[],totalBytes:0}:{};
   res.end(JSON.stringify(data));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1365,height:1024},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'App permissions',exact:true}).click();await page.locator('#aaState').filter({hasText:'Off'}).waitFor();
  await page.locator('#aaEnabled').check();await page.locator('#aaMessage').filter({hasText:'App access enabled'}).waitFor();
  const scopes=['apps.read','tasks.read','tasks.stop','picture.brightness'];await f.access.call('garage.app','access.request',{scopes});await page.locator('#aaRefresh').click();await page.locator('[data-request="0"]').waitFor();
  await page.getByRole('button',{name:'Approve selected'}).click();await page.locator('#aaMessage').filter({hasText:'Select at least one'}).waitFor();assert.equal(f.access.state.grants.length,0);
  await page.locator('[data-request="0"] input[value="apps.read"]').check();await page.locator('[data-request="0"] input[value="tasks.read"]').check();await page.getByRole('button',{name:'Approve selected'}).click();await page.locator('[data-grant="0"]').waitFor();assert.deepEqual(f.access.state.grants[0].scopes,['apps.read','tasks.read']);
  await page.locator('[data-grant="0"] input[value="apps.read"]').uncheck();await page.getByRole('button',{name:'Save permissions'}).click();await page.locator('#aaMessage').filter({hasText:'Permissions saved'}).waitFor();assert.deepEqual(f.access.state.grants[0].scopes,['tasks.read']);
  await page.getByRole('button',{name:'Pause access'}).click();await page.getByRole('button',{name:'Resume access'}).waitFor();assert.equal(f.access.state.grants[0].enabled,false);
  await page.getByRole('button',{name:'Resume access'}).click();await page.getByRole('button',{name:'Pause access'}).waitFor();
  await page.getByRole('button',{name:'Revoke approval'}).click();await page.locator('#aaGrants').filter({hasText:'No apps'}).waitFor();assert.equal(f.access.state.grants.length,0);
  // Review view: one explicit pending request and an existing approval.
  let pending=await f.access.call('media.app','access.request',{scopes:['remote.audio','remote.playback']});await f.access.admin({action:'approve',requestId:pending.requestId,scopes:['remote.audio','remote.playback'],expectedRevision:f.access.state.revision});
  await f.access.call('garage.app','access.request',{scopes});await page.locator('#aaRefresh').click();await page.getByRole('heading',{name:'Garage Home'}).waitFor();
  await page.screenshot({path:path.join(output,'app-permissions-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'app-permissions-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow at 390px');
  // Concurrent owner changes are visible; stale form submissions cannot overwrite them.
  await f.access.admin({action:'enable',enabled:false,expectedRevision:f.access.state.revision});await page.getByRole('button',{name:'Pause access'}).click();await page.locator('#aaMessage').filter({hasText:'Settings changed'}).waitFor();assert.equal(f.access.state.grants[0].enabled,true);
  await page.locator('#aaRefresh').click();await page.locator('#aaState').filter({hasText:'Off'}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS browser: empty state, opt-in, selected approval, reduce/pause/resume/revoke, conflict, responsive layout; screenshots '+output);
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
