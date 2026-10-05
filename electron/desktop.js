function desktopIcon(name) {
  const node = document.createElement("i");
  node.dataset.lucide = name;
  return node;
}

function refreshDesktopIcons() {
  lucide.createIcons({ attrs: { "stroke-width": 1.7 } });
  // Keep existing button SVG nodes stable during pointerdown/focus updates.
  for (const svg of document.querySelectorAll("svg[data-lucide]")) svg.removeAttribute("data-lucide");
}

function applicationIcon(entry) {
  const holder = document.createElement("span");
  holder.className = "app-icon";
  const key = desktopState.appKey(entry.url);
  const builtin = key === desktopState.appKey(defaultUrl) ? "home" : key === desktopState.appKey(storeUrl) ? "store" : "";
  if (builtin) holder.classList.add(builtin);
  holder.append(desktopIcon(builtin === "home" ? "layout-grid" : builtin === "store" ? "package-plus" : "globe"));
  const icons = [];
  try {
    const url = new URL(entry.url);
    const app = url.pathname.match(/^\/([^/]+)\/ui(?:\/|$)/);
    if (app) icons.push(new URL('/aivuda_os/api/apps/' + encodeURIComponent(decodeURIComponent(app[1])) + '/icon', url).href);
  } catch (_) {}
  if (entry.favicon) icons.push(entry.favicon);
  if (icons.length) {
    const image = document.createElement("img");
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.onload = () => holder.replaceChildren(image);
    image.onerror = () => {
      if (icons.length) image.src = icons.shift();
      else { holder.replaceChildren(desktopIcon(builtin === "home" ? "layout-grid" : builtin === "store" ? "package-plus" : "globe")); refreshDesktopIcons(); }
    };
    image.src = icons.shift();
  }
  return holder;
}

function applicationEntries() {
  const entries = new Map();
  for (const entry of [{ url: defaultUrl, title: "Console", builtin: true }, { url: storeUrl, title: "AppStore Admin", builtin: true }, ...favorites]) {
    if (!entry.url) continue;
    const key = desktopState.appKey(entry.url);
    if (!entries.has(key)) entries.set(key, { ...entry, title: entry.title || getSiteNameFromUrl(entry.url), key, pinned: true, windows: [] });
  }
  for (const tab of tabs.values()) {
    const key = desktopState.appKey(tab.appUrl);
    if (!entries.has(key)) entries.set(key, { key, url: tab.appUrl, title: tab.title, favicon: tab.favicon, windows: [] });
    const entry = entries.get(key);
    entry.windows.push(tab);
    entry.favicon ||= tab.favicon;
  }
  return [...entries.values()];
}

function openApplication(url) {
  createTab(url, { windowId: activeWindowId });
}

function pinApplication(entry) {
  if (!favorites.some((favorite) => desktopState.appKey(favorite.url) === desktopState.appKey(entry.url))) {
    favorites.push({ url: entry.url, title: entry.title, favicon: entry.favicon || "" });
  }
  renderDesktop();
  writeShellState();
}

function minimizeApplicationWindow(tab) {
  minimizeOuterWindow(getApplicationWindow(tab));
}

function showDesktop() {
  if (desktopVisible) {
    desktopVisible = false;
    const previous = appWindows.get(activeWindowId);
    const owner = previous && !previous.minimized ? previous : [...appWindows.values()].filter(item => !item.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
    if (owner) activateWindow(owner.id);
    else { renderDesktop(); schedulePanelLayout(); writeShellState(); }
    return;
  }
  desktopActiveTabId = desktopLayout?.activePanel?.id || activeTabId || desktopActiveTabId;
  desktopVisible = true;
  activeTabId = null;
  syncWindowToolbar();
  updateAddressFromActiveTab();
  updateNavigationState();
  renderDesktop();
  schedulePanelLayout();
  writeShellState();
}

function openDockMenu(event, entry) {
  event.preventDefault();
  event.stopPropagation();
  const menu = document.getElementById("dock-menu");
  menu.replaceChildren();
  const command = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = label;
    button.onclick = () => { menu.hidden = true; action(); };
    menu.append(button);
  };
  command(entry.windows.length ? "Activate" : "Open", () => entry.windows.length ? activateTab(entry.windows.at(-1).id) : openApplication(entry.url));
  command("New window", () => createTab(entry.url));
  if (!entry.builtin) {
    command(entry.pinned ? "Remove from Favorites" : "Add to Favorites", () => {
      if (entry.pinned) {
        favorites = favorites.filter((favorite) => desktopState.appKey(favorite.url) !== entry.key);
        renderDesktop(); writeShellState();
      } else pinApplication(entry);
    });
  }
  if (entry.pinned && !entry.builtin) {
    const index = favorites.findIndex((favorite) => desktopState.appKey(favorite.url) === entry.key);
    for (const [label, offset] of [["Move left", -1], ["Move right", 1]]) {
      if (index + offset >= 0 && index + offset < favorites.length) command(label, () => {
        [favorites[index], favorites[index + offset]] = [favorites[index + offset], favorites[index]];
        renderDesktop(); writeShellState();
      });
    }
  }
  if (entry.windows.length) {
    menu.append(document.createElement("hr"));
    for (const tab of entry.windows) command((tab.minimized ? "Restore: " : "Switch: ") + tab.title, () => activateTab(tab.id));
    command("Minimize all", () => entry.windows.forEach(minimizeApplicationWindow));
    command("Close all", () => entry.windows.forEach((tab) => closeTab(tab.id)));
  }
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + "px";
  setToolsMenuOpen(false);
  setWindowMenuOpen(false);
  menu.style.top = Math.max(8, Math.min(event.clientY - menu.offsetHeight - 8, innerHeight - 28 - menu.offsetHeight - 5)) + "px";
  menu.querySelector("button")?.focus();
}

function renderDesktop() {
  shellEl.classList.toggle("dock-collapsed", dockCollapsed);
  shellEl.classList.toggle('showing-desktop', desktopVisible);
  const dock = document.getElementById("dock");
  const scrollLeft = dock.querySelector(".dock-items")?.scrollLeft || 0;
  const shortcuts = document.getElementById("desktop-shortcuts");
  dock.replaceChildren();
  shortcuts.replaceChildren();
  const launcher = document.createElement('button');
  launcher.id = 'desktop-applications'; launcher.className = 'desktop-shortcut'; launcher.title = 'Applications';
  const launcherIcon = document.createElement('span'); launcherIcon.className = 'app-icon'; launcherIcon.append(desktopIcon('layout-grid'));
  const launcherLabel = document.createElement('span'); launcherLabel.className = 'shortcut-label'; launcherLabel.textContent = 'Applications';
  launcher.append(launcherIcon, launcherLabel); launcher.onclick = openApplicationLauncher; shortcuts.append(launcher);
  const items = document.createElement("div");
  items.className = "dock-items";
  dock.append(items);
  renderWindowTasks(items);
  for (const entry of applicationEntries()) {
    if (entry.pinned) {
      const shortcut = document.createElement("button");
      shortcut.className = "desktop-shortcut";
      shortcut.dataset.appUrl = entry.url;
      shortcut.title = entry.title;
      shortcut.append(applicationIcon(entry));
      const label = document.createElement("span"); label.className = "shortcut-label"; label.textContent = entry.title; shortcut.append(label);
      shortcut.onclick = () => openApplication(entry.url);
      shortcut.oncontextmenu = (event) => openDockMenu(event, entry);
      shortcuts.append(shortcut);
    }
  }
  items.scrollLeft = scrollLeft;
  items.addEventListener("wheel", (event) => {
    if (items.scrollWidth > items.clientWidth && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      items.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  }, { passive: false });
  const windowCount = appWindows.size;
  document.getElementById("window-count").textContent = windowCount ? windowCount + (windowCount === 1 ? " window" : " windows") : "Desktop";
  renderApplicationsMenu();
  layoutOuterWindows();
  refreshDesktopIcons();
}

function mountApplicationWindow(tab, options) {
  const owner = appWindows.get(options.windowId) || createApplicationWindow({ bounds: options.bounds, maximized: options.maximized, minimized: options.minimized });
  tab.windowId = owner.id;
  tab.chromeExpanded = options.chromeExpanded === true;
  tab.minimized = false;
  tab.placement = options.placement;
  tab.body = document.createElement('div');
  tab.body.id = tab.id;
  tab.body.className = 'application-body';
  tab.body.hidden = true;
  tab.body.append(tab.webview);
  stackEl.append(tab.body);
  addApplicationPanel(tab, options);
  tab.webview.addEventListener("focus", () => {
    if (!desktopVisible && !appWindows.get(tab.windowId)?.minimized && tab.panel?.api.isVisible) activateTab(tab.id);
  });
  refreshDesktopIcons();
}

function removeApplicationWindow(tab) {
  if (document.getElementById("window-menu").dataset.windowId === tab.id) setWindowMenuOpen(false);
  tab.ready = false;
  const toolbar = document.getElementById("browser-toolbar");
  if (tab.body.contains(toolbar)) { toolbar.hidden = true; document.body.append(toolbar); }
  detachApplicationPanel(tab);
  tab.webview.remove();
  tab.body.remove();
  tabs.delete(tab.id);
  const owner = appWindows.get(tab.windowId);
  if (owner?.activeTabId === tab.id) owner.activeTabId = owner.layout?.activePanel?.id || null;
  if (activeTabId === tab.id) {
    activeTabId = owner?.layout.activePanel?.id || null;
  }
  disposeEmptyWindow(owner);
  if (activeTabId) activateTab(activeTabId);
  updateAddressFromActiveTab(); updateNavigationState(); renderDesktop(); writeShellState();
}

function setWindowMenuOpen(isOpen) {
  const menu = document.getElementById("window-menu");
  menu.hidden = !isOpen;
  const tab = tabs.get(menu.dataset.windowId);
  tab?.panel?.group.element.querySelector(".panel-menu")?.setAttribute("aria-expanded", String(isOpen));
}

function updateWindowZoom() {
  const menu = document.getElementById("window-menu");
  const tab = tabs.get(menu.dataset.windowId);
  let zoom = 1;
  try { zoom = tab?.webview.getZoomFactor() || 1; } catch (_) {}
  document.getElementById("window-zoom-reset").textContent = Math.round(zoom * 100) + "%";
  document.getElementById("window-zoom-out").disabled = zoom <= minZoomFactor;
  document.getElementById("window-zoom-in").disabled = zoom >= maxZoomFactor;
}

function openWindowMenu(tab) {
  if (!tab) return;
  const menu = document.getElementById("window-menu");
  if (!menu.hidden && menu.dataset.windowId === tab.id) { setWindowMenuOpen(false); return; }
  setToolsMenuOpen(false);
  document.getElementById("dock-menu").hidden = true;
  document.getElementById('applications-menu').hidden = true;
  document.getElementById('applications-button').setAttribute('aria-expanded', 'false');
  activateTab(tab.id);
  menu.dataset.windowId = tab.id;
  setWindowMenuOpen(true);
  updateWindowZoom();
  const select = document.getElementById('window-target');
  select.replaceChildren();
  for (const owner of appWindows.values()) {
    const option = new Option(tabs.get(owner.layout.activePanel?.id)?.title || 'Window', owner.id); option.selected = owner.id === tab.windowId; select.append(option);
  }
  select.append(new Option('New window…', 'new'));
  select.onchange = () => { const id = select.value; setWindowMenuOpen(false); moveTabToWindow(tab, id === 'new' ? undefined : id); };
  const rect = tab.panel.group.element.querySelector(".panel-menu").getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - 28 - menu.offsetHeight - 5)) + "px";
  menu.querySelector("button:not(:disabled)")?.focus();
}

function toggleActiveDevtools() {
  const tab = getActiveTab();
  if (tab) tab.webview.isDevToolsOpened() ? tab.webview.closeDevTools() : tab.webview.openDevTools();
}

function toggleActiveAddressBar() {
  const tab = getActiveTab();
  if (!tab) { showOpenPageDialog(); return; }
  setChromeExpanded(!tab.chromeExpanded);
  if (tab.chromeExpanded) { addressInput.focus(); addressInput.select(); }
}

function syncWindowToolbar() {
  const toolbar = document.getElementById("browser-toolbar");
  const tab = getActiveTab();
  if (tab?.panel) {
    if (toolbar.parentElement !== tab.body) tab.body.prepend(toolbar);
    toolbar.hidden = !tab.chromeExpanded;
    shellEl.classList.toggle("expanded", tab.chromeExpanded);
  } else {
    toolbar.hidden = true;
    document.body.append(toolbar);
    shellEl.classList.remove("expanded");
  }
}

function showOpenPageDialog(windowId = activeWindowId) {
  pendingWindowId = typeof windowId === 'string' ? windowId : activeWindowId;
  const dialog = document.getElementById("open-page-dialog");
  document.getElementById("open-page-error").hidden = true;
  dialog.showModal();
  document.getElementById("open-page-url").focus();
}

document.getElementById("show-desktop").onclick = showDesktop;
document.getElementById("close-page-dialog").onclick = () => document.getElementById("open-page-dialog").close();
for (const [id, target] of [["open-home", () => defaultUrl], ["open-store", () => storeUrl || defaultUrl]]) {
  document.getElementById(id).onclick = () => {
    document.getElementById("open-page-dialog").close();
    createTab(target(), { windowId: pendingWindowId }); pendingWindowId = null;
  };
}
document.getElementById("open-page-form").onsubmit = async (event) => {
  event.preventDefault();
  const url = normalizeUrlInput(document.getElementById("open-page-url").value);
  try {
    if (!/^https?:/.test(url)) throw new Error("Use an HTTP or HTTPS address.");
    const result = await window.aivudaShell.authorizeUrl(url);
    if (!result.ok) throw new Error(result.error);
    document.getElementById("open-page-dialog").close();
    createTab(url, { windowId: pendingWindowId });
    pendingWindowId = null;
  } catch (error) {
    const message = document.getElementById("open-page-error");
    message.textContent = error.message; message.hidden = false;
  }
};
document.addEventListener("click", () => { document.getElementById("dock-menu").hidden = true; });
document.getElementById("window-menu").addEventListener("click", (event) => event.stopPropagation());
document.getElementById('window-menu').addEventListener('pointerdown', event => event.stopPropagation());
document.getElementById('tab-close').onclick = () => { const id = document.getElementById('window-menu').dataset.windowId; setWindowMenuOpen(false); closeTab(id); };
document.getElementById("window-zoom-in").onclick = () => { adjustActiveTabZoom(zoomStep); updateWindowZoom(); };
document.getElementById("window-zoom-out").onclick = () => { adjustActiveTabZoom(-zoomStep); updateWindowZoom(); };
document.getElementById("window-zoom-reset").onclick = () => { resetActiveTabZoom(); updateWindowZoom(); };
for (const region of ['left', 'right', 'top', 'bottom', 'full']) {
  document.getElementById('workspace-' + region).onclick = () => { setWindowMenuOpen(false); setWorkspaceRegion(region); };
}
for (const [id, action] of [["window-reload", () => reloadActiveTab()], ["window-address", toggleActiveAddressBar], ["window-devtools", toggleActiveDevtools],
  ["window-pin", tab => pinApplication({ url: tab.appUrl, title: tab.title, favicon: tab.favicon })], ["window-float", tab => floatOrDockPanel(tab)],
  ["window-max", togglePanelMaximized], ["window-min", tab => minimizeApplicationWindow(tab)], ["window-close", tab => closeOuterWindow(getApplicationWindow(tab))]]) {
  document.getElementById(id).onclick = () => { const tab = tabs.get(document.getElementById('window-menu').dataset.windowId); setWindowMenuOpen(false); if (tab) action(tab); };
}
document.addEventListener("click", (event) => { if (!event.target.closest(".panel-menu")) setWindowMenuOpen(false); });
document.addEventListener("keydown", (event) => {
  const menus = [document.getElementById('background-app-menu'), document.getElementById("tools-menu"), document.getElementById("dock-menu"), document.getElementById("window-menu"), document.getElementById('applications-menu')];
  const menu = menus.find((entry) => !entry.hidden);
  if (!menu) {
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) setChromeExpanded(false);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (menu.id === 'background-app-menu') closeBackgroundAppMenu(true);
    else if (menu.id === "tools-menu") { setToolsMenuOpen(false); toolsButton.focus(); }
    else if (menu.id === "window-menu") {
      setWindowMenuOpen(false);
      tabs.get(menu.dataset.windowId)?.panel?.group.element.querySelector(".panel-menu")?.focus();
    } else menu.hidden = true;
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const items = [...menu.querySelectorAll("button:not(:disabled), summary")].filter(item => item.getClientRects().length);
    const index = items.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }
});
for (const event of ["pointerup", "pointercancel", "blur"]) window.addEventListener(event, () => stackEl.classList.remove("interacting"));
function updateDesktopClock() {
  document.getElementById("desktop-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
updateDesktopClock();
setInterval(updateDesktopClock, 30000);

function layoutApplicationWindows() {
  layoutOuterWindows();
}
window.addEventListener("DOMContentLoaded", () => {
  window.addEventListener("resize", () => requestAnimationFrame(layoutApplicationWindows));
});
