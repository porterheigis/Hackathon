"use client";

import type { NewsItem } from "@/lib/schemas";

function timeOf(published: string): string {
  const date = new Date(published);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toISOString().slice(11, 16);
}

export function NewsWire({ items, source }: { items: NewsItem[]; source: string }) {
  return (
    <section className="flex min-h-0 flex-col bg-v-bg">
      <div className="border-b border-v-hairline px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-v-muted">
        news wire · {source || "connecting…"}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div className="px-3 py-4 text-xs text-v-dim">wire silent — no feed yet</div>
        )}
        {items.map((item, i) => (
          <a
            key={`${item.title}-${i}`}
            href={item.url || undefined}
            target="_blank"
            rel="noreferrer"
            className="block border-b border-v-hairline/50 px-3 py-2 hover:bg-v-panel"
          >
            <span className="tabular mr-2 text-[10px] text-v-amber-dim">
              {timeOf(item.published)}Z
            </span>
            <span className="text-xs leading-snug text-v-text">{item.title}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
