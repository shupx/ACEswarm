const shellTranslations = {
  'System': '系统', 'Applications': '应用', 'Desktop': '桌面', 'All': '全部',
  'Running applications': '正在运行的应用', 'More running applications': '更多正在运行的应用',
  'Application actions': '应用操作', 'Open UI': '打开 UI', 'Detail': '详情', 'Stop': '停止', 'Restart': '重启',
  'Theme': '主题', 'Language': '语言', 'Follow System': '跟随系统', 'Light': '浅色', 'Dark': '深色',
  'Open page': '打开页面', 'Show desktop': '显示桌面', 'FPS / GPU Overlay': 'FPS / GPU 浮层',
  'Screen Record': '录屏', 'Fullscreen': '全屏', 'Clear Browser Data': '清除浏览器数据', 'Quit ACEswarm': '退出 ACEswarm',
  'Search applications': '搜索应用', 'Search all applications': '搜索所有应用', 'Favorite apps': '收藏应用',
  'No matching applications': '没有匹配的应用', 'No installed applications': '没有已安装的应用',
  'Close applications': '关闭应用菜单', 'Close': '关闭', 'Open': '打开', 'Address': '地址',
  'Address bar': '地址栏', 'Reload page': '重新加载页面', 'Developer tools': '开发者工具',
  'Window controls': '窗口控制', 'Add to Favorites': '添加到收藏', 'Add to favorites': '添加到收藏',
  'Remove from Favorites': '取消收藏', 'Remove from favorites': '取消收藏', 'Move tab to window': '移动标签页到窗口',
  'Restore floating window': '恢复浮动窗口', 'Maximize or restore': '最大化或恢复', 'Minimize': '最小化',
  'Close tab': '关闭标签页', 'Close window': '关闭窗口', 'New window': '新窗口', 'Zoom in': '放大', 'Zoom out': '缩小',
  'Reset zoom': '重置缩放', 'Page zoom': '页面缩放', 'Left half': '左半屏', 'Right half': '右半屏',
  'Top half': '上半屏', 'Bottom half': '下半屏', 'Maximize window': '最大化窗口', 'Back': '后退', 'Forward': '前进',
  'Ready': '就绪', 'Hide address bar': '隐藏地址栏', 'Page address': '页面地址', 'Window taskbar': '窗口任务栏',
};
const englishByChinese = Object.fromEntries(Object.entries(shellTranslations).map(([english, chinese]) => [chinese, english]));
let shellAppearance = { theme: 'system', language: 'system', resolvedTheme: 'light', resolvedLanguage: 'en-US' };

function translateShell() {
  const translate = value => {
    const key = englishByChinese[value] || value;
    return shellAppearance.resolvedLanguage === 'zh-CN' ? shellTranslations[key] || value : key;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest('script, style, [data-app-url], .dv-tab, .window-task')) continue;
    const text = node.textContent.trim();
    const next = translate(text);
    if (text !== next) node.textContent = node.textContent.replace(text, next);
  }
  for (const node of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
    for (const attribute of ['title', 'aria-label', 'placeholder']) {
      const value = node.getAttribute(attribute);
      if (value && translate(value) !== value) node.setAttribute(attribute, translate(value));
    }
  }
}

function applyShellAppearance(value) {
  shellAppearance = value || shellAppearance;
  document.documentElement.dataset.theme = shellAppearance.resolvedTheme;
  document.documentElement.lang = shellAppearance.resolvedLanguage;
  const library = window['dockview-core'];
  const theme = shellAppearance.resolvedTheme === 'dark' ? library.themeDark : library.themeLight;
  for (const owner of appWindows.values()) {
    owner.layout.updateOptions({ theme });
    owner.popoverHost?.classList.remove(library.themeDark.className, library.themeLight.className);
    owner.popoverHost?.classList.add(theme.className);
  }
  document.getElementById('system-theme').value = shellAppearance.theme;
  document.getElementById('system-language').value = shellAppearance.language;
  translateShell();
}

for (const [id, key] of [['system-theme', 'theme'], ['system-language', 'language']]) {
  document.getElementById(id).onchange = async event => {
    try { applyShellAppearance(await window.aivudaShell.setAppearance({ ...shellAppearance, [key]: event.target.value })); }
    catch (error) { console.warn('Could not save appearance:', error); applyShellAppearance(shellAppearance); }
  };
}
window.aivudaShell.onAppearance(applyShellAppearance);
try { applyShellAppearance(window.aivudaShell.getAppearance()); } catch (_) { applyShellAppearance(null); }
new MutationObserver(translateShell).observe(document.body, { childList: true, subtree: true, characterData: true });
