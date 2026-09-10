(function(root){
 'use strict';
 const clean=value=>String(Array.isArray(value)?value.join(', '):value||'').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
 const useful=value=>{const text=clean(value);return text&&!/^(untitled|unknown|anonymous|admin|user|document\d*|microsoft\s|adobe\s|acrobat|scanner|scan\d*)/i.test(text)?text:'';};
 function parse(info={},xmp={},pages=[]){
  const text=pages.join('\n').slice(0,80000),result={};
  const title=useful(xmp['dc:title'])||useful(info.Title),authors=useful(xmp['dc:creator'])||useful(info.Author);
  if(title)result.title=title.slice(0,300);if(authors)result.authors=authors.slice(0,500);
  if(!result.authors){const match=text.match(/(?:^|\n)\s*(?:autores?|authors?|escrito por|written by)\s*[:：]\s*([^\n]{3,300})/i);if(match)result.authors=clean(match[1]);}
  const year=text.match(/(?:copyright|©|publicado(?: em)?|published(?: in)?|ano de publica[cç][aã]o|edi[cç][aã]o\s*[:,-])[^\n\d]{0,30}((?:18|19|20)\d{2})/i);
  if(year)result.published_year=year[1];
  const publisher=clean(xmp['dc:publisher']);if(publisher)result.publisher=publisher.slice(0,300);
  else {const match=text.match(/(?:^|\n)\s*(?:editora|publisher)\s*[:：]\s*([^\n]{2,200})/i);if(match)result.publisher=clean(match[1]);}
  const isbn=text.match(/ISBN(?:-1[03])?\s*[:：]?\s*([\dXx][\dXx –-]{8,25}[\dXx])/i);
  if(isbn){const value=isbn[1].replace(/[^\dXx]/g,'');if([10,13].includes(value.length))result.isbn=value.toUpperCase();}
  const doi=text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);if(!result.isbn&&doi)result.isbn=doi[0].replace(/[.,;]+$/,'').slice(0,100);
  if(Object.keys(result).length)result.metadata_source='PDF · metadados internos/texto; revisar';
  return result;
 }
 async function read(pdf){
  let info={},xmp={};try{const metadata=await pdf.getMetadata();info=metadata.info||{};xmp=metadata.metadata?.getAll()||{};}catch{}
  let coverTitle='';const pages=[],indices=[...new Set([1,2,3,pdf.numPages-1,pdf.numPages].filter(n=>n>=1&&n<=pdf.numPages))];
  for(const index of indices){try{const page=await pdf.getPage(index),content=await page.getTextContent();let text='';for(const item of content.items){if(text.length>=16000)break;text+=(item.str||'')+(item.hasEOL?'\n':' ');}pages.push(text);
   if(index===1){const lines=content.items.filter(i=>i.str?.trim()),max=Math.max(0,...lines.slice(0,300).map(i=>Math.abs(i.height||0)));if(max>=16){const candidate=clean(lines.filter(i=>Math.abs(i.height||0)>=max*.9).slice(0,8).map(i=>i.str).join(' '));if(candidate.length>=5&&candidate.length<=300&&!/^(sum[aá]rio|contents|copyright|isbn)\b/i.test(candidate))coverTitle=candidate;}}
  }catch{}}
  const result=parse(info,xmp,pages);if(!result.title&&coverTitle){result.title=coverTitle;result.metadata_source='PDF · título sugerido pela capa; revisar';}return result;
 }
 root.LuxDocumentMetadata={parse,read};
})(window);
