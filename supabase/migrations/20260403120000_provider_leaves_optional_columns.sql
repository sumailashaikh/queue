-- Align provider_leaves with app expectations (safe if columns already exist).
ALTER TABLE public.provider_leaves
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';

ALTER TABLE public.provider_leaves
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.provider_leaves
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
