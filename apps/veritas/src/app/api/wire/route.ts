import { getStatuses } from "@/lib/cache";
import { snapshot } from "@/lib/portfolio";
import { fetchNews } from "@/lib/sources/news";
import { topMarkets } from "@/lib/sources/polymarket";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resting-state data for the terminal — also pre-warms the last-good cache. */
export async function GET() {
  const [news, markets] = await Promise.allSettled([
    fetchNews({ limit: 14 }),
    topMarkets({ limit: 10 }),
  ]);

  return Response.json({
    news: news.status === "fulfilled" ? news.value : null,
    markets: markets.status === "fulfilled" ? markets.value : null,
    statuses: getStatuses(),
    portfolio: snapshot(),
  });
}
