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
  holder.append(desktopIcon(builtin === "home" ? "house" : builtin === "store" ? "shopping-bag" : "globe"));
  if (entry.favicon) {
    const image = document.createElement("img");
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.src = entry.favicon;
    image.onload = () => holder.replaceChildren(image);
  }
  return holder;
}

function applicationEntries() {
  const entries = new Map();
  for (const entry of [{ url: defaultUrl, title: "Home", builtin: true }, { url: storeUrl, title: "AppStore", builtin: true }, ...favorites]) {
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
  const key = desktopState.appKey(url);
  const matches = [...tabs.values()].filter((tab) => desktopState.appKey(tab.appUrl) === key);
  const tab = matches.find((tab) => tab.id === activeTabId) || matches.at(-1);
  if (tab) activateTab(tab.id);
  else createTab(url);
}

function pinApplication(entry) {
  if (!favorites.some((favorite) => desktopState.appKey(favorite.url) === desktopState.appKey(entry.url))) {
    favorites.push({ url: entry.url, title: entry.title, favicon: entry.favicon || "" });
  }
  renderDesktop();
  writeShellState();
}

function minimizeApplicationWindow(tab) {
  if (!tab?.window || tab.minimized) return;
  tab.minimized = true;
  tab.window.hide();
  if (activeTabId === tab.id) {
    tab.window.blur();
    activeTabId = null;
    const next = [...tabs.values()].reverse().find((other) => !other.minimized);
    if (next) activateTab(next.id);
    else { updateAddressFromActiveTab(); updateNavigationState(); }
  }
  renderDesktop();
  writeShellState();
}

function showDesktop() {
  for (const tab of tabs.values()) { tab.minimized = true; tab.window.hide(); tab.window.blur(); }
  activeTabId = null;
  syncWindowToolbar();
  updateAddressFromActiveTab();
  updateNavigationState();
  renderDesktop();
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
  command(entry.windows.length ? "Activate" : "Open", () => openApplication(entry.url));
  command("New window", () => createTab(entry.url));
  if (!entry.builtin) {
    command(entry.pinned ? "Unpin from Dock" : "Pin to Dock", () => {
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
  menu.style.top = Math.max(52, Math.min(event.clientY - menu.offsetHeight, innerHeight - menu.offsetHeight - 8)) + "px";
  menu.querySelector("button")?.focus();
}

function renderDesktop() {
  shellEl.classList.toggle("dock-collapsed", dockCollapsed);
  shellEl.classList.toggle("window-maximized", [...tabs.values()].some((tab) => tab.window?.max && !tab.minimized));
  const dock = document.getElementById("dock");
  const shortcuts = document.getElementById("desktop-shortcuts");
  dock.replaceChildren();
  shortcuts.replaceChildren();
  const toggle = document.createElement("button");
  toggle.id = "toggle-dock";
  toggle.className = "dock-toggle";
  toggle.title = dockCollapsed ? "Expand Dock" : "Collapse Dock";
  toggle.setAttribute("aria-label", toggle.title);
  toggle.setAttribute("aria-expanded", String(!dockCollapsed));
  toggle.append(desktopIcon(dockCollapsed ? "chevron-right" : "chevron-left"));
  toggle.onclick = () => { dockCollapsed = !dockCollapsed; layoutApplicationWindows(); renderDesktop(); writeShellState(); };
  dock.append(toggle);
  const desktop = document.createElement("button");
  desktop.className = "dock-item";
  desktop.title = "Show desktop";
  desktop.setAttribute("aria-label", "Show desktop");
  desktop.append(desktopIcon("panels-top-left"));
  desktop.onclick = showDesktop;
  dock.append(desktop);
  const divider = document.createElement("span");
  divider.className = "dock-divider";
  dock.append(divider);
  const items = document.createElement("div");
  items.className = "dock-items";
  dock.append(items);
  for (const entry of applicationEntries()) {
    const button = document.createElement("button");
    button.className = "dock-item";
    button.dataset.appUrl = entry.url;
    button.title = entry.title + (entry.windows.length ? " (" + entry.windows.length + " windows)" : "");
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(entry.windows.some((tab) => tab.id === activeTabId)));
    button.classList.toggle("active", entry.windows.some((tab) => tab.id === activeTabId));
    button.classList.toggle("minimized", entry.windows.length > 0 && entry.windows.every((tab) => tab.minimized));
    button.append(applicationIcon(entry));
    if (entry.windows.length) {
      const dot = document.createElement("span"); dot.className = "running-dot"; button.append(dot);
      if (entry.windows.length > 1) {
        const badge = document.createElement("span"); badge.className = "window-badge"; badge.textContent = entry.windows.length; button.append(badge);
      }
    }
    button.onclick = () => openApplication(entry.url);
    button.oncontextmenu = (event) => openDockMenu(event, entry);
    items.append(button);
    if (entry.pinned) {
      const shortcut = document.createElement("button");
      shortcut.className = "desktop-shortcut";
      shortcut.title = entry.title;
      shortcut.append(applicationIcon(entry));
      const label = document.createElement("span"); label.className = "shortcut-label"; label.textContent = entry.title; shortcut.append(label);
      shortcut.onclick = () => openApplication(entry.url);
      shortcut.oncontextmenu = (event) => openDockMenu(event, entry);
      shortcuts.append(shortcut);
    }
  }
  const utilities = document.createElement("div");
  utilities.className = "dock-utilities";
  for (const [icon, title, action] of [["plus", "Open page", showOpenPageDialog], ["video", "Screen Record", showScreenRecordBar]]) {
    const button = document.createElement("button");
    button.className = "dock-item";
    button.title = title; button.setAttribute("aria-label", title);
    button.append(desktopIcon(icon)); button.onclick = action; utilities.append(button);
  }
  dock.append(utilities);
  document.getElementById("window-count").textContent = tabs.size ? tabs.size + (tabs.size === 1 ? " window" : " windows") : "Desktop";
  refreshDesktopIcons();
}

function mountApplicationWindow(tab, options) {
  const viewport = { width: innerWidth, height: innerHeight };
  const bounds = desktopState.windowBounds(options.bounds, viewport, tabs.size - 1, dockCollapsed);
  const area = desktopState.workArea(viewport, dockCollapsed);
  const win = new WinBox({
    id: tab.id, title: tab.title, root: stackEl, ...bounds,
    top: 48, bottom: 8, left: area.x, right: 8, minwidth: Math.min(240, area.width), minheight: 220,
    header: 36, class: ["no-full", "no-animation"],
  });
  tab.window = win;
  tab.chromeExpanded = options.chromeExpanded === true;
  tab.minimized = false;
  win.body.append(tab.webview);
  win.onfocus = () => {
    if (tab.minimized) return;
    activeTabId = tab.id;
    updateActiveClasses();
    updateAddressFromActiveTab();
    updateNavigationState();
    syncPerformanceOverlayForActiveTab();
    writeShellState();
  };
  win.onclose = () => { removeApplicationWindow(tab); return false; };
  win.onmove = win.onresize = () => writeShellState();
  win.onmaximize = win.onrestore = () => { layoutApplicationWindows(); renderDesktop(); writeShellState(); };
  win.addControl({ class: "wb-browser", click: () => { activateTab(tab.id); setChromeExpanded(!tab.chromeExpanded); } });
  win.addControl({ class: "wb-pin", click: () => pinApplication({ url: tab.appUrl, title: tab.title, favicon: tab.favicon }) });
  // Replace WinBox's taskbar minimizer: our Dock hides the full window intact.
  const builtinMinimize = win.window.querySelector(".wb-min");
  builtinMinimize.replaceWith(builtinMinimize.cloneNode(true));
  const controls = { "wb-browser": ["globe", "Address bar"], "wb-pin": ["pin", "Pin to Dock"], "wb-min": ["minus", "Minimize"], "wb-max": ["maximize-2", "Maximize or restore"], "wb-close": ["x", "Close"] };
  for (const [className, [icon, title]] of Object.entries(controls)) {
    const node = win.window.querySelector("." + className);
    node.replaceChildren(desktopIcon(icon));
    node.title = title; node.setAttribute("role", "button"); node.setAttribute("aria-label", title); node.tabIndex = 0;
    node.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); node.click(); } };
  }
  win.window.querySelector(".wb-min").onclick = (event) => { event.stopPropagation(); minimizeApplicationWindow(tab); };
  win.window.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".wb-body")) {
      stackEl.classList.add("interacting");
      setToolsMenuOpen(false);
      document.getElementById("dock-menu").hidden = true;
    }
    activateTab(tab.id);
  }, true);
  tab.webview.addEventListener("focus", () => activateTab(tab.id));
  if (options.maximized) win.maximize();
  refreshDesktopIcons();
}

function removeApplicationWindow(tab) {
  tab.ready = false;
  const toolbar = document.getElementById("browser-toolbar");
  if (tab.window.body.contains(toolbar)) { toolbar.hidden = true; document.body.append(toolbar); }
  tab.webview.remove();
  tabs.delete(tab.id);
  if (activeTabId === tab.id) {
    activeTabId = null;
    const next = [...tabs.values()].reverse().find((other) => !other.minimized);
    if (next) activateTab(next.id);
  }
  updateAddressFromActiveTab(); updateNavigationState(); renderDesktop(); writeShellState();
}

function syncWindowToolbar() {
  const toolbar = document.getElementById("browser-toolbar");
  const tab = getActiveTab();
  if (tab?.window) {
    if (toolbar.parentElement !== tab.window.body) tab.window.body.prepend(toolbar);
    toolbar.hidden = !tab.chromeExpanded;
    shellEl.classList.toggle("expanded", tab.chromeExpanded);
  } else {
    toolbar.hidden = true;
    document.body.append(toolbar);
    shellEl.classList.remove("expanded");
  }
}

function showOpenPageDialog() {
  const dialog = document.getElementById("open-page-dialog");
  document.getElementById("open-page-error").hidden = true;
  dialog.showModal();
  document.getElementById("open-page-url").focus();
}

document.getElementById("show-desktop").onclick = showDesktop;
document.getElementById("close-page-dialog").onclick = () => document.getElementById("open-page-dialog").close();
for (const [id, target] of [["open-home", () => defaultUrl], ["open-store", () => storeUrl || defaultUrl]]) {
  document.getElementById(id).onclick = () => { document.getElementById("open-page-dialog").close(); openApplication(target()); };
}
document.getElementById("open-page-form").onsubmit = async (event) => {
  event.preventDefault();
  const url = normalizeUrlInput(document.getElementById("open-page-url").value);
  try {
    if (!/^https?:/.test(url)) throw new Error("Use an HTTP or HTTPS address.");
    const result = await window.aivudaShell.authorizeUrl(url);
    if (!result.ok) throw new Error(result.error);
    document.getElementById("open-page-dialog").close();
    openApplication(url);
  } catch (error) {
    const message = document.getElementById("open-page-error");
    message.textContent = error.message; message.hidden = false;
  }
};
document.addEventListener("click", () => { document.getElementById("dock-menu").hidden = true; });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") document.getElementById("dock-menu").hidden = true; });
for (const event of ["pointerup", "pointercancel", "blur"]) window.addEventListener(event, () => stackEl.classList.remove("interacting"));
function updateDesktopClock() {
  document.getElementById("desktop-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
updateDesktopClock();
setInterval(updateDesktopClock, 30000);

function layoutApplicationWindows() {
  const viewport = { width: innerWidth, height: innerHeight };
  for (const tab of tabs.values()) {
    const win = tab.window;
    const area = desktopState.workArea(viewport, dockCollapsed, win.max);
    win.top = area.y; win.left = area.x;
    win.right = win.max ? 0 : 8; win.bottom = win.max ? 0 : 8;
    if (win.max) {
      win.resize(area.width, area.height, true).move(area.x, area.y, true);
    } else {
      const bounds = desktopState.windowBounds(win, viewport, 0, dockCollapsed);
      win.resize(bounds.width, bounds.height).move(bounds.x, bounds.y);
    }
  }
}
window.addEventListener("resize", () => requestAnimationFrame(layoutApplicationWindows));
