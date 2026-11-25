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
