#!/usr/bin/env node
import { connect } from "node:net";
import fs from "node:fs";

const socketPath = process.argv[2];
const reportUrl = process.argv[3];
const token = process.argv[4];
const bearerToken = process.argv[5];

const LOG_FILE = "/tmp/relay-mpv-watcher.log";
const MAX_LOG_BYTES = 100 * 1024; // 100 KB max cap

function log(...args) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      fs.truncateSync(LOG_FILE, 0);
    }
    fs.appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] ${args.join(" ")}\n`,
    );
  } catch {
    // ignore
  }
}

log(
  "Watcher started with args:",
  `socket=${socketPath}`,
  `reportUrl=${reportUrl}`,
  `tokenLength=${token ? token.length : 0}`,
  `hasBearer=${Boolean(bearerToken)}`,
);

if (!socketPath || !reportUrl || !token) {
  log("ERROR: Missing required arguments. Exiting.");
  process.exit(1);
}

let client = null;
let buffer = "";
let lastPos = 0;
let lastDuration = null;
let connected = false;
let wasEverConnected = false;
let finished = false;
let hasReported = false;

let activeReportPromise = null;

// If watching for > 24 hours, auto-terminate to avoid zombies
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
setTimeout(() => {
  log("Max lifetime reached (24h), tearing down");
  void teardown();
}, MAX_LIFETIME_MS).unref();

function report(position, duration, completed) {
  if (hasReported) return activeReportPromise;
  hasReported = true;

  // Don't report 0 unless completed
  if (position <= 0 && !completed) {
    log(`Skipping report: position=${position} <= 0 and completed=false`);
    return Promise.resolve();
  }

  const withinLastMinute =
    duration != null && duration > 0 && position >= duration - 60;
  const isCompleted = completed || withinLastMinute;

  log(
    `Reporting progress: pos=${position}, dur=${duration}, completed=${isCompleted} to ${reportUrl}`,
  );

  activeReportPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const headers = { "Content-Type": "application/json" };
      if (bearerToken) {
        headers["Authorization"] = `Bearer ${bearerToken}`;
      }

      const res = await fetch(reportUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          token,
          position: Math.max(0, Math.floor(position)),
          duration: duration != null ? Math.floor(duration) : null,
          completed: isCompleted,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await res.text().catch(() => "");
      log(`Report result: status=${res.status}, response=${text}`);
    } catch (err) {
      log(`Report error: ${err.message}`);
    }
  })();

  return activeReportPromise;
}

async function teardown() {
  if (finished) return;
  finished = true;
  log("Tearing down watcher");

  if (activeReportPromise) {
    log("Waiting for activeReportPromise to resolve before exiting...");
    try {
      await activeReportPromise;
      log("activeReportPromise resolved");
    } catch (e) {
      log(`activeReportPromise error: ${e.message}`);
    }
  }

  if (client) {
    try {
      client.destroy();
    } catch {
      // ignore
    }
  }

  try {
    fs.rmSync(socketPath, { force: true });
    log("Socket file unlinked:", socketPath);
  } catch {
    // ignore
  }

  log("Watcher process exiting cleanly");
  process.exit(0);
}

function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.event === "property-change") {
    if (
      (msg.id === 1 || msg.name === "time-pos") &&
      typeof msg.data === "number"
    ) {
      lastPos = msg.data;
    } else if (msg.id === 2 || msg.name === "pause") {
      // pause changed
    } else if (
      (msg.id === 3 || msg.name === "duration") &&
      typeof msg.data === "number"
    ) {
      lastDuration = msg.data;
    }
  } else if (msg.event === "end-file") {
    const isEof = msg.reason === "eof";
    const posToReport = isEof ? (lastDuration ?? lastPos) : lastPos;
    log(
      `end-file event received: reason=${msg.reason}, reporting pos=${posToReport}`,
    );
    report(posToReport, lastDuration, isEof);
    void teardown();
  }
}

function attemptConnect(attempt = 0) {
  if (finished) return;

  log(`Attempting socket connect (attempt ${attempt}) to ${socketPath}`);
  const sock = connect(socketPath);
  client = sock;
  sock.setEncoding("utf8");

  sock.on("connect", () => {
    connected = true;
    wasEverConnected = true;
    log("Connected to MPV socket!");
    sock.write('{"command":["observe_property", 1, "time-pos"]}\n');
    sock.write('{"command":["observe_property", 2, "pause"]}\n');
    sock.write('{"command":["observe_property", 3, "duration"]}\n');
  });

  sock.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        handleMessage(JSON.parse(line));
      } catch {
        // ignore malformed lines
      }
    }
  });

  sock.on("error", (err) => {
    if (finished) return;
    const code = err.code;
    log(`Socket error (attempt ${attempt}): ${code || err.message}`);
    if (!wasEverConnected) {
      if (
        (code === "ENOENT" || code === "ECONNREFUSED" || code === "EPIPE") &&
        attempt < 50
      ) {
        setTimeout(() => attemptConnect(attempt + 1), 100);
        return;
      }
    }
    void teardown();
  });

  sock.on("close", () => {
    log(
      `Socket close event. wasEverConnected=${wasEverConnected}, hasReported=${hasReported}, lastPos=${lastPos}`,
    );
    connected = false;
    // Only report on close if we were actually connected and haven't reported yet
    if (wasEverConnected && !hasReported) {
      report(lastPos, lastDuration, false);
      void teardown();
    } else if (!wasEverConnected) {
      // This was a failed initial connection attempt.
      // Do nothing — the retry in sock.on("error") will handle it.
    } else {
      void teardown();
    }
  });
}

attemptConnect();
