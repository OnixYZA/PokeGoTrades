-- Private OCR location store for listing proofs.
--
-- `listing_proofs.ocr_extracted` is readable by anyone who can see the listing: `listing_proofs_read`
-- (migration ...000400_grants_rls) is `using (listing_id in (select l.id from public.listings l))`, which
-- inherits `listings_read` — and `listings_read` shows every OPEN listing to every authenticated trainer,
-- blocked pairs aside. An appraisal screenshot's OCR text can carry where a Pokemon was caught (the game
-- prints it next to the catch date), and for a local catch that is roughly where the seller plays. The
-- product decision is that catch location is private to the seller (no listing tag, no filter), and the
-- worker already never logs it (workers/azure-ocr/src/core/log.ts). So it gets its own table, readable only
-- by the listing's own seller, never by a buyer, and never through `listing_proofs` at all.
create table public.listing_proof_private (
  proof_id       uuid primary key references public.listing_proofs (id) on delete cascade,
  catch_location text not null check (char_length(catch_location) between 1 and 120),
  created_at     timestamptz not null default now()
);

-- ===== Grants: default privileges were revoked in ...000100, so both roles need an explicit grant =====
grant select on public.listing_proof_private to authenticated;   -- column-free: RLS is the only gate
grant all on public.listing_proof_private to service_role;       -- the OCR worker is the only writer

alter table public.listing_proof_private enable row level security;

-- Seller-only read; no insert/update/delete policy for authenticated at all — only the service-role OCR
-- worker (workers/azure-ocr) ever writes this table, the same way it is the only writer of `listings.lucky`.
create policy listing_proof_private_read_seller on public.listing_proof_private for select to authenticated
  using (
    exists (
      select 1
      from public.listing_proofs p
      join public.listings l on l.id = p.listing_id
      where p.id = listing_proof_private.proof_id
        and l.seller_id = (select auth.uid())
    )
  );
