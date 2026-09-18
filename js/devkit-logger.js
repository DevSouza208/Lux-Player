(() => {
  'use strict';

  const VERSION = '1.3.3';
  const CHANNEL_NAME = 'lux-player-devkit-v1';
  const STORAGE_KEY = 'lux_devkit_events_v1';
  const SIGNAL_KEY = 'lux_devkit_signal_v1';
  const MAX_EVENTS = 500;

  if (window.__luxDevkitLoggerInstalled === VERSION) return;
  window.__luxDevkitLoggerInstalled = VERSION;

  let sequence = 0;
  let channel = null;
  const clients = new Set();

  try {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = event => {
        const data = event.data || {};
        if (data.type === 'request-snapshot') {
          channel.postMessage({ type: 'snapshot', events: snapshot() });
        } else if (data.type === 'clear') {
          clear(false);
        }
      };
    }
  } catch (_) {
    channel = null;
  }

  function readStored() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
    } catch (_) {
      return [];
    }
  }

  function writeStored(events) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
    } catch (_) {}
  }

  function snapshot() {
    return readStored();
  }

  function safeValue(value, depth = 0) {
    if (depth > 3) return '[depth-limit]';
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      Object.entries(value).slice(0, 30).forEach(([key, item]) => {
        if (/pass|password|credential|token|secret|key/i.test(key)) out[key] = '[redacted]';
        else out[key] = safeValue(item, depth + 1);
      });
      return out;
    }
    return String(value);
  }

  function normalizeStatus(status) {
    const value = String(status || 'info').toLowerCase();
    return ['info', 'running', 'success', 'warning', 'error'].includes(value) ? value : 'info';
  }

  function publish(event) {
    const events = readStored();
    events.push(event);
    writeStored(events);

    try {
      localStorage.setItem(SIGNAL_KEY, JSON.stringify(event));
    } catch (_) {}

    try {
      channel?.postMessage({ type: 'event', event });
    } catch (_) {}

    for (const client of [...clients]) {
      try {
        if (client?.closed) {
          clients.delete(client);
          continue;
        }
        client.postMessage({ type: 'LUX_DEVKIT_EVENT', event }, '*');
      } catch (_) {
        clients.delete(client);
      }
    }
  }

  function emit(input = {}) {
    const now = Date.now();
    const event = {
      id: `${now}-${++sequence}-${Math.random().toString(36).slice(2, 7)}`,
      ts: now,
      time: new Date(now).toLocaleTimeString('pt-BR', { hour12: false }),
      category: String(input.category || 'APP').toUpperCase().slice(0, 24),
      status: normalizeStatus(input.status),
      label: String(input.label || 'evento').slice(0, 120),
      message: String(input.message || '').slice(0, 800),
      durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Math.round(Number(input.durationMs))) : null,
      data: input.data == null ? null : safeValue(input.data)
    };
    publish(event);
    return event;
  }

  function clear(broadcast = true) {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SIGNAL_KEY);
    } catch (_) {}
    if (broadcast) {
      try { channel?.postMessage({ type: 'clear' }); } catch (_) {}
      for (const client of [...clients]) {
        try { client.postMessage({ type: 'LUX_DEVKIT_CLEAR' }, '*'); } catch (_) {}
      }
    }
  }

  function open() {
    const url = new URL('devkit.html', window.location.href);
    const popup = window.open(url.href, 'lux-devkit');
    if (popup) clients.add(popup);
    return popup;
  }

  window.addEventListener('message', event => {
    const data = event.data || {};
    if (data.type === 'LUX_DEVKIT_READY' && event.source) {
      clients.add(event.source);
      try {
        event.source.postMessage({ type: 'LUX_DEVKIT_SNAPSHOT', events: snapshot() }, '*');
      } catch (_) {}
    } else if (data.type === 'LUX_DEVKIT_CLEAR') {
      clear();
    }
  });

  window.addEventListener('error', event => {
    emit({
      category: 'RUNTIME',
      status: 'error',
      label: 'window.error',
      message: event.message || 'Erro de execução',
      data: { file: event.filename || '', line: event.lineno || 0, column: event.colno || 0 }
    });
  });

  window.addEventListener('unhandledrejection', event => {
    emit({
      category: 'RUNTIME',
      status: 'error',
      label: 'unhandledrejection',
      message: event.reason?.message || String(event.reason || 'Promise rejeitada sem tratamento'),
      data: event.reason instanceof Error ? event.reason : null
    });
  });

  window.LuxDevkit = {
    version: VERSION,
    emit,
    snapshot,
    clear,
    open,
    info(category, label, message = '', data = null) {
      return emit({ category, status: 'info', label, message, data });
    },
    running(category, label, message = '', data = null) {
      return emit({ category, status: 'running', label, message, data });
    },
    success(category, label, message = '', durationMs = null, data = null) {
      return emit({ category, status: 'success', label, message, durationMs, data });
    },
    warn(category, label, message = '', data = null) {
      return emit({ category, status: 'warning', label, message, data });
    },
    error(category, label, message = '', data = null) {
      return emit({ category, status: 'error', label, message, data });
    }
  };

  emit({
    category: 'DEVKIT',
    status: 'info',
    label: 'logger',
    message: `Logger ${VERSION} ativo`
  });
})();
