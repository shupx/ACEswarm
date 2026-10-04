let desktopLayout;
let layoutMutation = false;
let layoutFrame;

function schedulePanelLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(syncPanelBodies);
}

// Guest nodes stay in one permanent host: moving Dockview renderers must not
// detach Electron webviews and recreate their guest processes.
function syncPanelBodies() {
  if (!desktopLayout) return;
  const hostRect = stackEl.getBoundingClientRect();
  for (const tab of tabs.values()) {
    const panel = desktopLayout.getPanel(tab.id);
    if (panel) tab.panel = panel;
    const visible = !tab.minimized && panel?.api.isVisible && tab.anchor?.isConnected;
    tab.body.hidden = !visible;
    if (!visible) continue;
    const rect = tab.anchor.getBoundingClientRect();
    const float = panel.group.element.closest('.dv-resize-container');
    Object.assign(tab.body.style, {
      left: `${rect.left - hostRect.left}px`, top: `${rect.top - hostRect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
      zIndex: float ? String((Number(getComputedStyle(float).zIndex) || 100) + 1) : '1',
    });
  }
}

function panelActions(group) {
  const element = document.createElement('div');
  element.className = 'panel-controls';
  const disposables = [];
  const commands = [
    ['panel-browser', 'globe', 'Address bar', toggleActiveAddressBar],
    ['panel-pin', 'pin', 'Pin to Dock', addCurrentFavorite],
    ['panel-menu', 'ellipsis', 'Window controls', () => openWindowMenu(getActiveTab())],
    ['panel-float', 'panels-top-left', 'Float or dock panel', () => floatOrDockPanel(getActiveTab())],
    ['panel-min', 'minus', 'Minimize', () => minimizeApplicationWindow(getActiveTab())],
    ['panel-max', 'maximize-2', 'Maximize or restore', () => {
      const api = getActiveTab()?.panel?.api;
      if (!api) return;
      if (api.location.type === 'floating') api.group.api.moveTo({ position: 'right' });
      api.isMaximized() ? api.exitMaximized() : api.maximize();
    }],
    ['panel-close', 'x', 'Close', () => closeTab(activeTabId)],
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
    init() { disposables.push(group.api.onDidActivePanelChange(sync)); sync(); refreshDesktopIcons(); },
    dispose() { disposables.forEach((item) => item.dispose()); },
  };
}

function initializeDesktopLayout() {
  if (desktopLayout) return;
  const root = document.createElement('div');
  root.id = 'dock-layout';
  stackEl.prepend(root);
  const library = window['dockview-core'];
  desktopLayout = library.createDockview(root, {
    theme: library.themeLight,
    dndStrategy: 'pointer',
    floatingGroupBounds: 'boundedWithinViewport',
    floatingGroupDragHandle: 'titlebar',
    getTabContextMenuItems: () => ['float', 'maximize', 'separator', 'close', 'closeOthers'],
    createComponent({ id }) {
      const element = document.createElement('div');
      element.className = 'panel-anchor';
      const observer = new ResizeObserver(schedulePanelLayout);
      return {
        element,
        init() { const tab = tabs.get(id); if (tab) tab.anchor = element; observer.observe(element); schedulePanelLayout(); },
        dispose() { observer.disconnect(); },
      };
    },
    createRightHeaderActionComponent: panelActions,
  });
  desktopLayout.onDidActivePanelChange((panel) => {
    if (layoutMutation || !panel || !tabs.has(panel.id)) return;
    activeTabId = panel.id;
    tabs.get(panel.id).panel = panel;
    updateActiveClasses(); updateAddressFromActiveTab(); updateNavigationState();
    syncPerformanceOverlayForActiveTab(); schedulePanelLayout(); writeShellState();
  });
  desktopLayout.onDidRemovePanel((panel) => {
    if (!layoutMutation && tabs.has(panel.id)) removeApplicationWindow(tabs.get(panel.id));
  });
  desktopLayout.onDidLayoutChange(() => {
    schedulePanelLayout(); renderDesktop(); writeShellState();
  });
  root.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.dv-tabs-and-actions-container, .dv-sash, .dv-floating-titlebar, .dv-resize-container')) {
      stackEl.classList.add('interacting');
      setToolsMenuOpen(false);
      if (!event.target.closest('.panel-menu')) setWindowMenuOpen(false);
      document.getElementById('dock-menu').hidden = true;
    }
  }, true);
  root.addEventListener('dragstart', () => stackEl.classList.add('interacting'), true);
  root.addEventListener('dragend', () => { stackEl.classList.remove('interacting'); schedulePanelLayout(); }, true);
  root.addEventListener('drop', () => { stackEl.classList.remove('interacting'); schedulePanelLayout(); }, true);
  root.addEventListener('pointermove', () => { if (stackEl.classList.contains('interacting')) schedulePanelLayout(); });
  layoutApplicationWindows();
}

function addApplicationPanel(tab, options = {}) {
  const placement = tab.placement || {};
  const reference = desktopLayout.getPanel(placement.reference);
  const config = { id: tab.id, component: 'webpage', title: tab.title, renderer: 'always' };
  if (placement.floating) config.floating = placement.floating;
  else if (reference) config.position = { referencePanel: reference, direction: placement.direction || 'within', index: placement.index };
  else if (options.bounds) {
    const bounds = desktopState.windowBounds(options.bounds, { width: innerWidth, height: innerHeight }, 0, dockCollapsed);
    config.floating = { ...bounds, y: bounds.y - (dockCollapsed ? 28 : 48) };
  }
  tab.panel = desktopLayout.addPanel(config);
  if (options.maximized && tab.panel.api.location.type === 'grid') tab.panel.api.maximize();
  schedulePanelLayout();
}

function rememberPanelPlacement(tab) {
  const group = tab.panel?.group;
  if (!group) return;
  const rect = group.element.getBoundingClientRect();
  tab.placement = group.api.location.type === 'floating'
    ? { floating: { x: rect.x, y: rect.y - (dockCollapsed ? 28 : 48), width: rect.width, height: rect.height } }
    : { reference: group.panels.find((panel) => panel.id !== tab.id)?.id, index: group.panels.findIndex((panel) => panel.id === tab.id) };
  if (group.api.location.type === 'grid' && !tab.placement.reference) {
    for (const [direction, restoreDirection] of [['left', 'right'], ['right', 'left'], ['up', 'below'], ['down', 'above']]) {
      const neighbor = desktopLayout.adjacentGroupInDirection(group, direction);
      if (!neighbor?.panels.length) continue;
      tab.placement = { reference: neighbor.panels[0].id, direction: restoreDirection };
      break;
    }
  }
}

function detachApplicationPanel(tab) {
  if (!tab.panel) return;
  if (!desktopLayout.getPanel(tab.id)) { tab.panel = null; tab.body.hidden = true; return; }
  rememberPanelPlacement(tab);
  layoutMutation = true;
  try { desktopLayout.removePanel(tab.panel); } finally { layoutMutation = false; tab.panel = null; }
  tab.body.hidden = true;
  schedulePanelLayout();
}

function floatOrDockPanel(tab) {
  if (!tab?.panel) return;
  if (tab.panel.api.location.type === 'floating') tab.panel.group.api.moveTo({ position: 'right' });
  else {
    if (desktopLayout.hasMaximizedGroup()) desktopLayout.exitMaximizedGroup();
    const bounds = desktopState.windowBounds({}, { width: innerWidth, height: innerHeight }, 0, dockCollapsed);
    desktopLayout.addFloatingGroup(tab.panel, { ...bounds, y: bounds.y - (dockCollapsed ? 28 : 48) });
  }
  schedulePanelLayout();
}

function restoreDesktopLayout(layout) {
  if (!layout || !desktopLayout) return;
  const visible = [...tabs.values()].filter((tab) => !tab.minimized).map((tab) => tab.id).sort();
  if (JSON.stringify(Object.keys(layout.panels || {}).sort()) !== JSON.stringify(visible) || layout.popoutGroups?.length) return;
  layoutMutation = true;
  try {
    desktopLayout.fromJSON(layout, { reuseExistingPanels: true });
    for (const tab of tabs.values()) tab.panel = desktopLayout.getPanel(tab.id) || null;
  } catch (error) {
    console.warn('Could not restore desktop layout:', error);
    desktopLayout.clear();
    for (const tab of tabs.values()) if (!tab.minimized) addApplicationPanel(tab);
  } finally { layoutMutation = false; schedulePanelLayout(); }
}
