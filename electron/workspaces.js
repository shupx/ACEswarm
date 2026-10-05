const desktops = new Map();
let currentDesktopId = 'desktop-1';
let nextDesktopId = 2;
let installedApplications = [];

function currentDesktop() { return desktops.get(currentDesktopId); }

function captureDesktop() {
  const desktop = currentDesktop();
  if (!desktop) return;
  Object.assign(desktop, { activeTabId, desktopVisible, desktopActiveTabId, workspaceRegion, workspaceMaximizeRestore });
}

function switchDesktop(id) {
  if (!desktops.has(id)) return;
  captureDesktop();
  setWindowMenuOpen(false);
  setToolsMenuOpen(false);
  document.getElementById('applications-menu').hidden = true;
  document.getElementById('applications-button').setAttribute('aria-expanded', 'false');
  const previous = currentDesktop();
  if (previous?.root) { previous.root.removeAttribute('id'); previous.root.hidden = true; }
  currentDesktopId = id;
  const desktop = currentDesktop();
  desktopLayout = desktop.layout;
  if (!desktopLayout) initializeDesktopLayout();
  desktop.root.id = 'dock-layout';
  desktop.root.hidden = false;
  activeTabId = desktop.activeTabId || null;
  desktopVisible = desktop.desktopVisible !== false;
  desktopActiveTabId = desktop.desktopActiveTabId || null;
  workspaceRegion = desktop.workspaceRegion || 'full';
  workspaceMaximizeRestore = desktop.workspaceMaximizeRestore || 'full';
  layoutApplicationWindows();
  updateActiveClasses(); updateAddressFromActiveTab(); updateNavigationState();
  syncPerformanceOverlayForActiveTab(); renderDesktop(); schedulePanelLayout(); writeShellState();
}

function addDesktop(title) {
  const id = `desktop-${nextDesktopId++}`;
  desktops.set(id, { id, title: title || `Desktop ${id.slice(8)}`, desktopVisible: true });
  switchDesktop(id);
  return id;
}

function moveWindowToDesktop(tab, id) {
  if (!tab || !desktops.has(id) || tab.desktopId === id) return;
  const sourceId = tab.desktopId;
  const source = desktops.get(sourceId);
  const minimized = tab.minimized;
  detachApplicationPanel(tab);
  if (activeTabId === tab.id) activeTabId = null;
  if (source.activeTabId === tab.id) source.activeTabId = null;
  if (source.desktopActiveTabId === tab.id) source.desktopActiveTabId = null;
  source.activeTabId ||= source.layout?.activePanel?.id || null;
  source.desktopActiveTabId ||= source.activeTabId;
  if (!source.layout?.panels.length) source.desktopVisible = true;
  if (currentDesktopId === sourceId && !activeTabId) {
    activeTabId = source.layout?.activePanel?.id || null;
    desktopActiveTabId = activeTabId;
    if (!activeTabId) desktopVisible = true;
  }
  tab.desktopId = id;
  tab.placement = undefined;
  switchDesktop(id);
  if (!minimized) activateTab(tab.id);
  else { tab.minimized = true; renderDesktop(); writeShellState(); }
}

function deleteDesktop(id) {
  if (desktops.size === 1) return;
  const target = [...desktops.keys()].find(key => key !== id);
  for (const tab of tabs.values()) if (tab.desktopId === id) moveWindowToDesktop(tab, target);
  if (currentDesktopId === id) switchDesktop(target);
  const desktop = desktops.get(id);
  layoutMutation = true;
  try { desktop.root?.desktopEvents.abort(); desktop.root?.snapPreview.remove(); desktop.layout?.dispose(); desktop.root?.remove(); } finally { layoutMutation = false; }
  desktops.delete(id);
  renderDesktop(); writeShellState();
}

function renderWorkspaceDock(items) {
  for (const desktop of desktops.values()) {
    const button = document.createElement('button');
    button.className = 'dock-item workspace-button';
    button.dataset.desktopId = desktop.id;
    button.title = desktop.title;
    button.setAttribute('aria-label', desktop.title);
    button.setAttribute('aria-pressed', String(desktop.id === currentDesktopId));
    button.classList.toggle('active', desktop.id === currentDesktopId);
    button.append(desktopIcon('panels-top-left'));
    const label = document.createElement('span');
    label.className = 'dock-label'; label.textContent = desktop.title;
    button.append(label);
    button.onclick = () => switchDesktop(desktop.id);
    button.oncontextmenu = event => {
      event.preventDefault(); event.stopPropagation();
      setToolsMenuOpen(false); setWindowMenuOpen(false);
      document.getElementById('applications-menu').hidden = true;
      document.getElementById('applications-button').setAttribute('aria-expanded', 'false');
      const menu = document.getElementById('dock-menu');
      menu.replaceChildren();
      const rename = document.createElement('button');
      rename.role = 'menuitem'; rename.textContent = 'Rename desktop';
      rename.onclick = () => { menu.hidden = true; document.getElementById('desktop-name').value = desktop.title; document.getElementById('rename-desktop-dialog').dataset.desktopId = desktop.id; document.getElementById('rename-desktop-dialog').showModal(); };
      const remove = document.createElement('button');
      remove.role = 'menuitem'; remove.textContent = 'Remove desktop (move windows)'; remove.disabled = desktops.size === 1;
      remove.onclick = () => { menu.hidden = true; deleteDesktop(desktop.id); };
      menu.append(rename, remove); menu.hidden = false;
      for (const tab of tabs.values()) if (tab.desktopId === desktop.id) {
        const restore = document.createElement('button'); restore.role = 'menuitem'; restore.textContent = (tab.minimized ? 'Restore: ' : 'Switch: ') + tab.title;
        restore.onclick = () => { menu.hidden = true; activateTab(tab.id); }; menu.append(restore);
      }
      menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.top = (dockCollapsed ? 32 : 52) + 'px';
    };
    items.append(button);
  }
  const add = document.createElement('button');
  add.id = 'add-desktop'; add.className = 'icon-button'; add.title = 'New desktop'; add.setAttribute('aria-label', 'New desktop');
  add.append(desktopIcon('plus')); add.onclick = () => addDesktop(); items.append(add);
}

function installDesktopTransfer(root) {
  let drag;
  root.addEventListener('pointerdown', event => {
    const header = event.target.closest('[data-tab-panel-id]');
    if (event.button !== 0 || !header || event.target.closest('button, .dv-default-tab-action')) return;
    drag = { id: header.dataset.tabPanelId, x: event.clientX, y: event.clientY };
  }, true);
  const clear = () => { drag = null; document.querySelectorAll('.desktop-drop-target').forEach(node => node.classList.remove('desktop-drop-target')); };
  window.addEventListener('pointermove', event => {
    if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 8) return;
    document.querySelectorAll('.desktop-drop-target').forEach(node => node.classList.remove('desktop-drop-target'));
    document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-desktop-id], #add-desktop')?.classList.add('desktop-drop-target');
  }, { signal: root.desktopEvents.signal });
  window.addEventListener('pointerup', event => {
    if (!drag) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-desktop-id], #add-desktop');
    const tab = tabs.get(drag.id);
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 8;
    clear();
    if (target && moved) requestAnimationFrame(() => moveWindowToDesktop(tab, target.id === 'add-desktop' ? addDesktop() : target.dataset.desktopId));
  }, { signal: root.desktopEvents.signal });
  window.addEventListener('pointercancel', clear, { signal: root.desktopEvents.signal }); window.addEventListener('blur', clear, { signal: root.desktopEvents.signal });
}

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
document.getElementById('rename-desktop-form').onsubmit = event => {
  event.preventDefault();
  const dialog = document.getElementById('rename-desktop-dialog');
  const desktop = desktops.get(dialog.dataset.desktopId);
  const title = document.getElementById('desktop-name').value.trim();
  if (desktop && title) desktop.title = title.slice(0, 40);
  dialog.close(); renderDesktop(); writeShellState();
};
document.getElementById('cancel-desktop-name').onclick = () => document.getElementById('rename-desktop-dialog').close();
