import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { amountsClose, isStandardAmount, parseHumanAmount } from "../src/lib/engine/amount.ts";
import { preflight } from "../src/lib/engine/preflight.ts";
import { WEIGHT, scoreBoundary } from "../src/lib/engine/score.ts";
import { SOL_ASSET } from "../src/lib/engine/amount.ts";
import { scenarioById } from "../src/lib/fixtures/scenarios.ts";
import { extractBoundary, type RecordedTransaction } from "../src/lib/ring/parse.ts";

function scoreFixture(id: string) {
  const scenario = scenarioById(id);
  assert.ok(scenario, id);
  return scoreBoundary(scenario.address, scenario.events);
}

test("standard denominations and the close-amount window", () => {
  assert.equal(isStandardAmount(1_000_000_000n, 9), true);
  assert.equal(isStandardAmount(1_000_000n, 9), true);
  assert.equal(isStandardAmount(250_000_000n, 9), true);
  assert.equal(isStandardAmount(1_337_000_000n, 9), false);
  assert.equal(isStandardAmount(424_242_420n, 9), false);
  assert.equal(amountsClose(2_000_000_000n, 1_990_000_000n), true);
  assert.equal(amountsClose(1_000_000_000n, 500_000_000n), false);
  assert.equal(amountsClose(100_000n, 80_000n, 6), false);
  assert.equal(parseHumanAmount("1.337", 9), 1_337_000_000n);
  assert.equal(parseHumanAmount("1.3370000001", 9), null);
  assert.equal(parseHumanAmount("nope", 9), null);
});

test("unique eight-minute round trip is exposed", () => {
  const report = scoreFixture("quick-roundtrip");
  const expected = 100 - (WEIGHT.exactUnique + WEIGHT.within10Minutes + WEIGHT.quickUniqueBonus);
  assert.equal(report.privacyScore, expected);
  assert.equal(expected, 36);
  assert.equal(report.grade, "exposed");
  assert.equal(report.findings[0]!.kind, "quick_roundtrip");
  assert.match(report.findings[0]!.explanation, /8 minutes/);
  assert.match(report.findings[0]!.fix, /Wait/);
  assert.match(report.findings[0]!.fix, /standard/i);
});

test("a standard amount after five days keeps a residual match and a fair-to-strong score", () => {
  const report = scoreFixture("standard-cooled");
  assert.equal(report.privacyScore, 100 - WEIGHT.exactStandard);
  assert.equal(report.privacyScore, 86);
  assert.equal(report.grade, "fair");
  assert.equal(report.findings[0]!.kind, "amount_match");
  assert.match(report.findings[0]!.explanation, /common denomination/);
});

test("splitting still links when the pieces add up", () => {
  const report = scoreFixture("split-wait");
  assert.equal(report.findings.some((finding) => finding.kind === "split_match"), true);
  assert.equal(report.privacyScore, 100 - (WEIGHT.split + WEIGHT.within72Hours));
  assert.equal(report.grade, "fair");
  assert.match(report.findings[0]!.explanation, /Together/);
});

test("an unmatched odd deposit is a fingerprint, not a completed link", () => {
  const report = scoreFixture("unique-open");
  assert.equal(report.privacyScore, 100 - WEIGHT.openUniqueDeposit);
  assert.equal(report.grade, "strong");
  assert.equal(report.findings[0]!.kind, "open_deposit");
  assert.match(report.findings[0]!.explanation, /fingerprint/);
});

test("standard sizes that do not reconstruct a deposit stay strong", () => {
  const report = scoreFixture("clean-standard");
  assert.equal(report.matches.length, 0);
  assert.equal(report.privacyScore, 100);
  assert.equal(report.grade, "strong");
  assert.ok(report.findings.every((finding) => finding.weight === 0));
});

test("a near unique amount is not treated as exact", () => {
  const deposit = scenarioById("standard-cooled")!.events[0]!;
  const report = scoreBoundary("near", [
    { ...deposit, id: "d", amount: 2_000_000_000n },
    {
      ...deposit,
      id: "w",
      signature: "w",
      kind: "withdrawal",
      role: "withdrawal_sender",
      amount: 1_990_000_000n,
      blockTime: deposit.blockTime + 3 * 3600,
    },
  ]);
  assert.equal(report.findings[0]!.kind, "amount_match");
  assert.equal(report.matches[0]!.exact, false);
  assert.equal(report.privacyScore, 100 - (WEIGHT.nearUnique + WEIGHT.within24Hours));
});

test("empty history scores 100", () => {
  const report = scoreBoundary("nobody", []);
  assert.equal(report.privacyScore, 100);
  assert.equal(report.grade, "strong");
  assert.equal(report.findings.length, 0);
});

test("two heavy matches clamp at zero", () => {
  const scenario = scenarioById("quick-roundtrip")!;
  const second = scenario.events.map((event) => ({
    ...event,
    id: `${event.id}-b`,
    signature: `${event.signature}-b`,
    blockTime: event.blockTime + 86_400,
  }));
  const report = scoreBoundary(scenario.address, [...scenario.events, ...second]);
  assert.equal(report.privacyScore, 0);
  assert.equal(report.grade, "exposed");
});

test("preflight stops a withdrawal that copies an open unique deposit", () => {
  const scenario = scenarioById("unique-open")!;
  const plan = preflight(scenario.address, scenario.events, {
    amount: 424_242_420n,
    asset: SOL_ASSET,
    at: scenario.events[0]!.blockTime + 8 * 60,
  });
  assert.equal(plan.verdict, "stop");
  assert.equal(plan.scoreAfter, 36);
  assert.ok(plan.newFindings.some((finding) => finding.kind === "quick_roundtrip"));
  assert.match(plan.suggestions.join(" "), /Wait/);
  assert.equal(scenario.events.length, 1);
});

test("preflight is clear when the planned size does not match", () => {
  const scenario = scenarioById("unique-open")!;
  const plan = preflight(scenario.address, scenario.events, {
    amount: 1_000_000_000n,
    asset: SOL_ASSET,
    at: scenario.events[0]!.blockTime + 7 * 86_400,
  });
  assert.equal(plan.verdict, "clear");
  assert.equal(plan.scoreAfter, plan.scoreBefore);
  assert.match(plan.headline, /does not line up/);
});

test("recorded devnet round trip scores as a fast standard exit", () => {
  const deposit = JSON.parse(
    readFileSync(new URL("../fixtures/rpc/devnet-deposit-and-transact.json", import.meta.url), "utf8"),
  ) as RecordedTransaction;
  const withdraw = JSON.parse(
    readFileSync(new URL("../fixtures/rpc/devnet-self-withdraw.json", import.meta.url), "utf8"),
  ) as RecordedTransaction;
  const address = "9Vrvyr8YURu79z4sTrgcL9aYXARxfuNgrhZpJnJTrAPD";
  const events = [
    ...extractBoundary(deposit, address).events,
    ...extractBoundary(withdraw, address).events,
  ];
  const report = scoreBoundary(address, events);
  assert.equal(events[1]!.blockTime - events[0]!.blockTime, 63);
  assert.equal(report.privacyScore, 100 - (WEIGHT.exactStandard + WEIGHT.within10Minutes));
  assert.equal(report.privacyScore, 62);
  assert.equal(report.grade, "leaky");
  assert.equal(report.findings[0]!.severity, "high");
  assert.equal(report.findings[0]!.kind, "quick_roundtrip");
});
