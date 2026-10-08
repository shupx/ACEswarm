# Desktop and application process cleanup

ACEswarm stops its embedded AivudaOS gateway first, allowing up to twelve seconds
for application cleanup before stopping other services. AivudaOS closes its
owned Popen applications concurrently on gateway shutdown, waits for actual
exit before updating status, and tracks Linux process identities and observed
children which create new sessions. Its independent guardian watches a private
pipe and handles backend crash/SIGKILL; the Electron guardian handles desktop
service groups. Systemd application lifecycle remains under systemd.

Cleanup sends SIGTERM, waits five seconds, escalates to SIGKILL, then verifies
termination. App scripts should implement graceful shutdown too. Arbitrarily
external processes and children that daemonize before either monitor can observe
them are outside this ownership tracking; use systemd cgroups for strict service
containment. PID start-time validation prevents signalling a reused process ID.

Verification uses isolated fixtures, never the user's active robot applications:

```sh
npm run check
npm run test:cleanup
PYTHONPATH=aivudaOS .venv/bin/python -m unittest discover -s aivudaOS/tests
```

The desktop cleanup suite covers window close, menu quit, SIGTERM and SIGKILL,
with a real installed Popen app and a detached child that ignores SIGTERM.
