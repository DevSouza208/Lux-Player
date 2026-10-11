const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
async function load(path) {
  const source=readFileSync(resolve(__dirname,"..",path),"utf8");
  return import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
}
test("Cloudflare health is honest about missing bindings",async()=>{
  const {onRequestGet}=await load("functions/api/health.js");
  const r=await onRequestGet({env:{}});
  const json=await r.json();
  assert.equal(json.ok,true);
  assert.equal(json.ready,false);
  assert.equal(json.r2Bound,false);
});
test("Public catalogue is unavailable without D1 binding",async()=>{
  const {onRequestGet}=await load("functions/api/catalog.js");
  const r=await onRequestGet({env:{},request:new Request("https://example.pages.dev/api/catalog")});
  assert.equal(r.status,503);
});
test("Public catalogue has a bounded page size and no private source URL fields",async()=>{
  const {onRequestGet}=await load("functions/api/catalog.js");
  let bindings=[];
  const db={prepare:sql=>({bind:(...x)=>{bindings=x;return {all:async()=>({results:[{id:"public-demo",kind:"live",title:"Demo",poster_key:null}]})}}})};
  const r=await onRequestGet({env:{DB:db},request:new Request("https://example.pages.dev/api/catalog?limit=100000")});
  assert.equal(r.status,200);
  assert.deepEqual(bindings,[100]);
  const data=await r.json();
  assert.equal(data.items[0].title,"Demo");
  assert.equal("stream_url" in data.items[0],false);
});
test("R2 refuses private object paths without touching bucket",async()=>{
  const {onRequestGet}=await load("functions/api/assets/[[path]].js");
  let attempts=0;
  const env={MEDIA_BUCKET:{get:async()=>{attempts++;return null}}};
  for(const path of ["private/rom.nds","public/../saves/secret","saves/private.srm","public/%2e%2e/private"]) {
    const r=await onRequestGet({env,params:{path}});
    assert.equal(r.status,404,path);
  }
  assert.equal(attempts,0);
});
