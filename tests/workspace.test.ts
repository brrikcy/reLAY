import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProjectFile, listProjectFiles, readProjectFile } from '../server/runtime/project.ts';
import { extractWebpage, normalizeToolResponse } from '../server/runtime/web-research.ts';
import { extractPdf } from '../server/runtime/pdf.ts';
import { samplePdf } from './fixtures/pdf.ts';

const directory = await mkdtemp(join(tmpdir(), 'relay-workspace-'));
process.env.RELAY_PROJECT_DIR = directory;
test.after(async () => { await rm(directory, { recursive: true, force: true }); });

test('Project files are real, bounded, and readable', async () => {
  const file = await createProjectFile('src/example.ts', 'export const answer = 42;\n');
  assert.equal(file.path, 'src/example.ts');
  assert.deepEqual((await readProjectFile('src/example.ts')).content, 'export const answer = 42;\n');
  assert.equal((await listProjectFiles()).some((entry) => entry.path === 'src/example.ts'), true);
});

test('Project path traversal and oversized files are rejected', async () => {
  await assert.rejects(() => createProjectFile('../outside.txt', 'blocked'), /relative project path|outside/);
  await assert.rejects(() => createProjectFile('safe.txt', 'x'.repeat(200_001)), /200,000/);
});

test('Google News RSS is converted into bounded structured source metadata', () => {
  const xml = '<?xml version="1.0"?><rss><channel><item><title><![CDATA[Example launch]]></title><link>https://news.example/story</link><pubDate>Thu, 19 Nov 2026 12:00:00 GMT</pubDate><source url="https://example.com">Example Publisher</source></item></channel></rss>';
  const result = normalizeToolResponse('builtin_search_news', xml) as { articles: Array<{ title: string; publisher: string }> };
  assert.equal(result.articles[0].title, 'Example launch');
  assert.equal(result.articles[0].publisher, 'Example Publisher');
});

test('Webpage extraction removes scripts, preserves article text, and reports truncation', () => {
  const html = '<html><head><title>Test &amp; Article</title><script>ignore()</script></head><body><nav>Menu</nav><main><h1>Useful heading</h1><p>Verified paragraph with a &quot;quote&quot;.</p><p>Second paragraph.</p></main><footer>Footer</footer></body></html>';
  const result = extractWebpage(html);
  assert.equal(result.title, 'Test & Article');
  assert.ok(result.text.includes('Verified paragraph with a "quote".'));
  assert.ok(result.text.includes('Second paragraph.'));
  assert.equal(result.text.includes('ignore()'), false);
  assert.equal(result.text.includes('Menu'), false);
  assert.equal(result.truncated, false);
  const long = extractWebpage(`<article><p>${'a'.repeat(25_000)}</p></article>`);
  assert.equal(long.text.length, 24_000);
  assert.equal(long.textLength, 25_000);
  assert.equal(long.truncated, true);
});

test('PDF extraction reports real page text and fails clearly on invalid data', async () => {
  const result = await extractPdf(samplePdf());
  assert.equal(result.pageCount, 1);
  assert.equal(result.truncated, false);
  assert.ok(result.text.includes('Juniper release notes'));
  assert.ok(result.text.includes('Second extracted line'));
  await assert.rejects(() => extractPdf(Buffer.from('%PDF-1.4\nnot a real document')), /PDF|document|format|setup|read/i);
});
