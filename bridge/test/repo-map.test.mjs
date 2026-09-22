import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_MAP_CHARS, collectRepoFacts, renderRepoMap, writeRepoMap } from "../lib/repo-map.mjs";

const facts = {
  projectPath: "D:\\Polnisch",
  gitError: null,
  files: [
    "README.md", "package.json", "src/index.mjs", "src/lib/karten.mjs",
    "test/karten.test.mjs", "docs/aufbau.md",
  ],
  sized: [
    { file: "src/index.mjs", lines: 400 },
    { file: "src/lib/karten.mjs", lines: 120 },
    { file: "test/karten.test.mjs", lines: 90 },
  ],
  commits: ["abc1234  2026-09-18  Karten sortieren"],
  dirty: ["?? notizen.md"],
};

function map(over = {}) {
  return renderRepoMap({ projectId: "polnisch", generatedAt: "2026-09-20 08:00", facts: { ...facts, ...over } });
}

// ---- Was in der Karte stehen muss --------------------------------------------

test("die Karte nennt genau die Fakten, für die der Runner sonst Turns zahlt", () => {
  const text = map();
  assert.match(text, /6 versionierte Dateien/);
  assert.match(text, /src\/index\.mjs \| 400/, "Zeilenzahlen — 'wo steckt die Substanz'");
  assert.match(text, /test\/karten\.test\.mjs/, "Testliste");
  assert.match(text, /abc1234 {2}2026-09-18/, "git log");
  assert.match(text, /\?\? notizen\.md/, "Ungetracktes — dort steckt die angefangene Arbeit");
  assert.match(text, /README\.md/, "Einstiegspunkte");
});

test("die Karte sagt dem Runner, dass er nicht nachzählen soll", () => {
  assert.match(map(), /nicht noch einmal nachzählen/);
});

test("sie ist auf polnisch bezogen und nennt den Ordner", () => {
  const text = map();
  assert.match(text, /# Repo-Karte polnisch/);
  assert.match(text, /D:\\Polnisch/);
});

test("ohne Tests steht das als Befund da, nicht als leere Liste", () => {
  assert.match(map({ files: ["README.md"] }), /Keine Testdateien gefunden.*selbst ein Befund/s);
});

test("ohne git bricht nichts ab — die Karte sagt nur, dass sie leer ist", () => {
  const text = map({ gitError: "not a git repository" });
  assert.match(text, /Kein git-Repo/);
  assert.match(text, /hier musst du selbst schauen/);
});

// ---- Was nicht hineingehört --------------------------------------------------

test("node_modules und dist zählen nicht mit", async () => {
  // Erhoben wird das Bridge-Repo selbst. Ohne git faellt der Test weg.
  const echt = await collectRepoFacts({ projectPath: process.cwd() });
  if (echt.gitError) return;
  assert.equal(echt.files.filter((f) => f.includes("node_modules/")).length, 0);
  assert.ok(echt.files.some((f) => f.endsWith("lib/store.mjs")), "versionierte Dateien müssen drin sein");
  assert.ok(echt.sized.some((e) => e.lines > 0), "Zeilen werden wirklich gezählt");
});

// ---- Die Datei ---------------------------------------------------------------

test("writeRepoMap schreibt die Datei und meldet ihre Größe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-map-"));
  try {
    const out = join(dir, "repo-map-bridge.md");
    const result = await writeRepoMap({ projectId: "bridge", projectPath: process.cwd(), outFile: out });
    const text = await readFile(out, "utf8");

    assert.equal(result.file, out);
    assert.equal(result.chars, text.length);
    assert.match(text, /# Repo-Karte bridge/);
    assert.ok(result.chars <= MAX_MAP_CHARS, `${result.chars} Zeichen — die Karte darf nicht selbst teuer werden`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ein Ordner ohne git ergibt eine Karte statt eines Fehlers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "repo-map-leer-"));
  try {
    const out = join(dir, "karte.md");
    const result = await writeRepoMap({ projectId: "leer", projectPath: join(dir, "gibtsnicht"), outFile: out });
    assert.ok(result.gitError, "der Fehler wird gemeldet, nicht verschluckt");
    assert.match(await readFile(out, "utf8"), /Kein git-Repo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
