-- DBS CONTROL: backfill aditivo do snapshot legado para as tabelas relacionais.
-- A rotina é idempotente, preserva o snapshot como backup de leitura e nunca remove
-- registros; cada chave antiga recebe uma correspondência canônica estável.
begin;

create table if not exists public.dbs_control_legacy_id_map (
  scope_key text not null,
  entity_type text not null check (entity_type in ('client','site','equipment','service','part','work_order')),
  legacy_key text not null,
  canonical_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (scope_key, entity_type, legacy_key)
);

create index if not exists idx_dbs_control_legacy_id_map_canonical
  on public.dbs_control_legacy_id_map(entity_type, canonical_id);

alter table public.dbs_control_legacy_id_map enable row level security;
revoke all on public.dbs_control_legacy_id_map from anon, authenticated;
grant all on public.dbs_control_legacy_id_map to service_role;
drop policy if exists dbs_control_legacy_id_map_service_only on public.dbs_control_legacy_id_map;
create policy dbs_control_legacy_id_map_service_only on public.dbs_control_legacy_id_map
  for all to service_role using (true) with check (true);

do $$
declare
  snap record;
  item jsonb;
  raw_key text;
  raw_ref text;
  canonical_id uuid;
  candidate_id uuid;
  client_id uuid;
  site_id uuid;
  service_id uuid;
  equipment_id uuid;
  part_id uuid;
  technician_id uuid;
  order_id uuid;
  v_protocol text;
  status text;
  created_at_value timestamptz;
  completed_at_value timestamptz;
  signature_path text;
  amount_value numeric;
  quantity_value numeric;
  owner_user_id uuid;
  legacy_payload jsonb;
begin
  for snap in
    select s.scope_key, s.owner_user_id, s.state, s.updated_at
    from public.dbs_control_snapshots s
    where s.state is not null and jsonb_typeof(s.state) = 'object'
  loop
    owner_user_id := snap.owner_user_id;

    -- Clientes: o ID antigo pode ser numérico; o mapa mantém a referência estável.
    for item in select value from jsonb_array_elements(case when jsonb_typeof(snap.state->'clientes') = 'array' then snap.state->'clientes' else '[]'::jsonb end) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      select m.canonical_id into canonical_id
      from public.dbs_control_legacy_id_map m
      where m.scope_key = snap.scope_key and m.entity_type = 'client' and m.legacy_key = raw_key;
      if canonical_id is null then
        candidate_id := case when raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raw_key::uuid else gen_random_uuid() end;
        select c.id into canonical_id from public.dbs_control_clients c where c.id = candidate_id;
        if canonical_id is null then
          select c.id into canonical_id
          from public.dbs_control_clients c
          where nullif(regexp_replace(coalesce(item->>'cnpj', item->>'CNPJ', ''), '\\D', '', 'g'), '') is not null
            and c.cnpj = regexp_replace(coalesce(item->>'cnpj', item->>'CNPJ', ''), '\\D', '', 'g')
          limit 1;
        end if;
        if canonical_id is null then
          insert into public.dbs_control_clients
            (id, legal_name, trade_name, cnpj, phone, email, notes, status, created_at, updated_at)
          values
            (candidate_id,
             coalesce(nullif(btrim(item->>'razaoSocial'), ''), nullif(btrim(item->>'razao_social'), ''), nullif(btrim(item->>'nome'), ''), nullif(btrim(item->>'name'), ''), 'Cliente legado ' || raw_key),
             coalesce(nullif(btrim(item->>'nomeFantasia'), ''), nullif(btrim(item->>'nome_fantasia'), ''), nullif(btrim(item->>'nome'), ''), nullif(btrim(item->>'name'), ''), 'Cliente legado ' || raw_key),
             nullif(regexp_replace(coalesce(item->>'cnpj', item->>'CNPJ', ''), '\\D', '', 'g'), ''),
             nullif(btrim(coalesce(item->>'telefone', item->>'phone', item->>'contato', '')), ''),
             nullif(btrim(coalesce(item->>'email', '')), ''),
             nullif(btrim(coalesce(item->>'observacoes', item->>'notes', item->>'endereco', '')), ''),
             case when lower(coalesce(item->>'status','ativo')) in ('inativo','inactive','baixado') then 'inativo' else 'ativo' end,
             coalesce(snap.updated_at, now()), coalesce(snap.updated_at, now()))
          on conflict (id) do nothing
          returning id into canonical_id;
          if canonical_id is null then
            select c.id into canonical_id from public.dbs_control_clients c where c.id = candidate_id;
          end if;
        end if;
        insert into public.dbs_control_legacy_id_map(scope_key, entity_type, legacy_key, canonical_id)
        values (snap.scope_key, 'client', raw_key, canonical_id)
        on conflict (scope_key, entity_type, legacy_key) do nothing;
      end if;
    end loop;

    -- Locais/sites.
    for item in
      select value from jsonb_array_elements(
        (case when jsonb_typeof(snap.state->'sites') = 'array' then snap.state->'sites' else '[]'::jsonb end)
        || (case when jsonb_typeof(snap.state->'locais') = 'array' then snap.state->'locais' else '[]'::jsonb end)
      )
    loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      select m.canonical_id into site_id from public.dbs_control_legacy_id_map m
      where m.scope_key = snap.scope_key and m.entity_type = 'site' and m.legacy_key = raw_key;
      if site_id is null then
        raw_ref := btrim(coalesce(item->>'clienteId', item->>'client_id', ''));
        select m.canonical_id into client_id from public.dbs_control_legacy_id_map m
        where m.scope_key = snap.scope_key and m.entity_type = 'client' and m.legacy_key = raw_ref;
        if client_id is null and raw_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then client_id := raw_ref::uuid; end if;
        if client_id is null then
          insert into public.dbs_control_clients(legal_name, trade_name, status)
          values ('Cliente legado ' || coalesce(nullif(raw_ref,''), raw_key), 'Cliente legado ' || coalesce(nullif(raw_ref,''), raw_key), 'ativo')
          returning id into client_id;
          insert into public.dbs_control_legacy_id_map(scope_key, entity_type, legacy_key, canonical_id)
          values (snap.scope_key, 'client', coalesce(nullif(raw_ref,''), 'placeholder:'||raw_key), client_id)
          on conflict (scope_key, entity_type, legacy_key) do nothing;
        end if;
        candidate_id := case when raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raw_key::uuid else gen_random_uuid() end;
        insert into public.dbs_control_sites
          (id, client_id, name, address_json, contact_name, contact_phone, contact_email, notes, status, created_at, updated_at)
        values
          (candidate_id, client_id, coalesce(nullif(btrim(item->>'nome'),''), nullif(btrim(item->>'name'),''), 'Local legado '||raw_key),
           jsonb_build_object('texto', coalesce(item->>'endereco','')), nullif(btrim(item->>'contato'),''), nullif(btrim(coalesce(item->>'telefone',item->>'phone','')), ''), nullif(btrim(item->>'email'),''), nullif(btrim(item->>'observacoes'),''), case when lower(coalesce(item->>'status','ativo')) in ('inativo','inactive','baixado') then 'inativo' else 'ativo' end, coalesce(snap.updated_at,now()), coalesce(snap.updated_at,now()))
        on conflict (id) do nothing;
        select s.id into site_id from public.dbs_control_sites s where s.id = candidate_id;
        insert into public.dbs_control_legacy_id_map(scope_key, entity_type, legacy_key, canonical_id)
        values (snap.scope_key, 'site', raw_key, site_id)
        on conflict (scope_key, entity_type, legacy_key) do nothing;
      end if;
    end loop;

    -- Catálogo de serviços.
    for item in select value from jsonb_array_elements(case when jsonb_typeof(snap.state->'servicos') = 'array' then snap.state->'servicos' else '[]'::jsonb end) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      select m.canonical_id into service_id from public.dbs_control_legacy_id_map m
      where m.scope_key = snap.scope_key and m.entity_type = 'service' and m.legacy_key = raw_key;
      if service_id is null then
        candidate_id := case when raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raw_key::uuid else gen_random_uuid() end;
        insert into public.dbs_control_service_catalog(id, name, description, estimated_hours, table_value_cents, status, created_at, updated_at)
        values (candidate_id, coalesce(nullif(btrim(item->>'nome'),''), nullif(btrim(item->>'name'),''), 'Serviço legado '||raw_key), nullif(btrim(coalesce(item->>'descricao',item->>'description','')), ''), nullif(coalesce(item->>'horas',item->>'horasEstimadas',item->>'estimated_hours',''),'')::numeric, round(coalesce(nullif(item->>'valor','')::numeric,0) * 100), case when lower(coalesce(item->>'status','ativo')) in ('inativo','inactive') then 'inativo' else 'ativo' end, coalesce(snap.updated_at,now()), coalesce(snap.updated_at,now()))
        on conflict (id) do nothing;
        select s.id into service_id from public.dbs_control_service_catalog s where s.id = candidate_id;
        insert into public.dbs_control_legacy_id_map(scope_key, entity_type, legacy_key, canonical_id)
        values (snap.scope_key, 'service', raw_key, service_id)
        on conflict (scope_key, entity_type, legacy_key) do nothing;
      end if;
    end loop;

    -- Equipamentos e peças (peças podem estar vazias em bases antigas).
    for item in select value from jsonb_array_elements(case when jsonb_typeof(snap.state->'equipamentos') = 'array' then snap.state->'equipamentos' else '[]'::jsonb end) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      select m.canonical_id into equipment_id from public.dbs_control_legacy_id_map m
      where m.scope_key = snap.scope_key and m.entity_type = 'equipment' and m.legacy_key = raw_key;
      if equipment_id is null then
        raw_ref := btrim(coalesce(item->>'clienteId',item->>'client_id',''));
        select m.canonical_id into client_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='client' and m.legacy_key=raw_ref;
        if client_id is null and raw_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then client_id:=raw_ref::uuid; end if;
        if client_id is null then
          insert into public.dbs_control_clients(legal_name,trade_name,status) values ('Cliente legado '||coalesce(nullif(raw_ref,''),raw_key),'Cliente legado '||coalesce(nullif(raw_ref,''),raw_key),'ativo') returning id into client_id;
          insert into public.dbs_control_legacy_id_map(scope_key,entity_type,legacy_key,canonical_id) values (snap.scope_key,'client',coalesce(nullif(raw_ref,''),'placeholder:'||raw_key),client_id) on conflict do nothing;
        end if;
        raw_ref := btrim(coalesce(item->>'siteId',item->>'localId',item->>'site_id',''));
        select m.canonical_id into site_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='site' and m.legacy_key=raw_ref;
        candidate_id := case when raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raw_key::uuid else gen_random_uuid() end;
        insert into public.dbs_control_equipment(id,client_id,site_id,tag_code,equipment_type,brand,model,serial_number,capacity,environment,status,technical_notes,created_at,updated_at)
        values (candidate_id,client_id,site_id,nullif(btrim(coalesce(item->>'tag',item->>'patrimonio',item->>'codigo','')),''),nullif(btrim(coalesce(item->>'tipo',item->>'equipment_type','')),''),nullif(btrim(coalesce(item->>'marca',item->>'brand','')),''),nullif(btrim(coalesce(item->>'modelo',item->>'model','')),''),nullif(btrim(coalesce(item->>'serie',item->>'numeroSerie',item->>'serial_number','')),''),nullif(btrim(coalesce(item->>'capacidade',item->>'capacity','')),''),nullif(btrim(coalesce(item->>'ambiente',item->>'environment','')),''),case when lower(coalesce(item->>'status','ativo')) in ('inativo','inactive','baixado') then 'baixado' when lower(coalesce(item->>'status','ativo')) in ('baixado','retirado') then 'baixado' else 'ativo' end,nullif(btrim(coalesce(item->>'descricao',item->>'observacoes','')),''),coalesce(snap.updated_at,now()),coalesce(snap.updated_at,now()))
        on conflict (id) do nothing;
        select e.id into equipment_id from public.dbs_control_equipment e where e.id=candidate_id;
        insert into public.dbs_control_legacy_id_map(scope_key,entity_type,legacy_key,canonical_id) values (snap.scope_key,'equipment',raw_key,equipment_id) on conflict do nothing;
      end if;
    end loop;

    -- Catálogo de peças. A tabela relacional é a fonte canônica mesmo quando
    -- o snapshot antigo vinha sem esse campo.
    for item in select value from jsonb_array_elements(case when jsonb_typeof(snap.state->'pecas') = 'array' then snap.state->'pecas' else '[]'::jsonb end) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), nullif(btrim(item->>'sku'), ''), md5(item::text));
      select m.canonical_id into part_id from public.dbs_control_legacy_id_map m
      where m.scope_key=snap.scope_key and m.entity_type='part' and m.legacy_key=raw_key;
      if part_id is null then
        candidate_id := case when raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raw_key::uuid else gen_random_uuid() end;
        insert into public.dbs_control_parts(id,sku,name,description,stock_quantity,cost_cents,sale_cents,status,created_at,updated_at)
        values (candidate_id,
          nullif(btrim(coalesce(item->>'sku',item->>'codigo','')),''),
          coalesce(nullif(btrim(coalesce(item->>'nome',item->>'name','')),''),'Peça legada '||raw_key),
          nullif(btrim(coalesce(item->>'descricao',item->>'description','')),''),
          coalesce(nullif(item->>'estoque','')::numeric,nullif(item->>'stock_quantity','')::numeric,0),
          round(coalesce(nullif(item->>'custo','')::numeric,nullif(item->>'cost','')::numeric,0)*100),
          round(coalesce(nullif(item->>'venda','')::numeric,nullif(item->>'sale','')::numeric,0)*100),
          case when lower(coalesce(item->>'status','ativo')) in ('inativo','inactive') then 'inativo' else 'ativo' end,
          coalesce(snap.updated_at,now()),coalesce(snap.updated_at,now()))
        on conflict (id) do nothing;
        select p.id into part_id from public.dbs_control_parts p where p.id=candidate_id;
        if part_id is null and nullif(btrim(coalesce(item->>'sku',item->>'codigo','')), '') is not null then
          select p.id into part_id from public.dbs_control_parts p where p.sku=btrim(coalesce(item->>'sku',item->>'codigo','')) limit 1;
        end if;
        insert into public.dbs_control_legacy_id_map(scope_key,entity_type,legacy_key,canonical_id)
        values (snap.scope_key,'part',raw_key,part_id) on conflict do nothing;
      end if;
    end loop;

    -- Ordens de serviço: protocolo é a identidade de reconciliação; quando a
    -- versão antiga não tinha protocolo, o ID legado recebe um prefixo estável.
    for item in select value from jsonb_array_elements(
      case when jsonb_typeof(snap.state->'ordens') = 'array' then snap.state->'ordens' else '[]'::jsonb end
    ) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      select m.canonical_id into order_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='work_order' and m.legacy_key=raw_key;
      v_protocol := left(coalesce(nullif(btrim(item->>'protocolo'),''), nullif(btrim(item->>'protocol'),''), nullif(btrim(item->>'numero'),''), 'LEGACY-'||regexp_replace(raw_key,'[^A-Za-z0-9_-]','_','g')), 180);
      select w.id into order_id from public.dbs_control_work_orders w where w.protocol=v_protocol limit 1;
      if order_id is null then
        raw_ref := btrim(coalesce(item->>'clienteId',item->>'client_id',''));
        select m.canonical_id into client_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='client' and m.legacy_key=raw_ref;
        if client_id is null and raw_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then client_id:=raw_ref::uuid; end if;
        if client_id is null then
          insert into public.dbs_control_clients(legal_name,trade_name,status) values ('Cliente legado '||coalesce(nullif(raw_ref,''),raw_key),'Cliente legado '||coalesce(nullif(raw_ref,''),raw_key),'ativo') returning id into client_id;
          insert into public.dbs_control_legacy_id_map(scope_key,entity_type,legacy_key,canonical_id) values (snap.scope_key,'client',coalesce(nullif(raw_ref,''),'placeholder:'||raw_key),client_id) on conflict do nothing;
        end if;
        raw_ref := btrim(coalesce(item->>'servicoId',item->>'service_id',''));
        select m.canonical_id into service_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='service' and m.legacy_key=raw_ref;
        status := case
          when lower(trim(coalesce(item->>'status',''))) in ('concluída','concluida','concluído','concluido','completed','complete') then 'concluida'
          when lower(trim(coalesce(item->>'status',''))) in ('em atendimento','em_atendimento','andamento') then 'em_atendimento'
          when lower(trim(coalesce(item->>'status',''))) in ('aguardando peça','aguardando_peca') then 'aguardando_peca'
          when lower(trim(coalesce(item->>'status',''))) in ('aguardando cliente','aguardando_cliente') then 'aguardando_cliente'
          when lower(trim(coalesce(item->>'status',''))) in ('cancelada','cancelado') then 'cancelada'
          else 'aberta' end;
        raw_ref := btrim(coalesce(item->>'tecnicoId', item->>'employeeId', item->>'assigned_employee_id', ''));
        technician_id := null;
        if raw_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
          select e.id into technician_id from public.rh_employees e where e.id = raw_ref::uuid limit 1;
          if technician_id is null then
            select e.id into technician_id from public.rh_employees e where e.registry_employee_id = raw_ref::uuid limit 1;
          end if;
        end if;
        if technician_id is null and nullif(btrim(coalesce(item->>'tecnicoEmail', '')), '') is not null then
          select e.id into technician_id
          from public.rh_employees e
          where lower(coalesce(e.registration_data->>'email','')) = lower(btrim(item->>'tecnicoEmail'))
          limit 1;
        end if;
        if technician_id is null and nullif(btrim(coalesce(item->>'tecnicoNome', '')), '') is not null then
          select e.id into technician_id
          from public.rh_employees e
          where lower(e.full_name) = lower(btrim(item->>'tecnicoNome'))
          limit 1;
        end if;
        created_at_value := case
          when coalesce(item->>'dataCriacao',item->>'created_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(item->>'dataCriacao',item->>'created_at')::timestamptz
          when coalesce(item->>'data','') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' then to_date(item->>'data','DD/MM/YYYY')::timestamptz
          else coalesce(snap.updated_at,now()) end;
        completed_at_value := case when status='concluida' then case when coalesce(item->>'concluidoEm',item->>'completedAt','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(item->>'concluidoEm',item->>'completedAt')::timestamptz else created_at_value end else null end;
        signature_path := nullif(btrim(coalesce(item->>'assinaturaStoragePath',item->>'assinatura_path',item->>'signature_path','')), '');
        amount_value := case when coalesce(item->>'valor',item->>'total','') <> '' then replace(replace(coalesce(item->>'valor',item->>'total'),'.',''),',','.')::numeric else 0 end;
        candidate_id := case when raw_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then raw_key::uuid else gen_random_uuid() end;
        raw_ref := btrim(coalesce(item->>'siteId', item->>'localId', item->>'site_id', item->>'local_id', ''));
        select m.canonical_id into site_id from public.dbs_control_legacy_id_map m
        where m.scope_key=snap.scope_key and m.entity_type='site' and m.legacy_key=raw_ref;
        perform set_config('app.dbs_control_idempotency_key', 'legacy-backfill:'||snap.scope_key||':order:'||raw_key, true);
        insert into public.dbs_control_work_orders
          (id,protocol,protocolo,client_id,site_id,assigned_employee_id,created_by_user_id,service_id,type,priority,status,scheduled_at,started_at,completed_at,description,technical_opinion,diagnostico,observation,servico_executado,signature_name,signature_data,signature_path,assinatura_path,total_cents,created_at,updated_at,version,idempotency_key,deleted_at)
        values
          (candidate_id,v_protocol,v_protocol,client_id,site_id,technician_id,owner_user_id,service_id,coalesce(nullif(item->>'tipo',''),'corretiva'),coalesce(nullif(item->>'prioridade',''),'normal'),status,null, null, completed_at_value, coalesce(item->>'desc',item->>'description',''),coalesce(item->>'diagnostico',item->>'technical_opinion',''),coalesce(item->>'diagnostico',item->>'technical_opinion',''),coalesce(item->>'observacao',item->>'observation',''),coalesce(item->>'trabalhoExecutado',item->>'servicoExecutado',item->>'observacao',item->>'observation',''),nullif(coalesce(item->>'signature_name',item->>'signatureName',''),''),case when signature_path is null then nullif(item->>'assinatura','') else null end,signature_path,signature_path,round(coalesce(amount_value,0)*100),created_at_value,created_at_value,1,'legacy-backfill:'||snap.scope_key||':order:'||raw_key,case when coalesce(item->>'excluidaEm','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then (item->>'excluidaEm')::timestamptz else null end)
        on conflict (id) do nothing;
        select w.id into order_id from public.dbs_control_work_orders w where w.id=candidate_id;
        if order_id is null then select w.id into order_id from public.dbs_control_work_orders w where w.protocol=v_protocol limit 1; end if;
        insert into public.dbs_control_legacy_id_map(scope_key,entity_type,legacy_key,canonical_id) values (snap.scope_key,'work_order',raw_key,order_id) on conflict do nothing;
        insert into public.dbs_control_work_order_events(work_order_id,actor_user_id,event_type,new_status,details,idempotency_key)
        values (order_id,owner_user_id,'legacy_backfill',status,jsonb_build_object('legacy_scope',snap.scope_key,'legacy_key',raw_key,'source',item),'legacy-backfill:'||snap.scope_key||':event:'||raw_key)
        on conflict do nothing;
      end if;

      for raw_ref in select value #>> '{}' from jsonb_array_elements(case when jsonb_typeof(item->'equipamentosIds')='array' then item->'equipamentosIds' else '[]'::jsonb end) loop
        select m.canonical_id into equipment_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='equipment' and m.legacy_key=raw_ref;
        if equipment_id is null and raw_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then equipment_id:=raw_ref::uuid; end if;
        if equipment_id is not null then insert into public.dbs_control_work_order_equipment(work_order_id,equipment_id) values(order_id,equipment_id) on conflict do nothing; end if;
      end loop;
      raw_ref := btrim(coalesce(item->>'equipamentoId',''));
      if raw_ref <> '' then
        select m.canonical_id into equipment_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='equipment' and m.legacy_key=raw_ref;
        if equipment_id is not null then insert into public.dbs_control_work_order_equipment(work_order_id,equipment_id) values(order_id,equipment_id) on conflict do nothing; end if;
      end if;
      for legacy_payload in select value from jsonb_array_elements(case when jsonb_typeof(item->'pecasUsadas')='array' then item->'pecasUsadas' else '[]'::jsonb end) loop
        raw_ref := btrim(coalesce(legacy_payload->>'id',''));
        select m.canonical_id into part_id from public.dbs_control_legacy_id_map m where m.scope_key=snap.scope_key and m.entity_type='part' and m.legacy_key=raw_ref;
        quantity_value := greatest(coalesce(nullif(legacy_payload->>'qtd','')::numeric, nullif(legacy_payload->>'quantity','')::numeric, 0), 0);
        if part_id is not null and quantity_value > 0 and not exists(select 1 from public.dbs_control_work_order_parts p where p.work_order_id=order_id and p.part_id=part_id) then
          insert into public.dbs_control_work_order_parts(work_order_id,part_id,quantity,unit_cents) values(order_id,part_id,quantity_value,round(coalesce(nullif(legacy_payload->>'venda','')::numeric,0)*100));
        end if;
      end loop;
    end loop;

    -- Compras/orçamentos que não possuem tabela específica ficam em linhas
    -- relacionais individuais, nunca em um JSON global de estado.
    for item in select value from jsonb_array_elements(case when jsonb_typeof(snap.state->'compras') = 'array' then snap.state->'compras' else '[]'::jsonb end) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      insert into public.dbs_control_entity_records(scope_key,entity_type,record_key,payload,version,idempotency_key,updated_by)
      values(snap.scope_key,'compra',raw_key,item,1,'legacy-backfill:'||snap.scope_key||':compra:'||raw_key,owner_user_id)
      on conflict(scope_key,entity_type,record_key) do nothing;
    end loop;
    for item in select value from jsonb_array_elements(case when jsonb_typeof(snap.state->'orcamentos') = 'array' then snap.state->'orcamentos' else '[]'::jsonb end) loop
      raw_key := coalesce(nullif(btrim(item->>'id'), ''), md5(item::text));
      insert into public.dbs_control_entity_records(scope_key,entity_type,record_key,payload,version,idempotency_key,updated_by)
      values(snap.scope_key,'orcamento',raw_key,item,1,'legacy-backfill:'||snap.scope_key||':orcamento:'||raw_key,owner_user_id)
      on conflict(scope_key,entity_type,record_key) do nothing;
    end loop;
  end loop;
end;
$$;

commit;
