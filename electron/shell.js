const navigation = document.querySelector('#navigation');
const content = document.querySelector('#content');
let saved;
try { saved = JSON.parse(localStorage.getItem('aceswarm.pages') || '[]'); } catch (_) { saved = []; }
if (!Array.isArray(saved)) saved = [];
let current = 'home';

async function openPage(id) {
  const page = await window.aceswarmControl.resolvePage(id);
  current = id;
  document.querySelector('#title').textContent = page.label;
  document.querySelector('#section').textContent = page.label.toUpperCase();
  for (const button of navigation.querySelectorAll('button')) button.classList.toggle('active', button.dataset.id === id);
  content.replaceChildren();
  if (page.url) {
    const view = document.createElement('webview');
    view.setAttribute('partition', 'persist:aceswarm');
    view.setAttribute('src', page.url);
    content.append(view);
  } else {
    const section = document.createElement('div');
    section.className = 'welcome';
    const heading = document.createElement('h3');
    heading.textContent = page.kind === 'internal' && id === 'home' ? 'One workspace. Every robot.' : page.label;
    const intro = document.createElement('p');
    intro.textContent = id === 'home' ? 'Manage your fleet, launch applications, and keep experiments together. Services run locally in your dedicated ACEswarm workspace.' : `${page.label} workspace is ready for your projects.`;
    section.append(heading, intro);
    if (id === 'home') {
      const cards = document.createElement('div'); cards.className = 'cards';
      for (const [label, target] of [['Open settings', 'settings'], ['Browse app store', 'store']]) {
        const button = document.createElement('button'); button.textContent = label; button.onclick = () => openPage(target); cards.append(button);
      }
      section.append(cards);
    }
    if (id === 'projects' || id === 'experiments') {
      const list = document.createElement('div'); list.className = 'item-list';
      const create = document.createElement('button'); create.className = 'primary';
      create.textContent = `+ New ${id === 'projects' ? 'project' : 'experiment'}`;
      const refresh = async () => {
        list.replaceChildren();
        try {
          const items = (await window.aceswarmControl.workspaceItems(id)).items;
          if (!items.length) list.textContent = `No ${id} yet. Create one to get started.`;
          for (const name of items) {
            const item = document.createElement('div'); item.className = 'item'; item.textContent = name; list.append(item);
          }
        } catch (error) { list.textContent = error.message; }
      };
      create.onclick = async () => {
        const name = prompt(`Name your ${id === 'projects' ? 'project' : 'experiment'}`);
        if (!name) return;
        try { await window.aceswarmControl.createWorkspaceItem(id, name.trim()); await refresh(); }
        catch (error) { alert(error.message); }
      };
      section.append(create, list);
      await refresh();
    }
    if (id === 'fleet') {
      const list = document.createElement('div'); list.className = 'item-list';
      for (const target of saved.filter((entry) => typeof entry === 'string' && entry.startsWith('robot:'))) {
        const button = document.createElement('button'); button.className = 'item';
        button.textContent = target.slice(6); button.onclick = () => openPage(target); list.append(button);
      }
      if (!list.childElementCount) list.textContent = 'Connect a robot from the sidebar to manage its OS page.';
      section.append(list);
    }
    content.append(section);
  }
}

function addButton(id, label) {
  const button = document.createElement('button');
  button.dataset.id = id; button.textContent = label; button.onclick = () => openPage(id);
  navigation.append(button);
}

window.aceswarmControl.pages().then((pages) => {
  for (const page of pages) addButton(page.id, page.label);
  for (const id of saved) if (typeof id === 'string') window.aceswarmControl.resolvePage(id).then((page) => addButton(id, page.label)).catch(() => {});
  openPage('home');
});

function addTarget(prefix, value) {
  if (!value) return;
  const id = prefix + value.trim();
  window.aceswarmControl.resolvePage(id).then((page) => {
    if (!saved.includes(id)) { saved.push(id); localStorage.setItem('aceswarm.pages', JSON.stringify(saved)); addButton(id, page.label); }
    openPage(id);
  }).catch((error) => alert(error.message));
}
document.querySelector('#add-robot').onclick = () => addTarget('robot:', prompt('Robot AivudaOS URL (http:// or https://)'));
document.querySelector('#add-app').onclick = () => addTarget('app:', prompt('Installed application ID'));
setInterval(async () => {
  const status = await window.aceswarmControl.status();
  document.querySelector('#health').textContent = status.failures.at(-1) || '● Local services running';
}, 3000);
