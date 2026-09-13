(() => {
  const APP_VERSION = '1.6.3';
  const FRIENDLY_UI_VERSION = '20260912-v163-friendly-ui-15';

  const replacements = [
    [/Verificando dados no Supabase\.\.\./gi, 'Entrando na sua conta...'],
    [/Não foi possível conectar ao Supabase\. Tente novamente\./gi, 'Não foi possível entrar agora. Verifique sua conexão e tente novamente.'],
    [/Erro ao carregar do Supabase\./gi, 'Não foi possível carregar os clientes.'],
    [/Erro de conexão com Supabase\./gi, 'Não foi possível carregar os clientes. Tente novamente.'],
    [/Consultando status públicos\.\.\./gi, 'Atualizando informações...'],
    [/Carregando os status públicos\.\.\./gi, 'Preparando informações...'],
    [/Configurando sua experiência\.\.\. O primeiro acesso pode demorar cerca de 1 min\./gi, 'Preparando tudo para você... No primeiro acesso pode levar um pouquinho mais.'],
    [/Carregando seus perfis\.\.\./gi, 'Preparando seus perfis...'],
    [/Carregando perfis\.\.\./gi, 'Preparando seus perfis...'],
    [/Carregando catálogo de jogos/gi, 'Preparando seus jogos'],
    [/Buscando dados do jogo\.\.\./gi, 'Procurando informações do jogo...'],
    [/Carregando guia de programação\.\.\./gi, 'Preparando a programação...'],
    [/Baixando categorias e canais\.\.\./gi, 'Preparando seus canais...'],
    [/Baixando catálogo e categorias\.\.\./gi, 'Organizando seu catálogo...'],
    [/Baixando catálogo HTTPS sincronizado\.\.\./gi, 'Preparando seu catálogo...'],
    [/Buscando temporadas\.\.\./gi, 'Preparando temporadas...'],
    [/Carregando sinopse\.\.\./gi, 'Preparando detalhes...'],
    [/Sincronizando temporadas e episódios\.\.\./gi, 'Carregando episódios...'],
    [/Sincronizando sua M3U \+ catálogo PHP\. Isso pode levar alguns segundos\.\.\./gi, 'Atualizando seu catálogo. Isso pode levar alguns instantes...'],
    [/Conversão concluída\. Recarregando o catálogo HTTPS\.\.\./gi, 'Catálogo atualizado. Preparando os novos conteúdos...'],
    [/Catálogo IPTV sincronizado e aplicado/gi, 'Catálogo atualizado com sucesso'],
    [/Sincronizando\.\.\./gi, 'Atualizando...'],
    [/Sincronizando ([^\n]+?)\.\.\./gi, 'Atualizando $1...'],
    [/Sincronização parcial de /gi, 'Atualização parcial de '],
    [/sincronizado com sucesso/gi, 'atualizado com sucesso'],
    [/Catálogo Xtream HTTPS sincronizado/gi, 'Catálogo atualizado'],
    [/Lista M3U HTTPS sincronizada/gi, 'Catálogo atualizado'],
    [/Arquivo M3U no Supabase/gi, 'Lista salva'],
    [/Lista M3U original \(fallback HTTP\)/gi, 'Lista principal'],
    [/Lista M3U original \(Electron\)/gi, 'Lista principal'],
    [/Este cliente não possui URL M3U HTTP\/HTTPS para sincronizar/gi, 'Este cliente ainda não possui uma lista configurada para atualização'],
    [/Sincronizar catálogo IPTV de ([^•]+)/gi, 'Atualizar catálogo de $1'],
    [/Sincronizar catálogo IPTV/gi, 'Atualizar catálogo'],
    [/fornecedor respondeu HTTP \d+/gi, 'O serviço de conteúdo não respondeu agora. Tente novamente.'],
    [/A URL não contém credenciais Xtream reconhecíveis/gi, 'A lista deste cliente não pôde ser preparada automaticamente.'],
    [/Worker respondeu HTTP \d+/gi, 'O serviço de atualização não respondeu como esperado'],
    [/Provided readable stream must have a known length[^\n]*/gi, 'Não foi possível concluir a atualização do catálogo. Tente novamente.']
  ];

  function friendlyText(value) {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(/versão\s+\d+(?:\.\d+){1,3}/gi, `versão ${APP_VERSION}`);
    for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
    return text;
  }

  function updateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const current = node.nodeValue || '';
    const next = friendlyText(current);
    if (next !== current) node.nodeValue = next;
  }

  function updateElement(element) {
    if (!(element instanceof Element)) return;
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      if (!element.hasAttribute(attr)) continue;
      const current = element.getAttribute(attr) || '';
      const next = friendlyText(current);
      if (next !== current) element.setAttribute(attr, next);
    }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) updateTextNode(child);
    }
    element.querySelectorAll('*').forEach(child => {
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        if (!child.hasAttribute(attr)) continue;
        const current = child.getAttribute(attr) || '';
        const next = friendlyText(current);
        if (next !== current) child.setAttribute(attr, next);
      }
      for (const textNode of child.childNodes) {
        if (textNode.nodeType === Node.TEXT_NODE) updateTextNode(textNode);
      }
    });
  }

  function applyVersionEverywhere() {
    const auth = document.getElementById('authScreen');
    if (auth) {
      const badge = [...auth.querySelectorAll('div')].find(el => /^versão\s+[\d.]+$/i.test((el.textContent || '').trim()));
      if (badge) badge.textContent = `versão ${APP_VERSION}`;
    }
    updateElement(document.body);
  }

  const mobileMedia = () => window.matchMedia?.('(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)')?.matches;

  const loadRuntimeStabilityFix = () => {
    if (document.querySelector('script[data-lux-runtime-stability]')) return;
    const script = document.createElement('script');
    script.src = 'js/runtime-stability-fix.js?v=20260912-stability2';
    script.async = true;
    script.dataset.luxRuntimeStability = '1';
    document.head.appendChild(script);
  };

  const loadGameDuplicateConsoleFix = () => {
    if (document.querySelector('script[data-lux-game-duplicate-console]')) return;
    const script = document.createElement('script');
    script.src = 'js/game-duplicate-console-fix.js?v=20260912-console-duplicate1';
    script.async = true;
    script.dataset.luxGameDuplicateConsole = '1';
    document.head.appendChild(script);
  };

  const loadSports = () => {
    if (document.querySelector('script[data-lux-sports]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports.js?v=20260912-guide5';
    script.async = true;
    script.dataset.luxSports = '1';
    document.head.appendChild(script);
  };

  const loadSportsHomeGuard = () => {
    if (document.querySelector('script[data-lux-sports-home-guard]')) return;
    const script = document.createElement('script');
    script.src = 'js/sports-home-guard.js?v=20260912-guide5';
    script.async = true;
    script.dataset.luxSportsHomeGuard = '1';
    document.head.appendChild(script);
  };

  const loadMobileControlOpacity = () => {
    if (!mobileMedia() || document.querySelector('script[data-lux-mobile-control-opacity]')) return;
    const script = document.createElement('script');
    script.src = 'js/mobile-control-opacity.js?v=20260912-opacity1';
    script.async = true;
    script.dataset.luxMobileControlOpacity = '1';
    document.head.appendChild(script);
  };

  const loadMobileCustomControls = () => {
    if (!mobileMedia() || document.querySelector('script[data-lux-mobile-custom-controls]')) return;
    const script = document.createElement('script');
    script.src = 'js/mobile-custom-controls.js?v=20260912-custom1';
    script.async = true;
    script.dataset.luxMobileCustomControls = '1';
    document.head.appendChild(script);
  };

  const originalAlert = window.alert?.bind(window);
  if (originalAlert) window.alert = message => originalAlert(friendlyText(message));

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        updateTextNode(mutation.target);
        continue;
      }
      if (mutation.type === 'attributes') {
        updateElement(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) updateTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) updateElement(node);
      });
    }
  });

  const start = () => {
    applyVersionEverywhere();
    loadRuntimeStabilityFix();
    loadGameDuplicateConsoleFix();
    loadSports();
    loadSportsHomeGuard();
    loadMobileControlOpacity();
    loadMobileCustomControls();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'aria-label', 'placeholder']
    });
    window.__luxFriendlyUiVersion = FRIENDLY_UI_VERSION;
    window.__luxAppVersion = APP_VERSION;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();