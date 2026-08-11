/**
 * Build an SOP as a real Word (.docx) file from the in-app editor.
 *
 * The manager writes the body in a rich editor; this composes the controlled-
 * document header (logo + SOP metadata table, matching SOP_Format.docx) above
 * that body and renders the whole thing to OOXML with @turbodocx/html-to-docx.
 * The library is loaded on demand (it's large) so it never weighs down first
 * paint. Google Drive previews the resulting .docx natively.
 */

import { SOP_LOGO_DATA_URI } from './sopLogo'

export interface SopDocMeta {
  title: string
  /** SOP No. */
  code: string
  version: number
  department: string
  /** Already formatted, e.g. "11 Aug 2026". */
  effectiveDate: string
  purpose: string
  appliesTo: string
}

export const SOP_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const CONFIDENTIAL = 'CONFIDENTIAL — Controlled Document. Printed copies are uncontrolled unless stamped.'

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

/** The controlled-document header (logo + SOP metadata), matching the template. */
export function sopHeaderHtml(m: SopDocMeta): string {
  const cell = 'border:1px solid #000000;padding:5px 8px;font-family:Arial,sans-serif;font-size:10pt;'
  return (
    `<table style="width:100%;border-collapse:collapse;">` +
      `<tr>` +
        `<td rowspan="3" style="${cell}width:92px;text-align:center;vertical-align:middle;"><img src="${SOP_LOGO_DATA_URI}" width="58" height="58" alt="Hamsun"/></td>` +
        `<td style="${cell}text-align:center;font-weight:bold;">STANDARD OPERATING PROCEDURE</td>` +
        `<td style="${cell}"><b>SOP No.:</b> ${esc(m.code)}</td>` +
      `</tr>` +
      `<tr><td style="${cell}"><b>Title:</b> ${esc(m.title)}</td><td style="${cell}"><b>Version No.:</b> ${esc(String(m.version))}</td></tr>` +
      `<tr><td style="${cell}"><b>Department:</b> ${esc(m.department)}</td><td style="${cell}"><b>Effective Date:</b> ${esc(m.effectiveDate)}</td></tr>` +
    `</table>` +
    `<table style="width:100%;border-collapse:collapse;">` +
      `<tr><td style="${cell}"><b>Purpose:</b> ${esc(m.purpose)}</td></tr>` +
      `<tr><td style="${cell}"><b>Who This Applies To:</b> ${esc(m.appliesTo)}</td></tr>` +
    `</table>` +
    `<p></p>`
  )
}

/** Compose the header + the manager's body and render it to a .docx Blob. */
export async function generateSopDocx(meta: SopDocMeta, bodyHtml: string): Promise<Blob> {
  const mod = await import('@turbodocx/html-to-docx')
  const HTMLtoDOCX = (mod.default ?? mod) as (
    html: string,
    header?: string | null,
    opts?: Record<string, unknown>,
    footer?: string | null,
  ) => Promise<Blob | ArrayBuffer | Uint8Array>

  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    sopHeaderHtml(meta) +
    (bodyHtml && bodyHtml.trim() ? bodyHtml : '<p></p>') +
    `<p style="text-align:center;font-size:8pt;color:#666666;margin-top:20px;">${CONFIDENTIAL}</p>` +
    `</body></html>`

  const out = await HTMLtoDOCX(html, null, {
    font: 'Arial',
    fontSize: 22,
    margins: { top: 720, right: 720, bottom: 720, left: 720 },
    title: `${meta.code} ${meta.title}`.trim(),
  }, null)

  return out instanceof Blob ? out : new Blob([out as BlobPart], { type: SOP_DOCX_MIME })
}
