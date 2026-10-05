let desktopLayout;
let layoutMutation = false;
let layoutFrame;

function schedulePanelLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(syncPanelBodies);
}

// Guest nodes remain mounted in the desktop host when panels change windows.
function syncPanelBodies() {
  const hostRect = stackEl.getBoundingClientRect();
  for (const owner of appWindows.values()) syncWindowHeader(owner);
  for (const tab of tabs.values()) {
    const owner = appWindows.get(tab.windowId);
    const panel = owner?.layout.getPanel(tab.id);
    if (panel) tab.panel = panel;
    const visible = !desktopVisible && !owner?.minimized && panel?.api.isVisible && tab.anchor?.isConnected;
    tab.body.hidden = !visible;
    if (!visible) continue;
    const rect = tab.anchor.getBoundingClientRect();
    Object.assign(tab.body.style, {
      left: `${rect.left - hostRect.left}px`, top: `${rect.top - hostRect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      zIndex: String(owner.zIndex * 10 + 1),
    });
  }
}

function syncWindowHeader(owner) {
  const groups = owner.layout.groups.filter(group => group.element.isConnected).map(group => ({ group, rect: group.element.getBoundingClientRect() }));
  if (!groups.length) return;
  const top = Math.min(...groups.map(item => item.rect.top));
  const firstRow = groups.filter(item => item.rect.top <= top + 2);
  const right = firstRow.reduce((a, b) => a.rect.right >= b.rect.right ? a : b).group;
  const controlSlot = owner.controlSlots.get(right);
  if (controlSlot && owner.controls.parentElement !== controlSlot) controlSlot.append(owner.controls);
}

function panelActions(group, owner) {
  const element = document.createElement('div');
  element.className = 'panel-controls';
  const disposables = [];
  const commands = [
    ['panel-menu', 'ellipsis', 'Window controls', () => openWindowMenu(getActiveTab())],
  ];
  for (const [className, icon, title, action] of commands) {
    const button = document.createElement('button');
    button.className = `icon-button ${className}`;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.append(desktopIcon(icon));
    button.onpointerdown = (event) => event.stopPropagation();
    button.onclick = (event) => {
      event.stopPropagation();
      const tab = tabs.get(group.activePanel?.id);
      if (!tab) return;
      activateTab(tab.id);
      action();
    };
    element.append(button);
  }
  const sync = () => {
    element.dataset.panelId = group.activePanel?.id || '';
    schedulePanelLayout();
  };
  return {
    element,
    init() { owner.controlSlots.set(group, element); disposables.push(group.api.onDidActivePanelChange(sync)); sync(); refreshDesktopIcons(); },
    dispose() { owner.controlSlots.delete(group); disposables.forEach((item) => item.dispose()); schedulePanelLayout(); },
  };
}


function initializeWindowLayout(owner) {
  const library = window['dockview-core'];
  owner.events = new AbortController();
  const layout = owner.layout = library.createDockview(owner.root, {
    theme: library.themeLight,
    dndStrategy: 'pointer',
    disableFloatingGroups: true,
    getTabContextMenuItems: () => ['close', 'closeOthers'],
    createComponent({ id }) {
      const element = document.createElement('div'); element.className = 'panel-anchor';
      const observer = new ResizeObserver(schedulePanelLayout);
      return {
        element,
        init() { const tab = tabs.get(id); if (tab) tab.anchor = element; observer.observe(element); schedulePanelLayout(); },
        dispose() { observer.disconnect(); },
      };
    },
    createRightHeaderActionComponent: group => panelActions(group, owner),
  });
  layout.onDidActivePanelChange(panel => {
    if (layoutMutation || !panel || !tabs.has(panel.id)) return;
    owner.activeTabId = panel.id; tabs.get(panel.id).panel = panel;
    if (activeWindowId === owner.id && !desktopVisible && !owner.minimized) {
      activeTabId = panel.id;
      updateActiveClasses(); updateAddressFromActiveTab(); updateNavigationState(); syncPerformanceOverlayForActiveTab();
    }
    schedulePanelLayout(); writeShellState();
  });
  layout.onDidRemovePanel(panel => {
    if (!layoutMutation) requestAnimationFrame(() => {
      if (!layout.getPanel(panel.id) && tabs.has(panel.id)) removeApplicationWindow(tabs.get(panel.id));
    });
  });
  layout.onDidLayoutChange(() => { schedulePanelLayout(); renderDesktop(); writeShellState(); });
  layout.onWillDrop(event => {
    const tab = tabs.get(event.getData()?.panelId);
    if (!tab) return;
    if (tab.windowId === owner.id) {
      if (windowTabDrag) windowTabDrag.handled = true;
      return;
    }
    event.preventDefault();
    if (windowTabDrag) windowTabDrag.handled = true;
    const reference = event.group?.activePanel?.id;
    const direction = event.position === 'center' ? 'within' : event.position;
    requestAnimationFrame(() => moveTabToWindow(tab, owner.id, { reference, direction }));
  });
  owner.root.addEventListener('pointerdown', event => {
    const header = event.target.closest('.dv-tabs-and-actions-container');
    if (event.button === 0 && header && !event.target.closest('.dv-tab, [data-tab-panel-id], button, [role="button"], input, select')) {
      startOuterWindowGesture(event, owner);
      return;
    }
    if (header || event.target.closest('.dv-sash')) {
      stackEl.classList.add('interacting');
      setToolsMenuOpen(false);
      if (!event.target.closest('.panel-menu')) setWindowMenuOpen(false);
      document.getElementById('dock-menu').hidden = true;
    }
  }, true);
  owner.root.addEventListener('dblclick', event => {
    if (event.target.closest('.dv-tabs-and-actions-container') && !event.target.closest('.dv-tab, [data-tab-panel-id], button, [role="button"], input, select')) {
      event.stopPropagation(); toggleOuterWindowMaximized(owner);
    }
  }, true);
  owner.root.addEventListener('pointermove', () => { if (stackEl.classList.contains('interacting')) schedulePanelLayout(); });
}

function addApplicationPanel(tab) {
  const owner = appWindows.get(tab.windowId);
  const placement = tab.placement || {};
  const reference = owner.layout.getPanel(placement.reference);
  const config = { id: tab.id, component: 'webpage', title: tab.title, renderer: 'always' };
  if (reference) config.position = { referencePanel: reference, direction: placement.direction || 'within', index: placement.index };
  else if (owner.layout.panels.length) config.position = { referencePanel: owner.layout.activePanel || owner.layout.panels[0], direction: 'within' };
  tab.panel = owner.layout.addPanel(config);
  schedulePanelLayout();
}

function detachApplicationPanel(tab) {
  const owner = appWindows.get(tab.windowId);
  if (!tab.panel || !owner?.layout.getPanel(tab.id)) { tab.panel = null; return; }
  layoutMutation = true;
  try { owner.layout.removePanel(tab.panel); } finally { layoutMutation = false; tab.panel = null; }
  tab.body.hidden = true; schedulePanelLayout();
}

function togglePanelMaximized() { toggleOuterWindowMaximized(); }
function floatOrDockPanel(tab) {
  const owner = getApplicationWindow(tab);
  if (!owner) return;
  owner.maximized = false; owner.region = null; activateWindow(owner.id); layoutApplicationWindows(); writeShellState();
}
function setWorkspaceRegion(region) { setOuterWindowRegion(getApplicationWindow(), region); }

function restoreWindowLayout(owner, layout) {
  if (!layout) return;
  const ids = [...tabs.values()].filter(tab => tab.windowId === owner.id).map(tab => tab.id).sort();
  if (JSON.stringify(Object.keys(layout.panels || {}).sort()) !== JSON.stringify(ids) || layout.popoutGroups?.length) return;
  // Previous versions allowed internal floating groups. Flatten those groups
  // rather than creating a second, incompatible layer of native floating panels.
  if (layout.floatingGroups?.length) return;
  layoutMutation = true;
  try {
    owner.layout.fromJSON(layout, { reuseExistingPanels: true });
    for (const tab of tabs.values()) if (tab.windowId === owner.id) tab.panel = owner.layout.getPanel(tab.id) || null;
  } catch (error) {
    console.warn('Could not restore window layout:', error);
    owner.layout.clear();
    for (const tab of tabs.values()) if (tab.windowId === owner.id) addApplicationPanel(tab);
  } finally { layoutMutation = false; schedulePanelLayout(); }
}
