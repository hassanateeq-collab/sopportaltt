/**
 * Google Drive access for Edge Functions, using OAuth as the Hamsun account.
 *
 * A service account can't write into a personal Gmail's "My Drive" (it owns no
 * storage quota), so the function uploads AS the Hamsun Google account using a
 * long-lived refresh token. The files are then owned by that account and use its
 * 15 GB quota. The client id/secret and refresh token live only in the function
 * secrets, never in the browser.
 */

/** Exchange the stored refresh token for a fresh Drive-scoped access token. */
export async function getUserAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`)
  const json = await res.json()
  return json.access_token as string
}

/** Upload one file into a Drive folder; returns the new file id. */
export async function uploadToDrive(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: ArrayBuffer,
): Promise<string> {
  const boundary = `hamsun${crypto.randomUUID()}`
  const metadata = { name, parents: [folderId] }
  const pre =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  const post = `\r\n--${boundary}--`
  const body = new Blob([pre, bytes, post])

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  )
  if (!res.ok) throw new Error(`Drive upload failed: ${await res.text()}`)
  const json = await res.json()
  return json.id as string
}

/** List the sub-folders of a Drive folder. */
export async function listFolders(token: string, parentId: string): Promise<Array<{ id: string; name: string }>> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Drive folder list failed: ${await res.text()}`)
  const json = await res.json()
  return (json.files ?? []).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }))
}

/** Create a sub-folder inside a Drive folder; returns its id + name. */
export async function createFolder(
  token: string,
  parentId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  if (!res.ok) throw new Error(`Drive folder create failed: ${await res.text()}`)
  const json = await res.json()
  return { id: json.id, name: json.name }
}

/** Download a file's bytes from Drive. */
export async function downloadFromDrive(token: string, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Drive download failed: ${await res.text()}`)
  return await res.arrayBuffer()
}

/** Delete a file from Drive. A missing file (404) is treated as already gone. */
export async function deleteFromDrive(token: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed: ${await res.text()}`)
}

/**
 * Make a file view-only: readers cannot download, print or copy, and anyone with
 * the link may view (so staff without Google accounts can see the preview embed).
 */
export async function makeViewOnly(token: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id&supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ copyRequiresWriterPermission: true }),
  })
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}
