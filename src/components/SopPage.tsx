import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { read } from '../data/store'
import { sopContentHtml } from '../lib/sopdoc'
import { fmtD } from '../lib/format'
import type { Sop } from '../types'

/** Rebuild an SOP's document as sanitized HTML for the in-portal reader. */
export function recomposeSopHtml(sop: Sop): string {
  if (!sop.sop_doc) return ''
  const html = sopContentHtml(
    {
      title: sop.title,
      code: sop.code,
      version: sop.version,
      department: read.department(sop.department_id)?.name ?? '',
      effectiveDate: fmtD(sop.updated_at),
      purpose: sop.sop_doc.purpose,
      appliesTo: sop.sop_doc.appliesTo,
    },
    sop.sop_doc.body,
  )
  return DOMPurify.sanitize(html)
}

/** The SOP document rendered inline in the portal's theme. */
export function SopPage({ sop }: { sop: Sop }) {
  const safeDoc = useMemo(() => recomposeSopHtml(sop), [sop])
  if (!safeDoc) return null
  return <article className="soppage" dangerouslySetInnerHTML={{ __html: safeDoc }} />
}
