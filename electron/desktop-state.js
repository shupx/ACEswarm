// Shared by the renderer and state tests; bounds are in desktop pixels.
(function (root) {
  function appKey(rawUrl) {
    try { const url = new URL(rawUrl); url.hash = ""; return url.toString(); }
    catch { return String(rawUrl || ""); }
  }
  function windowBounds(raw = {}, viewport = { width: 1280, height: 820 }, index = 0) {
    raw = raw && typeof raw === "object" ? raw : {};
    const availableWidth = Math.max(240, viewport.width - 16);
    const availableHeight = Math.max(180, viewport.height - 144);
    const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
    const width = Math.max(Math.min(340, availableWidth), Math.min(availableWidth, finite(raw.width, Math.min(980, availableWidth - 110))));
    const height = Math.max(Math.min(220, availableHeight), Math.min(availableHeight, finite(raw.height, availableHeight - 30)));
    return {
      width, height,
      x: Math.max(8, Math.min(viewport.width - width - 8, finite(raw.x, 130 + (index % 5) * 24))),
      y: Math.max(48, Math.min(viewport.height - height - 88, finite(raw.y, 66 + (index % 5) * 24))),
    };
  }
  function remapUrl(rawUrl, previous = {}, current = {}) {
    try {
      const url = new URL(rawUrl);
      for (const name of ["os", "store", "gateway"]) {
        if (previous[name] && current[name] && url.origin === new URL(previous[name]).origin) {
          return new URL(url.pathname + url.search + url.hash, current[name]).toString();
        }
      }
    } catch {}
    return rawUrl;
  }
  const api = { appKey, windowBounds, remapUrl };
  if (typeof module !== "undefined") module.exports = api;
  if (root) root.desktopState = api;
})(typeof window === "undefined" ? null : window);
