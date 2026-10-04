const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { app, dialog, screen } = require("electron");

// Ported from aivuda-shell: raw window frames and X11 capture share one lifecycle.
module.exports = function createRecordingController(
  getWindow,
  onFailure = () => {},
  onSpawn = () => {},
) {
  let mainWindow = null;
  let activeFfmpegRecording = null;
  function getRecordingsDir() {
    try {
      const videosPath = app.getPath("videos");
      if (videosPath) {
        return path.join(videosPath, "ACEswarm");
      }
    } catch (_error) {}

    return path.join(app.getPath("userData"), "recordings");
  }

  function formatTimestampForFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return (
      [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
        "-",
      ) +
      "-" +
      [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
      ].join("-")
    );
  }

  function createRecordingOutputPath() {
    const recordingsDir = getRecordingsDir();
    fs.mkdirSync(recordingsDir, { recursive: true });
    return path.join(
      recordingsDir,
      `aceswarm-${formatTimestampForFilename()}.webm`,
    );
  }

  function createFfmpegRecordingOutputPath() {
    const recordingsDir = getRecordingsDir();
    fs.mkdirSync(recordingsDir, { recursive: true });
    return path.join(
      recordingsDir,
      `aceswarm-${formatTimestampForFilename()}.mp4`,
    );
  }

  function ensureFfmpegNotRunning() {
    if (
      activeFfmpegRecording?.process &&
      activeFfmpegRecording.process.exitCode == null &&
      !activeFfmpegRecording.stopping
    ) {
      return false;
    }

    return true;
  }

  function checkFfmpegAvailable() {
    const result = spawnSync("ffmpeg", ["-version"], {
      stdio: "ignore",
    });

    if (result.error?.code === "ENOENT") {
      return false;
    }

    return !result.error;
  }

  async function showMissingFfmpegDialog() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["OK"],
      defaultId: 0,
      message: "FFmpeg is not installed.",
      detail:
        'Run "sudo apt install ffmpeg -y" to install it. You can also switch the screen record bar mode to Native to avoid installing FFmpeg, but the recorded video file will usually be larger.',
    });
  }

  function normalizeFfmpegFrameSize(size) {
    return {
      width: Math.max(2, Math.floor(size.width / 2) * 2),
      height: Math.max(2, Math.floor(size.height / 2) * 2),
    };
  }

  function getWindowCaptureBounds(windowToRead = mainWindow) {
    if (!windowToRead || windowToRead.isDestroyed()) {
      return null;
    }

    const bounds = windowToRead.getBounds();
    const displayInfo = screen.getDisplayMatching(bounds);
    const scaleFactor = displayInfo?.scaleFactor || 1;

    return {
      ...normalizeFfmpegFrameSize({
        width: bounds.width * scaleFactor,
        height: bounds.height * scaleFactor,
      }),
      offsetX: Math.round(bounds.x * scaleFactor),
      offsetY: Math.round(bounds.y * scaleFactor),
      display: process.env.DISPLAY || ":0.0",
    };
  }

  function createFfmpegFrameBuffer(image, frameSize) {
    let frameImage = image;
    const imageSize = frameImage.getSize();
    if (
      imageSize.width !== frameSize.width ||
      imageSize.height !== frameSize.height
    ) {
      frameImage = frameImage.resize({
        width: frameSize.width,
        height: frameSize.height,
      });
    }

    const frameBuffer = frameImage.toBitmap();
    const expectedFrameSize = frameSize.width * frameSize.height * 4;
    if (frameBuffer.length !== expectedFrameSize) {
      throw new Error(
        `Captured frame has ${frameBuffer.length} bytes, expected ${expectedFrameSize}.`,
      );
    }

    return frameBuffer;
  }

  function scheduleNextFfmpegFrame(recording) {
    if (!recording || recording.stopping) {
      return;
    }

    const frameIntervalMs = Math.max(1, Math.round(1000 / recording.frameRate));
    recording.captureTimer = setTimeout(async () => {
      if (
        !activeFfmpegRecording ||
        activeFfmpegRecording !== recording ||
        recording.stopping
      ) {
        return;
      }

      if (recording.paused || recording.captureInFlight) {
        scheduleNextFfmpegFrame(recording);
        return;
      }

      recording.captureInFlight = true;
      try {
        const image = await mainWindow.webContents.capturePage();
        const frameBuffer = createFfmpegFrameBuffer(image, recording);
        if (recording.process.stdin && !recording.process.stdin.destroyed) {
          const canWrite = recording.process.stdin.write(frameBuffer);
          if (!canWrite) {
            await once(recording.process.stdin, "drain");
          }
        }
      } catch (error) {
        recording.stderr =
          `${recording.stderr || ""}\nframe-capture-error: ${error.message}`.trim();
        recording.stopping = true;
        if (recording.process.stdin && !recording.process.stdin.destroyed) {
          recording.process.stdin.end();
        }
      } finally {
        recording.captureInFlight = false;
        if (recording.stopping) {
          if (recording.process.stdin && !recording.process.stdin.destroyed) {
            recording.process.stdin.end();
          }
          return;
        }
        scheduleNextFfmpegFrame(recording);
      }
    }, frameIntervalMs);
  }

  function buildFfmpegStopResult(recording, code, signal) {
    const stderr = (recording.stderr || "").trim();
    const outputExists =
      typeof recording.outputPath === "string" &&
      recording.outputPath &&
      fs.existsSync(recording.outputPath) &&
      fs.statSync(recording.outputPath).size > 0;

    if (
      outputExists &&
      (code === 0 ||
        (recording.mode === "x11" && code === 255 && recording.stopping))
    ) {
      return {
        ok: true,
        outputPath: recording.outputPath,
        stderr,
      };
    }

    return {
      ok: false,
      error:
        stderr || `ffmpeg exited with code ${code == null ? "unknown" : code}`,
    };
  }

  function stopActiveFfmpegRecording() {
    if (!activeFfmpegRecording) {
      return Promise.resolve({ ok: true });
    }

    if (activeFfmpegRecording.stopPromise) {
      return activeFfmpegRecording.stopPromise;
    }

    activeFfmpegRecording.stopping = true;
    if (activeFfmpegRecording.mode === "x11" && activeFfmpegRecording.paused) {
      activeFfmpegRecording.process.kill("SIGCONT");
      activeFfmpegRecording.paused = false;
    }
    if (activeFfmpegRecording.captureTimer) {
      clearTimeout(activeFfmpegRecording.captureTimer);
      activeFfmpegRecording.captureTimer = null;
    }
    activeFfmpegRecording.stopPromise = new Promise((resolve) => {
      const recording = activeFfmpegRecording;
      let forcedKillTimer = null;
      let failSafeTimer = null;
      let didFinalize = false;
      const finalize = (result) => {
        if (didFinalize) {
          return;
        }
        didFinalize = true;
        if (forcedKillTimer) {
          clearTimeout(forcedKillTimer);
        }
        if (failSafeTimer) {
          clearTimeout(failSafeTimer);
        }
        if (activeFfmpegRecording === recording) {
          activeFfmpegRecording = null;
        }
        resolve(result);
      };

      const finalizeFromProcessState = () => {
        finalize(
          buildFfmpegStopResult(
            recording,
            recording.process.exitCode,
            recording.process.signalCode,
          ),
        );
      };

      recording.process.once("exit", (code, signal) => {
        finalize(buildFfmpegStopResult(recording, code, signal));
      });

      if (
        recording.process.exitCode != null ||
        recording.process.signalCode != null
      ) {
        process.nextTick(finalizeFromProcessState);
        return;
      }

      try {
        failSafeTimer = setTimeout(finalizeFromProcessState, 9000);
        forcedKillTimer = setTimeout(() => {
          try {
            if (recording.process.exitCode == null) {
              recording.process.kill("SIGINT");
            }
          } catch (_error) {}

          setTimeout(() => {
            try {
              if (recording.process.exitCode == null) {
                recording.process.kill("SIGKILL");
              }
            } catch (_error) {}
          }, 1500);
        }, 4000);

        if (recording.captureInFlight) {
          return;
        }

        if (recording.process.stdin && !recording.process.stdin.destroyed) {
          recording.process.stdin.end();
        } else {
          recording.process.kill("SIGINT");
        }
      } catch (error) {
        finalize({ ok: false, error: error.message });
      }
    });

    return activeFfmpegRecording.stopPromise;
  }

  async function startWindow() {
    mainWindow = getWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Main window is not available." };
    }

    if (!ensureFfmpegNotRunning()) {
      return { ok: false, error: "FFmpeg recording is already running." };
    }

    if (!checkFfmpegAvailable()) {
      await showMissingFfmpegDialog();
      return {
        ok: false,
        error:
          'FFmpeg is not installed. Run "sudo apt install ffmpeg -y" to install it, or switch the screen record bar mode to Native if you want to avoid installing FFmpeg at the cost of larger video files.',
      };
    }

    const outputPath = createFfmpegRecordingOutputPath();
    const firstImage = await mainWindow.webContents
      .capturePage()
      .catch((error) => {
        throw error;
      });
    const firstSize = normalizeFfmpegFrameSize(firstImage.getSize());
    const frameRate = 25;
    const args = [
      "-y",
      "-hide_banner",
      "-f",
      "rawvideo",
      "-r",
      String(frameRate),
      "-pix_fmt",
      "bgra",
      "-s",
      `${firstSize.width}x${firstSize.height}`,
      "-i",
      "-",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ];

    try {
      const child = spawn("ffmpeg", args, {
        stdio: ["pipe", "ignore", "pipe"],
      });
      onSpawn(child);

      activeFfmpegRecording = {
        mode: "window",
        process: child,
        outputPath,
        stderr: "",
        paused: false,
        stopping: false,
        stopPromise: null,
        width: firstSize.width,
        height: firstSize.height,
        frameRate,
        captureTimer: null,
        captureInFlight: false,
      };
      monitorEncoder(activeFfmpegRecording);

      child.stderr.on("data", (chunk) => {
        if (activeFfmpegRecording?.process === child) {
          activeFfmpegRecording.stderr =
            (activeFfmpegRecording.stderr || "") + chunk.toString();
        }
      });

      child.once("error", (error) => {
        activeFfmpegRecording = null;
        if (error.code === "ENOENT") {
          return;
        }
      });

      if (child.pid == null) {
        throw new Error("FFmpeg did not start correctly.");
      }

      const firstFrameBuffer = createFfmpegFrameBuffer(firstImage, firstSize);
      const canWrite = child.stdin.write(firstFrameBuffer);
      if (!canWrite) {
        await once(child.stdin, "drain");
      }

      scheduleNextFfmpegFrame(activeFfmpegRecording);

      return {
        ok: true,
        outputPath,
        recordingsDir: path.dirname(outputPath),
        width: firstSize.width,
        height: firstSize.height,
        frameRate,
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          ok: false,
          error:
            'FFmpeg is not installed. Run "sudo apt install ffmpeg -y" to install it, or switch the screen record bar mode to Native if you want to avoid installing FFmpeg at the cost of larger video files.',
        };
      }

      return { ok: false, error: error.message };
    }
  }

  async function startX11() {
    mainWindow = getWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Main window is not available." };
    }

    if (!ensureFfmpegNotRunning()) {
      return { ok: false, error: "FFmpeg recording is already running." };
    }

    if (!checkFfmpegAvailable()) {
      await showMissingFfmpegDialog();
      return {
        ok: false,
        error:
          'FFmpeg is not installed. Run "sudo apt install ffmpeg -y" to install it, or switch the screen record bar mode to Native if you want to avoid installing FFmpeg at the cost of larger video files.',
      };
    }

    const captureBounds = getWindowCaptureBounds(mainWindow);
    if (!captureBounds) {
      return {
        ok: false,
        error:
          "Could not resolve current window bounds for FFmpeg X11 capture.",
      };
    }

    const outputPath = createFfmpegRecordingOutputPath();
    const args = [
      "-y",
      "-hide_banner",
      "-f",
      "x11grab",
      "-r",
      "25",
      "-s",
      `${captureBounds.width}x${captureBounds.height}`,
      "-i",
      `${captureBounds.display}+${captureBounds.offsetX},${captureBounds.offsetY}`,
      "-vf",
      "setpts=N/(25*TB)",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ];

    try {
      const child = spawn("ffmpeg", args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      onSpawn(child);

      activeFfmpegRecording = {
        mode: "x11",
        process: child,
        outputPath,
        stderr: "",
        paused: false,
        stopping: false,
        stopPromise: null,
        width: captureBounds.width,
        height: captureBounds.height,
        frameRate: 25,
        captureTimer: null,
        captureInFlight: false,
      };
      monitorEncoder(activeFfmpegRecording);

      child.stderr.on("data", (chunk) => {
        if (activeFfmpegRecording?.process === child) {
          activeFfmpegRecording.stderr =
            (activeFfmpegRecording.stderr || "") + chunk.toString();
        }
      });

      child.once("error", (error) => {
        activeFfmpegRecording = null;
        if (error.code === "ENOENT") {
          return;
        }
      });

      if (child.pid == null) {
        throw new Error("FFmpeg X11 did not start correctly.");
      }

      return {
        ok: true,
        outputPath,
        recordingsDir: path.dirname(outputPath),
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return {
          ok: false,
          error:
            'FFmpeg is not installed. Run "sudo apt install ffmpeg -y" to install it, or switch the screen record bar mode to Native if you want to avoid installing FFmpeg at the cost of larger video files.',
        };
      }

      return { ok: false, error: error.message };
    }
  }

  async function pause() {
    mainWindow = getWindow();
    if (
      !activeFfmpegRecording?.process ||
      activeFfmpegRecording.process.exitCode != null
    ) {
      return {
        ok: false,
        error:
          activeFfmpegRecording?.stderr?.trim() ||
          "FFmpeg recording is not running.",
      };
    }

    activeFfmpegRecording.paused = true;
    if (activeFfmpegRecording.mode === "x11")
      activeFfmpegRecording.process.kill("SIGSTOP");
    return { ok: true };
  }

  async function resume() {
    mainWindow = getWindow();
    if (
      !activeFfmpegRecording?.process ||
      activeFfmpegRecording.process.exitCode != null
    ) {
      return { ok: false, error: "FFmpeg recording is not running." };
    }

    activeFfmpegRecording.paused = false;
    if (activeFfmpegRecording.mode === "x11")
      activeFfmpegRecording.process.kill("SIGCONT");
    return { ok: true };
  }

  async function stop() {
    mainWindow = getWindow();
    if (!activeFfmpegRecording) {
      return { ok: true };
    }

    return stopActiveFfmpegRecording();
  }

  function monitorEncoder(recording) {
    recording.process.stdin?.on("error", (error) => {
      recording.stderr += "\n" + error.message;
    });
    recording.process.once("close", (code) => {
      if (!recording.stopPromise) {
        if (recording.captureTimer) clearTimeout(recording.captureTimer);
        onFailure({
          error:
            recording.stderr.trim() ||
            "FFmpeg exited unexpectedly (" + code + ").",
        });
      }
    });
  }

  return {
    getRecordingsDir,
    createRecordingOutputPath,
    startWindow,
    startX11,
    pause,
    resume,
    stop,
  };
};
