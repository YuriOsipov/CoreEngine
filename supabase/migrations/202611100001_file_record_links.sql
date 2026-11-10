-- Multi-record file links: keep one public.files asset, attach it to additional parents.
CREATE TABLE IF NOT EXISTS public.file_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES public.files (id) ON DELETE CASCADE,
  parent_collection text NOT NULL,
  parent_record_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT file_record_links_unique UNIQUE (file_id, parent_collection, parent_record_id)
);

CREATE INDEX IF NOT EXISTS file_record_links_parent_idx
  ON public.file_record_links (parent_collection, parent_record_id);

CREATE INDEX IF NOT EXISTS file_record_links_file_idx
  ON public.file_record_links (file_id);
