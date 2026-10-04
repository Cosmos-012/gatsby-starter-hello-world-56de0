import ExcelJS from 'exceljs';
import type { Content, Figure, Table } from './report-content.ts';
import { label, pick, type Lang } from './i18n.ts';

const RATIO_KEYS = /^(performance\.(overall|coverage|level\.))/;
const isRatio = (key: string) => RATIO_KEYS.test(key);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const rtl = (langs: Lang[]) => langs[0] === 'ar';
/** Nom de feuille Excel valide : pas de \ / ? * [ ] :, 31 caractères max (les libellés bilingues contiennent « / »). */
export const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);

function figureText(f: Figure, langs: Lang[]): string {
  if (f.value == null) return label('report.no_data', langs);
  return isRatio(f.key) ? `${(f.value * 100).toFixed(1)} %` : String(f.value);
}

/** Valeur d'une cellule de table, localisée (statuts, tendances, gravités, alertes, noms multilingues). */
export function cell(table: string, col: string, row: Record<string, any>, langs: Lang[]): string | number | null {
  const v = row[col];
  if (col === 'name') return pick(v, langs);
  if (col === 'status') return label(`status.${v}`, langs);
  if (col === 'trend') return label(`trend.${v}`, langs);
  if (col === 'severity') return label(`severity.${v}`, langs);
  if (col === 'type' && table === 'alerts') return label(`alert.${v}`, langs);
  if (col === 'details') return Object.entries(v ?? {}).map(([k, x]) => `${k}: ${x}`).join(', ');
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return v ?? null;
}

export function renderHtml(c: Content, hash: string, version: number, langs: Lang[]): string {
  const m = c.meta, L = (k: string) => esc(label(k, langs));
  const tableHtml = (t: Table) => `<h2>${L(`table.${t.key}`)}</h2>
<p class="src">${L('report.source')}: <code>${esc(t.source)}</code></p>
${t.rows.length === 0 ? `<p>${L('report.no_data')}</p>` : `<table><thead><tr>${t.columns.map((col) => `<th>${L(`col.${col}`)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map((r) => `<tr>${t.columns.map((col) => `<td>${esc(cell(t.key, col, r, langs))}</td>`).join('')}</tr>`).join('')}</tbody></table>`}`;
  return `<!doctype html>
<html lang="${langs[0]}" dir="${rtl(langs) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(m.title)}</title>
<style>body{font-family:system-ui,"Noto Naskh Arabic",sans-serif;margin:2rem;color:#1a1a1a}table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}
th,td{border:1px solid #ccc;padding:.35rem .6rem;text-align:start}th{background:#f1f1f1}.src{color:#555;font-size:.85rem}code{direction:ltr;unicode-bidi:embed}</style></head>
<body><h1>${esc(m.title)}</h1><p>${L(`type.${m.type}`)} · ${L('report.period')}: ${esc(m.period_start)} → ${esc(m.period_end)} · ${L('report.as_of')}: ${esc(m.as_of)} · ${L('report.version')}: ${version}</p>
<p class="src">${L('report.hash')}: <code>${esc(hash)}</code></p>
<h2>${L('report.figures')}</h2><table><thead><tr><th>${L('report.figure')}</th><th>${L('report.value')}</th><th>${L('report.source')}</th></tr></thead><tbody>
${c.figures.map((f) => `<tr><td>${esc(label(`fig.${f.key}`, langs))}</td><td>${esc(figureText(f, langs))}</td><td><code>${esc(f.source)}</code></td></tr>`).join('')}</tbody></table>
${c.tables.map(tableHtml).join('\n')}</body></html>`;
}

export async function renderXlsx(c: Content, hash: string, version: number, langs: Lang[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const view = [{ rightToLeft: rtl(langs) }];
  const bold = { bold: true };
  const ws = wb.addWorksheet(sheetName(label('report.figures', langs)), { views: view });
  ws.addRow([c.meta.title]).font = { bold: true, size: 14 };
  ws.addRow([label(`type.${c.meta.type}`, langs), `${c.meta.period_start} → ${c.meta.period_end}`, `${label('report.as_of', langs)}: ${c.meta.as_of}`, `${label('report.version', langs)}: ${version}`]);
  ws.addRow([label('report.hash', langs), hash]);
  ws.addRow([]);
  ws.addRow([label('report.figure', langs), label('report.value', langs), label('report.source', langs)]).font = bold;
  for (const f of c.figures) {
    const r = ws.addRow([label(`fig.${f.key}`, langs), f.value ?? label('report.no_data', langs), f.source]);
    if (f.value != null && isRatio(f.key)) r.getCell(2).numFmt = '0.0%';
  }
  ws.columns = [{ width: 48 }, { width: 18 }, { width: 70 }];
  for (const t of c.tables) {
    const sheet = wb.addWorksheet(sheetName(label(`table.${t.key}`, langs)), { views: view });
    sheet.addRow(t.columns.map((col) => label(`col.${col}`, langs))).font = bold;
    for (const r of t.rows) {
      const row = sheet.addRow(t.columns.map((col) => cell(t.key, col, r, langs)));
      const ai = t.columns.indexOf('achievement');
      if (ai >= 0 && typeof r.achievement === 'number') row.getCell(ai + 1).numFmt = '0.0%';
    }
    sheet.addRow([]); sheet.addRow([`${label('report.source', langs)}: ${t.source}`]);
    sheet.columns.forEach((col) => { col.width = 22; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
