// Renderer-facing adapter. It contains no Electron primitives; preload supplies transport.
function createControlAdapter(transport = window.aceswarm) {
  return {
    status: () => transport.status(), pages: () => transport.pages(),
    resolvePage: (id, context) => context === undefined ? transport.resolvePage(id) : transport.resolvePage(id, context),
    workspaceItems: (kind) => transport.workspaceItems(kind),
    createWorkspaceItem: (kind, name) => transport.createWorkspaceItem(kind, name),
    settingsTarget: () => transport.settingsTarget(), storeTarget: () => transport.storeTarget(),
    bootstrap: () => transport.bootstrap(),
  };
}
if (typeof window !== 'undefined') window.aceswarmControl = createControlAdapter();
if (typeof module !== 'undefined') module.exports = { createControlAdapter };
