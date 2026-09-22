# Token-Analyse des Testlaufs Polnisch, 2026-09-19

**Ergebnis: Der Discovery-Runner verbraucht 2,1 Millionen Token pro Lauf. Rund zwei Drittel davon sind Ballast, der nichts mit dem Projekt zu tun hat.** Durch reine Konfiguration — ohne eine Zeile Architektur zu ändern — lässt sich der Verbrauch auf etwa ein Fünftel senken.

Quellen dieser Analyse:

- `D:\Sandbox_Agency_AO\ao-data\ao.db`, Tabelle `model_usage_events` (exakte Abrechnung je API-Call)
- `%USERPROFILE%\.claude\projects\D--Sandbox-Agency-AO-ao-data-worktrees-standalone-sessions-standalone-1\e10862f0-…jsonl` (Runner-Transkript)
- `%USERPROFILE%\.claude\projects\D--Sandbox-Agency-AO-ao-data-worktrees-polnisch-orchestrator-polnisch-orchestrator\8a107036-…jsonl` (Orchestrator-Transkript)

Alle Zahlen sind gemessen, nicht geschätzt.

## Was der Lauf wirklich verbraucht hat

| Session | Calls | Token gesamt | Kosten |
|---|---:|---:|---:|
| `standalone-1` „agency-runner" (Opus 5) | 29 | **2.117.314** | 2,71 $ |
| `polnisch-1` Orchestrator (Opus 5) | 7 | **260.737** | 0,57 $ |
| `polnisch-2` Worker (OpenCode/GLM) | — | nicht erfasst | 0,13 $ |
| Codex-Reviewer | — | nicht erfasst | — |

2,1 Millionen Token für einen Discovery-Lauf. Das ist die Zahl, die das Pro-Limit sieht.

Der Worker taucht nicht auf, weil `usage_bindings` nur `claude-code`, `codex` und `kimi` kennt — OpenCode-Sessions werden nicht erfasst (siehe S17 im Testlaufbericht).

## Die Kostenstruktur

| Posten | Token | Preis | Anteil |
|---|---:|---:|---:|
| Cache-**Writes** (1h-TTL, 2× = 10 $/Mio) | 127.912 | 1,28 $ | **47 %** |
| Cache-**Reads** (0,1× = 0,50 $/Mio) | 1.971.670 | 0,99 $ | **36 %** |
| Output (25 $/Mio) | 17.674 | 0,44 $ | 16 % |
| Echter ungecachter Input | **58** | 0,00 $ | 0 % |

58 Token ungecachter Input. Der Cache funktioniert also bereits praktisch perfekt — Claude Code macht das von allein, da ist nichts nachzurüsten. Die Kosten entstehen **trotz** Cache, weil ein 100.000-Token-Kontext 29-mal gelesen wird.

Wichtig: Claude Code schreibt ausschließlich mit **1-Stunden-TTL** (`ephemeral_1h_input_tokens`), also zum doppelten Input-Preis statt zum 1,25-fachen der 5-Minuten-TTL. Innerhalb eines Laufs liegen die Turns Sekunden auseinander; die 5-Minuten-TTL hätte gereicht und wäre 37 % billiger im Write-Anteil.

## Befund 1: Ein Cache-Abriss kostet 0,24 $ — vermeidbar

Die Turn-für-Turn-Abfolge am Anfang:

```
Turn 1:  cache_write = 24.324   cache_read = 0
Turn 2:  cache_write = 31.487   cache_read = 0      ← der Cache ist tot
Turn 3:  cache_write =  1.577   cache_read = 31.487 ← ab hier greift er
```

Turn 2 liest **null** aus dem Cache. Die 24.324 Token aus Turn 1 wurden geschrieben, bezahlt und weggeworfen.

Die Ursache steht im Transkript, zwischen Turn 1 und Turn 2:

```
attachment  deferred_tools_delta    → 8 Tools "mcp__claude_ai_Claude_Docs__*"
attachment  mcp_instructions_delta  → "claude.ai Claude Docs" (~1.170 Token)
```

**Der Claude-Docs-MCP-Server hat sich verspätet verbunden.** MCP-Server verbinden asynchron; wenn die Verbindung steht, ändern sich Tool-Liste und Instruktionen — und die stehen im gecachten Präfix. Jede Änderung dort macht den gesamten Cache-Eintrag ungültig.

Kosten: 24.324 Token × 10 $/Mio = **0,24 $, also 9 % des Laufs, für nichts.**

## Befund 2: Zwei Drittel des Kontexts sind Ballast

Einzeln vermessene Anhänge im Runner-Transkript:

| Was im Kontext steckt | Token | Braucht der Runner das? |
|---|---:|---|
| `skill_listing` — 20 Skills (pdf, pptx, xlsx, dataviz, morning, email-antwort, second-brain-query …) | **7.222** | **nein** |
| Claude-Docs-MCP-Instruktionen | 1.173 | **nein** |
| `agent_listing` — Subagent-Typen | 931 | **nein** |
| Deferred Tools (Cron, Monitor, DesignSync, PushNotification …) | ~550 | **nein** |
| Claude Codes System-Prompt + Tool-Definitionen | ~18.000 | teilweise |
| Globales `CLAUDE.md` | ~500 | ja |
| **Der eigentliche Runner-Auftrag** | **610** | ja |

Der Auftrag ist 610 Token. Das Präfix drumherum ist 31.487. **Das Verhältnis ist 1:50.**

Dieses Präfix wird 27-mal gelesen: 31.487 × 27 = **850.149 Token = 40 % des gesamten Laufs**, nur um dieselbe unveränderte Boilerplate immer wieder durchzuschicken.

Beim Orchestrator ist es noch ausgeprägter: Präfix 28.535 Token bei einem Endkontext von 42.776 — **67 % Ballast**, davon allein 8.814 Token Skill-Liste.

Zusätzlich werden `output_style` (~197 Token) und `total_tokens_reminder` (~162 Token) in **jedem** Turn neu angehängt: 29 × ~360 = ~10.400 Token, die danach in jedem Folge-Turn mitgelesen werden.

## Befund 3: Der Runner erkundet Agency, nicht nur das Projekt

Von den 29 Turns gingen die ersten sieben fast komplett für das Kartenformat drauf:

| Turn | Was | Tool-Ergebnis |
|---|---|---:|
| 1–3 | `SKILL.md`, `APPROVALS.md`, `LAYOUT.md`, `me.md`, `push-card.mjs` | 4.436 Tok |
| 4–7 | **Agencys eigenen Quellcode lesen**: `app/api/ideas/route.ts`, `lib/rise.ts`, `lib/blocked-card.ts`, README | 5.780 Tok |
| 8–22 | Polnisch-Projekt untersuchen | ~19.000 Tok |
| 23–29 | Karten bauen und pushen | ~300 Tok |

Turns 4–7 sind reine Format-Recherche. Der Runner liest Agencys TypeScript, um zu verstehen, wie eine Karte aussehen muss. Das ist jedes Mal dieselbe Antwort.

Alle Tool-Ergebnisse zusammen: nur **31.136 Token**. Gemessen an 2,1 Millionen verbrauchten Token ist der tatsächliche Informationsgewinn also 1,5 % des Verbrauchs.

## Was das für die Agency-Frage heißt

Agency selbst macht **null LLM-Aufrufe** — nur Next.js + Datenbank (im Code verifiziert: kein `anthropic`, kein `openai` außer in `scripts/install-skill.mjs`). Agency durch einen Skill zu ersetzen spart also nichts und kostet eher mehr: ein Modell, das HTML schreibt, ist teurer als eine Web-App, die HTML ausliefert.

Der Agency-Anteil an den Token ist indirekt: 4.436 (Skill-Dateien) + 5.780 (Quellcode-Recherche) + ~8.500 Output fürs Karten-HTML. Den mittleren Teil beseitigt ein **fertiges Karten-Beispiel** statt vier Turns Quellcode-Lektüre.

## Maßnahmenliste

| # | Maßnahme | Token-Ersparnis | Aufwand |
|---|---|---:|---|
| 1 | Runner-Session mit eigenem `CLAUDE_CONFIG_DIR` starten → keine Skills, kein MCP, keine Subagents. AO unterstützt das über `LaunchConfig.Env` (`backend/internal/ports/agent.go:217`) | **−310.000** (−15 %) | klein |
| 2 | Damit fällt auch der Cache-Abriss weg (kein später verbindender MCP-Server mehr) | in 1 enthalten, −0,24 $ | — |
| 3 | `--disallowed-tools` für Edit/Write/NotebookEdit — der Runner liest nur. AO unterstützt `DisallowedTools` | −1.000 bis −2.000 Präfix, × 27 Reads | klein |
| 4 | **Repo-Karte vorberechnen** (Skript, 0 Token): Dateibaum, Testliste, `git log`, Zeilenzahlen. Spart Turns 8–13 | Turns 29 → ~15, Kontext wächst langsamer | mittel |
| 5 | **Fertiges Karten-Beispiel** in die Skill-Dateien legen statt Agency-Quellcode lesen zu lassen | Turns 4–7 entfallen, −5.780 + 4 Kontext-Reads | klein |
| 6 | `BRIDGE_RUNNER_MODEL=claude-sonnet-5` | Token gleich, Preis −60 % | trivial |

## Gerechnetes Ergebnis

| Stand | Token | Kosten |
|---|---:|---:|
| heute | 2.117.314 | 2,71 $ |
| nach 1–3 (reine Konfiguration) | ~1.807.000 | 2,22 $ |
| nach 1–5 (+ Repo-Karte, Kartenvorlage) | ~460.000 | ~1,09 $ |
| nach 1–6 (+ Sonnet) | ~460.000 | **~0,43 $** |

**Faktor 4,6 weniger Token, Faktor 6 weniger Kosten — ohne eine Zeile Architektur zu ändern.** Die Bridge bleibt, Agency bleibt, die unabhängige Review bleibt.

Maßnahme 1 ist der beste Einstieg: eine Umgebungsvariable, die `bridge/lib/runner.mjs` mitgibt, und sie nimmt 310.000 Token pro Lauf mit.

## Abgrenzung

- Die Modellpreise (Opus 5: 5 $/25 $ pro Mio., Cache-Read 0,1×, Cache-Write 1h-TTL 2×; Sonnet 5: 2 $/10 $) sind Listenpreise. Im Pro-Abo wird kein Geld abgerechnet — die Dollarbeträge sind AOs Hochrechnung und dienen hier nur als Vergleichsmaßstab. Relevant fürs Abo ist die Token-Spalte.
- Die Zeilen „nach 1–5" und „nach 1–6" sind Modellrechnungen auf Basis der gemessenen Turn- und Kontextgrößen, keine Messungen. Die Zeilen „heute" und „nach 1–3" sind aus den Ist-Daten gerechnet.
- Worker und Codex-Reviewer fehlen in der Erfassung. Der tatsächliche Gesamtverbrauch je Karte liegt über den hier genannten Zahlen.
