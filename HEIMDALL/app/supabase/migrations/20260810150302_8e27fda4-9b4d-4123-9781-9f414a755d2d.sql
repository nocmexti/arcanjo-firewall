-- ROLES
CREATE TYPE public.app_role AS ENUM ('admin', 'operator', 'viewer');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.can_write(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','operator'));
$$;

CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_user boolean;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'admin'::public.app_role ELSE 'viewer'::public.app_role END);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- DEVICES
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_unit text NOT NULL,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 443,
  version text,
  environment text NOT NULL DEFAULT 'producao',
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'unknown',
  compliant boolean NOT NULL DEFAULT true,
  notes text,
  api_key_encrypted text,
  last_sync_at timestamptz,
  last_backup_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices read" ON public.devices FOR SELECT TO authenticated USING (true);
CREATE POLICY "devices insert" ON public.devices FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "devices update" ON public.devices FOR UPDATE TO authenticated USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "devices delete" ON public.devices FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER devices_touch BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.device_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  collected_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL DEFAULT 'mock',
  ok boolean NOT NULL DEFAULT true,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX device_snapshots_device_idx ON public.device_snapshots(device_id, collected_at DESC);
GRANT SELECT, INSERT ON public.device_snapshots TO authenticated;
GRANT ALL ON public.device_snapshots TO service_role;
ALTER TABLE public.device_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshots read" ON public.device_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "snapshots insert" ON public.device_snapshots FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));

CREATE TABLE public.baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.baselines TO authenticated;
GRANT ALL ON public.baselines TO service_role;
ALTER TABLE public.baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "baselines read" ON public.baselines FOR SELECT TO authenticated USING (true);
CREATE POLICY "baselines admin write" ON public.baselines FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER baselines_touch BEFORE UPDATE ON public.baselines FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.device_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'success',
  size_bytes integer NOT NULL DEFAULT 0,
  filename text NOT NULL,
  requested_by uuid,
  notes text
);
CREATE INDEX device_backups_device_idx ON public.device_backups(device_id, created_at DESC);
GRANT SELECT, INSERT ON public.device_backups TO authenticated;
GRANT ALL ON public.device_backups TO service_role;
ALTER TABLE public.device_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backups read" ON public.device_backups FOR SELECT TO authenticated USING (true);
CREATE POLICY "backups insert" ON public.device_backups FOR INSERT TO authenticated WITH CHECK (public.can_write(auth.uid()));

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  target_type text,
  target_id text,
  severity text NOT NULL DEFAULT 'info',
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_created_idx ON public.audit_logs(created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read" ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- SEED
INSERT INTO public.baselines (name, description, is_default, rules) VALUES
('Padrão Corporativo 2.7', 'Baseline principal de produção', true,
 '{"min_version":"2.7.2","required_services":["sshd","ntpd","unbound"],"required_aliases":["RFC1918","ADMIN_NETS"],"max_uptime_days":365,"require_ntp":true,"require_dns_resolver":true,"forbid_default_password":true}'::jsonb),
('Laboratório', 'Baseline relaxada para labs', false,
 '{"min_version":"2.7.0","required_services":["sshd"],"required_aliases":[],"max_uptime_days":730,"require_ntp":false,"require_dns_resolver":false,"forbid_default_password":true}'::jsonb);

INSERT INTO public.devices (name, client_unit, host, port, version, environment, tags, status, compliant, notes, last_sync_at, last_backup_at)
SELECT
  'fw-' || lpad(g::text, 3, '0') || '-' || (ARRAY['matriz','filial','dc','loja','cd'])[1 + (g % 5)],
  (ARRAY['Alfa Telecom','Beta Varejo','Gamma Saúde','Delta Log','Epsilon Bank','Zeta Indústria','Omega Educação'])[1 + (g % 7)],
  '10.' || (10 + (g % 40)) || '.' || (g % 250) || '.1',
  (ARRAY[443, 8443, 10443])[1 + (g % 3)],
  (ARRAY['2.7.2','2.7.2','2.7.2','2.7.1','2.7.0','2.6.0','24.03'])[1 + (g % 7)],
  (ARRAY['producao','producao','producao','homologacao','laboratorio'])[1 + (g % 5)],
  CASE (g % 5)
    WHEN 0 THEN ARRAY['core','vpn']
    WHEN 1 THEN ARRAY['borda']
    WHEN 2 THEN ARRAY['filial','vpn']
    WHEN 3 THEN ARRAY['dmz','core']
    ELSE ARRAY['legado']
  END,
  (ARRAY['online','online','online','online','offline','degraded','unknown'])[1 + (g % 7)],
  (g % 3) <> 0,
  CASE WHEN g % 11 = 0 THEN 'Equipamento legado, aguardando substituição.' ELSE NULL END,
  now() - ((g % 72) || ' hours')::interval,
  CASE WHEN g % 8 = 0 THEN NULL ELSE now() - ((g % 30) || ' days')::interval END
FROM generate_series(1, 100) g;

INSERT INTO public.device_backups (device_id, created_at, status, size_bytes, filename)
SELECT d.id, d.last_backup_at, 'success', 180000 + (random()*90000)::int,
       'config-' || d.name || '-' || to_char(d.last_backup_at, 'YYYYMMDD') || '.xml'
FROM public.devices d WHERE d.last_backup_at IS NOT NULL;

INSERT INTO public.audit_logs (actor_email, action, target_type, target_id, severity, details)
VALUES ('system@fleet', 'seed.bootstrap', 'system', 'seed', 'info', '{"devices":100}'::jsonb);