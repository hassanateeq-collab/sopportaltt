import { useEffect, useState } from 'react'
import { fetchPolicyDocUrl, fetchStaffPolicyDocUrl } from '../data/store'

/**
 * Renders a policy's uploaded document INSIDE the portal, with no Google Drive
 * or external chrome. The bytes come through the policy-view Edge Function and
 * are shown via a local `blob:` URL, so the browser's own viewer renders the PDF
 * — no drive.google.com embed, no outside link. `staffToken` picks the staff
 * path (opaque token) over the manager/admin path.
 */
export function PolicyDocFrame({
  policyId,
  staffToken,
  title,
}: {
  policyId: string
  staffToken?: string
  title: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let made: string | null = null
    setUrl(null)
    setError('')
    const load = staffToken ? fetchStaffPolicyDocUrl(policyId, staffToken) : fetchPolicyDocUrl(policyId)
    load
      .then((u) => {
        if (!active) {
          URL.revokeObjectURL(u)
          return
        }
        made = u
        setUrl(u)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load the document.')
      })
    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [policyId, staffToken])

  if (error) return <div className="notice">{error}</div>
  if (!url) {
    return (
      <div className="docframe-load">
        <span className="spinner" /> Loading document…
      </div>
    )
  }
  return <iframe className="docframe" src={url} title={title} />
}
