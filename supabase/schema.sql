create extension if not exists pgcrypto;

create table if not exists public.recepten (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  titel text not null check (length(trim(titel)) > 0),
  foto text,
  originele_fotos text[] not null default '{}',
  ingredienten text not null,
  bereidingswijze text not null,
  bereidingstijd text,
  bron text,
  aangemaakt_op timestamptz not null default now(),
  positie bigint not null default 0
);

create table if not exists public.maaltijden (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (length(trim(naam)) > 0),
  user_id uuid references auth.users(id) on delete cascade
);
create unique index if not exists maaltijden_basis_naam on public.maaltijden (lower(naam)) where user_id is null;
create unique index if not exists maaltijden_gebruiker_naam on public.maaltijden (user_id, lower(naam)) where user_id is not null;

create table if not exists public.hoofdingredienten (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (length(trim(naam)) > 0),
  user_id uuid references auth.users(id) on delete cascade
);
create unique index if not exists hoofdingredienten_basis_naam on public.hoofdingredienten (lower(naam)) where user_id is null;
create unique index if not exists hoofdingredienten_gebruiker_naam on public.hoofdingredienten (user_id, lower(naam)) where user_id is not null;

create table if not exists public.recept_maaltijden (
  recept_id uuid not null references public.recepten(id) on delete cascade,
  maaltijd_id uuid not null references public.maaltijden(id) on delete cascade,
  primary key (recept_id, maaltijd_id)
);
create table if not exists public.recept_hoofdingredienten (
  recept_id uuid not null references public.recepten(id) on delete cascade,
  hoofdingredient_id uuid not null references public.hoofdingredienten(id) on delete cascade,
  primary key (recept_id, hoofdingredient_id)
);

insert into public.maaltijden (naam) values
  ('Ontbijt'),('Brunch'),('Lunch'),('Aperitief/Hapjes'),('Voorgerecht'),('Hoofdgerecht'),('Bijgerecht'),('Dessert'),('Gebak'),('Snack'),('Soep'),('Salade'),('Saus/Dip'),('Drank')
on conflict do nothing;
insert into public.hoofdingredienten (naam) values
  ('Rund'),('Varken'),('Kip'),('Kalkoen'),('Lam'),('Wild'),('Vis'),('Schaaldieren'),('Zeevruchten'),('Ei'),('Kaas'),('Pasta'),('Rijst'),('Aardappelen'),('Groenten'),('Peulvruchten'),('Tofu/Tempeh')
on conflict do nothing;

alter table public.recepten enable row level security;
alter table public.maaltijden enable row level security;
alter table public.hoofdingredienten enable row level security;
alter table public.recept_maaltijden enable row level security;
alter table public.recept_hoofdingredienten enable row level security;

create policy "Eigen recepten lezen" on public.recepten for select to authenticated using (user_id = (select auth.uid()));
create policy "Eigen recepten toevoegen" on public.recepten for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Eigen recepten wijzigen" on public.recepten for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Eigen recepten verwijderen" on public.recepten for delete to authenticated using (user_id = (select auth.uid()));

create policy "Zichtbare maaltijden" on public.maaltijden for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy "Eigen maaltijden toevoegen" on public.maaltijden for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Zichtbare hoofdingredienten" on public.hoofdingredienten for select to authenticated using (user_id is null or user_id = (select auth.uid()));
create policy "Eigen hoofdingredienten toevoegen" on public.hoofdingredienten for insert to authenticated with check (user_id = (select auth.uid()));

create policy "Eigen receptmaaltijden lezen" on public.recept_maaltijden for select to authenticated using (exists (select 1 from public.recepten r where r.id = recept_id and r.user_id = (select auth.uid())));
create policy "Eigen receptmaaltijden toevoegen" on public.recept_maaltijden for insert to authenticated with check (
  exists (select 1 from public.recepten r where r.id = recept_id and r.user_id = (select auth.uid())) and
  exists (select 1 from public.maaltijden m where m.id = maaltijd_id and (m.user_id is null or m.user_id = (select auth.uid())))
);
create policy "Eigen recepthoofdingredienten lezen" on public.recept_hoofdingredienten for select to authenticated using (exists (select 1 from public.recepten r where r.id = recept_id and r.user_id = (select auth.uid())));
create policy "Eigen recepthoofdingredienten toevoegen" on public.recept_hoofdingredienten for insert to authenticated with check (
  exists (select 1 from public.recepten r where r.id = recept_id and r.user_id = (select auth.uid())) and
  exists (select 1 from public.hoofdingredienten h where h.id = hoofdingredient_id and (h.user_id is null or h.user_id = (select auth.uid())))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receptfotos', 'receptfotos', false, 8000000, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "Eigen foto's uploaden" on storage.objects for insert to authenticated
with check (bucket_id = 'receptfotos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Eigen foto's lezen" on storage.objects for select to authenticated
using (bucket_id = 'receptfotos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Eigen foto's verwijderen" on storage.objects for delete to authenticated
using (bucket_id = 'receptfotos' and (storage.foldername(name))[1] = (select auth.uid()::text));

create or replace function public.wissel_recepten(eerste_id uuid, tweede_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare eerste_positie bigint; tweede_positie bigint;
begin
  select positie into eerste_positie from public.recepten where id = eerste_id and user_id = auth.uid();
  select positie into tweede_positie from public.recepten where id = tweede_id and user_id = auth.uid();
  if eerste_positie is null or tweede_positie is null or eerste_id = tweede_id then
    raise exception 'Ongeldige receptvolgorde';
  end if;
  update public.recepten set positie = case id when eerste_id then tweede_positie else eerste_positie end
  where id in (eerste_id, tweede_id) and user_id = auth.uid();
end $$;
revoke all on function public.wissel_recepten(uuid, uuid) from public;
grant execute on function public.wissel_recepten(uuid, uuid) to authenticated;
