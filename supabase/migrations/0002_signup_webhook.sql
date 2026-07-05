-- Registration webhook: on a new (unapproved, non-admin) profile, POST the row id
-- to the signup-approval edge function, which re-reads the profile server-side and
-- emails the admin a signed approval link. Only the id is sent, so this is not a
-- trust boundary and embeds no secret.
create extension if not exists pg_net;

create or replace function public.notify_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
begin
  if new.is_approved is not true and new.is_admin is not true then
    perform net.http_post(
      url := 'https://ulzhtdnjwikcadtskzgi.supabase.co/functions/v1/signup-approval',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('record', jsonb_build_object('id', new.id))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_created_notify on public.profiles;
create trigger on_profile_created_notify
  after insert on public.profiles
  for each row execute function public.notify_new_signup();
