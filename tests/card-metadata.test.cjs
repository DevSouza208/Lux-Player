const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('language badges preserve declared regions and do not guess unsupported languages',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('js/reading-language.js','utf8'),context);
 const detect=context.window.LuxLanguage.detect;
 for(const [code,flag] of [['pt-BR','br'],['pt-PT','pt'],['en-US','us'],['en','gb'],['es','es'],['fr','fr'],['de','de']]){
  assert.equal(detect('',code).flagUrl,`js/flags/${flag}.svg`);assert.ok(fs.existsSync(`js/flags/${flag}.svg`));
 }
 assert.equal(detect('the and with from','xx').code,'xx');
 assert.equal(detect('','').flagUrl,null);
 assert.equal(detect('the and with from','').code,'en');
 assert.equal(detect('não você são','').code,'pt');
 assert.equal(detect('que para','').code,'unknown');
});
test('co-op badge requires explicit co-op metadata, never only multiple players',()=>{
 const source=fs.readFileSync('js/script.js','utf8');
 const start=source.indexOf('    function gameFeatureBadges('),end=source.indexOf('\n    lucide.createIcons();',start);
 const context={};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 assert.match(context.gameFeatureBadges({players:4}),/1–4 jogadores/);
 assert.doesNotMatch(context.gameFeatureBadges({players:4}),/Co-op/);
 assert.match(context.gameFeatureBadges({players:2,coop:true}),/Co-op/);
 assert.doesNotMatch(context.gameFeatureBadges({players:1,coop:true}),/Co-op/);
 assert.doesNotMatch(context.gameFeatureBadges({players:2,coop:false}),/Co-op/);
});
