// Maßnahmen 1–3 der Token-Analyse: den Runner mit schlankem Präfix starten.
//
// Warum nicht über AO: AOs `POST /sessions` nimmt projectId, kind, harness,
// model, prompt und displayName — mehr nicht (`controllers.SpawnSessionRequest`).
// Die Felder, die die Analyse braucht, gibt es nur im Inneren von AO:
// `LaunchConfig.DisallowedTools` setzt ausschließlich der Reviewer-Adapter, und
// ein Env-Feld hat `LaunchConfig` gar nicht — die in der Analyse zitierte
// Stelle ist `AgentModelDiscoveryRequest.Env`, der Modell-Discovery-Pfad.
// Über HTTP ist an die Kommandozeile des Runners also nicht heranzukommen.
//
// Deshalb startet die Bridge den Runner direkt. Das ist kein Verlust: der
// Runner braucht von AO nichts. Er bekommt keinen Branch, keinen PR und keinen
// Orchestrator — AOs Worktree war für ihn ohnehin nur ein Ort, an dem das
// Projekt *nicht* liegt (deshalb der Absatz im Auftrag, der ihn auf den
// absoluten Pfad schickt).
//
// Was die Kommandozeile bringt (Messwerte aus der Analyse, Präfix 31.487 Token,
// 27-mal gelesen):
//   --disable-slash-commands  keine Skill-Liste          −7.222 Token je Read
//   --strict-mcp-config       kein MCP-Server            −1.173 Token je Read
//                             und kein später verbindender Server, der nach
//                             Turn 1 den Cache-Eintrag ungültig macht (−0,24 $)
//   --disallowed-tools        der Runner liest nur       Maßnahme 3
//
// Nicht benutzt: CLAUDE_CONFIG_DIR (wie in der Analyse vorgeschlagen). In dem
// Ordner liegen auch die Anmeldedaten; ein frischer Ordner wäre nicht
// angemeldet, und sie zu kopieren hieße, Geheimnisse zu vervielfältigen.
// Ebenso nicht --safe-mode: es schaltet auch die Hooks ab, über die AO den
// Verbrauch mitschreibt.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { open, mkdir } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

// Der Runner untersucht und berichtet. Nur der dynamisch ergänzte Kartenordner
// bekommt Write/Edit; git und zerstörerische Shell-Befehle bleiben hart gesperrt.
// Deny schlägt Allow, die git-Regeln hier stechen also Bash unten aus.
export const RUNNER_DENY = [
  "NotebookEdit",
  "Bash(git commit:*)", "Bash(git push:*)", "Bash(git add:*)",
  "Bash(rm:*)", "Bash(mv:*)",
];

// -p kann nicht nachfragen: was nicht erlaubt ist, wird abgelehnt, nicht
// nachgefragt. Diese Liste ist deshalb genau das, was der Auftrag verlangt —
// lesen, suchen, git-Historie, und der Push der Karten an Agency.
export const RUNNER_ALLOW = [
  "Read", "Glob", "Grep", "TodoWrite", "WebFetch",
  "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)", "Bash(git status:*)",
  "Bash(node:*)",
];

/**
 * Die Kommandozeile des Runners. Rein und ohne Shell: jedes Argument steht
 * einzeln, nichts wird zu einem Befehlstext zusammengesetzt.
 */
export function runnerArgv({ model, prompt, addDirs = [], writeDir }) {
  if (!model) throw new Error("runnerArgv braucht ein Modell");
  if (!prompt) throw new Error("runnerArgv braucht einen Auftrag");
  for (const dir of addDirs) {
    if (!isAbsolute(dir)) throw new Error(`--add-dir braucht absolute Pfade, nicht ${dir}`);
  }
  if (!writeDir || !isAbsolute(writeDir)) throw new Error("runnerArgv braucht einen absoluten Kartenordner");
  const cardDir = writeDir.replaceAll("\\", "/").replace(/\/$/, "");
  return [
    "--print",
    "--output-format", "json",
    "--model", model,
    // Maßnahme 1: Skills, MCP-Server und damit auch der Cache-Abriss (2).
    "--disable-slash-commands",
    "--strict-mcp-config",
    // Maßnahme 3.
    "--disallowed-tools", RUNNER_DENY.join(","),
    "--allowed-tools", [...RUNNER_ALLOW, `Write(${cardDir}/**)`, `Edit(${cardDir}/**)`].join(","),
    ...addDirs.flatMap((dir) => ["--add-dir", dir]),
    // Nach "--", damit ein Auftrag, der mit "-" anfängt, kein Flag wird.
    "--", prompt,
  ];
}

/**
 * Sucht `claude` in PATH. Keine Shell, kein zusammengebauter Befehl: die
 * Kandidaten entstehen aus PATH und PATHEXT, und jeder wird nur auf Existenz
 * geprüft.
 */
export function resolveClaudeBinary(env = process.env, platform = process.platform, exists = existsSync) {
  const configured = env.BRIDGE_CLAUDE_BIN?.trim();
  if (configured) {
    if (!exists(configured)) throw new Error(`BRIDGE_CLAUDE_BIN zeigt auf nichts: ${configured}`);
    return configured;
  }
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `claude${ext}`);
      if (exists(candidate)) return candidate;
    }
  }
  throw new Error("claude wurde in PATH nicht gefunden. Pfad in BRIDGE_CLAUDE_BIN setzen, oder BRIDGE_RUNNER_MODE=ao.");
}

/**
 * Startet den Runner und kehrt sofort zurück. Der Lauf dauert Minuten; die
 * Bridge wartet nicht auf ihn, sie legt nur den Knopf wieder hin. Der Runner
 * pusht seine Karten selbst an Agency — genau wie unter AO.
 */
export async function startLocalRunner({
  binary, model, prompt, cwd, addDirs, writeDir, logFile, spawnFn = spawn,
}) {
  await mkdir(cwd, { recursive: true });
  const handle = await open(logFile, "a");
  const child = spawnFn(binary, runnerArgv({ model, prompt, addDirs, writeDir }), {
    cwd,
    // Kein Vererben der Standardeingabe: --print liest sonst auf ein stdin,
    // das nie endet, und der Lauf startet nie.
    stdio: ["ignore", handle.fd, handle.fd],
    detached: true,
    windowsHide: true,
    shell: false,
  });
  child.unref();
  await handle.close();
  return { pid: child.pid, logFile };
}

/** Läuft der zuletzt gestartete lokale Runner noch? */
export function localRunnerAlive(sessionId, kill = process.kill) {
  const pid = Number(String(sessionId ?? "").replace(/^lokal:/, ""));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0); // Signal 0 tötet nicht, es fragt nur nach.
    return true;
  } catch {
    return false;
  }
}
