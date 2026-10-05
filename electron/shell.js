const shellEl = document.getElementById("shell");
const stackEl = document.getElementById("webview-stack");
const addressInput = document.getElementById("address-input");
const statusText = document.getElementById("status-text");
const collapseChromeButton = document.getElementById("collapse-chrome");
const newTabButton = document.getElementById("new-tab");
const backButton = document.getElementById("back-button");
const forwardButton = document.getElementById("forward-button");
const reloadButton = document.getElementById("reload-button");
const toolsButton = document.getElementById("tools-button");
const toolsMenu = document.getElementById("tools-menu");

let defaultUrl = "http://127.0.0.1:80";
let storeUrl = "";
let serviceOrigins = {};
const dockCollapsed = true;
let desktopVisible = false;
let desktopActiveTabId = null;
let favorites = [];
let activeTabId = null;
let nextTabId = 1;
let performanceOverlayVisible = false;
let screenRecordBarVisible = false;
let screenRecordBarPosition = null;
let screenRecordBarEl = null;
let screenRecordDetailsExpanded = false;
let screenRecordMode = "ffmpeg";
let screenRecordStatus = "idle";
let screenRecordStatusText = "Ready to record";
let screenRecordElapsedMs = 0;
let screenRecordStartedAt = 0;
let screenRecordAccumulatedMs = 0;
let screenRecordPausedAt = 0;
let screenRecordTimer = 0;
let screenRecorder = null;
let screenRecorderStream = null;
let screenRecorderFrameCapture = null;
let screenRecorderChunks = [];
let screenRecorderOutputPath = "";
let screenRecorderOutputDir = "";
let screenRecorderLastSavedPath = "";
let defaultScreenRecordingsDir = "";
let isStoppingScreenRecorder = false;
let screenRecordFinalizePromise = null;
let screenRecordBackend = null;
const zoomStep = 0.1;
const minZoomFactor = 0.3;
const maxZoomFactor = 3;
const tabs = new Map();
const guestPreloadUrl = new URL("guest-preload.js", window.location.href).toString();
const offlineUrl = new URL("offline.html", window.location.href).toString();
let isRestoringShellState = true;
const shellStateAutosaveIntervalMs = 1500;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clampOverlayCoordinate(value, maxValue) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(Math.max(0, maxValue), value));
}

function normalizeRelativeOverlayPosition(rawPosition) {
  if (!rawPosition || typeof rawPosition !== "object") {
    return null;
  }

  if (Number.isFinite(rawPosition.xRatio) && Number.isFinite(rawPosition.yRatio)) {
    return {
      xRatio: Math.max(0, Math.min(1, rawPosition.xRatio)),
      yRatio: Math.max(0, Math.min(1, rawPosition.yRatio)),
    };
  }

  if (Number.isFinite(rawPosition.left) && Number.isFinite(rawPosition.top)) {
    return {
      left: rawPosition.left,
      top: rawPosition.top,
    };
  }

  return null;
}

function resolveOverlayPosition(position, elementWidth, elementHeight, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  if (!position) {
    return null;
  }

  const maxLeft = Math.max(0, viewportWidth - elementWidth);
  const maxTop = Math.max(0, viewportHeight - elementHeight);

  if (Number.isFinite(position.xRatio) && Number.isFinite(position.yRatio)) {
    return {
      left: clampOverlayCoordinate(position.xRatio * maxLeft, maxLeft),
      top: clampOverlayCoordinate(position.yRatio * maxTop, maxTop),
    };
  }

  if (Number.isFinite(position.left) && Number.isFinite(position.top)) {
    return {
      left: clampOverlayCoordinate(position.left, maxLeft),
      top: clampOverlayCoordinate(position.top, maxTop),
    };
  }

  return null;
}

function createRelativeOverlayPosition(left, top, elementWidth, elementHeight, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const maxLeft = Math.max(0, viewportWidth - elementWidth);
  const maxTop = Math.max(0, viewportHeight - elementHeight);
  const normalizedLeft = clampOverlayCoordinate(left, maxLeft);
  const normalizedTop = clampOverlayCoordinate(top, maxTop);

  return {
    xRatio: maxLeft > 0 ? normalizedLeft / maxLeft : 0,
    yRatio: maxTop > 0 ? normalizedTop / maxTop : 0,
  };
}

function isLegacyAbsoluteOverlayPosition(position) {
  return Boolean(
    position &&
      Number.isFinite(position.left) &&
      Number.isFinite(position.top) &&
      !Number.isFinite(position.xRatio) &&
      !Number.isFinite(position.yRatio),
  );
}

function normalizeSavedShellState(rawState) {
  if (!rawState || typeof rawState !== "object") {
    return null;
  }

  const tabs = Array.isArray(rawState.tabs)
    ? rawState.tabs.filter((tab) => tab && typeof tab.url === "string" && tab.url.trim())
    : [];
  const activeTabId = typeof rawState.activeTabId === "string" ? rawState.activeTabId : null;
  const chromeExpanded = rawState.chromeExpanded === true;
  const performanceOverlayVisible = rawState.performanceOverlayVisible === true;
  const screenRecordBarVisible = rawState.screenRecordBarVisible === true;
  const screenRecordMode = ["native", "ffmpeg", "ffmpeg-x11"].includes(rawState.screenRecordMode) ? rawState.screenRecordMode : "ffmpeg";
  const screenRecordBarPosition =
    normalizeRelativeOverlayPosition(rawState.screenRecordBarPosition);
  const favorites = Array.isArray(rawState.favorites)
    ? rawState.favorites.filter((entry) => entry && typeof entry.url === "string" && entry.url.trim()).slice(0, 50)
    : [];

  return {
    tabs,
    activeTabId,
    chromeExpanded,
    performanceOverlayVisible,
    screenRecordBarVisible,
    screenRecordMode,
    screenRecordBarPosition,
    favorites,
  };
}

function buildShellStatePayload() {
  return {
    version: 4,
    activeWindowId,
    windows: [...appWindows.values()].map(owner => ({ id: owner.id, bounds: owner.bounds, maximized: owner.maximized, minimized: owner.minimized, region: owner.region, zIndex: owner.zIndex, activeTabId: owner.layout.activePanel?.id, layout: owner.layout.toJSON() })),
    desktopVisible,
    desktopActiveTabId,
    serviceOrigins,
    dockCollapsed,
    activeTabId,
    chromeExpanded: shellEl.classList.contains("expanded"),
    performanceOverlayVisible,
    screenRecordBarVisible,
    screenRecordMode,
    screenRecordBarPosition,
    favorites,
    tabs: Array.from(tabs.values()).map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      title: tab.title,
      url: getTabUrl(tab),
      appUrl: tab.appUrl,
      favicon: tab.favicon,
      chromeExpanded: tab.chromeExpanded,
      placement: tab.placement,
    })),
  };
}

window.__aivudaBuildShellState = buildShellStatePayload;

function renderFavorites() {
  renderDesktop();
}

function addCurrentFavorite() {
  const tab = getActiveTab();
  const url = tab?.appUrl;
  if (!url || url.startsWith("file:")) return;
  pinApplication({ url, title: tab.title || getSiteNameFromUrl(url), favicon: tab.favicon });
}

function writeShellState() {
  if (isRestoringShellState) {
    return Promise.resolve();
  }

  return window.aivudaShell.saveShellState(buildShellStatePayload()).catch((error) => {
    console.warn("[aivuda-shell] failed to save shell state", error);
  });
}

function finishShellStateRestore() {
  isRestoringShellState = false;
  writeShellState();
}

function setChromeExpanded(isExpanded) {
  const tab = getActiveTab();
  if (tab) tab.chromeExpanded = isExpanded;
  shellEl.classList.toggle("expanded", isExpanded);
  syncWindowToolbar();
  writeShellState();
}

function normalizeUrlInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return defaultUrl;
  }

  try {
    return new URL(trimmed).toString();
  } catch (_error) {
    try {
      return new URL(`http://${trimmed}`).toString();
    } catch (_fallbackError) {
      return defaultUrl;
    }
  }
}

function canonicalizeNavigationUrl(value) {
  const normalized = normalizeUrlInput(value);
  if (!storeUrl) return normalized;
  try {
    const target = new URL(normalized);
    if (target.origin === new URL(storeUrl).origin && (target.pathname === "/store" || target.pathname === "/store/")) {
      target.pathname = "/";
      target.search = "";
      target.hash = "";
      return target.toString();
    }
  } catch (_) {}
  return normalized;
}

function getActiveTab() {
  return activeTabId ? tabs.get(activeTabId) : null;
}

function getTabUrl(tab) {
  if (!tab?.webview) {
    return tab?.url || defaultUrl;
  }

  try {
    const currentUrl = tab.webview.getURL();
    return currentUrl && !currentUrl.startsWith(offlineUrl) ? currentUrl : tab.url;
  } catch (_error) {
    return tab.url;
  }
}

function setStatus(text) {
  statusText.textContent = text;
}

function getSiteNameFromUrl(rawUrl) {
  const normalized = normalizeUrlInput(rawUrl);

  try {
    const parsed = new URL(normalized);
    if (parsed.origin === new URL(defaultUrl).origin && !/^\/[^/]+\/ui(?:\/|$)/.test(parsed.pathname)) {
      return "Console";
    }
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (hostname) {
      return hostname;
    }
  } catch (_error) {}

  return "Console";
}

function isGenericAivudaTitle(title) {
  const normalized = String(title || "").trim().toLowerCase();
  return normalized === "" || normalized === "aivudaos" || normalized === "aivuda os";
}

function resolveTabDisplayTitle(title, rawUrl) {
  if (isGenericAivudaTitle(title)) {
    return getSiteNameFromUrl(rawUrl);
  }

  return String(title || "").trim() || getSiteNameFromUrl(rawUrl);
}

function updateTabTitle(tab, title) {
  const nextTitle = resolveTabDisplayTitle(title, getTabUrl(tab));
  tab.title = nextTitle;
  tab.panel?.api.setTitle(nextTitle);
  renderDesktop();
  writeShellState();
}

function updateTabIcon(tab, faviconUrl) {
  tab.favicon = typeof faviconUrl === "string" ? faviconUrl : "";
  renderDesktop();
  writeShellState();
}

function updateAddressFromActiveTab() {
  const tab = getActiveTab();
  addressInput.value = tab ? getTabUrl(tab) : "";
}

function clampZoomFactor(value) {
  return Math.min(maxZoomFactor, Math.max(minZoomFactor, value));
}

function adjustActiveTabZoom(delta) {
  const tab = getActiveTab();
  if (!tab?.webview) {
    return;
  }

  let currentZoom = 1;
  try {
    currentZoom = Number(tab.webview.getZoomFactor()) || 1;
  } catch (_error) {}

  const nextZoom = clampZoomFactor(Math.round((currentZoom + delta) * 100) / 100);
  tab.webview.setZoomFactor(nextZoom);
  setStatus(`Zoom ${Math.round(nextZoom * 100)}%`);
  updateWindowZoom();
}

function resetActiveTabZoom() {
  const tab = getActiveTab();
  if (!tab?.webview) {
    return;
  }

  tab.webview.setZoomFactor(1);
  setStatus("Zoom 100%");
  updateWindowZoom();
}

function isZoomInShortcut(event) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "+" || event.key === "=" || event.code === "Equal" || event.code === "NumpadAdd")
  );
}

function isZoomOutShortcut(event) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract")
  );
}

function isResetZoomShortcut(event) {
  return event.ctrlKey && !event.altKey && !event.metaKey && (event.key === "0" || event.code === "Digit0" || event.code === "Numpad0");
}

function updateNavigationState() {
  const tab = getActiveTab();
  try {
    backButton.disabled = !tab || !tab.webview.canGoBack();
    forwardButton.disabled = !tab || !tab.webview.canGoForward();
  } catch (_error) {
    backButton.disabled = true;
    forwardButton.disabled = true;
  }
}

function updateActiveClasses() {
  syncWindowToolbar();
  renderDesktop();
}

function setPerformanceOverlayVisible(isVisible) {
  if (performanceOverlayVisible === isVisible) {
    return;
  }

  performanceOverlayVisible = isVisible;
  syncOverlayMenuState();
  writeShellState();
}

function syncPerformanceOverlayForActiveTab() {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  injectPerformanceOverlay(tab, performanceOverlayVisible ? "show" : "hide");
}

async function injectPerformanceOverlay(tab, action) {
  if (!tab?.ready || getTabUrl(tab).startsWith("file://")) {
    return;
  }

  const gpuStatus = await window.aivudaShell.getGpuStatus().catch(() => ({}));
  if (!tab.ready || !tab.webview.isConnected || tabs.get(tab.id) !== tab) return;

  tab.webview.executeJavaScript(
    `
      (() => {
        const action = ${JSON.stringify(action)};
        const electronGpuStatus = ${JSON.stringify(gpuStatus)};
        const id = "aivuda-performance-overlay";
        const storageKey = "aivuda.performanceOverlay.position.v1";
        const resizeHandlerKey = "__aivudaPerformanceOverlayResizeHandler";
        let overlay = document.getElementById(id);

        const clampCoordinate = (value, maxValue) => {
          if (!Number.isFinite(value)) {
            return 0;
          }

          return Math.max(0, Math.min(Math.max(0, maxValue), value));
        };

        const normalizeSavedPosition = (value) => {
          if (!value || typeof value !== "object") {
            return null;
          }

          if (Number.isFinite(value.xRatio) && Number.isFinite(value.yRatio)) {
            return {
              xRatio: Math.max(0, Math.min(1, value.xRatio)),
              yRatio: Math.max(0, Math.min(1, value.yRatio)),
            };
          }

          if (Number.isFinite(value.left) && Number.isFinite(value.top)) {
            return {
              left: value.left,
              top: value.top,
            };
          }

          return null;
        };

        const resolvePosition = (value, element) => {
          const normalized = normalizeSavedPosition(value);
          if (!normalized || !element) {
            return null;
          }

          const maxLeft = Math.max(0, window.innerWidth - element.offsetWidth);
          const maxTop = Math.max(0, window.innerHeight - element.offsetHeight);
          if (Number.isFinite(normalized.xRatio) && Number.isFinite(normalized.yRatio)) {
            return {
              left: clampCoordinate(normalized.xRatio * maxLeft, maxLeft),
              top: clampCoordinate(normalized.yRatio * maxTop, maxTop),
            };
          }

          return {
            left: clampCoordinate(normalized.left, maxLeft),
            top: clampCoordinate(normalized.top, maxTop),
          };
        };

        const buildRelativePosition = (left, top, element) => {
          const maxLeft = Math.max(0, window.innerWidth - element.offsetWidth);
          const maxTop = Math.max(0, window.innerHeight - element.offsetHeight);
          const normalizedLeft = clampCoordinate(left, maxLeft);
          const normalizedTop = clampCoordinate(top, maxTop);
          return {
            xRatio: maxLeft > 0 ? normalizedLeft / maxLeft : 0,
            yRatio: maxTop > 0 ? normalizedTop / maxTop : 0,
          };
        };

        const applySavedPosition = (element) => {
          let savedPosition = null;
          try {
            savedPosition = JSON.parse(localStorage.getItem(storageKey) || "null");
          } catch (_error) {}

          const normalized = normalizeSavedPosition(savedPosition);
          const resolved = resolvePosition(normalized, element);
          if (!normalized || !resolved) {
            return;
          }

          element.style.left = resolved.left + "px";
          element.style.top = resolved.top + "px";
          element.style.right = "auto";
          if (Number.isFinite(normalized.left) && Number.isFinite(normalized.top)) {
            localStorage.setItem(storageKey, JSON.stringify(buildRelativePosition(resolved.left, resolved.top, element)));
          }
        };

        if (action === "hide") {
          if (overlay) overlay.remove();
          return;
        }

        if (action === "toggle" && overlay) {
          overlay.remove();
          return;
        }

        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = id;
          overlay.style.cssText = [
            "position:fixed",
            "right:16px",
            "top:16px",
            "z-index:2147483647",
            "min-width:fit-content",
            "max-width:240px",
            "padding:2px 3px 2px 4px",
            "border:1px solid rgba(148,163,184,0.22)",
            "border-radius:10px",
            "background:rgba(255,255,255,0.24)",
            "color:#102a43",
            "font:11px/1.2 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
            "box-shadow:none",
            "backdrop-filter:blur(4px)",
            "cursor:move",
            "user-select:none"
          ].join(";");

          overlay.innerHTML = [
            '<div style="display:flex;align-items:center;gap:4px;min-height:22px;">',
            '<span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:#98a2b3;flex:0 0 auto;"></span>',
            '<span style="min-width:22px;font-weight:700;">FPS</span>',
            '<span data-fps style="min-width:20px;font-variant-numeric:tabular-nums;font-weight:700;">--</span>',
            '<button type="button" data-gpu-toggle title="GPU details" style="display:inline-grid;place-items:center;width:22px;height:22px;border:0;border-radius:999px;background:rgba(148,163,184,0.2);color:#334e68;font:inherit;font-size:11px;line-height:1;cursor:pointer;padding:0;">▾</button>',
            '<button type="button" data-close title="Hide" style="display:inline-grid;place-items:center;width:12px;height:12px;border:0;background:transparent;color:#52606d;font:inherit;font-size:11px;line-height:1;cursor:pointer;padding:0;">×</button>',
            '</div>',
            '<div data-gpu-row style="display:none;margin-top:2px;padding:4px 6px 2px;border-top:1px solid rgba(148,163,184,0.35);border-radius:8px;background:rgba(255,255,255,0.2);max-width:220px;overflow-wrap:anywhere;color:#334e68;">GPU: <span data-gpu>Checking...</span></div>'
          ].join("");

          document.documentElement.appendChild(overlay);
          applySavedPosition(overlay);

          const closeButton = overlay.querySelector("[data-close]");
          const gpuToggleButton = overlay.querySelector("[data-gpu-toggle]");
          const gpuRow = overlay.querySelector("[data-gpu-row]");
          closeButton.addEventListener("click", () => {
            overlay.remove();
            window.dispatchEvent(new CustomEvent("aivuda-shell:set-performance-overlay-visible", {
              detail: { visible: false }
            }));
          });
          gpuToggleButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const isOpen = gpuRow.style.display !== "none";
            gpuRow.style.display = isOpen ? "none" : "block";
            gpuToggleButton.textContent = isOpen ? "▾" : "▴";
          });

          let drag = null;
          overlay.addEventListener("pointerdown", (event) => {
            if (event.target === closeButton || event.target === gpuToggleButton) return;
            const rect = overlay.getBoundingClientRect();
            drag = {
              offsetX: event.clientX - rect.left,
              offsetY: event.clientY - rect.top
            };
            overlay.setPointerCapture(event.pointerId);
          });

          overlay.addEventListener("pointermove", (event) => {
            if (!drag) return;
            const nextLeft = Math.max(0, Math.min(window.innerWidth - overlay.offsetWidth, event.clientX - drag.offsetX));
            const nextTop = Math.max(0, Math.min(window.innerHeight - overlay.offsetHeight, event.clientY - drag.offsetY));
            overlay.style.left = nextLeft + "px";
            overlay.style.top = nextTop + "px";
            overlay.style.right = "auto";
          });

          overlay.addEventListener("pointerup", () => {
            if (!drag) return;
            drag = null;
            const rect = overlay.getBoundingClientRect();
            localStorage.setItem(storageKey, JSON.stringify(buildRelativePosition(rect.left, rect.top, overlay)));
          });

          overlay.addEventListener("pointercancel", () => {
            drag = null;
          });
        } else {
          applySavedPosition(overlay);
        }

        if (!window[resizeHandlerKey]) {
          window[resizeHandlerKey] = () => {
            const activeOverlay = document.getElementById(id);
            if (!activeOverlay) {
              return;
            }

            applySavedPosition(activeOverlay);
          };
          window.addEventListener("resize", window[resizeHandlerKey]);
        }

        const fpsEl = overlay.querySelector("[data-fps]");
        const gpuEl = overlay.querySelector("[data-gpu]");
        if (!overlay.__aivudaFpsLoop) {
          let frames = 0;
          let last = performance.now();
          const tick = (now) => {
            if (!document.getElementById(id)) return;
            frames += 1;
            const elapsed = now - last;
            if (elapsed >= 1000) {
              fpsEl.textContent = String(Math.round((frames * 1000) / elapsed));
              frames = 0;
              last = now;
            }
            requestAnimationFrame(tick);
          };
          overlay.__aivudaFpsLoop = true;
          requestAnimationFrame(tick);
        }

        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
        const gpuSummary = [
          electronGpuStatus.gpu_compositing ? "compositing:" + electronGpuStatus.gpu_compositing : "",
          electronGpuStatus.webgl ? "webgl:" + electronGpuStatus.webgl : "",
          electronGpuStatus.webgl2 ? "webgl2:" + electronGpuStatus.webgl2 : ""
        ].filter(Boolean).join(", ");

        if (!gl) {
          gpuEl.textContent = gpuSummary ? gpuSummary + " / page WebGL unavailable" : "Unavailable";
          return;
        }

        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          gpuEl.textContent = renderer
            ? (gpuSummary ? gpuSummary + " / " : "Enabled - ") + renderer
            : (gpuSummary || "Enabled");
        } else {
          gpuEl.textContent = gpuSummary || "Enabled";
        }
      })();
    `,
    true,
  ).catch((error) => {
    console.warn("[aivuda-shell] failed to inject performance overlay", error);
  });
}

function formatElapsedTime(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function setScreenRecordBarPosition(position) {
  const normalizedPosition = normalizeRelativeOverlayPosition(position);
  if (!normalizedPosition) {
    return;
  }

  if (
    !screenRecordBarPosition ||
    screenRecordBarPosition.xRatio !== normalizedPosition.xRatio ||
    screenRecordBarPosition.yRatio !== normalizedPosition.yRatio ||
    screenRecordBarPosition.left !== normalizedPosition.left ||
    screenRecordBarPosition.top !== normalizedPosition.top
  ) {
    screenRecordBarPosition = normalizedPosition;
    writeShellState();
  }
}

function setScreenRecordBarVisible(isVisible) {
  if (screenRecordBarVisible === isVisible) {
    return;
  }

  screenRecordBarVisible = isVisible;
  syncOverlayMenuState();
  writeShellState();
}

function setScreenRecordState(nextStatus, nextText) {
  screenRecordStatus = nextStatus;
  if (typeof nextText === "string") {
    screenRecordStatusText = nextText;
  }
  renderScreenRecordBar();
}

function stopScreenRecordTimer() {
  if (screenRecordTimer) {
    window.clearInterval(screenRecordTimer);
    screenRecordTimer = 0;
  }
}

function startScreenRecordTimer() {
  stopScreenRecordTimer();
  screenRecordTimer = window.setInterval(() => {
    if (screenRecordStatus !== "recording") {
      stopScreenRecordTimer();
      return;
    }
    screenRecordElapsedMs = screenRecordAccumulatedMs + (Date.now() - screenRecordStartedAt);
    renderScreenRecordBar();
  }, 250);
}

function cleanupScreenRecorderStream() {
  if (screenRecorderFrameCapture) {
    screenRecorderFrameCapture.stopped = true;
    clearTimeout(screenRecorderFrameCapture.timer);
    screenRecorderFrameCapture = null;
  }
  if (screenRecorderStream) {
    for (const track of screenRecorderStream.getTracks()) {
      track.stop();
    }
  }
  screenRecorderStream = null;
}

function canCloseScreenRecordBar() {
  return !["starting", "recording", "paused", "stopping"].includes(screenRecordStatus);
}

function updateScreenRecordBarLayout() {
  if (!screenRecordBarEl) {
    return;
  }

  if (screenRecordBarPosition) {
    const resolvedPosition = resolveOverlayPosition(
      screenRecordBarPosition,
      screenRecordBarEl.offsetWidth,
      screenRecordBarEl.offsetHeight,
    );
    if (resolvedPosition) {
      screenRecordBarEl.style.left = `${resolvedPosition.left}px`;
      screenRecordBarEl.style.top = `${resolvedPosition.top}px`;
      if (isLegacyAbsoluteOverlayPosition(screenRecordBarPosition)) {
        setScreenRecordBarPosition(
          createRelativeOverlayPosition(
            resolvedPosition.left,
            resolvedPosition.top,
            screenRecordBarEl.offsetWidth,
            screenRecordBarEl.offsetHeight,
          ),
        );
      }
    }
    screenRecordBarEl.style.right = "auto";
    screenRecordBarEl.style.bottom = "auto";
  }
}

function renderScreenRecordBar() {
  if (!screenRecordBarVisible) {
    if (screenRecordBarEl) {
      screenRecordBarEl.remove();
      screenRecordBarEl = null;
    }
    return;
  }

  if (!screenRecordBarEl) {
    const bar = document.createElement("div");
    bar.id = "aivuda-screen-record-bar";
    bar.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "min-width:fit-content",
      "max-width:320px",
      "padding:2px 3px 2px 4px",
      "border:1px solid rgba(148,163,184,0.22)",
      "border-radius:10px",
      "background:rgba(255,255,255,0.24)",
      "color:#102a43",
      "font:11px/1.2 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "box-shadow:none",
      "backdrop-filter:blur(4px)",
      "user-select:none"
    ].join(";");

    let drag = null;
    bar.addEventListener("pointerdown", (event) => {
      if (event.target instanceof HTMLButtonElement) {
        return;
      }

      const rect = bar.getBoundingClientRect();
      drag = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      bar.setPointerCapture(event.pointerId);
    });

    bar.addEventListener("pointermove", (event) => {
      if (!drag) {
        return;
      }

      const nextLeft = Math.max(0, Math.min(window.innerWidth - bar.offsetWidth, event.clientX - drag.offsetX));
      const nextTop = Math.max(0, Math.min(window.innerHeight - bar.offsetHeight, event.clientY - drag.offsetY));
      bar.style.left = `${nextLeft}px`;
      bar.style.top = `${nextTop}px`;
      bar.style.right = "auto";
      bar.style.bottom = "auto";
    });

    const finishDrag = () => {
      if (!drag) {
        return;
      }
      drag = null;
      const rect = bar.getBoundingClientRect();
      setScreenRecordBarPosition(
        createRelativeOverlayPosition(rect.left, rect.top, rect.width, rect.height),
      );
    };

    bar.addEventListener("pointerup", finishDrag);
    bar.addEventListener("pointercancel", finishDrag);

    document.body.appendChild(bar);
    screenRecordBarEl = bar;
    updateScreenRecordBarLayout();
  }

  const isRecording = screenRecordStatus === "recording";
  const isPaused = screenRecordStatus === "paused";
  const isBusy = screenRecordStatus === "stopping" || screenRecordStatus === "starting";
  const elapsedText = formatElapsedTime(screenRecordElapsedMs);
  const recordingFolderPath = screenRecorderOutputDir || defaultScreenRecordingsDir;
  const escapedRecordingFolderPath = recordingFolderPath ? escapeHtml(recordingFolderPath) : "";
  const canExpand = Boolean(screenRecordStatusText || screenRecorderLastSavedPath || recordingFolderPath || screenRecordStatus === "error");
  const detailsOpen = screenRecordDetailsExpanded && canExpand;
  const statusTone = screenRecordStatus === "error" ? "#b42318" : screenRecordStatus === "saved" ? "#0f7b6c" : "#486581";
  const indicatorColor = isRecording ? "#d92d20" : isPaused ? "#d97706" : screenRecordStatus === "error" ? "#b42318" : "#98a2b3";
  const primaryButtonStyle =
    "display:inline-grid;place-items:center;width:22px;height:22px;border:0;border-radius:999px;background:rgba(148,163,184,0.2);color:#334e68;font:inherit;font-size:11px;line-height:1;cursor:pointer;padding:0;";
  const stopButtonStyle =
    "display:inline-grid;place-items:center;width:22px;height:22px;border:0;border-radius:999px;background:rgba(217,45,32,0.18);color:#b42318;font:inherit;font-size:11px;line-height:1;cursor:pointer;padding:0;";
  const chromeButtonStyle =
    "display:inline-grid;place-items:center;width:12px;height:12px;border:0;background:transparent;color:#334e68;font:inherit;font-size:11px;line-height:1;cursor:pointer;padding:0;";
  const disabledButtonStyle =
    "display:inline-grid;place-items:center;width:22px;height:22px;border:0;border-radius:999px;background:rgba(203,213,225,0.2);color:#98a2b3;font:inherit;font-size:11px;line-height:1;cursor:not-allowed;padding:0;";
  const disabledChromeButtonStyle =
    "display:inline-grid;place-items:center;width:12px;height:12px;border:0;background:transparent;color:#98a2b3;font:inherit;font-size:11px;line-height:1;cursor:not-allowed;padding:0;";
  const actionLinkStyle = "border:0;background:transparent;padding:0;color:#0f6ad8;font:inherit;cursor:pointer;text-decoration:underline;";
  const escapedSavedPath = screenRecorderLastSavedPath ? escapeHtml(screenRecorderLastSavedPath) : "";

  screenRecordBarEl.innerHTML = [
    `<div style="display:flex;align-items:center;gap:4px;cursor:move;${detailsOpen ? "margin-bottom:4px;" : ""}">`,
    `<span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:${indicatorColor};box-shadow:none;flex:0 0 auto;"></span>`,
    `<div style="min-width:46px;font-variant-numeric:tabular-nums;font-weight:700;color:${isRecording ? "#b42318" : isPaused ? "#b45309" : "#102a43"};">${elapsedText}</div>`,
    '<div style="display:flex;align-items:center;gap:4px;margin-left:2px;">',
    screenRecordStatus === "idle" || screenRecordStatus === "saved" || screenRecordStatus === "error"
      ? `<button type="button" data-start-screen-record title="Start recording" style="${isBusy ? disabledButtonStyle : primaryButtonStyle}">●</button>`
      : "",
    isRecording || isPaused
      ? `<button type="button" data-pause-screen-record title="${isPaused ? "Resume recording" : "Pause recording"}" style="${isBusy ? disabledButtonStyle : primaryButtonStyle}">${isPaused ? "▶" : "⏸"}</button>`
      : "",
    isRecording || isPaused || isBusy
      ? `<button type="button" data-stop-screen-record title="Stop and save recording" style="${isBusy ? disabledButtonStyle : stopButtonStyle}">■</button>`
      : "",
    canExpand
      ? `<button type="button" data-expand-screen-record title="${detailsOpen ? "Hide details" : "Show details"}" style="${chromeButtonStyle}">${detailsOpen ? "▴" : "▾"}</button>`
      : "",
    canCloseScreenRecordBar()
      ? `<button type="button" data-close-screen-record title="Hide" style="${chromeButtonStyle}">×</button>`
      : `<button type="button" title="Recording is active" disabled style="${disabledChromeButtonStyle}">×</button>`,
    "</div>",
    "</div>",
    detailsOpen
      ? [
          '<div style="margin-top:2px;padding:4px 6px 2px;border-top:1px solid rgba(148,163,184,0.35);border-radius:8px;background:rgba(255,255,255,0.2);max-width:300px;overflow-wrap:anywhere;">',
          '<div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;font-size:10px;">',
          ...[["native", "Native"], ["ffmpeg", "FFmpeg"], ["ffmpeg-x11", "FFmpeg X11"]].map(([mode, label]) =>
            `<button type="button" data-screen-record-mode="${mode}" ${canCloseScreenRecordBar() ? "" : "disabled"} style="border:0;border-radius:5px;padding:2px 6px;background:${screenRecordMode === mode ? "rgba(148,163,184,0.3)" : "transparent"};color:#334e68;font:inherit;cursor:pointer;">${label}</button>`),
          "</div>",
          `<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:${statusTone};">${screenRecordStatus}</div>`,
          `<div style="margin-top:2px;font-size:11px;color:#334e68;">${screenRecordStatusText || "No details"}</div>`,
          screenRecorderLastSavedPath
            ? [
                '<div style="margin-top:4px;font-size:10px;color:#486581;">',
                `<button type="button" data-open-recording-file title="Open recorded video" style="${actionLinkStyle};display:block;max-width:100%;text-align:left;overflow-wrap:anywhere;">${escapedSavedPath}</button>`,
                '<div style="margin-top:3px;">',
                `<button type="button" data-open-recording-folder title="Show in folder" style="${actionLinkStyle}">Open folder</button>`,
                "</div>",
                "</div>",
              ].join("")
            : "",
          !screenRecorderLastSavedPath && recordingFolderPath
            ? [
                '<div style="margin-top:4px;font-size:10px;color:#486581;">',
                `<div style="max-width:100%;overflow-wrap:anywhere;">${escapedRecordingFolderPath}</div>`,
                '<div style="margin-top:3px;">',
                `<button type="button" data-open-recording-folder title="Open recordings folder" style="${actionLinkStyle}">Open folder</button>`,
                "</div>",
                "</div>",
              ].join("")
            : "",
          "</div>",
        ].join("")
      : "",
  ].join("");

  const closeButton = screenRecordBarEl.querySelector("[data-close-screen-record]");
  const startButton = screenRecordBarEl.querySelector("[data-start-screen-record]");
  const pauseButton = screenRecordBarEl.querySelector("[data-pause-screen-record]");
  const stopButton = screenRecordBarEl.querySelector("[data-stop-screen-record]");
  const expandButton = screenRecordBarEl.querySelector("[data-expand-screen-record]");
  const openRecordingFileButton = screenRecordBarEl.querySelector("[data-open-recording-file]");
  const openRecordingFolderButton = screenRecordBarEl.querySelector("[data-open-recording-folder]");
  for (const button of screenRecordBarEl.querySelectorAll("[data-screen-record-mode]")) {
    button.title = button.dataset.screenRecordMode === "native" ? "Native window capture (WebM)" : button.dataset.screenRecordMode === "ffmpeg" ? "Window frames encoded by FFmpeg (MP4)" : "X11 window region encoded by FFmpeg (MP4)";
    button.onclick = () => {
      if (!canCloseScreenRecordBar()) return;
      screenRecordMode = button.dataset.screenRecordMode;
      writeShellState(); renderScreenRecordBar();
    };
  }

  if (closeButton) {
    closeButton.addEventListener("click", () => {
      if (!canCloseScreenRecordBar()) {
        return;
      }

      setScreenRecordBarVisible(false);
      screenRecordDetailsExpanded = false;
      renderScreenRecordBar();
    });
  }

  if (startButton) {
    startButton.disabled = isBusy;
    startButton.addEventListener("click", () => {
      if (!isBusy) {
        startScreenRecording();
      }
    });
  }

  if (pauseButton) {
    pauseButton.disabled = isBusy;
    pauseButton.addEventListener("click", () => {
      if (isBusy) {
        return;
      }

      if (screenRecordStatus === "recording") {
        pauseScreenRecording();
      } else if (screenRecordStatus === "paused") {
        resumeScreenRecording();
      }
    });
  }

  if (stopButton) {
    stopButton.disabled = isBusy;
    stopButton.addEventListener("click", () => {
      if (!isBusy) {
        stopScreenRecording();
      }
    });
  }

  if (expandButton) {
    expandButton.addEventListener("click", () => {
      screenRecordDetailsExpanded = !screenRecordDetailsExpanded;
      renderScreenRecordBar();
    });
  }

  if (openRecordingFileButton) {
    openRecordingFileButton.addEventListener("click", async () => {
      const response = await window.aivudaShell.openPath(screenRecorderLastSavedPath);
      if (!response?.ok) {
        setScreenRecordState("error", `Open file failed: ${response?.error || "Unknown error"}`);
        screenRecordDetailsExpanded = true;
        renderScreenRecordBar();
      }
    });
  }

  if (openRecordingFolderButton) {
    openRecordingFolderButton.addEventListener("click", async () => {
      const response = screenRecorderLastSavedPath
        ? await window.aivudaShell.showItemInFolder(screenRecorderLastSavedPath)
        : await window.aivudaShell.openPath(recordingFolderPath);
      if (!response?.ok) {
        setScreenRecordState("error", `Open folder failed: ${response?.error || "Unknown error"}`);
        screenRecordDetailsExpanded = true;
        renderScreenRecordBar();
      }
    });
  }

}

function resetScreenRecordingSessionState() {
  screenRecorder = null;
  screenRecorderChunks = [];
  cleanupScreenRecorderStream();
  screenRecorderOutputPath = "";
  screenRecorderOutputDir = "";
  screenRecordStartedAt = 0;
  screenRecordElapsedMs = 0;
  screenRecordAccumulatedMs = 0;
  screenRecordPausedAt = 0;
  screenRecordBackend = null;
  stopScreenRecordTimer();
}

function createScreenRecordFinalizePromise() {
  if (screenRecordFinalizePromise) {
    return screenRecordFinalizePromise.promise;
  }

  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  screenRecordFinalizePromise = {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
  return promise;
}

function resolveScreenRecordFinalize(value) {
  if (!screenRecordFinalizePromise) {
    return;
  }

  screenRecordFinalizePromise.resolve(value);
  screenRecordFinalizePromise = null;
}

function rejectScreenRecordFinalize(error) {
  if (!screenRecordFinalizePromise) {
    return;
  }

  screenRecordFinalizePromise.reject(error);
  screenRecordFinalizePromise = null;
}

async function stopScreenRecording() {
  if (screenRecordStatus === "stopping") {
    return screenRecordFinalizePromise?.promise || Promise.resolve();
  }

  if (!screenRecordBackend || (screenRecordStatus !== "recording" && screenRecordStatus !== "paused")) {
    return Promise.resolve();
  }

  const finalizePromise = createScreenRecordFinalizePromise();

  if (screenRecordBackend === "native" && screenRecordStatus === "paused") {
    try {
      screenRecorder.resume();
    } catch (_error) {}
  }

  isStoppingScreenRecorder = true;
  stopScreenRecordTimer();
  screenRecordElapsedMs =
    screenRecordStatus === "paused" ? screenRecordAccumulatedMs : screenRecordAccumulatedMs + (Date.now() - screenRecordStartedAt);
  setScreenRecordState("stopping", "Saving recording...");

  if (screenRecordBackend === "ffmpeg") {
    window.aivudaShell
      .stopFfmpegWindowRecording()
      .then((response) => {
        if (!response?.ok) {
          throw new Error(response?.error || "Failed to stop FFmpeg recording.");
        }
        screenRecorderLastSavedPath = response.outputPath || screenRecorderOutputPath;
        setScreenRecordState("saved", "Recording saved");
        isStoppingScreenRecorder = false;
        resetScreenRecordingSessionState();
        renderScreenRecordBar();
        resolveScreenRecordFinalize(response.outputPath);
      })
      .catch((error) => {
        isStoppingScreenRecorder = false;
        setScreenRecordState("error", `Record stop failed: ${error.message}`);
        screenRecordDetailsExpanded = true;
        rejectScreenRecordFinalize(error);
      });
    return finalizePromise;
  }

  try {
    if (screenRecorderFrameCapture) {
      screenRecorderFrameCapture.stopped = true;
      clearTimeout(screenRecorderFrameCapture.timer);
    }
    screenRecorder.stop();
  } catch (error) {
    isStoppingScreenRecorder = false;
    setScreenRecordState("error", `Record stop failed: ${error.message}`);
    screenRecordDetailsExpanded = true;
    rejectScreenRecordFinalize(error);
  }

  return finalizePromise;
}

function pauseScreenRecording() {
  if (!screenRecordBackend || screenRecordStatus !== "recording") {
    return;
  }

  if (screenRecordBackend === "ffmpeg") {
    window.aivudaShell.pauseFfmpegWindowRecording().then((response) => {
      if (!response?.ok) {
        setScreenRecordState("error", `Pause failed: ${response?.error || "Unknown error"}`);
        screenRecordDetailsExpanded = true;
        return;
      }
      screenRecordAccumulatedMs += Date.now() - screenRecordStartedAt;
      screenRecordPausedAt = Date.now();
      screenRecordElapsedMs = screenRecordAccumulatedMs;
      stopScreenRecordTimer();
      setScreenRecordState("paused", "Recording paused");
    });
    return;
  }

  try {
    screenRecorder.pause();
    screenRecordAccumulatedMs += Date.now() - screenRecordStartedAt;
    screenRecordPausedAt = Date.now();
    screenRecordElapsedMs = screenRecordAccumulatedMs;
    stopScreenRecordTimer();
    setScreenRecordState("paused", "Recording paused");
  } catch (error) {
    setScreenRecordState("error", `Pause failed: ${error.message}`);
    screenRecordDetailsExpanded = true;
  }
}

function resumeScreenRecording() {
  if (!screenRecordBackend || screenRecordStatus !== "paused") {
    return;
  }

  if (screenRecordBackend === "ffmpeg") {
    window.aivudaShell.resumeFfmpegWindowRecording().then((response) => {
      if (!response?.ok) {
        setScreenRecordState("error", `Resume failed: ${response?.error || "Unknown error"}`);
        screenRecordDetailsExpanded = true;
        return;
      }
      screenRecordPausedAt = 0;
      screenRecordStartedAt = Date.now();
      startScreenRecordTimer();
      setScreenRecordState("recording", "Recording");
    });
    return;
  }

  try {
    screenRecorder.resume();
    screenRecordPausedAt = 0;
    screenRecordStartedAt = Date.now();
    startScreenRecordTimer();
    setScreenRecordState("recording", "Recording");
  } catch (error) {
    setScreenRecordState("error", `Resume failed: ${error.message}`);
    screenRecordDetailsExpanded = true;
  }
}

async function finalizeScreenRecording() {
  try {
    const blob = new Blob(screenRecorderChunks, { type: screenRecorder?.mimeType || "video/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    const response = await window.aivudaShell.saveRecordingFile({
      outputPath: screenRecorderOutputPath,
      buffer: Array.from(new Uint8Array(arrayBuffer)),
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to save recording.");
    }

    screenRecorderLastSavedPath = response.outputPath;
    setScreenRecordState("saved", "Recording saved");
    isStoppingScreenRecorder = false;
    resetScreenRecordingSessionState();
    renderScreenRecordBar();
    resolveScreenRecordFinalize(response.outputPath);
  } catch (error) {
    isStoppingScreenRecorder = false;
    setScreenRecordState("error", `Record save failed: ${error.message}`);
    screenRecordDetailsExpanded = true;
    cleanupScreenRecorderStream();
    screenRecorder = null;
    screenRecorderChunks = [];
    rejectScreenRecordFinalize(error);
    renderScreenRecordBar();
  }
}

function chooseScreenRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
  ];

  for (const candidate of candidates) {
    if (typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function createNativeWindowStream() {
  // A CPU-backed canvas avoids Chromium's driver-dependent desktop capturer.
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("Could not create recording canvas.");
  const capture = { canvas, timer: null, stopped: false };
  screenRecorderFrameCapture = capture;
  async function drawFrame() {
    const png = await window.aivudaShell.captureRecordingFrame();
    const bitmap = await createImageBitmap(new Blob([png], { type: "image/png" }));
    try {
      if (capture.stopped) return;
      if (!capture.track) { canvas.width = bitmap.width; canvas.height = bitmap.height; }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      capture.track?.requestFrame();
    } finally { bitmap.close(); }
  }
  await drawFrame();
  const stream = canvas.captureStream(0);
  capture.track = stream.getVideoTracks()[0];
  screenRecorderStream = stream;
  capture.track.requestFrame();
  async function tick() {
    if (capture.stopped) return;
    try {
      if (screenRecordStatus !== "paused") await drawFrame();
    } catch (error) {
      if (!capture.stopped) {
        capture.stopped = true;
        await stopScreenRecording().catch(() => {});
        setScreenRecordState("error", `Window capture failed: ${error.message}`);
      }
      return;
    }
    if (!capture.stopped) capture.timer = setTimeout(tick, 50);
  }
  capture.timer = setTimeout(tick, 50);
  return stream;
}

async function startScreenRecording() {
  if (!canCloseScreenRecordBar()) {
    return;
  }

  setScreenRecordBarVisible(true);
  screenRecordDetailsExpanded = false;
  screenRecorderLastSavedPath = "";
  renderScreenRecordBar();
  setScreenRecordState("starting", "Preparing window capture...");

  if (screenRecordMode === "ffmpeg" || screenRecordMode === "ffmpeg-x11") {
    try {
      const prepared =
        screenRecordMode === "ffmpeg-x11"
          ? await window.aivudaShell.startFfmpegX11Recording()
          : await window.aivudaShell.startFfmpegWindowRecording();
      if (!prepared?.ok || !prepared.outputPath) {
        throw new Error(prepared?.error || "Could not start FFmpeg window capture.");
      }
      if (screenRecordStatus === "error") throw new Error(screenRecordStatusText);

      screenRecordBackend = "ffmpeg";
      screenRecorderOutputPath = prepared.outputPath;
      screenRecorderOutputDir = prepared.recordingsDir || "";
      screenRecordStartedAt = Date.now();
      screenRecordAccumulatedMs = 0;
      screenRecordPausedAt = 0;
      screenRecordElapsedMs = 0;
      startScreenRecordTimer();
      setScreenRecordState("recording", "Recording with FFmpeg");
      return;
    } catch (error) {
      resetScreenRecordingSessionState();
      setScreenRecordState("error", `Record start failed: ${error.message}`);
      screenRecordDetailsExpanded = true;
      return;
    }
  }

  try {
    const prepared = await window.aivudaShell.prepareWindowRecording();
    if (!prepared?.ok || !prepared.outputPath) {
      throw new Error(prepared?.error || "Could not prepare window capture.");
    }

    const stream = await createNativeWindowStream();
    screenRecorderStream = stream;

    const mimeType = chooseScreenRecordingMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    screenRecorderChunks = [];
    screenRecordBackend = "native";
    screenRecorder = recorder;
    screenRecorderStream = stream;
    screenRecorderOutputPath = prepared.outputPath;
    screenRecorderOutputDir = prepared.recordingsDir || "";
    screenRecordStartedAt = Date.now();
    screenRecordAccumulatedMs = 0;
    screenRecordPausedAt = 0;
    screenRecordElapsedMs = 0;

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        screenRecorderChunks.push(event.data);
      }
    });

    recorder.addEventListener("stop", () => {
      finalizeScreenRecording();
    });

    recorder.addEventListener("error", (event) => {
      const message = event?.error?.message || "Recording failed.";
      isStoppingScreenRecorder = false;
      setScreenRecordState("error", `Record failed: ${message}`);
      screenRecordDetailsExpanded = true;
      resetScreenRecordingSessionState();
      rejectScreenRecordFinalize(new Error(message));
    });

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        if (screenRecordStatus === "recording" || screenRecordStatus === "paused") {
          stopScreenRecording();
        }
      });
    }

    recorder.start(1000);
    startScreenRecordTimer();
    setScreenRecordState("recording", "Recording");
  } catch (error) {
    resetScreenRecordingSessionState();
    setScreenRecordState("error", `Record start failed: ${error.message}`);
    screenRecordDetailsExpanded = true;
  }
}

function showScreenRecordBar() {
  setScreenRecordBarVisible(true);
  renderScreenRecordBar();
}

async function finalizeActiveRecordingBeforeClose() {
  await writeShellState();
  if (screenRecordStatus !== "recording" && screenRecordStatus !== "paused" && screenRecordStatus !== "stopping") {
    return { ok: true };
  }

  try {
    await stopScreenRecording();
    return { ok: true, outputPath: screenRecorderLastSavedPath };
  } catch (error) {
    screenRecordDetailsExpanded = true;
    renderScreenRecordBar();
    return {
      ok: false,
      error: error?.message || "Failed to finalize recording before close.",
    };
  }
}

window.__aivudaFinalizeActiveRecordingBeforeClose = finalizeActiveRecordingBeforeClose;

function toggleScreenRecordBar() {
  setScreenRecordBarVisible(!screenRecordBarVisible);
  renderScreenRecordBar();
}

function createTab(rawUrl, options = {}) {
  const id = options.id || `tab-${nextTabId}`;
  const numericId = Number(String(id).replace(/^tab-/, ""));
  if (Number.isFinite(numericId)) {
    nextTabId = Math.max(nextTabId, numericId + 1);
  } else {
    nextTabId += 1;
  }

  const url = canonicalizeNavigationUrl(rawUrl);
  const webview = document.createElement("webview");
  webview.src = url;
  webview.setAttribute("partition", "persist:aivuda-shell");
  webview.setAttribute("preload", guestPreloadUrl);
  // The main process denies native popups and routes allowed URLs to our desktop.
  webview.setAttribute("allowpopups", "");

  const tab = {
    id,
    title: options.title || getSiteNameFromUrl(url),
    url,
    appUrl: options.appUrl || url,
    favicon: options.favicon || "",
    ready: false,
    webview,
  };

  tabs.set(id, tab);
  mountApplicationWindow(tab, options);
  writeShellState();

  webview.addEventListener("dom-ready", () => {
    tab.ready = true;
    if (typeof webview.getWebContentsId === "function") {
      window.aivudaShell.registerWebview(webview.getWebContentsId());
    }
    if (performanceOverlayVisible) {
      injectPerformanceOverlay(tab, "show");
    }
  });

  webview.addEventListener("ipc-message", (event) => {
    if (event.channel === "aivuda-shell:activate-window") {
      setToolsMenuOpen(false);
      setWindowMenuOpen(false);
      document.getElementById("dock-menu").hidden = true;
      if (!desktopVisible && !appWindows.get(tab.windowId)?.minimized && activeTabId !== tab.id) activateTab(tab.id);
      return;
    }
    if (event.channel === "aivuda-shell:open-url-in-new-tab") {
      const [nextUrl] = event.args;
      if (typeof nextUrl === "string" && nextUrl.trim()) {
        window.aivudaShell.routePagePopup(nextUrl);
      }
      return;
    }

    if (event.channel === "aivuda-shell:set-performance-overlay-visible") {
      const [isVisible] = event.args;
      if (typeof isVisible === "boolean") {
        setPerformanceOverlayVisible(isVisible);
      }
    }
  });

  webview.addEventListener("did-start-loading", () => {
    setStatus("Loading");
    updateTabTitle(tab, tab.title);
  });

  webview.addEventListener("did-stop-loading", () => {
    tab.url = getTabUrl(tab);
    updateTabTitle(tab, tab.webview.getTitle());
    if (tab.id === activeTabId) {
      setStatus("Ready");
      updateAddressFromActiveTab();
      updateNavigationState();
    }
    writeShellState();
  });

  webview.addEventListener("did-navigate", () => {
    tab.url = getTabUrl(tab);
    updateTabTitle(tab, tab.webview.getTitle());
    if (tab.id === activeTabId) {
      updateAddressFromActiveTab();
      updateNavigationState();
    }
    writeShellState();
  });

  webview.addEventListener("did-navigate-in-page", () => {
    tab.url = getTabUrl(tab);
    updateTabTitle(tab, tab.webview.getTitle());
    if (tab.id === activeTabId) {
      updateAddressFromActiveTab();
      updateNavigationState();
    }
    writeShellState();
  });

  webview.addEventListener("page-title-updated", (event) => {
    updateTabTitle(tab, event.title);
  });

  webview.addEventListener("page-favicon-updated", (event) => {
    const [faviconUrl] = Array.isArray(event.favicons) ? event.favicons : [];
    updateTabIcon(tab, faviconUrl);
  });

  webview.addEventListener("did-fail-load", (event) => {
    // Chromium reports a superseded navigation as ERR_ABORTED; the newer
    // navigation is still valid and must not be replaced by the offline page.
    if (event.errorCode === -3) return;
    if (!event.isMainFrame || event.validatedURL.startsWith("file://")) {
      return;
    }

    const params = new URLSearchParams({
      url: event.validatedURL || tab.url,
      error: `${event.errorDescription} (${event.errorCode})`,
    });
    webview.src = `${offlineUrl}?${params.toString()}`;
  });
  activateTab(id);
  if (options.minimized) {
    minimizeApplicationWindow(tab);
    if (options.placement) tab.placement = options.placement;
  }
  return tab;
}

function activateTab(id) {
  if (!tabs.has(id)) {
    return;
  }

  const tab = tabs.get(id);
  activateWindow(tab.windowId);
  activeTabId = id;
  desktopVisible = false;
  desktopActiveTabId = id;
  if (!tab.panel) addApplicationPanel(tab);
  tab.panel.api.setActive();
  schedulePanelLayout();
  updateActiveClasses();
  updateAddressFromActiveTab();
  updateNavigationState();
  syncPerformanceOverlayForActiveTab();
  writeShellState();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) {
    return;
  }

  removeApplicationWindow(tab);
}

function reloadActiveTab() {
  const tab = getActiveTab();
  if (tab) {
    tab.webview.reload();
  }
}

async function navigateActiveTab(rawUrl) {
  const tab = getActiveTab();
  if (!tab) {
    showOpenPageDialog();
    return;
  }

  const nextUrl = canonicalizeNavigationUrl(rawUrl);
  const authorized = await window.aivudaShell.authorizeUrl(nextUrl);
  if (!authorized.ok) { setStatus(authorized.error || "Navigation denied"); return; }
  tab.url = nextUrl;
  tab.appUrl = nextUrl;
  tab.favicon = "";
  tab.webview.src = nextUrl;
  renderDesktop();
  updateAddressFromActiveTab();
  writeShellState();
}

function syncOverlayMenuState() {
  document.getElementById("tools-fps")?.setAttribute("aria-checked", String(performanceOverlayVisible));
  document.getElementById("tools-record")?.setAttribute("aria-checked", String(screenRecordBarVisible));
}

function setToolsMenuOpen(isOpen) {
  if (!toolsButton || !toolsMenu) return;
  toolsMenu.hidden = !isOpen;
  toolsButton.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    document.getElementById('applications-menu').hidden = true;
    document.getElementById('applications-button').setAttribute('aria-expanded', 'false');
    syncOverlayMenuState();
    setWindowMenuOpen(false);
    document.getElementById("dock-menu").hidden = true;
    const tab = getActiveTab();
    for (const id of ["system-reload", "system-window-tools", "system-devtools"]) document.getElementById(id).disabled = !tab?.ready;
    toolsMenu.querySelector("button")?.focus();
  }
}

collapseChromeButton.addEventListener("click", () => {
  setChromeExpanded(false);
});

newTabButton.addEventListener("click", () => {
  showOpenPageDialog();
});

reloadButton.addEventListener("click", reloadActiveTab);
document.getElementById("add-favorite")?.addEventListener("click", addCurrentFavorite);
document.getElementById("home-button")?.addEventListener("click", () => navigateActiveTab(defaultUrl));
document.getElementById("store-button")?.addEventListener("click", () => navigateActiveTab(storeUrl || defaultUrl));
toolsButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  setToolsMenuOpen(toolsMenu?.hidden !== false);
});
toolsMenu.addEventListener("click", (event) => event.stopPropagation());
for (const [id, action] of [
  ["system-open-page", showOpenPageDialog], ["system-desktop", showDesktop],
  ["system-address", toggleActiveAddressBar], ["system-reload", reloadActiveTab],
  ["system-window-tools", () => { const tab = getActiveTab(); if (tab) openWindowMenu(tab); }],
  ["system-devtools", toggleActiveDevtools],
  ["system-fullscreen", () => window.aivudaShell.desktopCommand("fullscreen")],
  ["system-quit", () => window.aivudaShell.desktopCommand("quit")],
]) document.getElementById(id).onclick = () => { setToolsMenuOpen(false); action(); };
document.getElementById("tools-fps")?.addEventListener("click", () => {
  setToolsMenuOpen(false);
  setPerformanceOverlayVisible(!performanceOverlayVisible);
  syncPerformanceOverlayForActiveTab();
});
document.getElementById("tools-record")?.addEventListener("click", () => {
  setToolsMenuOpen(false);
  toggleScreenRecordBar();
});
document.getElementById("tools-clear-data")?.addEventListener("click", async () => {
  setToolsMenuOpen(false);
  await window.aivudaShell.clearBrowserData();
  window.location.reload();
});
document.addEventListener("click", () => setToolsMenuOpen(false));

backButton.addEventListener("click", () => {
  const tab = getActiveTab();
  if (tab?.webview.canGoBack()) {
    tab.webview.goBack();
  }
});

forwardButton.addEventListener("click", () => {
  const tab = getActiveTab();
  if (tab?.webview.canGoForward()) {
    tab.webview.goForward();
  }
});

addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    navigateActiveTab(addressInput.value);
  }
});

window.addEventListener(
  "keydown",
  (event) => {
    if (isZoomInShortcut(event)) {
      event.preventDefault();
      adjustActiveTabZoom(zoomStep);
      return;
    }

    if (isZoomOutShortcut(event)) {
      event.preventDefault();
      adjustActiveTabZoom(-zoomStep);
      return;
    }

    if (isResetZoomShortcut(event)) {
      event.preventDefault();
      resetActiveTabZoom();
    }
  },
  true,
);

window.aivudaShell.onNewTab((payload) => createTab(payload?.url || defaultUrl));
window.aivudaShell.onRecordingError((failure) => {
  resetScreenRecordingSessionState();
  screenRecordDetailsExpanded = true;
  setScreenRecordState("error", failure?.error || "Recording encoder stopped.");
});
window.aivudaShell.onOpenUrlInNewTab((payload) => {
  createTab(payload?.url || defaultUrl);
});
window.aivudaShell.onCloseCurrentTab(() => {
  if (activeTabId) {
    closeTab(activeTabId);
  }
});
window.aivudaShell.onReloadCurrentTab(reloadActiveTab);
window.aivudaShell.onResetZoom(resetActiveTabZoom);
window.aivudaShell.onShowBrowserChrome(() => {
  if (!getActiveTab()) { showOpenPageDialog(); return; }
  setChromeExpanded(true);
  addressInput.focus();
  addressInput.select();
});
window.aivudaShell.onHideBrowserChrome(() => {
  setChromeExpanded(false);
});
window.aivudaShell.onToggleBrowserChrome(() => {
  toggleActiveAddressBar();
});
window.aivudaShell.onToggleDevtools(toggleActiveDevtools);
window.aivudaShell.onZoomIn(() => {
  adjustActiveTabZoom(zoomStep);
});
window.aivudaShell.onZoomOut(() => {
  adjustActiveTabZoom(-zoomStep);
});
window.aivudaShell.onShowPerformanceOverlay(() => {
  setPerformanceOverlayVisible(true);
  syncPerformanceOverlayForActiveTab();
});
window.aivudaShell.onHidePerformanceOverlay(() => {
  setPerformanceOverlayVisible(false);
  syncPerformanceOverlayForActiveTab();
});
window.aivudaShell.onTogglePerformanceOverlay(() => {
  setPerformanceOverlayVisible(!performanceOverlayVisible);
  syncPerformanceOverlayForActiveTab();
});
window.aivudaShell.onToggleScreenRecordBar(() => {
  toggleScreenRecordBar();
});
window.aivudaShell.onClearBrowserData(async () => {
  await window.aivudaShell.clearBrowserData();
  window.location.reload();
});

window.addEventListener("pagehide", () => {
  writeShellState();
});

window.addEventListener("resize", () => {
  updateScreenRecordBarLayout();
});

window.setInterval(() => {
  writeShellState();
}, shellStateAutosaveIntervalMs);

window.aivudaShell.getStartup().then(startup => {
  defaultUrl = startup.defaultUrl || defaultUrl;
  storeUrl = startup.storeUrl || '';
  serviceOrigins = { os: defaultUrl, store: storeUrl, gateway: startup.gatewayUrl || '' };
  const raw = startup.savedState || {};
  const remap = url => desktopState.remapUrl(url, raw.serviceOrigins, serviceOrigins);
  for (const tab of raw.tabs || []) {
    tab.url = remap(tab.url); tab.appUrl = remap(tab.appUrl || tab.url);
    if (tab.favicon) tab.favicon = remap(tab.favicon);
  }
  for (const favorite of raw.favorites || []) {
    favorite.url = remap(favorite.url);
    if (favorite.favicon) favorite.favicon = remap(favorite.favicon);
  }
  defaultScreenRecordingsDir = typeof startup.recordingsDir === 'string' ? startup.recordingsDir : '';
  const saved = normalizeSavedShellState(startup.savedState);
  if (saved) {
    favorites = saved.favorites;
    performanceOverlayVisible = saved.performanceOverlayVisible;
    screenRecordBarVisible = saved.screenRecordBarVisible;
    screenRecordMode = saved.screenRecordMode;
    screenRecordBarPosition = saved.screenRecordBarPosition;
    const descriptors = Array.isArray(raw.windows) ? raw.windows.filter(item => item && /^window-\d+$/.test(item.id)) : [];
    if (!descriptors.length && saved.tabs.length) {
      if (Array.isArray(raw.desktops) && raw.desktops.length) {
        for (const item of raw.desktops) {
          const members = saved.tabs.filter(tab => tab.desktopId === item.id);
          if (!members.length) continue;
          const id = `window-${descriptors.length + 1}`;
          descriptors.push({ id, layout: item.layout, activeTabId: item.activeTabId, minimized: members.every(tab => tab.minimized) });
          members.forEach(tab => { tab.windowId = id; });
        }
      } else if (raw.layout) {
        descriptors.push({ id: 'window-1', layout: raw.layout, activeTabId: raw.activeTabId, maximized: true, minimized: saved.tabs.every(tab => tab.minimized) });
        saved.tabs.forEach(tab => { tab.windowId = 'window-1'; });
      }
    }
    for (const item of descriptors) createApplicationWindow(item);
    for (const tab of saved.tabs) createTab(tab.url, { ...tab, minimized: false, chromeExpanded: tab.chromeExpanded ?? saved.chromeExpanded });
    for (const item of descriptors) {
      const owner = appWindows.get(item.id);
      if (!owner.layout.panels.length) { disposeEmptyWindow(owner); continue; }
      restoreWindowLayout(owner, item.layout);
      const panel = owner.layout.getPanel(item.activeTabId);
      if (panel) panel.api.setActive();
      owner.minimized = item.minimized === true;
      owner.maximized = item.maximized === true;
      owner.region = ['left', 'right', 'top', 'bottom'].includes(item.region) ? item.region : null;
      if (Number.isFinite(item.zIndex)) owner.zIndex = Math.max(1, item.zIndex);
    }
    normalizeWindowStack();
    const selected = appWindows.get(raw.activeWindowId) || appWindows.get(tabs.get(saved.activeTabId)?.windowId) || [...appWindows.values()].find(owner => !owner.minimized);
    activeWindowId = selected?.id || null;
    desktopLayout = selected?.layout;
    activeTabId = selected && !selected.minimized ? selected.layout.activePanel?.id || null : null;
    desktopActiveTabId = raw.desktopActiveTabId || activeTabId;
    desktopVisible = raw.desktopVisible === true || !appWindows.size;
    if (desktopVisible) activeTabId = null;
  } else {
    desktopVisible = true;
  }
  syncWindowToolbar(); updateAddressFromActiveTab(); updateNavigationState();
  renderDesktop(); renderScreenRecordBar(); layoutApplicationWindows(); finishShellStateRestore();
});
