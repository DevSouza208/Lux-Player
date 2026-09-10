(function(root){
 'use strict';
 async function get(url,signal){const response=await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('Busca indisponível');return response.json();}
 const plain=value=>String(value||'').replace(/<[^>]*>/g,'').slice(0,12000);
 async function search(query){
  if(query.trim().length<2)throw new Error('Digite um título, autor ou ISBN.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   let results=[];
   try{
    const data=await get('https://www.googleapis.com/books/v1/volumes?'+new URLSearchParams({q:query.trim(),maxResults:'8',printType:'all'}),controller.signal);
    results=(data.items||[]).map(item=>{const v=item.volumeInfo||{};return {title:v.title||'',authors:(v.authors||[]).join(', '),description:plain(v.description),cover_url:(v.imageLinks?.thumbnail||'').replace(/^http:/,'https:'),publisher:v.publisher||'',published_year:v.publishedDate||'',isbn:(v.industryIdentifiers||[]).map(i=>i.identifier).join(', '),metadata_source:'Google Books',category:(v.categories||[]).some(c=>/comic|graphic|manga/i.test(c))?'HQs':'Livros'};});
   }catch{}
   if(results.length)return results;
   const data=await get('https://openlibrary.org/search.json?'+new URLSearchParams({q:query.trim(),limit:'8',lang:'pt',fields:'key,title,author_name,first_publish_year,cover_i,isbn,publisher'}),controller.signal);
   return (data.docs||[]).map(item=>({title:item.title||'',authors:(item.author_name||[]).join(', '),description:'',cover_url:item.cover_i?`https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg`:'',publisher:item.publisher?.[0]||'',published_year:String(item.first_publish_year||''),isbn:item.isbn?.[0]||'',metadata_source:'Open Library',workKey:item.key,category:'Livros'}));
  }finally{clearTimeout(timer);}
 }
 async function details(candidate){
  if(!/^\/works\/OL\d+W$/.test(candidate.workKey||''))return candidate;
  try{const data=await get('https://openlibrary.org'+candidate.workKey+'.json',AbortSignal.timeout(8000));return {...candidate,description:plain(typeof data.description==='string'?data.description:data.description?.value)};}catch{return candidate;}
 }
 root.LuxReadingMetadata={search,details};
})(window);
