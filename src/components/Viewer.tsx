import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Sop } from '../types'
import { documentEmbedUrl, videoEmbedUrl, VIEWER_SANDBOX } from '../lib/drive'
import { Notice } from './ui'

/**
 * The in-portal viewer. One SOP, a document/video toggle, and — for staff — the
 * read-and-understood sign-off underneath both.
 *
 * The controls here are hidden deliberately (no download, print, or pop-out),
 * but that is only deterrence: the real view-only lock is the Drive share
 * setting on the file itself. See lib/drive.ts. When no file id is present yet
 * we show a labelled placeholder rather than a broken frame, because in this
 * first build documents have not been pushed to Drive.
 */
export function Viewer({
  sop,
  initialTab = 'document',
  onClose,
  footer,
}: {
  sop: Sop
  initialTab?: 'document' | 'video'
  onClose: () => void
  footer?: ReactNode
}) {
  const [tab, setTab] = useState<'document' | 'video'>(initialTab)
  const hasVideo = !!sop.video_file_id
  const activeFileId = tab === 'document' ? sop.document_file_id : sop.video_file_id

  return (
    <div className="viewer">
      <div className="viewer__head">
        <button className="topbar__back" onClick={onClose} aria-label="Close viewer">
          ‹
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="viewer__code">{sop.code} · v{sop.version}</div>
          <div className="viewer__title">{sop.title}</div>
        </div>
      </div>

      <div className="toggle">
        <button
          className={`toggle__btn ${tab === 'document' ? 'toggle__btn--on' : ''}`}
          onClick={() => setTab('document')}
        >
          Document
        </button>
        <button
          className={`toggle__btn ${tab === 'video' ? 'toggle__btn--on' : ''}`}
          onClick={() => setTab('video')}
          disabled={!hasVideo}
          title={hasVideo ? undefined : 'No training video attached to this SOP yet'}
        >
          ▶ Video
        </button>
      </div>

      <div className="viewer__stage">
        {activeFileId ? (
          <iframe
            className="viewer__frame"
            src={tab === 'document' ? documentEmbedUrl(activeFileId) : videoEmbedUrl(activeFileId)}
            sandbox={VIEWER_SANDBOX}
            allow="autoplay; encrypted-media"
            title={`${sop.code} ${tab}`}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="placeholder">
            <div className="placeholder__icon" aria-hidden>
              {tab === 'document' ? '📄' : '🎬'}
            </div>
            <div style={{ fontWeight: 650 }}>
              {tab === 'document' ? 'Document not yet linked' : 'Training video not yet linked'}
            </div>
            <p className="muted" style={{ maxWidth: 340 }}>
              {tab === 'document'
                ? 'When the SOP file is uploaded it lands in a locked Google Drive folder and its view-only preview appears here.'
                : 'When a training video is attached to this SOP its view-only preview plays here.'}
            </p>
            <div style={{ marginTop: 6, maxWidth: 360 }}>
              <Notice tone="info">
                View-only is enforced by the Drive share setting on the file — “Viewer”, with download,
                print and copy turned off — not by this screen.
              </Notice>
            </div>
          </div>
        )}
        <p className="tiny" style={{ marginTop: 10, textAlign: 'center' }}>
          {sop.summary}
        </p>
      </div>

      {footer && <div className="viewer__foot">{footer}</div>}
    </div>
  )
}
