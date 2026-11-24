import { db } from '../db.ts';
import { now } from '../lib/ids.ts';

function xmlValue(value: string, tag: string): string {
  const match = value.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() ?? '';
}

export function normalizeToolResponse(toolId: string, text: string): unknown {
  if (toolId !== 'builtin_search_news') return undefined;
  const items = text.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  return { source: 'Google News RSS', note: 'Headlines and metadata only. Follow links for full article text.', articles: items.slice(0, 5).map((item) => ({ title: xmlValue(item, 'title'), link: xmlValue(item, 'link'), publishedAt: xmlValue(item, 'pubDate'), publisher: xmlValue(item, 'source') })) };
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return entities[entity.toLowerCase()] ?? match;
  });
}

export function extractWebpage(html: string, responseTruncated = false): { title: string; text: string; textLength: number; truncated: boolean; extraction: string; warning?: string } {
  const title = decodeHtml(html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '');
  const withoutBoilerplate = html.replace(/<(?:script|style|noscript|svg|form|nav|header|footer|aside)(?:\s[^>]*)?>[\s\S]*?<\/(?:script|style|noscript|svg|form|nav|header|footer|aside)>/gi, ' ').replace(/<!--([\s\S]*?)-->/g, ' ');
  const article = withoutBoilerplate.match(/<article(?:\s[^>]*)?>([\s\S]*?)(?:<\/article>|$)/i)?.[1] ?? withoutBoilerplate.match(/<main(?:\s[^>]*)?>([\s\S]*?)(?:<\/main>|$)/i)?.[1] ?? withoutBoilerplate.match(/<body(?:\s[^>]*)?>([\s\S]*?)(?:<\/body>|$)/i)?.[1] ?? withoutBoilerplate;
  const cleaned = article.replace(/<(?:script|style|noscript|svg|form|nav|header|footer|aside)(?:\s[^>]*)?>[\s\S]*?<\/(?:script|style|noscript|svg|form|nav|header|footer|aside)>/gi, ' ');
  const text = decodeHtml(cleaned.replace(/<(?:p|div|section|article|main|h[1-6]|li|tr|br|blockquote|pre)(?:\s[^>]*)?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/\r/g, '').replace(/[\t \u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const textLength = text.length;
  const truncated = responseTruncated || textLength > 24_000;
  const warning = textLength < 120 ? 'Little or no article text was extracted. The page may require JavaScript, deny automated access, or be unsupported.' : responseTruncated ? 'The source response exceeded Relay\'s byte limit; this is partial extracted text, not a complete article.' : undefined;
  return { title, text: text.slice(0, 24_000), textLength, truncated, extraction: text ? 'HTML text extraction' : 'No readable text extracted', ...(warning ? { warning } : {}) };
}

export function ensureWebResearchTool(): void {
  const timestamp = now();
  const parameters = { type: 'object', properties: { query: { type: 'string', description: 'Focused current-news search query', minLength: 3, maxLength: 200 }, count: { type: 'integer', minimum: 1, maximum: 5, default: 5 } }, required: ['query'], additionalProperties: false };
  db.prepare("INSERT OR IGNORE INTO tools (id, name, description, method, url, headers, secret_headers, parameters, permission, enabled, timeout_ms, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('builtin_search_news', 'search_news', 'Search current headlines from Google News RSS for recent developments, launches, pricing, announcements, and public events. Returns title, publisher, publication date, and source link. Always cite the returned source and do not claim full article text was read.', 'GET', 'https://news.google.com/rss/search?q={{query}}&hl=en-US&gl=US&ceid=US:en', JSON.stringify({ Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Relay-Local-Agent/0.3' }), '{}', JSON.stringify(parameters), 'auto', 1, 15000, 1, timestamp, timestamp);
  db.prepare("UPDATE tools SET url = ?, parameters = ?, builtin = 1 WHERE id = 'builtin_search_news'").run('https://news.google.com/rss/search?q={{query}}&hl=en-US&gl=US&ceid=US:en', JSON.stringify(parameters));
  const pageParameters = { type: 'object', properties: { url: { type: 'string', description: 'Public HTTPS webpage URL, not a local/private service', minLength: 12, maxLength: 2000 } }, required: ['url'], additionalProperties: false };
  db.prepare("INSERT OR IGNORE INTO tools (id, name, description, method, url, headers, secret_headers, parameters, permission, enabled, timeout_ms, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run('builtin_fetch_webpage', 'fetch_webpage', 'Read publicly accessible HTML text from a specific webpage for research or citations. Returns extracted text, title, source URL, and truncation/access limitations. It does not execute JavaScript, bypass authentication or paywalls, access X reliably, or guarantee a complete article. Cite the source and do not claim unread sections were reviewed.', 'GET', '{{url}}', JSON.stringify({ Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Relay-Local-Agent/0.4' }), '{}', JSON.stringify(pageParameters), 'auto', 1, 15000, 1, timestamp, timestamp);
  for (const botId of ['bot_scout', 'bot_atlas']) {
    const row = db.prepare('SELECT tool_ids FROM bots WHERE id = ?').get(botId) as { tool_ids: string } | undefined;
    if (!row) continue;
    const toolIds = new Set(JSON.parse(row.tool_ids) as string[]); toolIds.add('builtin_search_news'); toolIds.add('builtin_fetch_webpage');
    db.prepare('UPDATE bots SET tool_ids = ? WHERE id = ?').run(JSON.stringify([...toolIds]), botId);
  }
}
