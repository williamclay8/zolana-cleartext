import { SOL_ASSET, parseHumanAmount } from "@/lib/engine/amount";
import { preflight } from "@/lib/engine/preflight";
import { reviveEvent, type SerializedEvent } from "@/lib/engine/serialize";
import { isSolanaAddress } from "@/lib/ring/address";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Send a JSON body." }, { status: 400 });
  }
  const body = payload as {
    address?: unknown;
    events?: SerializedEvent[];
    sol?: unknown;
    at?: unknown;
  };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  if (!isSolanaAddress(address) && !address.startsWith("Fixture")) {
    return Response.json({ ok: false, error: "That is not a Solana address." }, { status: 400 });
  }
  if (!Array.isArray(body.events) || body.events.length > 500) {
    return Response.json({ ok: false, error: "Events must be a list of at most 500." }, { status: 400 });
  }
  const amount = parseHumanAmount(typeof body.sol === "string" ? body.sol : "", 9);
  if (amount === null || amount <= 0n) {
    return Response.json({ ok: false, error: "Enter a SOL amount like 0.5 or 1.337." }, { status: 400 });
  }
  const at = typeof body.at === "number" && Number.isFinite(body.at) ? Math.floor(body.at) : 0;
  if (at <= 0) {
    return Response.json({ ok: false, error: "at must be a unix timestamp in seconds." }, { status: 400 });
  }
  let events;
  try {
    events = body.events.map((event) => reviveEvent(event));
  } catch {
    return Response.json({ ok: false, error: "Event amounts must be decimal strings." }, { status: 400 });
  }
  const report = preflight(address, events, { amount, asset: SOL_ASSET, at });
  return Response.json({
    ok: true,
    verdict: report.verdict,
    headline: report.headline,
    scoreBefore: report.scoreBefore,
    scoreAfter: report.scoreAfter,
    newFindings: report.newFindings,
    suggestions: report.suggestions,
    grade: report.after.grade,
  });
}
