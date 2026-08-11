-- Store an editor-authored SOP's editable content so it renders natively in the
-- portal AND can be reopened for editing by a manager/admin. Holds the editor
-- body HTML plus the Purpose and Who-This-Applies-To text.
--   { "body": "<p>…</p>", "purpose": "…", "appliesTo": "…" }
-- Legacy PDF SOPs leave this null and still embed the Drive preview.
alter table public.sops add column if not exists sop_doc jsonb;
