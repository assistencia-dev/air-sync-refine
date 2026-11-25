-- DBS CONTROL: cached coordinates derived from the address already registered for each site.
-- These are map coordinates, not customer or technician live GPS coordinates.
alter table public.dbs_control_sites
  add column if not exists map_latitude numeric(10,7),
  add column if not exists map_longitude numeric(10,7),
  add column if not exists map_geocoded_at timestamptz,
  add column if not exists map_geocode_provider text,
  add column if not exists map_geocode_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'dbs_control_sites_map_coordinates_pair_check'
      and conrelid = 'public.dbs_control_sites'::regclass
  ) then
    alter table public.dbs_control_sites
      add constraint dbs_control_sites_map_coordinates_pair_check
      check (
        (map_latitude is null and map_longitude is null)
        or (
          map_latitude is not null
          and map_longitude is not null
          and map_latitude between -90 and 90
          and map_longitude between -180 and 180
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dbs_control_sites_map_geocode_status_check'
      and conrelid = 'public.dbs_control_sites'::regclass
  ) then
    alter table public.dbs_control_sites
      add constraint dbs_control_sites_map_geocode_status_check
      check (map_geocode_status in ('pending', 'resolved', 'review'));
  end if;
end;
$$;

create index if not exists idx_dbs_control_sites_map_coordinates
  on public.dbs_control_sites (map_geocode_status)
  where map_latitude is not null and map_longitude is not null;

comment on column public.dbs_control_sites.map_latitude is
  'Latitude geocodificada do endereço cadastrado; não representa GPS ao vivo.';
comment on column public.dbs_control_sites.map_longitude is
  'Longitude geocodificada do endereço cadastrado; não representa GPS ao vivo.';
comment on column public.dbs_control_sites.map_geocoded_at is
  'Data em que o endereço cadastrado foi geocodificado para exibição no mapa.';
comment on column public.dbs_control_sites.map_geocode_provider is
  'Provedor utilizado para geocodificar o endereço (ex.: Photon/OpenStreetMap).';
comment on column public.dbs_control_sites.map_geocode_status is
  'Situação da geocodificação: pending, resolved ou review.';

-- If the registered address changes, discard the old map point. The next
-- map review will geocode the new address; technician GPS remains separate.
create or replace function public.dbs_control_reset_site_map_coordinates_on_address_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.address_json is distinct from old.address_json then
    new.map_latitude := null;
    new.map_longitude := null;
    new.map_geocoded_at := null;
    new.map_geocode_provider := null;
    new.map_geocode_status := 'pending';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'dbs_control_sites_reset_map_coordinates_on_address_change'
      and tgrelid = 'public.dbs_control_sites'::regclass
      and not tgisinternal
  ) then
    create trigger dbs_control_sites_reset_map_coordinates_on_address_change
      before update of address_json on public.dbs_control_sites
      for each row
      execute function public.dbs_control_reset_site_map_coordinates_on_address_change();
  end if;
end;
$$;
