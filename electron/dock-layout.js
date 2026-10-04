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
    const visible = !desktopVisible && !tab.minimized && panel?.api.isVisible && tab.anchor?.isConnected;
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
      if (api.isMaximized()) {
        api.exitMaximized();
        workspaceRegion = workspaceMaximizeRestore;
      } else {
        workspaceMaximizeRestore = workspaceRegion;
        workspaceRegion = 'full';
        layoutApplicationWindows();
        api.maximize();
      }
      layoutApplicationWindows(); renderDesktop(); writeShellState();
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
    if (layoutMutation || desktopVisible || !panel || !tabs.has(panel.id)) return;
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
  installWorkspaceSnapping(root);
}

function addApplicationPanel(tab, options = {}) {
  const placement = tab.placement || {};
  const reference = desktopLayout.getPanel(placement.reference);
  const config = { id: tab.id, component: 'webpage', title: tab.title, renderer: 'always' };
  if (workspaceRegion !== 'full' && desktopLayout.panels.length && !placement.reference && !placement.floating && !options.bounds) {
    const direction = { left: 'right', right: 'left', top: 'below', bottom: 'above' }[workspaceRegion];
    config.position = { referencePanel: desktopLayout.activePanel || desktopLayout.panels[0], direction };
    workspaceRegion = 'full';
    layoutApplicationWindows();
  }
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
    ? { floating: { x: rect.x - stackEl.getBoundingClientRect().x, y: rect.y - stackEl.getBoundingClientRect().y, width: rect.width, height: rect.height } }
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
  workspaceRegion = 'full';
  layoutApplicationWindows();
  if (tab.panel.api.location.type === 'floating') tab.panel.group.api.moveTo({ position: 'right' });
  else {
    if (desktopLayout.hasMaximizedGroup()) desktopLayout.exitMaximizedGroup();
    const bounds = desktopState.windowBounds({}, { width: innerWidth, height: innerHeight }, 0, dockCollapsed);
    desktopLayout.addFloatingGroup(tab.panel, { ...bounds, y: bounds.y - (dockCollapsed ? 28 : 48) });
  }
  schedulePanelLayout();
}

function setWorkspaceRegion(region) {
  if (!getActiveTab()) return;
  if (desktopLayout.panels.length === 1 && desktopLayout.panels[0].api.location.type === 'floating') {
    desktopLayout.panels[0].group.api.moveTo({ position: 'right' });
  }
  workspaceRegion = region;
  if (desktopLayout.hasMaximizedGroup()) desktopLayout.exitMaximizedGroup();
  layoutApplicationWindows();
  renderDesktop();
  writeShellState();
}

function installWorkspaceSnapping(root) {
  const preview = document.createElement('div');
  preview.id = 'workspace-snap-preview';
  preview.hidden = true;
  shellEl.append(preview);
  let drag;
  let target;
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.dv-tab, .dv-floating-titlebar') || event.target.closest('button, .dv-default-tab-action')) return;
    if (desktopLayout.panels.length !== 1 || desktopLayout.panels[0].api.location.type !== 'grid') return;
    drag = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 12) return;
    const top = dockCollapsed ? 28 : 48;
    target = event.clientX <= 32 ? 'left' : event.clientX >= innerWidth - 32 ? 'right' : event.clientY <= top + 20 ? 'full' : null;
    preview.hidden = !target;
    if (target) {
      const bounds = desktopState.workspaceBounds({ width: innerWidth, height: innerHeight }, dockCollapsed, target);
      Object.assign(preview.style, { left: bounds.x + 'px', top: bounds.y + 'px', width: bounds.width + 'px', height: bounds.height + 'px' });
    }
  });
  window.addEventListener('pointerup', () => {
    const region = target;
    drag = null; target = null; preview.hidden = true;
    if (region) requestAnimationFrame(() => setWorkspaceRegion(region));
  });
  for (const event of ['pointercancel', 'blur']) window.addEventListener(event, () => { drag = null; target = null; preview.hidden = true; });
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
