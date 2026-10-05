function normalizePreferences(value = {}) {
  return {
    theme: ['system', 'light', 'dark'].includes(value?.theme) ? value.theme : 'system',
    language: ['system', 'en-US', 'zh-CN'].includes(value?.language) ? value.language : 'system',
  };
}

function resolveAppearance(preferences, systemLocale, systemDark) {
  const modes = normalizePreferences(preferences);
  return { ...modes,
    resolvedTheme: modes.theme === 'system' ? (systemDark === true ? 'dark' : 'light') : modes.theme,
    resolvedLanguage: modes.language === 'system' ? (/^zh(?:-|_|$)/i.test(systemLocale || '') ? 'zh-CN' : 'en-US') : modes.language,
  };
}

module.exports = { normalizePreferences, resolveAppearance };
