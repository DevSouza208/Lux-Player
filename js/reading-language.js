(function(root){
 'use strict';
 const rules={
  pt:{flag:'🇧🇷',name:'Português',words:'que não uma para com por dos das você como são mais foi uma isso'.split(' ')},
  en:{flag:'🇬🇧',name:'Inglês',words:'the and that with from have this were which would there their'.split(' ')},
  es:{flag:'🇪🇸',name:'Espanhol',words:'que los las una para con por como del esta más fue'.split(' ')},
  fr:{flag:'🇫🇷',name:'Francês',words:'les des une pour avec dans que est plus cette sur'.split(' ')},
  de:{flag:'🇩🇪',name:'Alemão',words:'der die das und den mit von nicht eine für ist'.split(' ')}
 };
 function detect(text,declared=''){
  const value=String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const code=String(declared).toLowerCase().slice(0,2);if(rules[code])return {code,...rules[code]};
  const scores=Object.entries(rules).map(([key,rule])=>[key,[...new Set(rule.words)].reduce((sum,word)=>sum+(value.match(new RegExp('\\b'+word.normalize('NFD').replace(/[\u0300-\u036f]/g,'')+'\\b','g'))||[]).length,0)]).sort((a,b)=>b[1]-a[1]);
  const best=scores[0];return best[1]>=3&&best[1]>scores[1][1]?{code:best[0],...rules[best[0]]}:{code:'unknown',flag:'🌐',name:'Idioma não identificado'};
 }
 const legacyDetect=detect;
 const countries={pt:'br',en:'gb',es:'es',fr:'fr',de:'de'};
 function languageInfo(text,declared=''){
  const tag=String(declared).trim().toLowerCase().replace(/_/g,'-');
  const aliases={por:'pt',eng:'en',spa:'es',fra:'fr',fre:'fr',deu:'de',ger:'de'};
  const code=aliases[tag]||tag;
  if(code&&code!=='unknown'&&code!=='und'&&!rules[code.split('-')[0]])return {code,name:'Idioma: '+code};
  const info=legacyDetect(text,code);
  const country=code==='pt-pt'?'pt':code==='en-us'?'us':countries[info.code];
  return {...info,code:country&&code.includes('-')?code:info.code,flagUrl:country?`js/flags/${country}.svg`:null};
 }
 function badge(info){
  const node=document.createElement('span');node.className='reading-language-badge';node.title=info.name;node.setAttribute('aria-label',info.name);
  if(info.flagUrl){const image=document.createElement('img');image.src=info.flagUrl;image.alt=info.name;image.width=24;image.height=16;node.append(image);}else node.textContent='🌐';
  return node;
 }
 root.LuxLanguage={detect:languageInfo,badge,flags:rules};
})(window);
