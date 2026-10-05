const backgroundApps = document.getElementById('background-apps');
const backgroundAppsToggle = document.getElementById('background-apps-toggle');
const backgroundAppsOverflow = document.getElementById('background-apps-overflow');
let backgroundAppsSignature = '';

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
    button.onclick = () => {
      setBackgroundAppsOpen(false);
      const tab = [...tabs.values()].find(item => desktopState.appKey(item.appUrl) === desktopState.appKey(entry.url));
      if (tab) activateTab(tab.id);
      else openApplication(entry.hasUi ? entry.url : defaultUrl);
    };
    (index < 4 ? visible : backgroundAppsOverflow).append(button);
  });
  refreshDesktopIcons();
}

async function refreshBackgroundApps() {
  try {
    renderBackgroundApps(await window.aivudaShell.getRunningApplications());
  } catch (error) {
    // A failed status request must not leave stale running indicators visible.
    renderBackgroundApps([]);
    console.warn('Could not refresh running applications:', error);
  } finally {
    setTimeout(refreshBackgroundApps, 5000);
  }
}

backgroundAppsToggle.onclick = () => {
  setBackgroundAppsOpen(backgroundAppsOverflow.hidden);
  if (!backgroundAppsOverflow.hidden) backgroundAppsOverflow.querySelector('button')?.focus();
};
document.addEventListener('pointerdown', event => {
  if (!backgroundApps.contains(event.target)) setBackgroundAppsOpen(false);
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
