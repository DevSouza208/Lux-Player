import { createClient } from 'npm:@supabase/supabase-js@2';

export const readingHeaders = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type',
  'Cache-Control':'no-store'
};
export const readingJson = (data: unknown,status=200) => Response.json(data,{status,headers:readingHeaders});

// [LUX-AUTH-007] O campo `password` é mantido no payload para compatibilidade,
// porém agora aceita a credencial revogável `luxsess_...`. Nenhuma função de
// leitura precisa consultar `usuarios.senha` diretamente.
export async function readingAuth(body: any, requireAdmin=false) {
  if(!body || typeof body.username!=='string' || !body.username || body.username.length>256 || typeof body.password!=='string' || !body.password || body.password.length>1024) {
    throw {status:401,message:'Entre na sua conta.'};
  }

  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:account,error}=await db.rpc('lux_auth_resolve',{
    p_username:body.username,
    p_credential:body.password
  });
  if(error)throw error;
  if(!account)throw {status:401,message:'Credencial inválida ou sessão expirada.'};

  const rawExpiry=String(account.vencimento||''),expiry=rawExpiry.split('/');
  const day=/^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)?rawExpiry:expiry.length===3?`${expiry[2]}-${expiry[1].padStart(2,'0')}-${expiry[0].padStart(2,'0')}`:'';
  if(day&&Date.now()>new Date(day+'T23:59:59-03:00').getTime())throw {status:403,message:'Acesso vencido.'};

  const slot=body.profileSlot??1;
  if(![1,2,3,4].includes(slot) || typeof (body.profileKey??'')!=='string')throw {status:400,message:'Perfil inválido.'};
  const {data:profile,error:pe}=await db.from('account_profiles').select('slot,data_key,is_child').eq('user_name',account.usuario).eq('slot',slot).maybeSingle();
  if(pe)throw pe;
  if(!profile || (profile.data_key||'')!==(body.profileKey||''))throw {status:403,message:'Perfil alterado. Selecione-o novamente.'};
  const isAdmin=String(account.cargo).trim().toLowerCase()==='admin'&&!profile.is_child;
  if(requireAdmin&&!isAdmin)throw {status:403,message:'Apenas administradores podem alterar o catálogo.'};
  return {db,account,profile,slot,isAdmin,profileKey:profile.data_key||'slot:'+slot};
}
