# Recording and System controls

Select `shell.html` and snapshot the System menu to operate desktop settings;
these controls belong to the Shell, not the Console guest or OS MCP. Theme and
language can follow the operating system or use an override. Refresh snapshots
after changing language. FPS / GPU Overlay displays live performance information;
it is separate from recording. Fullscreen changes the desktop window.

For recording, open System → Screen Record to show the recording bar. Showing
the bar does not start recording. Expand its details to select an idle mode:

| Mode | Capture and output | Requirement |
|---|---|---|
| Native | Electron window content, WebM | No FFmpeg dependency |
| FFmpeg | Electron window frames encoded to MP4 | FFmpeg installed |
| FFmpeg X11 | Native window's screen region encoded to MP4 | FFmpeg and an X11 display |

Start recording, verify the recording state/timer, and use Pause/Resume when
requested. Finish with Stop and save; wait for saving to complete and verify the
reported output path before reporting success. Details provide Open file and
Open folder actions. Discover the path from the UI rather than assuming a user's
recordings directory. Hide only hides the bar; it does not finish recording.
If FFmpeg is unavailable, Native is an alternative when it meets the request.

Clear Browser Data can remove persistent guest login/session data. Quit stops
managed services and finalizes an active recording; explicitly stopping/saving
first makes its result easier to verify. Use reset/exit only within the requested
scope; quitting also disconnects the built-in MCP services.
