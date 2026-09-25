-- Read-only security snapshot: one JSON value covering every relation,
-- policy, function, sequence, bucket, default privilege, extension and
-- realtime publication an API role could reach. Nothing here writes.
--
-- Run in the Supabase SQL Editor and paste the single cell back. Kept in the
-- repo so the next audit diffs against the same query.

WITH api_roles AS (
  SELECT unnest(ARRAY['anon', 'authenticated']) AS role
),
schemas AS (
  SELECT unnest(ARRAY['public', 'storage', 'graphql_public']) AS nspname
),
rels AS (
  SELECT
    n.nspname AS schema,
    c.relname AS name,
    CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view'
                   WHEN 'm' THEN 'matview' WHEN 'f' THEN 'foreign' ELSE c.relkind::text END AS kind,
    c.relrowsecurity AS rls,
    c.relforcerowsecurity AS rls_forced,
    pg_get_userbyid(c.relowner) AS owner,
    CASE WHEN c.relkind IN ('v', 'm') THEN coalesce(array_to_string(c.reloptions, ','), '') END AS view_options,
    (SELECT jsonb_object_agg(r.role, (
        SELECT coalesce(jsonb_agg(p.priv), '[]'::jsonb) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
         WHERE has_table_privilege(r.role, c.oid, p.priv)))
       FROM api_roles r) AS table_privs,
    (SELECT jsonb_object_agg(r.role, (
        SELECT coalesce(jsonb_agg(DISTINCT a.attname || ':' || p.priv), '[]'::jsonb)
          FROM pg_attribute a, unnest(ARRAY['SELECT','INSERT','UPDATE']) AS p(priv)
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
           AND has_column_privilege(r.role, c.oid, a.attnum, p.priv)
           AND NOT has_table_privilege(r.role, c.oid, p.priv)))
       FROM api_roles r) AS column_only_privs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN schemas s ON s.nspname = n.nspname
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
pols AS (
  SELECT schemaname AS schema, tablename AS name, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname IN (SELECT nspname FROM schemas)
),
funcs AS (
  SELECT
    n.nspname AS schema,
    p.oid::regprocedure::text AS signature,
    pg_get_function_result(p.oid) AS returns,
    l.lanname AS language,
    p.prosecdef AS security_definer,
    coalesce(array_to_string(p.proconfig, ','), '') AS config,
    pg_get_userbyid(p.proowner) AS owner,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec,
    p.prokind AS kind
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname IN ('public', 'graphql_public')
),
seqs AS (
  SELECT n.nspname AS schema, c.relname AS name,
         has_sequence_privilege('anon', c.oid, 'USAGE') AS anon_usage,
         has_sequence_privilege('authenticated', c.oid, 'USAGE') AS authenticated_usage,
         has_sequence_privilege('anon', c.oid, 'UPDATE') AS anon_update,
         has_sequence_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'S' AND n.nspname = 'public'
),
defaults AS (
  SELECT pg_get_userbyid(d.defaclrole) AS for_role,
         coalesce(n.nspname, '(all)') AS schema,
         CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'functions'
                              WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' END AS objects,
         d.defaclacl::text AS acl
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname IS NULL OR n.nspname IN ('public', 'storage')
),
schema_usage AS (
  SELECT n.nspname AS schema,
         has_schema_privilege('anon', n.oid, 'USAGE') AS anon_usage,
         has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_usage,
         has_schema_privilege('anon', n.oid, 'CREATE') AS anon_create,
         has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_create
  FROM pg_namespace n
  WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
)
SELECT jsonb_pretty(jsonb_build_object(
  'taken_at', now(),
  'relations', (SELECT jsonb_agg(to_jsonb(rels) ORDER BY schema, name) FROM rels),
  'policies', (SELECT jsonb_agg(to_jsonb(pols) ORDER BY schema, name, policyname) FROM pols),
  'functions', (SELECT jsonb_agg(to_jsonb(funcs) ORDER BY schema, signature) FROM funcs),
  'sequences', (SELECT jsonb_agg(to_jsonb(seqs) ORDER BY name) FROM seqs),
  'default_privileges', (SELECT jsonb_agg(to_jsonb(defaults)) FROM defaults),
  'schema_usage', (SELECT jsonb_agg(to_jsonb(schema_usage) ORDER BY schema) FROM schema_usage),
  'buckets', (SELECT jsonb_agg(jsonb_build_object('id', id, 'public', public, 'file_size_limit', file_size_limit,
                                                  'allowed_mime_types', allowed_mime_types) ORDER BY id) FROM storage.buckets),
  'extensions', (SELECT jsonb_agg(jsonb_build_object('name', e.extname, 'schema', n.nspname, 'version', e.extversion) ORDER BY e.extname)
                   FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace),
  'realtime_publication', (SELECT jsonb_agg(schemaname || '.' || tablename ORDER BY schemaname, tablename)
                             FROM pg_publication_tables WHERE pubname = 'supabase_realtime')
)) AS security_snapshot;
