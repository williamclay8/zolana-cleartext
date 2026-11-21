import { scoreBoundary } from "../engine/score";
import type { BoundaryEvent, ScoreReport } from "../engine/types";
import { Cluster, MAX_SIGNATURES } from "./constants";
import { extractBoundary, type RecordedTransaction } from "./parse";

export type IndexerSummary = {
  queried: boolean;
  shieldedTransactions: number | null;
  prooflessTransactions: number | null;
  registryRecords: number | null;
  error: string | null;
  note: string;
};

export type LiveLoad = {
  address: string;
  cluster: Cluster;
  source: "live";
  rpcHost: string;
  events: BoundaryEvent[];
  score: ScoreReport;
  indexer: IndexerSummary;
  scannedSignatures: number;
  truncated: boolean;
  notes: string[];
  warnings: string[];
};

type SignatureRow = { signature: string; err: unknown };

const INDEXER_NOTE_NO_KEY =
  "No HELIUS_API_KEY is set. Deposit and withdrawal amounts were read from standard Solana RPC (getSignaturesForAddress and getTransaction). The indexer methods getShieldedTransactionsByTags and getUserRecords were not called. Those methods return encrypted payloads, not amounts. With a key they are used only to discover extra signatures for this view tag and to count shielded transactions.";

export function rpcEndpoint(cluster: Cluster, apiKey: string | undefined, override?: string): string {
  if (override && override.trim()) return override.trim();
  if (apiKey) {
    const host = cluster === "mainnet" ? "mainnet.helius-rpc.com" : "devnet.helius-rpc.com";
    return `https://${host}/?api-key=${encodeURIComponent(apiKey)}`;
  }
  return cluster === "mainnet" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "rpc";
  }
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.status === 429) {
      lastStatus = 429;
      await delay(350 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Solana RPC ${method} returned HTTP ${response.status}.`);
    }
    const body = (await response.json()) as { error?: { message?: string }; result?: unknown };
    if (body.error) throw new Error(body.error.message ?? `Solana RPC ${method} failed.`);
    return body.result;
  }
  throw new Error(`Solana RPC ${method} returned HTTP ${lastStatus}.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signaturesFor(url: string, address: string): Promise<{ signatures: string[]; truncated: boolean }> {
  const signatures: string[] = [];
  let before: string | undefined;
  let truncated = false;
  for (let page = 0; page < 4 && signatures.length < MAX_SIGNATURES; page++) {
    const limit = Math.min(40, MAX_SIGNATURES - signatures.length);
    const result = (await rpcCall(url, "getSignaturesForAddress", [
      address,
      { limit, before, commitment: "confirmed" },
    ])) as SignatureRow[] | null;
    const rows = result ?? [];
    for (const row of rows) {
      if (!row.err) signatures.push(row.signature);
    }
    if (rows.length < limit) break;
    before = rows[rows.length - 1]?.signature;
    if (!before) break;
    if (signatures.length >= MAX_SIGNATURES) truncated = true;
  }
  return { signatures, truncated };
}

async function transaction(url: string, signature: string): Promise<RecordedTransaction | null> {
  const result = (await rpcCall(url, "getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
  ])) as RecordedTransaction | null;
  return result;
}

type IndexerPage = {
  data?: Array<{
    signature?: string;
    events?: Array<{ proofless?: boolean }>;
  }>;
  paginationToken?: string | null;
};

async function indexerSummary(
  cluster: Cluster,
  apiKey: string,
  address: string,
): Promise<{ summary: IndexerSummary; signatures: string[] }> {
  const signatures: string[] = [];
  let shielded = 0;
  let proofless = 0;
  try {
    let token: string | null = null;
    for (let page = 0; page < 3; page++) {
      const host = cluster === "mainnet" ? "mainnet.helius-rpc.com" : "devnet.helius-rpc.com";
      const url = `https://${host}/v1/spr/getShieldedTransactionsByTags?api-key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getShieldedTransactionsByTags",
          params: {
            tags: [address],
            limit: 1000,
            ...(token ? { paginationToken: token } : {}),
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Indexer returned HTTP ${response.status}.`);
      }
      const body = (await response.json()) as { error?: { message?: string }; result?: IndexerPage };
      if (body.error) throw new Error(body.error.message ?? "Indexer request failed.");
      const groups = body.result?.data ?? [];
      for (const group of groups) {
        shielded += 1;
        if (group.events?.some((event) => event.proofless)) proofless += 1;
        if (group.signature) signatures.push(group.signature);
      }
      token = body.result?.paginationToken ?? null;
      if (!token) break;
    }
    const registryRecords = await userRecordCount(cluster, apiKey, address);
    return {
      signatures,
      summary: {
        queried: true,
        shieldedTransactions: shielded,
        prooflessTransactions: proofless,
        registryRecords,
        error: null,
        note: "Indexer counts are encrypted transactions for this view tag. Amounts were not decrypted. Public deposit and withdrawal sizes still come from the Solana transaction.",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Indexer request failed.";
    return {
      signatures,
      summary: {
        queried: true,
        shieldedTransactions: shielded || null,
        prooflessTransactions: proofless || null,
        registryRecords: null,
        error: message,
        note: "The indexer could not be read. Deposit and withdrawal amounts still come from standard RPC when those transactions mention this address.",
      },
    };
  }
}

async function userRecordCount(cluster: Cluster, apiKey: string, address: string): Promise<number | null> {
  const host = cluster === "mainnet" ? "mainnet.helius-rpc.com" : "devnet.helius-rpc.com";
  const url = `https://${host}/v1/spr/getUserRecords?api-key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "getUserRecords",
      params: { owners: [address] },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { error?: unknown; result?: unknown };
  if (body.error) return null;
  return countRecords(body.result);
}

function countRecords(result: unknown): number | null {
  const list = recordList(result);
  if (!list) return null;
  return list.filter((entry) => entry != null).length;
}

function recordList(result: unknown): unknown[] | null {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  for (const key of ["records", "data", "users", "items"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return null;
}

export async function loadAddress(
  address: string,
  cluster: Cluster,
  options: { apiKey?: string; rpcUrl?: string } = {},
): Promise<LiveLoad> {
  const endpoint = rpcEndpoint(cluster, options.apiKey, options.rpcUrl);
  const { signatures, truncated } = await signaturesFor(endpoint, address);
  const indexer = options.apiKey
    ? await indexerSummary(cluster, options.apiKey, address)
    : {
        signatures: [] as string[],
        summary: {
          queried: false,
          shieldedTransactions: null,
          prooflessTransactions: null,
          registryRecords: null,
          error: null,
          note: INDEXER_NOTE_NO_KEY,
        } satisfies IndexerSummary,
      };

  const seen = new Set(signatures);
  const extra = indexer.signatures.filter((signature) => !seen.has(signature)).slice(0, 20);
  const all = [...signatures, ...extra];
  const events: BoundaryEvent[] = [];
  const warnings: string[] = [];

  const queue = [...all];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    for (;;) {
      const signature = queue.shift();
      if (!signature) return;
      try {
        const tx = await transaction(endpoint, signature);
        if (!tx) continue;
        const extracted = extractBoundary(tx, address);
        events.push(...extracted.events);
        warnings.push(...extracted.warnings);
      } catch (error) {
        const message = error instanceof Error ? error.message : "transaction fetch failed";
        warnings.push(`${signature} could not be read: ${message}`);
      }
    }
  });
  await Promise.all(workers);

  events.sort((a, b) => a.blockTime - b.blockTime || a.id.localeCompare(b.id));
  const notes = [
    indexer.summary.note,
    truncated
      ? `Only the most recent ${MAX_SIGNATURES} signatures for this address were scanned.`
      : `Scanned ${all.length} transaction${all.length === 1 ? "" : "s"} that mention this address.`,
    "Encrypted transfers inside the ring are not scored. The score uses public deposit and withdrawal amounts only.",
    "This is a self-check of one address. It does not match these deposits against anyone else's withdrawals.",
  ];

  return {
    address,
    cluster,
    source: "live",
    rpcHost: hostOf(endpoint),
    events,
    score: scoreBoundary(address, events),
    indexer: indexer.summary,
    scannedSignatures: all.length,
    truncated: truncated || extra.length > 0 && indexer.signatures.length > extra.length,
    notes,
    warnings,
  };
}
