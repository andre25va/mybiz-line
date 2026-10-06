ALTER TABLE public.biz_contacts ADD COLUMN IF NOT EXISTS deal_tag text;
NOTIFY pgrst, 'reload schema';
