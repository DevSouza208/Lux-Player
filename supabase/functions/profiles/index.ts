import { createClient } from 'npm:@supabase/supabase-js@2';

// [LUX-AUTH-007] `password` é um nome legado do payload. Ele pode conter a senha
// durante a migração ou, preferencialmente, um token revogável luxsess_.
const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Cache-Control':'no-store' };
const json = (data: unknown, status = 200) => Response.json(data,{status,headers});
Deno.serve(async (request: Request) => {
  if(request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if(request.method !== 'POST') return json({error:'Método não permitido.'},405);
  try {
    let body;
    try { body=await request.json(); } catch { return json({error:'Dados inválidos.'},400); }
    if(!body || typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username || !body.password) return json({error:'Login necessário.'},401);
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});

    const {data:account,error:authError}=await db.rpc('lux_auth_resolve',{
      p_username:body.username,
      p_credential:body.password
    });
    if(authError) throw authError;
    if(!account) return json({error:'Credencial inválida ou sessão expirada.'},401);

    const expiry=String(account.vencimento || '').split('/');
    if(expiry.length===3 && Date.now()>new Date(`${expiry[2]}-${expiry[1].padStart(2,'0')}-${expiry[0].padStart(2,'0')}T23:59:59-03:00`).getTime()) return json({error:'Acesso vencido.'},403);
    if(['gallery-list','gallery-save','gallery-delete'].includes(body.action)) {
      if(body.action!=='gallery-list' && account.cargo!=='admin')return json({error:'Apenas administradores podem alterar a galeria.'},403);
      if(body.action==='gallery-save') {
        if(typeof body.name!=='string' || !body.name.trim() || body.name.length>40 || typeof body.avatar_data!=='string' || body.avatar_data.length>180000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(body.avatar_data))return json({error:'Informe nome e foto válidos.'},400);
        const {error}=await db.from('profile_avatar_gallery').insert({name:body.name.trim(),avatar_data:body.avatar_data});if(error)throw error;
      }
      if(body.action==='gallery-delete') {
        if(typeof body.id!=='string')return json({error:'Foto inválida.'},400);
        const {error}=await db.from('profile_avatar_gallery').delete().eq('id',body.id);if(error)throw error;
      }
      const {data,error}=await db.from('profile_avatar_gallery').select('id,name,avatar_data').order('created_at');if(error)throw error;
      return json({profiles:data});
    }
    const {error:seedError}=await db.rpc('ensure_account_profile',{p_user:account.usuario,p_name:String(account.nome || 'Principal').slice(0,30)});
    if(seedError)throw seedError;
    if(body.action==='save') {
      if(typeof body.name!=='string' || !body.name.trim() || body.name.trim().length>30 || typeof body.is_child!=='boolean' || (body.slot != null && ![1,2,3,4].includes(body.slot))) return json({error:'Informe nome, tipo e perfil válidos.'},400);
      const avatar=body.avatar_data ?? '';
      if(typeof avatar!=='string' || avatar.length>180000 || (avatar && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) || typeof body.password_protected!=='boolean') return json({error:'Foto ou proteção do perfil inválida.'},400);
      const {error}=await db.rpc('save_account_profile',{p_user:account.usuario,p_name:body.name.trim(),p_child:body.is_child,p_slot:body.slot??null,p_avatar:avatar,p_protected:body.password_protected});
      if(error) return json({error:'Não foi possível salvar. Confira o limite de 4 perfis e tente novamente.'},409);
    } else if(body.action==='delete') {
      // A confirmação compara com a credencial atual (senha ou token da sessão).
      if(![1,2,3,4].includes(body.slot) || typeof body.data_key!=='string' || body.confirmPassword!==body.password) return json({error:'Confirme a credencial da conta para excluir.'},400);
      const {error}=await db.rpc('delete_account_profile',{p_user:account.usuario,p_slot:body.slot,p_data_key:body.data_key});
      if(error)return json({error:'Não foi possível excluir. Mantenha pelo menos um perfil e atualize a lista antes de tentar novamente.'},409);
    } else if(body.action!=='list') return json({error:'Ação inválida.'},400);
    const {data,error}=await db.from('account_profiles').select('slot,name,is_child,avatar_data,password_protected,data_key').eq('user_name',account.usuario).order('slot');
    if(error) throw error;
    return json({profiles:data});
  }catch {return json({error:'Não foi possível acessar os perfis. Tente novamente.'},500);}
});
