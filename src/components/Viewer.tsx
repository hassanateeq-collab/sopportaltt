import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import DOMPurify from 'dompurify'
import type { Sop } from '../types'
import { scopeLabel } from '../lib/scope'
import { read } from '../data/store'
import { documentEmbedUrl, videoEmbedUrl, VIEWER_SANDBOX, isInlineSource } from '../lib/drive'
import { fmtD } from '../lib/format'

/**
 * The in-portal viewer: one SOP, a Document/Video toggle, and — via the footer
 * the caller supplies — the read-and-understood sign-off underneath both.
 *
 * The VIEW ONLY chip and the hidden controls are deterrence only; the real lock
 * is the Drive share setting on the file. When no Drive file is attached yet we
 * show a watermarked "paper" placeholder rather than a broken frame.
 */
export function Viewer({
  sop,
  initialKind = 'doc',
  showViewOnly = true,
  onClose,
  footer,
}: {
  sop: Sop
  initialKind?: 'doc' | 'video'
  showViewOnly?: boolean
  onClose: () => void
  footer?: ReactNode
}) {
  const [kind, setKind] = useState<'doc' | 'video'>(initialKind)
  const hasVideo = !!sop.video_file_id
  const fileId = kind === 'doc' ? sop.document_file_id : sop.video_file_id
  const dept = read.department(sop.department_id)?.name ?? ''
  const scope = scopeLabel(sop.branch_scope)
  // An editor-authored SOP is shown natively in the portal (its rendered HTML),
  // not the Google Drive file preview. Sanitised before it's injected.
  const safeDoc = useMemo(() => (sop.document_html ? DOMPurify.sanitize(sop.document_html) : ''), [sop.document_html])

  return (
    <div className="viewer">
      <div className="v-head">
        <span className="v-title">
          <span className="mono" style={{ fontSize: 12, color: 'var(--brass-deep)' }}>{sop.code}</span> {sop.title}
          <span className="ver">v{sop.version}</span>
        </span>
        <div className="vseg" role="group" aria-label="Content">
          <button aria-pressed={kind === 'doc'} onClick={() => setKind('doc')}>Document</button>
          <button aria-pressed={kind === 'video'} onClick={() => setKind('video')} disabled={!hasVideo}>▶ Video</button>
        </div>
        {showViewOnly && <span className="vo">VIEW ONLY</span>}
        <button className="v-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="v-doc">
        {kind === 'doc' && safeDoc ? (
          <div className="sopview-wrap">
            <div className="sopview" dangerouslySetInnerHTML={{ __html: safeDoc }} />
          </div>
        ) : fileId && isInlineSource(fileId) ? (
          <div className="v-frame-wrap">
            {kind === 'video' ? (
              <video
                src={fileId}
                controls
                controlsList="nodownload noplaybackrate"
                disablePictureInPicture
                style={{ width: '100%', height: '100%', maxHeight: '70vh', background: '#000', borderRadius: 'var(--r)' }}
              />
            ) : (
              // The manager's own just-uploaded PDF, previewed inline. No sandbox
              // here (unlike the Drive embed) so the browser's PDF viewer renders.
              <iframe src={fileId} title={`${sop.code} document`} />
            )}
            <div className="noext" title="View only" />
          </div>
        ) : fileId ? (
          <div className="v-frame-wrap">
            <iframe
              src={kind === 'doc' ? documentEmbedUrl(fileId) : videoEmbedUrl(fileId)}
              sandbox={VIEWER_SANDBOX}
              allow="autoplay; encrypted-media"
              title={`${sop.code} ${kind}`}
              referrerPolicy="no-referrer"
            />
            <div className="noext" title="View only" />
          </div>
        ) : kind === 'video' ? (
          <div className="paper">
            <div className="wm">VIEW ONLY</div>
            <div className="ph-brand">Hamsun Hospitality · {dept}</div>
            <h1>{sop.title} — Training Video</h1>
            <div className="ph-meta">{sop.code} · v{sop.version} · {scope}</div>
            <div className="playph">
              <div className="pcirc">▶</div>
              <p style={{ textAlign: 'center', maxWidth: 420 }}>
                The training video for this SOP plays here once a Google Drive or YouTube link is attached in Manager or
                Admin. Staff watch inside the portal only.
              </p>
            </div>
            <div className="ph-foot">CONTROLLED CONTENT · HAMSUN SOP PORTAL</div>
          </div>
        ) : (
          <div className="paper">
            <div className="wm">VIEW ONLY</div>
            <div className="ph-brand">Hamsun Hospitality · {dept}</div>
            <h1>{sop.title}</h1>
            <div className="ph-meta">
              {sop.code} · v{sop.version} · updated {fmtD(sop.updated_at)} · applies to {scope}
            </div>
            <h2>1. Purpose</h2>
            <p>{sop.summary || 'Newly published — pending its full document.'}</p>
            <h2>2. Procedure</h2>
            <p>
              The full step-by-step procedure appears here, streamed live from the controlled Google Drive file once a
              document link is attached. It always shows the current version — no copies floating on WhatsApp.
            </p>
            <h2>3. Responsibility</h2>
            <p>Every {dept} team member covered by the scope above must read this document and sign the register below.</p>
            <div className="ph-foot">CONTROLLED DOCUMENT · HAMSUN SOP PORTAL · DO NOT DISTRIBUTE</div>
          </div>
        )}
      </div>

      {footer && (
        <div className="v-foot">
          <div className="v-foot-in">{footer}</div>
        </div>
      )}
    </div>
  )
}
