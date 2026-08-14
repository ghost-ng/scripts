const HELP_TEXT = [
  "Ares Proxy - standalone inspection and forwarding proxy",
  "",
  "Usage: node proxy.js [options]",
  "",
  "Options:",
  "  -h, --help                 Show this help and exit",
  "  --listen HOST:PORT         Proxy listener (default 127.0.0.1:8787)",
  "  --gui [HOST:PORT]          Enable GUI (default 127.0.0.1:8790)",
  "  --forward HOST:PORT        Override the gateway destination",
  "  --forwarding               Use --forward as an upstream HTTP proxy",
  "",
  "Forwarding modes:",
  "  --forward alone overrides origin-form gateway destinations.",
  "  --forwarding chains all HTTP, HTTPS, and CONNECT traffic through",
  "  the unauthenticated HTTP proxy specified by --forward/FORWARD_TARGET.",
  "",
  "Environment:",
  "  PROXY_HOST, PROXY_PORT, GUI, GUI_BIND, FORWARD_TARGET, FORWARDING",
  "  DEFAULT_PROVIDER, ANTHROPIC_ENDPOINT, OPENAI_ENDPOINT,",
  "  OPENAI_CHATGPT_ENDPOINT, NEXT_HOP_ENDPOINT",
  "  ANTHROPIC_API_KEY, OPENAI_API_KEY, API_KEY",
  "  DATA_LOG, BODY_DIR, BODY_CAP, BODY_KEEP, RULES_FILE",
  "  GUI_CONFIG_FILE, DEBUG_BODIES, DEBUG_CAP, DUMP_PROMPT,",
  "  DISABLE_UPSTREAM_WS",
  "",
  "Precedence: CLI > environment > persisted GUI config > defaults.",
  "",
  "Examples:",
  "  node proxy.js",
  "  node proxy.js --gui",
  "  node proxy.js --forward 10.13.37.5:8080",
  "  node proxy.js --forward 10.13.37.5:8080 --forwarding",
  "",
  "WARNING: The GUI has no authentication. Keep its default loopback bind",
  "unless you intentionally accept exposure on a trusted network."
].join("\n");

function isHelpRequest(argv) {
  return argv.includes("--help") || argv.includes("-h");
}

function unknownCliOption(argv) {
  const exact = new Set(["-h", "--help", "--listen", "--gui", "--forward", "--forwarding"]);
  return argv.find((arg) =>
    arg.startsWith("-") &&
    !exact.has(arg) &&
    !arg.startsWith("--listen=") &&
    !arg.startsWith("--gui=") &&
    !arg.startsWith("--forward=")
  ) || null;
}

if (require.main === module) {
  const earlyArgv = process.argv.slice(2);
  if (isHelpRequest(earlyArgv)) {
    process.stdout.write(HELP_TEXT + "\n");
    process.exit(0);
  }
  const unknown = unknownCliOption(earlyArgv);
  if (unknown) {
    process.stderr.write("Unknown option: " + unknown + "\nUse --help for usage.\n");
    process.exit(1);
  }
}

const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const tls = require("tls");
const fs = require("fs");

function runtimeStoragePath(explicit, privilegedPath, localName, options = {}) {
  if (explicit) return explicit;
  const cwd = options.cwd || process.cwd();
  const canWrite = options.canWrite || ((candidate) => {
    try {
      const probe = fs.existsSync(candidate) ? candidate : path.dirname(candidate);
      fs.accessSync(probe, fs.constants.W_OK);
      return true;
    } catch (_) {
      return false;
    }
  });
  return canWrite(privilegedPath)
    ? privilegedPath
    : path.resolve(cwd, localName);
}

// --- Option parsing ------------------------------------------------

class OptionError extends Error {
  constructor(message) {
    super(message);
    this.name = "OptionError";
  }
}

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new OptionError(label + " has an invalid port: \"" + value + "\"");
  }
  return port;
}

function parseAddress(spec, defaults = { host: "127.0.0.1", port: 0 }) {
  if (typeof spec !== "string" || !spec.trim()) {
    throw new OptionError("Address must be a non-empty HOST:PORT value");
  }
  const value = spec.trim();
  let host;
  let portText;

  if (value.startsWith("[")) {
    const match = value.match(/^\[([^\]]+)\]:(\d+)$/);
    if (!match) throw new OptionError("Invalid bracketed IPv6 address: \"" + value + "\"");
    host = match[1];
    portText = match[2];
  } else {
    const colonCount = (value.match(/:/g) || []).length;
    if (colonCount > 1) {
      throw new OptionError("IPv6 addresses must use bracket notation: \"" + value + "\"");
    }
    if (colonCount === 0) {
      host = defaults.host;
      portText = value;
    } else {
      const parts = value.split(":");
      const left = parts[0];
      const right = parts[1];
      if (!left && right) {
        host = defaults.host;
        portText = right;
      } else if (/^\d+$/.test(left) && right && !/^\d+$/.test(right)) {
        host = right;
        portText = left;
      } else {
        host = left;
        portText = right;
      }
    }
  }

  if (!host || !portText) throw new OptionError("Invalid address: \"" + value + "\"");
  if (/\s/.test(host) || /[/?#]/.test(host)) {
    throw new OptionError("Invalid host in address: \"" + value + "\"");
  }
  return { host, port: parsePort(portText, "Address \"" + value + "\"") };
}

function parseBoolean(value, label) {
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  throw new OptionError(label + " must be a boolean (1/0, true/false, yes/no, on/off)");
}

function loadPersistedConfig(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function readCli(argv) {
  const cli = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (name) => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new OptionError(name + " requires an address");
      }
      index += 1;
      return value;
    };

    if (arg === "--listen") cli.listen = takeValue("--listen");
    else if (arg.startsWith("--listen=")) cli.listen = arg.slice(9);
    else if (arg === "--gui") {
      cli.guiEnabled = true;
      if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
        cli.guiBind = argv[index + 1];
        index += 1;
      }
    } else if (arg.startsWith("--gui=")) {
      cli.guiEnabled = true;
      cli.guiBind = arg.slice(6);
    } else if (arg === "--forward") cli.forwardTarget = takeValue("--forward");
    else if (arg.startsWith("--forward=")) cli.forwardTarget = arg.slice(10);
    else if (arg === "--forwarding") cli.forwarding = true;
    else throw new OptionError("Unknown option: " + arg);
  }
  return cli;
}

function parseProxyOptions(argv = [], env = {}, persisted = {}) {
  const cli = readCli(argv);
  const envListenSet = env.PROXY_HOST !== undefined || env.PROXY_PORT !== undefined;
  const listenBase = {
    host: env.PROXY_HOST || "127.0.0.1",
    port: parsePort(env.PROXY_PORT || 8787, "PROXY_PORT"),
  };
  const listen = cli.listen ? parseAddress(cli.listen, listenBase) : listenBase;

  const envGuiSet = env.GUI !== undefined || env.GUI_BIND !== undefined;
  const guiEnabled = cli.guiEnabled !== undefined
    ? cli.guiEnabled
    : env.GUI !== undefined ? parseBoolean(env.GUI, "GUI") : false;
  const guiSpec = cli.guiBind || env.GUI_BIND || "127.0.0.1:8790";
  const guiBind = parseAddress(guiSpec, { host: "127.0.0.1", port: 8790 });

  const envForwardSet = env.FORWARD_TARGET !== undefined;
  const forwardSpec = cli.forwardTarget !== undefined
    ? cli.forwardTarget
    : envForwardSet ? env.FORWARD_TARGET : persisted.forwardTarget;
  const forwardTarget = forwardSpec
    ? parseAddress(forwardSpec, { host: "127.0.0.1", port: 8080 })
    : null;

  const envForwardingSet = env.FORWARDING !== undefined;
  const forwarding = cli.forwarding !== undefined
    ? cli.forwarding
    : envForwardingSet
      ? parseBoolean(env.FORWARDING, "FORWARDING")
      : parseBoolean(persisted.forwarding || false, "persisted forwarding");
  if (forwarding && !forwardTarget) {
    throw new OptionError("Forwarding mode requires --forward or FORWARD_TARGET");
  }

  return {
    listen,
    gui: { enabled: guiEnabled, ...guiBind },
    forwardTarget,
    forwarding,
    guiConfigFile: env.GUI_CONFIG_FILE || path.resolve(process.cwd(), "proxy-gui-config.json"),
    locks: {
      listen: cli.listen !== undefined || envListenSet,
      gui: cli.guiEnabled !== undefined || envGuiSet,
      forwardTarget: cli.forwardTarget !== undefined || envForwardSet,
      forwarding: cli.forwarding !== undefined || envForwardingSet,
    },
  };
}


// --- Runtime forwarding ------------------------------------------------

function copyTarget(target) {
  return target ? { host: target.host, port: Number(target.port) } : null;
}

function createRuntimeConfig(initial = {}) {
  let state = {
    forwardTarget: copyTarget(initial.forwardTarget),
    forwarding: Boolean(initial.forwarding),
  };

  return {
    snapshot() {
      return { ...state, forwardTarget: copyTarget(state.forwardTarget) };
    },
    update(patch = {}) {
      const next = { ...state };
      if (Object.prototype.hasOwnProperty.call(patch, "forwardTarget")) {
        next.forwardTarget = copyTarget(patch.forwardTarget);
      }
      if (Object.prototype.hasOwnProperty.call(patch, "forwarding")) {
        next.forwarding = Boolean(patch.forwarding);
      }
      if (next.forwarding && !next.forwardTarget) {
        throw new Error("Forwarding mode requires a forward target");
      }
      state = next;
      return this.snapshot();
    },
  };
}

function selectHttpDispatch({ target, providerTarget, runtime }) {
  const config = runtime.snapshot();
  if (target.isGateway && config.forwardTarget && !config.forwarding) {
    return {
      ...config.forwardTarget,
      client: http,
      path: target.path,
      isGateway: true,
      provider: providerTarget.provider,
      forwardMode: "destination",
      logicalDest: providerTarget.host,
    };
  }
  return {
    ...providerTarget,
    forwardMode: config.forwardTarget && config.forwarding ? "chain" : "automatic",
    logicalDest: providerTarget.host,
  };
}

function formatAuthority(host, port) {
  const printableHost = host.includes(":") ? "[" + host + "]" : host;
  return printableHost + ":" + port;
}


// --- HTTP proxy chaining ------------------------------------------------

function authority(host, port) {
  return (host.includes(":") ? "[" + host + "]" : host) + ":" + port;
}

function absoluteUrl(target, requestPath) {
  const scheme = target.client === https ? "https" : "http";
  const defaultPort = scheme === "https" ? 443 : 80;
  const host = target.port === defaultPort ? target.host : authority(target.host, target.port);
  const path = requestPath.startsWith("/") ? requestPath : "/" + requestPath;
  return scheme + "://" + host + path;
}

function connectThroughHttpProxy(proxy, targetAuthority, callback) {
  let settled = false;
  const done = (error, socket, head) => {
    if (settled) {
      if (socket) socket.destroy();
      return;
    }
    settled = true;
    callback(error, socket, head);
  };
  const req = http.request({
    hostname: proxy.host,
    port: proxy.port,
    method: "CONNECT",
    path: targetAuthority,
    headers: { host: targetAuthority },
  });
  req.on("connect", (res, socket, head) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      socket.destroy();
      const error = new Error("Upstream proxy rejected CONNECT with " + res.statusCode);
      error.statusCode = res.statusCode;
      done(error);
      return;
    }
    done(null, socket, head);
  });
  req.on("error", (error) => done(error));
  req.end();
  return req;
}

function requestThroughHttpProxy(proxy, target, options, onResponse) {
  if (target.client !== https) {
    return http.request({
      hostname: proxy.host,
      port: proxy.port,
      method: options.method,
      path: absoluteUrl(target, options.path),
      headers: options.headers,
    }, onResponse);
  }

  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (_options, callback) => {
    const targetAuthority = authority(target.host, target.port);
    connectThroughHttpProxy(proxy, targetAuthority, (error, socket, head) => {
      if (error) return callback(error);
      if (head && head.length) socket.unshift(head);
      const secure = tls.connect({
        socket,
        servername: net.isIP(target.host) ? undefined : target.host,
      });
      secure.once("secureConnect", () => callback(null, secure));
      secure.once("error", callback);
    });
  };
  return https.request({
    hostname: target.host,
    port: target.port,
    method: options.method,
    path: options.path,
    headers: options.headers,
    agent,
  }, onResponse);
}

function requestClient(target, runtime) {
  const config = runtime.snapshot();
  if (!config.forwarding || !config.forwardTarget) return target.client;
  return {
    request(options, onResponse) {
      return requestThroughHttpProxy(config.forwardTarget, target, options, onResponse);
    },
  };
}

function installConnectHandler(server, runtime, logger = console.error) {
  server.on("connect", (req, clientSocket, head) => {
    const targetAuthority = req.url || "";
    const split = targetAuthority.lastIndexOf(":");
    const host = split === -1 ? targetAuthority : targetAuthority.slice(0, split);
    const port = split === -1 ? 443 : Number(targetAuthority.slice(split + 1)) || 443;
    if (!host) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    let upstream;
    let established = false;
    const teardown = (error) => {
      if (error) logger("tunnel error " + host + ":" + port + ": " + error.message);
      if (!established && clientSocket.writable) {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      } else {
        clientSocket.destroy();
      }
      if (upstream) upstream.destroy();
    };
    const connected = (socket, proxyHead) => {
      upstream = socket;
      established = true;
      if (proxyHead && proxyHead.length) upstream.unshift(proxyHead);
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
      upstream.on("error", teardown);
      upstream.on("close", () => clientSocket.destroy());
    };

    const config = runtime.snapshot();
    if (config.forwarding && config.forwardTarget) {
      connectThroughHttpProxy(config.forwardTarget, authority(host, port), (error, socket, proxyHead) => {
        if (error) teardown(error);
        else connected(socket, proxyHead);
      });
    } else {
      upstream = net.connect(port, host, () => connected(upstream));
      upstream.on("error", teardown);
    }
    clientSocket.on("error", teardown);
    clientSocket.on("close", () => { if (upstream) upstream.destroy(); });
  });
}


// --- GUI API server ------------------------------------------------

const BODY_KINDS = new Set(["req", "res", "sys", "syso", "usr", "usro", "out"]);
const JSON_LIMIT = 64 * 1024;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function apiError(res, status, code, message) {
  json(res, status, { error: { code, message } });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > JSON_LIMIT) {
        const error = new Error("JSON body exceeds 64 KiB");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (_) {
        const error = new Error("Request body must be valid JSON");
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function printableAddress(target) {
  if (!target) return null;
  const host = target.host.includes(":") ? "[" + target.host + "]" : target.host;
  return host + ":" + target.port;
}

function readSessions(filename, limit = 400) {
  let lines;
  try {
    lines = fs.readFileSync(filename, "utf8").trim().split("\n").filter(Boolean).slice(-limit * 3);
  } catch (_) {
    return [];
  }
  const sessions = new Map();
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }
    if (!entry || !entry.sid) continue;
    const current = sessions.get(entry.sid) || { sid: entry.sid, request: null, response: null };
    if (entry.dir === "req") current.request = entry;
    if (entry.dir === "res") current.response = entry;
    current.ts = entry.ts || current.ts;
    sessions.set(entry.sid, current);
  }
  return Array.from(sessions.values()).slice(-limit).reverse();
}

function readRules(filename) {
  try {
    const rules = JSON.parse(fs.readFileSync(filename, "utf8"));
    return Array.isArray(rules) ? rules : [];
  } catch (_) {
    return [];
  }
}

function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 1000) {
    throw new Error("rules must be an array containing at most 1000 entries");
  }
  return rules.map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error("rule " + index + " must be an object");
    }
    const match = String(rule.match || "");
    if (!match || match.length > 10000) throw new Error("rule " + index + " has an invalid match value");
    if (rule.regex) {
      try { new RegExp(match, "g"); }
      catch (error) { throw new Error("rule " + index + " has invalid regex: " + error.message); }
    }
    if (rule.scope !== undefined && !["all", "system", "user"].includes(rule.scope)) throw new Error("rule " + index + " has an invalid scope");
    if (rule.provider !== undefined && !["both", "anthropic", "openai"].includes(rule.provider)) throw new Error("rule " + index + " has an invalid provider");
    return {
      id: String(rule.id || (Date.now().toString(36) + "-" + index)).slice(0, 80),
      match,
      replace: String(rule.replace || "").slice(0, 10000),
      ...(rule.scope !== undefined ? { scope: rule.scope } : {}),
      ...(rule.provider !== undefined ? { provider: rule.provider } : {}),
      ...(rule.regex !== undefined ? { regex: Boolean(rule.regex) } : {}),
      enabled: rule.enabled !== false,
    };
  });
}

const GUI_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Ares Proxy Console</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <div class="scanlines" aria-hidden="true"></div>
  <header class="app-header">
    <a class="brand" href="#console" aria-label="Ares Proxy home">
      <span class="brand-mark" aria-hidden="true">A</span>
      <span><strong>ARES PROXY</strong><small>STANDALONE INSPECTION</small></span>
    </a>
    <nav class="tabs" aria-label="Primary">
      <button id="console-tab" class="tab active" role="tab" aria-selected="true" aria-controls="console-panel">Console</button>
      <button id="command-tab" class="tab" role="tab" aria-selected="false" aria-controls="command-panel">Command Center</button>
    </nav>
    <div class="header-status mono" aria-label="Listener status">
      <span><small>PROXY</small><b id="proxy-bind">—</b><i class="live-dot"></i></span>
      <span><small>GUI BIND</small><b id="gui-bind">—</b><i class="live-dot"></i></span>
    </div>
  </header>

  <main>
    <section id="console-panel" class="tab-panel console-grid" role="tabpanel" aria-labelledby="console-tab">
      <aside class="operations panel">
        <div class="panel-title"><span>OPERATIONS</span><small>LIVE SIGNAL</small></div>
        <div id="traffic-radar" class="radar" aria-label="Animated traffic radar">
          <span class="radar-axis north">000</span><span class="radar-axis east">090</span>
          <span class="radar-axis south">180</span><span class="radar-axis west">270</span>
          <div id="radar-contacts" class="radar-contacts" aria-live="polite"></div>
          <div class="radar-sweep" aria-hidden="true"></div>
        </div>
        <dl class="metrics mono">
          <div><dt>REQUESTS</dt><dd id="metric-requests">0</dd></div>
          <div><dt>ACTIVE</dt><dd id="metric-active">0</dd></div>
          <div><dt>FAILURES</dt><dd id="metric-failures">0</dd></div>
          <div><dt>LATENCY P50</dt><dd id="metric-latency">—</dd></div>
        </dl>
        <div class="mini-section"><h3>RECENT FAILURES</h3><ol id="failure-list" class="failure-list mono"><li>No failures detected</li></ol></div>
        <div class="health mono"><span><small>ENGINE</small><b>ONLINE</b></span><span><small>CAPTURE</small><b id="capture-state">FOLLOW</b></span></div>
      </aside>

      <section class="traffic panel">
        <div class="traffic-heading">
          <div><small>INTERCEPTED COMMUNICATIONS</small><h1>LIVE TRAFFIC STREAM</h1></div>
          <span id="stream-count" class="count mono">0 SESSIONS</span>
        </div>
        <div class="stream-tools">
          <label class="search"><span class="sr-only">Filter sessions</span><input id="session-filter" type="search" placeholder="Filter method, path, model, status, destination or content…"></label>
          <button id="follow-toggle" class="btn signal" type="button" aria-pressed="true">● FOLLOW</button>
          <label class="sort-control mono">SORT<select id="session-sort-field"><option value="time">TIME</option><option value="status">STATUS</option><option value="latency">LATENCY</option><option value="method">METHOD</option><option value="provider">PROVIDER / MODEL</option></select></label>
          <button id="session-sort-direction" class="btn" type="button" aria-label="Descending">DESC</button>
          <button id="export-sessions" class="btn" type="button">EXPORT</button>
          <button id="clear-sessions" class="btn danger" type="button">CLEAR</button>
        </div>
        <div class="session-head mono" aria-hidden="true"><span>TIME</span><span>METHOD</span><span>PATH / DESTINATION</span><span>STATUS</span><span>DURATION</span></div>
        <div id="session-stream" class="session-stream" aria-live="polite"><div class="empty-state">Awaiting intercepted traffic<span>Radar acquisition is active</span></div></div>
      </section>

      <aside class="context panel">
        <div class="panel-title"><span>CONTEXT</span><small>ROUTING</small></div>
        <section><h3>FORWARDING TARGET</h3><dl class="context-list mono"><div><dt>TARGET</dt><dd id="context-target">AUTOMATIC</dd></div><div><dt>MODE</dt><dd id="context-mode">PROVIDER ROUTING</dd></div><div><dt>STATE</dt><dd id="context-state" class="signal-text">ACTIVE</dd></div></dl></section>
        <section><h3>PROVIDER ROUTES</h3><dl id="context-providers" class="context-list mono"></dl></section>
        <div class="context-note"><b>CONFIGURATION</b><p>Edit destinations, forwarding behavior, inspection retention and rewrite rules in Command Center.</p><button class="text-action" data-open-command type="button">OPEN COMMAND CENTER →</button></div>
      </aside>
    </section>

    <section id="command-panel" class="tab-panel command" role="tabpanel" aria-labelledby="command-tab" hidden>
      <div id="app-status" class="announcement" role="status" aria-live="polite"><span>●</span><p>Configuration interface ready.</p></div>
      <div class="command-grid">
        <section class="settings-panel network"><div class="section-head"><h2>NETWORK</h2><small>RESTART BOUND</small></div><div class="field-row"><label>Proxy listener</label><input id="listener-display" class="mono" readonly><span class="lock">READ ONLY</span></div><div class="field-row"><label>GUI bind</label><input id="gui-display" class="mono" readonly><span class="lock">READ ONLY</span></div><p class="help">Listener and GUI bind changes require a process restart. Supply them through CLI or environment options.</p></section>

        <section class="settings-panel forwarding"><div class="section-head"><h2>FORWARDING</h2><small id="forward-lock-state">RUNTIME EDITABLE</small></div>
          <div class="mode-line"><span>Mode</span><div id="forwarding-mode" class="segmented" role="group" aria-label="Forwarding mode"><button type="button" data-mode="destination" class="active">DESTINATION OVERRIDE</button><button type="button" data-mode="chain">UPSTREAM PROXY CHAIN</button></div></div>
          <div class="target-line"><label for="forward-target">Target (IP or hostname:port)</label><div><input id="forward-target" class="mono" placeholder="10.13.37.5:8080"><button id="test-forward" class="btn" type="button">TEST CONNECTION</button></div></div>
          <p id="mode-description" class="help">Origin-form API requests are sent directly to this target. Absolute-form and CONNECT traffic retain client-selected destinations.</p>
          <div class="actions"><button id="apply-config" class="btn primary" type="button">APPLY CONFIGURATION</button><button id="disable-forward" class="btn danger" type="button">DISABLE FORWARDING</button></div>
        </section>

        <section id="provider-settings" class="settings-panel providers"><div class="section-head"><h2>PROVIDERS</h2><small>NO KEYS EXPOSED</small></div><label>Anthropic endpoint<input id="provider-anthropic" class="mono" type="url"></label><label>OpenAI endpoint<input id="provider-openai" class="mono" type="url"></label><label>ChatGPT Codex endpoint<input id="provider-chatgpt" class="mono" type="url"></label><p class="help">Endpoint changes affect subsequent gateway requests. Credentials remain environment-only.</p></section>

        <section id="inspection-settings" class="settings-panel inspection"><div class="section-head"><h2>INSPECTION</h2><small>CAPTURE POLICY</small></div><div class="switch-line"><span><b>Debug body logging</b><small>Write full redacted headers and bodies to the process log.</small></span><button id="debug-toggle" class="switch" type="button" role="switch" aria-checked="false"><i></i></button></div><label>Body size cap (bytes)<input id="body-cap" class="mono" type="number" min="1024"></label><label>Retained body files<input id="body-keep" class="mono" type="number" min="1"></label><dl class="paths mono"><div><dt>DATA LOG</dt><dd id="data-log-path">—</dd></div><div><dt>BODY STORE</dt><dd id="body-dir-path">—</dd></div><div><dt>RULES FILE</dt><dd id="rules-file-path">—</dd></div></dl></section>

        <section class="settings-panel rules"><div class="rules-toolbar"><div class="section-head"><h2>REWRITE RULES</h2><small id="rules-count">0 RULES</small></div><div><button id="add-rule" class="btn" type="button">＋ ADD RULE</button><button id="import-rules" class="btn" type="button">IMPORT</button><button id="export-rules" class="btn" type="button">EXPORT</button><input id="rules-file-input" type="file" accept="application/json,.json" hidden></div></div>
          <div class="table-wrap"><table id="rules-table"><thead><tr><th>ENABLED</th><th>PROVIDER</th><th>SCOPE</th><th>FIND</th><th>REPLACE</th><th>TYPE</th><th></th></tr></thead><tbody></tbody></table></div>
          <div id="rule-editor" class="rule-editor" hidden><label>Find<input id="rule-match" class="mono"></label><label>Replace<input id="rule-replace" class="mono"></label><label>Provider<select id="rule-provider"><option value="both">Both</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label><label>Scope<select id="rule-scope"><option value="all">All prompts</option><option value="system">System</option><option value="user">User</option></select></label><label class="check"><input id="rule-regex" type="checkbox"> Regex</label><button id="save-rule" class="btn primary" type="button">SAVE RULE</button><button id="cancel-rule" class="btn" type="button">CANCEL</button></div>
        </section>
      </div>
    </section>
  </main>
  <div id="toast-region" class="toasts" aria-live="polite"></div>
  <script src="/assets/app.js" defer></script>
</body>
</html>
`;

const GUI_CSS = String.raw`:root{--bg:#050607;--surface:#090b0d;--surface-2:#0d1012;--surface-3:#111416;--line:#342027;--line-hot:#8a202e;--signal:#ff3349;--signal-soft:#ff6576;--text:#eee8e9;--muted:#8f8588;--dim:#5d5658;--ok:#ff5266;--shadow:0 0 28px rgba(255,31,58,.12);--mono:"Cascadia Mono","SFMono-Regular",Consolas,monospace;--sans:Inter,"Segoe UI",system-ui,sans-serif}
[hidden]{display:none!important}*{box-sizing:border-box}html,body{min-height:100%;margin:0;background:var(--bg);color:var(--text);font-family:var(--sans)}body{background-image:radial-gradient(circle at 12% 16%,rgba(128,11,28,.13),transparent 27%),linear-gradient(rgba(255,255,255,.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.012) 1px,transparent 1px);background-size:auto,28px 28px,28px 28px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:90;background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(255,31,54,.018) 4px);mix-blend-mode:screen}.mono{font-family:var(--mono)}button,input,select{font:inherit;color:inherit}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.app-header{height:72px;display:flex;align-items:stretch;border-bottom:1px solid var(--line-hot);background:rgba(7,8,9,.96);position:sticky;top:0;z-index:50;box-shadow:0 10px 35px rgba(0,0,0,.45)}.brand{width:310px;padding:0 24px;display:flex;gap:14px;align-items:center;color:var(--text);text-decoration:none;border-right:1px solid var(--line)}.brand-mark{width:36px;height:40px;display:grid;place-items:center;color:var(--signal);font:900 31px/1 var(--mono);transform:skew(-8deg);text-shadow:0 0 20px rgba(255,35,63,.5)}.brand strong{font:800 19px/1.1 var(--mono);letter-spacing:.12em}.brand small{display:block;color:var(--signal-soft);font:700 11px/1.8 var(--mono);letter-spacing:.13em}.tabs{display:flex;margin-left:32px}.tab{min-width:176px;border:0;border-left:1px solid transparent;border-right:1px solid transparent;background:transparent;color:#aaa1a3;font:700 12px var(--mono);letter-spacing:.07em;cursor:pointer}.tab:hover{color:#fff;background:#100c0e}.tab.active{color:var(--signal-soft);border-color:var(--line-hot);background:linear-gradient(180deg,rgba(101,17,31,.22),rgba(22,10,13,.2));box-shadow:inset 0 -2px var(--signal),0 0 28px rgba(255,36,61,.1)}.header-status{margin-left:auto;display:flex;align-items:center}.header-status>span{min-width:190px;height:44px;padding:3px 22px;display:grid;grid-template-columns:1fr auto;align-content:center;border-left:1px solid var(--line);position:relative}.header-status small{grid-column:1/-1;color:var(--muted);font-size:11px;letter-spacing:.13em}.header-status b{font-size:11px;margin-top:4px}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--signal);align-self:center;box-shadow:0 0 9px var(--signal)}
.tab-panel{min-height:calc(100vh - 72px)}.console-grid{display:grid;grid-template-columns:282px minmax(520px,1fr) 276px;gap:10px;padding:10px}.panel,.settings-panel{background:linear-gradient(145deg,rgba(14,16,18,.97),rgba(7,8,9,.97));border:1px solid var(--line);box-shadow:0 10px 35px rgba(0,0,0,.22)}.panel-title,.section-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:14px 16px;color:var(--signal-soft);font:800 12px var(--mono);letter-spacing:.12em}.panel-title small,.section-head small{color:var(--dim);font-size:10px}
.operations{padding-bottom:12px}.radar{width:218px;aspect-ratio:1;margin:22px auto 20px;border:1px solid #7a2230;border-radius:50%;position:relative;overflow:visible;background:repeating-radial-gradient(circle,transparent 0 31px,rgba(187,31,49,.28) 32px 33px),linear-gradient(90deg,transparent 49.5%,rgba(173,28,46,.34) 50%,transparent 50.5%),linear-gradient(transparent 49.5%,rgba(173,28,46,.34) 50%,transparent 50.5%);box-shadow:inset 0 0 38px rgba(255,20,47,.1),0 0 28px rgba(255,20,47,.08)}.radar:before,.radar:after{content:"";position:absolute;inset:23px;border:1px dashed rgba(255,55,76,.18);border-radius:50%}.radar:after{inset:68px}.radar-sweep{position:absolute;inset:2px;border-radius:50%;background:conic-gradient(from 2deg,transparent 0 315deg,rgba(255,33,57,.02) 330deg,rgba(255,40,64,.3) 353deg,var(--signal) 359.5deg,transparent 360deg);animation:radar-sweep 4.2s linear infinite}.radar-axis{position:absolute;color:var(--signal);font:700 10px var(--mono);z-index:2}.radar-axis.north{top:-16px;left:48%}.radar-axis.east{right:-21px;top:48%}.radar-axis.south{bottom:-17px;left:47%}.radar-axis.west{left:-21px;top:48%}.radar-contacts{position:absolute;inset:0;z-index:3;pointer-events:none}.radar-contact{position:absolute;width:6px;height:6px;border-radius:50%;transform:translate(-50%,-50%);background:var(--signal-soft);box-shadow:0 0 9px var(--signal);transition:opacity .35s}.radar-contact.active{width:8px;height:8px;background:#fff0f2;box-shadow:0 0 8px #fff,0 0 20px var(--signal);animation:contact-pulse 1.2s ease-in-out infinite}.radar-contact.error{background:#ff1638;box-shadow:0 0 6px #fff,0 0 18px #ff1638}@keyframes radar-sweep{to{transform:rotate(360deg)}}@keyframes contact-pulse{50%{transform:translate(-50%,-50%) scale(1.7);filter:brightness(1.4)}}.metrics{margin:0 10px;border-top:1px solid var(--line)}.metrics div{display:flex;justify-content:space-between;padding:10px 8px;border-bottom:1px solid #24171b}.metrics dt{font-size:11px;color:var(--muted)}.metrics dd{margin:0;color:var(--signal-soft);font-size:11px}.mini-section{padding:15px 18px}.mini-section h3,.context h3{font:800 11px var(--mono);letter-spacing:.1em;color:var(--signal);margin:0 0 12px}.failure-list{padding-left:0;list-style:none;color:#9c8b8f;font-size:11px;line-height:2}.health{margin:0 10px;display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line)}.health span{padding:11px}.health span+span{border-left:1px solid var(--line)}.health small{display:block;color:var(--dim);font-size:10px}.health b{color:var(--signal-soft);font-size:11px}
.traffic{min-width:0;overflow:hidden}.traffic-heading{height:66px;display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--line)}.traffic-heading small{color:var(--signal);font:700 10px var(--mono);letter-spacing:.12em}.traffic-heading h1{font:800 17px var(--mono);letter-spacing:.06em;margin:3px 0}.count{font-size:11px;color:var(--muted)}.stream-tools{display:grid;grid-template-columns:minmax(220px,1fr) auto auto auto auto auto;gap:7px;padding:11px;border-bottom:1px solid var(--line)}.sort-control{display:flex;align-items:center;gap:7px;color:#776b6e;font:700 10px var(--mono)}.sort-control select{height:34px;min-width:108px;border:1px solid #3a292e;background:#07090a;color:#c7bec0;padding:0 8px;font:700 10px var(--mono)}.search input,.field-row input,.target-line input,.providers input,.inspection input,.rule-editor input,.rule-editor select{width:100%;height:36px;border:1px solid #3a292e;background:#07090a;color:var(--text);padding:0 11px;outline:none;font-size:12px}.search input:focus,input:focus,select:focus,button:focus-visible{border-color:var(--signal)!important;box-shadow:0 0 0 2px rgba(255,42,67,.18),var(--shadow);outline:none}.btn{height:34px;padding:0 12px;border:1px solid #423036;background:#111416;color:#c7bec0;font:700 11px var(--mono);letter-spacing:.06em;cursor:pointer}.btn:hover{border-color:#92505b;color:#fff;background:#171113}.btn.signal,.btn.primary{border-color:#a32436;color:#ff8795;background:#300e16;box-shadow:0 0 18px rgba(255,31,56,.09)}.btn.danger{color:#c87581}.session-head,.session-row{display:grid;grid-template-columns:84px 68px minmax(200px,1fr) 70px 76px;gap:10px;align-items:center}.session-head{padding:10px 18px;color:#766b6d;font-size:10px;border-bottom:1px solid var(--line)}.session-stream{height:calc(100vh - 232px);min-height:460px;overflow:auto}.session{border-bottom:1px solid #2b1b20}.session-row{width:100%;padding:13px 18px;border:0;background:transparent;color:#cfc5c7;text-align:left;font:12px var(--mono);cursor:pointer}.session-row:hover,.session[open]>.session-row{background:#160d10}.session-row .method,.session-row .status{color:var(--signal-soft);font-weight:700}.session-row .route{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-detail{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid #3b2027;background:#080a0b}.payload{min-width:0;padding:14px}.payload+.payload{border-left:1px solid var(--line)}.payload h3{display:flex;justify-content:space-between;gap:8px;margin:0 0 10px;color:var(--signal);font:800 11px var(--mono)}.payload:nth-child(n+3){border-top:1px solid var(--line)}.payload:nth-child(odd){border-left:0}.change-state{font-size:10px;color:#766b6e}.change-state.changed{color:var(--signal-soft);text-shadow:0 0 8px rgba(255,51,73,.45)}.payload pre{max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#b8adaf;font:11px/1.7 var(--mono);margin:0}.empty-state{height:100%;display:grid;place-content:center;text-align:center;color:#776b6e;font:700 11px var(--mono);letter-spacing:.08em}.empty-state span{display:block;font-size:10px;margin-top:8px;color:#51484a}
.context{padding-bottom:18px}.context section{padding:18px;border-bottom:1px solid var(--line)}.context-list{margin:0}.context-list div{padding:8px 0}.context-list dt{color:var(--dim);font-size:10px}.context-list dd{margin:4px 0 0;color:#c8bec0;font-size:11px;word-break:break-all}.signal-text{color:var(--signal-soft)!important}.context-note{margin:18px;border:1px solid var(--line-hot);padding:14px;background:rgba(79,12,23,.12)}.context-note b{font:800 11px var(--mono);color:var(--signal)}.context-note p{color:#8f8184;font-size:12px;line-height:1.5}.text-action{border:0;background:none;padding:0;color:var(--signal-soft);font:700 10px var(--mono);cursor:pointer}
.command{padding:12px}.announcement{min-height:40px;display:flex;align-items:center;gap:10px;border:1px solid var(--line-hot);background:rgba(70,12,22,.2);padding:0 14px;margin-bottom:10px;color:#c8bec0;font:12px var(--mono)}.announcement span{color:var(--signal)}.command-grid{display:grid;grid-template-columns:1fr 1.7fr;gap:10px}.settings-panel{padding:0 16px 16px}.settings-panel .section-head{margin:0 -16px 15px}.network{grid-column:1}.forwarding{grid-column:2}.providers{grid-column:1}.inspection{grid-column:2}.rules{grid-column:1/-1}.field-row{display:grid;grid-template-columns:140px 1fr 88px;gap:8px;align-items:center;margin:9px 0;font-size:12px}.field-row input{height:32px}.lock{font:700 10px var(--mono);color:#6d6265;border:1px solid #38272c;padding:7px;text-align:center}.help{color:#817679;font-size:11px;line-height:1.6;margin:12px 0 0}.mode-line,.target-line{margin-bottom:14px}.mode-line{display:flex;align-items:center;gap:28px;font-size:12px}.segmented{display:flex}.segmented button{height:34px;padding:0 17px;border:1px solid #3d2c31;background:#0a0c0d;color:#8f8587;font:700 10px var(--mono);cursor:pointer}.segmented button+button{border-left:0}.segmented button.active{color:#ff8896;border-color:#9f2939;background:#2f0e15;box-shadow:var(--shadow)}.target-line>label{display:block;font-size:11px;margin-bottom:7px;color:#aaa0a2}.target-line>div{display:grid;grid-template-columns:1fr auto;gap:8px}.actions{display:flex;gap:8px;margin-top:14px}.providers label,.inspection>label{display:grid;grid-template-columns:150px 1fr;align-items:center;margin:9px 0;color:#aaa0a2;font-size:11px}.providers input,.inspection input{height:32px}.switch-line{display:flex;justify-content:space-between;align-items:center;margin:10px 0}.switch-line b{font-size:11px}.switch-line small{display:block;color:#6f6668;font-size:10px;margin-top:4px}.switch{width:39px;height:20px;border:1px solid #4c343a;background:#0a0b0c;padding:2px;cursor:pointer}.switch i{display:block;width:14px;height:14px;background:#756c6e;transition:transform .2s,background .2s}.switch[aria-checked="true"]{border-color:var(--signal)}.switch[aria-checked="true"] i{transform:translateX(17px);background:var(--signal);box-shadow:0 0 10px var(--signal)}.paths{margin:14px 0 0;border-top:1px solid var(--line);font-size:10px}.paths div{display:grid;grid-template-columns:90px 1fr;padding:7px;border-bottom:1px solid #25191d}.paths dt{color:#6d6265}.paths dd{margin:0;color:#9c9093;overflow:hidden;text-overflow:ellipsis}.rules-toolbar{display:flex;justify-content:space-between;align-items:center}.rules-toolbar .section-head{border:0;margin-bottom:0}.table-wrap{overflow:auto;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font:11px var(--mono)}th{text-align:left;color:#706669;background:#0b0d0e;padding:9px;border-bottom:1px solid var(--line)}td{padding:9px;border-bottom:1px solid #25191d;color:#b7abad}td code{color:#ddd0d2}.rule-actions{display:flex;gap:6px;white-space:nowrap}.rule-editor{display:grid;grid-template-columns:1fr 1fr 130px 130px 130px auto auto;gap:8px;align-items:end;padding:12px;border:1px solid var(--line-hot);margin-top:9px}.rule-editor label{font-size:10px;color:#827679}.rule-editor input,.rule-editor select{display:block;margin-top:5px}.check{height:36px;display:flex;align-items:center;gap:8px;padding:0 10px;margin-top:5px;border:1px solid #3a292e;background:#07090a;cursor:pointer}.check input[type="checkbox"]{width:16px;height:16px;flex:0 0 16px;margin:0;padding:0;accent-color:var(--signal);box-shadow:none}.toasts{position:fixed;right:18px;bottom:18px;z-index:100;display:grid;gap:8px}.toast{border:1px solid var(--line-hot);background:#140c0f;padding:11px 14px;box-shadow:var(--shadow);font:11px var(--mono);color:#e3d9db}
@media(max-width:1120px){.console-grid{grid-template-columns:230px 1fr}.context{display:none}.brand{width:250px}.header-status>span{min-width:155px}.command-grid{grid-template-columns:1fr}.network,.forwarding,.providers,.inspection,.rules{grid-column:1}.rule-editor{grid-template-columns:1fr 1fr 1fr}}
@media(max-width:760px){.app-header{height:auto;min-height:64px;flex-wrap:wrap}.brand{width:100%;height:58px;border-bottom:1px solid var(--line)}.tabs{margin:0;order:3;width:100%;height:46px}.tab{flex:1;min-width:0}.header-status{display:none}.header-status>span{min-width:130px;padding:3px 10px}.console-grid{grid-template-columns:1fr;padding:7px}.operations{display:none}.stream-tools{grid-template-columns:1fr 1fr}.search{grid-column:1/-1}.session-head,.session-row{grid-template-columns:68px 54px minmax(130px,1fr) 54px}.session-head span:last-child,.session-row span:last-child{display:none}.session-stream{height:calc(100vh - 280px)}.session-detail{grid-template-columns:1fr}.payload+.payload{border-left:0;border-top:1px solid var(--line)}.command{padding:7px}.field-row,.providers label,.inspection>label{grid-template-columns:1fr}.rule-editor{grid-template-columns:1fr}.command-grid{display:block}.settings-panel{margin-bottom:8px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}.radar-sweep{animation:none;transform:rotate(38deg)}}
`;

const GUI_JS = String.raw`"use strict";

const $ = (id) => document.getElementById(id);
const state = { status: null, sessions: [], rules: [], editingRuleId: null, follow: true, sortField: "time", sortDirection: "desc", mode: "destination", timer: null, openSessions: new Set() };

async function api(route, options = {}) {
  const response = await fetch(route, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data && data.error ? data.error.message : "Request failed with " + response.status);
  return data;
}

function address(target) {
  if (!target) return "";
  const host = target.host.includes(":") ? "[" + target.host + "]" : target.host;
  return host + ":" + target.port;
}

function setStatus(message, error = false) {
  $("app-status").querySelector("p").textContent = message;
  $("app-status").classList.toggle("error", error);
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  $("toast-region").append(item);
  setTimeout(() => item.remove(), 3600);
}

function setTab(name) {
  const consoleActive = name === "console";
  $("console-panel").hidden = !consoleActive;
  $("command-panel").hidden = consoleActive;
  $("console-tab").classList.toggle("active", consoleActive);
  $("command-tab").classList.toggle("active", !consoleActive);
  $("console-tab").setAttribute("aria-selected", String(consoleActive));
  $("command-tab").setAttribute("aria-selected", String(!consoleActive));
  $("traffic-radar").classList.toggle("paused", !consoleActive);
  history.replaceState(null, "", consoleActive ? "#console" : "#command");
}

function populateStatus(data) {
  state.status = data;
  $("proxy-bind").textContent = address(data.listen);
  $("gui-bind").textContent = address(data.gui);
  $("listener-display").value = address(data.listen);
  $("gui-display").value = address(data.gui);
  const config = data.forwarding || {};
  $("forward-target").value = address(config.forwardTarget);
  state.mode = config.forwarding ? "chain" : "destination";
  updateModeUi();
  $("context-target").textContent = config.forwardTarget ? address(config.forwardTarget) : "AUTOMATIC";
  $("context-mode").textContent = !config.forwardTarget ? "PROVIDER ROUTING" : config.forwarding ? "UPSTREAM PROXY CHAIN" : "DESTINATION OVERRIDE";
  $("context-state").textContent = "ACTIVE";
  const providers = data.providers || {};
  $("provider-anthropic").value = providers.anthropic || "";
  $("provider-openai").value = providers.openai || "";
  $("provider-chatgpt").value = providers.openai_chatgpt || "";
  const providerList = $("context-providers");
  providerList.replaceChildren();
  for (const [name, endpoint] of Object.entries(providers)) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name.replace("openai_chatgpt", "CHATGPT CODEX").toUpperCase();
    dd.textContent = endpoint;
    row.append(dt, dd);
    providerList.append(row);
  }
  $("debug-toggle").setAttribute("aria-checked", String(Boolean(data.inspection && data.inspection.debugBodies)));
  $("body-cap").value = data.inspection && data.inspection.bodyCap || "";
  $("body-keep").value = data.inspection && data.inspection.bodyKeep || "";
  $("data-log-path").textContent = data.files && data.files.dataLog || "—";
  $("body-dir-path").textContent = data.files && data.files.bodyDir || "—";
  $("rules-file-path").textContent = data.files && data.files.rulesFile || "—";
  const locks = data.locks || {};
  $("forward-target").disabled = Boolean(locks.forwardTarget);
  $("forward-lock-state").textContent = locks.forwardTarget || locks.forwarding ? "CLI / ENV LOCKED" : "RUNTIME EDITABLE";
  document.querySelectorAll("[data-mode]").forEach((button) => { button.disabled = Boolean(locks.forwarding); });
}

function updateModeUi() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  $("mode-description").textContent = state.mode === "chain"
    ? "All outbound HTTP and HTTPS traffic is routed through this upstream HTTP proxy. CONNECT tunnels are chained through it."
    : "Origin-form API requests are sent directly to this target. Absolute-form and CONNECT traffic retain client-selected destinations.";
}

function sessionSearchText(session) {
  return JSON.stringify(session).toLowerCase();
}

function sessionSortValue(session, field) {
  const req = session.request || {};
  const res = session.response || {};
  if (field === "status") {
    const value = Number(res.status);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }
  if (field === "latency") {
    const value = Number(res.time_ms);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }
  if (field === "method") return String(req.method || "").toLowerCase();
  if (field === "provider") return (String(req.provider || "") + " " + String(req.model || "")).trim().toLowerCase();
  const value = Date.parse(req.ts || res.ts || session.ts || "");
  return Number.isFinite(value) ? value : 0;
}

function visibleSessions(sessions, filter, field, direction) {
  const needle = String(filter || "").trim().toLowerCase();
  const factor = direction === "asc" ? 1 : -1;
  return (sessions || [])
    .filter((session) => !needle || sessionSearchText(session).includes(needle))
    .slice()
    .sort((a, b) => {
      const av = sessionSortValue(a, field);
      const bv = sessionSortValue(b, field);
      let compared;
      if (typeof av === "number" && typeof bv === "number") compared = av - bv;
      else compared = String(av).localeCompare(String(bv));
      return compared * factor || String(a.sid || "").localeCompare(String(b.sid || ""));
    });
}

function hashSessionId(sid) {
  let hash = 2166136261;
  for (const char of String(sid || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isSessionActive(session) {
  const response = session && session.response;
  return !response || Boolean(response.streaming && !response.stream_complete);
}

function radarContact(session, now = Date.now()) {
  if (!session || !session.sid) return null;
  const req = session.request || {};
  const res = session.response || null;
  const active = isSessionActive(session);
  let completedAt = null;
  if (!active) {
    const parsed = Date.parse(res.ts || session.ts || req.ts || "");
    if (!Number.isFinite(parsed)) return null;
    completedAt = parsed;
    if (now - completedAt > 60000) return null;
  }

  const hash = hashSessionId(session.sid);
  const angle = (hash % 360) * Math.PI / 180;
  const ringRadius = 28 + ((hash >>> 9) % 58);
  const distance = ringRadius * 0.5;
  const status = Number(res && res.status);
  const failed = Boolean(res && (status >= 400 || res.error));
  const age = active ? 0 : Math.max(0, now - completedAt);
  const opacity = active ? 1 : Math.max(failed ? 0.35 : 0.18, 1 - age / 60000);
  const route = req.path || req.dest || "unknown route";
  const method = req.method || "REQUEST";
  return {
    sid: String(session.sid),
    left: (50 + Math.cos(angle) * distance).toFixed(2) + "%",
    top: (50 + Math.sin(angle) * distance).toFixed(2) + "%",
    state: active ? "active" : failed ? "error" : "success",
    opacity,
    sortTime: active ? Number.MAX_SAFE_INTEGER : completedAt,
    label: method + " " + route + " — " + (active ? "active" : failed ? "failed " + (res.status || "") : "completed " + (res.status || "")),
  };
}

function selectRadarContacts(sessions, now = Date.now()) {
  return (sessions || [])
    .map((session) => radarContact(session, now))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.state === "active" && b.state !== "active") return -1;
      if (a.state !== "active" && b.state === "active") return 1;
      return b.sortTime - a.sortTime || a.sid.localeCompare(b.sid);
    })
    .slice(0, 24);
}

function renderRadar(now = Date.now()) {
  const layer = $("radar-contacts");
  const contacts = selectRadarContacts(state.sessions, now);
  const existing = new Map(Array.from(layer.children).map((item) => [item.dataset.sid, item]));
  const keep = new Set();
  for (const contact of contacts) {
    let item = existing.get(contact.sid);
    if (!item) {
      item = document.createElement("span");
      item.dataset.sid = contact.sid;
      item.setAttribute("role", "img");
      layer.append(item);
    }
    keep.add(contact.sid);
    item.className = "radar-contact " + contact.state;
    item.style.left = contact.left;
    item.style.top = contact.top;
    item.style.opacity = String(contact.opacity);
    item.setAttribute("aria-label", contact.label);
    item.title = contact.label;
  }
  for (const [sid, item] of existing) if (!keep.has(sid)) item.remove();
}

function textBlock(title, value, changeState) {
  const section = document.createElement("section");
  section.className = "payload";
  const heading = document.createElement("h3");
  const pre = document.createElement("pre");
  heading.textContent = title;
  if (changeState) {
    const badge = document.createElement("span");
    badge.className = "change-state " + changeState.toLowerCase();
    badge.textContent = changeState;
    heading.append(badge);
  }
  pre.textContent = value || "No captured content";
  section.append(heading, pre);
  return section;
}

async function loadBody(sid, kind, pre) {
  pre.textContent = "Loading stored content…";
  try {
    pre.textContent = await api("/api/body?sid=" + encodeURIComponent(sid) + "&kind=" + encodeURIComponent(kind));
    pre.dataset.loaded = kind;
  } catch (error) {
    delete pre.dataset.loaded;
    pre.textContent = "Unavailable — " + error.message;
    throw error;
  }
}

function updateOpenSessions(openSessions, sid, open) {
  if (open) openSessions.add(sid);
  else openSessions.delete(sid);
  return openSessions;
}

function needsSessionBodies(open, loaded) {
  return Boolean(open && !loaded);
}

function reconcileSessionNodes(existingNodes, sessions, createNode, updateNode) {
  const existing = new Map(Array.from(existingNodes || []).map((node) => [node.dataset.sid, node]));
  return (sessions || []).map((session) => {
    const node = existing.get(String(session.sid));
    if (!node) return createNode(session);
    updateNode(node, session);
    return node;
  });
}

function syncChildOrder(container, desiredNodes) {
  desiredNodes.forEach((node, index) => {
    const current = container.children[index] || null;
    if (current !== node) container.insertBefore(node, current);
  });
  while (container.children.length > desiredNodes.length) {
    container.removeChild(container.lastElementChild);
  }
}

function panelsForSession(session) {
  const req = session.request || {};
  const res = session.response || {};
  const systemState = req.sys_changed ? "CHANGED" : (req.system_original != null || req.system != null) ? "UNCHANGED" : "";
  const userState = req.usr_changed ? "CHANGED" : (req.input_original != null || req.input != null) ? "UNCHANGED" : "";
  return [
    { title: "RAW REQUEST", preview: JSON.stringify(req, null, 2), kind: "req", stored: req.has_req_body },
    { title: "RAW / STREAMED RESPONSE", preview: res.output || res.error || JSON.stringify(res, null, 2), kind: "res", stored: res.has_res_body },
    { title: "SYSTEM ORIGINAL", preview: req.system_original, kind: "sys", stored: req.sys_full, state: systemState },
    { title: "SYSTEM TRANSFORMED", preview: req.system, kind: "syso", stored: req.syso_full, state: systemState },
    { title: "USER ORIGINAL", preview: req.input_original, kind: "usr", stored: req.usr_full, state: userState },
    { title: "USER TRANSFORMED", preview: req.input, kind: "usro", stored: req.usro_full, state: userState },
  ];
}

function updatePanel(section, panel) {
  const heading = section.querySelector("h3");
  const pre = section.querySelector("pre");
  const headingKey = panel.title + "\n" + (panel.state || "");
  if (section.dataset.headingKey !== headingKey) {
    heading.textContent = panel.title;
    if (panel.state) {
      const badge = document.createElement("span");
      badge.className = "change-state " + panel.state.toLowerCase();
      badge.textContent = panel.state;
      heading.append(badge);
    }
    section.dataset.headingKey = headingKey;
  }
  const preview = panel.preview || "No captured content";
  if (!(panel.stored && pre.dataset.loaded === panel.kind) && pre.textContent !== preview) {
    pre.textContent = preview;
  }
  if (!panel.stored) delete pre.dataset.loaded;
}

async function loadSessionPanels(details) {
  if (!details.open) return;
  const session = details._aresSession;
  const panels = details._aresPanels || [];
  const blocks = details.querySelectorAll(".session-detail pre");
  const jobs = panels.map((panel, index) => panel.stored
    && blocks[index].dataset.loaded !== panel.kind
    ? loadBody(session.sid, panel.kind, blocks[index])
    : Promise.resolve());
  await Promise.allSettled(jobs);
}

function updateSessionElement(details, session) {
  const fingerprint = JSON.stringify(session);
  if (details._aresFingerprint === fingerprint) return details;
  const firstUpdate = !details.dataset.sid;
  details.dataset.sid = String(session.sid);
  details._aresFingerprint = fingerprint;
  details._aresSession = session;
  if (firstUpdate) details.open = state.openSessions.has(session.sid);

  const req = session.request || {};
  const res = session.response || {};
  const time = req.ts || res.ts || "";
  const cells = [
    time ? new Date(time).toLocaleTimeString([], { hour12: false }) : "—",
    req.method || "—", req.path || req.dest || "—", res.status || "···",
    res.time_ms === undefined ? "—" : res.time_ms + "ms",
  ];
  const spans = details.querySelectorAll(".session-row > span");
  cells.forEach((value, index) => {
    if (spans[index].textContent !== String(value)) spans[index].textContent = value;
  });

  const panels = panelsForSession(session);
  details._aresPanels = panels;
  const sections = details.querySelectorAll(".session-detail > .payload");
  panels.forEach((panel, index) => updatePanel(sections[index], panel));
  if (details.open) void loadSessionPanels(details);
  return details;
}

function createSessionElement(session) {
  const details = document.createElement("details");
  details.className = "session";
  const summary = document.createElement("summary");
  summary.className = "session-row";
  for (let index = 0; index < 5; index += 1) {
    const span = document.createElement("span");
    if (index === 1) span.className = "method";
    if (index === 2) span.className = "route";
    if (index === 3) span.className = "status";
    summary.append(span);
  }
  const detail = document.createElement("div");
  detail.className = "session-detail";
  for (let index = 0; index < 6; index += 1) detail.append(textBlock("", ""));
  details.append(summary, detail);
  details.addEventListener("toggle", async () => {
    const current = details._aresSession;
    if (!current) return;
    updateOpenSessions(state.openSessions, current.sid, details.open);
    await loadSessionPanels(details);
  });
  return updateSessionElement(details, session);
}

function renderSessions() {
  const filter = $("session-filter").value.trim().toLowerCase();
  const sessions = visibleSessions(state.sessions, filter, state.sortField, state.sortDirection);
  const stream = $("session-stream");
  const countText = sessions.length + " SESSION" + (sessions.length === 1 ? "" : "S");
  if ($("stream-count").textContent !== countText) $("stream-count").textContent = countText;
  if (!sessions.length) {
    let empty = stream.querySelector(":scope > .empty-state");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "empty-state";
      empty.append(document.createElement("span"));
    }
    const message = filter ? "No sessions match this filter" : "Awaiting intercepted traffic";
    if (empty.firstChild && empty.firstChild.nodeType === Node.TEXT_NODE) {
      if (empty.firstChild.textContent !== message) empty.firstChild.textContent = message;
    } else {
      empty.prepend(document.createTextNode(message));
    }
    const detail = state.follow ? "Radar acquisition is active" : "Live capture view is paused";
    if (empty.querySelector("span").textContent !== detail) empty.querySelector("span").textContent = detail;
    syncChildOrder(stream, [empty]);
    return;
  }
  const desired = reconcileSessionNodes(
    stream.querySelectorAll(":scope > .session"),
    sessions,
    createSessionElement,
    updateSessionElement,
  );
  syncChildOrder(stream, desired);
}

function updateMetrics() {
  const sessions = state.sessions;
  const responses = sessions.map((item) => item.response).filter(Boolean);
  const failures = responses.filter((item) => Number(item.status) >= 400);
  const latencies = responses.map((item) => Number(item.time_ms)).filter(Number.isFinite).sort((a, b) => a - b);
  $("metric-requests").textContent = String(sessions.length);
  $("metric-active").textContent = String(sessions.filter(isSessionActive).length);
  $("metric-failures").textContent = String(failures.length);
  $("metric-latency").textContent = latencies.length ? latencies[Math.floor(latencies.length / 2)] + "ms" : "—";
  const list = $("failure-list");
  list.replaceChildren();
  for (const session of sessions.filter((item) => item.response && Number(item.response.status) >= 400).slice(0, 5)) {
    const item = document.createElement("li");
    item.textContent = session.response.status + "  " + (session.request && session.request.path || "unknown route");
    list.append(item);
  }
  if (!list.children.length) { const item = document.createElement("li"); item.textContent = "No failures detected"; list.append(item); }
}

async function refreshSessions() {
  if (!state.follow || document.hidden) return;
  try {
    const data = await api("/api/sessions");
    state.sessions = data.sessions || [];
    renderSessions();
    renderRadar();
    updateMetrics();
  } catch (error) { toast(error.message); }
}

function closeRuleEditor() {
  state.editingRuleId = null;
  $("rule-editor").hidden = true;
  $("rule-match").value = "";
  $("rule-replace").value = "";
  $("rule-provider").value = "both";
  $("rule-scope").value = "all";
  $("rule-regex").checked = false;
  $("save-rule").textContent = "SAVE RULE";
}

function openRuleEditor(rule = null) {
  state.editingRuleId = rule ? rule.id : null;
  $("rule-match").value = rule ? rule.match : "";
  $("rule-replace").value = rule ? rule.replace || "" : "";
  $("rule-provider").value = rule ? rule.provider || "both" : "both";
  $("rule-scope").value = rule ? rule.scope || "all" : "all";
  $("rule-regex").checked = Boolean(rule && rule.regex);
  $("save-rule").textContent = rule ? "UPDATE RULE" : "SAVE RULE";
  $("rule-editor").hidden = false;
  $("rule-match").focus();
}

function renderRules() {
  const body = $("rules-table").querySelector("tbody");
  body.replaceChildren();
  $("rules-count").textContent = state.rules.length + " RULE" + (state.rules.length === 1 ? "" : "S");
  for (const rule of state.rules) {
    const row = document.createElement("tr");
    const enabled = document.createElement("input");
    enabled.type = "checkbox"; enabled.checked = rule.enabled !== false;
    enabled.addEventListener("change", async () => { await saveRules(state.rules.map((item) => item === rule ? { ...item, enabled: enabled.checked } : item)); });
    const first = document.createElement("td"); first.append(enabled); row.append(first);
    for (const value of [rule.provider || "both", rule.scope || "all", rule.match, rule.replace || "", rule.regex ? "REGEX" : "TEXT"]) {
      const cell = document.createElement("td"); const code = document.createElement("code"); code.textContent = value; cell.append(code); row.append(cell);
    }
    const actions = document.createElement("td"); actions.className = "rule-actions";
    const edit = document.createElement("button"); edit.className = "btn"; edit.type = "button"; edit.textContent = "EDIT";
    edit.addEventListener("click", () => openRuleEditor(rule));
    const remove = document.createElement("button"); remove.className = "btn danger"; remove.type = "button"; remove.textContent = "REMOVE";
    remove.addEventListener("click", async () => { if (state.editingRuleId === rule.id) closeRuleEditor(); await saveRules(state.rules.filter((item) => item !== rule)); });
    actions.append(edit, remove); row.append(actions); body.append(row);
  }
}

async function loadRules() { const data = await api("/api/rules"); state.rules = data.rules || []; renderRules(); }
async function saveRules(rules = state.rules) { const data = await api("/api/rules", { method: "PUT", body: JSON.stringify({ rules }) }); state.rules = data.rules; renderRules(); toast("Rewrite rules updated"); }

function download(name, value) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  link.download = name; link.click(); URL.revokeObjectURL(link.href);
}

async function applyConfig(disable = false) {
  const target = disable ? null : $("forward-target").value.trim() || null;
  const payload = {
    forwardTarget: target,
    forwarding: disable ? false : state.mode === "chain",
    providers: {
      anthropic: $("provider-anthropic").value.trim(),
      openai: $("provider-openai").value.trim(),
      openai_chatgpt: $("provider-chatgpt").value.trim(),
    },
    debugBodies: $("debug-toggle").getAttribute("aria-checked") === "true",
    bodyCap: Number($("body-cap").value), bodyKeep: Number($("body-keep").value),
  };
  try {
    await api("/api/config", { method: "PUT", body: JSON.stringify(payload) });
    await loadStatus();
    setStatus(disable ? "Forwarding disabled; automatic provider routing restored." : "Configuration applied to subsequent requests.");
    toast(disable ? "Forwarding disabled" : "Configuration applied");
  } catch (error) { setStatus(error.message, true); toast(error.message); }
}

async function loadStatus() { populateStatus(await api("/api/status")); }

function wireEvents() {
  $("console-tab").addEventListener("click", () => setTab("console"));
  $("command-tab").addEventListener("click", () => setTab("command"));
  document.querySelectorAll("[data-open-command]").forEach((button) => button.addEventListener("click", () => setTab("command")));
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.mode; updateModeUi(); }));
  $("session-filter").addEventListener("input", renderSessions);
  $("follow-toggle").addEventListener("click", () => { state.follow = !state.follow; $("follow-toggle").setAttribute("aria-pressed", String(state.follow)); $("follow-toggle").textContent = state.follow ? "● FOLLOW" : "Ⅱ PAUSED"; $("capture-state").textContent = state.follow ? "FOLLOW" : "PAUSED"; if (state.follow) refreshSessions(); });
  $("session-sort-field").addEventListener("change", (event) => { state.sortField = event.target.value; renderSessions(); });
  $("session-sort-direction").addEventListener("click", () => {
    state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
    $("session-sort-direction").textContent = state.sortDirection.toUpperCase();
    $("session-sort-direction").setAttribute("aria-label", state.sortDirection === "desc" ? "Descending" : "Ascending");
    renderSessions();
  });
  $("export-sessions").addEventListener("click", () => download("ares-proxy-sessions.json", JSON.stringify(state.sessions, null, 2)));
  $("clear-sessions").addEventListener("click", async () => { if (!confirm("Clear captured traffic and stored bodies?")) return; await api("/api/clear", { method: "POST", body: "{}" }); state.sessions = []; renderSessions(); renderRadar(); updateMetrics(); toast("Captured traffic cleared"); });
  $("apply-config").addEventListener("click", () => applyConfig(false));
  $("disable-forward").addEventListener("click", () => applyConfig(true));
  $("test-forward").addEventListener("click", async () => { try { const data = await api("/api/test-forward", { method: "POST", body: "{}" }); toast("Target connected in " + data.latency_ms + "ms"); } catch (error) { toast(error.message); } });
  $("debug-toggle").addEventListener("click", () => { const next = $("debug-toggle").getAttribute("aria-checked") !== "true"; $("debug-toggle").setAttribute("aria-checked", String(next)); });
  $("add-rule").addEventListener("click", () => openRuleEditor());
  $("cancel-rule").addEventListener("click", closeRuleEditor);
  $("save-rule").addEventListener("click", async () => {
    const match = $("rule-match").value;
    if (!match) return toast("Find value is required");
    const current = state.rules.find((rule) => rule.id === state.editingRuleId);
    const values = { match, replace: $("rule-replace").value, provider: $("rule-provider").value, scope: $("rule-scope").value, regex: $("rule-regex").checked };
    const nextRule = current ? { ...current, ...values } : { id: Date.now().toString(36), ...values, enabled: true };
    const nextRules = current ? state.rules.map((rule) => rule === current ? nextRule : rule) : [...state.rules, nextRule];
    await saveRules(nextRules);
    closeRuleEditor();
  });
  $("export-rules").addEventListener("click", () => download("ares-proxy-rules.json", JSON.stringify(state.rules, null, 2)));
  $("import-rules").addEventListener("click", () => $("rules-file-input").click());
  $("rules-file-input").addEventListener("change", async (event) => { try { await saveRules(JSON.parse(await event.target.files[0].text())); closeRuleEditor(); } catch (error) { toast("Import failed: " + error.message); } event.target.value = ""; });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshSessions(); });
}

async function boot() {
  wireEvents();
  setTab(location.hash === "#command" ? "command" : "console");
  try { await Promise.all([loadStatus(), loadRules(), refreshSessions()]); }
  catch (error) { setStatus(error.message, true); toast(error.message); }
  state.timer = setInterval(refreshSessions, 2500);
}

if (window.__ARES_TEST__) {
  window.__ARES_RADAR__ = { hashSessionId, isSessionActive, radarContact, selectRadarContacts };
  window.__ARES_UI__ = {
    sessionSortValue, visibleSessions, updateOpenSessions, needsSessionBodies,
    reconcileSessionNodes, syncChildOrder,
  };
} else {
  boot();
}
`;

function serveText(res, body, contentType) {
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-cache",
  });
  res.end(body);
}

function createGuiServer(options) {
  const runtime = options.runtime;
  const locks = options.locks || {};
  const files = options.files;
  const status = options.status || (() => ({}));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (req.method === "GET" && url.pathname === "/") {
        return serveText(res, GUI_HTML, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/assets/app.css") {
        return serveText(res, GUI_CSS, "text/css; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/assets/app.js") {
        return serveText(res, GUI_JS, "text/javascript; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        return json(res, 200, { ...status(), forwarding: runtime.snapshot(), locks });
      }
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        return json(res, 200, { sessions: readSessions(files.dataLog) });
      }
      if (req.method === "GET" && url.pathname === "/api/body") {
        const sid = url.searchParams.get("sid") || "";
        const kind = url.searchParams.get("kind") || "";
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(sid) || !BODY_KINDS.has(kind)) {
          return apiError(res, 400, "INVALID_BODY_REF", "Invalid session or body kind");
        }
        const filename = path.join(files.bodyDir, sid + "." + kind);
        try {
          const body = fs.readFileSync(filename);
          res.writeHead(200, {
            "content-type": "text/plain; charset=utf-8",
            "content-length": body.length,
            "cache-control": "no-store",
          });
          return res.end(body);
        } catch (_) {
          return apiError(res, 404, "BODY_NOT_FOUND", "Stored body not found");
        }
      }
      if (req.method === "PUT" && url.pathname === "/api/config") {
        const payload = await readJson(req);
        const current = runtime.snapshot();
        let target = current.forwardTarget;
        if (Object.prototype.hasOwnProperty.call(payload, "forwardTarget")) {
          const requested = payload.forwardTarget ? parseAddress(String(payload.forwardTarget), { host: "127.0.0.1", port: 8080 }) : null;
          if (locks.forwardTarget && printableAddress(requested) !== printableAddress(current.forwardTarget)) {
            return apiError(res, 409, "CONFIG_LOCKED", "Forward target is fixed by CLI or environment configuration");
          }
          target = requested;
        }
        let forwarding = current.forwarding;
        if (Object.prototype.hasOwnProperty.call(payload, "forwarding")) {
          const requested = Boolean(payload.forwarding);
          if (locks.forwarding && requested !== current.forwarding) {
            return apiError(res, 409, "CONFIG_LOCKED", "Forwarding mode is fixed by CLI or environment configuration");
          }
          forwarding = requested;
        }
        if (forwarding && !target) throw new Error("Forwarding mode requires a forward target");
        const extra = options.updateConfig ? options.updateConfig(payload) : {};
        const updated = runtime.update({ forwardTarget: target, forwarding });
        const persisted = {
          forwardTarget: printableAddress(updated.forwardTarget), forwarding: updated.forwarding,
          ...extra,
        };
        fs.mkdirSync(path.dirname(files.configFile), { recursive: true });
        fs.writeFileSync(files.configFile, JSON.stringify(persisted, null, 2));
        return json(res, 200, { forwarding: updated, ...extra });
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        return json(res, 200, { rules: readRules(files.rulesFile) });
      }
      if (req.method === "PUT" && url.pathname === "/api/rules") {
        const payload = await readJson(req);
        const rules = validateRules(payload.rules);
        fs.mkdirSync(path.dirname(files.rulesFile), { recursive: true });
        fs.writeFileSync(files.rulesFile, JSON.stringify(rules, null, 2));
        return json(res, 200, { rules });
      }
      if (req.method === "POST" && url.pathname === "/api/test-forward") {
        const config = runtime.snapshot();
        if (!config.forwardTarget) return apiError(res, 400, "NO_FORWARD_TARGET", "Configure a forward target first");
        const started = Date.now();
        const socket = net.connect(config.forwardTarget.port, config.forwardTarget.host);
        socket.setTimeout(5000);
        socket.once("connect", () => {
          socket.destroy();
          json(res, 200, { ok: true, latency_ms: Date.now() - started });
        });
        socket.once("timeout", () => socket.destroy(new Error("Connection timed out")));
        socket.once("error", (error) => apiError(res, 502, "CONNECTION_FAILED", error.message));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/clear") {
        try { fs.writeFileSync(files.dataLog, ""); } catch (_) {}
        try {
          for (const filename of fs.readdirSync(files.bodyDir)) {
            if (/^[A-Za-z0-9_-]{1,64}\.(req|res|sys|syso|usr|usro|out)$/.test(filename)) {
              fs.unlinkSync(path.join(files.bodyDir, filename));
            }
          }
        } catch (_) {}
        return json(res, 200, { ok: true });
      }
      return apiError(res, 404, "NOT_FOUND", "Route not found");
    } catch (error) {
      const code = error.code === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE"
        : error.code === "INVALID_JSON" ? "INVALID_JSON" : "INVALID_CONFIG";
      const statusCode = code === "BODY_TOO_LARGE" ? 413 : 400;
      if (!res.headersSent) return apiError(res, statusCode, code, error.message);
      res.destroy();
    }
  });
}



// Increment this semantic version whenever externally visible proxy behavior changes.
const PROXY_VERSION = "2.5.0";

const DEFAULT_PROVIDER = (process.env.DEFAULT_PROVIDER || "anthropic").toLowerCase();
if (!new Set(["anthropic", "openai"]).has(DEFAULT_PROVIDER)) {
  console.error(`DEFAULT_PROVIDER must be "anthropic" or "openai", got "${DEFAULT_PROVIDER}"`);
  process.exit(1);
}

const GUI_CONFIG_FILE = process.env.GUI_CONFIG_FILE || path.resolve(process.cwd(), "proxy-gui-config.json");
const PERSISTED_CONFIG = loadPersistedConfig(GUI_CONFIG_FILE);
let OPTIONS;
try {
  OPTIONS = parseProxyOptions(
    process.argv.slice(2),
    process.env,
    PERSISTED_CONFIG,
  );
} catch (error) {
  console.error(error.message + "\nUse --help for usage.");
  process.exit(1);
}
const { host: LISTEN_HOST, port: PORT } = OPTIONS.listen;
const RUNTIME = createRuntimeConfig({
  forwardTarget: OPTIONS.forwardTarget,
  forwarding: OPTIONS.forwarding,
});
const DUMP = process.env.DUMP_PROMPT !== "0"; // set DUMP_PROMPT=0 to silence logging

// DEBUG_BODIES=1 dumps the FULL request/response bodies and headers to the proxy
// console log (visible in the app's "Proxy log" panel, or `docker logs`). This is
// the escape hatch for when the structured Data-stream panel shows a request but
// no content — it reveals the body shape the client actually sent, rather than
// the shape the extractor expected. Off by default: bodies are large and contain
// whatever you typed.
let DEBUG_BODIES = process.env.DEBUG_BODIES !== undefined
  ? process.env.DEBUG_BODIES === "1"
  : Boolean(PERSISTED_CONFIG.debugBodies);
const DEBUG_CAP = Number(process.env.DEBUG_CAP || 60000);

// Never write credentials to a log, even a debug one.
const SECRET_HEADERS = new Set(["authorization", "x-api-key", "cookie", "set-cookie", "proxy-authorization"]);
function redactHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? "<redacted>" : v;
  }
  return out;
}

function debugDump(sid, label, data) {
  if (!DEBUG_BODIES) return;
  let s = Buffer.isBuffer(data) ? data.toString("utf8") : (typeof data === "string" ? data : JSON.stringify(data, null, 2));
  const total = s.length;
  if (total > DEBUG_CAP) s = s.slice(0, DEBUG_CAP) + `\n…(truncated — ${total} bytes total, raise DEBUG_CAP to see more)`;
  console.error(`\n===== [${sid}] ${label} (${total} bytes) =====\n${s}\n===== [${sid}] end ${label} =====\n`);
}

// Structural summary — key names and types only, no values. Safe to log even
// without DEBUG_BODIES, and usually enough to spot an extractor shape mismatch.
function shapeOf(o, depth = 0) {
  if (o === null) return "null";
  if (Array.isArray(o)) return depth > 2 ? `array[${o.length}]` : `array[${o.length}]${o.length ? " of " + shapeOf(o[0], depth + 1) : ""}`;
  if (typeof o === "object") {
    if (depth > 2) return "{…}";
    return "{" + Object.keys(o).map(k => `${k}:${shapeOf(o[k], depth + 1)}`).join(", ") + "}";
  }
  return typeof o;
}

// Structured data log: JSONL file with session-grouped request/response entries.
// Read by the ares-manager web app's "Data stream" panel.
const DATA_LOG = runtimeStoragePath(
  process.env.DATA_LOG,
  "/var/log/proxy-data.log",
  "proxy-data.log",
);

function genSid() {
  return Math.random().toString(36).slice(2, 8);
}

function dataLog(entry) {
  try {
    fs.appendFileSync(DATA_LOG, JSON.stringify(entry) + "\n");
  } catch (_) {}
}

// --- request body decompression --------------------------------------------
// Codex sends its request bodies Zstandard-compressed (magic 28 B5 2F FD).
// Left compressed, JSON.parse fails, no prompt can be extracted, and the stored
// "raw body" is unreadable binary — which looks like encryption but isn't.
//
// Detection is by magic bytes rather than the content-encoding header: the
// header is what a client *claims*, the bytes are what it actually sent, and
// only the latter can be trusted to decide whether parsing will work.
//
// Node 18's zlib has gzip and brotli but not zstd (added in 22+), so zstd goes
// through the `zstd` CLI installed in the image.
const zlib = require("zlib");
const { spawnSync } = require("child_process");

function sniffEncoding(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) return "zstd";
  if (buf[0] === 0x1f && buf[1] === 0x8b) return "gzip";
  return null;   // brotli has no magic — falls back to the header check below
}

let _zstdMissingWarned = false;

// Returns { buf, encoding } — decompressed bytes plus what it was encoded with
// (null when it was already plain).
function decodeBody(buf, headers) {
  const sniffed = sniffEncoding(buf);
  const declared = String(headers["content-encoding"] || "").toLowerCase().trim();
  const enc = sniffed || (declared === "br" || declared === "gzip" || declared === "deflate" ? declared : null);
  if (!enc) return { buf, encoding: null };
  try {
    if (enc === "gzip") return { buf: zlib.gunzipSync(buf), encoding: enc };
    if (enc === "deflate") return { buf: zlib.inflateSync(buf), encoding: enc };
    if (enc === "br") return { buf: zlib.brotliDecompressSync(buf), encoding: enc };
    if (enc === "zstd") {
      const r = spawnSync("zstd", ["-d", "-c", "-q"], { input: buf, maxBuffer: 64 * 1024 * 1024 });
      if (r.error || r.status !== 0 || !r.stdout || !r.stdout.length) {
        if (!_zstdMissingWarned) {
          _zstdMissingWarned = true;
          console.error(
            `[${new Date().toISOString()}] zstd decompression unavailable ` +
            `(${r.error ? r.error.message : "exit " + r.status}) — Codex bodies will stay unreadable`
          );
        }
        return { buf, encoding: enc, failed: true };
      }
      return { buf: r.stdout, encoding: enc };
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${enc} decode failed: ${e.message}`);
  }
  return { buf, encoding: enc, failed: true };
}

// --- raw body store --------------------------------------------------------
// Full request/response bodies are written to their own per-session files
// rather than into the JSONL. The data panel polls that JSONL constantly, so
// inlining 100KB+ bodies would make every poll heavy; instead each entry just
// flags that a body exists and the UI fetches it on expand. This also means the
// panel can show content for ANY provider without the extractor having to
// understand its schema.
const BODY_DIR = runtimeStoragePath(
  process.env.BODY_DIR,
  "/var/log/proxy-bodies",
  "proxy-bodies",
);
// 8MB, not 512KB: this store is what "Open" reads, and Open must show the
// ENTIRE body. The cap exists only so one pathological stream can't fill the
// disk — it is not meant to be hit by normal traffic.
let BODY_CAP = Number(process.env.BODY_CAP || PERSISTED_CONFIG.bodyCap || 8 * 1024 * 1024);
let BODY_KEEP = Number(process.env.BODY_KEEP || PERSISTED_CONFIG.bodyKeep || 400);

// The JSONL the panel polls keeps only PREVIEWS of the extracted prompts, so
// polling stays cheap. The full text goes to the body store under these kinds
// and is fetched on demand when a card's Open button is pressed.
const META_SYS = 4000;    // preview length for system prompts
const META_TEXT = 10000;  // preview length for user turns and replies

try { fs.mkdirSync(BODY_DIR, { recursive: true }); } catch (_) {}

let _bodyWrites = 0;
function saveBody(sid, kind, data) {
  if (!sid || !data || !data.length) return false;
  try {
    let s;
    if (Buffer.isBuffer(data)) {
      const txt = data.toString("utf8");
      // U+FFFD means the bytes weren't valid UTF-8 — writing that produces
      // mojibake that reads like "encrypted". Say what it actually is instead.
      s = txt.includes("�")
        ? `(binary body — ${data.length} bytes, not text.\n` +
          ` first 16 bytes: ${data.subarray(0, 16).toString("hex")}\n` +
          ` if this is a compressed encoding the proxy could not decode, the` +
          ` decoder for it is missing.)`
        : txt;
    } else {
      s = String(data);
    }
    const total = s.length;
    if (total > BODY_CAP) s = s.slice(0, BODY_CAP) + `\n\n…(truncated — ${total} bytes total)`;
    fs.writeFileSync(`${BODY_DIR}/${sid}.${kind}`, s);
    // Prune occasionally so the directory can't grow without bound.
    if (++_bodyWrites % 50 === 0) pruneBodies();
    return true;
  } catch (_) {
    return false;
  }
}

function pruneBodies() {
  try {
    const files = fs.readdirSync(BODY_DIR)
      .map(f => ({ f, t: fs.statSync(`${BODY_DIR}/${f}`).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(BODY_KEEP)) {
      try { fs.unlinkSync(`${BODY_DIR}/${f}`); } catch (_) {}
    }
  } catch (_) {}
}

function parseEndpoint(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch (err) {
    console.error(`${name} is not a valid URL: "${value}" (${err.message})`);
    process.exit(1);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    console.error(`${name} must use http or https, got "${url.protocol}"`);
    process.exit(1);
  }
  return {
    url,
    host: url.hostname,
    port: Number(url.port) || (url.protocol === "http:" ? 80 : 443),
    client: url.protocol === "http:" ? http : https,
    // Some upstreams live under a path prefix, not at the root — notably the
    // ChatGPT Codex backend (https://chatgpt.com/backend-api/codex). Keep it so
    // outgoing paths can be rebuilt correctly; "" for a root endpoint.
    basePath: url.pathname.replace(/\/+$/, "").replace(/^\/v1$/, ""),
  };
}

// NEXT_HOP_ENDPOINT and API_KEY remain compatibility overrides for whichever
// provider is configured as the default. Provider-specific settings win.
const LEGACY_ENDPOINT = process.env.NEXT_HOP_ENDPOINT || null;
const LEGACY_KEY = process.env.API_KEY || null;
const PROVIDERS = {
  anthropic: {
    ...parseEndpoint(
      "ANTHROPIC_ENDPOINT",
      process.env.ANTHROPIC_ENDPOINT ||
        (DEFAULT_PROVIDER === "anthropic" && LEGACY_ENDPOINT) ||
        (PERSISTED_CONFIG.providerEndpoints && PERSISTED_CONFIG.providerEndpoints.anthropic) ||
        "https://api.anthropic.com"
    ),
    key: process.env.ANTHROPIC_API_KEY || (DEFAULT_PROVIDER === "anthropic" ? LEGACY_KEY : null),
  },
  openai: {
    ...parseEndpoint(
      "OPENAI_ENDPOINT",
      process.env.OPENAI_ENDPOINT ||
        (DEFAULT_PROVIDER === "openai" && LEGACY_ENDPOINT) ||
        (PERSISTED_CONFIG.providerEndpoints && PERSISTED_CONFIG.providerEndpoints.openai) ||
        "https://api.openai.com"
    ),
    key: process.env.OPENAI_API_KEY || (DEFAULT_PROVIDER === "openai" ? LEGACY_KEY : null),
  },
  // Codex has two auth modes with DIFFERENT upstreams, and sending one's
  // credential to the other's host fails in a confusing way:
  //   • API key  (sk-…)      -> api.openai.com/v1/...
  //   • ChatGPT  (JWT, from  -> chatgpt.com/backend-api/codex/...   (no /v1)
  //     "Sign in with ChatGPT")
  // A ChatGPT token sent to api.openai.com authenticates as a real identity but
  // carries no platform scopes, so it fails with "Missing scopes:
  // api.responses.write" rather than an obvious auth error. Selection happens
  // per-request from the token shape (see pickOpenAiEndpoint).
  openai_chatgpt: {
    ...parseEndpoint(
      "OPENAI_CHATGPT_ENDPOINT",
      process.env.OPENAI_CHATGPT_ENDPOINT ||
        (PERSISTED_CONFIG.providerEndpoints && PERSISTED_CONFIG.providerEndpoints.openai_chatgpt) ||
        "https://chatgpt.com/backend-api/codex"
    ),
    key: null,   // ChatGPT auth is always the client's own token — never injected
  },
};

// A ChatGPT OAuth access token is a JWT ("eyJ…"); a platform key is "sk-…".
// Anything else (or nothing) falls through to the standard API host.
function pickOpenAiEndpoint(headers) {
  const auth = headers["authorization"] || headers["Authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token.startsWith("eyJ") ? "openai_chatgpt" : "openai";
}

// Which credential family did the client present? Independent of path.
//   Anthropic  : "sk-ant-…" (usually via x-api-key, which is an Anthropic-ism)
//   ChatGPT    : a JWT, "eyJ…"  -> Codex signed in with ChatGPT
//   OpenAI API : "sk-…"
function credentialFamily(headers) {
  const xkey = String(headers["x-api-key"] || headers["X-Api-Key"] || "");
  const auth = String(headers["authorization"] || headers["Authorization"] || "");
  const tok = (xkey || auth.replace(/^Bearer\s+/i, "")).trim();
  if (tok.startsWith("sk-ant-")) return "anthropic";
  if (tok.startsWith("eyJ")) return "openai_chatgpt";
  if (tok.startsWith("sk-")) return "openai";
  if (xkey) return "anthropic";
  return null;
}

// Path -> provider family. Returns "ambiguous" for endpoints BOTH vendors
// expose (/models is the big one: Claude Code lists models just like Codex
// does), and "unknown" for anything unrecognized. Routing /models to OpenAI
// unconditionally sent Claude's sk-ant- key to api.openai.com, which replies
// with a baffling "Incorrect API key … find your API key at platform.openai.com".
function classifyPath(path) {
  const pathname = path.split("?", 1)[0].replace(/\/+$/, "") || "/";
  const p = pathname.replace(/^\/v1(?=\/)/, "");
  if (/^\/messages(?:\/|$)/.test(p)) return "anthropic";
  if (/^\/(responses|chat\/completions|completions|embeddings|audio(?:\/|$)|images(?:\/|$)|moderations|batches(?:\/|$)|files(?:\/|$)|fine_tuning(?:\/|$)|vector_stores(?:\/|$)|assistants(?:\/|$)|threads(?:\/|$)|realtime(?:\/|$))/.test(p)) {
    return "openai";
  }
  if (/^\/models(?:\/|$)/.test(p)) return "ambiguous";
  return "unknown";
}

// Final provider: path decides when it is unambiguous, credential decides when
// it is not (and picks the api-key host vs the ChatGPT backend either way).
function resolveProvider(path, model, headers) {
  const byPath = classifyPath(path);
  const byCred = credentialFamily(headers);
  if (byPath === "anthropic") return "anthropic";
  if (byPath === "openai") return byCred === "openai_chatgpt" ? "openai_chatgpt" : "openai";
  if (byCred) return byCred;
  const name = typeof model === "string" ? model.toLowerCase() : "";
  if (name.startsWith("claude-")) return "anthropic";
  if (/^(gpt-|o[134](?:-|$)|chatgpt-)/.test(name)) return "openai";
  return DEFAULT_PROVIDER;
}

function classifyProvider(path, model) {
  const pathname = path.split("?", 1)[0].replace(/\/+$/, "") || "/";
  // A client's base URL may or may not include the "/v1" version segment:
  // Claude posts /v1/messages, but Codex (depending on how openai_base_url is
  // set) posts either /responses or /v1/responses (and /models, etc.). Strip a
  // leading /v1 once, then match on the bare endpoint, so routing never depends
  // on whether the caller's base URL carried the version prefix. Before this,
  // a bare /responses fell through to DEFAULT_PROVIDER and hit the wrong
  // upstream (Codex → Anthropic → 404).
  const p = pathname.replace(/^\/v1(?=\/)/, "");
  if (/^\/messages(?:\/|$)/.test(p)) return "anthropic";
  // Note: /models exists on both providers; it resolves to OpenAI here because
  // Codex calls it and Claude Code does not route model-listing through the proxy.
  if (/^\/(responses|chat\/completions|completions|embeddings|audio(?:\/|$)|images(?:\/|$)|moderations|batches(?:\/|$)|files(?:\/|$)|fine_tuning(?:\/|$)|vector_stores(?:\/|$)|assistants(?:\/|$)|threads(?:\/|$)|realtime(?:\/|$)|models(?:\/|$))/.test(p)) {
    return "openai";
  }

  const name = typeof model === "string" ? model.toLowerCase() : "";
  if (name.startsWith("claude-")) return "anthropic";
  if (/^(gpt-|o[134](?:-|$)|chatgpt-|text-embedding-|whisper-|tts-|dall-e-)/.test(name)) return "openai";
  return DEFAULT_PROVIDER;
}

// Both api.anthropic.com and api.openai.com expose their endpoints under /v1.
// A client whose base URL omitted the version segment sends bare paths — Codex
// posts /responses and GETs /models — and forwarding those verbatim 404s at the
// upstream (verified: api.openai.com/models -> 404, /v1/models -> 401).
// Classification already tolerates either form; this makes the *outgoing* path
// canonical so both spellings reach a real endpoint. Query string is preserved
// (Codex sends /models?client_version=...).
// `endpoint` is the selected PROVIDERS entry. Endpoints that live under a path
// prefix (chatgpt.com/backend-api/codex) take the bare endpoint appended to that
// prefix and must NOT get a /v1; root endpoints (api.openai.com,
// api.anthropic.com) take /v1 + the bare endpoint.
function normalizeUpstreamPath(path, endpoint) {
  // Only rewrite endpoints we actually recognize. Blindly prefixing /v1 turned
  // Claude Code's probe of /api/hello into /v1/api/hello and 404'd it — an
  // unrecognized path must reach the upstream exactly as the client sent it.
  if (classifyPath(path) === "unknown") return path;

  const q = path.indexOf("?");
  const query = q === -1 ? "" : path.slice(q);
  let p = q === -1 ? path : path.slice(0, q);
  p = p.replace(/^\/v1(?=\/|$)/, "");   // strip an existing /v1, if any
  if (!p.startsWith("/")) p = "/" + p;
  if (p === "/") p = "";
  const base = (endpoint && endpoint.basePath) || "";
  return (base ? base + (p || "/") : "/v1" + p) + query;
}

// extra custom headers to add to every upstream request (optional)
const EXTRA_HEADERS = {
  // "x-your-custom-header": "value",
};

// --- request body transforms ---
// All pattern matching is handled by applyPatternRules() which reads rules
// from the shared rules file (managed by the ares-manager web app).
// No hardcoded patterns — everything is configurable via the UI.

// Pattern rules: loaded from a shared JSON file on each request (so changes
// from the web app take immediate effect without restarting the proxy).
const RULES_FILE = runtimeStoragePath(
  process.env.RULES_FILE,
  "/var/lib/ares/proxy-rules.json",
  "proxy-rules.json",
);

function loadRules() {
  try {
    const raw = fs.readFileSync(RULES_FILE, "utf8");
    return JSON.parse(raw).filter(r => r.enabled !== false);
  } catch (_) {
    return [];
  }
}

function applyText(text, match, replace, isRegex) {
  if (!text || typeof text !== "string") return text;
  if (isRegex) {
    try { return text.replace(new RegExp(match, "g"), replace); }
    catch (_) { return text; }
  }
  return text.split(match).join(replace);
}

// Rewrites request bodies in either provider's shape:
//   Anthropic Messages : { system, messages: [{role, content}] }
//   OpenAI Responses   : { instructions, input: string | [{role, content}] }
// `provider` is the classified family for THIS request; a rule with
// provider "anthropic"/"openai" only fires for that family, "both" (the
// default, and what pre-existing rules get) fires for either.
// --- response-side rewriting -----------------------------------------------
// Codex reads `prefer_websockets` from the /models config and, when it is true,
// stops POSTing to /responses and opens a WebSocket instead. This proxy speaks
// only HTTP: it has no server.on("upgrade") handler, and Node routes an upstream
// 101 to an "upgrade" event rather than "response", so the handshake hangs until
// the client gives up. That is the 499-every-15s loop — Codex works in the app
// (which never touches this proxy) but never starts through the terminal.
//
// Flipping the flag as the config passes through keeps Codex on plain HTTP,
// which is also the only form its prompts and replies stay readable in.
// Set DISABLE_UPSTREAM_WS=0 to forward the config untouched.
const DISABLE_WS = process.env.DISABLE_UPSTREAM_WS !== "0";

function rewriteConfigResponse(path, buf) {
  if (!DISABLE_WS) return null;
  if (!String(path).split("?")[0].endsWith("/models")) return null;
  let parsed;
  try {
    parsed = JSON.parse(buf.toString("utf8"));
  } catch (_) {
    return null;   // compressed or not JSON — forward untouched
  }
  if (!parsed || !Array.isArray(parsed.models)) return null;
  const flipped = [];
  for (const m of parsed.models) {
    if (m && m.prefer_websockets === true) {
      m.prefer_websockets = false;
      flipped.push(m.slug || "?");
    }
  }
  if (!flipped.length) return null;
  return { buf: Buffer.from(JSON.stringify(parsed), "utf8"), models: flipped };
}

// Which conversation turns count as system vs user. Shared by the transform and
// the extractor on purpose: if they disagree, the panel shows one thing while
// the rules rewrite another, and "after rules" stops meaning anything.
//
// Codex (ChatGPT backend) sends NO top-level `instructions`. Its system prompt
// is a run of role:"developer" message items inside input[] — persona first,
// then the permissions / collaboration-mode / skills blocks.
function isSystemTurn(t) {
  return !!t && (t.role === "system" || t.role === "developer")
    && t.type !== "additional_tools";   // developer-role, but tool schemas
}
// A message with no role is legacy-permitted as user content, but reasoning
// blocks, custom_tool_call and custom_tool_call_output also live in input[]
// without a role — requiring type "message" keeps tool output from being
// treated as the user's prompt.
function isUserTurn(t) {
  return !!t && (t.role === "user" || (t.role === undefined && t.type === "message"));
}

function applyPatternRules(body, provider) {
  const rules = loadRules();
  if (!rules.length) return;

  // Both OpenAI upstreams (api-key host and ChatGPT backend) are one family here.
  const family = String(provider || "").startsWith("openai") ? "openai" : "anthropic";

  for (const rule of rules) {
    const want = rule.provider || "both";
    if (want !== "both" && want !== family) continue;

    const m = rule.match || "";
    const r = rule.replace || "";
    const isRe = !!rule.regex;
    const scope = rule.scope || "all";

    // Match any block carrying a string .text — covers Anthropic "text" and
    // OpenAI "input_text" without having to enumerate block types.
    const applyToPart = (part) => {
      if (part && typeof part.text === "string") {
        part.text = applyText(part.text, m, r, isRe);
      }
    };
    // Rewrite a turn in place, preserving its existing shape (string stays a
    // string) so we never reshape a body the upstream then rejects.
    const applyToTurn = (turn) => {
      if (!turn) return;
      if (typeof turn.content === "string") {
        turn.content = applyText(turn.content, m, r, isRe);
      } else if (Array.isArray(turn.content)) {
        turn.content.forEach(applyToPart);
      }
    };

    const turns = Array.isArray(body.messages) ? body.messages
                : Array.isArray(body.input) ? body.input
                : [];

    // System prompt: Anthropic `system` (string or blocks), OpenAI
    // `instructions`, plus any system-role turn in the conversation.
    if (scope === "system" || scope === "all") {
      if (typeof body.system === "string") {
        body.system = applyText(body.system, m, r, isRe);
      } else if (Array.isArray(body.system)) {
        body.system.forEach(applyToPart);
      }
      if (typeof body.instructions === "string") {
        body.instructions = applyText(body.instructions, m, r, isRe);
      }
      // isSystemTurn covers Codex, which has no `instructions` field at all —
      // its system prompt is a run of role:"developer" messages inside input[].
      // Without developer here, every system-scope rule was a silent no-op on
      // Codex, so "System · after rules" could never appear the way it does for
      // Claude. additional_tools is developer-role too but carries tool schemas.
      for (const t of turns) if (isSystemTurn(t)) applyToTurn(t);
    }

    // User turns.  OpenAI `input` may be a bare string; its message items may
    // also omit `role`. Reasoning blocks and tool calls/outputs share input[]
    // and carry no role either, so isUserTurn requires an actual message.
    if (scope === "user" || scope === "all") {
      if (typeof body.input === "string") {
        body.input = applyText(body.input, m, r, isRe);
      }
      for (const t of turns) if (isUserTurn(t)) applyToTurn(t);
    }
  }
}

// --- content extraction (provider-agnostic) --------------------------------
// Two unrelated request shapes reach this proxy, and the data panel should show
// content for both:
//   Anthropic Messages : { system, messages: [{role, content: [{type:"text", text}]}] }
//   OpenAI Responses   : { instructions, input: string | [{role, content: [{type:"input_text", text}]}] }
// Reading only the Anthropic keys leaves every Codex field blank, which is why
// Codex traffic showed a size and status but no prompt or reply.
function blocksToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // Covers Anthropic "text" and OpenAI "input_text"/"output_text" alike —
    // any block carrying a string .text counts.
    return content.filter(b => b && typeof b.text === "string").map(b => b.text).join(" ");
  }
  return "";
}

function extractRequestContent(parsed) {
  const turns = Array.isArray(parsed.messages) ? parsed.messages
              : Array.isArray(parsed.input) ? parsed.input
              : [];

  let system = "";
  // Anthropic Messages: top-level `system` (string or blocks).
  if (typeof parsed.system === "string") system = parsed.system;
  else if (Array.isArray(parsed.system)) system = blocksToText(parsed.system);
  // OpenAI Responses (documented shape): top-level `instructions`.
  else if (typeof parsed.instructions === "string") system = parsed.instructions;

  // Codex sends NO top-level instructions — isSystemTurn picks up the
  // role:"developer" run inside input[]. Join them so the panel shows the whole
  // effective system prompt, which is also exactly what system-scope rules
  // rewrite (same predicate), so the two views stay comparable.
  if (!system) {
    const sys = turns.filter(isSystemTurn);
    if (sys.length) {
      system = sys.map(t => blocksToText(t.content)).filter(Boolean).join("\n\n———\n\n");
    }
  }

  // Last user turn.
  let input = "";
  const users = turns.filter(isUserTurn);
  if (users.length) input = blocksToText(users[users.length - 1].content);
  else if (typeof parsed.input === "string") input = parsed.input;

  return { system, input, msgs: turns.length };
}

function extractResponseText(rp) {
  // Anthropic Messages
  if (Array.isArray(rp.content)) {
    return rp.content.filter(b => b && b.type === "text").map(b => b.text || "").join("\n");
  }
  // OpenAI Responses: output[] of items whose content[] holds output_text blocks
  if (Array.isArray(rp.output)) {
    const t = rp.output
      .flatMap(o => (Array.isArray(o.content) ? o.content : []))
      .filter(b => b && typeof b.text === "string")
      .map(b => b.text)
      .join("\n");
    if (t) return t;
  }
  if (typeof rp.output_text === "string") return rp.output_text;
  return null;
}

function dumpPrompt(body) {
  if (!DUMP) return;
  if (body.system) {
    console.error("### request.system ###");
    console.error(
      typeof body.system === "string" ? body.system : JSON.stringify(body.system, null, 2)
    );
  }
  for (const msg of body.messages || []) {
    if (msg.role === "system") {
      console.error("\n========== SYSTEM PROMPT ==========\n");
      console.error(
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)
      );
      console.error("\n========== END SYSTEM ==========\n");
    }
    if (msg.role === "user") {
      console.error("\n========== USER PROMPT ==========\n");
      console.error(
        typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)
      );
      console.error("\n========== END USER ==========\n");
    }
  }
}

// True client address. Forwarding headers win when present (a real proxy chain
// sets them); otherwise the socket peer, with Node's IPv4-mapped-IPv6 prefix
// stripped ("::ffff:127.0.0.1" -> "127.0.0.1").
//
// Caveat worth knowing: an SSH port-forward TERMINATES the TCP connection and
// re-originates it from the tunnel endpoint, and adds no forwarding header. So
// for a tunnelled client the honest answer really is the loopback address —
// the originating machine is not recoverable from the connection. Use the
// `client` field below to tell callers apart in that case.
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const real = String(req.headers["x-real-ip"] || "").trim();
  const sock = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  return xff || real || sock || "?";
}

// Which client software sent this. When every connection arrives on loopback
// (Claude Code and Codex share the container's network namespace) the address
// cannot distinguish them, but the user-agent can.
function clientName(headers) {
  const ua = String(headers["user-agent"] || "");
  const orig = String(headers["originator"] || "");
  if (/codex/i.test(orig) || /codex/i.test(ua)) return "codex";
  if (/claude/i.test(ua) || /anthropic/i.test(ua)) return "claude";
  const first = ua.split(/[\/\s]/)[0];
  return first || null;
}

// Hop-by-hop / proxy-control headers that must never be forwarded upstream.
const HOP_BY_HOP = ["proxy-connection", "proxy-authorization"];

// resolveTarget inspects the request line to decide where this request goes.
//   - absolute-form  (GET http://host/path)  -> forward-proxy to that host
//   - origin-form    (GET /v1/messages)      -> gateway; provider selected later
// Returns { host, port, client, path, isGateway }.
function resolveTarget(req) {
  const url = req.url || "/";
  if (/^https?:\/\//i.test(url)) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      parsed = null;
    }
    if (parsed) {
      const isHttps = parsed.protocol === "https:";
      return {
        host: parsed.hostname,
        port: Number(parsed.port) || (isHttps ? 443 : 80),
        client: isHttps ? https : http,
        path: parsed.pathname + parsed.search,
        isGateway: false,
      };
    }
  }
  // origin-form has no destination on the request line. Selection is delayed
  // until the body has been inspected so the model can be used as a fallback.
  return {
    path: url,
    isGateway: true,
  };
}

const server = http.createServer((req, res) => {
  try {
    let target = resolveTarget(req);

    const headers = {
      ...req.headers,
      ...EXTRA_HEADERS,
    };
    // strip hop-by-hop proxy headers regardless of destination
    for (const h of HOP_BY_HOP) delete headers[h];

    if (!target.isGateway) {
      // Forward-proxy path: route to the host the client asked for and leave its
      // own Host/auth headers intact (no secret injection).
      headers["host"] = target.port === (target.client === https ? 443 : 80)
        ? target.host
        : `${target.host}:${target.port}`;
    }

    const chunks = [];
    const sid = genSid();
    const t0 = Date.now();
    const srcIp = clientIp(req);
    const clientId = clientName(req.headers);
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let bodyBuf = Buffer.concat(chunks);
      let reqMeta = { model: null, msgs: 0, stream: false };

      // Decompress before anything reads the body. We then forward the DECODED
      // bytes and drop content-encoding, rather than re-compressing: the
      // upstream accepts plain JSON, and this keeps pattern rules working (a
      // rewritten body could not be re-emitted in the original encoding without
      // a compressor). Only touches requests that actually arrived encoded.
      if (bodyBuf.length) {
        const dec = decodeBody(bodyBuf, headers);
        if (dec.encoding && !dec.failed) {
          console.error(
            `[${new Date().toISOString()}] [${sid}] decoded ${dec.encoding} request body ` +
            `${bodyBuf.length} -> ${dec.buf.length} bytes`
          );
          bodyBuf = dec.buf;
          delete headers["content-encoding"];
          headers["content-length"] = Buffer.byteLength(bodyBuf);
        } else if (dec.failed) {
          reqMeta.decode_failed = dec.encoding;
        }
      }

      // Size guard: bodies over 2MB get forwarded as-is without transforms.
      // A 15M-token conversation can be 50-100MB of JSON. Parsing, transforming,
      // and re-serializing that synchronously blocks the event loop for seconds,
      // causing TCP keepalives to fail and the client to ECONNRESET.
      const TRANSFORM_LIMIT = 2 * 1024 * 1024; // 2MB

      if (bodyBuf.length && bodyBuf.length <= TRANSFORM_LIMIT) {
        try {
          const parsed = JSON.parse(bodyBuf.toString("utf8"));
          if (parsed && typeof parsed === "object") {
            reqMeta.model = parsed.model || null;
            reqMeta.stream = !!parsed.stream;
            // Capture ORIGINAL content (pre-rules)
            const pre = extractRequestContent(parsed);
            reqMeta.msgs = pre.msgs;
            reqMeta.system_original = pre.system.slice(0, META_SYS);
            reqMeta.input_original = pre.input.slice(0, META_TEXT);
            // Stash the untruncated text so Open can show all of it. Only when
            // it actually exceeds the preview — otherwise the preview already
            // IS the whole thing and a body file would be dead weight.
            if (pre.system.length > META_SYS && saveBody(sid, "sys", pre.system)) reqMeta.sys_full = true;
            if (pre.input.length > META_TEXT && saveBody(sid, "usr", pre.input)) reqMeta.usr_full = true;
            delete parsed.config;
            // Per-provider rules need the family BEFORE the body is rewritten.
            // classifyProvider is pure (path + model) and both inputs are known
            // here, so classifying early costs nothing and the gateway block
            // below re-derives the same answer.
            applyPatternRules(
              parsed,
              target.isGateway ? classifyProvider(target.path, reqMeta.model) : null
            );
            dumpPrompt(parsed);
            // Always log the body's SHAPE (keys+types, no values) when extraction
            // came up empty — that is the fingerprint of an unrecognized schema,
            // and it is what turns "no content shown" into a fixable bug report.
            if (!pre.system && !pre.input) {
              console.error(
                `[${new Date().toISOString()}] [${sid}] no content extracted — body shape: ${shapeOf(parsed)}`
              );
            }
            debugDump(sid, "REQUEST BODY (post-rules)", JSON.stringify(parsed, null, 2));
            // Capture TRANSFORMED content (post-rules)
            const post = extractRequestContent(parsed);
            reqMeta.system = post.system.slice(0, META_SYS);
            reqMeta.input = post.input.slice(0, META_TEXT);
            if (post.system.length > META_SYS && saveBody(sid, "syso", post.system)) reqMeta.syso_full = true;
            if (post.input.length > META_TEXT && saveBody(sid, "usro", post.input)) reqMeta.usro_full = true;
            // Compare the FULL strings here. The panel only receives previews,
            // so a rule that fires past the preview length would look like a
            // no-op to it and the "after rules" block would never render.
            reqMeta.sys_changed = post.system !== pre.system;
            reqMeta.usr_changed = post.input !== pre.input;
            bodyBuf = Buffer.from(JSON.stringify(parsed), "utf8");
          }
        } catch (_) {
          // not JSON - forward as-is
        }
        headers["content-length"] = Buffer.byteLength(bodyBuf);
      } else if (bodyBuf.length > TRANSFORM_LIMIT) {
        // Large body: extract just model/stream/msg-count without full parse.
        // Use quick regex on the first 2KB to get the essentials for routing.
        const head = bodyBuf.toString("utf8", 0, Math.min(2048, bodyBuf.length));
        const mModel = head.match(/"model"\s*:\s*"([^"]+)"/);
        const mStream = head.match(/"stream"\s*:\s*(true|false)/);
        if (mModel) reqMeta.model = mModel[1];
        if (mStream) reqMeta.stream = mStream[1] === "true";
        reqMeta.msgs = (head.match(/"role"/g) || []).length;
        console.error(`[${new Date().toISOString()}] [${sid}] large body (${(bodyBuf.length / 1048576).toFixed(1)}MB) — forwarding without transforms`);
        // content-length stays as original — body is unchanged
      }

      if (target.isGateway) {
        // Path decides when unambiguous; the client's credential decides when it
        // is not (/models) and always picks the OpenAI api-host vs ChatGPT backend.
        const provider = resolveProvider(target.path, reqMeta.model, headers);
        const selected = PROVIDERS[provider];
        // This is an INSPECTION proxy: ask the upstream for uncompressed bodies
        // so the data panel can actually read them. Clients send
        // "accept-encoding: gzip", and the observer was parsing compressed bytes
        // — which is why every response logged "(stream produced no text
        // output)" even on a healthy 200. Costs bandwidth, buys visibility.
        headers["accept-encoding"] = "identity";
        // Rewrite the path to whatever shape this upstream expects — see
        // normalizeUpstreamPath. Only on the gateway path; forward-proxy
        // requests (absolute-form URLs) keep the caller's path untouched.
        const providerTarget = {
          ...selected,
          path: normalizeUpstreamPath(target.path, selected),
          isGateway: true,
          provider,
        };
        target = selectHttpDispatch({ target, providerTarget, runtime: RUNTIME });
        headers["host"] = target.port === (target.client === https ? 443 : 80)
          ? target.host
          : `${target.host}:${target.port}`;

        if (selected.key) {
          delete headers["authorization"];
          delete headers["Authorization"];
          delete headers["x-api-key"];
          if (provider === "anthropic") headers["x-api-key"] = selected.key;
          else headers["authorization"] = `Bearer ${selected.key}`;
        }
        if (provider === "anthropic" && !headers["anthropic-version"])
          headers["anthropic-version"] = "2023-06-01";
        // Both OpenAI upstreams (api host and ChatGPT backend) reject the
        // Anthropic version header — match on the prefix so openai_chatgpt is
        // covered too, not just "openai".
        if (provider.startsWith("openai")) delete headers["anthropic-version"];
      }

      // Log the request (input) — includes both original and post-rules content
      dataLog({
        sid, ts: new Date().toISOString(), dir: "req",
        method: req.method, path: target.path,
        src: srcIp, client: clientId,
        // Raw body saved alongside; the UI fetches it on demand when expanded.
        has_req_body: saveBody(sid, "req", bodyBuf),
        dest: target.host, logical_dest: target.logicalDest || target.host,
        forward_mode: target.forwardMode || "automatic", provider: target.provider || null, model: reqMeta.model,
        msgs: reqMeta.msgs, stream: reqMeta.stream,
        bytes: bodyBuf.length,
        system_original: reqMeta.system_original || null,
        system: reqMeta.system || null,
        input_original: reqMeta.input_original || null,
        input: reqMeta.input || null,
        // Tell the panel an untruncated copy exists in the body store, so its
        // Open button fetches that instead of re-showing the preview above.
        sys_full: reqMeta.sys_full || undefined,
        syso_full: reqMeta.syso_full || undefined,
        usr_full: reqMeta.usr_full || undefined,
        usro_full: reqMeta.usro_full || undefined,
        sys_changed: reqMeta.sys_changed || undefined,
        usr_changed: reqMeta.usr_changed || undefined
      });

      const resChunks = [];
      // Provisional only — the request body's "stream" flag. It is refined below
      // from the RESPONSE content-type, because an upstream can reply with SSE
      // even when the request never said "stream": true (the ChatGPT Codex
      // backend does exactly this). Buffering an SSE body means waiting for an
      // "end" event that never fires: the client sees a dead connection, times
      // out, and retries forever with nothing logged as a response.
      let isStreaming = !!reqMeta.stream;
      // Tracks whether upstream response headers ever arrived. Without this, a
      // request that stalls and is then abandoned by the client vanishes: no
      // response is ever logged and the UI shows "···" forever with no clue
      // whether the upstream was slow, silent, or refused the connection.
      let responded = false;
      // Dump request headers BEFORE dispatching. Doing it in the response
      // callback means a request that never gets a response reveals nothing —
      // exactly the case worth debugging.
      debugDump(sid, "REQUEST HEADERS", redactHeaders(headers));
      const upstream = requestClient(target, RUNTIME).request(
        { hostname: target.host, port: target.port, path: target.path, method: req.method, headers },
        (up) => {
          responded = true;
          const ct = String(up.headers["content-type"] || "-");
          if (/text\/event-stream/i.test(ct)) {
            isStreaming = true;
            upstream.setTimeout(0);   // SSE legitimately runs for minutes
          }
          console.error(
            `[${new Date().toISOString()}] [${sid}] upstream ${up.statusCode} ` +
            `ct=${ct} streaming=${isStreaming} (${Date.now() - t0}ms)`
          );
          debugDump(sid, "RESPONSE HEADERS", redactHeaders(up.headers));

          if (isStreaming) {
            // Headers go out now so the client sees tokens as they arrive.
            res.writeHead(up.statusCode, up.headers);
            // STREAMING (SSE): pipe directly so the client sees tokens in real time.
            // pipe() owns backpressure (it pauses `up` when `res` is full). We ALSO
            // attach a passive observer to reconstruct the text the model sent, so
            // the Data stream panel can show the actual reply instead of a
            // placeholder. Safety rules that keep this from causing the mid-stream
            // stalls the old code worried about:
            //   - we never pause/resume/read the stream ourselves (pipe stays in
            //     charge of flow),
            //   - we stop accumulating after SSE_CAP bytes so a long stream can't
            //     grow memory without bound.
            up.pipe(res);
            const SSE_CAP = 512 * 1024;
            let sseBytes = 0, sseText = "", sseLineBuf = "", sseCapped = false;
            // Raw SSE frames, retained up to BODY_CAP so the panel can always
            // offer the real stream on expand — not just when debug is on.
            let sseRaw = "";
            up.on("data", (c) => {
              if (sseRaw.length < BODY_CAP) sseRaw += c.toString("utf8");
              if (sseCapped) return;
              sseBytes += c.length;
              sseLineBuf += c.toString("utf8");
              let nl;
              while ((nl = sseLineBuf.indexOf("\n")) >= 0) {
                const line = sseLineBuf.slice(0, nl).trim();
                sseLineBuf = sseLineBuf.slice(nl + 1);
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const ev = JSON.parse(payload);
                  // Anthropic Messages streaming: text arrives as content_block_delta
                  // with a text_delta. (tool_use blocks stream as input_json_delta,
                  // which we skip — the readable reply is the text.)
                  if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
                    sseText += ev.delta.text || "";
                  } else if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
                    // OpenAI Responses API (Codex): text arrives as a plain
                    // string delta rather than a nested block.
                    sseText += ev.delta;
                  }
                } catch (_) { /* partial or non-JSON keepalive line — ignore */ }
              }
              if (sseBytes >= SSE_CAP) sseCapped = true;
            });
            // Log status immediately so the session shows up while it streams...
            dataLog({
              sid, ts: new Date().toISOString(), dir: "res",
              status: up.statusCode, time_ms: Date.now() - t0,
              bytes: 0, output: null, streaming: true, error: null
            });
            // ...then log the captured reply (same sid) when the stream finishes.
            up.on("end", () => {
              debugDump(sid, "RESPONSE BODY (raw SSE stream)", sseRaw);
              const out = sseText
                ? sseText.slice(0, META_TEXT) + (sseCapped || sseText.length > META_TEXT ? "\n…(truncated)" : "")
                : "(stream produced no text output)";
              const outFull = sseText.length > META_TEXT && saveBody(sid, "out", sseText);
              if (!sseText && sseRaw) {
                // Streamed fine but nothing matched a known delta event — same
                // class of bug as an unrecognized request shape, so surface it.
                const firstEvent = (sseRaw.match(/^data:\s*(.+)$/m) || [])[1] || "";
                console.error(
                  `[${new Date().toISOString()}] [${sid}] SSE produced no text — first frame: ${firstEvent.slice(0, 300)}`
                );
              }
              dataLog({
                sid, ts: new Date().toISOString(), dir: "res",
                status: up.statusCode, time_ms: Date.now() - t0,
                bytes: sseBytes, output: out, streaming: true, stream_complete: true, error: null,
                out_full: outFull || undefined,
                // Raw SSE frames, so the panel can show a streamed reply even
                // when no known delta event matched.
                has_res_body: saveBody(sid, "res", sseRaw),
              });
            });
          } else {
            // NON-STREAMING: collect the full body for logging, then forward.
            // Body is small (single JSON object), so no backpressure concern.
            up.on("data", (c) => resChunks.push(c));
            up.on("end", () => {
              let resBody = Buffer.concat(resChunks);
              debugDump(sid, "RESPONSE BODY", resBody);
              // Rewrite BEFORE logging, so the panel shows what the client was
              // actually given rather than what upstream sent.
              const rw = rewriteConfigResponse(target.path, resBody);
              if (rw) {
                resBody = rw.buf;
                console.error(
                  `[${new Date().toISOString()}] [${sid}] models config rewritten — ` +
                  `prefer_websockets disabled on ${rw.models.length}: ${rw.models.join(", ")}`
                );
              }
              let output = null;
              let resErr = null;
              let outFull = false;
              try {
                const rp = JSON.parse(resBody.toString("utf8"));
                const t = extractResponseText(rp);
                if (t) {
                  output = t.slice(0, META_TEXT);
                  if (t.length > META_TEXT) outFull = saveBody(sid, "out", t);
                }
                if (rp.error) resErr = rp.error.message || JSON.stringify(rp.error).slice(0, 2000);
              } catch (_) {}
              dataLog({
                sid, ts: new Date().toISOString(), dir: "res",
                status: up.statusCode, time_ms: Date.now() - t0,
                bytes: resBody.length, output: output, error: resErr,
                out_full: outFull || undefined,
                rewritten: rw ? rw.models.length : undefined,
                has_res_body: saveBody(sid, "res", resBody),
              });
              // Headers were held back for exactly this: a rewrite changes the
              // byte count, and a stale content-length would either truncate the
              // body or leave the client waiting for bytes that never come.
              // Guarded: holding headers this long means an upstream timeout or
              // socket error can reach its 502 path first, and writing twice
              // throws ERR_HTTP_HEADERS_SENT.
              if (!res.headersSent) {
                const outHeaders = Object.assign({}, up.headers);
                delete outHeaders["transfer-encoding"];
                outHeaders["content-length"] = Buffer.byteLength(resBody);
                res.writeHead(up.statusCode, outHeaders);
              }
              res.end(resBody);
            });
          }
        }
      );

      // Disable socket timeout for streaming — SSE can run for minutes.
      // Non-streaming gets a generous 60s timeout.
      upstream.setTimeout(isStreaming ? 0 : 60000, () => {
        if (!isStreaming) {
          console.error(`[${new Date().toISOString()}] [${sid}] upstream timeout`);
          upstream.destroy(new Error("upstream timeout"));
        }
      });

      // Clean up upstream if client disconnects (e.g. Claude Code cancels).
      // If the client gave up BEFORE the upstream ever answered, record it —
      // otherwise the request is logged with no response and the data panel
      // shows a permanent "···" that can't be told apart from a live stream.
      // 499 is the nginx convention for "client closed request".
      res.on("close", () => {
        if (!responded) {
          const ms = Date.now() - t0;
          // Include the headers that decide how this request is meant to be
          // handled — a websocket upgrade, an SSE accept, or a keep-alive poll
          // all look identical in the access log but behave very differently.
          const h = k => headers[k] || headers[k.toLowerCase()] || "-";
          console.error(
            `[${new Date().toISOString()}] [${sid}] client gave up after ${ms}ms ` +
            `— upstream ${target.host} never sent response headers ` +
            `| method=${req.method} accept=${h("accept")} upgrade=${h("upgrade")} ` +
            `connection=${h("connection")} session_id=${h("session_id")} ` +
            `last-event-id=${h("last-event-id")}`
          );
          dataLog({
            sid, ts: new Date().toISOString(), dir: "res",
            status: 499, time_ms: ms, bytes: 0, output: null,
            error: `client disconnected after ${ms}ms — ${target.host} never responded`,
          });
        }
        if (!upstream.destroyed) upstream.destroy();
      });

      upstream.on("error", (err) => {
        console.error(`[${new Date().toISOString()}] [${sid}] upstream error: ${err.message}`);
        dataLog({
          sid, ts: new Date().toISOString(), dir: "res",
          status: 502, time_ms: Date.now() - t0, error: err.message
        });
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "proxy_error", message: err.message } }));
      });

      if (bodyBuf.length) upstream.end(bodyBuf);
      else upstream.end();
    });

    req.on("error", (err) =>
      console.error(`[${new Date().toISOString()}] request error: ${err.message}`)
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] handler error: ${err.message}`);
    try {
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "proxy_error", message: err.message } }));
    } catch (_) {}
  }
});

// CONNECT tunnels use the same runtime forwarding mode as HTTP requests.
installConnectHandler(server, RUNTIME, (message) =>
  console.error("[" + new Date().toISOString() + "] " + message)
);

// Codex opens a WebSocket to /responses before falling back to HTTPS. It has a
// working fallback, but only reaches it after websocket_connect_timeout_ms —
// roughly 15 seconds of dead air at every session start.
//
// There is no client-side off switch: `supports_websockets` is a model_providers
// field and Codex refuses to override the built-in `openai` provider ("Built-in
// providers cannot be overridden"), and the responses_websockets feature flags
// are already false and marked removed. So the only lever is here.
//
// Without this handler Node emits "upgrade" with nobody listening and drops the
// socket without a reply — the client learns nothing and waits out its full
// timeout. Answering 426 immediately turns that stall into an instant fallback.
server.on("upgrade", (req, socket) => {
  const sid = genSid();
  const proto = String(req.headers["sec-websocket-protocol"] || "-");
  console.error(
    `[${new Date().toISOString()}] [${sid}] refused websocket upgrade ` +
    `${req.method} ${req.url} proto=${proto} — client should fall back to HTTPS`
  );
  // Surface it in the panel too, so a refused upgrade is visible rather than a
  // connection that merely vanishes.
  dataLog({
    sid, ts: new Date().toISOString(), dir: "req",
    method: req.method, path: req.url,
    src: clientIp(req), client: clientName(req.headers),
    dest: "(refused: websocket upgrade)", bytes: 0,
  });
  dataLog({
    sid, ts: new Date().toISOString(), dir: "res",
    status: 426, time_ms: 0, bytes: 0, output: null,
    error: "websocket upgrade refused — this proxy is HTTP-only, client falls back to HTTPS",
  });
  socket.write(
    "HTTP/1.1 426 Upgrade Required\r\n" +
    "Connection: close\r\n" +
    "Content-Length: 0\r\n\r\n"
  );
  socket.destroy();
});

server.on("clientError", (err, socket) => {
  console.error(`[${new Date().toISOString()}] client error: ${err.message}`);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});


function updateGuiConfig(payload) {
  const persisted = {};
  if (payload.providers && typeof payload.providers === "object") {
    const envNames = { anthropic: "ANTHROPIC_ENDPOINT", openai: "OPENAI_ENDPOINT", openai_chatgpt: "OPENAI_CHATGPT_ENDPOINT" };
    const nextEndpoints = {};
    const parsedProviders = {};
    for (const name of Object.keys(envNames)) {
      const value = String(payload.providers[name] || "").trim();
      if (!value) throw new Error(name + " endpoint is required");
      if (process.env[envNames[name]] && value !== PROVIDERS[name].url.toString()) throw new Error(name + " endpoint is locked by the environment");
      let parsedUrl;
      try { parsedUrl = new URL(value); } catch (_) { throw new Error(name + " endpoint must be a valid URL"); }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error(name + " endpoint must use HTTP or HTTPS");
      parsedProviders[name] = { ...parseEndpoint(name, value), key: PROVIDERS[name].key };
    }
    for (const name of Object.keys(parsedProviders)) {
      PROVIDERS[name] = parsedProviders[name];
      nextEndpoints[name] = PROVIDERS[name].url.toString();
    }
    persisted.providerEndpoints = nextEndpoints;
  }
  if (payload.debugBodies !== undefined) {
    if (process.env.DEBUG_BODIES !== undefined && Boolean(payload.debugBodies) !== DEBUG_BODIES) throw new Error("Debug logging is locked by DEBUG_BODIES");
    DEBUG_BODIES = Boolean(payload.debugBodies);
    persisted.debugBodies = DEBUG_BODIES;
  }
  if (payload.bodyCap !== undefined) {
    const value = Number(payload.bodyCap);
    if (!Number.isInteger(value) || value < 1024 || value > 67108864) throw new Error("Body cap must be between 1024 and 67108864 bytes");
    if (process.env.BODY_CAP !== undefined && value !== BODY_CAP) throw new Error("Body cap is locked by BODY_CAP");
    BODY_CAP = value; persisted.bodyCap = value;
  }
  if (payload.bodyKeep !== undefined) {
    const value = Number(payload.bodyKeep);
    if (!Number.isInteger(value) || value < 1 || value > 10000) throw new Error("Body retention must be between 1 and 10000 files");
    if (process.env.BODY_KEEP !== undefined && value !== BODY_KEEP) throw new Error("Body retention is locked by BODY_KEEP");
    BODY_KEEP = value; persisted.bodyKeep = value;
  }
  return persisted;
}

function start() {
  let guiServer = null;
  process.on("uncaughtException", (err) =>
    console.error("[" + new Date().toISOString() + "] uncaughtException: " + (err.stack || err.message))
  );
  process.on("unhandledRejection", (reason) =>
    console.error("[" + new Date().toISOString() + "] unhandledRejection: " + reason)
  );

  if (OPTIONS.gui.enabled) {
    guiServer = createGuiServer({
    runtime: RUNTIME,
    locks: OPTIONS.locks,
    files: {
      dataLog: DATA_LOG, bodyDir: BODY_DIR, rulesFile: RULES_FILE,
      configFile: GUI_CONFIG_FILE,
    },
    updateConfig: updateGuiConfig,
    status: () => ({
      version: PROXY_VERSION,
      listen: OPTIONS.listen,
      gui: OPTIONS.gui,
      providers: {
        anthropic: PROVIDERS.anthropic.url.toString(),
        openai: PROVIDERS.openai.url.toString(),
        openai_chatgpt: PROVIDERS.openai_chatgpt.url.toString(),
      },
      inspection: { debugBodies: DEBUG_BODIES, bodyCap: BODY_CAP, bodyKeep: BODY_KEEP },
      files: { dataLog: DATA_LOG, bodyDir: BODY_DIR, rulesFile: RULES_FILE },
    }),
  });
  guiServer.listen(OPTIONS.gui.port, OPTIONS.gui.host, () => {
    const bind = OPTIONS.gui.host + ":" + OPTIONS.gui.port;
    console.log("GUI listening on http://" + bind);
    if (!["127.0.0.1", "::1", "localhost"].includes(OPTIONS.gui.host)) {
      console.error("WARNING: GUI is exposed without authentication on " + bind);
    }
  });
}

server.listen(PORT, LISTEN_HOST, () =>
  console.log(
    `proxy v${PROXY_VERSION} listening on http://${LISTEN_HOST}:${PORT} ` +
      `[forward-proxy: HTTP + CONNECT] ` +
      `[gateway: anthropic=${PROVIDERS.anthropic.url.origin}, ` +
      `openai(api-key)=${PROVIDERS.openai.url.origin}, ` +
      `openai(chatgpt)=${PROVIDERS.openai_chatgpt.url.origin}${PROVIDERS.openai_chatgpt.basePath}, ` +
      `default=${DEFAULT_PROVIDER}]`
  )
);


  return { server, guiServer };
}

if (require.main === module) start();

module.exports = {
  HELP_TEXT,
  GUI_HTML,
  GUI_CSS,
  GUI_JS,
  isHelpRequest,
  OptionError,
  loadPersistedConfig,
  parseAddress,
  parseBoolean,
  parseProxyOptions,
  runtimeStoragePath,
  createRuntimeConfig,
  formatAuthority,
  selectHttpDispatch,
  absoluteUrl,
  connectThroughHttpProxy,
  installConnectHandler,
  requestClient,
  requestThroughHttpProxy,
  createGuiServer,
  readSessions,
  validateRules,
  start,
};
