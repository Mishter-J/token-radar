// Token Radar entry point.
//
// Reads a frozen DefiLlama snapshot, scores every protocol with the
// radar-3-log model, and writes the board, the dashboard data and the
// submission dossier. Deterministic: the scale is fitted from the
// snapshot itself, ties break by slug, and nothing here stamps a time,
// so two runs over the same input produce byte-identical outputs.
//
// Usage:
//   node main.ts --input <snapshot.json or directory> --output <dir>
//   node main.ts            (reads /input/snapshot.json, writes /output,
//                            or $MAKEFUN_OUTPUT_DIR when it is set)

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";
import { buildRadar } from "./lib/model.ts";
import type { Snapshot, RadarData } from "./lib/model.ts";

function readArgs(argv: string[]): { input: string; output: string } {
  let input = "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[i + 1];
    if (argv[i] === "--output" && i + 1 < argv.length) output = argv[i + 1];
  }
  return { input, output };
}

function loadSnapshot(inputPath: string): Snapshot {
  let file = inputPath;
  if (statSync(file).isDirectory()) file = join(file, "snapshot.json");
  const text = readFileSync(file, "utf8");
  return JSON.parse(text) as Snapshot;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main(): void {
  const { input, output } = readArgs(process.argv.slice(2));
  const snapshot = loadSnapshot(input);
  const radar: RadarData = buildRadar(snapshot);
  if (radar.rows.length !== 200) {
    throw new Error(`board has ${radar.rows.length} rows, expected 200 — the rankable pool is too small`);
  }

  const outDir = resolve(output);
  mkdirSync(outDir, { recursive: true });

  const board = {
    model: radar.model,
    as_of: radar.as_of,
    scale_usd: radar.scale_usd,
    fit_count: radar.fit_count,
    floor_usd: radar.floor_usd,
    rows: radar.rows,
  };
  writeJson(join(outDir, "board.json"), board);

  const dataJs = `window.RADAR = ${JSON.stringify(radar, null, 2)};\n`;
  writeFileSync(join(outDir, "data.js"), dataJs, "utf8");

  const here = new URL(".", import.meta.url).pathname;
  cpSync(join(here, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  const shots = join(here, "screenshots");
  if (existsSync(shots)) {
    cpSync(shots, join(outDir, "screenshots"), { recursive: true });
  }

  // The dossier is written last, after every other file is in place.
  // buildDossier returns the canonical JSON bytes; it writes nothing
  // itself, so the file write here is what creates dossier.json.
  const dossierBytes = buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(outDir, "dossier.json"), dossierBytes);

  const watchlistRows = radar.rows.filter((row) => row.is_watchlist).length;
  console.log(`protocols: ${snapshot.protocols.length}`);
  console.log(`watchlist: ${snapshot.watchlist.length}`);
  console.log(`scale_usd: ${radar.scale_usd}`);
  console.log(`fit_count: ${radar.fit_count}`);
  console.log(`board rows: ${radar.rows.length} (${watchlistRows} watchlist)`);
  console.log(`rank 1: ${radar.rows[0].slug} $${radar.rows[0].implied_value_usd}`);
  const last = radar.rows[radar.rows.length - 1];
  console.log(`rank ${radar.rows.length}: ${last.slug} $${last.implied_value_usd}`);
  console.log(`live rows: ${radar.live.length}`);
  for (const row of radar.backtest) {
    console.log(
      `backtest ${row.model}: n=${row.n} median|ln|=${row.median_abs_log_error} within2x=${row.within_2x_pct}% within5x=${row.within_5x_pct}%`,
    );
  }
  console.log(`wrote ${outDir}`);
}

main();
