(() => {
  const APP_VERSION = '1.6.3';
  const FRIENDLY_UI_VERSION = '20260912-v163-friendly-ui-2';

  const replacements = [
    [/Verificando dados no Supabase\.\.\./gi, 'Entrando na sua conta...'],
    [/Não foi possível conectar ao Supabase\. Tente novamente\./gi, 'Não foi possível entrar agora. Verifique sua conexão e tente novamente.'],
    [/Erro ao carregar do Supabase\./gi, 'Não foi possível carregar os clientes.'],
    [/Erro de conexão com Supabase\./gi, 'Não foi possível carregar os clientes. Tente novamente.'],
    [/Consultando status públicos\.\.\./gi, 'Atualizando informações...'],
    [/Carregando os status públicos\.\.\./gi, 'Preparando informações...'],
    [/Baixando categorias e canais\.\.\./gi, 'Preparando seus canais...'],
    [/Baixando catálogo e categorias\.\.\./gi, 'Organizando seu catálogo...'],
    [/Baixando catálogo HTTPS sincronizado\.\.\./gi, 'Preparando seu catálogo...'],
    [/Buscando temporadas\.\.\./gi, 'Preparando temporadas...'],
    [/Carregando sinopse\.\.\./gi, 'Preparando detalhes...'],
    [/Sincronizando temporadas e episódios\.\.\./gi, 'Carregando episódios...'],
    [/Sincronizando sua M3U \+ catálogo PHP\. Isso pode levar alguns segundos\.\.\./gi, 'Atualizando seu catálogo. Isso pode levar alguns instantes...'],
    [/Conversão concluída\. Recarregando o catálogo HTTPS\.\.\./gi, 'Catálogo atualizado. Preparando os novos conteúdos...'],
    [/Catálogo Xtream HTTPS sincronizado/gi, 'Catálogo atualizado'],
    [/Lista M3U HTTPS sincronizada/gi, 'Catálogo atualizado'],
    [/Arquivo M3U no Supabase/gi, 'Lista salva'],
    [/Lista M3U original \(fallback HTTP\)/gi, 'Lista principal'],
    [/Lista M3U original \(Electron\)/gi, 'Lista principal'],
    [/Este cliente não possui URL M3U HTTP\/HTTPS para sincronizar/gi, 'Este cliente ainda não possui uma lista configurada para atualização'],
    [/Sincronizar catálogo IPTV de ([^•]+)/gi, 'Atualizar catálogo de $1'],
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

  const originalAlert = window.alert?.bind(window);
  if (originalAlert) {
    window.alert = message => originalAlert(friendlyText(message));
  }

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
