/**
 * Real news, no keys: BBC World RSS for the general wire, Google News RSS
 * for targeted searches. Hand-rolled CDATA-aware parser — no XML dependency.
 */
import { fetchWithCache } from "../cache";
import { RssItemSchema, type NewsItem } from "../schemas";
import type { Emit } from "../sse";

const BBC_WORLD = "https://feeds.bbci.co.uk/news/world/rss.xml";

function googleNewsUrl(topic: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractTag(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  let value = m[1].trim();
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) value = cdata[1].trim();
  return decodeEntities(value);
}

export function parseRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTag(block, "title");
    if (!title) continue;
    const parsed = RssItemSchema.safeParse({
      title,
      url: extractTag(block, "link") ?? "",
      published: extractTag(block, "pubDate") ?? "",
    });
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

export interface NewsResult {
  source: string;
  fetched_at: string;
  note?: string;
  items: NewsItem[];
}

export async function fetchNews(opts: {
  topic?: string;
  emit?: Emit;
  limit?: number;
}): Promise<NewsResult> {
  const topic = opts.topic?.trim() || undefined;
  const url = topic ? googleNewsUrl(topic) : BBC_WORLD;
  const key = topic ? `news:google:${topic.toLowerCase()}` : "news:bbc";

  const { data, fetchedAt, note } = await fetchWithCache<NewsItem[]>({
    source: "news",
    key,
    emit: opts.emit,
    fn: async () => {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "veritas-desk/0.1" },
      });
      if (!res.ok) throw new Error(`RSS ${res.status} from ${new URL(url).host}`);
      const items = parseRss(await res.text());
      if (items.length === 0) throw new Error("RSS parsed to 0 items");
      return items;
    },
  });

  const seen = new Set<string>();
  const items = data.filter((item) => {
    const k = item.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    source: topic ? `Google News "${topic}"` : "BBC World",
    fetched_at: fetchedAt,
    note,
    items: items.slice(0, opts.limit ?? 12),
  };
}
