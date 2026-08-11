-- The admin sets each department's Drive folder centrally (Settings → Drive
-- folders). SOPs for that department are uploaded here, and their test reports
-- are filed into a "Tests" sub-folder of it. Managers no longer pick or create
-- folders. Null falls back to matching the folder by the department's name.
alter table public.departments add column if not exists drive_folder_id text;
