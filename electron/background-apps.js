const backgroundApps = document.getElementById('background-apps');
const backgroundAppsToggle = document.getElementById('background-apps-toggle');
const backgroundAppsOverflow = document.getElementById('background-apps-overflow');
let backgroundAppsSignature = '';
const backgroundAppMenu = document.getElementById('background-app-menu');
const pendingBackgroundAppActions = new Set();
let backgroundAppMenuTrigger;

function closeBackgroundAppMenu(restoreFocus = false) {
  backgroundAppMenu.hidden = true;
  if (restoreFocus) backgroundAppMenuTrigger?.focus();
}

function activateBackgroundApp(url) {
  setBackgroundAppsOpen(false);
  const tab = [...tabs.values()].find(item => desktopState.appKey(item.appUrl) === desktopState.appKey(url));
  if (tab) activateTab(tab.id);
  else openApplication(url);
}

async function runBackgroundAppAction(entry, action) {
  if (pendingBackgroundAppActions.has(entry.appId)) return;
  pendingBackgroundAppActions.add(entry.appId);
  try {
    await window.aivudaShell.controlApplication(entry.appId, action);
  } finally {
    pendingBackgroundAppActions.delete(entry.appId);
    if (backgroundAppMenu.dataset.appId === entry.appId) closeBackgroundAppMenu();
    await refreshBackgroundApps(false);
  }
}

function openBackgroundAppMenu(event, entry) {
  event.preventDefault();
  event.stopPropagation();
  backgroundAppMenuTrigger = event.currentTarget;
  for (const id of ['dock-menu', 'window-menu', 'tools-menu', 'applications-menu']) document.getElementById(id).hidden = true;
  for (const id of ['tools-button', 'applications-button']) document.getElementById(id).setAttribute('aria-expanded', 'false');
  backgroundAppMenu.replaceChildren();
  backgroundAppMenu.dataset.appId = entry.appId;
  for (const [action, label, icon] of [['ui', 'Open UI', 'external-link'], ['detail', 'Detail', 'info'], ['stop', 'Stop', 'square'], ['restart', 'Restart', 'rotate-cw']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'menuitem';
    button.dataset.action = action;
    button.disabled = action === 'ui' ? !entry.hasUi : ['stop', 'restart'].includes(action) && pendingBackgroundAppActions.has(entry.appId);
    button.append(desktopIcon(icon), document.createTextNode(label));
    button.onclick = () => {
      closeBackgroundAppMenu();
      if (action === 'ui' || action === 'detail') activateBackgroundApp(action === 'ui' ? entry.url : entry.detailUrl);
      else runBackgroundAppAction(entry, action).catch(error => window.alert(error.message));
    };
    backgroundAppMenu.append(button);
  }
  backgroundAppMenu.hidden = false;
  refreshDesktopIcons();
  backgroundAppMenu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - backgroundAppMenu.offsetWidth - 8)) + 'px';
  backgroundAppMenu.style.top = Math.max(8, Math.min(event.clientY - backgroundAppMenu.offsetHeight - 8, innerHeight - 36 - backgroundAppMenu.offsetHeight)) + 'px';
  backgroundAppMenu.querySelector('button:not(:disabled)')?.focus();
}

function setBackgroundAppsOpen(open) {
  backgroundAppsOverflow.hidden = !open;
  backgroundAppsToggle.setAttribute('aria-expanded', String(open));
}

function renderBackgroundApps(entries) {
  const signature = JSON.stringify(entries);
  if (signature === backgroundAppsSignature) return;
  backgroundAppsSignature = signature;
  const visible = document.getElementById('background-apps-visible');
  visible.replaceChildren();
  backgroundAppsOverflow.replaceChildren();
  backgroundApps.hidden = entries.length === 0;
  backgroundAppsToggle.hidden = entries.length <= 4;
  if (entries.length <= 4) setBackgroundAppsOpen(false);
  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button background-app';
    button.dataset.appUrl = entry.url;
    button.dataset.appId = entry.appId;
    button.title = entry.title;
    button.setAttribute('aria-label', entry.title);
    button.append(applicationIcon(entry));
    button.onclick = () => activateBackgroundApp(entry.hasUi ? entry.url : defaultUrl);
    button.oncontextmenu = event => openBackgroundAppMenu(event, entry);
    (index < 4 ? visible : backgroundAppsOverflow).append(button);
  });
  refreshDesktopIcons();
}

async function refreshBackgroundApps(schedule = true) {
  try {
    renderBackgroundApps(await window.aivudaShell.getRunningApplications());
  } catch (error) {
    // A failed status request must not leave stale running indicators visible.
    renderBackgroundApps([]);
    console.warn('Could not refresh running applications:', error);
  } finally {
    if (schedule) setTimeout(refreshBackgroundApps, 5000);
  }
}

backgroundAppsToggle.onclick = () => {
  setBackgroundAppsOpen(backgroundAppsOverflow.hidden);
  if (!backgroundAppsOverflow.hidden) backgroundAppsOverflow.querySelector('button')?.focus();
};
document.addEventListener('pointerdown', event => {
  if (!backgroundAppMenu.contains(event.target)) closeBackgroundAppMenu();
  if (!backgroundApps.contains(event.target) && !backgroundAppMenu.contains(event.target)) setBackgroundAppsOpen(false);
});
backgroundApps.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    setBackgroundAppsOpen(false);
    backgroundAppsToggle.focus();
    event.stopPropagation();
  }
  if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const buttons = [...backgroundApps.querySelectorAll('button')].filter(button => button.getClientRects().length);
    const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    event.preventDefault();
  }
});
refreshBackgroundApps();
