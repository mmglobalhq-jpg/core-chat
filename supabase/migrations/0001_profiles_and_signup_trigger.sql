-- public.profiles: per-user profile + approval/admin flags, keyed to auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  username text,
  email text,
  is_approved boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS: a signed-in user may read ONLY their own profile (used by the approval
-- gate). Writes come from the security-definer trigger below or the service_role
-- admin client (which bypasses RLS).
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

-- handle_new_user: on signup, copy the signup metadata + email into profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, username, email)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'username',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Seed the administrator (already present in auth.users).
insert into public.profiles (id, first_name, last_name, username, email, is_approved, is_admin)
select id, 'Heath', 'Maxwell', 'MAXHA', email, true, true
from auth.users
where email = 'mmglobal.hq@gmail.com'
on conflict (id) do update
  set first_name = 'Heath', last_name = 'Maxwell', username = 'MAXHA',
      is_approved = true, is_admin = true;
