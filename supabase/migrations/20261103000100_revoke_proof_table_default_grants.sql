-- Revoke the accidental default table privileges on the two proof tables, and stop future tables inheriting them.
--
-- WHY. Migration ...20260916000400_grants_rls runs `revoke all on all tables in schema public from anon,
-- authenticated`, and every later table is meant to be granted explicitly (see the comment above the grants in
-- ...20260927000200_listing_proof_private: "default privileges were revoked, so both roles need an explicit
-- grant"). But that revoke only touched tables that EXISTED when it ran. Supabase also installs default
-- privileges (`alter default privileges ... in schema public grant all on tables to anon, authenticated,
-- service_role`) for the roles that create objects, so every table created afterwards starts life with full
-- table privileges for anon and authenticated. `public.profile_proofs` (...20260926000100) and
-- `public.listing_proof_private` (...20260927000200) were created after the revoke and never revoked those
-- defaults, so they carry privileges nobody intended:
--   - on hosted, anon and authenticated hold TRUNCATE on exactly these two tables (and on no other public table).
--     TRUNCATE is not subject to RLS, so any signed-in (or anonymous) client could empty either table.
--   - on a stock local/throwaway Supabase Postgres, authenticated additionally holds UPDATE and DELETE, which turns
--     "no write path for clients" into "RLS silently filters to 0 rows" instead of a 42501 permission error.
-- RLS had no UPDATE/DELETE policy for either table, so row-level writes were still blocked; only TRUNCATE was a
-- real hole on hosted. This migration removes the accidental grants without changing any intended behaviour.
--
-- 1) FUTURE TABLES. Default privileges belong to the role that CREATES the table, so `alter default privileges`
--    without `for role` only affects tables later created by whichever role runs this migration. Migrations run
--    as `postgres` (hosted `db push` and the local stack); Supabase also gives `supabase_admin` the same
--    public-schema defaults, but `supabase_admin` creates objects only for Supabase's own extensions/services, never
--    this project's migrations. We therefore alter the defaults of `postgres` and, defensively, of
--    `supabase_admin`, but only when the migration role is allowed to (superuser, or a member of that role): a
--    non-superuser cannot alter another role's defaults, and a failing statement here would abort `db push`.
--    Limits: tables created by any OTHER role are not covered (none exist here), and service_role's default
--    grant is deliberately left alone, so a new table is reachable by the worker but by no client until its own
--    migration grants it explicitly, which is the convention already followed everywhere in this project.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and pg_has_role(current_user, v_role, 'member') then
      execute format(
        'alter default privileges for role %I in schema public revoke all on tables from public, anon, authenticated',
        v_role);
    end if;
  end loop;
end $$;

-- 2) THESE TWO TABLES. Revoke everything (table-level and column-level privileges both go), then re-grant exactly
--    what the original migrations granted deliberately, verbatim, so nothing else changes. Idempotent: running
--    it twice, or on a database that never had the accidental grants, leaves the same final state.
revoke all on table public.listing_proof_private, public.profile_proofs from public, anon, authenticated;

-- listing_proof_private (...20260927000200): seller-only SELECT via RLS; the OCR worker (service_role) is the
-- only writer. No anon access, no client writes, no sequences (uuid primary key, no serial columns).
grant select on public.listing_proof_private to authenticated;
grant all on public.listing_proof_private to service_role;

-- profile_proofs (...20260926000100): trainers read their own rows and insert only {id, storage_path}
-- (user_id defaults to auth.uid(); ocr_status/ocr_extracted/created_at are server-owned); no UPDATE/DELETE
-- for clients, only apply_profile_proof running as service_role changes a row after insert. No anon access.
-- Function grants (apply_profile_proof, private.profile_proof_object_exists) are untouched.
grant select, insert (id, storage_path) on public.profile_proofs to authenticated;
grant all on public.profile_proofs to service_role;
