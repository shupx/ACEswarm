const appWindows = new Map();
let activeWindowId = null;
let nextWindowId = 1;
let windowZIndex = 1;
let pendingWindowId = null;
let installedApplications = [];
let windowTabDrag = null;

function getApplicationWindow(tab = getActiveTab()) { return appWindows.get(tab?.windowId || activeWindowId); }

function normalizeWindowStack() {
  const ordered = [...appWindows.values()].sort((a, b) => a.zIndex - b.zIndex);
  ordered.forEach((owner, index) => { owner.zIndex = index + 1; });
  windowZIndex = ordered.length;
}

function raiseWindow(owner) {
  if (windowZIndex >= 8000) normalizeWindowStack();
  owner.zIndex = ++windowZIndex;
}

function createApplicationWindow(options = {}) {
  const id = options.id || `window-${nextWindowId++}`;
  nextWindowId = Math.max(nextWindowId, Number(id.replace('window-', '')) + 1 || nextWindowId);
  const owner = { id, bounds: desktopState.windowBounds(options.bounds, { width: innerWidth, height: innerHeight }, appWindows.size, dockCollapsed), maximized: options.maximized === true, minimized: options.minimized === true, zIndex: 0 };
  appWindows.set(id, owner);
  raiseWindow(owner);
  const frame = document.createElement('section');
  frame.className = 'app-window'; frame.dataset.windowId = id;
  frame.setAttribute('aria-label', 'Application window');
  const titlebar = document.createElement('header'); titlebar.className = 'app-window-titlebar';
  const title = document.createElement('span'); title.className = 'app-window-title';
  titlebar.append(title);
  const buttons = [
    ['plus', 'Open tab', () => showOpenPageDialog(owner.id)],
    ['ellipsis', 'Window controls', () => openWindowMenu(tabs.get(owner.layout.activePanel?.id))],
    ['minus', 'Minimize window', () => minimizeOuterWindow(owner)],
    ['maximize-2', 'Maximize or restore window', () => toggleOuterWindowMaximized(owner)],
    ['x', 'Close window', () => closeOuterWindow(owner)],
  ];
  for (const [icon, label, action] of buttons) {
    const button = document.createElement('button'); button.className = 'icon-button'; button.title = label; button.setAttribute('aria-label', label);
    button.append(desktopIcon(icon));
    button.onpointerdown = event => event.stopPropagation();
    button.onclick = event => { event.stopPropagation(); activateWindow(owner.id); action(); };
    titlebar.append(button);
  }
  const root = document.createElement('div'); root.className = 'dock-layout';
  frame.append(titlebar, root); stackEl.append(frame);
  Object.assign(owner, { frame, root, titleElement: title, handles: [] });
  initializeWindowLayout(owner);
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = document.createElement('div'); handle.className = 'outer-resize-handle'; handle.dataset.edge = edge; handle.dataset.windowId = id;
    stackEl.append(handle); owner.handles.push(handle);
    handle.onpointerdown = event => startOuterWindowGesture(event, owner, edge);
  }
  titlebar.onpointerdown = event => { if (!event.target.closest('button')) startOuterWindowGesture(event, owner); };
  titlebar.ondblclick = event => { if (!event.target.closest('button')) toggleOuterWindowMaximized(owner); };
  frame.addEventListener('pointerdown', () => activateWindow(owner.id), true);
  installWindowTabTransfer(owner);
  refreshDesktopIcons(); layoutApplicationWindows();
  return owner;
}

function activateWindow(id) {
  const owner = appWindows.get(id);
  if (!owner) return;
  activeWindowId = id; desktopLayout = owner.layout;
  desktopVisible = false; owner.minimized = false; raiseWindow(owner);
  activeTabId = owner.layout.activePanel?.id || owner.activeTabId || null;
  desktopActiveTabId = activeTabId;
  updateActiveClasses(); updateAddressFromActiveTab(); updateNavigationState();
  syncPerformanceOverlayForActiveTab(); layoutApplicationWindows(); writeShellState();
}

function minimizeOuterWindow(owner) {
  if (!owner) return;
  owner.minimized = true;
  if (owner.id === activeWindowId) {
    const next = [...appWindows.values()].filter(item => !item.minimized && item !== owner).sort((a, b) => b.zIndex - a.zIndex)[0];
    activeWindowId = null; activeTabId = null; desktopLayout = undefined;
    if (next) activateWindow(next.id);
  }
  syncWindowToolbar(); renderDesktop(); schedulePanelLayout(); writeShellState();
}

function toggleOuterWindowMaximized(owner = getApplicationWindow()) {
  if (!owner) return;
  owner.maximized = !owner.maximized; owner.region = null;
  activateWindow(owner.id); layoutApplicationWindows(); renderDesktop(); writeShellState();
}

function setOuterWindowRegion(owner, region) {
  if (!owner) return;
  owner.region = region === 'full' ? null : region; owner.maximized = region === 'full';
  activateWindow(owner.id); layoutApplicationWindows(); renderDesktop(); writeShellState();
}

function disposeEmptyWindow(owner) {
  if (!owner || [...tabs.values()].some(tab => tab.windowId === owner.id)) return;
  layoutMutation = true;
  try { owner.events.abort(); owner.layout.dispose(); owner.frame.remove(); owner.handles.forEach(handle => handle.remove()); } finally { layoutMutation = false; }
  appWindows.delete(owner.id);
  if (activeWindowId === owner.id) {
    activeWindowId = null; activeTabId = null; desktopLayout = undefined;
    const next = [...appWindows.values()].filter(item => !item.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
    if (next) activateWindow(next.id);
  }
}

function closeOuterWindow(owner) {
  if (!owner) return;
  for (const tab of [...tabs.values()]) if (tab.windowId === owner.id) removeApplicationWindow(tab);
  renderDesktop(); writeShellState();
}

function moveTabToWindow(tab, targetId, placement = {}) {
  if (!tab) return;
  const source = appWindows.get(tab.windowId);
  const target = appWindows.get(targetId) || createApplicationWindow({ bounds: placement.bounds });
  if (source === target) return;
  detachApplicationPanel(tab);
  tab.windowId = target.id; tab.placement = placement;
  addApplicationPanel(tab);
  disposeEmptyWindow(source);
  activateTab(tab.id); renderDesktop(); writeShellState();
}

function displayedWindowBounds(owner) {
  if (owner.maximized || owner.region) return desktopState.workspaceBounds({ width: innerWidth, height: innerHeight }, dockCollapsed, owner.region || 'full');
  owner.bounds = desktopState.windowBounds(owner.bounds, { width: innerWidth, height: innerHeight }, 0, dockCollapsed);
  return owner.bounds;
}

function layoutOuterWindows() {
  Object.assign(stackEl.style, { top: '0px', left: '0px', right: '0px', bottom: '28px', width: 'auto', height: 'auto' });
  for (const owner of appWindows.values()) {
    const bounds = displayedWindowBounds(owner);
    const visible = !desktopVisible && !owner.minimized;
    owner.frame.hidden = !visible;
    owner.frame.classList.toggle('active', activeWindowId === owner.id && !desktopVisible);
    Object.assign(owner.frame.style, { left: bounds.x + 'px', top: bounds.y + 'px', width: bounds.width + 'px', height: bounds.height + 'px', zIndex: String(owner.zIndex * 10) });
    owner.layout.layout(Math.max(1, bounds.width - 2), Math.max(1, bounds.height - 30));
    const title = tabs.get(owner.layout.activePanel?.id)?.title || 'Window';
    owner.titleElement.textContent = title;
    owner.frame.setAttribute('aria-label', title);
    for (const handle of owner.handles) {
      const edge = handle.dataset.edge;
      const corner = edge.length === 2;
      handle.hidden = !visible || owner.maximized || Boolean(owner.region);
      Object.assign(handle.style, {
        left: (bounds.x + (edge.includes('e') ? bounds.width - 5 : -3)) + 'px',
        top: (bounds.y + (edge.includes('s') ? bounds.height - 5 : -3)) + 'px',
        width: (corner || edge === 'e' || edge === 'w' ? 8 : bounds.width + 6) + 'px',
        height: (corner || edge === 'n' || edge === 's' ? 8 : bounds.height + 6) + 'px',
        zIndex: String(owner.zIndex * 10 + 3), cursor: edge + '-resize',
      });
    }
  }
  schedulePanelLayout();
}

function startOuterWindowGesture(event, owner, edge = '') {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  activateWindow(owner.id);
  let start = displayedWindowBounds(owner);
  const x = event.clientX, y = event.clientY;
  let changed = false;
  const controller = new AbortController();
  stackEl.classList.add('interacting');
  const move = current => {
    const dx = current.clientX - x, dy = current.clientY - y;
    if (!changed && Math.hypot(dx, dy) < 5) return;
    if (!changed && (owner.maximized || owner.region)) {
      owner.maximized = false; owner.region = null;
      start = { ...owner.bounds, x: x - owner.bounds.width / 2, y: y - 14 };
    }
    changed = true;
    const bounds = { ...start };
    if (!edge) { bounds.x += dx; bounds.y += dy; }
    else {
      if (edge.includes('e')) bounds.width += dx;
      if (edge.includes('s')) bounds.height += dy;
      if (edge.includes('w')) { bounds.x += dx; bounds.width -= dx; }
      if (edge.includes('n')) { bounds.y += dy; bounds.height -= dy; }
      const area = desktopState.workArea({ width: innerWidth, height: innerHeight }, dockCollapsed);
      const maxWidth = edge.includes('w') ? start.x + start.width - area.x : area.x + area.width - start.x;
      const maxHeight = edge.includes('n') ? start.y + start.height - area.y : area.y + area.height - start.y;
      bounds.width = Math.max(Math.min(240, maxWidth), Math.min(maxWidth, bounds.width));
      bounds.height = Math.max(Math.min(220, maxHeight), Math.min(maxHeight, bounds.height));
      if (edge.includes('w')) bounds.x = start.x + start.width - bounds.width;
      if (edge.includes('n')) bounds.y = start.y + start.height - bounds.height;
    }
    owner.bounds = desktopState.windowBounds(bounds, { width: innerWidth, height: innerHeight }, 0, dockCollapsed);
    layoutOuterWindows();
  };
  window.addEventListener('pointermove', move, { signal: controller.signal });
  const finish = current => {
    controller.abort(); stackEl.classList.remove('interacting');
    if (changed && !edge && current.type === 'pointerup') {
      if (current.clientX <= 20) setOuterWindowRegion(owner, 'left');
      else if (current.clientX >= innerWidth - 20) setOuterWindowRegion(owner, 'right');
      else if (current.clientY <= 10) setOuterWindowRegion(owner, 'full');
    }
    layoutApplicationWindows(); renderDesktop(); writeShellState();
  };
  window.addEventListener('pointerup', finish, { signal: controller.signal });
  window.addEventListener('pointercancel', finish, { signal: controller.signal });
  window.addEventListener('blur', finish, { signal: controller.signal });
}

function renderWindowTasks(items) {
  for (const owner of appWindows.values()) {
    const tab = tabs.get(owner.layout.activePanel?.id);
    const button = document.createElement('button');
    button.className = 'dock-item window-task'; button.dataset.windowId = owner.id;
    button.title = tab?.title || 'Window'; button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(owner.id === activeWindowId && !desktopVisible));
    button.classList.toggle('active', owner.id === activeWindowId && !desktopVisible);
    button.classList.toggle('minimized', owner.minimized);
    button.append(applicationIcon({ url: tab?.appUrl || defaultUrl, favicon: tab?.favicon }));
    const label = document.createElement('span'); label.className = 'dock-label'; label.textContent = button.title;
    button.append(label); button.onclick = () => activateWindow(owner.id);
    button.oncontextmenu = event => {
      event.preventDefault(); event.stopPropagation();
      const menu = document.getElementById('dock-menu'); menu.replaceChildren();
      for (const [label, action] of [
        ['Restore window', () => activateWindow(owner.id)], ['Minimize window', () => minimizeOuterWindow(owner)],
        ['Maximize or restore window', () => toggleOuterWindowMaximized(owner)], ['Close window', () => closeOuterWindow(owner)],
        ...owner.layout.panels.map(panel => ['Switch: ' + panel.title, () => activateTab(panel.id)]),
      ]) {
        const item = document.createElement('button'); item.role = 'menuitem'; item.textContent = label;
        item.onclick = () => { menu.hidden = true; action(); }; menu.append(item);
      }
      setToolsMenuOpen(false); setWindowMenuOpen(false);
      menu.hidden = false;
      menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.top = Math.max(8, innerHeight - 28 - menu.offsetHeight - 5) + 'px';
    };
    items.append(button);
  }
}

function installWindowTabTransfer(owner) {
  owner.root.addEventListener('pointerdown', event => {
    const header = event.target.closest('[data-tab-panel-id]');
    if (event.button !== 0 || !header || event.target.closest('button, .dv-default-tab-action')) return;
    windowTabDrag = { id: header.dataset.tabPanelId, source: owner.id, x: event.clientX, y: event.clientY, handled: false };
  }, true);
}

function tabDropTarget(x, y) {
  const node = document.elementsFromPoint(x, y).map(element => element.closest('.window-task, .app-window')).find(Boolean);
  const owner = node && appWindows.get(node.dataset.windowId);
  if (!owner) return {};
  const group = owner.layout.groups.find(item => {
    const rect = item.element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }) || owner.layout.activePanel?.group;
  let direction = 'within';
  let bounds;
  if (group && node.classList.contains('app-window')) {
    const rect = group.element.getBoundingClientRect();
    if (y > rect.top + 28) {
      const edges = [['left', x - rect.left, rect.width], ['right', rect.right - x, rect.width], ['above', y - rect.top, rect.height], ['below', rect.bottom - y, rect.height]];
      const nearest = edges.sort((a, b) => a[1] / a[2] - b[1] / b[2])[0];
      if (nearest[1] < Math.min(70, nearest[2] * .25)) direction = nearest[0];
    }
    bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (direction === 'left' || direction === 'right') { bounds.width /= 2; if (direction === 'right') bounds.x += bounds.width; }
    if (direction === 'above' || direction === 'below') { bounds.height /= 2; if (direction === 'below') bounds.y += bounds.height; }
  }
  return { owner, placement: { reference: group?.activePanel?.id, direction }, bounds };
}

const tabTransferPreview = document.createElement('div');
tabTransferPreview.id = 'tab-transfer-preview'; tabTransferPreview.hidden = true; document.getElementById('shell').append(tabTransferPreview);
window.addEventListener('pointermove', event => {
  const drag = windowTabDrag;
  if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
  const target = tabDropTarget(event.clientX, event.clientY);
  tabTransferPreview.hidden = !target.bounds || target.owner?.id === drag.source;
  if (!tabTransferPreview.hidden) Object.assign(tabTransferPreview.style, { left: target.bounds.x + 'px', top: target.bounds.y + 'px', width: target.bounds.width + 'px', height: target.bounds.height + 'px' });
});

window.addEventListener('pointerup', event => {
  const drag = windowTabDrag;
  windowTabDrag = null;
  tabTransferPreview.hidden = true;
  if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
  const drop = tabDropTarget(event.clientX, event.clientY);
  const target = drop.owner;
  const background = !target && event.clientY < innerHeight - 28 && !document.elementFromPoint(event.clientX, event.clientY)?.closest('.desktop-bar, .window-menu, .dock-menu');
  if (background) drop.placement = { bounds: { x: event.clientX - 120, y: event.clientY - 14 } };
  if (target?.id === drag.source || drag.handled) return;
  if (target || background) requestAnimationFrame(() => {
    if (!drag.handled) moveTabToWindow(tabs.get(drag.id), target?.id, drop.placement);
    stackEl.classList.remove('interacting');
  });
}, true);
for (const event of ['pointercancel', 'blur']) window.addEventListener(event, () => { windowTabDrag = null; tabTransferPreview.hidden = true; });

function renderApplicationsMenu() {
  const menu = document.getElementById('applications-menu');
  const signature = JSON.stringify([installedApplications, favorites, defaultUrl, storeUrl]);
  if (menu.dataset.signature === signature) return;
  menu.dataset.signature = signature;
  const expanded = document.getElementById('all-applications')?.open || false;
  menu.replaceChildren();
  const all = document.createElement('details'); all.id = 'all-applications'; all.open = expanded;
  const summary = document.createElement('summary'); summary.textContent = 'All'; all.append(summary);
  const launch = (entry, favorite) => {
    const row = document.createElement('div'); row.className = 'application-menu-row';
    const open = document.createElement('button'); open.role = 'menuitem'; open.dataset.appUrl = entry.url;
    open.append(applicationIcon(entry), document.createTextNode(entry.title));
    open.onclick = () => { menu.hidden = true; document.getElementById('applications-button').setAttribute('aria-expanded', 'false'); openApplication(entry.url); };
    row.append(open);
    open.oncontextmenu = event => openDockMenu(event, { ...entry, key: desktopState.appKey(entry.url), pinned: favorite, windows: [...tabs.values()].filter(tab => desktopState.appKey(tab.appUrl) === desktopState.appKey(entry.url)) });
    if (!entry.builtin) {
      const action = document.createElement('button'); action.className = 'icon-button';
      action.title = favorite ? 'Remove from favorites' : 'Add to favorites'; action.setAttribute('aria-label', action.title);
      action.append(desktopIcon(favorite ? 'x' : 'star'));
      action.onclick = () => { if (favorite) { favorites = favorites.filter(item => desktopState.appKey(item.url) !== desktopState.appKey(entry.url)); renderDesktop(); writeShellState(); } else pinApplication(entry); };
      row.append(action);
    }
    return row;
  };
  for (const entry of installedApplications) all.append(launch(entry, false));
  if (!installedApplications.length) {
    const message = document.createElement('span'); message.className = 'menu-section-label';
    message.textContent = 'No installed app UIs'; all.append(message);
  }
  menu.append(all, document.createElement('hr'));
  const label = document.createElement('span'); label.className = 'menu-section-label'; label.textContent = 'Favorite apps'; menu.append(label);
  for (const entry of applicationEntries().filter(entry => entry.pinned)) menu.append(launch(entry, true));
}

document.getElementById('applications-button').onclick = async event => {
  event.stopPropagation();
  const menu = document.getElementById('applications-menu');
  const open = menu.hidden;
  setToolsMenuOpen(false); setWindowMenuOpen(false);
  menu.hidden = !open;
  document.getElementById('applications-button').setAttribute('aria-expanded', String(open));
  if (!open) return;
  renderApplicationsMenu(); refreshDesktopIcons();
  try {
    installedApplications = await window.aivudaShell.getInstalledApplications();
    renderApplicationsMenu(); refreshDesktopIcons();
  } catch (error) {
    const message = document.createElement('span'); message.className = 'menu-section-label'; message.textContent = 'Could not load applications. Open Console to check the local service.';
    document.getElementById('all-applications').append(message);
    console.warn('Could not load applications:', error);
  }
};
document.getElementById('applications-menu').onclick = event => event.stopPropagation();
document.addEventListener('click', () => { document.getElementById('applications-menu').hidden = true; document.getElementById('applications-button').setAttribute('aria-expanded', 'false'); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.getElementById('applications-menu').hidden = true; document.getElementById('applications-button').setAttribute('aria-expanded', 'false'); } });
