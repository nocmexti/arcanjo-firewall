import { evaluateDrift, parseRules } from "@/lib/baseline";
import { MockPfSenseProvider } from "@/lib/pfsense/mock-provider.server";
import { RestApiPfSenseProvider } from "@/lib/pfsense/rest-api-provider.server";
import type { PfSenseSnapshot } from "@/lib/pfsense/types";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as nodePath from "node:path";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const LOCAL_DEMO_MODE = process.env["LOCAL_DEMO_MODE"] === "true";

const liveCredentialsPath = process.env["FLEET_CREDENTIALS_CSV"];
const agentCredentialsPath = process.env["FLEET_AGENT_CREDENTIALS_CSV"];
const useLiveCredentials =
  process.env["PFSENSE_PROVIDER"] === "restapi" && Boolean(liveCredentialsPath);
const provider = useLiveCredentials ? new RestApiPfSenseProvider() : new MockPfSenseProvider();

const defaultRules = {
  min_version: "2.7.2",
  required_services: ["sshd", "ntpd", "unbound"],
  required_aliases: ["RFC1918", "ADMIN_NETS"],
  max_uptime_days: 365,
  require_ntp: true,
  require_dns_resolver: true,
  forbid_default_password: true,
};

type DemoDevice = {
  id: string;
  name: string;
  client_unit: string;
  host: string;
  port: number;
  version: string | null;
  environment: string;
  tags: string[];
  status: string;
  compliant: boolean;
  notes: string | null;
  last_sync_at: string | null;
  last_backup_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  has_credential: boolean;
  api_key_encrypted?: string | null;
  api_key?: string | null;
  agent_secret?: string | null;
};

type DemoBackup = {
  id: string;
  device_id: string;
  created_at: string;
  status: string;
  size_bytes: number;
  filename: string;
  content?: string;
  diff?: string;
  imported?: boolean;
  storage_path?: string;
  devices: { name: string; client_unit: string } | null;
};

type DemoAuditLog = {
  id: string;
  created_at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  severity: string;
  details: Record<string, unknown>;
};

type DemoBaseline = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  rules: typeof defaultRules;
  updated_at: string;
};

const now = new Date("2026-08-10T12:00:00.000Z");
const clients = [
  "Alfa Telecom",
  "Beta Varejo",
  "Gamma Saude",
  "Delta Log",
  "Epsilon Bank",
  "Zeta Industria",
  "Omega Educacao",
];
const versions = ["2.7.2", "2.7.2", "2.7.2", "2.7.1", "2.7.0", "2.6.0", "24.03"];
const statuses = ["online", "online", "online", "online", "offline", "degraded", "unknown"];

let devices = Array.from({ length: 100 }, (_, index): DemoDevice => {
  const n = index + 1;
  const date = new Date(now.getTime() - (n % 72) * 60 * 60 * 1000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `fw-${String(n).padStart(3, "0")}-${["matriz", "filial", "dc", "loja", "cd"][n % 5]}`,
    client_unit: clients[n % clients.length]!,
    host: `10.${10 + (n % 40)}.${n % 250}.1`,
    port: [443, 8443, 10443][n % 3]!,
    version: versions[n % versions.length]!,
    environment: ["producao", "producao", "producao", "homologacao", "laboratorio"][n % 5]!,
    tags:
      n % 5 === 0
        ? ["core", "vpn"]
        : n % 5 === 1
          ? ["borda"]
          : n % 5 === 2
            ? ["filial", "vpn"]
            : n % 5 === 3
              ? ["dmz", "core"]
              : ["legado"],
    status: statuses[n % statuses.length]!,
    compliant: n % 3 !== 0,
    notes: n % 11 === 0 ? "Equipamento legado, aguardando substituicao." : null,
    last_sync_at: date,
    last_backup_at:
      n % 8 === 0 ? null : new Date(now.getTime() - (n % 30) * 86400000).toISOString(),
    last_error: n % 7 === 4 ? "Timeout na API REST" : null,
    created_at: date,
    updated_at: date,
    has_credential: n <= 2,
    api_key_encrypted: null,
    api_key: null,
  };
});

if (useLiveCredentials && liveCredentialsPath) {
  devices = loadDevicesFromCredentialsCsv(liveCredentialsPath);
}

let backups: DemoBackup[] = devices
  .filter((device) => device.last_backup_at)
  .map((device, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    device_id: device.id,
    created_at: device.last_backup_at!,
    status: "success",
    size_bytes: 180000 + index * 997,
    filename: `config-${device.name}-${device.last_backup_at!.slice(0, 10).replaceAll("-", "")}.xml`,
    content: sampleBackupContent(device),
    diff: index === 0 ? "Primeiro backup registrado no manager." : "Sem diff calculado para seed.",
    imported: false,
    devices: { name: device.name, client_unit: device.client_unit },
  }));

let auditLogs: DemoAuditLog[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    created_at: now.toISOString(),
    actor_email: "local.demo@fleet",
    action: "local.demo.start",
    target_type: "system",
    target_id: "local",
    severity: "info",
    details: { devices: devices.length },
  },
];

let baselines: DemoBaseline[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Padrao Corporativo 2.7",
    description: "Baseline principal de producao",
    is_default: true,
    rules: defaultRules,
    updated_at: now.toISOString(),
  },
];

const snapshots = new Map<string, PfSenseSnapshot>();

export function demoSession() {
  return {
    userId: "local-demo",
    role: "admin",
    email: "local.demo@fleet",
    displayName: "Local Demo",
    provider: useLiveCredentials ? "restapi" : "mock",
  };
}

export function demoListDevices() {
  return devices.map(publicDevice);
}

export async function demoGetDeviceDetail(id: string) {
  const device = findDevice(id);
  const snapshot = snapshots.get(id) ?? (await provider.fetchSnapshot(toConnection(device)));
  snapshots.set(id, snapshot);
  const deviceBackups = mergeBackups(
    backups.filter((backup) => backup.device_id === id),
    loadDiskBackupsForDevice(device),
  );
  return {
    device: publicDevice(device),
    snapshots: [
      {
        id: `${id}-snapshot`,
        collected_at: snapshot.collectedAt,
        provider: "mock",
        ok: true,
        payload: snapshot,
      },
    ],
    backups: deviceBackups,
    baselineName: baselines.find((baseline) => baseline.is_default)?.name ?? null,
    snapshot,
    drift: evaluateDrift({ version: device.version, snapshot }, parseRules(defaultRules)),
  };
}

export function demoSaveDevice(input: { id: string | null; values: Record<string, unknown> }) {
  const v = input.values;
  const stamp = new Date().toISOString();
  if (input.id) {
    const index = devices.findIndex((device) => device.id === input.id);
    if (index === -1) throw new Error("Dispositivo nao encontrado.");
    devices[index] = {
      ...devices[index]!,
      name: String(v.name),
      client_unit: String(v.client_unit),
      host: String(v.host),
      port: Number(v.port),
      version: v.version ? String(v.version) : null,
      environment: String(v.environment),
      tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
      notes: v.notes ? String(v.notes) : null,
      has_credential: Boolean(v.api_key) || devices[index]!.has_credential,
      updated_at: stamp,
    };
    log("device.update", input.id, { name: v.name });
    return { id: input.id };
  }

  const id = `00000000-0000-4000-8000-${String(devices.length + 1).padStart(12, "0")}`;
  devices.unshift({
    id,
    name: String(v.name),
    client_unit: String(v.client_unit),
    host: String(v.host),
    port: Number(v.port),
    version: v.version ? String(v.version) : null,
    environment: String(v.environment),
    tags: Array.isArray(v.tags) ? v.tags.map(String) : [],
    status: "unknown",
    compliant: true,
    notes: v.notes ? String(v.notes) : null,
    last_sync_at: null,
    last_backup_at: null,
    last_error: null,
    created_at: stamp,
    updated_at: stamp,
    has_credential: Boolean(v.api_key),
    api_key_encrypted: null,
  });
  log("device.create", id, { name: v.name, host: v.host });
  return { id };
}

export function demoDeleteDevice(id: string) {
  const device = findDevice(id);
  devices = devices.filter((item) => item.id !== id);
  backups = backups.filter((backup) => backup.device_id !== id);
  snapshots.delete(id);
  log("device.delete", id, { name: device.name }, "critical");
  return { ok: true };
}

export async function demoTestConnection(id: string) {
  const device = findDevice(id);
  const result = await provider.testConnection(toConnection(device));
  device.status = result.ok ? "online" : "offline";
  device.last_error = result.ok ? null : result.message;
  log(
    "device.test_connection",
    id,
    { ok: result.ok, error: device.last_error },
    result.ok ? "info" : "warning",
  );
  return { ok: result.ok, message: result.message };
}

export async function demoSyncDevice(id: string) {
  const device = findDevice(id);
  const snapshot = await provider.fetchSnapshot(toConnection(device));
  snapshots.set(id, snapshot);
  const drift = evaluateDrift({ version: device.version, snapshot }, parseRules(defaultRules));
  device.status = "online";
  device.version = snapshot.version;
  device.last_sync_at = new Date().toISOString();
  device.last_error = null;
  device.compliant = drift.length === 0;
  log("device.sync", id, { ok: true, drift: drift.length });
  return { ok: true, driftCount: drift.length, message: null };
}

export async function demoRequestBackup(id: string) {
  const device = findDevice(id);
  const stamp = new Date().toISOString();
  const previous = backups.find((item) => item.device_id === id)?.content ?? "";
  const realBackup = useLiveCredentials ? await provider.requestBackup(toConnection(device)) : null;
  const content = realBackup?.content ?? sampleBackupContent(device, stamp);
  const backup = {
    id: `10000000-0000-4000-8000-${String(backups.length + 1).padStart(12, "0")}`,
    device_id: id,
    created_at: stamp,
    status: "success",
    size_bytes: content.length,
    filename: realBackup?.filename ?? `config-${device.name}-${stamp.slice(0, 10).replaceAll("-", "")}.xml`,
    content,
    diff: backupDiff(previous, content),
    imported: false,
    devices: { name: device.name, client_unit: device.client_unit },
  };
  backups.unshift(backup);
  await persistBackupFile({
    deviceName: device.name,
    filename: backup.filename,
    content,
    createdAt: stamp,
  });
  device.last_backup_at = stamp;
  log("device.backup", id, { filename: backup.filename });
  return { ok: true, filename: backup.filename, message: realBackup?.message ?? "Backup de configuracao gerado (demo)." };
}

export function demoGetBackupContent(id: string) {
  const backup = findBackupById(id);
  if (!backup) throw new Error("Backup nao encontrado.");
  return {
    id: backup.id,
    filename: backup.filename,
    content: backup.content ?? "",
    diff: backup.diff ?? "",
  };
}

export async function demoImportBackup(deviceId: string, filename: string, content: string) {
  const device = findDevice(deviceId);
  validateBackupBelongsToDevice(content, device);
  const stamp = new Date().toISOString();
  const previous = backups.find((item) => item.device_id === deviceId)?.content ?? "";
  const backup = {
    id: `10000000-0000-4000-8000-${String(backups.length + 1).padStart(12, "0")}`,
    device_id: deviceId,
    created_at: stamp,
    status: "success",
    size_bytes: content.length,
    filename,
    content,
    diff: backupDiff(previous, content),
    imported: true,
    devices: { name: device.name, client_unit: device.client_unit },
  };
  backups.unshift(backup);
  await persistBackupFile({
    deviceName: device.name,
    filename,
    content,
    createdAt: stamp,
  });
  log("device.backup.import", deviceId, { filename, size: content.length });
  return { ok: true, id: backup.id };
}

export function demoDeleteBackup(id: string) {
  const backup = findBackupById(id);
  if (!backup) throw new Error("Backup nao encontrado.");
  backups = backups.filter((item) => item.id !== id);
  removeDiskBackup(backup);
  const device = devices.find((item) => item.id === backup.device_id);
  if (device) {
    device.last_backup_at =
      mergeBackups(
        backups.filter((item) => item.device_id === backup.device_id),
        loadDiskBackupsForDevice(device),
      )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.created_at ?? null;
  }
  log("device.backup.delete", backup.device_id, { filename: backup.filename, backupId: id }, "warning");
  return { ok: true };
}

export async function demoDisableFirewallRule(id: string, ruleId: string) {
  const device = findDevice(id);
  const snapshot = snapshots.get(id);
  if (useLiveCredentials && "disableFirewallRule" in provider) {
    await (provider as RestApiPfSenseProvider).disableFirewallRule(toConnection(device), ruleId);
  }
  if (snapshot) {
    snapshot.firewallRules = snapshot.firewallRules.map((rule) =>
      rule.id === ruleId ? { ...rule, disabled: true } : rule,
    );
  }
  log("firewall.rule.disable", id, { ruleId }, "warning");
  return { ok: true };
}

export async function demoSetFirewallRuleEnabled(id: string, ruleId: string, enabled: boolean) {
  const device = findDevice(id);
  const snapshot = snapshots.get(id);
  if (useLiveCredentials && "setFirewallRuleEnabled" in provider) {
    await (provider as RestApiPfSenseProvider).setFirewallRuleEnabled(toConnection(device), ruleId, enabled);
  }
  if (snapshot) {
    snapshot.firewallRules = snapshot.firewallRules.map((rule) =>
      rule.id === ruleId ? { ...rule, disabled: !enabled } : rule,
    );
  }
  log(enabled ? "firewall.rule.enable" : "firewall.rule.disable", id, { ruleId }, "warning");
  return { ok: true };
}

export async function demoKillVpnConnection(id: string, parentId: string, connectionId: string) {
  const device = findDevice(id);
  const snapshot = snapshots.get(id);
  if (useLiveCredentials && "killOpenVpnConnection" in provider) {
    await (provider as RestApiPfSenseProvider).killOpenVpnConnection(
      toConnection(device),
      parentId,
      connectionId,
    );
  }
  if (snapshot) {
    snapshot.vpnConnections = (snapshot.vpnConnections ?? []).filter(
      (connection) => connection.id !== connectionId || connection.parentId !== parentId,
    );
  }
  log("vpn.connection.kill", id, { parentId, connectionId }, "warning");
  return { ok: true };
}

export async function demoRestartVpn(id: string, type: "openvpn" | "wireguard" | "ipsec", vpnId?: string | null) {
  const device = findDevice(id);
  if (useLiveCredentials && "restartVpn" in provider) {
    await (provider as RestApiPfSenseProvider).restartVpn(toConnection(device), type, vpnId ?? undefined);
  }
  log("vpn.restart", id, { type, vpnId }, "warning");
  return { ok: true };
}

export function demoListBaselines() {
  return baselines;
}

export function demoSaveBaseline(input: DemoBaseline) {
  const stamp = new Date().toISOString();
  if (input.is_default) {
    baselines = baselines.map((baseline) => ({ ...baseline, is_default: false }));
  }
  if (input.id) {
    baselines = baselines.map((baseline) =>
      baseline.id === input.id ? { ...baseline, ...input, updated_at: stamp } : baseline,
    );
  } else {
    baselines.unshift({
      ...input,
      id: `30000000-0000-4000-8000-${String(baselines.length + 1).padStart(12, "0")}`,
      updated_at: stamp,
    });
  }
  log(
    input.id ? "baseline.update" : "baseline.create",
    input.id ?? input.name,
    { name: input.name },
    "warning",
  );
  return { ok: true };
}

export async function demoComplianceReport() {
  const baseline = baselines.find((item) => item.is_default) ?? baselines[0]!;
  const rows = await Promise.all(
    devices.map(async (device) => {
      const snapshot =
        snapshots.get(device.id) ?? (await provider.fetchSnapshot(toConnection(device)));
      snapshots.set(device.id, snapshot);
      const drift = evaluateDrift(
        { version: device.version, snapshot },
        parseRules(baseline.rules),
      );
      return {
        ...publicDevice(device),
        drift,
        highCount: drift.filter((item) => item.severity === "high").length,
        compliant: drift.length === 0,
      };
    }),
  );
  return { baseline: { id: baseline.id, name: baseline.name }, rows };
}

export function demoListBackups() {
  return mergeBackups(backups, loadAllDiskBackups());
}

export function demoListAuditLogs() {
  return auditLogs;
}

export function demoListTeam() {
  return [
    {
      id: "local-demo",
      email: "local.demo@fleet",
      display_name: "Local Demo",
      created_at: now.toISOString(),
      roles: ["admin"],
    },
  ];
}

export async function demoListAgentHealth() {
  const agentCredentials = loadAgentCredentialRows();
  const agentSecrets = new Map([...agentCredentials.entries()].map(([host, row]) => [host, row.agentSecret]));
  const rows = await Promise.all(
    devices.map(async (device) => {
      const saved = agentCredentials.get(device.host);
      const registered = Boolean(device.agent_secret ?? agentSecrets.get(device.host));
      const url = `https://${device.host}:${device.port}/fleet-guardian-agent.php?action=health`;
      if (!registered) {
        return {
          deviceId: device.id,
          name: device.name,
          host: device.host,
          port: device.port,
          sshPort: saved?.sshPort ?? 2222,
          sshUser: saved?.sshUser ?? "heimdall-admin",
          registered,
          alive: false,
          version: null,
          lastSeenAt: null,
          error: "Agente nao registrado.",
        };
      }
      const health = await fetchAgentHealth(url);
      return {
        deviceId: device.id,
        name: device.name,
        host: device.host,
        port: device.port,
        sshPort: saved?.sshPort ?? 2222,
        sshUser: saved?.sshUser ?? "heimdall-admin",
        registered,
        alive: health.ok,
        version: health.version,
        lastSeenAt: health.ok ? new Date().toISOString() : null,
        error: health.error,
      };
    }),
  );
  return rows;
}

export async function demoInstallAgentFromManager(input: {
  name?: string | null;
  host: string;
  sshUser: string;
  sshPassword: string;
  heimdallUser?: string;
  heimdallPassword?: string;
  ensureHeimdallUser?: boolean;
  sshPort: number;
  apiPort: number;
  action: "validate" | "restapi" | "agent" | "all";
  packageBaseUrl?: string;
}) {
  const host = input.host.trim();
  const sshUser = input.sshUser.trim();
  const sshPort = input.sshPort || 2222;
  const apiPort = input.apiPort || 58443;
  const heimdallUser = input.heimdallUser?.trim() || "heimdall-admin";
  const heimdallPassword = input.heimdallPassword || input.sshPassword;
  const apiUser = input.ensureHeimdallUser === true ? heimdallUser : sshUser;
  if (!input.sshPassword) throw new Error("Senha SSH obrigatoria.");

  const ssh = sshBaseArgs(sshPort);
  const env = { ...process.env, SSHPASS: input.sshPassword };
  const precheck = await execFileAsync(
    "sshpass",
    ["-e", "ssh", ...ssh, `${sshUser}@${host}`, "echo SSH_OK && cat /etc/version 2>/dev/null || true"],
    { env, timeout: 20_000, maxBuffer: 1024 * 1024 },
  ).catch((error) => {
    throw new Error(`Falha no SSH: ${cleanExecError(error)}`);
  });

  const version = precheck.stdout.split(/\r?\n/).find((line) => /^\d/.test(line.trim()))?.trim() ?? null;
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [
    { step: "ssh", ok: true, detail: version ? `SSH OK - versao ${version}` : "SSH OK" },
  ];

  if (input.action === "validate") {
    log("agent.validate", host, { host, sshPort, apiPort }, "info");
    return { ok: true, host, version, steps };
  }

  const publicUrl = process.env["HEIMDALL_PUBLIC_URL"]?.replace(/\/$/, "");
  const packageBaseUrl =
    input.packageBaseUrl ??
    process.env["HEIMDALL_PACKAGE_BASE_URL"] ??
    (publicUrl ? `${publicUrl}/api/packages` : null);

  if ((input.action === "restapi" || input.action === "all") && !packageBaseUrl) {
    throw new Error("URL publica do HEIMDALL nao configurada. Defina HEIMDALL_PUBLIC_URL no container.");
  }

  let createdApiKey: string | null = null;
  if (input.ensureHeimdallUser === true && /^2\.7\./.test(version ?? "")) {
    throw new Error("Criacao automatica do usuario HEIMDALL bloqueada para pfSense 2.7.x. Crie o usuario pela WebGUI e rode a atualizacao com a opcao desligada.");
  }
  if (input.ensureHeimdallUser === true && input.action !== "validate") {
    const userResult = await execFileAsync(
      "sshpass",
      ["-e", "ssh", ...ssh, `${sshUser}@${host}`, ensureHeimdallUserRemoteCommand(heimdallUser, heimdallPassword)],
      { env, timeout: 60_000, maxBuffer: 1024 * 1024 * 4 },
    ).catch((error) => {
      throw new Error(`Falha ao criar usuario HEIMDALL: ${cleanExecError(error)}`);
    });
    steps.push({ step: "heimdall_user", ok: true, detail: maskSecret(cleanOutput(userResult.stdout)) });
  }

  if ((input.action === "restapi" || input.action === "all") && packageBaseUrl) {
    const apiResult = await execFileAsync(
      "sshpass",
      ["-e", "ssh", ...ssh, `${sshUser}@${host}`, restApiRemoteCommand(packageBaseUrl)],
      { env, timeout: 180_000, maxBuffer: 1024 * 1024 * 8 },
    ).catch((error) => {
      throw new Error(`Falha ao instalar API: ${cleanExecError(error)}`);
    });
    steps.push({ step: "restapi", ok: true, detail: cleanOutput(apiResult.stdout) });

    const configResult = await execFileAsync(
      "sshpass",
      ["-e", "ssh", ...ssh, `${sshUser}@${host}`, configureRestApiRemoteCommand(apiUser, apiPort)],
      { env, timeout: 90_000, maxBuffer: 1024 * 1024 * 4 },
    ).catch((error) => {
      throw new Error(`API instalada, mas falhou ao configurar chave/metodo Key: ${cleanExecError(error)}`);
    });
    const configOutput = cleanOutput(configResult.stdout);
    const apiKey = configOutput.match(/credential_secret=([a-fA-F0-9]+)/)?.[1] ?? null;
    if (!apiKey) {
      throw new Error(`API instalada, mas nao retornou a chave de comunicacao. Saida: ${maskSecret(configOutput)}`);
    }
    createdApiKey = apiKey;
    upsertApiCredential({
      host,
      sshPort,
      apiPort,
      family: version?.startsWith("2.5") || version?.startsWith("2.6") ? "api_v1" : "restapi_v2",
      version,
      authType: "x-api-key",
      credentialId: "",
      credentialSecret: apiKey,
    });
    steps.push({ step: "restapi_config", ok: true, detail: maskSecret(configOutput) });
  }
  if (input.action === "restapi") {
    log("agent.restapi.install", host, { host, sshPort, apiPort }, "warning");
    return { ok: true, host, version, steps };
  }

  const agentContent = readAgentFile();
  const agentB64 = Buffer.from(agentContent, "utf8").toString("base64");
  const scriptB64 = Buffer.from(agentRemoteScript(), "utf8").toString("base64");
  const agentResult = await execFileAsync(
    "sshpass",
    [
      "-e",
      "ssh",
      ...ssh,
      `${sshUser}@${host}`,
      `FLEET_AGENT_B64='${agentB64}' HEIMDALL_AGENT_SCRIPT_B64='${scriptB64}' sh -c 'printf "%s" "$HEIMDALL_AGENT_SCRIPT_B64" | base64 -d | sh'`,
    ],
    { env, timeout: 90_000, maxBuffer: 1024 * 1024 * 4 },
  ).catch((error) => {
    throw new Error(`Falha ao instalar agente: ${cleanExecError(error)}`);
  });
  const output = cleanOutput(agentResult.stdout);
  const secret = output.match(/agent_secret=([a-fA-F0-9]+)/)?.[1] ?? null;
  if (!secret) throw new Error(`Agente instalado, mas nao retornou segredo. Saida: ${maskSecret(output)}`);

  upsertAgentCredential({
    host,
    sshUser,
    sshPort,
    apiPort,
    agentSecret: secret,
  });

  const existing = devices.find((device) => device.host === host);
  if (existing) {
    existing.name = input.name?.trim() || existing.name;
    existing.port = apiPort;
    existing.agent_secret = secret;
    existing.has_credential = true;
    existing.api_key = createdApiKey ?? existing.api_key ?? null;
    existing.status = "online";
    existing.version = version ?? existing.version;
    existing.updated_at = new Date().toISOString();
  } else {
    const stamp = new Date().toISOString();
    devices.push({
      id: `90000000-0000-4000-8000-${String(devices.length + 1).padStart(12, "0")}`,
      name: input.name?.trim() || host.replace(/\..*$/, ""),
      client_unit: "Grupo aplicado",
      host,
      port: apiPort,
      version,
      environment: "producao",
      tags: ["live", "agent"],
      status: "online",
      compliant: true,
      notes: "Cadastrado pela guia Agentes.",
      last_sync_at: null,
      last_backup_at: null,
      last_error: null,
      created_at: stamp,
      updated_at: stamp,
      has_credential: Boolean(createdApiKey),
      api_key_encrypted: null,
      api_key: createdApiKey,
      agent_secret: secret,
    });
  }

  steps.push({ step: "agent", ok: true, detail: maskSecret(output) });
  log("agent.install", host, { host, sshPort, apiPort, action: input.action }, "warning");
  return { ok: true, host, version, steps };
}

export function demoDirectViewUrl(id: string) {
  const device = findDevice(id);
  const agentSecret = device.agent_secret ?? loadAgentSecrets().get(device.host) ?? null;
  if (!agentSecret) {
    throw new Error("Agente nao registrado para este firewall. Reinstale/registre o agente e monte o CSV no container.");
  }
  const user = loadAgentCredentialRows().get(device.host)?.directViewUser || "admin";
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = createHmac("sha256", agentSecret).update(`${user}|${exp}`).digest("hex");
  return {
    url: `https://${device.host}:${device.port}/fleet-guardian-agent.php?action=direct-view&user=${encodeURIComponent(user)}&exp=${exp}&sig=${sig}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

function toConnection(device: DemoDevice) {
  return {
    id: device.id,
    name: device.name,
    host: device.host,
    port: device.port,
    apiKey: device.api_key ?? (device.has_credential ? "local-demo-token" : null),
    agentSecret: device.agent_secret ?? loadAgentSecrets().get(device.host) ?? null,
  };
}

function publicDevice(device: DemoDevice) {
  const { api_key, api_key_encrypted, ...rest } = device;
  void api_key;
  void api_key_encrypted;
  return rest;
}

function loadDevicesFromCredentialsCsv(path: string): DemoDevice[] {
  const rows = loadApiCredentialRows(path);
  const agentSecrets = loadAgentSecrets();
  return rows.map((row, index) => {
    const host = row["Host"] ?? `firewall-${index + 1}`;
    const version = row["Version"] || null;
    const apiPort = Number(process.env["FLEET_API_PORT"] ?? portFromApiUrl(row["ApiUrl"]) ?? 58443);
    const stamp = new Date().toISOString();
    return {
      id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: host.replace(/\..*$/, ""),
      client_unit: "Grupo aplicado",
      host,
      port: apiPort,
      version,
      environment: "producao",
      tags: ["live", row["Family"] || "restapi"],
      status: "unknown",
      compliant: true,
      notes: "Carregado de fleet-guardian-api-credentials.csv",
      last_sync_at: null,
      last_backup_at: null,
      last_error: null,
      created_at: stamp,
      updated_at: stamp,
      has_credential: Boolean(row["CredentialSecret"]),
      api_key_encrypted: null,
      api_key: row["CredentialSecret"] || null,
      agent_secret: agentSecrets.get(host) ?? null,
    };
  });
}

function loadApiCredentialRows(path: string) {
  const merged = new Map<string, Record<string, string>>();
  const candidates = [
    path,
    process.env["HEIMDALL_API_CREDENTIALS_CSV"],
    "/data/backups/fleet-guardian-api-credentials.csv",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const content = readFileSync(candidate, "utf8").trim();
      if (!content) continue;
      const [headerLine, ...lines] = content.split(/\r?\n/);
      const headers = parseCsvLine(headerLine ?? "");
      for (const line of lines.filter(Boolean)) {
        const values = parseCsvLine(line);
        const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
        if (row["Host"]) merged.set(row["Host"], row);
      }
    } catch {
      // Optional file. Missing generated credentials only means fewer managed devices are preloaded.
    }
  }

  return [...merged.values()].sort((a, b) => (a["Host"] ?? "").localeCompare(b["Host"] ?? ""));
}

function loadAgentSecrets() {
  return new Map([...loadAgentCredentialRows().entries()].map(([host, row]) => [host, row.agentSecret]));
}

function loadAgentCredentialRows() {
  const merged = new Map<string, { sshPort: number; apiPort: number; sshUser: string; directViewUser: string; agentBaseUrl: string; agentSecret: string }>();
  const candidates = [
    agentCredentialsPath,
    process.env["HEIMDALL_AGENT_CREDENTIALS_CSV"],
    "/data/backups/fleet-guardian-agent-credentials.csv",
    "/run/secrets/fleet-guardian-agent-credentials.csv",
  ].filter(Boolean) as string[];
  for (const path of candidates) {
    try {
      const content = readFileSync(path, "utf8").trim();
      if (!content) continue;
      const [headerLine, ...lines] = content.split(/\r?\n/);
      const headers = parseCsvLine(headerLine ?? "");
      for (const line of lines.filter(Boolean)) {
          const values = parseCsvLine(line);
          const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
        const apiPort = Number((row["AgentBaseUrl"] ?? "").match(/:(\d+)(?:\/)?$/)?.[1] ?? 58443);
        if (row["Host"] && row["AgentSecret"]) {
          merged.set(row["Host"], {
            sshPort: Number(row["SshPort"] || 2222),
            apiPort: Number.isFinite(apiPort) ? apiPort : 58443,
            sshUser: row["SshUser"] && row["SshUser"] !== "heimdall-admin" ? row["SshUser"] : "admin",
            directViewUser: row["DirectViewUser"] || row["SshUser"] || "admin",
            agentBaseUrl: row["AgentBaseUrl"] ?? "",
            agentSecret: row["AgentSecret"],
          });
        }
      }
    } catch {
      // Optional file; absence only means Direct View stays disabled.
    }
  }
  return merged;
}

function upsertAgentCredential(input: {
  host: string;
  sshUser: string;
  sshPort: number;
  apiPort: number;
  agentSecret: string;
}) {
  const path = agentCredentialsPath ?? "/run/secrets/fleet-guardian-agent-credentials.csv";
  if (path.startsWith("/run/secrets/")) {
    const fallback = process.env["HEIMDALL_AGENT_CREDENTIALS_CSV"] ?? "/data/backups/fleet-guardian-agent-credentials.csv";
    return upsertAgentCredentialAtPath(fallback, input);
  }
  return upsertAgentCredentialAtPath(path, input);
}

function upsertAgentCredentialAtPath(path: string, input: {
  host: string;
  sshUser: string;
  sshPort: number;
  apiPort: number;
  agentSecret: string;
}) {
  const header = ["Host", "SshPort", "SshUser", "DirectViewUser", "AgentBaseUrl", "AgentSecret", "InstalledAt"];
  const existingContent = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  const current = new Map<string, Record<string, string>>();
  const [oldHeaderLine, ...rows] = existingContent ? existingContent.split(/\r?\n/) : [];
  const oldHeader = parseCsvLine(oldHeaderLine ?? "");
  for (const line of rows.filter(Boolean)) {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(oldHeader.map((key, i) => [key, values[i] ?? ""]));
    const host = row["Host"] || values[0] || "";
    current.set(host, {
      Host: host,
      SshPort: row["SshPort"] || values[1] || "",
      SshUser: row["SshUser"] && row["SshUser"] !== "heimdall-admin" ? row["SshUser"] : "admin",
      DirectViewUser: row["DirectViewUser"] || row["SshUser"] || "admin",
      AgentBaseUrl: row["AgentBaseUrl"] || values[2] || "",
      AgentSecret: row["AgentSecret"] || values[3] || "",
      InstalledAt: row["InstalledAt"] || values[4] || "",
    });
  }
  current.set(input.host, {
    Host: input.host,
    SshPort: String(input.sshPort),
    SshUser: input.sshUser,
    DirectViewUser: input.sshUser,
    AgentBaseUrl: `https://${input.host}:${input.apiPort}`,
    AgentSecret: input.agentSecret,
    InstalledAt: new Date().toISOString(),
  });
  const csvContent = [
    header.map(csvCell).join(","),
    ...[...current.values()].sort((a, b) => a.Host.localeCompare(b.Host)).map((row) =>
      header.map((key) => csvCell(row[key] ?? "")).join(","),
    ),
  ].join("\n") + "\n";
  writeFileSync(path, csvContent, "utf8");
}

function upsertApiCredential(input: {
  host: string;
  sshPort: number;
  apiPort: number;
  family: string;
  version: string | null;
  authType: string;
  credentialId: string;
  credentialSecret: string;
}) {
  const path = liveCredentialsPath ?? "/run/secrets/fleet-guardian-api-credentials.csv";
  if (path.startsWith("/run/secrets/")) {
    const fallback = process.env["HEIMDALL_API_CREDENTIALS_CSV"] ?? "/data/backups/fleet-guardian-api-credentials.csv";
    return upsertApiCredentialAtPath(fallback, input);
  }
  return upsertApiCredentialAtPath(path, input);
}

function upsertApiCredentialAtPath(path: string, input: {
  host: string;
  sshPort: number;
  apiPort: number;
  family: string;
  version: string | null;
  authType: string;
  credentialId: string;
  credentialSecret: string;
}) {
  const header = [
    "Host",
    "Port",
    "ApiUrl",
    "Family",
    "Version",
    "AuthType",
    "CredentialId",
    "CredentialSecret",
    "CreatedAt",
  ];
  const rows = existsSync(path) ? readFileSync(path, "utf8").trim().split(/\r?\n/).slice(1) : [];
  const current = new Map<string, Record<string, string>>();
  for (const line of rows.filter(Boolean)) {
    const values = parseCsvLine(line);
    current.set(values[0] ?? "", {
      Host: values[0] ?? "",
      Port: values[1] ?? "",
      ApiUrl: values[2] ?? "",
      Family: values[3] ?? "",
      Version: values[4] ?? "",
      AuthType: values[5] ?? "",
      CredentialId: values[6] ?? "",
      CredentialSecret: values[7] ?? "",
      CreatedAt: values[8] ?? "",
    });
  }
  current.set(input.host, {
    Host: input.host,
    Port: String(input.sshPort),
    ApiUrl: `https://${input.host}:${input.apiPort}`,
    Family: input.family,
    Version: input.version ?? "",
    AuthType: input.authType,
    CredentialId: input.credentialId,
    CredentialSecret: input.credentialSecret,
    CreatedAt: new Date().toISOString(),
  });
  const content = [
    header.map(csvCell).join(","),
    ...[...current.values()].sort((a, b) => a.Host.localeCompare(b.Host)).map((row) =>
      header.map((key) => csvCell(row[key] ?? "")).join(","),
    ),
  ].join("\n") + "\n";
  writeFileSync(path, content, "utf8");
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sshBaseArgs(port: number) {
  return [
    "-p",
    String(port),
    "-o",
    "BatchMode=no",
    "-o",
    "PreferredAuthentications=password,keyboard-interactive",
    "-o",
    "PubkeyAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=yes",
    "-o",
    "ChallengeResponseAuthentication=yes",
    "-o",
    "NumberOfPasswordPrompts=1",
    "-o",
    "ConnectTimeout=12",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "LogLevel=ERROR",
  ];
}

function readAgentFile() {
  const paths = [
    "/app/public/fleet-guardian-agent.php",
    "/app/.output/public/fleet-guardian-agent.php",
    "public/fleet-guardian-agent.php",
  ];
  for (const path of paths) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error("Arquivo do agente nao encontrado no container.");
}

function ensureHeimdallUserRemoteCommand(username: string, password: string) {
  const safeUser = username.replace(/[^a-zA-Z0-9_.@-]/g, "").slice(0, 64) || "heimdall-admin";
  const passwordB64 = Buffer.from(password, "utf8").toString("base64");
  return `HEIMDALL_USER='${safeUser}' HEIMDALL_PASSWORD_B64='${passwordB64}' php <<'PHP'
<?php
require_once("config.inc");
require_once("util.inc");
global $config;

$username = getenv("HEIMDALL_USER") ?: "heimdall-admin";
$password = base64_decode(getenv("HEIMDALL_PASSWORD_B64") ?: "", true);
if (!$password) {
    fwrite(STDERR, "senha vazia\\n");
    exit(31);
}
if (!isset($config["system"]["user"]) || !is_array($config["system"]["user"])) {
    $config["system"]["user"] = [];
}

$hash = password_hash($password, PASSWORD_BCRYPT);
$found = false;
foreach ($config["system"]["user"] as &$user) {
    if (($user["name"] ?? "") === $username) {
        $user["descr"] = "HEIMDALL Manager";
        $user["scope"] = "user";
        $user["password"] = $hash;
        $user["groupname"] = ["admins"];
        $user["priv"] = ["page-all"];
        $found = true;
        break;
    }
}
unset($user);

if (!$found) {
    $config["system"]["user"][] = [
        "name" => $username,
        "descr" => "HEIMDALL Manager",
        "scope" => "user",
        "password" => $hash,
        "groupname" => ["admins"],
        "priv" => ["page-all"],
    ];
}

write_config("HEIMDALL dedicated user");
echo "HEIMDALL_USER_OK user=" . $username . "\\n";
PHP`;
}

function agentRemoteScript() {
  return `
set -u
tmp_remote="/tmp/fleet-guardian-agent.php"
remote_agent="/usr/local/www/fleet-guardian-agent.php"
remote_secret="/usr/local/etc/fleet-guardian-agent.secret"
printf "%s" "$FLEET_AGENT_B64" | base64 -d > "$tmp_remote" || exit 20
install -o root -g wheel -m 0644 "$tmp_remote" "$remote_agent" || exit 21
rm -f "$tmp_remote"
if [ ! -s "$remote_secret" ]; then
  umask 077
  openssl rand -hex 32 > "$remote_secret" || exit 22
fi
chown root:wheel "$remote_secret" || true
chmod 0640 "$remote_secret" || true
printf "AGENT_OK secret_sha256="
sha256 -q "$remote_secret" 2>/dev/null || sha256sum "$remote_secret" | awk "{print \\$1}"
printf " agent_secret="
cat "$remote_secret"
`;
}

function restApiRemoteCommand(packageBaseUrl: string) {
  const safeBase = packageBaseUrl.replace(/'/g, "");
  return `HEIMDALL_PACKAGE_BASE_URL='${safeBase}' sh -s <<'HEIMDALL_RESTAPI'
set -u
base="$HEIMDALL_PACKAGE_BASE_URL"
version="$(cat /etc/version 2>/dev/null | tr -d "\\r\\n")"
case "$version" in
  2.5.*) dir="2.5"; package_name="pfSense-2.5-pkg-API.txz"; install_cmd="env ASSUME_ALWAYS_YES=yes IGNORE_OSVERSION=yes pkg-static add" ;;
  2.6.0*) dir="2.6"; package_name="pfSense-2.6-pkg-API.txz"; install_cmd="env ASSUME_ALWAYS_YES=yes IGNORE_OSVERSION=yes pkg-static add" ;;
  2.7.0*|2.7.1*) dir="2.7"; package_name="pfSense-2.7-pkg-API.pkg"; install_cmd="pkg-static -C /dev/null add" ;;
  2.7.2*) dir="2.7"; package_name="pfSense-2.7.2-pkg-RESTAPI.pkg"; install_cmd="pkg-static -C /dev/null add" ;;
  2.8.0*) dir="2.8"; package_name="pfSense-2.8.0-pkg-RESTAPI.pkg"; install_cmd="pkg-static add" ;;
  2.8.1*) dir="2.8"; package_name="pfSense-2.8.1-pkg-RESTAPI.pkg"; install_cmd="pkg-static add" ;;
  25.11.1*) dir="2.8"; package_name="pfSense-25.11.1-pkg-RESTAPI.pkg"; install_cmd="pkg-static -C /dev/null add" ;;
  26.03.1*) dir="2.8"; package_name="pfSense-26.03.1-pkg-RESTAPI.pkg"; install_cmd="pkg-static -C /dev/null add" ;;
  26.03*) dir="2.8"; package_name="pfSense-26.03-pkg-RESTAPI.pkg"; install_cmd="pkg-static -C /dev/null add" ;;
  *) echo "versao_nao_suportada=$version"; exit 10 ;;
esac
if command -v pfsense-restapi >/dev/null 2>&1 || command -v pfsense-api >/dev/null 2>&1; then
  echo "RESTAPI_OK ja_instalado version=$version"
  exit 0
fi
url="\${base%/}/$dir/$package_name"
download_path="/tmp/$package_name"
fetch -q -o "$download_path" "$url" || { echo "download_falhou=$url"; exit 13; }
test -s "$download_path" || { echo "pacote_invalido=$download_path"; exit 15; }
$install_cmd "$download_path"
install_exit=$?
rm -f "$download_path"
test "$install_exit" -eq 0 || { echo "instalacao_falhou=$install_exit"; exit "$install_exit"; }
echo "RESTAPI_OK instalado=$package_name version=$version"
HEIMDALL_RESTAPI`;
}

function configureRestApiRemoteCommand(apiUser: string, apiPort: number) {
  const safeUser = apiUser.replace(/'/g, "");
  const safePort = Number.isFinite(apiPort) ? Math.trunc(apiPort) : 58443;
  return `FLEET_API_USER='${safeUser}' FLEET_API_PORT='${safePort}' sh -s <<'HEIMDALL_RESTAPI_CONFIG'
set -u
api_user="\${FLEET_API_USER:-admin}"
api_port="\${FLEET_API_PORT:-58443}"
key_output="$(php <<'PHP'
<?php
require_once("config.inc");
require_once("util.inc");
global $config;

$username = getenv("FLEET_API_USER") ?: "admin";
$allowed_interfaces = getenv("FLEET_ALLOWED_INTERFACES") ?: "wan,lan,lo0";
$key = bin2hex(random_bytes(32));
$hash = hash("sha512", $key);
$changed = false;

if (!isset($config["installedpackages"]["package"]) || !is_array($config["installedpackages"]["package"])) {
    fwrite(STDERR, "installed packages config not found\\n");
    exit(1);
}

foreach ($config["installedpackages"]["package"] as &$pkg) {
    $name = $pkg["name"] ?? "";
    $internal = $pkg["internal_name"] ?? "";
    if ($name === "RESTAPI" || $name === "REST API" || $internal === "restapi") {
        if (!isset($pkg["conf"]) || !is_array($pkg["conf"])) {
            $pkg["conf"] = [];
        }
        $pkg["conf"]["enabled"] = "enabled";
        $pkg["conf"]["read_only"] = "disabled";
        $pkg["conf"]["keep_backup"] = "enabled";
        $pkg["conf"]["login_protection"] = "enabled";
        $pkg["conf"]["log_successful_auth"] = "disabled";
        $pkg["conf"]["log_level"] = $pkg["conf"]["log_level"] ?? "LOG_WARNING";
        $pkg["conf"]["hateoas"] = "disabled";
        $pkg["conf"]["expose_sensitive_fields"] = "disabled";
        $pkg["conf"]["represent_interfaces_as"] = "id";
        $pkg["conf"]["allowed_interfaces"] = $allowed_interfaces;

        $methods = $pkg["conf"]["auth_methods"] ?? [];
        if (!is_array($methods)) {
            $methods = preg_split("/[,\\s]+/", (string)$methods, -1, PREG_SPLIT_NO_EMPTY);
        }
        foreach (["BasicAuth", "KeyAuth"] as $method) {
            if (!in_array($method, $methods, true)) {
                $methods[] = $method;
            }
        }
        $pkg["conf"]["auth_methods"] = implode(",", $methods);

        if (!isset($pkg["conf"]["keys"]) || !is_array($pkg["conf"]["keys"])) {
            $pkg["conf"]["keys"] = [];
        }
        if (!isset($pkg["conf"]["keys"]["key"]) || !is_array($pkg["conf"]["keys"]["key"])) {
            $pkg["conf"]["keys"]["key"] = [];
        }
        $pkg["conf"]["keys"]["key"] = array_values(array_filter(
            $pkg["conf"]["keys"]["key"],
            static fn($existing) => !in_array(($existing["descr"] ?? ""), ["HEIMDALL", "Fleet Guardian"], true)
        ));
        $pkg["conf"]["keys"]["key"][] = [
            "descr" => "HEIMDALL",
            "username" => $username,
            "hash_algo" => "sha512",
            "length_bytes" => "32",
            "hash" => $hash,
        ];
        $changed = true;
        break;
    }
}

if (!$changed) {
    fwrite(STDERR, "RESTAPI package config not found\\n");
    exit(1);
}

write_config("HEIMDALL REST API key");
echo $key;
PHP
)"
key_exit="$?"
if [ "$key_exit" -ne 0 ] || [ -z "$key_output" ]; then
  echo "key_generation=falhou"
  exit 21
fi
api_key="$(printf "%s" "$key_output" | tail -n 1 | tr -d "\\r\\n")"

if [ -x /etc/rc.restart_webgui ]; then
  /etc/rc.restart_webgui >/tmp/heimdall-webgui-restart.log 2>&1 || true
elif command -v configctl >/dev/null 2>&1; then
  configctl webgui restart >/tmp/heimdall-webgui-restart.log 2>&1 || true
fi

code="000"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  code="$(curl -LksS -o /dev/null -w "%{http_code}" -H "X-API-Key: $api_key" "https://127.0.0.1:$api_port/api/v2/system/version" 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && break
done
if [ "$code" != "200" ]; then
  echo "key_validation=falhou HTTP_CODE=$code"
  exit 22
fi

echo "RESTAPI_CONFIG_OK auth_methods=BasicAuth,KeyAuth allowed_interfaces=wan,lan,lo0"
echo "credential_id="
echo "credential_secret=$api_key"
HEIMDALL_RESTAPI_CONFIG`;
}

function cleanOutput(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function maskSecret(value: string) {
  return value.replace(/agent_secret=[a-fA-F0-9]+/g, "agent_secret=***");
}

function cleanExecError(error: unknown) {
  if (error && typeof error === "object") {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return maskSecret(cleanOutput([e.stdout, e.stderr, e.message].filter(Boolean).join(" ")));
  }
  return "erro desconhecido";
}

async function fetchAgentHealth(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, version: null, error: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return { ok: Boolean(json?.ok), version: json?.version ?? null, error: null };
  } catch (error) {
    return { ok: false, version: null, error: error instanceof Error ? error.message : "Falha no healthcheck" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function portFromApiUrl(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.port ? Number(url.port) : null;
  } catch {
    return null;
  }
}

function sampleBackupContent(device: DemoDevice, stamp = new Date().toISOString()) {
  return [
    "<?xml version=\"1.0\"?>",
    "<pfsense>",
    `  <version>${device.version ?? "unknown"}</version>`,
    `  <lastchange>${stamp}</lastchange>`,
    `  <system><hostname>${device.name}</hostname></system>`,
    `  <interfaces><wan><ipaddr>${device.host}</ipaddr></wan></interfaces>`,
    "</pfsense>",
    "",
  ].join("\n");
}

function validateBackupBelongsToDevice(content: string, device: DemoDevice) {
  const identity = extractBackupIdentity(content);
  const candidates = [
    device.name,
    device.host.split(".")[0],
  ].map(normalizeIdentity).filter(Boolean);
  const values = [
    identity.hostname,
    identity.domain,
    identity.fqdn,
  ].map(normalizeIdentity).filter(Boolean);

  const matches = candidates.some((candidate) =>
    values.some((value) => value === candidate || value.includes(candidate) || candidate.includes(value)),
  );
  if (!matches) {
    throw new Error(
      `Backup pertence a ${identity.fqdn || identity.hostname || "hostname desconhecido"}, nao a ${device.name}.`,
    );
  }
}

function extractBackupIdentity(content: string) {
  if (!/<pfsense[\s>]/i.test(content)) {
    throw new Error("Arquivo importado nao parece ser um config.xml do pfSense.");
  }
  const system = content.match(/<system\b[^>]*>([\s\S]*?)<\/system>/i)?.[1] ?? content;
  const hostname = decodeXml(system.match(/<hostname\b[^>]*>([\s\S]*?)<\/hostname>/i)?.[1] ?? "").trim();
  const domain = decodeXml(system.match(/<domain\b[^>]*>([\s\S]*?)<\/domain>/i)?.[1] ?? "").trim();
  if (!hostname && !domain) {
    throw new Error("Nao encontrei hostname/domain no config.xml importado.");
  }
  return {
    hostname,
    domain,
    fqdn: hostname && domain ? `${hostname}.${domain}` : hostname || domain,
  };
}

function normalizeIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function backupRootDir() {
  return process.env["HEIMDALL_BACKUP_DIR"] ?? process.env["FLEET_BACKUP_DIR"] ?? "/data/backups";
}

function loadAllDiskBackups() {
  return devices.flatMap((device) => loadDiskBackupsForDevice(device));
}

function loadDiskBackupsForDevice(device: DemoDevice): DemoBackup[] {
  const root = backupRootDir();
  if (!existsSync(root)) return [];

  const candidates = new Set(
    [device.name, device.host, device.host.split(".")[0] ?? ""]
      .filter(Boolean)
      .map((value) => sanitizePathSegment(value)),
  );

  const files: string[] = [];
  for (const segment of candidates) {
    collectBackupFiles(nodePath.join(root, segment), files, 0);
  }

  const rows = files
    .map((filePath) => diskBackupRow(filePath, device))
    .filter((row): row is DemoBackup => Boolean(row))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  let previous = "";
  for (const row of rows) {
    row.diff = backupDiff(previous, row.content ?? "");
    previous = row.content ?? previous;
  }

  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function collectBackupFiles(dir: string, files: string[], depth: number) {
  if (depth > 3 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectBackupFiles(entryPath, files, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".xml")) {
      files.push(entryPath);
    }
  }
}

function diskBackupRow(filePath: string, device: DemoDevice): DemoBackup | null {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    const content = stat.size <= 8 * 1024 * 1024 ? readFileSync(filePath, "utf8") : "";
    const filename = nodePath.basename(filePath);
    return {
      id: `disk-${device.id}-${sanitizePathSegment(filename)}-${Math.trunc(stat.mtimeMs)}`,
      device_id: device.id,
      created_at: stat.mtime.toISOString(),
      status: "success",
      size_bytes: stat.size,
      filename,
      content,
      imported: filename.toLowerCase().includes("import"),
      storage_path: filePath,
      devices: { name: device.name, client_unit: device.client_unit },
    };
  } catch {
    return null;
  }
}

function mergeBackups(memoryRows: DemoBackup[], diskRows: DemoBackup[]) {
  const seen = new Set<string>();
  return [...memoryRows, ...diskRows]
    .filter((backup) => {
      const key = `${backup.device_id}|${backup.filename}|${backup.size_bytes}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function findBackupById(id: string) {
  return backups.find((item) => item.id === id) ?? loadAllDiskBackups().find((item) => item.id === id) ?? null;
}

function removeDiskBackup(backup: DemoBackup) {
  if (!backup.storage_path) return;
  const root = nodePath.resolve(backupRootDir());
  const target = nodePath.resolve(backup.storage_path);
  if (target !== root && target.startsWith(`${root}${nodePath.sep}`) && existsSync(target)) {
    rmSync(target, { force: true });
  }
}

function backupDiff(previous: string, current: string) {
  if (!previous) return "Primeiro backup registrado para este dispositivo.";
  if (previous === current) return "Sem alteracoes em relacao ao backup anterior.";
  const prevLines = new Set(previous.split(/\r?\n/));
  const currentLines = new Set(current.split(/\r?\n/));
  const added = [...currentLines].filter((line) => line && !prevLines.has(line)).slice(0, 80);
  const removed = [...prevLines].filter((line) => line && !currentLines.has(line)).slice(0, 80);
  return [
    ...added.map((line) => `+ ${line}`),
    ...removed.map((line) => `- ${line}`),
  ].join("\n") || "Conteudo alterado.";
}

async function persistBackupFile(input: {
  deviceName: string;
  filename: string;
  content: string;
  createdAt: string;
}) {
  if (!input.content) return null;
  const root = process.env["HEIMDALL_BACKUP_DIR"] ?? process.env["FLEET_BACKUP_DIR"] ?? "/data/backups";
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const date = input.createdAt.slice(0, 10);
  const dir = path.join(root, sanitizePathSegment(input.deviceName), date);
  const safeFilename = sanitizePathSegment(input.filename).replace(/_xml$/i, ".xml");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, safeFilename.endsWith(".xml") ? safeFilename : `${safeFilename}.xml`);
  await fs.writeFile(filePath, input.content, "utf8");
  return filePath;
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "backup";
}

function findDevice(id: string) {
  const device = devices.find((item) => item.id === id);
  if (!device) throw new Error("Dispositivo nao encontrado.");
  return device;
}

function log(
  action: string,
  targetId: string,
  details: Record<string, unknown>,
  severity: "info" | "warning" | "critical" = "info",
) {
  auditLogs.unshift({
    id: `20000000-0000-4000-8000-${String(auditLogs.length + 1).padStart(12, "0")}`,
    created_at: new Date().toISOString(),
    actor_email: "local.demo@fleet",
    action,
    target_type: action.startsWith("baseline") ? "baseline" : "device",
    target_id: targetId,
    severity,
    details,
  });
}
