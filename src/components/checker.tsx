"use client";

import { useMemo, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOL_ASSET, formatAmount, parseHumanAmount } from "@/lib/engine/amount";
import { preflight, type PreflightReport } from "@/lib/engine/preflight";
import { scoreBoundary } from "@/lib/engine/score";
import { reviveEvent, type SerializedEvent } from "@/lib/engine/serialize";
import type { BoundaryEvent, Grade, ScoreReport, Severity } from "@/lib/engine/types";
import { SCENARIOS } from "@/lib/fixtures/scenarios";
import { isSolanaAddress } from "@/lib/ring/address";
import type { Cluster } from "@/lib/ring/constants";

type LivePayload = {
  ok: true;
  address: string;
  cluster: Cluster;
  rpcHost: string;
  score: ScoreReport;
  events: SerializedEvent[];
  indexer: {
    queried: boolean;
    shieldedTransactions: number | null;
    prooflessTransactions: number | null;
    note: string;
    error: string | null;
  };
  scannedSignatures: number;
  notes: string[];
  warnings: string[];
};

const DELAYS = [
  { id: "10m", label: "10 minutes", seconds: 600 },
  { id: "1h", label: "1 hour", seconds: 3600 },
  { id: "6h", label: "6 hours", seconds: 6 * 3600 },
  { id: "1d", label: "1 day", seconds: 86_400 },
  { id: "3d", label: "3 days", seconds: 3 * 86_400 },
  { id: "7d", label: "7 days", seconds: 7 * 86_400 },
];

export function Checker() {
  const [address, setAddress] = useState("");
  const [cluster, setCluster] = useState<Cluster>("devnet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<BoundaryEvent[]>([]);
  const [report, setReport] = useState<ScoreReport | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [indexerNote, setIndexerNote] = useState<string | null>(null);
  const [sol, setSol] = useState("1");
  const [delayId, setDelayId] = useState("1d");
  const [plan, setPlan] = useState<PreflightReport | null>(null);

  const linked = useMemo(() => {
    const ids = new Set<string>();
    for (const match of report?.matches ?? []) {
      for (const id of [...match.depositIds, ...match.withdrawalIds]) ids.add(id);
    }
    return ids;
  }, [report]);

  function showScenario(id: string) {
    const scenario = SCENARIOS.find((item) => item.id === id);
    if (!scenario) return;
    const scored = scoreBoundary(scenario.address, scenario.events);
    setError(null);
    setEvents(scenario.events);
    setReport(scored);
    setSourceLabel(`Fixture · ${scenario.title}`);
    setNotes([scenario.blurb, "Scored on this machine. No RPC call."]);
    setWarnings([]);
    setIndexerNote(null);
    setPlan(null);
    const open = [...scenario.events]
      .filter((event) => event.kind === "deposit" && event.asset.kind === "SOL")
      .sort((a, b) => (a.amount > b.amount ? -1 : 1))[0];
    if (open) setSol(formatAmount(open.amount, open.asset).replace(` ${open.asset.symbol}`, ""));
  }

  async function onScore(event: FormEvent) {
    event.preventDefault();
    const trimmed = address.trim();
    if (!isSolanaAddress(trimmed)) {
      setError("Enter a Solana address, or open one of the recorded scenarios.");
      return;
    }
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const response = await fetch("/api/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: trimmed, cluster }),
      });
      const body = (await response.json()) as LivePayload | { ok: false; error: string };
      if (!body.ok) {
        setError(body.error);
        return;
      }
      const revived = body.events.map((item) => reviveEvent(item));
      setEvents(revived);
      setReport(body.score);
      setSourceLabel(`Live ${body.cluster} · ${body.rpcHost} · ${body.scannedSignatures} transactions`);
      setNotes(body.notes);
      setWarnings(body.warnings);
      setIndexerNote(
        body.indexer.queried
          ? `${body.indexer.note}${body.indexer.error ? ` (${body.indexer.error})` : ""}${
              body.indexer.shieldedTransactions !== null
                ? ` Shielded transactions seen: ${body.indexer.shieldedTransactions}.`
                : ""
            }`
          : body.indexer.note,
      );
      const open = revived
        .filter((item) => item.kind === "deposit" && item.asset.kind === "SOL")
        .sort((a, b) => (a.amount > b.amount ? -1 : 1))[0];
      if (open) setSol(formatAmount(open.amount, open.asset).replace(` ${open.asset.symbol}`, ""));
    } catch {
      setError("The score request did not complete. The scenarios below still run offline.");
    } finally {
      setLoading(false);
    }
  }

  function onPreflight(event: FormEvent) {
    event.preventDefault();
    const amount = parseHumanAmount(sol, 9);
    if (amount === null || amount <= 0n) {
      setError("Enter a SOL amount such as 0.5 or 1.337.");
      return;
    }
    setError(null);
    const delay = DELAYS.find((item) => item.id === delayId) ?? DELAYS[3]!;
    const last = events.reduce((max, item) => Math.max(max, item.blockTime), 0);
    const at = Math.max(Math.floor(Date.now() / 1000), last) + delay.seconds;
    const who = report?.address || address || "planner";
    setPlan(preflight(who, events, { amount, asset: SOL_ASSET, at }));
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <RingMark />
          <p className="font-mono text-xs tracking-[0.22em] text-primary uppercase">Zolana Cleartext</p>
        </div>
        <div className="max-w-3xl">
          <h1 className="font-heading text-4xl leading-tight text-balance sm:text-5xl">
            How linkable is the public edge of this ring?
          </h1>
          <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Paste an address you control. Cleartext reads only the public deposits and withdrawals and
            scores how easily those two sides can be paired. It does not decrypt the ring, and it does
            not line your activity up with anyone else&apos;s.
          </p>
        </div>
      </header>

      <form onSubmit={onScore} className="flex flex-col gap-3">
        <Label htmlFor="address">Solana address</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Your address"
            spellCheck={false}
            autoCapitalize="off"
            className="h-11 font-mono text-sm sm:flex-1"
          />
          <select
            aria-label="Cluster"
            value={cluster}
            onChange={(event) => setCluster(event.target.value as Cluster)}
            className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm"
          >
            <option value="devnet">Devnet</option>
            <option value="mainnet">Mainnet</option>
          </select>
          <Button type="submit" size="lg" className="h-11 px-5" disabled={loading}>
            {loading ? "Reading…" : "Score"}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Or replay a scenario. These run with no API key.</p>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((scenario) => (
            <Button
              key={scenario.id}
              type="button"
              variant="outline"
              className="h-auto max-w-full px-3 py-2 text-left whitespace-normal"
              onClick={() => showScenario(scenario.id)}
            >
              <span className="font-medium">{scenario.title}</span>
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      {!report && !loading ? (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-2xl">What gets scored</CardTitle>
            <CardDescription>
              A deposit moves public SOL into the ring and publishes the amount. A withdrawal moves it
              back out and publishes the amount again. Everything between those two stays encrypted.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
            <p>Amount match: a deposit of X and a later withdrawal of about X.</p>
            <p>Timing: the shorter the gap, the easier the pair is to believe.</p>
            <p>Unusual sizes stand out. 0.1, 0.5, 1, 2, 5, and 10 SOL blend in better.</p>
            <p>Splitting helps only when the pieces do not add back up to the deposit.</p>
          </CardContent>
        </Card>
      ) : null}

      {loading ? <p className="text-sm text-muted-foreground">Reading public transactions. Encrypted payloads are skipped.</p> : null}

      {report ? (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="flex flex-col gap-6 pt-2 sm:flex-row sm:items-center">
                <ScoreDial score={report.privacyScore} grade={report.grade} />
                <div className="flex flex-col gap-2">
                  <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{sourceLabel}</p>
                  <h2 className="font-heading text-3xl capitalize">{report.grade}</h2>
                  <p className="text-muted-foreground">{report.summary}</p>
                  <p className="font-mono text-sm">
                    {report.deposits} deposits · {report.withdrawals} withdrawals
                  </p>
                </div>
              </CardContent>
            </Card>

            <div>
              <h2 className="font-heading mb-3 text-2xl">Public boundary</h2>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No deposit or withdrawal in the transactions that were scanned. A pure shielded transfer
                  publishes no amount, so it is not scored.
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {events.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={item.kind === "deposit" ? "secondary" : "default"}>
                          {item.kind === "deposit" ? "Deposit" : "Withdrawal"}
                        </Badge>
                        <span className="font-mono text-sm">{formatAmount(item.amount, item.asset)}</span>
                        {linked.has(item.id) ? <Badge variant="outline">linked</Badge> : null}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.blockTime ? new Date(item.blockTime * 1000).toLocaleString() : "time unknown"}
                        {" · "}
                        {roleLabel(item)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div>
              <h2 className="font-heading mb-3 text-2xl">What leaked</h2>
              {report.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing in this history pairs a deposit with a withdrawal.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {report.findings.map((finding) => (
                    <li key={finding.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={finding.severity === "high" ? "destructive" : "outline"} className={severityClass(finding.severity)}>
                          {finding.severity}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">−{finding.weight}</span>
                        <h3 className="font-medium">{finding.title}</h3>
                      </div>
                      <p className="text-sm text-muted-foreground">{finding.explanation}</p>
                      <p className="mt-2 border-l-2 border-primary pl-3 text-sm">Fix: {finding.fix}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-2xl">Pre-flight</CardTitle>
                <CardDescription>
                  Try a withdrawal before you send it. The clock starts after your latest boundary event, or now, whichever is later.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={onPreflight} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="sol">Amount in SOL</Label>
                    <Input id="sol" value={sol} onChange={(event) => setSol(event.target.value)} inputMode="decimal" className="h-10 font-mono" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="delay">Wait</Label>
                    <select
                      id="delay"
                      value={delayId}
                      onChange={(event) => setDelayId(event.target.value)}
                      className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm"
                    >
                      {DELAYS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit">Score this plan</Button>
                </form>
                {plan ? (
                  <div className="mt-4 flex flex-col gap-3">
                    <p className={`rounded-lg px-3 py-2 text-sm ${verdictClass(plan.verdict)}`}>
                      <span className="font-mono tracking-wide uppercase">{plan.verdict}</span>
                      {" · "}
                      {plan.scoreBefore} → {plan.scoreAfter}
                    </p>
                    <p className="text-sm">{plan.headline}</p>
                    <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                      {plan.suggestions.map((suggestion) => (
                        <li key={suggestion}>{suggestion}</li>
                      ))}
                    </ul>
                    {plan.newFindings[0] ? (
                      <p className="text-xs text-muted-foreground">New finding: {plan.newFindings[0].title}.</p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Limits of this check</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                {indexerNote ? <p>{indexerNote}</p> : null}
                {notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                <p>Standard sizes are 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, and any whole token from 1 to 1000.</p>
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function roleLabel(event: BoundaryEvent): string {
  if (event.counterparty === "self") return "same address";
  if (event.role === "withdrawal_recipient") return "received from another public address";
  if (event.role === "deposit_recipient") return "deposited by another public address";
  return "another public address in this transaction";
}

function severityClass(severity: Severity): string {
  if (severity === "medium") return "border-amber-300/40 text-amber-200";
  if (severity === "low") return "text-primary";
  return "";
}

function verdictClass(verdict: PreflightReport["verdict"]): string {
  if (verdict === "stop") return "bg-destructive/15 text-foreground";
  if (verdict === "caution") return "bg-amber-300/15 text-foreground";
  return "bg-primary/15 text-foreground";
}

function ScoreDial({ score, grade }: { score: number; grade: Grade }) {
  const turn = Math.round((score / 100) * 360);
  return (
    <div
      className="grid size-32 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(var(--primary) ${turn}deg, oklch(0.3 0.02 145) ${turn}deg)`,
      }}
      aria-label={`Privacy score ${score}, ${grade}`}
    >
      <div className="grid size-24 place-items-center rounded-full bg-background">
        <span className="font-heading text-4xl">{score}</span>
      </div>
    </div>
  );
}

function RingMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
      <circle cx="14" cy="14" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-foreground" />
    </svg>
  );
}
