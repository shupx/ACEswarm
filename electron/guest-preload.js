const { ipcRenderer, contextBridge } = require("electron");

function syncAppearance(value) {
  try {
    if (!value) return;
    contextBridge.executeInMainWorld({
      func: (language, theme) => {
        // Keep Electron guest media queries consistent with the host's chosen theme.
        const key = Symbol.for('aceswarm.browser-appearance');
        let state = window[key];
        if (!state) {
          const original = window.matchMedia.bind(window);
          state = { theme, queries: new Map() };
          Object.defineProperty(window, key, { value: state });
          window.matchMedia = query => {
            const mode = String(query).match(/^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i)?.[1]?.toLowerCase();
            if (!mode) return original(query);
            if (state.queries.has(query)) return state.queries.get(query).proxy;
            const events = new EventTarget();
            const item = { mode, events, onchange: null };
            item.proxy = new Proxy(original(query), {
              get(target, property) {
                if (property === 'matches') return state.theme === mode;
                if (property === 'onchange') return item.onchange;
                if (property === 'addListener') return callback => events.addEventListener('change', callback);
                if (property === 'removeListener') return callback => events.removeEventListener('change', callback);
                if (['addEventListener', 'removeEventListener', 'dispatchEvent'].includes(property)) return events[property].bind(events);
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
              set(target, property, value) {
                if (property === 'onchange') { item.onchange = value; return true; }
                return Reflect.set(target, property, value, target);
              },
            });
            state.queries.set(query, item);
            return item.proxy;
          };
        }
        const previousTheme = state.theme;
        state.theme = theme;
        if (previousTheme !== theme) {
          for (const [media, item] of state.queries) {
            const event = new MediaQueryListEvent('change', { media, matches: theme === item.mode });
            item.events.dispatchEvent(event);
            if (typeof item.onchange === 'function') item.onchange.call(item.proxy, event);
          }
        }
        Object.defineProperty(navigator, 'language', { configurable: true, get: () => language });
        Object.defineProperty(navigator, 'languages', { configurable: true, get: () => Object.freeze([language]) });
        window.dispatchEvent(new Event('languagechange'));
      },
      args: [value.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en-US', value.resolvedTheme === 'dark' ? 'dark' : 'light'],
    });
  } catch (error) { console.warn('ACEswarm appearance:', error.message); }
}
try { syncAppearance(ipcRenderer.sendSync('aivuda-shell:get-appearance')); } catch (_) {}
ipcRenderer.on('aivuda-shell:appearance', (_event, value) => syncAppearance(value));

// Synchronous startup keeps the default available before the page's scripts run.
try {
  const storeUrl = ipcRenderer.sendSync('aivuda-shell:get-default-appstore-url');
  if (storeUrl) {
    const key = 'aivuda_ui_appstore_base_url';
    const marker = 'aceswarm_default_appstore_base_url';
    const current = (localStorage.getItem(key) || '').trim().replace(/\/+$/, '');
    const previous = localStorage.getItem(marker);
    if (!current || current === previous) {
      localStorage.setItem(key, storeUrl);
      localStorage.setItem(marker, storeUrl);
    }
  }
} catch (error) {
  console.warn('ACEswarm AppStore default:', error.message);
}

// Guest input does not bubble through the host window's DOM.
function notifyWindowFocus() {
  ipcRenderer.sendToHost("aivuda-shell:activate-window");
}
window.addEventListener("pointerdown", notifyWindowFocus, true);
window.addEventListener("focus", notifyWindowFocus);

function normalizeUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }

  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed, window.location.href).toString();
  } catch (_error) {
    return null;
  }
}

function openInShellTab(rawUrl) {
  const normalized = normalizeUrl(rawUrl);
  if (!normalized) {
    return;
  }

  ipcRenderer.sendToHost("aivuda-shell:open-url-in-new-tab", normalized);
}

window.addEventListener(
  "click",
  (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (!(node instanceof HTMLAnchorElement)) {
        continue;
      }

      if (node.target !== "_blank") {
        return;
      }

      const href = node.href || node.getAttribute("href");
      if (!href) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openInShellTab(href);
      return;
    }
  },
  true,
);

const originalWindowOpen = window.open.bind(window);
window.open = function patchedWindowOpen(url, target, features) {
  if (target === "_blank" || target === "" || target == null) {
    openInShellTab(url);
    return null;
  }

  return originalWindowOpen(url, target, features);
};

window.addEventListener("aivuda-shell:set-performance-overlay-visible", (event) => {
  const isVisible = event?.detail?.visible;
  if (typeof isVisible !== "boolean") {
    return;
  }

  ipcRenderer.sendToHost("aivuda-shell:set-performance-overlay-visible", isVisible);
});
