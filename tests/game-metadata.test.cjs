const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
function harness(fail=false){let handler;const calls=[];const source=['pokemon-hacks.ts','wiki.ts','index.ts'].map(file=>fs.readFileSync('supabase/functions/game-metadata/'+file,'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')).join('\n');
 vm.runInNewContext(stripTypeScriptTypes(source),{Response,URLSearchParams,AbortSignal,console,Deno:{env:{get:()=>undefined},serve:fn=>handler=fn},fetch:async url=>{calls.push(String(url));if(fail)return new Response('',{status:503});if(String(url).includes('data.json'))return Response.json([{id:'hack-1',title:'Pokemon Leaf Green Redux',image:'https://img.test/leaf.png',initial_release:'2024-01-01',version:'1.0',status:'Completed',platform:'GBA',game_url:'https://example.test/hack',source:'PokeHarbor'}]);if(String(url).includes('wikidata.org'))return Response.json({entities:{Q1:{claims:{P577:[{mainsnak:{datavalue:{value:{time:'+1988-01-01T00:00:00Z'}}}}]}}}});return Response.json({query:{pages:{1:{pageid:1,title:'Altered Beast',extract:'Altered Beast is a video game.',pageprops:{wikibase_item:'Q1'}},2:{pageid:2,title:'Other',extract:'An unrelated novel.'}}}});}});
 return {calls,call:query=>handler(new Request('https://test',{method:'POST',body:JSON.stringify({query})}))};
}
test('Wikipedia and Wikidata remain available without IGDB keys, with attribution and game filtering',async()=>{
 const h=harness(),response=await h.call('Altered Beast (USA).gba'),data=await response.json();assert.equal(response.status,200);assert.equal(data.results.length,2);assert.ok(data.warnings.includes('IGDB'));assert.equal(data.results[0].release_year,1988);assert.match(data.results[0].attribution,/CC BY-SA/);assert.match(data.results[0].source_url,/wikipedia.org/);assert.equal(new URL(h.calls[0]).searchParams.get('gsrsearch'),'Altered Beast');
});
test('metadata sources fail independently and malformed queries never invoke providers',async()=>{
 const h=harness(true);assert.equal((await h.call('x')).status,400);assert.equal(h.calls.length,0);const data=await(await h.call('Metroid')).json();assert.equal(data.results.length,0);assert.equal(data.warnings.length,4);
});

test('Pokemon Leaf Green also searches the official FireRed and LeafGreen title',async()=>{
 const h=harness();const response=await h.call('Pokemon Leaf Green');assert.equal(response.status,200);assert.ok(h.calls.some(url=>new URL(url).searchParams.get('gsrsearch')==='Pokémon FireRed and LeafGreen'));
});

test('Pokemon hack catalog returns visual metadata without ROM links',async()=>{
 const h=harness(),data=await(await h.call('Pokemon Leaf Green')).json(),hack=data.results.find(result=>result.metadata_source==='poke-aggregator');
 assert.equal(hack.title,'Pokemon Leaf Green Redux');assert.equal(hack.release_year,2024);assert.equal(hack.console,'gba');assert.equal(hack.source_url,'https://example.test/hack');
});
