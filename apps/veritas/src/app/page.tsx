"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MarketBoard } from "@/components/MarketBoard";
import { NewsWire } from "@/components/NewsWire";
import { PositionBook } from "@/components/PositionBook";
import { ReasoningTape } from "@/components/ReasoningTape";
import { SourceStatusBar } from "@/components/SourceStatusBar";
import { TopBar } from "@/components/TopBar";
import type { PortfolioSnapshot } from "@/lib/portfolio";
import type { Market, NewsItem } from "@/lib/schemas";
import type { AgentEvent, SourceStatus, TapeLine } from "@/lib/sse";

interface WirePayload {
  news: { source: string; items: NewsItem[] } | null;
  markets: { markets: Market[] } | null;
  statuses: Record<string, SourceStatus>;
  portfolio: PortfolioSnapshot;
}

export default function Page() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsSource, setNewsSource] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({});
  const [tape, setTape] = useState<TapeLine[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [pnlHistory, setPnlHistory] = useState<number[]>([0]);
  const [running, setRunning] = useState(false);
  const [denyText, setDenyText] = useState<string | null>(null);
  const runningRef = useRef(false);
  const sourceRef = useRef<EventSource | null>(null);

  const refreshWire = useCallback(async () => {
    try {
      const res = await fetch("/api/wire");
      if (!res.ok) return;
      const wire = (await res.json()) as WirePayload;
      if (wire.news) {
        setNews(wire.news.items);
        setNewsSource(wire.news.source);
      }
      if (wire.markets) setMarkets(wire.markets.markets);
      setStatuses((prev) => ({ ...prev, ...wire.statuses }));
      setPortfolio(wire.portfolio);
    } catch {
      /* wire refresh is best-effort; statuses reflect the server view */
    }
  }, []);

  useEffect(() => {
    refreshWire();
    const id = setInterval(() => {
      if (!runningRef.current) refreshWire();
    }, 45_000);
    return () => {
      clearInterval(id);
      sourceRef.current?.close();
    };
  }, [refreshWire]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "tape": {
        setTape((prev) => {
          const idx = prev.findIndex((l) => l.id === event.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              text: event.delta
                ? (next[idx].text ?? "") + (event.text ?? "")
                : event.text,
              payload: event.payload ?? next[idx].payload,
            };
            return next;
          }
          return [
            ...prev,
            {
              id: event.id,
              kind: event.kind,
              text: event.text,
              tool: event.tool,
              payload: event.payload,
            },
          ];
        });
        if (event.kind === "deny") {
          const p = (event.payload ?? {}) as { reason?: string; max_stake_usd?: number };
          setDenyText(
            `${p.reason ?? "policy_denied"} (cap $${p.max_stake_usd?.toFixed(2) ?? "?"})`
          );
          setTimeout(() => setDenyText(null), 6000);
        }
        break;
      }
      case "source_status":
        setStatuses((prev) => ({
          ...prev,
          [event.source]: { status: event.status, ts: event.ts, detail: event.detail },
        }));
        break;
      case "state":
        setPortfolio(event.portfolio);
        setPnlHistory((prev) => [...prev, event.portfolio.markPnl]);
        break;
      case "run_error":
        setTape((prev) => [
          ...prev,
          { id: `err_${Date.now()}`, kind: "error", text: event.message },
        ]);
        break;
      case "done":
        break;
    }
  }, []);

  const run = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setTape([]);
    setDenyText(null);

    const source = new EventSource("/api/agent");
    sourceRef.current = source;

    const stop = () => {
      source.close();
      runningRef.current = false;
      setRunning(false);
      refreshWire();
    };

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AgentEvent;
      handleEvent(event);
      if (event.type === "done") stop();
    };
    source.onerror = () => stop();
  }, [handleEvent, refreshWire]);

  return (
    <div className="flex h-screen flex-col bg-v-bg text-v-text">
      <TopBar
        running={running}
        onRun={run}
        walletUsd={portfolio?.walletUsd ?? 0}
        markPnl={portfolio?.markPnl ?? 0}
        denyText={denyText}
      />
      <SourceStatusBar statuses={statuses} />
      <main className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_360px] gap-px bg-v-hairline">
        <NewsWire items={news} source={newsSource} />
        <ReasoningTape lines={tape} running={running} />
        <div className="grid min-h-0 grid-rows-2 gap-px bg-v-hairline">
          <MarketBoard markets={markets} />
          <PositionBook portfolio={portfolio} pnlHistory={pnlHistory} />
        </div>
      </main>
    </div>
  );
}
