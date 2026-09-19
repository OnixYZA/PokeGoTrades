-- LOCAL DEVELOPMENT ONLY. Never run `supabase db push --include-seed` against a hosted project:
-- this file creates confirmed accounts with a known password.
--
-- Mock data from data/listings.ts, data/chats.ts and data/trainer.ts, per SUPABASE_PLAN.md §4.7.
-- All accounts sign in with  <handle lowercased>@pokegotrades.test / password123.
--
-- Point of view: data/listings.ts says l1 belongs to AzureRift, but data/chats.ts treats the local user
-- (DriftCoral) as l1's seller. DriftCoral is seeded as l1's seller, so c1-c3 are three parallel buyer chats.
-- Mock message roles map 'me' -> the chat's seller and 'them' -> the chat's buyer.
-- Message times are today's date at the mock HH:MM, in the database timezone (UTC locally).
-- Stardust values are never seeded (project rule): costs come from TRADE_COST_MATRIX only.

-- ============================================================================================
-- 1. Trainers: auth.users + auth.identities, then profile fields
--    ids: a0000000-0000-4000-8000-0000000000NN
-- ============================================================================================
create temporary table seed_trainers (
  id uuid primary key, handle text not null, lvl smallint not null, team public.team_name not null,
  friend_code text not null, safe_loc text, bio text not null default ''
) on commit drop;

insert into seed_trainers (id, handle, lvl, team, friend_code, safe_loc, bio) values
  -- DriftCoral: verbatim from data/trainer.ts (friend code '2841 · 9903 · 7715')
  ('a0000000-0000-4000-8000-000000000001', 'DriftCoral', 47, 'Mystic',   '284199037715', 'Adyar · ~500m radius',
     'Long-time hoarder. Only trade in daylight, only in public. Prefer meeting near IIT-M gate.'),
  -- Everyone else: the mock only names them, so level / team / friend code are placeholder fixtures.
  ('a0000000-0000-4000-8000-000000000002', 'AzureRift',  35, 'Mystic',   '100000000002', null, ''),
  ('a0000000-0000-4000-8000-000000000003', 'GraniteFox', 41, 'Valor',    '100000000003', null, ''),
  ('a0000000-0000-4000-8000-000000000004', 'NoxTrainer', 44, 'Instinct', '100000000004', null, ''),
  ('a0000000-0000-4000-8000-000000000005', 'EmberVale',  38, 'Valor',    '100000000005', null, ''),
  ('a0000000-0000-4000-8000-000000000006', 'IronGlass',  46, 'Mystic',   '100000000006', null, ''),
  ('a0000000-0000-4000-8000-000000000007', 'VoidQuill',  40, 'Instinct', '100000000007', null, ''),
  ('a0000000-0000-4000-8000-000000000008', 'MintRunner', 33, 'Instinct', '100000000008', null, ''),
  ('a0000000-0000-4000-8000-000000000009', 'CobaltAsh',  36, 'Mystic',   '100000000009', null, ''),
  ('a0000000-0000-4000-8000-00000000000a', 'PixelKite',  39, 'Valor',    '100000000010', null, ''),
  ('a0000000-0000-4000-8000-00000000000b', 'SolstonKid', 42, 'Instinct', '100000000011', null, '');

-- Empty-string token columns matter: GoTrue cannot scan NULL into them ("converting NULL to string is unsupported").
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token)
select '00000000-0000-0000-0000-000000000000', t.id, 'authenticated', 'authenticated',
       lower(t.handle) || '@pokegotrades.test',
       extensions.crypt('password123', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, now(), now(),
       '', '', '', '', '', '', '', ''
  from seed_trainers t;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), t.id, t.id::text, 'email',
       jsonb_build_object('sub', t.id::text, 'email', lower(t.handle) || '@pokegotrades.test',
                          'email_verified', true, 'phone_verified', false),
       now(), now(), now()
  from seed_trainers t;

-- The on_auth_user_created trigger has just created a placeholder profile + profile_private row for each user.
update public.profiles p
   set handle = t.handle, lvl = t.lvl, team = t.team, bio = t.bio
  from seed_trainers t where p.id = t.id;

update public.profile_private pp
   set friend_code = t.friend_code, safe_loc = t.safe_loc
  from seed_trainers t where pp.user_id = t.id;

-- data/trainer.ts `trades`. rep (4.9) and streak (38) are deliberately not seeded: ratings and streaks are out of MVP scope.
update public.profiles set trades_count = 214 where id = 'a0000000-0000-4000-8000-000000000001';

-- ============================================================================================
-- 2. Listings l1-l6 (data/listings.ts)  ids: b0000000-0000-4000-8000-00000000000N
--    year -> catch_year, iv 'a/b/c' -> three smallints, pvp/demand -> rank columns, dist dropped (D3).
--    l1 seller is DriftCoral (see header). l3 is locked further down, together with its trade_locks row.
-- ============================================================================================
insert into public.listings (
  id, seller_id, name, pokemon_id, form, catch_year, lucky, shiny, hue, accent, bg, loc,
  pvp_rank, demand_rank, trade_type, iv_atk, iv_def, iv_sta, looking) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'Shiny Zacian', 10188, 'Crowned Sword', 2020, true, true, 260, '#c9a6ff', 'meta', 'Adyar',
   'S+', '#1', 'Unregistered (Shiny/Legendary)', 15, 15, 14,
   '[{"name":"Shiny Zamazenta","pokemonId":889,"hue":340,"shiny":true},
     {"name":"Purified Apex Lugia","pokemonId":249,"hue":25},
     {"name":"Legacy Mewtwo","pokemonId":150,"hue":220,"lucky":true}]'::jsonb),

  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003',
   'Armored Mewtwo', 150, 'Genesis Armor', 2019, true, false, 210, '#7fd4ff', 'legacy', 'Adyar',
   'A', '#4', 'Special (Shiny/Legendary) Registered', 14, 15, 15,
   '[{"name":"Legacy Dragonite","pokemonId":149,"hue":340},
     {"name":"Purified Ho-Oh","pokemonId":250,"hue":25},
     {"name":"Shiny Deoxys A.","pokemonId":10001,"hue":220,"shiny":true,"lucky":true}]'::jsonb),

  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004',
   'Shiny Rayquaza', 384, 'Standard', 2023, false, true, 145, '#7dffb3', 'shiny', 'Adyar',
   'S', '#2', 'Special (Shiny/Legendary) Registered', 15, 15, 15,
   '[{"name":"Shiny Kyogre","pokemonId":382,"hue":340,"shiny":true},
     {"name":"Shiny Groudon","pokemonId":383,"hue":25,"shiny":true},
     {"name":"Origin Palkia","pokemonId":10246,"hue":220,"lucky":true}]'::jsonb),

  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005',
   'Purified Ho-Oh', 250, 'Standard', 2022, false, false, 25, '#ffb37a', 'meta', 'East Tambaram',
   'A+', '#7', 'Unregistered (Shiny/Legendary)', 14, 14, 15,
   '[{"name":"Purified Lugia","pokemonId":249,"hue":340},
     {"name":"Mega Rayquaza IV","pokemonId":10079,"hue":25},
     {"name":"Shiny Entei","pokemonId":244,"hue":220,"shiny":true,"lucky":true}]'::jsonb),

  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006',
   'Shiny Metagross', 376, 'Frostmoves', 2018, true, true, 195, '#a3e8ff', 'meta', 'East Tambaram',
   'S', '#3', 'Special (Shiny/Legendary) Registered', 15, 13, 15,
   '[{"name":"Shiny Beldum Comm.","pokemonId":374,"hue":340,"shiny":true},
     {"name":"Shiny Larvitar","pokemonId":246,"hue":25,"shiny":true},
     {"name":"Shiny Bagon","pokemonId":371,"hue":220,"shiny":true,"lucky":true}]'::jsonb),

  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000007',
   'Purified Apex Lugia', 249, 'Apex', 2024, false, false, 285, '#d4b0ff', 'legacy', 'Velachery',
   'A', '#5', 'Unregistered (Shiny/Legendary)', 15, 15, 15,
   '[{"name":"Purified Apex Ho-Oh","pokemonId":250,"hue":340},
     {"name":"Primal Groudon","pokemonId":10078,"hue":25},
     {"name":"Shiny Mew","pokemonId":151,"hue":220,"shiny":true,"lucky":true}]'::jsonb);

-- ============================================================================================
-- 3. Chats  ids: c0000000-0000-4000-8000-00000000000N
--    c1-c3  DriftCoral (seller of l1) with MintRunner / CobaltAsh / PixelKite: three parallel open chats
--    c4     NoxTrainer (seller of l3) with SolstonKid: the lock holder, created in section 5
--    c5     buyer-view fixture: DriftCoral is the BUYER on l2 (seller GraniteFox)
-- ============================================================================================
insert into public.chats (id, listing_id, seller_id, buyer_id) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000009'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a'),
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001');

-- Read state. A last_read_at between two messages reproduces the mock's unread badges:
-- c1 unread 2 (last read 10:28, then 10:31 and 10:33 arrive), c2 unread 0, c3 unread 1. Buyers have read everything.
insert into public.chat_members (chat_id, user_id, role, last_read_at)
select c.id, c.seller_id, 'seller'::public.chat_role,
       date_trunc('day', now()) + case c.id
         when 'c0000000-0000-4000-8000-000000000001' then interval '10:28'
         when 'c0000000-0000-4000-8000-000000000003' then interval '10:30'
         else interval '23:59' end
  from public.chats c
union all
select c.id, c.buyer_id, 'buyer'::public.chat_role, date_trunc('day', now()) + interval '23:59'
  from public.chats c;

-- ============================================================================================
-- 4. Messages for c1, c2, c3, c5.  data/chats.ts `offers` for c1, `fallbackOffers(listing.name)` for the rest.
--    c2 / c3 get one extra buyer line at 10:35 so the trigger-maintained Chat.preview matches the mock preview.
--    Rows are inserted oldest first so the on_message_inserted trigger leaves the newest as the preview.
-- ============================================================================================
insert into public.chat_messages (chat_id, sender_id, kind, body, created_at)
select m.chat_id, case m.role when 'me' then c.seller_id else c.buyer_id end, 'text', m.body,
       date_trunc('day', now()) + m.t::interval
  from (values
    -- c1: MintRunner
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'them', '10:24', 'Hey! Interested in Zacian. Trading a shiny Regieleki?'),
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'me',   '10:26', 'Regieleki is close but I really need Zamazenta.'),
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'them', '10:31', 'What about Regieleki + legacy Dragonite?'),
    ('c0000000-0000-4000-8000-000000000001'::uuid, 'them', '10:33', 'I can add a shiny Zubat too, is that fair?'),
    -- c2: CobaltAsh (fallbackOffers('Shiny Zacian') + mock preview)
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'them', '10:12', 'Hey, is your Shiny Zacian still up?'),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'me',   '10:14', 'Yep — what are you offering?'),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'them', '10:17', 'I have a legacy Dragonite with Draco Meteor.'),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'me',   '10:20', 'Interested. Meet at Adyar signal at 5?'),
    ('c0000000-0000-4000-8000-000000000002'::uuid, 'them', '10:35', 'Meet at the coffee shop by IIT gate?'),
    -- c3: PixelKite (fallbackOffers('Shiny Zacian') + mock preview)
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'them', '10:12', 'Hey, is your Shiny Zacian still up?'),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'me',   '10:14', 'Yep — what are you offering?'),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'them', '10:17', 'I have a legacy Dragonite with Draco Meteor.'),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'me',   '10:20', 'Interested. Meet at Adyar signal at 5?'),
    ('c0000000-0000-4000-8000-000000000003'::uuid, 'them', '10:35', 'Willing to throw in 3M stardust bonus'),
    -- c5: DriftCoral is the buyer ('them' = buyer = DriftCoral), GraniteFox the seller ('me')
    ('c0000000-0000-4000-8000-000000000005'::uuid, 'them', '10:12', 'Hey, is your Armored Mewtwo still up?'),
    ('c0000000-0000-4000-8000-000000000005'::uuid, 'me',   '10:14', 'Yep — what are you offering?'),
    ('c0000000-0000-4000-8000-000000000005'::uuid, 'them', '10:17', 'I have a legacy Dragonite with Draco Meteor.'),
    ('c0000000-0000-4000-8000-000000000005'::uuid, 'me',   '10:20', 'Interested. Meet at Adyar signal at 5?')
  ) as m(chat_id, role, t, body)
  join public.chats c on c.id = m.chat_id
 order by m.chat_id, m.t;

-- ============================================================================================
-- 5. c4 on l3: the LOCK HOLDER (mock: SolstonKid, active: false).
--    One DO block = one statement = one transaction, so the deferred lock-consistency triggers
--    ("listings.status = 'locked' <=> a trade_locks row") are checked against the finished state.
--    The lock carries buyer_confirmed_at, so the pending-confirmation UI ('awaiting_me' for the seller) has a fixture.
--    For the plain locked state, run:  update public.trade_locks set buyer_confirmed_at = null;
--    The accepted offer is the mock `formalOffer` from data/chats.ts.
-- ============================================================================================
do $$
declare
  v_day     timestamptz := date_trunc('day', now());
  v_listing uuid := 'b0000000-0000-4000-8000-000000000003';
  v_chat    uuid := 'c0000000-0000-4000-8000-000000000004';
  v_seller  uuid := 'a0000000-0000-4000-8000-000000000004';   -- NoxTrainer
  v_buyer   uuid := 'a0000000-0000-4000-8000-00000000000b';   -- SolstonKid
  v_offer   uuid := 'd0000000-0000-4000-8000-000000000004';
begin
  insert into public.chats (id, listing_id, seller_id, buyer_id) values (v_chat, v_listing, v_seller, v_buyer);
  insert into public.chat_members (chat_id, user_id, role, last_read_at) values
    (v_chat, v_seller, 'seller', v_day + interval '23:59'),
    (v_chat, v_buyer,  'buyer',  v_day + interval '23:59');

  insert into public.chat_messages (chat_id, sender_id, kind, body, created_at) values
    (v_chat, v_buyer,  'text', 'Hey, is your Shiny Rayquaza still up?',              v_day + interval '10:12'),
    (v_chat, v_seller, 'text', 'Yep — what are you offering?',                       v_day + interval '10:14'),
    (v_chat, v_buyer,  'text', 'I have a legacy Dragonite with Draco Meteor.',       v_day + interval '10:17');
  insert into public.chat_messages (id, chat_id, sender_id, kind, offer, created_at) values
    (v_offer, v_chat, v_buyer, 'offer',
     '{"name":"Legacy Dragonite","pokemonId":149,"hue":205,"iv":"96% IV","move":"Draco Meteor"}'::jsonb,
     v_day + interval '10:18');
  insert into public.chat_messages (chat_id, sender_id, kind, body, created_at) values
    (v_chat, v_seller, 'text', 'Interested. Meet at Adyar signal at 5?',             v_day + interval '10:20');

  insert into public.trade_locks (listing_id, chat_id, seller_id, buyer_id, accepted_offer_message_id,
                                  locked_at, buyer_confirmed_at)
  values (v_listing, v_chat, v_seller, v_buyer, v_offer, v_day + interval '10:22', v_day + interval '10:40');
  update public.listings set status = 'locked', locked_at = v_day + interval '10:22' where id = v_listing;

  insert into public.chat_messages (chat_id, sender_id, kind, body, system_event, created_at) values
    (v_chat, null, 'system', 'Seller accepted this offer. Competing offers are frozen.', 'locked', v_day + interval '10:22'),
    (v_chat, null, 'system', 'One trainer confirmed the trade. Waiting for the other.', 'buyer_confirmed', v_day + interval '10:40');
  insert into public.chat_messages (chat_id, sender_id, kind, body, created_at) values
    (v_chat, v_buyer, 'text', 'Locked in — see you at 5 ✅', v_day + interval '10:45');
end $$;

-- ============================================================================================
-- 6. DriftCoral's arsenal, wishlist and trade history (data/trainer.ts)
-- ============================================================================================
insert into public.trainer_creatures (owner_id, list, creature, sort_order) values
  ('a0000000-0000-4000-8000-000000000001', 'arsenal',  '{"name":"Sh. Rayquaza","pokemonId":384,"hue":145,"shiny":true}', 0),
  ('a0000000-0000-4000-8000-000000000001', 'arsenal',  '{"name":"Legacy Dnite","pokemonId":149,"hue":205,"lucky":true}', 1),
  ('a0000000-0000-4000-8000-000000000001', 'arsenal',  '{"name":"Sh. Metagross","pokemonId":376,"hue":195,"shiny":true}', 2),
  ('a0000000-0000-4000-8000-000000000001', 'arsenal',  '{"name":"Purified Apex Ho-Oh","pokemonId":250,"hue":25}', 3),
  ('a0000000-0000-4000-8000-000000000001', 'arsenal',  '{"name":"Sh. Mewtwo","pokemonId":150,"hue":275,"shiny":true,"lucky":true}', 4),
  ('a0000000-0000-4000-8000-000000000001', 'arsenal',  '{"name":"Sh. Garchomp","pokemonId":445,"hue":220,"shiny":true}', 5),
  ('a0000000-0000-4000-8000-000000000001', 'wishlist', '{"name":"Sh. Zamazenta","pokemonId":889,"hue":340,"shiny":true}', 0),
  ('a0000000-0000-4000-8000-000000000001', 'wishlist', '{"name":"Sh. Kyogre","pokemonId":382,"hue":210,"shiny":true}', 1),
  ('a0000000-0000-4000-8000-000000000001', 'wishlist', '{"name":"Purified Apex Lugia","pokemonId":249,"hue":285,"shiny":true}', 2),
  ('a0000000-0000-4000-8000-000000000001', 'wishlist', '{"name":"Sh. Mew","pokemonId":151,"hue":320,"shiny":true}', 3);

-- tradeHistory th1-th4 -> completed_trades with null listing/chat ids. DriftCoral is the seller (seller_gave = `gave`,
-- buyer_gave = `got`). The mock has no trade type; every entry involves a shiny or a legendary, so all four are
-- 'Special (Shiny/Legendary) Registered'. Lock / confirm times are placeholders one hour before completion.
insert into public.completed_trades (
  seller_id, buyer_id, seller_handle, buyer_handle, seller_gave, buyer_gave, trade_type,
  locked_at, seller_confirmed_at, buyer_confirmed_at, completed_at)
select 'a0000000-0000-4000-8000-000000000001', b.id, 'DriftCoral', b.handle, h.gave, h.got,
       'Special (Shiny/Legendary) Registered',
       h.done - interval '1 hour', h.done - interval '30 minutes', h.done - interval '10 minutes', h.done
  from (values
    ('MintRunner', '{"name":"Zapdos","pokemonId":145,"hue":48}'::jsonb,
                   '{"name":"Sh. Charizard","pokemonId":6,"hue":18,"shiny":true}'::jsonb,   timestamptz '2026-08-22 12:00+00'),
    ('CobaltAsh',  '{"name":"Sh. Blastoise","pokemonId":9,"hue":205,"shiny":true}'::jsonb,
                   '{"name":"Articuno","pokemonId":144,"hue":210}'::jsonb,                   timestamptz '2026-07-30 12:00+00'),
    ('PixelKite',  '{"name":"Moltres","pokemonId":146,"hue":15}'::jsonb,
                   '{"name":"Sh. Venusaur","pokemonId":3,"hue":130,"shiny":true}'::jsonb,    timestamptz '2026-06-14 12:00+00'),
    ('SolstonKid', '{"name":"Groudon","pokemonId":383,"hue":25}'::jsonb,
                   '{"name":"Sh. Garchomp","pokemonId":445,"hue":220,"shiny":true}'::jsonb,  timestamptz '2026-05-03 12:00+00')
  ) as h(partner, gave, got, done)
  join public.profiles b on b.handle = h.partner;
