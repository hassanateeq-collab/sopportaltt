-- SOPs written in the in-app editor keep their rendered HTML so the portal can
-- display them natively (in the portal's own interface) instead of embedding the
-- Google Drive file preview. Legacy PDF SOPs leave this null and still embed.
alter table public.sops add column if not exists document_html text;
