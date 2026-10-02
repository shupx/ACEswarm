# ACEswarm repository rules

- Keep AivudaOS and AivudaAppStore independent distributions. Consume public ASGI/HTTP APIs; do not import their private internals or touch their databases.
- Embedded instances use the dedicated `ACEswarm_ws/services` workspace. Never run standalone install/systemd/Avahi scripts.
- AivudaOS owns installed-app Caddy imports/reloads; ACEswarm owns the loopback gateway process and its initial config.
- Release builds ship a private Python executable, wheels/packages, UIs and Caddy. Never install dependencies at user launch.
- Linux x86_64 is the initial release target. Document runtime changes and validate source and packaged modes.
