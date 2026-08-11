ALTER TABLE public.device_backups
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS diff_text text,
  ADD COLUMN IF NOT EXISTS imported boolean NOT NULL DEFAULT false;
