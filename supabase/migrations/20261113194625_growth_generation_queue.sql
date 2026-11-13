BEGIN;
CREATE TABLE public.growth_generation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),generation_key text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','failed','completed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 source jsonb NOT NULL,model text NOT NULL,proposals jsonb,next_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.growth_generation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_generation_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.growth_generation_runs TO service_role;
ALTER TABLE public.growth_ideas ADD COLUMN source_key text UNIQUE,ADD COLUMN generation_id uuid REFERENCES public.growth_generation_runs(id);
-- Automated proposals name their generation run instead of impersonating an admin.
ALTER TABLE public.growth_ideas ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.growth_ideas ADD CONSTRAINT growth_author_required CHECK(created_by IS NOT NULL OR generation_id IS NOT NULL);
COMMIT;
