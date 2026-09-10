const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {stripTypeScriptTypes}=require('node:module');
test('gallery writes require admin and validate images; viewers can list',async()=>{
 let handler;let writes=0;
 const db={from(table){let pass;return {select(){return this;},eq(key,value){if(key==='senha')pass=value;return this;},async maybeSingle(){return {data:pass==='bad'?null:{usuario:'test',cargo:pass==='admin'?'admin':'user'}};},async order(){return {data:[]};},async insert(){writes++;return {};},delete(){writes++;return this;},then(resolve){resolve({});}};}};
 const source=fs.readFileSync('supabase/functions/profiles/index.ts','utf8').replace(/^import .*;\r?$/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),{Response,Request,Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>db});
 const call=(action,password,extra={})=>handler(new Request('https://test',{method:'POST',body:JSON.stringify({username:'test',password,action,...extra})}));
 assert.equal((await call('gallery-list','user')).status,200);
 assert.equal((await call('gallery-list','bad')).status,401);
 assert.equal((await call('gallery-save','user')).status,403);
 assert.equal((await call('gallery-delete','user',{id:'test'})).status,403);
 assert.equal(writes,0);
 assert.equal((await call('gallery-save','admin',{name:'Avatar',avatar_data:'javascript:bad'})).status,400);
 assert.equal((await call('gallery-save','admin',{name:'Avatar',avatar_data:'data:image/png;base64,YQ=='})).status,200);
 assert.equal(writes,1);
});
