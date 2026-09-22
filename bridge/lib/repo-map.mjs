// Maßnahme 4 der Token-Analyse: die Repo-Karte.
//
// Der Runner hat im Testlauf die Turns 8–13 damit verbracht, sich einen
// Überblick zu verschaffen: Dateibaum, Testdateien, git log, Dateigrößen.
// Das sind Fakten, für die kein Modell nötig ist. Jeder dieser Turns liest
// aber das gesamte Präfix erneut mit — sechs Turns weniger sparen mehr als
// die eingesparten Tool-Ergebnisse selbst.
//
// Dieses Modul sammelt dieselben Fakten mit git und fs (0 Token) und legt sie
// als eine Datei ab. Der Auftrag verweist darauf; der Runner liest eine Datei
// statt sechs Turns zu erkunden.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Die Karte soll billig zu lesen sein. Wächst sie über dieses Maß, ist sie
// selbst ein Kostenfaktor — dann lieber abschneiden und das sagen.
export const MAX_MAP_CHARS = 24_000;

const MAX_LISTED_FILES = 400;
const MAX_COMMITS = 25;
const MAX_LINE_COUNT_BYTES = 512 * 1024;

// Womit der Runner tatsächlich arbeitet. Bilder, Archive und Lockfiles
// gehören nicht in eine Übersicht, die Entscheidungen tragen soll.
const CODE_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".go", ".py", ".rs", ".java",
  ".cs", ".rb", ".php", ".swift", ".kt", ".c", ".h", ".cpp", ".hpp", ".sql",
  ".sh", ".ps1", ".md", ".json", ".yaml", ".yml", ".html", ".css", ".vue",
]);

const NOISE = /(^|[\\/])(node_modules|\.git|dist|build|out|vendor|coverage|\.next|target)([\\/]|$)/;

function isTest(path) {
  return /(^|[\\/])(tests?|__tests__|spec)([\\/]|$)/i.test(path)
    || /\.(test|spec)\.[a-z]+$/i.test(path);
}

// git wird immer mit fester Argumentliste aufgerufen, nie über eine Shell:
// Projektpfade enthalten Leerzeichen, und ein zusammengebauter Befehl wäre
// eine Einladung.
async function git(projectPath, args) {
  const { stdout } = await run("git", ["-C", projectPath, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Sammelt die Fakten. Wirft nicht: ein Projekt ohne git bekommt eine kleinere Karte. */
export async function collectRepoFacts({ projectPath, read = readFile }) {
  const facts = { projectPath, files: [], commits: [], dirty: [], gitError: null };

  try {
    const listed = await git(projectPath, ["ls-files", "-z"]);
    facts.files = listed.split("\0").filter((f) => f && !NOISE.test(f));
  } catch (err) {
    facts.gitError = err.message;
    return facts;
  }

  try {
    const log = await git(projectPath, ["log", `-n${MAX_COMMITS}`, "--date=short", "--format=%h  %ad  %s"]);
    facts.commits = log.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch { /* frisches Repo ohne Commits */ }

  try {
    const status = await git(projectPath, ["status", "--porcelain"]);
    facts.dirty = status.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 60);
  } catch { /* egal */ }

  // Zeilenzahlen nur für Code, nur für lesbare Größen. Sie beantworten die
  // Frage, die der Runner sonst per Turn stellt: wo steckt die Substanz?
  const code = facts.files.filter((f) => CODE_EXTENSIONS.has(extname(f).toLowerCase()));
  facts.sized = [];
  for (const file of code.slice(0, MAX_LISTED_FILES * 3)) {
    try {
      const buf = await read(join(projectPath, file));
      if (buf.length > MAX_LINE_COUNT_BYTES) continue;
      let lines = 0;
      for (const byte of buf) if (byte === 10) lines++;
      facts.sized.push({ file, lines });
    } catch { /* gelöscht, Symlink, Rechte — die Datei fehlt dann eben */ }
  }
  return facts;
}

function directoryTable(files) {
  const counts = new Map();
  for (const file of files) {
    const parts = file.split("/");
    const key = parts.length === 1 ? "(Wurzel)" : parts.slice(0, Math.min(2, parts.length - 1)).join("/");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40);
}

/** Baut die Markdown-Karte aus den gesammelten Fakten. Rein — deshalb testbar. */
export function renderRepoMap({ projectId, generatedAt, facts }) {
  const out = [];
  out.push(`# Repo-Karte ${projectId}`, "");
  out.push(`Ordner: \`${facts.projectPath}\``);
  out.push(`Erhoben: ${generatedAt} von der Bridge, ohne Modell.`);
  out.push("");
  out.push("Diese Datei ersetzt das eigene Erkunden. Was hier steht, ist gemessen —");
  out.push("nicht noch einmal nachzählen, sondern gezielt die Dateien lesen, die zählen.");
  out.push("");

  if (facts.gitError) {
    out.push(`> Kein git-Repo oder git nicht erreichbar (${facts.gitError}).`);
    out.push("> Der Dateibaum fehlt deshalb — hier musst du selbst schauen.");
    return out.join("\n");
  }

  out.push(`## Umfang`, "");
  out.push(`- ${facts.files.length} versionierte Dateien`);
  const sized = facts.sized ?? [];
  const totalLines = sized.reduce((sum, e) => sum + e.lines, 0);
  out.push(`- ${sized.length} Code-/Textdateien mit zusammen ${totalLines.toLocaleString("de-DE")} Zeilen`);
  const tests = facts.files.filter(isTest);
  out.push(`- ${tests.length} Testdateien`);
  out.push("");

  out.push("## Ordner", "");
  out.push("| Ordner | Dateien |", "|---|---:|");
  for (const [dir, n] of directoryTable(facts.files)) out.push(`| ${dir} | ${n} |`);
  out.push("");

  out.push("## Die größten Dateien", "");
  out.push("| Datei | Zeilen |", "|---|---:|");
  for (const { file, lines } of [...sized].sort((a, b) => b.lines - a.lines).slice(0, 30)) {
    out.push(`| ${file} | ${lines} |`);
  }
  out.push("");

  out.push("## Tests", "");
  if (tests.length) out.push(...tests.slice(0, 60).map((t) => `- ${t}`));
  else out.push("_Keine Testdateien gefunden._ Das ist selbst ein Befund.");
  out.push("");

  out.push("## Einstiegspunkte und Konfiguration", "");
  const entries = facts.files.filter((f) => {
    const name = basename(f).toLowerCase();
    return f.split("/").length <= 2 && (
      /^(readme|package\.json|go\.mod|cargo\.toml|pyproject\.toml|requirements\.txt|makefile|dockerfile|tsconfig\.json)/.test(name)
      || /^(index|main|app|cli)\.[a-z]+$/.test(name));
  });
  out.push(...(entries.length ? entries.slice(0, 30).map((e) => `- ${e}`) : ["_Nichts Offensichtliches._"]));
  out.push("");

  out.push(`## Die letzten ${facts.commits.length} Commits`, "");
  out.push(...(facts.commits.length ? facts.commits.map((c) => `- ${c}`) : ["_Noch keine Commits._"]));
  out.push("");

  out.push("## Nicht eingecheckt", "");
  if (facts.dirty.length) {
    out.push("Diese Dateien stehen nicht im Repo — hier steckt oft die angefangene Arbeit:", "");
    out.push(...facts.dirty.map((d) => `- ${d}`));
  } else {
    out.push("_Arbeitsverzeichnis sauber._");
  }
  out.push("");
  return out.join("\n");
}

/** Erhebt und schreibt die Karte. Gibt den Pfad zurück, auch wenn git fehlt. */
export async function writeRepoMap({ projectId, projectPath, outFile, now = Date.now() }) {
  const facts = await collectRepoFacts({ projectPath });
  let text = renderRepoMap({
    projectId,
    generatedAt: new Date(now).toISOString().slice(0, 16).replace("T", " "),
    facts,
  });
  if (text.length > MAX_MAP_CHARS) {
    text = `${text.slice(0, MAX_MAP_CHARS)}\n\n_(gekürzt bei ${MAX_MAP_CHARS} Zeichen — das Repo ist größer als die Karte)_\n`;
  }
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, text, "utf8");
  return { file: outFile, chars: text.length, files: facts.files.length, gitError: facts.gitError };
}
