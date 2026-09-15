(() => {
  'use strict';

  const VERSION = '20260914-secondary-locale-preview2';
  if (window.__luxSecondaryLocalePreviewInstalled === VERSION) return;
  window.__luxSecondaryLocalePreviewInstalled = VERSION;

  const FUNCTION_NAME = 'content-locale-reviews';
  let activeHls = null;
  let pending = false;
  let activeSamples = [];
  let activeIndex = -1;
  let switching = false;

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  function authBody(extra = {}) {
    const user = safeCurrentUser();
    return { username: String(user?.user || '').trim(), password: String(user?.pass || ''), ...extra };
  }

  async function invoke(action, extra = {}) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) throw new Error('Serviço de nuvem indisponível.');
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, { body: authBody({ action, ...extra }) });
    if (error) throw new Error(data?.error || error.message || 'Não foi possível carregar a amostra.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function clearMedia(video) {
    try { activeHls?.destroy?.(); } catch (_) {}
    activeHls = null;
    try {
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    } catch (_) {}
  }

  function closePreview() {
    const modal = document.getElementById('luxLocalePreviewModal');
    clearMedia(modal?.querySelector('video'));
    activeSamples = [];
    activeIndex = -1;
    switching = false;
    modal?.remove();
  }

  function updateHeader(sample, index) {
    const title = document.getElementById('luxLocalePreviewTitle');
    const subtitle = document.getElementById('luxLocalePreviewSubtitle');
    const counter = document.getElementById('luxLocalePreviewCounter');
    if (title) title.textContent = sample?.title || 'Amostra';
    const seasonEpisode = sample?.season && sample?.episode ? `T${Number(sample.season)}E${Number(sample.episode)}` : '';
    if (subtitle) subtitle.textContent = `${seasonEpisode ? `${seasonEpisode} · ` : ''}${sample?.episode_title || sample?.original_title || 'Amostra para identificar o idioma'}`;
    if (counter) counter.textContent = activeSamples.length > 1 ? `Amostra ${index + 1}/${activeSamples.length}` : 'Amostra';
  }

  function setMessage(text, kind = 'normal') {
    const message = document.getElementById('luxLocalePreviewMessage');
    if (!message) return;
    if (!text) {
      message.textContent = '';
      message.classList.add('hidden');
      return;
    }
    message.textContent = text;
    message.className = `pointer-events-none absolute bottom-3 left-3 right-3 rounded-xl bg-black/80 px-3 py-2 text-center text-xs ${kind === 'error' ? 'text-rose-200' : 'text-amber-200'}`;
  }

  function playSample(index, reason = '') {
    const modal = document.getElementById('luxLocalePreviewModal');
    const video = modal?.querySelector('#luxLocalePreviewVideo');
    if (!video || index < 0 || index >= activeSamples.length) return false;

    switching = true;
    clearMedia(video);
    activeIndex = index;
    const sample = activeSamples[index];
    const url = String(sample?.url || '').trim();
    updateHeader(sample, index);
    const next = document.getElementById('luxLocalePreviewNext');
    if (next) next.disabled = activeSamples.length <= 1;

    if (reason) setMessage(reason);
    else if (location.protocol === 'https:' && /^http:\/\//i.test(url)) setMessage('Esta amostra é HTTP e o navegador pode bloqueá-la. Se falhar, o Lux tentará outra automaticamente.');
    else setMessage('');

    const failed = () => {
      if (switching) return;
      const nextIndex = activeIndex + 1;
      if (nextIndex < activeSamples.length) {
        setTimeout(() => playSample(nextIndex, `A amostra ${activeIndex + 1} falhou. Tentando outra fonte/episódio...`), 120);
      } else {
        setMessage(`Nenhuma das ${activeSamples.length} amostras disponíveis conseguiu reproduzir neste navegador.`, 'error');
      }
    };

    video.onerror = failed;
    switching = false;

    if (/\.m3u8?(?:$|[?#])/i.test(url) && window.Hls?.isSupported?.()) {
      activeHls = new window.Hls();
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) failed();
      });
    } else {
      video.src = url;
    }

    video.play().catch(() => {});
    return true;
  }

  function openPreview(preview) {
    closePreview();
    const incoming = Array.isArray(preview?.samples) && preview.samples.length ? preview.samples : [preview];
    activeSamples = incoming.filter(sample => /^https?:\/\//i.test(String(sample?.url || '').trim()));
    if (!activeSamples.length) throw new Error('A revisão não possui uma URL reproduzível.');

    const overlay = document.createElement('div');
    overlay.id = 'luxLocalePreviewModal';
    overlay.className = 'fixed inset-0 z-[180] flex items-center justify-center bg-black/95 p-3 backdrop-blur-md';
    overlay.innerHTML = `
      <section class="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-sky-800/60 bg-[#09060e] shadow-2xl">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-purple-950 bg-[#120c1f] px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p id="luxLocalePreviewTitle" class="truncate text-sm font-black text-white">Amostra</p>
              <span id="luxLocalePreviewCounter" class="shrink-0 rounded-md bg-purple-900/60 px-2 py-0.5 text-[9px] font-bold text-purple-200">Amostra</span>
            </div>
            <p id="luxLocalePreviewSubtitle" class="mt-0.5 truncate text-[11px] text-purple-300"></p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button id="luxLocalePreviewNext" type="button" class="rounded-xl border border-amber-700/70 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-900/40 disabled:opacity-40">Próxima amostra</button>
            <button id="luxLocalePreviewClose" type="button" class="rounded-xl border border-purple-800 px-3 py-2 text-xs font-bold text-purple-200 hover:bg-purple-900/50">Voltar à revisão</button>
          </div>
        </header>
        <div class="relative flex min-h-0 flex-1 items-center justify-center bg-black">
          <video id="luxLocalePreviewVideo" controls autoplay playsinline class="h-full w-full bg-black object-contain"></video>
          <div id="luxLocalePreviewMessage" class="pointer-events-none absolute bottom-3 left-3 right-3 hidden rounded-xl bg-black/80 px-3 py-2 text-center text-xs text-amber-200"></div>
        </div>
        <footer class="shrink-0 border-t border-purple-950 bg-[#120c1f] px-4 py-2 text-[10px] text-purple-400">
          Reprodução temporária só para conferir áudio/legenda. O Lux tenta até ${activeSamples.length} amostra(s) e não salva progresso.
        </footer>
      </section>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#luxLocalePreviewClose')?.addEventListener('click', closePreview);
    overlay.querySelector('#luxLocalePreviewNext')?.addEventListener('click', () => {
      const nextIndex = activeSamples.length ? (activeIndex + 1) % activeSamples.length : 0;
      playSample(nextIndex, 'Trocando para outra amostra...');
    });
    overlay.addEventListener('click', event => { if (event.target === overlay) closePreview(); });
    const escapeHandler = event => {
      if (event.key === 'Escape' && document.getElementById('luxLocalePreviewModal')) {
        closePreview();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);

    playSample(0);
  }

  async function watchReview(id, button) {
    if (pending) return;
    pending = true;
    const oldText = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Carregando...'; }
    try {
      const data = await invoke('preview', { id: Number(id) });
      if (!data?.preview?.url && !data?.preview?.samples?.length) throw new Error('Nenhuma amostra reproduzível encontrada.');
      openPreview(data.preview);
    } catch (error) {
      alert(error?.message || 'Não foi possível abrir a amostra.');
    } finally {
      pending = false;
      if (button) { button.disabled = false; button.textContent = oldText || 'Assistir'; }
    }
  }

  function installButtons() {
    const root = document.getElementById('secondaryLocaleReviewsList');
    if (!root) return false;
    root.querySelectorAll('article').forEach(card => {
      if (card.querySelector('[data-locale-preview-id]')) return;
      const decision = card.querySelector('[data-locale-review-id]');
      if (!decision) return;
      const id = decision.getAttribute('data-locale-review-id');
      const actions = decision.parentElement;
      if (!id || !actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-locale-preview-id', id);
      button.className = 'rounded-lg border border-amber-600/70 bg-amber-950/40 px-2.5 py-2 text-[10px] font-bold text-amber-200 hover:bg-amber-900/50 disabled:opacity-50';
      button.textContent = '▶ Assistir';
      button.title = 'Toca amostras desta série para você conferir o idioma.';
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

  window.LuxSecondaryLocalePreview = { version: VERSION, refresh: installButtons, close: closePreview };
})();
