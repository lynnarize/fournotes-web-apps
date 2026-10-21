-- Four Notes — Supabase (Postgres) schema for cloud sync and shared spaces.
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run: it upgrades an
-- older install in place. Every table is protected by Row Level Security so
-- users only see their own rows and rows in spaces they belong to.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared spaces (household budget, shared to-do list with a partner or team)
-- ---------------------------------------------------------------------------
create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by uuid not null references auth.users on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists space_members (
  space_id uuid not null references spaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member',            -- owner | member
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

-- security definer so policies can check membership without recursive RLS
create or replace function is_member(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from space_members where space_id = target and user_id = auth.uid())
$$;

create or replace function create_space(space_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into spaces (name, created_by) values (space_name, auth.uid()) returning id into new_id;
  insert into space_members (space_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

create or replace function join_space(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into target from spaces where invite_code = lower(code);
  if target is null then raise exception 'invalid invite code'; end if;
  insert into space_members (space_id, user_id) values (target, auth.uid()) on conflict do nothing;
  return target;
end $$;

create or replace function leave_space(target uuid) returns void
language sql security definer set search_path = public as $$
  delete from space_members where space_id = target and user_id = auth.uid()
$$;

alter table spaces enable row level security;
drop policy if exists "members read" on spaces;
create policy "members read" on spaces for select using (is_member(id));
drop policy if exists "owner updates" on spaces;
create policy "owner updates" on spaces for update using (created_by = auth.uid());

alter table space_members enable row level security;
drop policy if exists "members read" on space_members;
create policy "members read" on space_members for select using (is_member(space_id));

-- ---------------------------------------------------------------------------
-- Synced tables. Shared columns: id, user_id, space_id, created_at, updated_at
-- (client clock, used for newer-wins), synced_at (server clock, used to pull
-- changes), deleted_at (soft delete so other devices learn a row is gone).
-- ---------------------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  title text not null default '',
  content text not null default '',               -- plain text (search, AI, brief)
  html text,                                      -- rich text from the editor
  source text not null default 'manual',          -- manual | chat | ocr | recording | share
  tags text[] not null default '{}',
  image_path text,                                -- Supabase Storage path of the scan
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  title text not null,
  notes text,
  done boolean not null default false,
  due_at timestamptz,
  remind_at timestamptz,
  reminded boolean not null default false,
  priority text not null default 'medium',
  source text not null default 'manual',
  google_event_id text,                           -- set after syncing to Google Calendar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  merchant text not null,
  amount numeric(14,2) not null,                  -- positive = spend, negative = income
  currency char(3) not null default 'IDR',
  category text not null default 'Other',
  date date not null default current_date,
  items jsonb not null default '[]',
  source text not null default 'manual',
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists stickies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  text text not null default '',
  color text not null default 'yellow',
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Columns added with recurring tasks, bills, links, splits, multi-currency and spaces
alter table todos add column if not exists completed_at timestamptz;
alter table todos add column if not exists rrule text;                   -- e.g. FREQ=MONTHLY;INTERVAL=1
alter table todos add column if not exists bill jsonb;                   -- { amount, currency, category }
alter table todos add column if not exists note_id uuid;
alter table todos add column if not exists doing boolean default false;  -- board: in progress
alter table transactions add column if not exists fx_rate numeric(18,8); -- 1 unit of currency in base currency
alter table transactions add column if not exists splits jsonb;          -- [{ name, amount, settled }]
alter table transactions add column if not exists note_id uuid;
alter table stickies add column if not exists pinned boolean not null default false;

-- Columns added with stuck tasks, chores and notes kept current
alter table todos add column if not exists postponed jsonb;              -- { count, at }: how often the due date was pushed later
alter table todos add column if not exists stuck_until timestamptz;      -- "not now" on a stuck task
alter table todos add column if not exists rotation jsonb;               -- chores: ["Me", "Andi", "Budi"], taking turns
alter table todos add column if not exists assignee text;                -- whose turn this one is
alter table notes add column if not exists keep_current jsonb;           -- { every, checkedAt, update }

create index if not exists todos_remind_idx on todos (remind_at) where done = false and reminded = false and deleted_at is null;
create index if not exists transactions_month_idx on transactions (user_id, date);

create table if not exists monthly_summaries (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  month char(7) not null,                          -- YYYY-MM
  total numeric(14,2) not null,
  currency char(3) not null,
  by_category jsonb not null default '{}',
  text text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, month)
);

-- Monthly budgets per category (base currency)
create table if not exists budgets (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  space_id uuid references spaces on delete cascade,
  category text not null,
  amount numeric(14,2) not null,
  updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, space_id, category)
);

-- Push notification tokens (web push / APNs / FCM) per device
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  platform text not null,                          -- web | ios | android | macos
  push_token text not null,
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

-- Newer write wins (by client updated_at); synced_at always moves forward on the server.
create or replace function sync_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- stale write from a device that was offline: keep the newer row
  end if;
  if tg_op = 'UPDATE' then new.user_id = old.user_id; end if; -- ownership never changes
  new.synced_at = clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['notes','todos','transactions','stickies'] loop
    execute format('alter table %I add column if not exists space_id uuid references spaces on delete cascade', t);
    execute format('alter table %I add column if not exists synced_at timestamptz not null default now()', t);
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('drop trigger if exists %I_sync on %I', t, t);
    execute format('create trigger %I_sync before insert or update on %I for each row execute function sync_guard()', t, t);
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "own rows" on %I', t);
    execute format('drop policy if exists "own or space rows" on %I', t);
    execute format($p$create policy "own or space rows" on %I for all
      using ((space_id is null and user_id = auth.uid()) or (space_id is not null and is_member(space_id)))
      with check ((space_id is null and user_id = auth.uid()) or (space_id is not null and is_member(space_id)))$p$, t);
    execute format('create index if not exists %I_sync_idx on %I (synced_at)', t, t);
    execute format('create index if not exists %I_space_idx on %I (space_id) where space_id is not null', t, t);
  end loop;
end $$;

alter table monthly_summaries enable row level security;
drop policy if exists "own rows" on monthly_summaries;
create policy "own rows" on monthly_summaries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table budgets enable row level security;
drop policy if exists "own or space rows" on budgets;
create policy "own or space rows" on budgets for all
  using ((space_id is null and user_id = auth.uid()) or (space_id is not null and is_member(space_id)))
  with check ((space_id is null and user_id = auth.uid()) or (space_id is not null and is_member(space_id)));
alter table devices enable row level security;
drop policy if exists "own rows" on devices;
create policy "own rows" on devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Semantic search in the cloud (optional): store note embeddings next to the note.
-- create extension if not exists vector;
-- alter table notes add column if not exists embedding vector(1024);  -- voyage-3.5-lite
-- create index if not exists notes_embedding_idx on notes using hnsw (embedding vector_cosine_ops);

-- Realtime: broadcast changes so other devices update instantly
do $$
begin
  begin
    alter publication supabase_realtime add table notes, todos, transactions, stickies;
  exception when duplicate_object then null;
  end;
end $$;

-- Upgrading an existing database: rich-text notes (the Notes editor).
alter table notes add column if not exists html text;
