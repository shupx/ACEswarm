const { ipcRenderer } = require("electron");

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
