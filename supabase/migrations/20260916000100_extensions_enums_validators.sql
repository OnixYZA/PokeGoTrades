-- Extensions, enums, jsonb validators
-- Transcribed verbatim from SUPABASE_PLAN.md §1.1

-- Since 2026-05-30 new projects no longer auto-grant privileges on public tables: grant explicitly everywhere.
alter default privileges in schema public revoke execute on functions from public;

create schema if not exists private;                 -- never added to the exposed schema list
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

create type public.team_name       as enum ('Mystic', 'Valor', 'Instinct');
create type public.listing_status  as enum ('open', 'locked', 'completed', 'withdrawn');
create type public.background_hint as enum ('meta', 'legacy', 'shiny', 'shadow');   -- mirrors BackgroundHint
create type public.trade_type      as enum (                                        -- mirrors TradeType verbatim
  'Standard / Registered',
  'Special (Shiny/Legendary) Registered',
  'Unregistered (Standard)',
  'Unregistered (Shiny/Legendary)'
);
create type public.friendship_label as enum ('Good', 'Great', 'Ultra', 'Best');
create type public.listing_tag      as enum ('Legacy Move', 'Community Day', 'PvP Ready', 'Raid Exclusive', 'Hundo IV');
create type public.proof_kind       as enum ('appraisal', 'movesets', 'event_badge');
create type public.ocr_status       as enum ('pending', 'processing', 'verified', 'failed', 'rejected');
create type public.chat_status      as enum ('open', 'bailed', 'completed', 'closed');
create type public.chat_role        as enum ('seller', 'buyer');
create type public.message_kind     as enum ('text', 'offer', 'system');
create type public.system_event     as enum (
  'locked', 'unlocked', 'seller_confirmed', 'buyer_confirmed', 'confirmation_withdrawn',
  'completed', 'closed_listing_completed', 'closed_listing_withdrawn', 'bailed'
);
create type public.bail_reason      as enum ('unresponsive', 'unreasonable_adds', 'spoofer', 'other');
create type public.report_status    as enum ('open', 'reviewed', 'actioned', 'dismissed');
create type public.creature_list    as enum ('arsenal', 'wishlist');

-- CreatureRef { name, hue, pokemonId, shiny?, lucky? } as strict jsonb. Immutable, so usable inside CHECKs.
create function public.creature_ref_is_valid(
  p jsonb,
  p_allowed_keys text[] default array['name', 'pokemonId', 'hue', 'shiny', 'lucky']
) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when jsonb_typeof(p->'name')      is distinct from 'string' then false
    when jsonb_typeof(p->'pokemonId') is distinct from 'number' then false
    when jsonb_typeof(p->'hue')       is distinct from 'number' then false
    else char_length(p->>'name') between 1 and 40
      and (p->>'pokemonId') ~ '^[1-9][0-9]{0,4}$'      -- dex no. or PokeAPI form id (e.g. 10188 zacian-crowned)
      and (p->>'hue')::numeric between 0 and 360
      and coalesce(jsonb_typeof(p->'shiny'), 'boolean') = 'boolean'
      and coalesce(jsonb_typeof(p->'lucky'), 'boolean') = 'boolean'
      and (select bool_and(k = any (p_allowed_keys)) from jsonb_object_keys(p) as k)
  end
$$;

-- FormalOffer { name, pokemonId, hue, iv?, move? } (+ shiny/lucky so the offer card stops losing them)
create function public.formal_offer_is_valid(p jsonb) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select public.creature_ref_is_valid(p, array['name', 'pokemonId', 'hue', 'shiny', 'lucky', 'iv', 'move'])
    and coalesce(jsonb_typeof(p->'iv'),   'string') = 'string' and coalesce(char_length(p->>'iv'),   0) <= 40
    and coalesce(jsonb_typeof(p->'move'), 'string') = 'string' and coalesce(char_length(p->>'move'), 0) <= 40
$$;

create function public.creature_ref_array_is_valid(p jsonb, p_max integer) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'array' then false
    when jsonb_array_length(p) > p_max then false
    else coalesce((select bool_and(public.creature_ref_is_valid(e)) from jsonb_array_elements(p) as e), true)
  end
$$;

create function public.array_is_distinct(p anyarray) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select cardinality(p) = (select count(distinct e) from unnest(p) as e)
$$;

-- CHECK constraints execute as the inserting role, so that role must be able to execute these.
grant execute on function public.creature_ref_is_valid(jsonb, text[]),
                          public.formal_offer_is_valid(jsonb),
                          public.creature_ref_array_is_valid(jsonb, integer),
                          public.array_is_distinct(anyarray)
  to authenticated, service_role;
