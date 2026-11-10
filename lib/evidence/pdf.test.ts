import { describe, expect, it } from 'vitest';
import { textPdf } from './pdf';

describe('textPdf', () => {
  it('writes a structurally valid PDF with correct xref offsets', () => {
    const bytes = textPdf('Shipment record (VRD-1006)', ['USPS tracking 9400111899560000100106 [shipments:ship-VRD-1006]']);
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // Each xref entry points at the start of its object.
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    entries.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain('\\(VRD-1006\\)'); // parentheses escaped
  });

  it('paginates long content', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
    const text = Buffer.from(textPdf('Long', lines)).toString('latin1');
    expect(Number(text.match(/\/Count (\d+)/)![1])).toBeGreaterThan(1);
  });
});
