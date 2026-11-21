import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { scenarioById } from "../src/lib/fixtures/scenarios.ts";
import { extractBoundary, type RecordedTransaction } from "../src/lib/ring/parse.ts";

function load(name: string): RecordedTransaction {
  const raw = readFileSync(new URL(`../fixtures/rpc/${name}`, import.meta.url), "utf8");
  return JSON.parse(raw) as RecordedTransaction;
}

const DEPOSITOR = "8WicStdwCCK3qyhTqwxcrNPrqJywgmmdrofy7qgNtxkv";
const WITHDRAW_SENDER = "7FMpWcHZGnzyHXWxYyN7Yo1fDoU6YQb57evb3BByaXAq";
const WITHDRAW_RECIPIENT = "2y43AT3pcGWbj5gREkjussggHB9LVK4BBFGYJ7YhBPuC";
const ROUNDTRIP = "9Vrvyr8YURu79z4sTrgcL9aYXARxfuNgrhZpJnJTrAPD";
const TRANSFER_SIGNER = "GjGGg8nkKjJaiRXCcXJuHjcQmFf61vTMPaU7ridhWhLX";

test("recorded devnet deposit exposes 0.005 SOL for the depositor", () => {
  const { events, warnings } = extractBoundary(load("devnet-deposit.json"), DEPOSITOR);
  assert.equal(warnings.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, "deposit");
  assert.equal(events[0]!.amount, 5_000_000n);
  assert.equal(events[0]!.role, "depositor");
  assert.equal(events[0]!.counterparty, "self");
  assert.equal(events[0]!.decodedFrom, "instruction");
  assert.equal(events[0]!.instruction, "deposit");
});

test("a deposit is not attributed to an unrelated address", () => {
  const { events } = extractBoundary(load("devnet-deposit.json"), WITHDRAW_SENDER);
  assert.equal(events.length, 0);
});

test("recorded withdrawal is the sender's public exit, not the recipient's other history", () => {
  const sender = extractBoundary(load("devnet-withdraw.json"), WITHDRAW_SENDER);
  assert.equal(sender.warnings.length, 0);
  assert.equal(sender.events.length, 1);
  assert.equal(sender.events[0]!.kind, "withdrawal");
  assert.equal(sender.events[0]!.amount, 7_400_000n);
  assert.equal(sender.events[0]!.role, "withdrawal_sender");
  assert.equal(sender.events[0]!.counterparty, "other");

  const recipient = extractBoundary(load("devnet-withdraw.json"), WITHDRAW_RECIPIENT);
  assert.equal(recipient.events.length, 1);
  assert.equal(recipient.events[0]!.role, "withdrawal_recipient");
  assert.equal(recipient.events[0]!.amount, 7_400_000n);
  assert.equal(recipient.events[0]!.counterparty, "other");
});

test("a shielded transfer with no public leg produces no boundary event", () => {
  const { events, warnings } = extractBoundary(load("devnet-shielded-transfer.json"), TRANSFER_SIGNER);
  assert.equal(events.length, 0);
  assert.equal(warnings.length, 0);
});

test("a deposit bundled with an empty transact is one deposit, not a withdrawal", () => {
  const { events, warnings } = extractBoundary(load("devnet-deposit-and-transact.json"), ROUNDTRIP);
  assert.equal(warnings.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, "deposit");
  assert.equal(events[0]!.amount, 1_000_000n);
  assert.equal(events[0]!.counterparty, "self");
});

test("recorded self-withdrawal matches the scenario used by the demo", () => {
  const { events } = extractBoundary(load("devnet-self-withdraw.json"), ROUNDTRIP);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, "withdrawal");
  assert.equal(events[0]!.amount, 1_000_000n);
  assert.equal(events[0]!.counterparty, "self");
  const scenario = scenarioById("recorded-devnet");
  assert.ok(scenario);
  assert.equal(events[0]!.id, scenario.events[1]!.id);
  assert.equal(events[0]!.blockTime, scenario.events[1]!.blockTime);
});
