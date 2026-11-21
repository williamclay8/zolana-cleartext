import bs58 from "bs58";

import { SOL_ASSET } from "../engine/amount";
import type { Asset, BoundaryEvent, BoundaryRole, InstructionKind } from "../engine/types";
import { RING_PROGRAM_ID, SOL_INTERFACE, TAG } from "./constants";

export type AccountKey = {
  pubkey: string;
  signer: boolean;
  writable: boolean;
};

export type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
};

export type ParsedInstruction = {
  programId?: string;
  programIdIndex?: number;
  accounts?: Array<string | number>;
  data?: string;
  parsed?: unknown;
};

export type RecordedTransaction = {
  signature?: string;
  slot: number;
  blockTime: number | null;
  transaction: {
    signatures?: string[];
    message: {
      accountKeys: Array<AccountKey | string>;
      instructions: ParsedInstruction[];
    };
  };
  meta: {
    err?: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: Array<{ instructions: ParsedInstruction[] }>;
  } | null;
};

export type ExtractResult = {
  events: BoundaryEvent[];
  warnings: string[];
};

type Leg = {
  kind: "sol_deposit" | "sol_withdrawal" | "spl_deposit" | "spl_withdrawal";
  amount: bigint;
};

type DepositRow = {
  asset: "SOL" | "SPL";
  amount: bigint;
  viewTag: string;
  splBump?: number;
};

class Cursor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  remaining(): number {
    return this.bytes.length - this.offset;
  }

  u8(): number {
    if (this.offset >= this.bytes.length) throw new Error("instruction ended early");
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    const value = this.u8() | (this.u8() << 8);
    return value;
  }

  u64(): bigint {
    let value = 0n;
    for (let i = 0; i < 8; i++) value |= BigInt(this.u8()) << BigInt(8 * i);
    return value;
  }

  bytes32(): Uint8Array {
    return this.take(32);
  }

  skip(count: number): void {
    this.take(count);
  }

  private take(count: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    if (slice.length < count) throw new Error("instruction ended early");
    this.offset += count;
    return slice;
  }
}

function decodeData(data: string): Uint8Array {
  return bs58.decode(data);
}

function pubkeyOf(key: AccountKey | string): string {
  return typeof key === "string" ? key : key.pubkey;
}

function isSigner(key: AccountKey | string): boolean {
  return typeof key === "string" ? false : key.signer;
}

/**
 * Public legs sit at a fixed prefix of `transact` / `ring_transact`
 * (privacy-rings TransactIxData, main, 2026-11-20):
 *   tag, expiry u64, tx_viewing_pk [33], salt [16], then a u8 count of
 *   InterfaceTransfer. Sol legs are tag + amount. Spl legs add a bump byte.
 * The proof and ciphertexts come later and are not read.
 */
export function readInterfaceTransfers(data: Uint8Array): Leg[] {
  const cursor = new Cursor(data);
  const tag = cursor.u8();
  if (tag !== TAG.TRANSACT && tag !== TAG.RING_TRANSACT) {
    throw new Error(`not a transact instruction (${tag})`);
  }
  cursor.u64();
  cursor.skip(33 + 16);
  const count = cursor.u8();
  if (count > 32) throw new Error("too many public legs");
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) {
    const kind = cursor.u8();
    const amount = cursor.u64();
    if (kind === 0) legs.push({ kind: "sol_deposit", amount });
    else if (kind === 1) legs.push({ kind: "sol_withdrawal", amount });
    else if (kind === 2) {
      cursor.u8();
      legs.push({ kind: "spl_deposit", amount });
    } else if (kind === 3) {
      cursor.u8();
      legs.push({ kind: "spl_withdrawal", amount });
    } else {
      throw new Error(`unknown public leg ${kind}`);
    }
  }
  return legs;
}

/**
 * DepositIxData after the tag byte: u8 asset count, assets, u8 entry count,
 * then entries of asset index, 32-byte view tag, 32-byte owner, u64 amount,
 * optional memo. Ring deposits swap the owner for owner_utxo_hash and append
 * a ring hash plus an encrypted blob, which is skipped.
 */
export function readDeposits(data: Uint8Array): DepositRow[] {
  const cursor = new Cursor(data);
  const tag = cursor.u8();
  const ring = tag === TAG.RING_DEPOSIT;
  if (tag !== TAG.DEPOSIT && !ring) throw new Error(`not a deposit instruction (${tag})`);
  const assetCount = cursor.u8();
  if (assetCount < 1 || assetCount > 5) throw new Error("bad deposit asset count");
  const assets: Array<"SOL" | "SPL"> = [];
  for (let i = 0; i < assetCount; i++) {
    const kind = cursor.u8();
    if (kind === 0) assets.push("SOL");
    else if (kind === 1) {
      cursor.u8();
      assets.push("SPL");
    } else throw new Error(`unknown deposit asset ${kind}`);
  }
  const count = cursor.u8();
  if (count < 1 || count > 16) throw new Error("bad deposit count");
  const rows: DepositRow[] = [];
  for (let i = 0; i < count; i++) {
    const assetIndex = cursor.u8();
    const viewTag = bs58.encode(cursor.bytes32());
    cursor.skip(32);
    const amount = cursor.u64();
    if (ring) {
      cursor.skip(32 + 33 + 16);
      const cipherLen = cursor.u16();
      cursor.skip(cipherLen);
    } else {
      const memo = cursor.u8();
      if (memo === 1) {
        const len = cursor.u16();
        cursor.skip(len);
      } else if (memo !== 0) {
        throw new Error("bad memo flag");
      }
    }
    const asset = assets[assetIndex];
    if (!asset) throw new Error("deposit asset index out of range");
    rows.push({ asset, amount, viewTag });
  }
  return rows;
}

function instructionProgram(ix: ParsedInstruction, keys: Array<AccountKey | string>): string | undefined {
  if (ix.programId) return ix.programId;
  if (ix.programIdIndex === undefined) return undefined;
  const key = keys[ix.programIdIndex];
  return key ? pubkeyOf(key) : undefined;
}

function balanceDelta(tx: RecordedTransaction, pubkey: string): bigint | null {
  const keys = tx.transaction.message.accountKeys;
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  const index = keys.findIndex((key) => pubkeyOf(key) === pubkey);
  if (index < 0 || pre[index] === undefined || post[index] === undefined) return null;
  return BigInt(post[index]!) - BigInt(pre[index]!);
}

/**
 * The public recipient of a SOL withdrawal. An exact lamport increase wins.
 * The fee payer often nets amount minus the transaction fee and the 5,000
 * lamport tree fee, so a small shortfall is still accepted, and a signer is
 * preferred over a rent account that happens to be close.
 */
function withdrawalRecipient(tx: RecordedTransaction, amount: bigint): string | null {
  const keys = tx.transaction.message.accountKeys;
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  const window = BigInt(tx.meta?.fee ?? 0) + 20_000n;
  const skip = new Set([SOL_INTERFACE, RING_PROGRAM_ID]);
  const candidates: Array<{ pubkey: string; gap: bigint; signer: boolean }> = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const pubkey = pubkeyOf(key);
    if (skip.has(pubkey) || pre[i] === undefined || post[i] === undefined) continue;
    const delta = BigInt(post[i]!) - BigInt(pre[i]!);
    if (delta <= 0n) continue;
    const gap = amount > delta ? amount - delta : delta - amount;
    if (gap === 0n || gap <= window) candidates.push({ pubkey, gap, signer: isSigner(key) });
  }
  const exact = candidates.filter((candidate) => candidate.gap === 0n);
  const pool = exact.length > 0 ? exact : candidates;
  pool.sort((a, b) => Number(a.signer === b.signer ? a.gap - b.gap : a.signer ? -1 : 1));
  return pool[0]?.pubkey ?? null;
}

function signersOf(tx: RecordedTransaction): string[] {
  return tx.transaction.message.accountKeys.filter(isSigner).map(pubkeyOf);
}

function tokenDelta(tx: RecordedTransaction, owner: string, mint?: string): { mint: string; delta: bigint; decimals: number } | null {
  const pre = new Map<string, { amount: bigint; decimals: number }>();
  for (const row of tx.meta?.preTokenBalances ?? []) {
    if (row.owner !== owner) continue;
    if (mint && row.mint !== mint) continue;
    const amount = BigInt(row.uiTokenAmount?.amount ?? "0");
    const current = pre.get(row.mint) ?? { amount: 0n, decimals: row.uiTokenAmount?.decimals ?? 0 };
    current.amount += amount;
    current.decimals = row.uiTokenAmount?.decimals ?? current.decimals;
    pre.set(row.mint, current);
  }
  const post = new Map<string, { amount: bigint; decimals: number }>();
  for (const row of tx.meta?.postTokenBalances ?? []) {
    if (row.owner !== owner) continue;
    if (mint && row.mint !== mint) continue;
    const amount = BigInt(row.uiTokenAmount?.amount ?? "0");
    const current = post.get(row.mint) ?? { amount: 0n, decimals: row.uiTokenAmount?.decimals ?? 0 };
    current.amount += amount;
    current.decimals = row.uiTokenAmount?.decimals ?? current.decimals;
    post.set(row.mint, current);
  }
  const mints = new Set([...pre.keys(), ...post.keys()]);
  for (const key of mints) {
    const before = pre.get(key)?.amount ?? 0n;
    const after = post.get(key)?.amount ?? 0n;
    if (after !== before) {
      return {
        mint: key,
        delta: after - before,
        decimals: post.get(key)?.decimals ?? pre.get(key)?.decimals ?? 0,
      };
    }
  }
  return null;
}

function splAsset(mint: string, decimals: number): Asset {
  return { kind: "SPL", mint, symbol: "SPL", decimals };
}

function eventId(signature: string, kind: string, mint: string, amount: bigint, index: number): string {
  return `${signature}:${kind}:${mint}:${amount}:${index}`;
}

function pushEvent(events: BoundaryEvent[], event: BoundaryEvent): void {
  if (events.some((existing) => existing.id === event.id)) return;
  events.push(event);
}

/**
 * Read the public deposits and withdrawals in one transaction that belong
 * to `address`. Encrypted transfer amounts are ignored. Other addresses
 * that appear in the same transaction are not fetched.
 */
export function extractBoundary(tx: RecordedTransaction, address: string): ExtractResult {
  const warnings: string[] = [];
  if (tx.meta?.err) return { events: [], warnings };
  const keys = tx.transaction.message.accountKeys ?? [];
  const signature = tx.transaction.signatures?.[0] ?? tx.signature ?? "unknown";
  const blockTime = tx.blockTime ?? 0;
  const top = tx.transaction.message.instructions ?? [];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  const topRing = top.filter((ix) => instructionProgram(ix, keys) === RING_PROGRAM_ID);
  const instructions = topRing.length > 0 ? topRing : inner.filter((ix) => instructionProgram(ix, keys) === RING_PROGRAM_ID);

  const events: BoundaryEvent[] = [];
  let solNet = 0n;
  let solNoted = false;

  instructions.forEach((ix, index) => {
    if (!ix.data) return;
    let raw: Uint8Array;
    try {
      raw = decodeData(ix.data);
    } catch {
      warnings.push(`${signature} has ring instruction data that is not base58.`);
      return;
    }
    const tag = raw[0];
    if (tag === TAG.DEPOSIT || tag === TAG.RING_DEPOSIT) {
      let rows: DepositRow[];
      try {
        rows = readDeposits(raw);
      } catch {
        warnings.push(`${signature} deposit instruction could not be decoded.`);
        return;
      }
      const instruction: InstructionKind = tag === TAG.RING_DEPOSIT ? "ring_deposit" : "deposit";
      rows.forEach((row, rowIndex) => {
        const signed = signersOf(tx).includes(address);
        const tagged = row.viewTag === address;
        if (!signed && !tagged) return;
        const role: BoundaryRole = signed ? "depositor" : "deposit_recipient";
        const counterparty = signed && tagged ? "self" : "other";
        if (row.asset === "SOL") {
          solNet += row.amount;
          solNoted = true;
          pushEvent(events, {
            id: eventId(signature, "deposit", "SOL", row.amount, index * 10 + rowIndex),
            signature,
            slot: tx.slot,
            blockTime,
            kind: "deposit",
            role,
            asset: SOL_ASSET,
            amount: row.amount,
            counterparty,
            instruction,
            decodedFrom: "instruction",
          });
        } else {
          const token = tokenDelta(tx, address);
          const mint = token?.mint ?? "unknown-spl";
          const decimals = token?.decimals ?? 0;
          pushEvent(events, {
            id: eventId(signature, "deposit", mint, row.amount, index * 10 + rowIndex),
            signature,
            slot: tx.slot,
            blockTime,
            kind: "deposit",
            role,
            asset: splAsset(mint, decimals),
            amount: row.amount,
            counterparty,
            instruction,
            decodedFrom: "instruction",
          });
        }
      });
      return;
    }

    if (tag !== TAG.TRANSACT && tag !== TAG.RING_TRANSACT) return;
    let legs: Leg[];
    try {
      legs = readInterfaceTransfers(raw);
    } catch {
      warnings.push(`${signature} transact instruction could not be decoded. Vault balance was not used as a guess.`);
      return;
    }
    const instruction: InstructionKind = tag === TAG.RING_TRANSACT ? "ring_transact" : "transact";
    const signers = signersOf(tx);
    const fee = BigInt(tx.meta?.fee ?? 0);
    legs.forEach((leg, legIndex) => {
      if (leg.kind === "sol_deposit" || leg.kind === "sol_withdrawal") {
        if (leg.kind === "sol_deposit") solNet += leg.amount;
        else solNet -= leg.amount;
        solNoted = true;
      }
      if (leg.kind === "sol_deposit") {
        if (!signers.includes(address)) return;
        pushEvent(events, {
          id: eventId(signature, "deposit", "SOL", leg.amount, index * 10 + legIndex),
          signature,
          slot: tx.slot,
          blockTime,
          kind: "deposit",
          role: "depositor",
          asset: SOL_ASSET,
          amount: leg.amount,
          counterparty: signers.length === 1 ? "self" : "other",
          instruction,
          decodedFrom: "instruction",
        });
        return;
      }
      if (leg.kind === "sol_withdrawal") {
        const recipient = withdrawalRecipient(tx, leg.amount);
        const addressDelta = balanceDelta(tx, address);
        const feeOnly =
          addressDelta !== null && addressDelta < 0n && -addressDelta <= fee + 20_000n;
        const sender =
          signers.includes(address) && (signers.length === 1 || !feeOnly || recipient === address);
        const received = recipient === address;
        if (!sender && !received) return;
        const role: BoundaryRole = received && !sender ? "withdrawal_recipient" : "withdrawal_sender";
        const sameAddress = recipient === address && signers.includes(address);
        pushEvent(events, {
          id: eventId(signature, "withdrawal", "SOL", leg.amount, index * 10 + legIndex),
          signature,
          slot: tx.slot,
          blockTime,
          kind: "withdrawal",
          role,
          asset: SOL_ASSET,
          amount: leg.amount,
          counterparty: sameAddress ? "self" : "other",
          instruction,
          decodedFrom: "instruction",
        });
        return;
      }
      const token = tokenDelta(tx, address);
      const involved =
        (leg.kind === "spl_deposit" && token !== null && -token.delta === leg.amount) ||
        (leg.kind === "spl_withdrawal" && token !== null && token.delta === leg.amount) ||
        signers.includes(address);
      if (!involved) return;
      const mint = token?.mint ?? "unknown-spl";
      const kind = leg.kind === "spl_deposit" ? "deposit" : "withdrawal";
      const role: BoundaryRole =
        kind === "deposit"
          ? "depositor"
          : token !== null && token.delta === leg.amount
            ? "withdrawal_recipient"
            : "withdrawal_sender";
      pushEvent(events, {
        id: eventId(signature, kind, mint, leg.amount, index * 10 + legIndex),
        signature,
        slot: tx.slot,
        blockTime,
        kind,
        role,
        asset: splAsset(mint, token?.decimals ?? 0),
        amount: leg.amount,
        counterparty: signers.includes(address) && role !== "withdrawal_recipient" ? "self" : "other",
        instruction,
        decodedFrom: "instruction",
      });
    });
  });

  if (solNoted) {
    const vault = balanceDelta(tx, SOL_INTERFACE);
    if (vault !== null && vault !== solNet) {
      warnings.push(
        `${signature} public SOL legs sum to ${solNet} lamports but the SOL interface balance changed by ${vault}. The score uses the instruction amounts.`,
      );
    }
  }

  return { events, warnings };
}
