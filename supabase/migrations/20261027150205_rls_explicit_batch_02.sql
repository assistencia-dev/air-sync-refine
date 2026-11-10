DO $$
DECLARE p record; action_name text; role_sql text; using_sql text; check_sql text; new_policy_name text;
BEGIN
 FOR p IN SELECT schemaname,tablename,policyname,roles,qual,with_check FROM pg_policies
 WHERE schemaname='public' AND cmd='ALL' AND tablename IN ('dbs_control_base_clients', 'dbs_control_bases', 'dbs_control_entity_records', 'dbs_control_external_refs', 'dbs_control_integrations')
 LOOP
  role_sql := (SELECT string_agg(CASE WHEN r::text='public' THEN 'PUBLIC' ELSE format('%I',r::text) END, ', ' ORDER BY r::text) FROM unnest(p.roles) AS role_values(r));
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
  FOREACH action_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   new_policy_name:=left(p.policyname||'_'||lower(action_name),63);
   EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',new_policy_name,p.schemaname,p.tablename);
   using_sql:=coalesce(p.qual,'false'); check_sql:=coalesce(p.with_check,'false');
   IF action_name='SELECT' THEN
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO %s USING (%s)',new_policy_name,p.schemaname,p.tablename,role_sql,using_sql);
   ELSIF action_name='INSERT' THEN
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR INSERT TO %s WITH CHECK (%s)',new_policy_name,p.schemaname,p.tablename,role_sql,check_sql);
   ELSIF action_name='UPDATE' THEN
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR UPDATE TO %s USING (%s) WITH CHECK (%s)',new_policy_name,p.schemaname,p.tablename,role_sql,using_sql,check_sql);
   ELSE
    EXECUTE format('CREATE POLICY %I ON %I.%I FOR DELETE TO %s USING (%s)',new_policy_name,p.schemaname,p.tablename,role_sql,using_sql);
   END IF;
  END LOOP;
 END LOOP;
END $$;