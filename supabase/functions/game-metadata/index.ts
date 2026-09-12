import { wikiGames } from './wiki.ts';
import { pokemonHacks } from './pokemon-hacks.ts';
// Supabase Edge Function: busca candidatos no IGDB sem expor credenciais no navegador.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

function consoleFromPlatforms(platforms: Array<{ name?: string }> = []) {
  const names = platforms.map(platform => (platform.name || '').toLowerCase());
  if (names.some(name => name.includes('game boy advance'))) return 'gba';
  if (names.some(name => name.includes('super nintendo') || name.includes('snes'))) return 'snes';
  if (names.some(name => name.includes('master system') || name.includes('sega master'))) return 'mastersystem';
  if (names.some(name => name.includes('mega drive') || name.includes('genesis'))) return 'megadrive';
  if (names.some(name => name.includes('playstation portable') || name === 'psp')) return 'psp';
  if (names.some(name => name.includes('nintendo 64'))) return 'n64';
  if (names.some(name => name.includes('nintendo entertainment system'))) return 'nes';
  if (names.some(name => name.includes('game boy color'))) return 'gbc';
  if (names.some(name => name.includes('game boy'))) return 'gb';
  return '';
}


async function igdbGames(query:string) {
    const clientId = Deno.env.get('IGDB_CLIENT_ID');
    const clientSecret = Deno.env.get('IGDB_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('IGDB_CLIENT_ID e IGDB_CLIENT_SECRET não foram configurados');

    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }), signal: AbortSignal.timeout(6000)
    });
    if (!tokenResponse.ok) throw new Error('Não foi possível autenticar no IGDB');
    const { access_token } = await tokenResponse.json();

    const escapedQuery = query.trim().replace(/["\\\u0000-\u001f]/g, ' ');
    const igdbResponse = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${access_token}` },
      body: `search "${escapedQuery}"; fields name,url,summary,first_release_date,genres.name,cover.image_id,platforms.name; limit 8;`, signal: AbortSignal.timeout(6000)
    });
    if (!igdbResponse.ok) throw new Error('A busca no IGDB falhou');
    const games = await igdbResponse.json();

    const results = games.map((game: any) => ({
      external_id: String(game.id),
      source_url: game.url || 'https://www.igdb.com',
      title: game.name || '',
      synopsis: game.summary || '',
      release_year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
      genres: (game.genres || []).map((genre: { name?: string }) => genre.name).filter(Boolean),
      console: consoleFromPlatforms(game.platforms),
      cover_url: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : ''
    }));


 return results.map(game=>({...game,metadata_source:'igdb',attribution:'IGDB'}));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Método não permitido' }, { status: 405, headers: corsHeaders });

  try {
    const { query, action, text, source = 'en' } = await request.json();
    if (action === 'translate') {
      if (typeof text !== 'string' || !text.trim() || text.length > 120000) return Response.json({ error: 'Texto inválido ou grande demais' }, { status: 400, headers: corsHeaders });
      const sourceLanguage=/^(en|es|fr|de)$/.test(source)?source:'en';
      const response = await fetch(`https://api.mymemory.translated.net/get?${new URLSearchParams({q:text.slice(0,500),langpair:`${sourceLanguage}|pt`})}`,{headers:{'User-Agent':'LuxPlay/1.4 (translation)'}});
      if (!response.ok) throw new Error('A tradução não está disponível no momento');
      const data = await response.json();
      if(data.responseStatus!==200||!data.responseData?.translatedText)throw new Error('A tradução não está disponível no momento');
      const translated=data.responseData.translatedText;
      return Response.json({ text: translated }, { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 300) {
      return Response.json({ error: 'Informe ao menos dois caracteres' }, { status: 400, headers: corsHeaders });
    }

    const cleanQuery=query.replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/\.[a-z0-9]{2,4}$/i,'').replace(/\s+/g,' ').trim();
    if(cleanQuery.length<2)return Response.json({error:'Informe o nome do jogo.'},{status:400,headers:corsHeaders});
    const sources=await Promise.allSettled([igdbGames(cleanQuery),wikiGames(cleanQuery,'pt'),wikiGames(cleanQuery,'en'),pokemonHacks(cleanQuery)]);
    const results=sources.flatMap(result=>result.status==='fulfilled'?result.value:[]);
    const warnings=sources.map((result,index)=>result.status==='rejected'?['IGDB','Wikipédia PT','Wikipedia EN','PokéAggregator'][index]:null).filter(Boolean);
    return Response.json({results,warnings}, {headers:corsHeaders});
  } catch (error) {
    return Response.json({ error: error.message || 'Erro ao buscar metadados' }, { status: 500, headers: corsHeaders });
  }
});

