import { SOL_ASSET } from "../engine/amount";
import type { BoundaryEvent } from "../engine/types";

export type Scenario = {
  id: string;
  title: string;
  blurb: string;
  address: string;
  events: BoundaryEvent[];
};

const DAY = 86_400;

function sol(partial: Omit<BoundaryEvent, "asset" | "decodedFrom" | "instruction"> & { instruction?: BoundaryEvent["instruction"] }): BoundaryEvent {
  return {
    asset: SOL_ASSET,
    decodedFrom: "instruction",
    instruction: partial.instruction ?? (partial.kind === "deposit" ? "deposit" : "transact"),
    ...partial,
  };
}

/** Synthetic histories. Addresses here are labels, not live wallets. */
export const SCENARIOS: Scenario[] = [
  {
    id: "quick-roundtrip",
    title: "Unique, eight minutes",
    blurb: "1.337 SOL in, the same 1.337 SOL out, eight minutes later.",
    address: "FixtureQuickRoundtrip111111111111111111111",
    events: [
      sol({
        id: "qr:deposit",
        signature: "qr-deposit",
        slot: 1,
        blockTime: 1_700_000_000,
        kind: "deposit",
        role: "depositor",
        amount: 1_337_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "qr:withdraw",
        signature: "qr-withdraw",
        slot: 2,
        blockTime: 1_700_000_000 + 8 * 60,
        kind: "withdrawal",
        role: "withdrawal_sender",
        amount: 1_337_000_000n,
        counterparty: "self",
      }),
    ],
  },
  {
    id: "standard-cooled",
    title: "1 SOL, five days later",
    blurb: "A common size, withdrawn only after five days.",
    address: "FixtureStandardCooled11111111111111111111",
    events: [
      sol({
        id: "sc:deposit",
        signature: "sc-deposit",
        slot: 1,
        blockTime: 1_700_000_000,
        kind: "deposit",
        role: "depositor",
        amount: 1_000_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "sc:withdraw",
        signature: "sc-withdraw",
        slot: 2,
        blockTime: 1_700_000_000 + 5 * DAY,
        kind: "withdrawal",
        role: "withdrawal_sender",
        amount: 1_000_000_000n,
        counterparty: "self",
      }),
    ],
  },
  {
    id: "split-wait",
    title: "Split, then waited",
    blurb: "3 SOL deposited, then 1 SOL and 2 SOL withdrawn two days later.",
    address: "FixtureSplitWait111111111111111111111111",
    events: [
      sol({
        id: "sw:deposit",
        signature: "sw-deposit",
        slot: 1,
        blockTime: 1_700_000_000,
        kind: "deposit",
        role: "depositor",
        amount: 3_000_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "sw:w1",
        signature: "sw-w1",
        slot: 2,
        blockTime: 1_700_000_000 + 2 * DAY,
        kind: "withdrawal",
        role: "withdrawal_sender",
        amount: 1_000_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "sw:w2",
        signature: "sw-w2",
        slot: 3,
        blockTime: 1_700_000_000 + 2 * DAY + 3600,
        kind: "withdrawal",
        role: "withdrawal_sender",
        amount: 2_000_000_000n,
        counterparty: "self",
      }),
    ],
  },
  {
    id: "unique-open",
    title: "Odd deposit, still inside",
    blurb: "0.42424242 SOL deposited. Nothing has come back out.",
    address: "FixtureUniqueOpen11111111111111111111111",
    events: [
      sol({
        id: "uo:deposit",
        signature: "uo-deposit",
        slot: 1,
        blockTime: 1_700_000_000,
        kind: "deposit",
        role: "depositor",
        amount: 424_242_420n,
        counterparty: "self",
      }),
    ],
  },
  {
    id: "clean-standard",
    title: "Standard sizes, no match",
    blurb: "Deposits of 1, 0.5, and 0.1 SOL. One withdrawal of 0.25 SOL.",
    address: "FixtureCleanStandard11111111111111111111",
    events: [
      sol({
        id: "cs:d1",
        signature: "cs-d1",
        slot: 1,
        blockTime: 1_700_000_000,
        kind: "deposit",
        role: "depositor",
        amount: 1_000_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "cs:d2",
        signature: "cs-d2",
        slot: 2,
        blockTime: 1_700_000_000 + DAY,
        kind: "deposit",
        role: "depositor",
        amount: 500_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "cs:d3",
        signature: "cs-d3",
        slot: 3,
        blockTime: 1_700_000_000 + 2 * DAY,
        kind: "deposit",
        role: "depositor",
        amount: 100_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "cs:w",
        signature: "cs-w",
        slot: 4,
        blockTime: 1_700_000_000 + 10 * DAY,
        kind: "withdrawal",
        role: "withdrawal_sender",
        amount: 250_000_000n,
        counterparty: "self",
      }),
    ],
  },
  {
    id: "recorded-devnet",
    title: "Recorded devnet round trip",
    blurb: "0.001 SOL deposited and withdrawn 63 seconds later. Amounts taken from public devnet transactions on 21 Nov 2026.",
    address: "9Vrvyr8YURu79z4sTrgcL9aYXARxfuNgrhZpJnJTrAPD",
    events: [
      sol({
        id: "3XmSJAUYSvuwuQTnRXmsB7AYRqMg4SGc3QcHgYDYLUNWPemtnCqd7nGisxKH38SHA3Tn5aREf5nPepwyde9FmjPc:deposit:SOL:1000000:10",
        signature:
          "3XmSJAUYSvuwuQTnRXmsB7AYRqMg4SGc3QcHgYDYLUNWPemtnCqd7nGisxKH38SHA3Tn5aREf5nPepwyde9FmjPc",
        slot: 524832804,
        blockTime: 1795293095,
        kind: "deposit",
        role: "depositor",
        amount: 1_000_000n,
        counterparty: "self",
      }),
      sol({
        id: "2Es2GtQfX82ciChrGxckY1FfnKhZTwYX3nGpVaxqZgH28XDbd9TeBJKikJhmstZwpJG3DRxrruevu85BcMeQh51j:withdrawal:SOL:1000000:0",
        signature:
          "2Es2GtQfX82ciChrGxckY1FfnKhZTwYX3nGpVaxqZgH28XDbd9TeBJKikJhmstZwpJG3DRxrruevu85BcMeQh51j",
        slot: 524833064,
        blockTime: 1795293158,
        kind: "withdrawal",
        role: "withdrawal_sender",
        amount: 1_000_000n,
        counterparty: "self",
        instruction: "transact",
      }),
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.id === id);
}
