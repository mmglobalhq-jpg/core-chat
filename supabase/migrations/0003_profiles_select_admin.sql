-- Admin read-all. A SECURITY DEFINER helper is used so the policy does NOT query
-- public.profiles directly in its USING clause (a direct self-reference triggers
-- "infinite recursion detected in policy for relation profiles").
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.profiles where id = uid), false);
$$;

-- Permissive SELECT: an admin may read every profile row. Coexists (OR) with
-- profiles_select_own for regular users.
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select using (public.is_admin(auth.uid()));
