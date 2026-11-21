import { serializeEvent } from "@/lib/engine/serialize";
import { isSolanaAddress } from "@/lib/ring/address";
import type { Cluster } from "@/lib/ring/constants";
import { loadAddress } from "@/lib/ring/fetch";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Send a JSON body." }, 400);
  }
  const body = payload as { address?: unknown; cluster?: unknown };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const cluster: Cluster = body.cluster === "mainnet" ? "mainnet" : "devnet";
  if (!isSolanaAddress(address)) {
    return json({ ok: false, error: "That is not a Solana address." }, 400);
  }
  try {
    const loaded = await loadAddress(address, cluster, {
      apiKey: process.env.HELIUS_API_KEY || undefined,
      rpcUrl: process.env.SOLANA_RPC_URL || undefined,
    });
    return json({
      ok: true,
      address: loaded.address,
      cluster: loaded.cluster,
      source: loaded.source,
      rpcHost: loaded.rpcHost,
      score: loaded.score,
      events: loaded.events.map(serializeEvent),
      indexer: loaded.indexer,
      scannedSignatures: loaded.scannedSignatures,
      truncated: loaded.truncated,
      notes: loaded.notes,
      warnings: loaded.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The RPC request failed.";
    return json({ ok: false, error: message }, 502);
  }
}
