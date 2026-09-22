import test from "node:test";
import assert from "node:assert/strict";
import {
  RUNNER_ALLOW, RUNNER_DENY, localRunnerAlive, resolveClaudeBinary, runnerArgv, startLocalRunner,
} from "../lib/runner-launch.mjs";

function argv(over = {}) {
  return runnerArgv({ model: "claude-sonnet-5", prompt: "Untersuche polnisch.", writeDir: "D:\\cards", ...over });
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

// ---- Die Kommandozeile -------------------------------------------------------

test("Maßnahme 1: keine Skills und kein MCP-Server im Präfix", () => {
  // Das ist der ganze Grund, warum der Runner nicht über AO läuft: die
  // Skill-Liste war 7.222 Token, die MCP-Instruktionen 1.173 — je Read, 27-mal.
  const args = argv();
  assert.ok(args.includes("--disable-slash-commands"));
  assert.ok(args.includes("--strict-mcp-config"));
});

test("Maßnahme 3: der Runner darf nur Karten im Ausgabeordner schreiben", () => {
  const deny = valueOf(argv(), "--disallowed-tools").split(",");
  assert.ok(deny.includes("NotebookEdit"));
  assert.ok(!deny.includes("Write"));
  assert.ok(!deny.includes("Edit"));
  // Bash bleibt erlaubt — aber nicht zum Committen, Pushen oder Löschen.
  for (const rule of ["Bash(git commit:*)", "Bash(git push:*)", "Bash(rm:*)"]) {
    assert.ok(deny.includes(rule), rule);
  }
});

test("--print kann nicht nachfragen, also steht das Nötige auf der Erlaubnisliste", () => {
  const allow = valueOf(argv(), "--allowed-tools").split(",");
  // Ohne Read/Grep untersucht er nichts, ohne Bash(node:*) pusht er keine Karte.
  for (const tool of ["Read", "Glob", "Grep", "Bash(node:*)"]) assert.ok(allow.includes(tool), tool);
  assert.ok(allow.includes("Write(D:/cards/**)"));
  assert.ok(allow.includes("Edit(D:/cards/**)"));
  assert.deepEqual(allow.slice(0, RUNNER_ALLOW.length), RUNNER_ALLOW);
});

test("kein erlaubtes Werkzeug steht zugleich auf der Verbotsliste", () => {
  // Deny schlaegt Allow. Stuenden hier Doppel, waere die Kommandozeile still
  // wirkungslos statt laut falsch.
  const doppelt = RUNNER_ALLOW.filter((t) => RUNNER_DENY.includes(t));
  assert.deepEqual(doppelt, []);
});

test("der Auftrag steht hinter -- und kann kein Flag werden", () => {
  const args = argv({ prompt: "--version" });
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), "--version");
});

test("das Modell kommt aus der Konfiguration, nicht aus dem Code", () => {
  assert.equal(valueOf(argv({ model: "claude-opus-5" }), "--model"), "claude-opus-5");
});

test("die Ausgabe ist JSON — nur so ist der Verbrauch danach messbar", () => {
  assert.equal(valueOf(argv(), "--output-format"), "json");
});

test("--add-dir gibt Projekt und Profil frei, denn gearbeitet wird woanders", () => {
  const args = argv({ addDirs: ["D:\\Polnisch", "D:\\repo\\profil"] });
  const dirs = args.filter((a, i) => args[i - 1] === "--add-dir");
  assert.deepEqual(dirs, ["D:\\Polnisch", "D:\\repo\\profil"]);
});

test("ein relativer Pfad in --add-dir ist ein Fehler, kein stiller Fehlgriff", () => {
  assert.throws(() => argv({ addDirs: ["..\\woanders"] }), /absolute Pfade/);
});

test("ohne Modell oder Auftrag wird nicht gestartet", () => {
  assert.throws(() => runnerArgv({ prompt: "x" }), /Modell/);
  assert.throws(() => runnerArgv({ model: "x" }), /Auftrag/);
});

// ---- claude finden -----------------------------------------------------------

test("BRIDGE_CLAUDE_BIN hat Vorrang, muss aber existieren", () => {
  const env = { BRIDGE_CLAUDE_BIN: "D:\\bin\\claude.exe" };
  assert.equal(resolveClaudeBinary(env, "win32", () => true), "D:\\bin\\claude.exe");
  assert.throws(() => resolveClaudeBinary(env, "win32", () => false), /zeigt auf nichts/);
});

test("ohne Angabe wird PATH mit PATHEXT abgesucht", () => {
  const env = { PATH: "C:\\leer;C:\\tools", PATHEXT: ".COM;.EXE" };
  const found = resolveClaudeBinary(env, "win32", (p) => p === "C:\\tools\\claude.EXE");
  assert.equal(found, "C:\\tools\\claude.EXE");
});

test("fehlt claude ganz, nennt der Fehler den Ausweg", () => {
  assert.throws(
    () => resolveClaudeBinary({ PATH: "C:\\leer", PATHEXT: ".EXE" }, "win32", () => false),
    /BRIDGE_RUNNER_MODE=ao/);
});

// ---- Läuft noch? -------------------------------------------------------------

test("localRunnerAlive fragt den vermerkten Prozess, ohne ihn anzufassen", () => {
  const gefragt = [];
  const kill = (pid, signal) => { gefragt.push([pid, signal]); };
  assert.equal(localRunnerAlive("lokal:4711", kill), true);
  assert.deepEqual(gefragt, [[4711, 0]], "Signal 0 fragt nur nach, es tötet nicht");
});

test("ein beendeter Prozess und Unsinn gelten beide als 'läuft nicht'", () => {
  assert.equal(localRunnerAlive("lokal:4711", () => { throw new Error("ESRCH"); }), false);
  assert.equal(localRunnerAlive(null), false);
  assert.equal(localRunnerAlive("pol-7"), false, "eine AO-Session ist kein lokaler Prozess");
});

// ---- Der Start ---------------------------------------------------------------

test("gestartet wird ohne Shell, losgelöst und ohne stdin", async () => {
  // stdio[0] muss "ignore" sein: --print wuerde sonst auf eine Eingabe warten,
  // die nie kommt, und der Lauf faenge nie an.
  let seen = null;
  const spawnFn = (binary, args, options) => {
    seen = { binary, args, options };
    return { pid: 1234, unref() {} };
  };
  const dir = process.env.TEMP ?? process.env.TMPDIR ?? ".";
  const started = await startLocalRunner({
    binary: "C:\\tools\\claude.exe", model: "claude-sonnet-5", prompt: "Los.",
    cwd: `${dir}\\bridge-test-cwd`, addDirs: [], writeDir: `${dir}\\bridge-test-cards`,
    logFile: `${dir}\\bridge-test.log`, spawnFn,
  });

  assert.equal(started.pid, 1234);
  assert.equal(seen.binary, "C:\\tools\\claude.exe");
  assert.equal(seen.options.shell, false, "kein zusammengesetzter Shell-Befehl");
  assert.equal(seen.options.detached, true);
  assert.equal(seen.options.stdio[0], "ignore");
  assert.ok(seen.args.includes("--print"));
});
