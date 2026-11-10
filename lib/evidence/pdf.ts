// Minimal single-file PDF writer (no dependency): a titled page or pages of plain text lines in
// Helvetica, enough for an evidence summary PayPal accepts as a document.

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const LEADING = 14;
const MAX_CHARS = 95;

const escape = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

function wrap(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > MAX_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_CHARS);
    const at = cut > 20 ? cut : MAX_CHARS;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

export function textPdf(title: string, lines: string[]): Uint8Array {
  const all = [title, '', ...lines].flatMap(wrap);
  const perPage = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));

  // Objects: 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((pageLines, i) => {
    const ops = pageLines
      .map((l, j) => `BT /F1 ${i === 0 && j === 0 ? 14 : 10} Tf ${MARGIN} ${PAGE_H - MARGIN - j * LEADING} Td (${escape(l)}) Tj ET`)
      .join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}
