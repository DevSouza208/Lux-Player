(() => {
  'use strict';

  const VERSION = '20260914-secondary-locale-preview1';
  if (window.__luxSecondaryLocalePreviewInstalled === VERSION) return;
  window.__luxSecondaryLocalePreviewInstalled = VERSION;

  const FUNCTION_NAME = 'content-locale-reviews';
  let activeHls = null;
  let pending = false;

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  function authBody(extra = {}) {
    const user = safeCurrentUser();
    return {
      username: String(user?.user || '').trim(),
      password: String(user?.pass || ''),
      ...extra
    };
  }

  async function invoke(action, extra = {}) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) {
      throw new Error('Serviço de nuvem indisponível.');
    }
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
      body: authBody({ action, ...extra })
    });
    if (error) throw new Error(data?.error || error.message || 'Não foi possível carregar a amostra.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function closePreview() {
    try { activeHls?.destroy?.(); } catch (_) {}
    activeHls = null;
    const modal = document.getElementById('luxLocalePreviewModal');
    const video = modal?.querySelector('video');
    try {
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    } catch (_) {}
    modal?.remove();
  }

  function openPreview(preview) {
    closePreview();
    const url = String(preview?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('A amostra não possui uma URL reproduzível.');

    const overlay = document.createElement('div');
    overlay.id = 'luxLocalePreviewModal';
    overlay.className = 'fixed inset-0 z-[180] flex items-center justify-center bg-black/95 p-3 backdrop-blur-md';
    const seasonEpisode = preview?.season && preview?.episode
      ? `T${Number(preview.season)}E${Number(preview.episode)}`
      : '';
    overlay.innerHTML = `
      <section class="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-sky-800/60 bg-[#09060e] shadow-2xl">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-purple-950 bg-[#120c1f] px-4 py-3">
          <div class="min-w-0">
            <p class="text-sm font-black text-white">${escapeHtml(preview?.title || 'Amostra')}</p>
            <p class="mt-0.5 truncate text-[11px] text-purple-300">${seasonEpisode ? `${escapeHtml(seasonEpisode)} · ` : ''}${escapeHtml(preview?.episode_title || preview?.original_title || 'Amostra para identificar o idioma')}</p>
          </div>
          <button id="luxLocalePreviewClose" type="button" class="rounded-xl border border-purple-800 px-3 py-2 text-xs font-bold text-purple-200 hover:bg-purple-900/50">Voltar à revisão</button>
        </header>
        <div class="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          <video id="luxLocalePreviewVideo" controls autoplay playsinline class="h-full w-full bg-black object-contain"></video>
          <div id="luxLocalePreviewMessage" class="pointer-events-none absolute bottom-3 left-3 right-3 hidden rounded-xl bg-black/75 px-3 py-2 text-center text-xs text-amber-200"></div>
        </div>
        <footer class="shrink-0 border-t border-purple-950 bg-[#120c1f] px-4 py-2 text-[10px] text-purple-400">
          Reprodução temporária apenas para você conferir áudio/legenda antes de classificar. Nada é salvo no “Continuar assistindo”.
        </footer>
      </section>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#luxLocalePreviewClose')?.addEventListener('click', closePreview);
    overlay.addEventListener('click', event => { if (event.target === overlay) closePreview(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('luxLocalePreviewModal')) closePreview();
    }, { once: true });

    const video = overlay.querySelector('#luxLocalePreviewVideo');
    const message = overlay.querySelector('#luxLocalePreviewMessage');
    if (!video) return;

    const showError = text => {
      if (!message) return;
      message.textContent = text;
      message.classList.remove('hidden');
    };

    if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
      showError('Este link é HTTP e pode ser bloqueado pelo navegador em uma página HTTPS. No preview local/Electron ele tende a funcionar normalmente.');
    }

    if (/\.m3u8?(?:$|[?#])/i.test(url) && window.Hls?.isSupported?.()) {
      activeHls = new window.Hls();
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) showError('Não foi possível reproduzir esta amostra HLS. Tente outro item da revisão.');
      });
    } else {
      video.src = url;
    }

    video.addEventListener('error', () => showError('A fonte recusou ou não conseguiu reproduzir esta amostra. Isso não altera sua decisão de idioma.'));
    video.play().catch(() => {});
  }

  async function watchReview(id, button) {
    if (pending) return;
    pending = true;
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Carregando...';
    }
    try {
      const data = await invoke('preview', { id: Number(id) });
      if (!data?.preview?.url) throw new Error('Nenhuma amostra reproduzível encontrada.');
      openPreview(data.preview);
    } catch (error) {
      alert(error?.message || 'Não foi possível abrir a amostra.');
    } finally {
      pending = false;
      if (button) {
        button.disabled = false;
        button.textContent = oldText || 'Assistir';
      }
    }
  }

  function installButtons() {
    const root = document.getElementById('secondaryLocaleReviewsList');
    if (!root) return false;
    const cards = root.querySelectorAll('article');
    cards.forEach(card => {
      if (card.querySelector('[data-locale-preview-id]')) return;
      const decision = card.querySelector('[data-locale-review-id]');
      if (!decision) return;
      const id = decision.getAttribute('data-locale-review-id');
      if (!id) return;
      const actions = decision.parentElement;
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-locale-preview-id', id);
      button.className = 'rounded-lg border border-amber-600/70 bg-amber-950/40 px-2.5 py-2 text-[10px] font-bold text-amber-200 hover:bg-amber-900/50 disabled:opacity-50';
      button.textContent = '▶ Assistir';
      button.title = 'Toca uma amostra desta série para você conferir o idioma.';
      actions.insertBefore(button, decision);
    });
    return true;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-locale-preview-id]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    watchReview(button.getAttribute('data-locale-preview-id'), button);
  }, true);

  const observer = new MutationObserver(() => installButtons());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installButtons();

  window.LuxSecondaryLocalePreview = {
    version: VERSION,
    refresh: installButtons,
    close: closePreview
  };
})();
