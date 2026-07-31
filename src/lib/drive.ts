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

/**
 * The locked Google Drive folder that stores every SOP document, training video
 * and image. In production the upload Edge Function pushes files into THIS folder
 * through the Drive API (using a service account), sets each file to view-only,
 * and stores the returned file id on the SOP record. Access is mediated entirely
 * by Supabase/Edge Functions — the browser only ever receives the /preview embed.
 *
 * Folder shared by the owner:
 * https://drive.google.com/drive/folders/1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ
 */
export const DRIVE_STORAGE_FOLDER_ID = '1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ'

/**
 * Destination sub-folders created inside the storage folder, one per department.
 * The upload Edge Function drops each SOP's document/video into the folder chosen
 * in the form. In production the folder list is fetched live from Drive; this map
 * is the current known set and the demo's folder picker.
 */
export const DRIVE_DEPARTMENT_FOLDERS: Array<{ name: string; id: string }> = [
  { name: 'Front Desk', id: '1u3IDb7mnL64QTlcUOUvOUMi7Tr2lLhS0' },
  { name: 'Housekeeping', id: '17bjHtTUmS-wcv82MSir4HCFI8hX8q-Kw' },
  { name: 'Kitchen', id: '1BVSDXiPTwUXgEQE5uIQYujvKfrE7o46n' },
  { name: 'Maintenance', id: '1QhpioEqlN6prb8u0pIpq-lhbjQah1RV4' },
  { name: 'Quality & Compliance', id: '1uonBeYPsxXYWK-GbYObVXQxe6TRlN6Rc' },
]

/** True when a stored reference is an inline preview (demo upload), not a Drive id. */
export function isInlineSource(ref: string | null | undefined): boolean {
  return !!ref && (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('http'))
}

export function documentEmbedUrl(fileId: string): string {
  if (isInlineSource(fileId)) return fileId
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
}

export function videoEmbedUrl(fileId: string): string {
  if (isInlineSource(fileId)) return fileId
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`
}

/**
 * Sandbox flags for the viewer iframe. Drive's preview needs scripts and
 * same-origin to render; allow-downloads and allow-popups are deliberately
 * withheld so the frame cannot spawn a download or a pop-out tab on its own.
 */
export const VIEWER_SANDBOX = 'allow-scripts allow-same-origin allow-presentation'
