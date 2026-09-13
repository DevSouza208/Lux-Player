(() => {
  'use strict';

  if (window.__luxGameDuplicateConsoleFixInstalled) return;
  window.__luxGameDuplicateConsoleFixInstalled = '20260912-console-duplicate1';

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const normalizeColumns = value => String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .split(',')
    .filter(Boolean)
    .sort()
    .join(',');

  const EDIT_DUPLICATE_COLUMNS = normalizeColumns('id,title,normalized_title');
  const IMPORT_DUPLICATE_COLUMNS = normalizeColumns('title,normalized_title,source_file_name,rom_sha256');

  const currentConsole = () => normalize(document.getElementById('gameAdminConsole')?.value);

  const maskOtherConsoleDuplicates = (result, mode) => {
    if (!result || !Array.isArray(result.data)) return result;
    const selectedConsole = currentConsole();
    if (!selectedConsole) return result;

    const data = result.data.map(game => {
      if (normalize(game?.console) === selectedConsole) return game;

      // Keep hashes visible so the exact same ROM file remains globally blocked,
      // while title/file-name duplication is scoped to the selected console.
      if (mode === 'import') {
        return {
          ...game,
          title: '',
          normalized_title: '',
          source_file_name: ''
        };
      }

      return {
        ...game,
        title: '',
        normalized_title: ''
      };
    });

    return { ...result, data };
  };

  const patchBuilder = (builder, mode) => {
    if (!builder || typeof builder.then !== 'function' || builder.__luxConsoleDuplicatePatched) return builder;

    const originalThen = builder.then.bind(builder);
    Object.defineProperty(builder, '__luxConsoleDuplicatePatched', {
      value: true,
      configurable: true
    });

    builder.then = (onFulfilled, onRejected) => originalThen(
      result => {
        const masked = maskOtherConsoleDuplicates(result, mode);
        return typeof onFulfilled === 'function' ? onFulfilled(masked) : masked;
      },
      onRejected
    );

    return builder;
  };

  const install = () => {
    let client;
    try { client = supabaseClient; } catch (_) { return false; }
    if (!client?.from) return false;
    if (client.__luxConsoleDuplicateFromPatched) return true;

    const originalFrom = client.from.bind(client);

    client.from = function (table) {
      const query = originalFrom(table);
      if (String(table) !== 'games' || !query?.select) return query;

      const originalSelect = query.select.bind(query);
      query.select = function (columns, options) {
        const normalized = normalizeColumns(columns);
        const mode = normalized === EDIT_DUPLICATE_COLUMNS
          ? 'edit'
          : normalized === IMPORT_DUPLICATE_COLUMNS
            ? 'import'
            : '';

        if (!mode) return originalSelect(columns, options);

        const requested = String(columns || '');
        const withConsole = /(^|,)\s*console\s*(,|$)/i.test(requested)
          ? requested
          : `${requested},console`;
        return patchBuilder(originalSelect(withConsole, options), mode);
      };

      return query;
    };

    Object.defineProperty(client, '__luxConsoleDuplicateFromPatched', {
      value: true,
      configurable: true
    });
    return true;
  };

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 240) clearInterval(timer);
    }, 50);
  }
})();
