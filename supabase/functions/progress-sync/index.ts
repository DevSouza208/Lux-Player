import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const MAX_RECORDS = 400;

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function validRecord(record: any) {
  return record && typeof record.key === 'string' && record.key.length <= 500 && /^(favorite:|resume:lux_progress_|series:|preference:category-order:)/.test(record.key) &&
    Number.isSafeInteger(Number(record.updatedAt)) && Number(record.updatedAt)>0 && Number(record.updatedAt)<=Date.now()+300000 && record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) && JSON.stringify(record.payload).length<=100000;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  try {
    const { action, username, password, records = [], profileSlot = 1, profileKey = '' } = await request.json();
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return json({ error: 'Credenciais inválidas.' }, 401);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) throw new Error('Configuração do Supabase indisponível.');
    const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

    // Compatível com a autenticação atual do Lux Play. Quando o app migrar para
    // Supabase Auth, este bloco pode usar o JWT em vez de consultar usuarios.
    const { data: account, error: accountError } = await admin
      .from('usuarios')
      .select('usuario')
      .eq('usuario', username)
      .eq('senha', password)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return json({ error: 'Credenciais inválidas.' }, 401);

    const userName = String(account.usuario);
    if (![1,2,3,4].includes(profileSlot)) return json({error:'Perfil inválido.'},400);
    const {data:profile,error:profileError}=await admin.from('account_profiles').select('slot,data_key').eq('user_name',userName).eq('slot',profileSlot).maybeSingle();
    if(profileError)throw profileError;
    if(!profile || (profile.data_key || '')!==profileKey)return json({error:'Perfil alterado. Selecione o perfil novamente.'},403);
    const prefix = profile.data_key ? 'profile:' + profile.data_key + ':' : profileSlot === 1 ? '' : 'profile:' + profileSlot + ':';
    if (action === 'pull') {
      const records = [];
      let page;
      do {
        let query=admin.from('user_progress').select('sync_key, payload, client_updated_at').eq('user_name',userName);
        query=prefix ? query.like('sync_key',prefix+'%') : query.not('sync_key','like','profile:%');
        const {data,error}=await query.order('sync_key').range(records.length,records.length+499);
        if(error) throw error;
        page=data || [];records.push(...page);
      } while(page.length===500);
      return json({records:records.map(row=>({key:row.sync_key.slice(prefix.length),payload:row.payload,updatedAt:Number(row.client_updated_at)}))});
    }

    if (action !== 'push' || !Array.isArray(records) || records.length > MAX_RECORDS || records.some((record: any) => !validRecord(record))) {
      return json({ error: 'Dados de sincronização inválidos.' }, 400);
    }

    const uniqueRecords = Array.from(new Map(records.map((record: any) => [record.key, record])).values()) as any[];
    const {data:saved,error:saveError}=await admin.rpc('commit_user_progress',{
      p_user:userName,p_records:uniqueRecords.map(record=>({key:prefix+record.key,payload:record.payload,updatedAt:Number(record.updatedAt)}))
    });
    if(saveError)throw saveError;
    return json({ saved:Number(saved)||0 });
  } catch (error) {
    console.error('progress-sync:', error);
    return json({ error: error.message || 'Não foi possível sincronizar o progresso.' }, 500);
  }
});
