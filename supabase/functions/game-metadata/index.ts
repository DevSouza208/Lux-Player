import { wikiGames } from './wiki.ts';
import { pokemonHacks } from './pokemon-hacks.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

type MetadataResult = {
  external_id: string;
  source_url?: string;
  title: string;
  synopsis?: string;
  release_year?: number | null;
  genres?: string[];
  console?: string;
  cover_url?: string;
  screenshots?: string[];
  critic_score?: number | null;
  user_score?: number | null;
  metadata_source: string;
  attribution: string;
};

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function consoleFromPlatforms(platforms: Array<{ name?: string }> = []) {
  const names = platforms.map(platform => (platform.name || '').toLowerCase());
  if (names.some(name => name.includes('arcade') || name.includes('neo geo'))) return 'arcade';
  if (names.some(name => name.includes('game boy advance'))) return 'gba';
  if (names.some(name => name.includes('game boy color'))) return 'gbc';
  if (names.some(name => name === 'game boy' || name.includes('game boy original'))) return 'gb';
  if (names.some(name => name.includes('super nintendo') || name.includes('snes') || name.includes('super famicom'))) return 'snes';
  if (names.some(name => name.includes('master system') || name.includes('sega master'))) return 'mastersystem';
  if (names.some(name => name.includes('mega drive') || name.includes('genesis'))) return 'megadrive';
  if (names.some(name => name.includes('playstation portable') || name === 'psp')) return 'psp';
  if (names.some(name => name.includes('nintendo 64'))) return 'n64';
  if (names.some(name => name.includes('nintendo entertainment system') || name === 'nes' || name.includes('famicom'))) return 'nes';
  return '';
}

function yearFrom(value: unknown) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function forceHttps(value: unknown) {
  return String(value || '').replace(/^http:\/\//i, 'https://');
}

function relevanceScore(game: MetadataResult, query: string) {
  const q = normalizeText(query);
  const title = normalizeText(game.title);
  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 55;
  else if (title.includes(q)) score += 30;
  if (game.console) score += 18;
  if (game.cover_url) score += 10;
  if (game.synopsis) score += 6;
  if (game.critic_score != null) score += 4;
  if (game.metadata_source === 'igdb') score += 3;
  return score;
}

async function igdbGames(query: string): Promise<MetadataResult[]> {
  const clientId = Deno.env.get('IGDB_CLIENT_ID');
  const clientSecret = Deno.env.get('IGDB_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('IGDB não configurado');

  const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(7000)
  });
  if (!tokenResponse.ok) throw new Error('Não foi possível autenticar no IGDB');
  const { access_token } = await tokenResponse.json();

  const escapedQuery = query.trim().replace(/["\\\u0000-\u001f]/g, ' ');
  const response = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${access_token}` },
    body: `search "${escapedQuery}"; fields name,url,summary,first_release_date,genres.name,cover.image_id,platforms.name; limit 12;`,
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error('A busca no IGDB falhou');
  const games = await response.json();

  return games.map((game: any) => ({
    external_id: String(game.id),
    source_url: game.url || 'https://www.igdb.com',
    title: game.name || '',
    synopsis: game.summary || '',
    release_year: game.first_release_date ? new Date(game.first_release_date * 1000).getUTCFullYear() : null,
    genres: (game.genres || []).map((genre: any) => genre.name).filter(Boolean),
    console: consoleFromPlatforms(game.platforms || []),
    cover_url: game.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg` : '',
    screenshots: [],
    critic_score: null,
    user_score: null,
    metadata_source: 'igdb',
    attribution: 'IGDB'
  }));
}

async function rawgGames(query: string): Promise<MetadataResult[]> {
  const key = Deno.env.get('RAWG_API_KEY');
  if (!key) throw new Error('RAWG_API_KEY não configurada');

  const url = new URL('https://api.rawg.io/api/games');
  url.searchParams.set('key', key);
  url.searchParams.set('search', query);
  url.searchParams.set('search_precise', 'true');
  url.searchParams.set('page_size', '12');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'LuxPlay/1.4 (game metadata lookup)' },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`RAWG HTTP ${response.status}`);
  const data = await response.json();

  return (data.results || []).map((game: any) => {
    const metacritic = Number.isFinite(Number(game.metacritic)) ? Number(game.metacritic) : null;
    const userRating = Number.isFinite(Number(game.rating)) ? Number(game.rating) : null;
    return {
      external_id: String(game.id),
      source_url: game.slug ? `https://rawg.io/games/${game.slug}` : 'https://rawg.io',
      title: game.name || '',
      synopsis: '',
      release_year: yearFrom(game.released),
      genres: (game.genres || []).map((genre: any) => genre.name).filter(Boolean),
      console: consoleFromPlatforms((game.platforms || []).map((entry: any) => ({ name: entry?.platform?.name || '' }))),
      cover_url: game.background_image || '',
      screenshots: (game.short_screenshots || []).map((shot: any) => shot.image).filter(Boolean).slice(0, 5),
      critic_score: metacritic,
      user_score: userRating,
      metadata_source: 'rawg',
      attribution: `RAWG${metacritic != null ? ` · Metacritic ${metacritic}` : ''}${userRating != null ? ` · usuários ${userRating.toFixed(1)}/5` : ''}`
    };
  });
}

async function mobyGames(query: string): Promise<MetadataResult[]> {
  const key = Deno.env.get('MOBYGAMES_API_KEY');
  if (!key) throw new Error('MOBYGAMES_API_KEY não configurada');

  const url = new URL('https://api.mobygames.com/v1/games');
  url.searchParams.set('api_key', key);
  url.searchParams.set('title', query);
  url.searchParams.set('format', 'normal');
  url.searchParams.set('limit', '10');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'LuxPlay/1.4 (game metadata lookup)' },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`MobyGames HTTP ${response.status}`);
  const data = await response.json();

  return (data.games || []).map((game: any) => {
    const platforms = (game.platforms || []).map((platform: any) => ({ name: platform.platform_name || platform.name || '' }));
    const dates = (game.platforms || []).map((platform: any) => yearFrom(platform.first_release_date)).filter(Boolean);
    const mobyScore = Number.isFinite(Number(game.moby_score)) ? Number(game.moby_score) : null;
    const cover = forceHttps(game.sample_cover?.image || game.sample_cover?.thumbnail_image || '');
    const screenshots = (game.sample_screenshots || []).map((shot: any) => forceHttps(shot.image || shot.thumbnail_image)).filter(Boolean).slice(0, 5);
    return {
      external_id: String(game.game_id),
      source_url: forceHttps(game.moby_url || 'https://www.mobygames.com'),
      title: game.title || '',
      synopsis: String(game.description || game.brief_description || ''),
      release_year: dates.length ? Math.min(...dates) : null,
      genres: (game.genres || []).map((genre: any) => genre.genre_name || genre.name).filter(Boolean),
      console: consoleFromPlatforms(platforms),
      cover_url: cover,
      screenshots,
      critic_score: null,
      user_score: mobyScore,
      metadata_source: 'mobygames',
      attribution: `Data by MobyGames.com${mobyScore != null ? ` · Moby ${mobyScore.toFixed(1)}/5` : ''}`
    };
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Método não permitido' }, { status: 405, headers: corsHeaders });

  try {
    const { query, action, text, source = 'en' } = await request.json();
    if (action === 'translate') {
      if (typeof text !== 'string' || !text.trim() || text.length > 120000) return Response.json({ error: 'Texto inválido ou grande demais' }, { status: 400, headers: corsHeaders });
      const sourceLanguage = /^(en|es|fr|de)$/.test(source) ? source : 'en';
      const response = await fetch(`https://api.mymemory.translated.net/get?${new URLSearchParams({ q: text.slice(0, 500), langpair: `${sourceLanguage}|pt` })}`, { headers: { 'User-Agent': 'LuxPlay/1.4 (translation)' } });
      if (!response.ok) throw new Error('A tradução não está disponível no momento');
      const data = await response.json();
      if (data.responseStatus !== 200 || !data.responseData?.translatedText) throw new Error('A tradução não está disponível no momento');
      return Response.json({ text: data.responseData.translatedText }, { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
    }

    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 300) {
      return Response.json({ error: 'Informe ao menos dois caracteres' }, { status: 400, headers: corsHeaders });
    }

    const cleanQuery = query.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\s+/g, ' ').trim();
    if (cleanQuery.length < 2) return Response.json({ error: 'Informe o nome do jogo.' }, { status: 400, headers: corsHeaders });

    const definitions = [
      ['IGDB', () => igdbGames(cleanQuery)],
      ['RAWG / Metacritic', () => rawgGames(cleanQuery)],
      ['MobyGames', () => mobyGames(cleanQuery)],
      ['Wikipédia PT', () => wikiGames(cleanQuery, 'pt')],
      ['Wikipedia EN', () => wikiGames(cleanQuery, 'en')],
      ['PokéAggregator', () => pokemonHacks(cleanQuery)]
    ] as const;

    const settled = await Promise.allSettled(definitions.map(([, loader]) => loader()));
    const results = settled
      .flatMap(result => result.status === 'fulfilled' ? result.value : [])
      .sort((a: any, b: any) => relevanceScore(b, cleanQuery) - relevanceScore(a, cleanQuery))
      .slice(0, 42);

    const warnings = settled
      .map((result, index) => result.status === 'rejected' ? `${definitions[index][0]}: ${String(result.reason?.message || result.reason || 'indisponível')}` : null)
      .filter(Boolean);

    return Response.json({ results, warnings }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error?.message || 'Erro ao buscar metadados' }, { status: 500, headers: corsHeaders });
  }
});
