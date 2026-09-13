(() => {
  'use strict';
  if (window.__luxSportsLogoDecoratorInstalled === '20260913-footy-fast1') return;
  window.__luxSportsLogoDecoratorInstalled = '20260913-footy-fast1';

  const failed = new Set();
  let scheduled = false;

  const norm = v => String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/&/g,' e ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const FOOTY = new Map(Object.entries({
    'santos':'santos-fc','santos fc':'santos-fc','sao paulo':'sao-paulo','sao paulo fc':'sao-paulo','spfc':'sao-paulo',
    'bragantino':'rb-bragantino','rb bragantino':'rb-bragantino','red bull bragantino':'rb-bragantino',
    'atletico mg':'atletico-mineiro','atletico mineiro':'atletico-mineiro','athletico pr':'athletico-paranaense',
    'athletico paranaense':'athletico-paranaense','internacional':'sc-internacional','vasco':'vasco-da-gama',
    'vasco da gama':'vasco-da-gama','flamengo':'flamengo-crf','mirassol':'mirassol-fc','remo':'clube-de-remo',
    'ceara':'ceara-sc','sport':'sport-recife','celta':'celta-vigo','coventry':'coventry-city',
    'brighton':'brighton-hove-albion','psg':'paris-saint-germain-psg','paris saint germain':'paris-saint-germain-psg',
    'liverpool':'liverpool-fc','bayern de munique':'bayern-munich',
    'fc dallas':'fc-dallas','portland timbers':'portland-timbers','st louis city sc':'st-louis-city-sc',
    'minnesota united fc':'minnesota-united','minnesota united':'minnesota-united','monterrey':'monterrey',
    'tigres uanl':'tigres-uanl','colorado rapids':'colorado-rapids','cf montreal':'cf-montreal',
    'racing santander':'racing-santander','alaves':'deportivo-alaves','deportivo alaves':'deportivo-alaves',
    'genoa':'genoa','frosinone':'frosinone-calcio','frosinone calcio':'frosinone-calcio',
    'borussia dortmund':'borussia-dortmund','dortmund':'borussia-dortmund','augsburg':'fc-augsburg',
    'fc augsburg':'fc-augsburg','bayer leverkusen':'bayer-leverkusen'
  }));

  function ensureConnectionHints() {
    if (!document.head.querySelector('link[data-lux-footy-preconnect]')) {
      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = 'https://assets.footylogos.com';
      preconnect.crossOrigin = 'anonymous';
      preconnect.dataset.luxFootyPreconnect = '1';
      document.head.appendChild(preconnect);
    }
    if (!document.head.querySelector('link[data-lux-footy-dns]')) {
      const dns = document.createElement('link');
      dns.rel = 'dns-prefetch';
      dns.href = '//assets.footylogos.com';
      dns.dataset.luxFootyDns = '1';
      document.head.appendChild(dns);
    }
  }

  function teamSlug(name) {
    const full = norm(name).replace(/\b(?:da|de|do|das|dos)\b/g,' ').replace(/\s+/g,' ').trim();
    const simple = full.replace(/\b(?:clube|club|futebol|football|fc|sc|ec|ac|cf|saf)\b/g,' ').replace(/\s+/g,' ').trim();
    return FOOTY.get(full) || FOOTY.get(simple) || full.replace(/\s+/g,'-');
  }

  function footyUrl(name) {
    const slug = teamSlug(name);
    return slug ? `https://assets.footylogos.com/logos/${slug}/${slug}-logo-footylogos.svg` : '';
  }

  function gameForCard(card) {
    const gameId = card.querySelector('[data-game]')?.dataset.game;
    const games = window.LuxSports?.state?.games || [];
    if (gameId) return games.find(g => g.id === gameId) || null;
    const text = norm(card.textContent);
    return games.find(g => text.includes(norm(g.home)) && text.includes(norm(g.away))) || null;
  }

  function applyLogo(teamBox, name, priority = false) {
    const holder = teamBox?.querySelector('div');
    if (!holder || holder.querySelector('[data-footy-logo]')) return;
    const url = footyUrl(name);
    if (!url || failed.has(url)) return;

    const img = document.createElement('img');
    img.dataset.footyLogo = '1';
    img.src = url;
    img.alt = '';
    img.loading = priority ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.fetchPriority = priority ? 'high' : 'low';
    img.referrerPolicy = 'no-referrer';
    img.className = 'h-9 w-9 object-contain';
    img.style.display = 'none';
    img.onload = () => {
      img.style.display = 'block';
      holder.querySelector('[data-shield-fallback]')?.classList.add('hidden');
    };
    img.onerror = () => {
      failed.add(url);
      img.remove();
    };
    holder.prepend(img);
  }

  function decorateCard(card, index) {
    const game = gameForCard(card);
    if (!game) return;
    const grid = card.children?.[1];
    if (!grid || grid.children.length < 3) return;
    const priority = index < 6;
    applyLogo(grid.children[0], game.home, priority);
    applyLogo(grid.children[2], game.away, priority);

    const footer = card.lastElementChild;
    if (footer && !/footylogos/i.test(footer.textContent || '')) {
      footer.textContent = `${footer.textContent || ''} · escudos: FootyLogos`;
    }
  }

  function decorate() {
    const cards = [...document.querySelectorAll('#homeJogosContainer [data-sports-guide-card]')];
    cards.forEach((card, index) => decorateCard(card, index));
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  function boot() {
    ensureConnectionHints();
    decorate();
    const home = document.getElementById('homeJogosContainer');
    if (home) {
      const observer = new MutationObserver(scheduleDecorate);
      observer.observe(home,{childList:true});
    }
    window.LuxSportsLogos = { decorate, footyUrl };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();