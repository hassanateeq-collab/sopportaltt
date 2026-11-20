import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { read } from '../data/store'
import { sopContentHtml } from '../lib/sopdoc'
import { fmtD } from '../lib/format'
import type { Policy } from '../types'

/** Rebuild a policy's inline document as sanitized HTML (same shape as an SOP). */
export function recomposePolicyHtml(policy: Policy): string {
  if (!policy.policy_doc) return ''
  const html = sopContentHtml(
    {
      title: policy.title,
      code: policy.code,
      version: policy.version,
      department: read.department(policy.department_id)?.name ?? '',
      effectiveDate: fmtD(policy.updated_at),
      purpose: policy.policy_doc.purpose,
      appliesTo: policy.policy_doc.appliesTo,
      docType: 'COMPANY POLICY',
      numberLabel: 'Policy No.',
    },
    policy.policy_doc.body,
  )
  return DOMPurify.sanitize(html)
}

/** The policy document rendered inline in the portal's theme. */
export function PolicyPage({ policy }: { policy: Policy }) {
  const safeDoc = useMemo(() => recomposePolicyHtml(policy), [policy])
  if (!safeDoc) return <div className="notice">This policy doesn’t have a written document yet.</div>
  return <article className="soppage" dangerouslySetInnerHTML={{ __html: safeDoc }} />
}
