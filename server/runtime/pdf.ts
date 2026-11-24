import { HttpError } from '../lib/validation.ts';

export async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount: number; truncated: boolean }> {
  const source = buffer.length > 5 * 1024 * 1024 ? buffer.subarray(0, 5 * 1024 * 1024) : buffer;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(source), useSystemFonts: true, disableAutoFetch: true, disableFontFace: true }).promise;
  if (document.numPages > 100) { await document.loadingTask.destroy(); throw new HttpError(400, 'PDFs are limited to 100 pages.'); }
  const sections: string[] = [];
  let totalLength = 0;
  let truncated = false;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) sections.push(`\n[PDF page ${pageNumber}]\n${text}`);
      page.cleanup();
      totalLength += text.length;
      if (totalLength > 200_000) { truncated = true; break; }
    }
  } finally { await document.loadingTask.destroy(); }
  const text = sections.join('\n').slice(0, 200_000);
  if (text.length < 10) throw new HttpError(415, 'No readable text was found in this PDF. It may be scanned, image-only, encrypted, or unsupported. OCR is not implemented.');
  return { text, pageCount: document.numPages, truncated };
}
