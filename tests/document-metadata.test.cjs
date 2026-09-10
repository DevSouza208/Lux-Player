const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={window:{}};vm.runInNewContext(fs.readFileSync('js/reading-document-metadata.js','utf8'),c);const {parse,read}=c.window.LuxDocumentMetadata;
test('PDF combines embedded author/title with copyright, publisher and ISBN from text',()=>{
 const result=parse({Title:'Um livro',Author:'Ana Silva',CreationDate:'D:20250101000000'}, {},['Copyright © 1994\nEditora: Exemplo\nISBN 978-85-359-0277-5']);
 assert.equal(result.title,'Um livro');assert.equal(result.authors,'Ana Silva');assert.equal(result.published_year,'1994');assert.equal(result.publisher,'Exemplo');assert.equal(result.isbn,'9788535902775');
});
test('PDF never treats file creation date or arbitrary citation year as publication year',()=>{
 const result=parse({Title:'Microsoft Word - Document1',Author:'admin',CreationDate:'D:2025'}, {},['Como demonstrado por Silva (1998), ...']);assert.equal(result.title,undefined);assert.equal(result.authors,undefined);assert.equal(result.published_year,undefined);
 assert.equal(parse({}, {},['Autores: Ana Silva e João Souza\nPublicado em 2020']).authors,'Ana Silva e João Souza');
});
test('PDF reader samples bounded pages locally and tolerates missing text',async()=>{
 const visited=[];const result=await read({numPages:100,getMetadata:async()=>({info:{},metadata:{getAll:()=>({'dc:title':'Pesquisa','dc:creator':['Ana','Bia']})}}),getPage:async page=>{visited.push(page);return {getTextContent:async()=>({items:[{str:page===1?'Publicado em 2018':'Texto',hasEOL:true}]})};}});
 assert.equal(result.authors,'Ana, Bia');assert.equal(result.published_year,'2018');assert.deepEqual(visited,[1,2,3,99,100]);
});
