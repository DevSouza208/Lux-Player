(() => {
  'use strict';

  const VERSION = '20260915-sport-banner-tags1';
  if (window.__luxSportBannerTagsInstalled === VERSION) return;
  window.__luxSportBannerTagsInstalled = VERSION;

  const CACHE_MS = 60_000;
  let cache = { at: 0, banners: [] };
  let pending = null;
  let scheduled = false;
  let renderToken = 0;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[×]/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function ensureStyles() {
    if ($('luxSportHeroTagsStyle')) return;
    const style = document.createElement('style');
    style.id = 'luxSportHeroTagsStyle';
    style.textContent = `
      #heroSportMetaTags {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 14px;
        margin-bottom: 2px;
        max-width: min(760px, 100%);
      }
      #heroSportMetaTags .lux-sport-meta-tag {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 6px 11px;
        border-radius: 999px;
        border: 1px solid rgba(168, 85, 247, .34);
        background: rgba(88, 28, 135, .20);
        color: rgba(233, 213, 255, .96);
        font-size: 12px;
        line-height: 1;
        font-weight: 700;
        white-space: nowrap;
        backdrop-filter: blur(8px);
      }
      #heroSportMetaTags .lux-sport-meta-tag[data-live="1"] {
        border-color: rgba(16, 185, 129, .46);
        background: rgba(5, 150, 105, .20);
        color: #a7f3d0;
      }
      @media (max-width: 767px) {
        #heroSportMetaTags { gap: 6px; margin-top: 11px; }
        #heroSportMetaTags .lux-sport-meta-tag {
          min-height: 27px;
          padding: 5px 9px;
          font-size: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureContainer(overview) {
    ensureStyles();
    let box = $('heroSportMetaTags');
    if (!box) {
      box = document.createElement('div');
      box.id = 'heroSportMetaTags';
      box.className = 'hidden';
      box.setAttribute('aria-label', 'Informações da partida');
    }
    if (overview?.parentElement && box.parentElement !== overview.parentElement) {
      overview.insertAdjacentElement('afterend', box);
    } else if (overview && overview.nextElementSibling !== box) {
      overview.insertAdjacentElement('afterend', box);
    }
    return box;
  }

  async function listPublic() {
    const now = Date.now();
    if (now - cache.at < CACHE_MS) return cache.banners;
    if (pending) return pending;

    pending = (async () => {
      try {
        if (window.LuxHomeBanners?.listPublic) {
          const banners = await window.LuxHomeBanners.listPublic();
          cache = { at: Date.now(), banners: Array.isArray(banners) ? banners : [] };
          return cache.banners;
        }
        if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) return cache.banners;
        const { data, error } = await supabaseClient.functions.invoke('home-banners', { body: { action: 'list_public' } });
        if (error || data?.error) return cache.banners;
        cache = { at: Date.now(), banners: Array.isArray(data?.banners) ? data.banners : [] };
        return cache.banners;
      } catch (_) {
        return cache.banners;
      } finally {
        pending = null;
      }
    })();

    return pending;
  }

  function bannerNames(banner) {
    const home = banner?.source_payload?.home || '';
    const away = banner?.source_payload?.away || '';
    return [
      banner?.classic_name,
      banner?.title,
      home && away ? `${home} x ${away}` : '',
      home && away ? `${home} × ${away}` : ''
    ].map(normalize).filter(Boolean);
  }

  function findSportBanner(banners, heroTitle) {
    const title = normalize(heroTitle);
    if (!title) return null;
    return (banners || []).find(banner => banner?.kind === 'sport' && bannerNames(banner).includes(title)) || null;
  }

  function formatKickoff(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace(/\.$/, '');
    const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `${weekday}, ${day} • ${time}`;
  }

  function isLive(banner) {
    const kickoff = Date.parse(banner?.event_at || '');
    if (!Number.isFinite(kickoff)) return false;
    const delta = Date.now() - kickoff;
    return delta >= -3 * 60_000 && delta <= 180 * 60_000;
  }

  function phaseTags(value) {
    return String(value || '')
      .split(/\s+(?:-|–|—|•|·|\|)\s+/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function sportTags(banner) {
    const values = [];
    if (banner?.competition_name) values.push({ text: banner.competition_name });
    phaseTags(banner?.phase).forEach(text => values.push({ text }));
    const kickoff = formatKickoff(banner?.event_at);
    if (kickoff) values.push({ text: kickoff });

    const channels = Array.isArray(banner?.channels) ? banner.channels : [];
    channels.forEach(channel => {
      const text = String(channel?.label || channel || '').trim();
      if (text) values.push({ text });
    });

    if (isLive(banner)) values.push({ text: 'AO VIVO', live: true });

    const seen = new Set();
    return values.filter(tag => {
      const key = normalize(tag.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
  }

  function hideTags() {
    const box = $('heroSportMetaTags');
    if (!box) return;
    box.classList.add('hidden');
    box.replaceChildren();
  }

  async function syncHero() {
    scheduled = false;
    const token = ++renderToken;
    const titleEl = $('heroTitle');
    const overview = $('heroOverview');
    if (!titleEl || !overview) return;

    const titleBefore = titleEl.textContent || '';
    const banners = await listPublic();
    if (token !== renderToken || (titleEl.textContent || '') !== titleBefore) return;

    const banner = findSportBanner(banners, titleBefore);
    if (!banner) {
      hideTags();
      return;
    }

    const description = String(banner.description || '').trim() || 'Jogo em destaque no Lux Play.';
    if (overview.textContent !== description) overview.textContent = description;

    const tags = sportTags(banner);
    const box = ensureContainer(overview);
    if (!tags.length) {
      box.classList.add('hidden');
      box.replaceChildren();
      return;
    }

    box.innerHTML = tags.map(tag => `<span class="lux-sport-meta-tag"${tag.live ? ' data-live="1"' : ''}>${esc(tag.text)}</span>`).join('');
    box.classList.remove('hidden');
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => setTimeout(syncHero, 0));
  }

  function installObserver() {
    const wrap = $('heroContentWrap') || $('homeSection') || document.body;
    if (!wrap) return false;
    const observer = new MutationObserver(scheduleSync);
    observer.observe(wrap, { subtree: true, childList: true, characterData: true });
    scheduleSync();
    window.LuxSportBannerTags = {
      version: VERSION,
      refresh() { cache.at = 0; scheduleSync(); }
    };
    return true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();
})();
