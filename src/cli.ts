import { readFileSync } from "node:fs";

import { SOL_ASSET, formatAmount, parseHumanAmount } from "./lib/engine/amount.ts";
import { preflight } from "./lib/engine/preflight.ts";
import type { BoundaryEvent, Finding, ScoreReport } from "./lib/engine/types.ts";
import { scoreBoundary } from "./lib/engine/score.ts";
import { SCENARIOS, scenarioById } from "./lib/fixtures/scenarios.ts";
import { isSolanaAddress } from "./lib/ring/address.ts";
import type { Cluster } from "./lib/ring/constants.ts";
import { loadAddress } from "./lib/ring/fetch.ts";

loadEnvFile();

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "help" || command === "--help") {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (command === "fixtures") {
  for (const scenario of SCENARIOS) {
    console.log(`${scenario.id.padEnd(20)} ${scenario.title}`);
    console.log(`  ${scenario.blurb}`);
  }
  process.exit(0);
}

const json = args.includes("--json");
const fixture = flag(args, "--fixture");
const cluster = (flag(args, "--cluster") ?? process.env.ZOLANA_CLUSTER ?? "devnet") as Cluster;
if (cluster !== "devnet" && cluster !== "mainnet") {
  fail("Cluster must be devnet or mainnet.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main(): Promise<void> {
  if (command === "score") {
    const report = await scoreCommand(args);
    if (json) console.log(JSON.stringify(report, replacer, 2));
    else printScore(report.report, report.events, report.notes);
    return;
  }

  if (command === "preflight") {
    const sol = flag(args, "--sol");
    const delay = flag(args, "--in") ?? "1d";
    if (!sol) fail("Pass the planned size with --sol 0.5");
    const amount = parseHumanAmount(sol, 9);
    if (amount === null || amount <= 0n) fail("Could not read that SOL amount.");
    const seconds = parseDelay(delay);
    if (seconds === null) fail("Delay looks like 10m, 6h, or 3d.");
    const loaded = await history(args);
    const last = loaded.events.reduce((max, event) => Math.max(max, event.blockTime), 0);
    const at = Math.max(Math.floor(Date.now() / 1000), last) + seconds;
    const plan = preflight(loaded.address, loaded.events, { amount, asset: SOL_ASSET, at });
    if (json) {
      console.log(
        JSON.stringify(
          {
            verdict: plan.verdict,
            headline: plan.headline,
            scoreBefore: plan.scoreBefore,
            scoreAfter: plan.scoreAfter,
            newFindings: plan.newFindings,
            suggestions: plan.suggestions,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`${plan.verdict.toUpperCase()}  ${plan.scoreBefore} → ${plan.scoreAfter}`);
      console.log(plan.headline);
      console.log("");
      for (const finding of plan.newFindings) printFinding(finding);
      console.log("Suggestions");
      for (const suggestion of plan.suggestions) console.log(`- ${suggestion}`);
    }
    process.exit(plan.verdict === "stop" ? 2 : 0);
  }

  fail(`Unknown command ${command}.`);
}

async function scoreCommand(argv: string[]): Promise<{
  address: string;
  report: ScoreReport;
  events: BoundaryEvent[];
  notes: string[];
}> {
  const loaded = await history(argv);
  return {
    address: loaded.address,
    report: scoreBoundary(loaded.address, loaded.events),
    events: loaded.events,
    notes: loaded.notes,
  };
}

async function history(argv: string[]): Promise<{ address: string; events: BoundaryEvent[]; notes: string[] }> {
  if (fixture) {
    const scenario = scenarioById(fixture);
    if (!scenario) fail(`No fixture named ${fixture}. Run: npm run cli -- fixtures`);
    return {
      address: scenario.address,
      events: scenario.events,
      notes: [`Fixture “${scenario.title}”. ${scenario.blurb}`, "No network call."],
    };
  }
  const address = positional(argv)[0];
  if (!address || !isSolanaAddress(address)) fail("Pass a Solana address, or --fixture <id>.");
  const loaded = await loadAddress(address, cluster, {
    apiKey: process.env.HELIUS_API_KEY || undefined,
    rpcUrl: process.env.SOLANA_RPC_URL || undefined,
  });
  return { address, events: loaded.events, notes: [...loaded.notes, ...loaded.warnings, `RPC host ${loaded.rpcHost}`] };
}

function printScore(report: ScoreReport, events: BoundaryEvent[], notes: string[]): void {
  console.log(`${report.privacyScore}  ${report.grade}`);
  console.log(report.summary);
  console.log(`${report.deposits} deposits, ${report.withdrawals} withdrawals`);
  console.log("");
  if (events.length === 0) console.log("No public boundary events.");
  for (const event of events) {
    const when = event.blockTime ? new Date(event.blockTime * 1000).toISOString() : "unknown time";
    console.log(
      `${event.kind.padEnd(10)} ${formatAmount(event.amount, event.asset).padEnd(16)} ${when}  ${event.signature}`,
    );
  }
  console.log("");
  if (report.findings.length === 0) console.log("No leak findings.");
  for (const finding of report.findings) printFinding(finding);
  console.log("Notes");
  for (const note of notes) console.log(`- ${note}`);
}

function printFinding(finding: Finding): void {
  console.log(`[${finding.severity}] -${finding.weight}  ${finding.title}`);
  console.log(`  ${finding.explanation}`);
  console.log(`  Fix: ${finding.fix}`);
  console.log("");
}

function positional(argv: string[]): string[] {
  const skip = new Set<number>();
  argv.forEach((arg, index) => {
    if (arg.startsWith("--") && argv[index + 1] && !argv[index + 1]!.startsWith("--")) skip.add(index + 1);
  });
  return argv.filter(
    (arg, index) => !arg.startsWith("--") && arg !== "score" && arg !== "preflight" && !skip.has(index),
  );
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function parseDelay(value: string): number | null {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2];
  const scale = unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86_400;
  return count * scale;
}

function loadEnvFile(): void {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // No local env file. Live mode then uses public RPC.
  }
}

function replacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printHelp(): void {
  console.log(`Zolana Cleartext — privacy score for the public edge of a ring

  npm run cli -- fixtures
  npm run cli -- score --fixture quick-roundtrip
  npm run cli -- score <address> --cluster devnet
  npm run cli -- preflight --fixture unique-open --sol 0.42424242 --in 10m
  npm run cli -- preflight <address> --sol 1 --in 1d --cluster devnet

Add --json for machine-readable output. HELIUS_API_KEY is optional.
Without it, amounts come from public Solana RPC. The key enables indexer
signature discovery only. This tool never asks for a wallet signature.`);
}
