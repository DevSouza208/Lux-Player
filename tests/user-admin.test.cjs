const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function editor(fail=false){
  const elements=new Map(),writes=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',textContent:'',disabled:false,classList:{add(){},remove(){}},focus(){},scrollIntoView(){}});
    return elements.get(id);
  };
  const context={currentUser:{user:'admin',role:'admin'},document:{getElementById:element},alert(){},
    supabaseClient:{from:table=>({update:record=>({eq:(key,value)=>({select:()=>({single:async()=>{writes.push({table,key,value,record});return fail?{error:{message:'offline'}}:{data:record};}})})}),insert:async()=>{throw Error('Editing must not insert');}})}};
  vm.createContext(context);
  const source=fs.readFileSync('js/script.js','utf8');
  vm.runInContext(source.slice(source.indexOf('    let editingAdminUsername'),source.indexOf('    async function adminDeleteUser')),context);
  context.loadAdminUsersList=async()=>{};
  return {context,element,writes};
}

test('user pencil fills the form and updates only the selected login',async()=>{
  const {context,element,writes}=editor();
  context.adminEditUser({usuario:'alice',nome:'Alice',senha:'existing',cargo:'user',vencimento:'2026-12-31',lista_m3u:'https://example.test/list.m3u'});
  assert.equal(element('adminNewPass').value,'existing');
  assert.equal(element('adminNewDue').value,'2026-12-31');
  assert.equal(element('adminNewUser').readOnly,true);
  element('adminNewName').value='Alice updated';
  element('adminNewUser').value='another-account';
  await context.adminCreateUser();
  assert.equal(writes.length,1);
  assert.equal(writes[0].value,'alice');
  assert.equal(writes[0].record.usuario,'alice');
  assert.equal(writes[0].record.nome,'Alice updated');
  assert.equal(writes[0].record.senha,'existing');
  assert.equal(element('adminNewUser').readOnly,false);
});

test('failed user update preserves edits for retry and cancellation clears editing state',async()=>{
  const {context,element}=editor(true);
  context.adminEditUser({usuario:'alice',nome:'Alice',senha:'existing'});
  element('adminNewName').value='Unsaved name';
  await context.adminCreateUser();
  assert.equal(element('adminNewName').value,'Unsaved name');
  assert.equal(element('adminNewUser').readOnly,true);
  assert.equal(element('adminUserSubmit').disabled,false);
  context.resetAdminUserForm();
  assert.equal(element('adminNewName').value,'');
  assert.equal(element('adminNewUser').readOnly,false);
});
