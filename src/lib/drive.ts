/**
 * Google Drive embedding.
 *
 * Documents and videos live in Drive and are embedded for viewing. They are
 * never re-hosted, and staff are never handed a raw file URL — only the preview
 * embed built from a file id.
 *
 * BE HONEST ABOUT THE DOWNLOAD RESTRICTION. Hiding the download, print and
 * pop-out controls in this UI is deterrence, nothing more. Anyone who opens
 * devtools can read the iframe src. The actual enforcement is the Drive share
 * setting on each file, and it has to be set on the file itself:
 *
 *   - share the file to a link as "Viewer", never as "Editor" or "Commenter";
 *   - turn on "Viewers and commenters cannot download, print, or copy";
 *   - keep the files in a locked folder that inherits those settings.
 *
 * With those set, the preview embed below is genuinely view-only. Without them,
 * no amount of frontend work makes it so.
 *
 * In production the manager/admin "upload SOP" action pushes the file into that
 * locked folder through the Drive API from an Edge Function, stores the returned
 * file id on the SOP record, and serves staff only what this module builds.
 */

export function documentEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
}

export function videoEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
}

/**
 * Sandbox flags for the viewer iframe. Drive's preview needs scripts and
 * same-origin to render; allow-downloads and allow-popups are deliberately
 * withheld so the frame cannot spawn a download or a pop-out tab on its own.
 */
export const VIEWER_SANDBOX = 'allow-scripts allow-same-origin allow-presentation'
