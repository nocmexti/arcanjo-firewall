import type {
  BackupResult,
  ConnectionTestResult,
  DeviceConnection,
  PfAlias,
  PfAutomationItem,
  PfDdnsEntry,
  PfGateway,
  PfGatewayGroup,
  PfInterface,
  PfManagementConfig,
  PfNatRule,
  PfRule,
  PfSenseProvider,
  PfSenseSnapshot,
  PfService,
  PfSystemResources,
  PfVpnConnection,
  PfVpnStatus,
} from "./types";
import { createHmac } from "node:crypto";

/**
 * Adapter real para o pacote pfSense REST API:
 * https://github.com/pfrest/pfSense-pkg-RESTAPI
 *
 * Autenticacao por API key no header `X-API-Key` (modo "Key" do pacote).
 * Endpoints usados (v2):
 *   GET /api/v2/status/system
 *   GET /api/v2/status/interfaces
 *   GET /api/v2/routing/gateways
 *   GET /api/v2/firewall/aliases
 *   GET /api/v2/firewall/rules
 *   GET /api/v2/status/services
 *   POST /api/v2/diagnostics/config_history/revision  (backup)
 *
 * Ainda nao e usado em desenvolvimento: o provider e escolhido em
 * `provider.server.ts` pela variavel PFSENSE_PROVIDER.
 */
export class RestApiPfSenseProvider implements PfSenseProvider {
  readonly kind = "restapi" as const;

  private baseUrl(device: DeviceConnection) {
    const host = normalizeHost(device.host);
    assertSafePort(device.port);
    return new URL(`https://${host}:${device.port}`);
  }

  private async request<T>(device: DeviceConnection, path: string, init?: RequestInit): Promise<T> {
    if (!device.apiKey) {
      throw new Error("Dispositivo sem API key configurada.");
    }
    const controller = new AbortController();
    const timeoutMs = Number(process.env["PFSENSE_REQUEST_TIMEOUT_MS"] ?? 15000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = new URL(path, this.baseUrl(device));
      const authHeaders =
        device.authType === "client-token"
          ? { Authorization: `${device.credentialId ?? ""} ${device.apiKey}` }
          : { "X-API-Key": device.apiKey };
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...authHeaders,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} em ${path}`);
      }
      const body = (await res.json()) as { data?: T };
      return (body.data ?? (body as unknown)) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestFirst<T>(device: DeviceConnection, paths: string[]): Promise<T> {
    const errors: string[] = [];
    for (const path of paths) {
      try {
        return await this.request<T>(device, path);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(errors.join("; "));
  }

  private async command<T>(device: DeviceConnection, command: string): Promise<T> {
    const result = await this.request<{ output?: string; result_code?: number }>(
      device,
      "/api/v2/diagnostics/command_prompt",
      { method: "POST", body: JSON.stringify({ command }) },
    );
    if (result.result_code && result.result_code !== 0) {
      throw new Error(`command_prompt exit=${result.result_code}`);
    }
    return JSON.parse(result.output ?? "null") as T;
  }

  private async shell(device: DeviceConnection, command: string): Promise<string> {
    const result = await this.request<{ output?: string; result_code?: number }>(
      device,
      "/api/v2/diagnostics/command_prompt",
      { method: "POST", body: JSON.stringify({ command }) },
    );
    if (result.result_code && result.result_code !== 0) {
      throw new Error(`command_prompt exit=${result.result_code}: ${result.output ?? ""}`);
    }
    return result.output ?? "";
  }

  async testConnection(device: DeviceConnection): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const [system, versionInfo] = await Promise.all([
        this.request<Record<string, unknown>>(device, "/api/v2/status/system"),
        this.request<Record<string, unknown>>(device, "/api/v2/system/version").catch(() => ({})),
      ]);
      const latencyMs = Date.now() - started;
      return {
        ok: true,
        latencyMs,
        version: normalizeVersion(versionInfo) ?? normalizeVersion(system),
        hostname: pickString(system, ["hostname", "name"]),
        message: `Conectado via pfSense REST API em ${latencyMs} ms`,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "Erro desconhecido",
      };
    }
  }

  async fetchSnapshot(device: DeviceConnection): Promise<PfSenseSnapshot> {
    const raw: Record<string, unknown> = {};
    const endpointErrors: Record<string, string> = {};
    const capture = async <T>(key: string, paths: string[], fallback: T): Promise<T> => {
      try {
        const value = await this.requestFirst<T>(device, paths);
        raw[key] = value as unknown;
        return value;
      } catch (error) {
        endpointErrors[key] = error instanceof Error ? error.message : String(error);
        return fallback;
      }
    };
    const captureCommand = async <T>(key: string, command: string, fallback: T): Promise<T> => {
      try {
        const value = await this.command<T>(device, command);
        raw[key] = value as unknown;
        return value;
      } catch (error) {
        endpointErrors[key] = error instanceof Error ? error.message : String(error);
        return fallback;
      }
    };

    const [
      system,
      versionInfo,
      interfaces,
      gateways,
      gatewayGroups,
      aliases,
      rules,
      natPortForward,
      natOutbound,
      services,
      zabbix,
      openvpnStatus,
      wireguardStatus,
      openvpnServers,
      wireguardTunnels,
      ipsecStatus,
      ipsecPhase1s,
      ddns,
      adminAccess,
      cron,
      configDdns,
      configCron,
      configZabbix,
      configVpns,
      configGatewayGroups,
      agentVpnStatus,
    ] = await Promise.all([
      capture<Record<string, unknown>>(
        "system",
        ["/api/v2/status/system"],
        {},
      ),
      capture<Record<string, unknown>>(
        "version",
        ["/api/v2/system/version"],
        {},
      ),
      capture<unknown>("interfaces", ["/api/v2/status/interfaces", "/api/v2/interface"], []),
      capture<unknown>("gateways", ["/api/v2/status/gateways", "/api/v2/routing/gateways"], []),
      capture<unknown>("gateway_groups", [
        "/api/v2/routing/gateway/groups",
        "/api/v2/routing/gateway/group/priorities",
      ], []),
      capture<unknown>("aliases", ["/api/v2/firewall/aliases"], []),
      capture<unknown>("rules", ["/api/v2/firewall/rules"], []),
      capture<unknown>("nat_port_forward", [
        "/api/v2/firewall/nat/port_forwards",
        "/api/v2/firewall/nat/port_forward",
      ], []),
      capture<unknown>("nat_outbound", [
        "/api/v2/firewall/nat/outbound/mappings",
        "/api/v2/firewall/nat/outbound/mode",
      ], []),
      capture<unknown>("services", ["/api/v2/status/services", "/api/v2/service"], []),
      Promise.resolve([]),
      capture<unknown>("openvpn_status", [
        "/api/v2/status/openvpn/servers",
        "/api/v2/status/openvpn/server/connections",
        "/api/v2/status/openvpn/clients",
      ], []),
      capture<unknown>("wireguard_status", [
        "/api/v2/status/wireguard/tunnels",
        "/api/v2/status/wireguard/peers",
      ], []),
      capture<unknown>("openvpn_servers", ["/api/v2/vpn/openvpn/servers"], []),
      capture<unknown>("wireguard_tunnels", ["/api/v2/vpn/wireguard/tunnels"], []),
      capture<unknown>("ipsec_status", [
        "/api/v2/status/ipsec/sas",
        "/api/v2/status/ipsec/child_sas",
        "/api/v2/status/ipsec/child-sas",
      ], []),
      capture<unknown>("ipsec_phase1s", ["/api/v2/vpn/ipsec/phase1s"], []),
      Promise.resolve([]),
      capture<Record<string, unknown>>("admin_access", [
        "/api/v2/firewall/advanced_settings",
      ], {}),
      capture<unknown>("cron", [
        "/api/v2/services/cron/jobs",
      ], []),
      captureCommand<unknown>(
        "config_ddns",
        "php -r '$c=simplexml_load_file(\"/cf/conf/config.xml\");$wan=@file_get_contents(\"https://api.ipify.org\");$o=[];foreach($c->dyndnses->dyndns??[] as $d){$h=(string)$d->host;$ci=(string)$d->cachedip;if(!$ci)$ci=(string)$d->cached_ip;if(!$ci)$ci=(string)$d->cached_ipaddress;if(!$ci)$ci=(string)$d->ipaddress;$o[]=[\"provider\"=>(string)$d->type,\"hostname\"=>$h,\"status\"=>$ci?:\"sem cache\",\"interface\"=>(string)$d->interface,\"resolved_ip\"=>gethostbyname($h),\"outbound_ip\"=>$wan?:\"\"];};echo json_encode($o);'",
        [],
      ),
      captureCommand<unknown>(
        "config_cron",
        "php -r '$c=simplexml_load_file(\"/cf/conf/config.xml\");$o=[];$n=0;foreach($c->cron->item??[] as $i){$cmd=(string)$i->command;if(strpos($cmd,\"rc.update_urltables\")!==false||strpos($cmd,\"bkpmex.sh\")!==false)$o[]=[\"id\"=>$n,\"command\"=>$cmd,\"enabled\"=>((string)$i->enable)!=\"0\",\"minute\"=>(string)$i->minute,\"hour\"=>(string)$i->hour,\"mday\"=>(string)$i->mday,\"month\"=>(string)$i->month,\"wday\"=>(string)$i->wday];$n++;};echo json_encode($o);'",
        [],
      ),
      captureCommand<unknown>(
        "config_zabbix",
        "php -r '$c=file_get_contents(\"/cf/conf/config.xml\");echo json_encode([\"monitor.arcanjofirewall.com.br\"=>strpos($c,\"monitor.arcanjofirewall.com.br\")!==false,\"monitoria.mexcloud.com.br\"=>strpos($c,\"monitoria.mexcloud.com.br\")!==false]);'",
        {},
      ),
      captureCommand<unknown>(
        "config_vpns",
        "php -r '$c=simplexml_load_file(\"/cf/conf/config.xml\");$o=[];foreach($c->xpath(\"/pfsense/openvpn/openvpn-server\")?:[] as $v){$o[]=[\"type\"=>\"openvpn\",\"mode\"=>\"server\",\"id\"=>(string)$v->vpnid,\"name\"=>(string)$v->description,\"status\"=>((string)$v->disable)===\"yes\"?\"disabled\":\"enabled\",\"remote\"=>(string)$v->tunnel_network];}foreach($c->xpath(\"/pfsense/openvpn/openvpn-client\")?:[] as $v){$o[]=[\"type\"=>\"openvpn\",\"mode\"=>\"client\",\"id\"=>(string)$v->vpnid,\"name\"=>(string)$v->description,\"status\"=>((string)$v->disable)===\"yes\"?\"disabled\":\"enabled\",\"remote\"=>(string)$v->server_addr];}foreach($c->xpath(\"/pfsense/ipsec/phase1\")?:[] as $v){$o[]=[\"type\"=>\"ipsec\",\"id\"=>(string)$v->ikeid,\"name\"=>(string)$v->descr,\"status\"=>((string)$v->disabled)===\"yes\"?\"disabled\":\"enabled\",\"remote\"=>(string)$v->remote_gateway];}foreach($c->xpath(\"/pfsense/installedpackages/wireguard/tunnels/item\")?:[] as $v){$o[]=[\"type\"=>\"wireguard\",\"id\"=>(string)$v->tun,\"name\"=>(string)$v->descr,\"status\"=>((string)$v->disabled)===\"yes\"?\"disabled\":\"enabled\",\"remote\"=>(string)$v->addresses];}echo json_encode($o);'",
        [],
      ),
      captureCommand<unknown>(
        "config_gateway_groups",
        "php -r '$c=simplexml_load_file(\"/cf/conf/config.xml\");$o=[];foreach($c->xpath(\"/pfsense/gateways/gateway_group\")?:[] as $g){$name=(string)$g->name;$trigger=(string)$g->trigger;foreach($g->item??[] as $item){$parts=explode(\"|\",(string)$item);$o[]=[\"name\"=>$name,\"gateway\"=>$parts[0]??\"\",\"tier\"=>$parts[1]??\"\",\"trigger\"=>$trigger];}}echo json_encode($o);'",
        [],
      ),
      this.readVpnStatusFromAgent(device).catch((error) => {
        endpointErrors["agent_vpn_status"] = error instanceof Error ? error.message : String(error);
        return null;
      }),
    ]);

    const normalizedVpns = normalizeVpns(
      openvpnStatus,
      wireguardStatus,
      openvpnServers,
      wireguardTunnels,
      ipsecStatus,
      ipsecPhase1s,
      configVpns,
    );
    if (agentVpnStatus) {
      raw["agent_vpn_status"] = agentVpnStatus;
    }
    const agentVpns = isRecord(agentVpnStatus) ? normalizeAgentVpns(agentVpnStatus["vpns"]) : [];
    const agentConnections = isRecord(agentVpnStatus) ? normalizeAgentVpnConnections(agentVpnStatus["vpnConnections"]) : [];

    return {
      version: normalizeVersion(versionInfo) ?? normalizeVersion(system) ?? "unknown",
      hostname: pickString(system, ["hostname", "name"]) ?? device.name,
      uptimeSeconds: pickUptimeSeconds(system),
      resources: normalizeResources(system),
      interfaces: normalizeInterfaces(interfaces),
      gateways: normalizeGateways(gateways),
      gatewayGroups: normalizeGatewayGroups(configGatewayGroups, gateways).length
        ? normalizeGatewayGroups(configGatewayGroups, gateways)
        : normalizeGatewayGroups(gatewayGroups, gateways),
      aliases: normalizeAliases(aliases),
      firewallRules: normalizeRules(rules),
      natRules: [
        ...normalizeNatRules(natPortForward, "port_forward"),
        ...normalizeNatRules(natOutbound, "outbound"),
      ],
      services: normalizeServices(services),
      vpns: mergeVpnStatus(normalizedVpns, agentVpns),
      vpnConnections: agentConnections.length ? agentConnections : normalizeVpnConnections(openvpnStatus, wireguardStatus, ipsecStatus),
      ddns: normalizeDdns(configDdns).length ? normalizeDdns(configDdns) : normalizeDdns(ddns),
      management: normalizeManagement(adminAccess, device.port),
      automation: normalizeAutomation([...arrayFrom(cron), ...arrayFrom(configCron)], services, configZabbix || zabbix),
      collectedAt: new Date().toISOString(),
      raw,
      endpointErrors,
    };
  }

  async requestBackup(device: DeviceConnection): Promise<BackupResult> {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const [revision, content] = await Promise.all([
      this.request<{ filename?: string; size?: number }>(
        device,
        "/api/v2/diagnostics/config_history/revision",
        { method: "POST", body: JSON.stringify({ descr: "heimdall backup" }) },
      ).catch(() => ({})),
      this.readConfigXml(device),
    ]);
    return {
      ok: true,
      filename: revision.filename ?? `config-${device.name}-${stamp}.xml`,
      sizeBytes: content.length || revision.size || 0,
      content,
      message: "Backup completo coletado do config.xml.",
    };
  }

  private async readConfigXml(device: DeviceConnection): Promise<string> {
    if (device.agentSecret) {
      try {
        return await this.readConfigXmlFromAgent(device);
      } catch {
        // Mantem fallback pela REST API para equipamentos ainda sem agente atualizado.
      }
    }

    const meta = await this.command<{ len: number }>(
      device,
      "php -r '$b=base64_encode(file_get_contents(\"/cf/conf/config.xml\"));echo json_encode([\"len\"=>strlen($b)]);'",
    );
    const total = Number(meta.len);
    if (!Number.isFinite(total) || total <= 0) throw new Error("config.xml vazio ou inacessivel.");

    const step = 700;
    let encoded = "";
    for (let offset = 0; offset < total; offset += step) {
      const chunk = await this.command<{ chunk: string }>(
        device,
        `php -r '$b=base64_encode(file_get_contents("/cf/conf/config.xml"));echo json_encode(["chunk"=>substr($b,${offset},${step})]);'`,
      );
      encoded += chunk.chunk ?? "";
    }
    return decodeBase64(encoded);
  }

  private async readConfigXmlFromAgent(device: DeviceConnection): Promise<string> {
    if (!device.agentSecret) {
      throw new Error("Agente sem segredo configurado.");
    }
    const controller = new AbortController();
    const timeoutMs = Number(process.env["PFSENSE_REQUEST_TIMEOUT_MS"] ?? 15000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = createHmac("sha256", device.agentSecret).update("config.xml").digest("hex");
      const url = new URL("/fleet-guardian-agent.php?action=config", this.baseUrl(device));
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/xml,text/xml,*/*",
          "X-Fleet-Agent-Token": token,
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} no agente de backup`);
      }
      const content = await res.text();
      if (!content.trim().startsWith("<?xml") && !content.includes("<pfsense>")) {
        throw new Error("Resposta do agente nao parece config.xml.");
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readVpnStatusFromAgent(device: DeviceConnection): Promise<unknown> {
    if (!device.agentSecret) {
      throw new Error("Agente sem segredo configurado.");
    }
    const controller = new AbortController();
    const timeoutMs = Number(process.env["PFSENSE_REQUEST_TIMEOUT_MS"] ?? 15000);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = createHmac("sha256", device.agentSecret).update("vpn-status").digest("hex");
      const url = new URL("/fleet-guardian-agent.php?action=vpn-status", this.baseUrl(device));
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-Fleet-Agent-Token": token,
        },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} no agente de VPN`);
      }
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async disableFirewallRule(device: DeviceConnection, id: string): Promise<void> {
    await this.setFirewallRuleEnabled(device, id, false);
  }

  async setFirewallRuleEnabled(device: DeviceConnection, id: string, enabled: boolean): Promise<void> {
    await this.request(device, "/api/v2/firewall/rule", {
      method: "PATCH",
      body: JSON.stringify({ id: Number(id), disabled: !enabled }),
    });
  }

  async killOpenVpnConnection(device: DeviceConnection, parentId: string, id: string): Promise<void> {
    const qs = new URLSearchParams({ parent_id: parentId, id });
    await this.request(device, `/api/v2/status/openvpn/server/connection?${qs.toString()}`, {
      method: "DELETE",
    });
  }

  async restartVpn(device: DeviceConnection, type: "openvpn" | "wireguard" | "ipsec", id?: string): Promise<void> {
    const commands = {
      openvpn:
        "service openvpn restart 2>&1 || /usr/local/sbin/pfSsh.php playback svc restart openvpn 2>&1 || true",
      wireguard:
        "configctl wireguard restart 2>&1 || service wireguard restart 2>&1 || true",
      ipsec:
        "ipsec restart 2>&1 || swanctl --reload-all 2>&1 || /usr/local/sbin/pfSsh.php playback svc restart ipsec 2>&1 || true",
    };
    await this.shell(device, commands[type]);
    void id;
  }
}

function arrayFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) {
    for (const key of [
      "items",
      "data",
      "rows",
      "interfaces",
      "gateways",
      "aliases",
      "rules",
      "services",
      "clients",
      "servers",
      "instances",
      "tunnels",
      "peers",
      "connections",
      "child-sas",
      "child_sas",
      "sas",
      "jobs",
      "cron",
      "dyndns",
      "dynamic_dns",
    ]) {
      const nested = value[key];
      if (Array.isArray(nested)) return nested.filter(isRecord);
    }
    return Object.values(value).filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      const first = value.find((entry) => typeof entry === "string" || typeof entry === "number");
      if (typeof first === "string" && first.trim()) return first;
      if (typeof first === "number") return String(first);
    }
  }
  return undefined;
}

function pickNumber(obj: unknown, keys: string[]): number | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function pickBoolean(obj: unknown, keys: string[]): boolean | undefined {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "enabled", "running", "up", "active", "online"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "disabled", "stopped", "down", "inactive", "offline"].includes(normalized)) {
        return false;
      }
    }
  }
  return undefined;
}

function normalizeVersion(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    const version = pickString(source, ["version", "base_version", "pkg_version", "base"]);
    if (version) return version;
  }
  return undefined;
}

function pickUptimeSeconds(system: unknown): number {
  const numeric = pickNumber(system, ["uptime_seconds", "uptime_sec", "uptimeSeconds"]);
  if (numeric !== undefined) return numeric;

  const uptime = pickString(system, ["uptime"]);
  if (!uptime) return 0;
  const parsedNumber = Number(uptime);
  if (Number.isFinite(parsedNumber)) return parsedNumber;

  const units: Record<string, number> = {
    day: 86400,
    days: 86400,
    dia: 86400,
    dias: 86400,
    hour: 3600,
    hours: 3600,
    hora: 3600,
    horas: 3600,
    minute: 60,
    minutes: 60,
    minuto: 60,
    minutos: 60,
    second: 1,
    seconds: 1,
    segundo: 1,
    segundos: 1,
  };

  let total = 0;
  for (const match of uptime.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) {
    total += Number(match[1]) * (units[match[2]] ?? 0);
  }
  return Number.isFinite(total) ? total : 0;
}

function normalizeResources(system: unknown): PfSystemResources {
  return {
    cpuUsagePct: pickNumber(system, ["cpu_usage", "cpuUsage", "cpu", "load_average"]) ?? null,
    memoryUsagePct:
      pickNumber(system, ["memory_usage", "memoryUsage", "mem_usage", "memory_used_percent"]) ??
      percentageFromUsedTotal(system, ["memory_used", "mem_used"], ["memory_total", "mem_total"]),
    diskUsagePct:
      pickNumber(system, ["disk_usage", "diskUsage", "disk_used_percent"]) ??
      percentageFromUsedTotal(system, ["disk_used"], ["disk_total"]),
  };
}

function percentageFromUsedTotal(obj: unknown, usedKeys: string[], totalKeys: string[]): number | null {
  const used = pickNumber(obj, usedKeys);
  const total = pickNumber(obj, totalKeys);
  if (used === undefined || total === undefined || total <= 0) return null;
  return Math.round((used / total) * 1000) / 10;
}

function normalizeInterfaces(value: unknown): PfInterface[] {
  return arrayFrom(value).map((item) => ({
    name: pickString(item, ["name", "id", "if", "interface"]) ?? "unknown",
    descr: pickString(item, ["descr", "description", "name"]) ?? "unknown",
    ipaddr: pickString(item, ["ipaddr", "ip", "address", "ipv4_address"]) ?? "-",
    subnet: pickString(item, ["subnet", "subnet_bits", "cidr", "netmask", "mask"]) ?? "-",
    gateway: pickString(item, ["gateway", "gateway_ip", "gw", "gatewayv4"]) ?? "-",
    status: normalizeUpDown(pickString(item, ["status", "link_state", "up"])),
  }));
}

function normalizeGateways(value: unknown): PfGateway[] {
  return arrayFrom(value).map((item) => ({
    name: pickString(item, ["name", "gateway", "descr"]) ?? "unknown",
    gateway: pickString(item, ["gateway", "ipaddr", "address", "gateway_ip"]) ?? "-",
    monitor: pickString(item, ["monitor", "monitorip", "monitor_ip"]) ?? "-",
    status: normalizeGatewayStatus(pickString(item, ["status", "state"])),
    delayMs: pickNumber(item, ["delayMs", "delay", "latency", "rtt"]) ?? 0,
    lossPct: pickNumber(item, ["lossPct", "loss", "packetloss", "packet_loss"]) ?? 0,
  }));
}

function normalizeGatewayGroups(value: unknown, gateways: unknown): PfGatewayGroup[] {
  const gatewayByName = new Map(
    arrayFrom(gateways).map((gateway) => [
      pickString(gateway, ["name", "gateway", "descr"]) ?? "",
      pickString(gateway, ["interface", "if", "friendlyiface", "friendly_if"]) ?? "-",
    ]),
  );

  const rows: PfGatewayGroup[] = [];
  for (const group of arrayFrom(value)) {
    const groupName = pickString(group, ["name", "descr", "description"]) ?? "unknown";
    const trigger = pickString(group, ["trigger", "trigger_level", "attribute"]) ?? "-";
    const members = group["members"] ?? group["gateways"] ?? group["items"] ?? group["gw"];
    const memberRows = Array.isArray(members) ? members.filter(isRecord) : [];

    if (memberRows.length === 0) {
      const gateway = pickString(group, ["gateway", "name", "gw"]) ?? "unknown";
      rows.push({
        name: groupName,
        gateway,
        interface: pickString(group, ["interface", "if", "friendlyiface"]) ?? gatewayByName.get(gateway) ?? "-",
        tier: pickString(group, ["tier", "priority"]) ?? "-",
        trigger,
      });
      continue;
    }

    for (const member of memberRows) {
      const gateway = pickString(member, ["gateway", "name", "gw"]) ?? "unknown";
      rows.push({
        name: groupName,
        gateway,
        interface: pickString(member, ["interface", "if", "friendlyiface"]) ?? gatewayByName.get(gateway) ?? "-",
        tier: pickString(member, ["tier", "priority"]) ?? "-",
        trigger,
      });
    }
  }
  return rows;
}

function normalizeAliases(value: unknown): PfAlias[] {
  return arrayFrom(value).map((item) => {
    const entries = item["entries"] ?? item["address"] ?? item["detail"] ?? item["network"];
    const values = splitEntries(entries);
    return {
      name: pickString(item, ["name"]) ?? "unknown",
      type: pickString(item, ["type"]) ?? "unknown",
      entries: values.length,
      values,
    };
  });
}

function normalizeRules(value: unknown): PfRule[] {
  return arrayFrom(value).map((item) => ({
    id: pickString(item, ["id", "tracker", "uuid"]),
    interface: endpointLabel(item["interface"] ?? item["interfaces"] ?? item["if"] ?? item["floating"]) ?? "unknown",
    action: normalizeAction(pickString(item, ["action", "type"])),
    protocol: pickString(item, ["protocol", "proto"]) ?? "any",
    sourcePort: portLabel(
      item["source_port"] ??
        item["src_port"] ??
        item["sourceport"] ??
        item["srcport"] ??
        (isRecord(item["source"]) ? item["source"]["port"] : undefined),
    ),
    destinationPort: portLabel(
      item["destination_port"] ??
        item["dst_port"] ??
        item["destinationport"] ??
        item["dstport"] ??
        item["local_port"] ??
        item["port"] ??
        (isRecord(item["destination"]) ? item["destination"]["port"] : undefined),
    ),
    source: endpointLabel(item["source"]) ?? "any",
    destination: endpointLabel(item["destination"]) ?? "any",
    descr: pickString(item, ["descr", "description"]) ?? "-",
    disabled: pickBoolean(item, ["disabled", "disable"]) === true,
  }));
}

function normalizeNatRules(value: unknown, type: PfNatRule["type"]): PfNatRule[] {
  return arrayFrom(value).map((item) => ({
    type,
    interface: endpointLabel(item["interface"] ?? item["interfaces"] ?? item["if"]) ?? "unknown",
    protocol: pickString(item, ["protocol", "proto"]) ?? "any",
    source: endpointLabel(item["source"] ?? item["source_address"] ?? item["src"]) ?? "any",
    destination: endpointLabel(item["destination"] ?? item["destination_address"] ?? item["dst"]) ?? "any",
    target:
      endpointLabel(item["target"] ?? item["target_address"] ?? item["local_port"] ?? item["natport"] ?? item["poolopts"]) ??
      "unknown",
    descr: pickString(item, ["descr", "description"]) ?? "-",
  }));
}

function normalizeServices(value: unknown): PfService[] {
  return arrayFrom(value).map((item) => {
    const running =
      pickBoolean(item, ["status", "state", "running"]) ??
      normalizeRunning(pickString(item, ["status", "state", "running"]));
    const enabled = normalizeEnabled(item["enabled"] ?? item["enable"]);
    return {
      name: pickString(item, ["name", "service"]) ?? "unknown",
      status: running ? "running" : "stopped",
      enabled,
    };
  });
}

function normalizeVpns(
  openvpnStatus: unknown,
  wireguardStatus: unknown,
  openvpnServers: unknown,
  wireguardTunnels: unknown,
  ipsecStatus: unknown,
  ipsecPhase1s: unknown,
  configVpns: unknown,
): PfVpnStatus[] {
  const configured = arrayFrom(configVpns);
  const openvpn = [...configured.filter((item) => item["type"] === "openvpn"), ...arrayFrom(openvpnServers), ...arrayFrom(openvpnStatus)].map((item) => {
    const rawId = pickString(item, ["id", "vpnid", "instance_id"]);
    const mode = pickString(item, ["mode"]);
    const id = rawId && /^\d+$/.test(rawId) && mode === "server" ? `ovpns${rawId}` : rawId && /^\d+$/.test(rawId) && mode === "client" ? `ovpnc${rawId}` : rawId;
    return {
      type: "openvpn" as const,
      id,
      name: pickString(item, ["description", "descr", "name", "server", "common_name"]) ?? "OpenVPN",
      status: normalizeVpnStatus(item),
      remote: endpointLabel(item["remote"] ?? item["remote_host"] ?? item["virtual_addr"] ?? item["tunnel_network"]) ?? "-",
    };
  });
  const wireguard = [...configured.filter((item) => item["type"] === "wireguard"), ...arrayFrom(wireguardTunnels), ...arrayFrom(wireguardStatus)].map((item) => ({
    type: "wireguard" as const,
    id: pickString(item, ["id", "tun", "tunnel_id"]),
    name: pickString(item, ["description", "descr", "name", "tunnel", "interface"]) ?? "WireGuard",
    status: normalizeVpnStatus(item),
    remote: endpointLabel(item["endpoint"] ?? item["remote"] ?? item["address"] ?? item["allowedips"]) ?? "-",
  }));
  const ipsecRuntime = arrayFrom(ipsecStatus);
  const ipsec = [...configured.filter((item) => item["type"] === "ipsec"), ...arrayFrom(ipsecPhase1s)].map((item) => {
    const remote = endpointLabel(item["remote"] ?? item["remote_gateway"] ?? item["remote_host"] ?? item["peer"]) ?? "-";
    const runtime = ipsecRuntime.find((status) => {
      const statusText = JSON.stringify(status).toLowerCase();
      return remote !== "-" && statusText.includes(remote.toLowerCase());
    });
    return {
      type: "ipsec" as const,
      id: pickString(item, ["id", "ikeid", "uniqueid", "reqid"]),
      name: pickString(item, ["description", "descr", "name", "remoteid", "child_name"]) ?? "IPsec",
      status: runtime ? normalizeVpnStatus(runtime) : normalizeVpnStatus(item),
      remote,
    };
  });
  return uniqueRows([...openvpn, ...wireguard, ...ipsec], (item) => `${item.type}:${item.id ?? item.name}:${item.remote}`);
}

function normalizeVpnConnections(openvpnStatus: unknown, wireguardStatus: unknown, ipsecStatus: unknown): PfVpnConnection[] {
  const openvpn = arrayFrom(openvpnStatus)
    .filter((item) =>
      Boolean(
        pickString(item, ["common_name", "commonName", "user", "username"]) ??
          pickString(item, ["real_address", "realAddress", "remote_host", "remote"]),
      ),
    )
    .map((item, index) => {
      const parentId = pickString(item, ["parent_id", "server_id", "server", "vpnid", "instance_id"]) ?? "0";
      const id =
        pickString(item, ["id", "connection_id", "conid", "common_name", "commonName"]) ??
        `${parentId}:${index}`;
      return {
        type: "openvpn" as const,
        id,
        parentId,
        instance: pickString(item, ["service", "server", "instance", "description", "descr"]) ?? parentId,
        user: pickString(item, ["common_name", "commonName", "user", "username", "name"]) ?? "unknown",
        realAddress: pickString(item, ["real_address", "realAddress", "remote_host", "remote"]) ?? "-",
        virtualAddress: pickString(item, ["virtual_address", "virtualAddress", "virtual_addr", "vpn_address"]) ?? "-",
        connectedAt: pickString(item, ["connected_since", "last_change", "lastChange", "since"]) ?? "-",
        bytesSent: pickString(item, ["bytes_sent", "bytesSent", "sent"]) ?? "-",
        bytesReceived: pickString(item, ["bytes_received", "bytesReceived", "received"]) ?? "-",
        cipher: pickString(item, ["cipher"]) ?? "-",
      };
    });
  const wireguard = arrayFrom(wireguardStatus)
    .filter((item) => Boolean(pickString(item, ["peer", "name", "endpoint"])))
    .map((item, index) => ({
      type: "wireguard" as const,
      id: pickString(item, ["id", "peer", "public_key"]) ?? `wg:${index}`,
      parentId: pickString(item, ["tunnel", "parent_id", "interface"]) ?? "0",
      instance: pickString(item, ["tunnel", "interface", "name"]) ?? "WireGuard",
      user: pickString(item, ["peer", "name", "description"]) ?? "peer",
      realAddress: pickString(item, ["endpoint", "remote"]) ?? "-",
      virtualAddress: endpointLabel(item["allowedips"] ?? item["allowed_ips"] ?? item["address"]) ?? "-",
      connectedAt: pickString(item, ["latest_handshake", "last_handshake"]) ?? "-",
      bytesSent: pickString(item, ["transfer_tx", "bytes_sent"]) ?? "-",
      bytesReceived: pickString(item, ["transfer_rx", "bytes_received"]) ?? "-",
      cipher: "-",
    }));
  const ipsec = arrayFrom(ipsecStatus)
    .filter((item) => Boolean(pickString(item, ["name", "uniqueid", "remote-host", "remote_host", "remote"])))
    .map((item, index) => ({
      type: "ipsec" as const,
      id: pickString(item, ["id", "uniqueid", "reqid", "name"]) ?? `ipsec:${index}`,
      parentId: pickString(item, ["ikeid", "parent_id", "uniqueid"]) ?? "0",
      instance: pickString(item, ["name", "descr", "description"]) ?? "IPsec",
      user: pickString(item, ["remote-id", "remote_id", "remoteid", "peer"]) ?? "peer",
      realAddress: pickString(item, ["remote-host", "remote_host", "remote", "peer"]) ?? "-",
      virtualAddress: endpointLabel(item["remote-ts"] ?? item["remote_ts"] ?? item["child-sas"] ?? item["child_sas"]) ?? "-",
      connectedAt: pickString(item, ["established", "connected_since", "since", "last_change"]) ?? "-",
      bytesSent: pickString(item, ["bytes_out", "bytes-sent", "bytes_sent"]) ?? "-",
      bytesReceived: pickString(item, ["bytes_in", "bytes-received", "bytes_received"]) ?? "-",
      cipher: pickString(item, ["encr-alg", "encr_alg", "cipher"]) ?? "-",
    }));
  return uniqueRows([...openvpn, ...wireguard, ...ipsec], (item) => `${item.type}:${item.parentId}:${item.id}:${item.user}`);
}

function normalizeAgentVpns(value: unknown): PfVpnStatus[] {
  return arrayFrom(value)
    .map((item) => {
      const type = pickString(item, ["type"]);
      if (type !== "openvpn" && type !== "wireguard" && type !== "ipsec") return null;
      return {
        type,
        id: pickString(item, ["id"]),
        name: compactVpnName(pickString(item, ["name", "description", "descr"]) ?? type),
        status: normalizeAgentVpnStatus(pickString(item, ["status"]) ?? "offline"),
        remote: endpointLabel(item["remote"] ?? item["endpoint"] ?? item["address"]) ?? "-",
        detail: pickString(item, ["detail"]),
        virtualAddress: pickString(item, ["virtualAddress", "virtual_address"]),
        lastChange: pickString(item, ["lastChange", "last_change"]),
        bytesSent: pickString(item, ["bytesSent", "bytes_sent"]),
        bytesReceived: pickString(item, ["bytesReceived", "bytes_received"]),
        peers: pickNumber(item, ["peers"]),
        listenPort: pickString(item, ["listenPort", "listen_port"]),
      };
    })
    .filter((item): item is PfVpnStatus => Boolean(item));
}

function normalizeAgentVpnConnections(value: unknown): PfVpnConnection[] {
  return arrayFrom(value)
    .filter((item) => pickString(item, ["type"]) !== "ipsec")
    .map((item, index) => ({
      type: pickString(item, ["type"]) === "wireguard" ? "wireguard" as const : "openvpn" as const,
      id: pickString(item, ["id"]) ?? `agent:${index}`,
      parentId: pickString(item, ["parentId", "parent_id", "instance"]) ?? "agent",
      instance: pickString(item, ["instance"]) ?? "-",
      user: pickString(item, ["user", "common_name", "name"]) ?? "-",
      realAddress: pickString(item, ["realAddress", "real_address"]) ?? "-",
      virtualAddress: pickString(item, ["virtualAddress", "virtual_address"]) ?? "-",
      connectedAt: pickString(item, ["connectedAt", "connected_at"]) ?? "-",
      bytesSent: pickString(item, ["bytesSent", "bytes_sent"]) ?? "-",
      bytesReceived: pickString(item, ["bytesReceived", "bytes_received"]) ?? "-",
      cipher: pickString(item, ["cipher"]) ?? "-",
    }));
}

function mergeVpnStatus(primary: PfVpnStatus[], agentRows: PfVpnStatus[]): PfVpnStatus[] {
  const byKey = new Map<string, PfVpnStatus>();
  for (const item of primary) {
    mergeVpnRow(byKey, { ...item, name: compactVpnName(item.name), status: normalizeAgentVpnStatus(item.status) });
  }
  for (const item of agentRows) {
    mergeVpnRow(byKey, item);
  }
  return [...byKey.values()].sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
}

function mergeVpnRow(rows: Map<string, PfVpnStatus>, incoming: PfVpnStatus) {
  const key = findCompatibleVpnKey(rows, incoming) ?? vpnKey(incoming);
  const existing = rows.get(key);
  if (!existing) {
    rows.set(key, incoming);
    return;
  }
  const merged = mergeVpnFields(existing, incoming);
  if (vpnStatusPriority(incoming.status) >= vpnStatusPriority(existing.status)) {
    rows.set(key, { ...merged, status: incoming.status });
  } else {
    rows.set(key, { ...merged, status: existing.status });
  }
}

function vpnKey(item: PfVpnStatus) {
  const id = item.id ? normalizeVpnId(item.type, item.id) : "";
  if (id) return `${item.type}:id:${id}`;
  const name = normalizeVpnNameForKey(compactVpnName(item.name));
  return `${item.type}:${name}:${item.remote}`;
}

function findCompatibleVpnKey(rows: Map<string, PfVpnStatus>, incoming: PfVpnStatus) {
  for (const [key, existing] of rows.entries()) {
    if (sameVpnTunnel(existing, incoming)) return key;
  }
  return null;
}

function sameVpnTunnel(a: PfVpnStatus, b: PfVpnStatus) {
  if (a.type !== b.type) return false;
  const aId = a.id ? normalizeVpnId(a.type, a.id) : "";
  const bId = b.id ? normalizeVpnId(b.type, b.id) : "";
  if (aId && bId && aId === bId) return true;
  const aName = normalizeVpnNameForKey(compactVpnName(a.name));
  const bName = normalizeVpnNameForKey(compactVpnName(b.name));
  if (!aName || !bName || aName !== bName) return false;
  const aRemote = normalizeEndpointForKey(a.remote);
  const bRemote = normalizeEndpointForKey(b.remote);
  return aRemote === bRemote || aRemote === "-" || bRemote === "-";
}

function mergeVpnFields(existing: PfVpnStatus, incoming: PfVpnStatus): PfVpnStatus {
  return {
    ...existing,
    ...incoming,
    id: preferValue(incoming.id, existing.id),
    name: preferValue(incoming.name, existing.name) ?? incoming.name,
    remote: preferValue(incoming.remote, existing.remote) ?? "-",
    detail: preferValue(incoming.detail, existing.detail),
    virtualAddress: preferValue(incoming.virtualAddress, existing.virtualAddress),
    lastChange: preferValue(incoming.lastChange, existing.lastChange),
    bytesSent: preferValue(incoming.bytesSent, existing.bytesSent),
    bytesReceived: preferValue(incoming.bytesReceived, existing.bytesReceived),
    peers: incoming.peers ?? existing.peers,
    listenPort: preferValue(incoming.listenPort, existing.listenPort),
  };
}

function preferValue<T extends string | undefined>(first: T, second: T): T | undefined {
  const clean = (value: string | undefined) => value && value !== "-" && value !== "unknown" ? value : undefined;
  return (clean(first) ?? clean(second) ?? first ?? second) as T | undefined;
}

function normalizeVpnId(type: PfVpnStatus["type"], id: string) {
  const raw = id.toLowerCase().trim();
  if (!raw) return "";
  if (type === "openvpn") {
    const server = raw.match(/(?:ovpns|server|openvpn_server)(\d+)/);
    if (server?.[1]) return `server:${server[1]}`;
    const client = raw.match(/(?:ovpnc|client|openvpn_client)(\d+)/);
    if (client?.[1]) return `client:${client[1]}`;
  }
  return raw;
}

function normalizeVpnNameForKey(value: string) {
  return value
    .replace(/\s+(udp|tcp)[46]?:\d+$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeEndpointForKey(value: string) {
  return (value || "-").trim().toLowerCase();
}

function vpnStatusPriority(status: string) {
  const value = normalizeAgentVpnStatus(status);
  if (value === "online") return 4;
  if (value === "stale") return 3;
  if (value === "offline") return 2;
  if (value === "disabled") return 1;
  return 0;
}

function compactVpnName(value: string) {
  return value
    .replace(/^VPN_(SITE_TO_SITE|SITE2CLIENTE|CLIENT_TO_SITE|SITE_TO_CLIENTE)_?/i, "")
    .replace(/^VPN_/i, "")
    .replace(/_DATACENTER$/i, "")
    .replace(/_/g, " ")
    .trim()
    .slice(0, 42) || value;
}

function normalizeAgentVpnStatus(value: string) {
  const raw = value.toLowerCase();
  if (/online|connected|established|active|running|up/.test(raw)) return "online";
  if (/stale|antigo|expired/.test(raw)) return "stale";
  if (/disabled/.test(raw)) return "disabled";
  if (/offline|down|failed|stopped|error/.test(raw)) return "offline";
  return "offline";
}

function normalizeDdns(value: unknown): PfDdnsEntry[] {
  return arrayFrom(value).map((item) => ({
    provider: pickString(item, ["provider", "type", "service", "name"]) ?? "unknown",
    hostname: pickString(item, ["hostname", "host", "fqdn", "domain"]) ?? "unknown",
    status: pickString(item, ["status", "state", "cached_ip", "cachedip", "ip", "result"]) ?? statusFromEnabled(item),
    interface: endpointLabel(item["interface"] ?? item["if"]) ?? "unknown",
    resolvedIp: pickString(item, ["resolved_ip", "resolvedIp", "dns_ip"]),
    outboundIp: pickString(item, ["outbound_ip", "outboundIp", "wan_ip"]),
  }));
}

function normalizeManagement(value: unknown, apiPort: number): PfManagementConfig {
  return {
    webguiPort: pickNumber(value, ["webgui_port", "webguiport", "port", "webConfiguratorPort"]) ?? apiPort,
    sshEnabled: pickBoolean(value, ["sshd_enable", "ssh_enable", "sshd", "ssh"]) ?? null,
    sshPort: pickNumber(value, ["ssh_port", "sshport", "sshd_port"]) ?? null,
    apiPort,
  };
}

function normalizeAutomation(cron: unknown, services: unknown, zabbix: unknown): PfAutomationItem[] {
  const cronItems = arrayFrom(cron).flatMap((item) => {
    const command = pickString(item, ["command", "cmd", "shellcmd", "script"]) ?? endpointLabel(item) ?? "-";
    const normalized = command.replace(/\s+/g, " ").trim();
    const isAliasUpdate = normalized.includes("/usr/bin/nice -n20 /etc/rc.update_urltables");
    const isBackupScript = normalized.includes("/cf/conf/backup/bkp/script/bkpmex.sh");
    if (!isAliasUpdate && !isBackupScript) return [];
    return {
      id: pickString(item, ["id"]),
      name: isAliasUpdate ? "Atualizacao urltables" : "Backup MEX",
      type: "cron" as const,
      status: pickBoolean(item, ["enabled", "enable"]) === false ? "disabled" : "enabled",
      command,
      schedule: cronSchedule(item),
    };
  });
  const zabbixRows = [...arrayFrom(services), ...arrayFrom(zabbix)];
  const monitoring = zabbixRows
    .filter((item) => /zabbix/i.test(pickString(item, ["name", "service", "description"]) ?? ""))
    .map((item) => ({
      name: pickString(item, ["name", "service", "description"]) ?? "zabbix",
      type: "monitoring" as const,
      status: pickBoolean(item, ["status", "state", "running"]) ? "running" : "stopped",
      command:
        pickString(item, ["server", "servers", "server_active", "serveractive", "host"]) ??
        "servers esperados: monitor.arcanjofirewall.com.br, monitoria.mexcloud.com.br",
    }));
  const configMonitoring = normalizeZabbixConfig(zabbix, services);
  return uniqueRows([...cronItems, ...monitoring, ...configMonitoring], (item) =>
    `${item.type}:${item.name}:${item.command}`,
  );
}

function cronSchedule(item: unknown): string {
  if (!isRecord(item)) return "-";
  const minute = pickString(item, ["minute", "min"]) ?? "*";
  const hour = pickString(item, ["hour"]) ?? "*";
  const mday = pickString(item, ["mday", "day"]) ?? "*";
  const month = pickString(item, ["month"]) ?? "*";
  const wday = pickString(item, ["wday", "weekday"]) ?? "*";
  return `${minute} ${hour} ${mday} ${month} ${wday}`;
}

function endpointLabel(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(endpointLabel).filter(Boolean);
    return parts.length ? parts.join(", ") : undefined;
  }
  if (!isRecord(value)) return undefined;
  return (
    pickString(value, ["address", "network", "any", "alias", "port", "value", "name"]) ??
    Object.entries(value)
      .map(([key, entry]) => `${key}:${String(entry)}`)
      .join(",")
  );
}

function statusFromEnabled(item: unknown): string {
  const enabled = pickBoolean(item, ["enabled", "enable", "active"]);
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "unknown";
}

function splitEntries(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(endpointLabel).filter((entry): entry is string => Boolean(entry));
  if (typeof value === "string") return value.split(/[\s,;\n\r]+/).map((entry) => entry.trim()).filter(Boolean);
  const label = endpointLabel(value);
  return label ? [label] : [];
}

function portLabel(value: unknown): string {
  if (value === undefined || value === null || value === "") return "any";
  if (isRecord(value)) {
    return (
      pickString(value, ["from", "begin", "port", "value", "alias", "name"]) ??
      endpointLabel(value) ??
      "any"
    );
  }
  if (Array.isArray(value)) return value.map(portLabel).filter((entry) => entry !== "any").join(", ") || "any";
  return String(value);
}

function normalizeVpnStatus(item: unknown): string {
  const raw = [
    pickString(item, ["status", "state", "connection_status", "last_status"]),
    pickString(item, ["service", "name"]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/connected|success|up|online|running/.test(raw)) return "connected";
  if (/down|failed|offline|stopped|disconnect/.test(raw)) return "down";
  const enabledStatus = statusFromEnabled(item);
  return enabledStatus === "enabled" ? "offline" : enabledStatus;
}

function uniqueRows<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeZabbixConfig(zabbix: unknown, services: unknown): PfAutomationItem[] {
  if (!isRecord(zabbix) || !("monitor.arcanjofirewall.com.br" in zabbix || "monitoria.mexcloud.com.br" in zabbix)) {
    return [];
  }
  const service = arrayFrom(services).find((item) =>
    /zabbix/i.test(pickString(item, ["name", "service", "description"]) ?? ""),
  );
  const running = service ? pickBoolean(service, ["status", "state", "running"]) === true : false;
  const servers = Object.entries(zabbix)
    .filter(([, present]) => present === true)
    .map(([server]) => server);
  return [{
    name: "zabbix_agentd",
    type: "monitoring",
    status: running ? "running" : "stopped",
    command: servers.length ? servers.join(", ") : "servidores padrao nao encontrados",
  }];
}

function normalizeUpDown(value?: string): "up" | "down" {
  return ["up", "true", "active", "1"].includes(String(value).toLowerCase()) ? "up" : "down";
}

function normalizeRunning(value?: string): boolean {
  return ["running", "up", "true", "active", "1"].includes(String(value).toLowerCase());
}

function normalizeEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["enabled", "true", "1", ""].includes(String(value).toLowerCase());
}

function normalizeGatewayStatus(value?: string): "online" | "offline" | "degraded" {
  const status = String(value).toLowerCase();
  if (["online", "up", "active", "none"].includes(status)) return "online";
  if (["offline", "down"].includes(status)) return "offline";
  return "degraded";
}

function normalizeAction(value?: string): "pass" | "block" | "reject" {
  const action = String(value).toLowerCase();
  if (action === "block" || action === "reject") return action;
  return "pass";
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeHost(value: string): string {
  const host = value.trim();
  if (!host || host.includes("/") || host.includes("\\") || host.includes("@") || /\s/.test(host)) {
    throw new Error("Host do dispositivo invalido.");
  }
  if (host.startsWith("http:") || host.startsWith("https:")) {
    throw new Error("Informe apenas o hostname/IP, sem protocolo.");
  }

  const lower = host.toLowerCase();
  if (["localhost", "0.0.0.0", "127.0.0.1", "::1"].includes(lower)) {
    throw new Error("Host de loopback nao e permitido.");
  }
  if (lower === "169.254.169.254") {
    throw new Error("Host de metadata cloud nao e permitido.");
  }

  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function assertSafePort(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Porta do dispositivo invalida.");
  }
}
