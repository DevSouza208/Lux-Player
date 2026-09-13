(() => {
  'use strict';

  const VERSION = '20260913-access1';
  if (window.__luxUserAccessControlInstalled === VERSION) return;
  window.__luxUserAccessControlInstalled = VERSION;

  const truthy = value => value === true || value === 1 || value === '1' || String(value || '').toLowerCase() === 'true';
  const roleOf = user => String(user?.accountRole || user?.role || 'user').trim().toLowerCase();

  const canUseGames = user => {
    const role = roleOf(user);
    return role === 'admin' || role === 'tester' || truthy(user?.gamesAccess ?? user?.acesso_jogos);
  };

  const canUseBooks = user => {
    const role = roleOf(user);
    return role === 'admin' || role === 'tester' || truthy(user?.booksAccess ?? user?.acesso_livros);
  };

  function normalizeDueDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
    match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59, 999);
    return null;
  }

  function installUserParser() {
    const original = window.parseSupabaseUsers;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';

    const patched = function(rows) {
      const parsed = original.apply(this, arguments);
      return (parsed || []).map((user, index) => {
        const row = rows?.[index] || {};
        const role = String(row.cargo || user.role || 'user').trim().toLowerCase();
        const normalizedRole = ['admin', 'tester'].includes(role) ? role : 'user';
        return {
          ...user,
          role: normalizedRole,
          accountRole: normalizedRole,
          // Tester não depende da assinatura IPTV para entrar no Lux.
          dueDate: normalizedRole === 'tester' ? '' : user.dueDate,
          gamesAccess: normalizedRole === 'tester' || normalizedRole === 'admin' || truthy(row.acesso_jogos),
          booksAccess: normalizedRole === 'tester' || normalizedRole === 'admin' || truthy(row.acesso_livros),
          providerStatus: String(row.provider_status || ''),
          providerExpDate: row.provider_exp_date ?? null,
          providerExpAt: row.provider_exp_at || null,
          providerSyncAt: row.provider_sync_at || null
        };
      });
    };
    patched.__luxAccessPatched = true;
    window.parseSupabaseUsers = patched;
    return true;
  }

  function installExpiryParser() {
    const original = window.isExpired;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';
    const patched = function(dateStr) {
      const parsed = normalizeDueDate(dateStr);
      if (parsed) return Date.now() > parsed.getTime();
      return original.apply(this, arguments);
    };
    patched.__luxAccessPatched = true;
    window.isExpired = patched;
    return true;
  }

  function setVisible(element, visible) {
    if (!element) return;
    element.classList.toggle('hidden', !visible);
    element.toggleAttribute('data-lux-access-hidden', !visible);
  }

  function sectionTriggers(section) {
    const result = new Set();
    ['navGames', 'bNavGames', 'navReading', 'bNavReading'].forEach(id => {
      const el = document.getElementById(id);
      if (el && ((section === 'games' && /Games$/i.test(id)) || (section === 'reading' && /Reading$/i.test(id)))) result.add(el);
    });
    document.querySelectorAll('[onclick]').forEach(el => {
      const handler = el.getAttribute('onclick') || '';
      const pattern = section === 'games' ? /setSection\(["']games["']\)/ : /setSection\(["']reading["']\)/;
      if (pattern.test(handler)) result.add(el);
    });
    return [...result];
  }

  function applyAccessVisibility() {
    let user = null;
    try { user = currentUser; } catch (_) {}
    if (!user) return;
    const games = canUseGames(user);
    const books = canUseBooks(user);
    sectionTriggers('games').forEach(el => setVisible(el, games));
    sectionTriggers('reading').forEach(el => setVisible(el, books));

    try {
      if (currentSection === 'games' && !games) window.setSection?.('home');
      if (currentSection === 'reading' && !books) window.setSection?.('home');
    } catch (_) {}
  }

  function installSectionGuard() {
    const original = window.setSection;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';
    const patched = function(section) {
      let user = null;
      try { user = currentUser; } catch (_) {}
      if (section === 'games' && user && !canUseGames(user)) return original.call(this, 'home');
      if (section === 'reading' && user && !canUseBooks(user)) return original.call(this, 'home');
      return original.apply(this, arguments);
    };
    patched.__luxAccessPatched = true;
    window.setSection = patched;
    return true;
  }

  function installStartAppHook() {
    const original = window.startApp;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';
    const patched = async function() {
      const result = await original.apply(this, arguments);
      applyAccessVisibility();
      return result;
    };
    patched.__luxAccessPatched = true;
    window.startApp = patched;
    return true;
  }

  function accessInputs() {
    return {
      games: document.getElementById('adminNewGamesAccess'),
      books: document.getElementById('adminNewBooksAccess'),
      role: document.getElementById('adminNewRole')
    };
  }

  function syncRoleAccessUi(user = null) {
    const { games, books, role } = accessInputs();
    if (!games || !books || !role) return;
    const selectedRole = String(role.value || 'user').toLowerCase();
    const forced = selectedRole === 'admin' || selectedRole === 'tester';
    if (user && !forced) {
      games.checked = truthy(user.acesso_jogos ?? user.gamesAccess);
      books.checked = truthy(user.acesso_livros ?? user.booksAccess);
    } else if (forced) {
      games.checked = true;
      books.checked = true;
    }
    games.disabled = forced;
    books.disabled = forced;
    const hint = document.getElementById('adminAccessHint');
    if (hint) hint.textContent = selectedRole === 'tester'
      ? 'Testadores entram sem IPTV e têm Jogos + Livros liberados automaticamente.'
      : selectedRole === 'admin'
        ? 'Administradores têm acesso total.'
        : 'Para clientes, libere os extras individualmente.';
  }

  function installAdminFields() {
    const role = document.getElementById('adminNewRole');
    if (!role) return false;
    if (!role.querySelector('option[value="tester"]')) {
      const option = document.createElement('option');
      option.value = 'tester';
      option.textContent = 'Testador';
      role.appendChild(option);
    }

    if (!document.getElementById('adminUserAccessFields')) {
      const box = document.createElement('div');
      box.id = 'adminUserAccessFields';
      box.className = 'rounded-2xl border border-purple-900/50 bg-[#120c1f] p-3';
      box.innerHTML = `
        <p class="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-purple-300">Acessos extras</p>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2 text-xs font-bold text-purple-100"><input id="adminNewGamesAccess" type="checkbox" class="h-4 w-4 accent-purple-600"> Jogos</label>
          <label class="flex items-center gap-2 text-xs font-bold text-purple-100"><input id="adminNewBooksAccess" type="checkbox" class="h-4 w-4 accent-purple-600"> Livros</label>
        </div>
        <p id="adminAccessHint" class="mt-2 text-[10px] text-purple-300/70">Para clientes, libere os extras individualmente.</p>`;
      const anchor = role.closest('label') || role.parentElement;
      anchor?.insertAdjacentElement('afterend', box);
    }

    if (!role.__luxAccessBound) {
      role.__luxAccessBound = true;
      role.addEventListener('change', () => syncRoleAccessUi());
    }
    syncRoleAccessUi();
    return true;
  }

  function installAdminEditHook() {
    const original = window.adminEditUser;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';
    const patched = function(user) {
      const result = original.apply(this, arguments);
      installAdminFields();
      syncRoleAccessUi(user);
      return result;
    };
    patched.__luxAccessPatched = true;
    window.adminEditUser = patched;
    return true;
  }

  function installAdminResetHook() {
    const original = window.resetAdminUserForm;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';
    const patched = function() {
      const result = original.apply(this, arguments);
      installAdminFields();
      const { games, books } = accessInputs();
      if (games) games.checked = false;
      if (books) books.checked = false;
      syncRoleAccessUi();
      return result;
    };
    patched.__luxAccessPatched = true;
    window.resetAdminUserForm = patched;
    return true;
  }

  async function saveAccessFlags(username, role, games, books) {
    if (!username) return;
    let client = null;
    try { client = supabaseClient; } catch (_) {}
    if (!client) return;

    const forced = role === 'tester' || role === 'admin';
    const { error } = await client.from('usuarios').update({
      acesso_jogos: forced ? true : Boolean(games),
      acesso_livros: forced ? true : Boolean(books)
    }).eq('usuario', username);
    if (error) throw error;
  }

  function installAdminSaveHook() {
    const original = window.adminCreateUser;
    if (typeof original !== 'function' || original.__luxAccessPatched) return typeof original === 'function';
    const patched = async function() {
      installAdminFields();
      const username = String(document.getElementById('adminNewUser')?.value || '').trim();
      const role = String(document.getElementById('adminNewRole')?.value || 'user').toLowerCase();
      const games = Boolean(document.getElementById('adminNewGamesAccess')?.checked);
      const books = Boolean(document.getElementById('adminNewBooksAccess')?.checked);

      const result = await original.apply(this, arguments);
      if (username) {
        try {
          await saveAccessFlags(username, role, games, books);
          if (typeof window.loadAdminUsersList === 'function') window.loadAdminUsersList();
        } catch (error) {
          console.warn('[Lux Access] Cliente salvo, mas não foi possível atualizar os acessos extras.', error);
        }
      }
      return result;
    };
    patched.__luxAccessPatched = true;
    window.adminCreateUser = patched;
    return true;
  }

  function installAll() {
    const ready = [
      installUserParser(),
      installExpiryParser(),
      installSectionGuard(),
      installStartAppHook(),
      installAdminEditHook(),
      installAdminResetHook(),
      installAdminSaveHook()
    ].every(Boolean);
    installAdminFields();
    applyAccessVisibility();
    return ready;
  }

  window.LuxUserAccess = {
    canGames: () => { try { return canUseGames(currentUser); } catch (_) { return false; } },
    canBooks: () => { try { return canUseBooks(currentUser); } catch (_) { return false; } },
    refresh: applyAccessVisibility,
    version: VERSION
  };

  let attempts = 0;
  if (!installAll()) {
    const timer = setInterval(() => {
      attempts += 1;
      if (installAll() || attempts >= 200) clearInterval(timer);
    }, 50);
  }

  const observer = new MutationObserver(() => {
    installAdminFields();
    applyAccessVisibility();
  });
  if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
})();
