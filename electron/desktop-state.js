// Shared by the renderer and state tests; bounds are in desktop pixels.
(function (root) {
  function appKey(rawUrl) {
    try { const url = new URL(rawUrl); url.hash = ""; return url.toString(); }
    catch { return String(rawUrl || ""); }
  }
  function workArea(viewport, collapsed = false, maximized = false) {
    const dockWidth = collapsed ? 24 : 64;
    const x = dockWidth + (maximized ? 0 : 8);
    const y = maximized ? 0 : 48;
    return { x, y, width: Math.max(1, viewport.width - x - (maximized ? 0 : 8)), height: Math.max(1, viewport.height - y - (maximized ? 0 : 8)) };
  }
  function windowBounds(raw = {}, viewport = { width: 1280, height: 820 }, index = 0, collapsed = false) {
    raw = raw && typeof raw === "object" ? raw : {};
    const area = workArea(viewport, collapsed);
    const availableWidth = area.width;
    const availableHeight = area.height;
    const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
    const width = Math.max(Math.min(240, availableWidth), Math.min(availableWidth, finite(raw.width, Math.min(980, availableWidth - 110))));
    const height = Math.max(Math.min(220, availableHeight), Math.min(availableHeight, finite(raw.height, availableHeight - 30)));
    return {
      width, height,
      x: Math.max(area.x, Math.min(area.x + area.width - width, finite(raw.x, 130 + (index % 5) * 24))),
      y: Math.max(area.y, Math.min(area.y + area.height - height, finite(raw.y, 66 + (index % 5) * 24))),
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
  const api = { appKey, windowBounds, workArea, remapUrl };
  if (typeof module !== "undefined") module.exports = api;
  if (root) root.desktopState = api;
})(typeof window === "undefined" ? null : window);
