import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEVICE_COLUMNS,
  assertRole,
  audit,
  collectSnapshot,
  driftFor,
  getRole,
  toPublicDevice,
  type DeviceRow,
} from "@/lib/fleet.server";
import type { PfSenseSnapshot } from "@/lib/pfsense/types";
import { encryptSecret } from "@/lib/crypto.server";
import {
  LOCAL_DEMO_MODE,
  demoComplianceReport,
  demoDeleteDevice,
  demoDeleteBackup,
  demoGetDeviceDetail,
  demoListAuditLogs,
  demoListBackups,
  demoListBaselines,
  demoListDevices,
  demoListAgentHealth,
  demoListTeam,
  demoRequestBackup,
  demoSaveBaseline,
  demoSaveDevice,
  demoSession,
  demoGetBackupContent,
  demoDirectViewUrl,
  demoImportBackup,
  demoInstallAgentFromManager,
  demoSetFirewallRuleEnabled,
  demoKillVpnConnection,
  demoRestartVpn,
  demoSyncDevice,
  demoTestConnection,
} from "@/lib/local-demo.server";

const hostInput = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .refine((host) => !host.startsWith("http:") && !host.startsWith("https:"), {
    message: "Informe apenas o hostname/IP, sem protocolo.",
  })
  .refine((host) => !host.includes("/") && !host.includes("\\") && !host.includes("@"), {
    message: "Host nao deve conter caminho, usuario ou protocolo.",
  })
  .refine((host) => !/\s/.test(host), { message: "Host nao deve conter espacos." })
  .refine((host) => !["localhost", "0.0.0.0", "127.0.0.1", "::1"].includes(host.toLowerCase()), {
    message: "Host de loopback nao e permitido.",
  })
  .refine((host) => host !== "169.254.169.254", {
    message: "Host de metadata cloud nao e permitido.",
  });

const deviceInput = z.object({
  name: z.string().trim().min(2).max(80),
  client_unit: z.string().trim().min(2).max(80),
  host: hostInput,
  port: z.number().int().min(1).max(65535),
  version: z.string().trim().max(20).nullable().optional(),
  environment: z.enum(["producao", "homologacao", "laboratorio"]),
  tags: z.array(z.string().trim().max(24)).max(10),
  notes: z.string().trim().max(1000).nullable().optional(),
  api_key: z.string().trim().max(500).nullable().optional(),
});

const agentInstallInput = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  host: hostInput,
  sshUser: z.string().trim().min(1).max(64),
  sshPassword: z.string().min(1, "Informe a senha SSH.").max(500),
  heimdallUser: z.string().trim().min(1).max(64).optional(),
  heimdallPassword: z.string().max(500).optional(),
  ensureHeimdallUser: z.boolean().optional(),
  sshPort: z.number().int().min(1).max(65535),
  apiPort: z.number().int().min(1).max(65535),
  action: z.enum(["validate", "restapi", "agent", "all"]),
  packageBaseUrl: z.string().trim().url().max(500).optional(),
});

export const getSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoSession();
    const role = await getRole(context.supabase, context.userId);
    const profile = await context.supabase
      .from("profiles")
      .select("email,display_name")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      userId: context.userId,
      role,
      email: profile.data?.email ?? null,
      displayName: profile.data?.display_name ?? null,
      provider: process.env["PFSENSE_PROVIDER"] === "restapi" ? "restapi" : "mock",
    };
  });

export const listDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoListDevices();
    const { data, error } = await context.supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .order("name");
    if (error) throw new Error(error.message);
    return (data as DeviceRow[]).map(toPublicDevice);
  });

export const getDeviceDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoGetDeviceDetail(data.id);
    const { supabase } = context;
    const device = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (device.error) throw new Error(device.error.message);
    if (!device.data) throw new Error("Dispositivo não encontrado.");
    const row = device.data as DeviceRow;

    const [snapshots, backups, baseline] = await Promise.all([
      supabase
        .from("device_snapshots")
        .select("id,collected_at,provider,ok,payload")
        .eq("device_id", data.id)
        .order("collected_at", { ascending: false })
        .limit(10),
      supabase
        .from("device_backups")
        .select("id,created_at,status,size_bytes,filename,imported")
        .eq("device_id", data.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("baselines").select("id,name,rules").eq("is_default", true).maybeSingle(),
    ]);

    const latest = snapshots.data?.[0];
    const snapshot = (latest?.payload ?? null) as PfSenseSnapshot | null;

    return {
      device: toPublicDevice(row),
      snapshots: snapshots.data ?? [],
      backups: backups.data ?? [],
      baselineName: baseline.data?.name ?? null,
      snapshot,
      drift: driftFor(row, snapshot, baseline.data?.rules),
    };
  });

export const saveDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid().nullable(), values: deviceInput }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoSaveDevice(data);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const v = data.values;
    const payload: Record<string, unknown> = {
      name: v.name,
      client_unit: v.client_unit,
      host: v.host,
      port: v.port,
      version: v.version ?? null,
      environment: v.environment,
      tags: v.tags,
      notes: v.notes ?? null,
    };
    if (v.api_key) payload["api_key_encrypted"] = await encryptSecret(v.api_key);

    if (data.id) {
      const { error } = await supabase
        .from("devices")
        .update(payload as never)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      await audit(supabase, userId, {
        action: "device.update",
        target_type: "device",
        target_id: data.id,
        details: { name: v.name, credential_changed: Boolean(v.api_key) },
      });
      return { id: data.id };
    }

    const { data: created, error } = await supabase
      .from("devices")
      .insert(payload as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(supabase, userId, {
      action: "device.create",
      target_type: "device",
      target_id: created.id,
      details: { name: v.name, host: v.host },
    });
    return { id: created.id };
  });

export const deleteDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoDeleteDevice(data.id);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin"]);
    const device = await supabase.from("devices").select("name").eq("id", data.id).maybeSingle();
    const { error } = await supabase.from("devices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, userId, {
      action: "device.delete",
      target_type: "device",
      target_id: data.id,
      severity: "critical",
      details: { name: device.data?.name ?? null },
    });
    return { ok: true };
  });

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoTestConnection(data.id);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const { data: row } = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Dispositivo não encontrado.");
    const result = await collectSnapshot(row as DeviceRow);
    await supabase
      .from("devices")
      .update({ status: result.ok ? "online" : "offline", last_error: result.error })
      .eq("id", data.id);
    await audit(supabase, userId, {
      action: "device.test_connection",
      target_type: "device",
      target_id: data.id,
      severity: result.ok ? "info" : "warning",
      details: { ok: result.ok, error: result.error },
    });
    return { ok: result.ok, message: result.error ?? "Conexão estabelecida com sucesso." };
  });

export const syncDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoSyncDevice(data.id);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const { data: row } = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Dispositivo não encontrado.");
    const result = await collectSnapshot(row as DeviceRow);
    const baseline = await supabase
      .from("baselines")
      .select("rules")
      .eq("is_default", true)
      .maybeSingle();
    const drift = driftFor(row as DeviceRow, result.snapshot, baseline.data?.rules);

    await supabase.from("device_snapshots").insert({
      device_id: data.id,
      provider: result.provider,
      ok: result.ok,
      payload: (result.snapshot ?? { error: result.error }) as never,
    });
    await supabase
      .from("devices")
      .update({
        status: result.ok ? "online" : "offline",
        version: result.snapshot?.version ?? (row as DeviceRow).version,
        last_sync_at: new Date().toISOString(),
        last_error: result.error,
        compliant: result.ok ? drift.length === 0 : (row as DeviceRow).compliant,
      })
      .eq("id", data.id);
    await audit(supabase, userId, {
      action: "device.sync",
      target_type: "device",
      target_id: data.id,
      severity: result.ok ? "info" : "warning",
      details: { ok: result.ok, drift: drift.length },
    });
    return { ok: result.ok, driftCount: drift.length, message: result.error };
  });

export const requestBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoRequestBackup(data.id);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const { data: row } = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Dispositivo não encontrado.");
    const { getPfSenseProvider } = await import("@/lib/pfsense/provider.server");
    const { toConnection } = await import("@/lib/fleet.server");
    const result = await getPfSenseProvider().requestBackup(await toConnection(row as DeviceRow));
    const previous = await supabase
      .from("device_backups")
      .select("content")
      .eq("device_id", data.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const previousContent = (previous.data as { content?: string | null } | null)?.content ?? "";
    const now = new Date().toISOString();
    const externalPath = await persistBackupFile({
      deviceName: (row as DeviceRow).name,
      filename: result.filename,
      content: result.content ?? "",
      createdAt: now,
    });
    await supabase.from("device_backups").insert({
      device_id: data.id,
      status: result.ok ? "success" : "failed",
      size_bytes: result.sizeBytes,
      filename: result.filename,
      requested_by: userId,
      content: result.content ?? null,
      diff_text: result.diff ?? backupDiffText(previousContent, result.content ?? ""),
      imported: false,
    });
    await supabase.from("devices").update({ last_backup_at: now }).eq("id", data.id);
    await audit(supabase, userId, {
      action: "device.backup",
      target_type: "device",
      target_id: data.id,
      details: { filename: result.filename, externalPath },
    });
    return { ok: result.ok, filename: result.filename, message: result.message };
  });

export const setFirewallRuleEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; ruleId: string; enabled: boolean }) =>
    z.object({ id: z.string().uuid(), ruleId: z.string().min(1), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoSetFirewallRuleEnabled(data.id, data.ruleId, data.enabled);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const { data: row } = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Dispositivo nao encontrado.");
    const { getPfSenseProvider } = await import("@/lib/pfsense/provider.server");
    const provider = getPfSenseProvider() as unknown as {
      setFirewallRuleEnabled?: (
        connection: Awaited<ReturnType<typeof toConnection>>,
        ruleId: string,
        enabled: boolean,
      ) => Promise<void>;
    };
    if (!provider.setFirewallRuleEnabled) throw new Error("Provider nao suporta alterar regras.");
    await provider.setFirewallRuleEnabled(await toConnection(row as DeviceRow), data.ruleId, data.enabled);
    await audit(supabase, userId, {
      action: data.enabled ? "firewall.rule.enable" : "firewall.rule.disable",
      target_type: "device",
      target_id: data.id,
      severity: "warning",
      details: { ruleId: data.ruleId },
    });
    return { ok: true };
  });

export const killVpnConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; parentId: string; connectionId: string }) =>
    z.object({
      id: z.string().uuid(),
      parentId: z.string().min(1),
      connectionId: z.string().min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoKillVpnConnection(data.id, data.parentId, data.connectionId);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const { data: row } = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Dispositivo nao encontrado.");
    const { getPfSenseProvider } = await import("@/lib/pfsense/provider.server");
    const provider = getPfSenseProvider() as unknown as {
      killOpenVpnConnection?: (
        connection: Awaited<ReturnType<typeof toConnection>>,
        parentId: string,
        connectionId: string,
      ) => Promise<void>;
    };
    if (!provider.killOpenVpnConnection) throw new Error("Provider nao suporta encerrar VPN.");
    await provider.killOpenVpnConnection(await toConnection(row as DeviceRow), data.parentId, data.connectionId);
    await audit(supabase, userId, {
      action: "vpn.connection.kill",
      target_type: "device",
      target_id: data.id,
      severity: "warning",
      details: { parentId: data.parentId, connectionId: data.connectionId },
    });
    return { ok: true };
  });

export const restartVpn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; type: "openvpn" | "wireguard" | "ipsec"; vpnId?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      type: z.enum(["openvpn", "wireguard", "ipsec"]),
      vpnId: z.string().min(1).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoRestartVpn(data.id, data.type, data.vpnId);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const { data: row } = await supabase
      .from("devices")
      .select(DEVICE_COLUMNS)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Dispositivo nao encontrado.");
    const { getPfSenseProvider } = await import("@/lib/pfsense/provider.server");
    const provider = getPfSenseProvider() as unknown as {
      restartVpn?: (
        connection: Awaited<ReturnType<typeof toConnection>>,
        type: "openvpn" | "wireguard" | "ipsec",
        vpnId?: string,
      ) => Promise<void>;
    };
    if (!provider.restartVpn) throw new Error("Provider nao suporta reiniciar VPN.");
    await provider.restartVpn(await toConnection(row as DeviceRow), data.type, data.vpnId ?? undefined);
    await audit(supabase, userId, {
      action: "vpn.restart",
      target_type: "device",
      target_id: data.id,
      severity: "warning",
      details: { type: data.type, vpnId: data.vpnId },
    });
    return { ok: true };
  });

export const getBackupContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoGetBackupContent(data.id);
    const { supabase } = context;
    const backup = await supabase
      .from("device_backups")
      .select("id,filename,content,diff_text")
      .eq("id", data.id)
      .maybeSingle();
    if (backup.error) throw new Error(backup.error.message);
    if (!backup.data) throw new Error("Backup nao encontrado.");
    return {
      id: backup.data.id,
      filename: backup.data.filename,
      content: (backup.data as { content?: string | null }).content ?? "",
      diff: (backup.data as { diff_text?: string | null }).diff_text ?? "",
    };
  });

export const getDirectViewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    if (LOCAL_DEMO_MODE) return demoDirectViewUrl(data.id);
    throw new Error("WebGUI Manager ainda nao esta habilitado no modo Supabase.");
  });

export const importBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deviceId: string; filename: string; content: string }) =>
    z.object({
      deviceId: z.string().uuid(),
      filename: z.string().trim().min(3).max(180),
      content: z.string().min(10).max(8_000_000),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoImportBackup(data.deviceId, data.filename, data.content);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const device = await supabase
      .from("devices")
      .select("name,host")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (device.error) throw new Error(device.error.message);
    if (!device.data) throw new Error("Dispositivo nao encontrado.");
    validateBackupBelongsToDevice(data.content, device.data as { name: string; host: string });
    const previous = await supabase
      .from("device_backups")
      .select("content")
      .eq("device_id", data.deviceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const diff = backupDiffText((previous.data as { content?: string | null } | null)?.content ?? "", data.content);
    const externalPath = await persistBackupFile({
      deviceName: (device.data as { name: string }).name,
      filename: data.filename,
      content: data.content,
      createdAt: new Date().toISOString(),
    });
    const { data: created, error } = await supabase
      .from("device_backups")
      .insert({
        device_id: data.deviceId,
        status: "success",
        size_bytes: data.content.length,
        filename: data.filename,
        requested_by: userId,
        content: data.content,
        diff_text: diff,
        imported: true,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(supabase, userId, {
      action: "device.backup.import",
      target_type: "device",
      target_id: data.deviceId,
      details: { filename: data.filename, size: data.content.length, externalPath },
    });
    return { ok: true, id: created.id };
  });

export const deleteBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoDeleteBackup(data.id);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    const backup = await supabase
      .from("device_backups")
      .select("id,device_id,filename")
      .eq("id", data.id)
      .maybeSingle();
    if (backup.error) throw new Error(backup.error.message);
    if (!backup.data) throw new Error("Backup nao encontrado.");
    const deviceId = (backup.data as { device_id: string }).device_id;
    const { error } = await supabase.from("device_backups").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const latest = await supabase
      .from("device_backups")
      .select("created_at")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await supabase
      .from("devices")
      .update({ last_backup_at: latest.data?.created_at ?? null })
      .eq("id", deviceId);
    await audit(supabase, userId, {
      action: "device.backup.delete",
      target_type: "device",
      target_id: deviceId,
      details: { backupId: data.id, filename: backup.data.filename },
      severity: "warning",
    });
    return { ok: true };
  });

export const listBaselines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoListBaselines();
    const { data, error } = await context.supabase
      .from("baselines")
      .select("id,name,description,is_default,rules,updated_at")
      .order("is_default", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveBaseline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().nullable(),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(300).nullable(),
        is_default: z.boolean(),
        rules: z.object({
          min_version: z.string().trim().min(1).max(20),
          required_services: z.array(z.string().trim().max(30)).max(20),
          required_aliases: z.array(z.string().trim().max(30)).max(20),
          max_uptime_days: z.number().int().min(1).max(3650),
          require_ntp: z.boolean(),
          require_dns_resolver: z.boolean(),
          forbid_default_password: z.boolean(),
        }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoSaveBaseline(data as never);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin"]);
    if (data.is_default) {
      await supabase
        .from("baselines")
        .update({ is_default: false })
        .neq("id", data.id ?? "");
    }
    const payload = {
      name: data.name,
      description: data.description,
      is_default: data.is_default,
      rules: data.rules as never,
    };
    if (data.id) {
      const { error } = await supabase.from("baselines").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("baselines").insert(payload);
      if (error) throw new Error(error.message);
    }
    await audit(supabase, userId, {
      action: data.id ? "baseline.update" : "baseline.create",
      target_type: "baseline",
      target_id: data.id ?? data.name,
      severity: "warning",
      details: { name: data.name },
    });
    return { ok: true };
  });

export const complianceReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { baselineId?: string | null }) =>
    z.object({ baselineId: z.string().uuid().nullable().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoComplianceReport();
    const { supabase } = context;
    const baselineQuery = supabase.from("baselines").select("id,name,rules");
    const baseline = data.baselineId
      ? await baselineQuery.eq("id", data.baselineId).maybeSingle()
      : await baselineQuery.eq("is_default", true).maybeSingle();

    const [devices, snapshots] = await Promise.all([
      supabase.from("devices").select("id,name,client_unit,version,environment,status,tags"),
      supabase
        .from("device_snapshots")
        .select("device_id,payload,collected_at")
        .order("collected_at", { ascending: false })
        .limit(1000),
    ]);

    const latestByDevice = new Map<string, PfSenseSnapshot>();
    for (const snap of snapshots.data ?? []) {
      if (!latestByDevice.has(snap.device_id) && snap.payload) {
        latestByDevice.set(snap.device_id, snap.payload as unknown as PfSenseSnapshot);
      }
    }

    const rows = (devices.data ?? []).map((d) => {
      const drift = driftFor(d, latestByDevice.get(d.id) ?? null, baseline.data?.rules);
      return {
        ...d,
        drift,
        highCount: drift.filter((x) => x.severity === "high").length,
        compliant: drift.length === 0,
      };
    });

    return {
      baseline: baseline.data ? { id: baseline.data.id, name: baseline.data.name } : null,
      rows,
    };
  });

export const listBackups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoListBackups();
    const { data, error } = await context.supabase
      .from("device_backups")
      .select("id,created_at,status,size_bytes,filename,imported,device_id,devices(name,client_unit)")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoListAuditLogs();
    const { data, error } = await context.supabase
      .from("audit_logs")
      .select("id,created_at,actor_email,action,target_type,target_id,severity,details")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoListTeam();
    const [profiles, roles] = await Promise.all([
      context.supabase.from("profiles").select("id,email,display_name,created_at"),
      context.supabase.from("user_roles").select("user_id,role"),
    ]);
    return (profiles.data ?? []).map((p) => ({
      ...p,
      roles: (roles.data ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
    }));
  });

export const listAgentHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (LOCAL_DEMO_MODE) return demoListAgentHealth();
    const { data, error } = await context.supabase
      .from("devices")
      .select("id,name,host,port")
      .order("name");
    if (error) throw new Error(error.message);
    return Promise.all(
      (data ?? []).map(async (device) => {
        const url = `https://${device.host}:${device.port}/fleet-guardian-agent.php?action=health`;
        const health = await fetchAgentHealth(url);
        return {
          deviceId: device.id,
          name: device.name,
          host: device.host,
          port: device.port,
          registered: health.ok,
          alive: health.ok,
          version: health.version,
          lastSeenAt: health.ok ? new Date().toISOString() : null,
          error: health.error,
        };
      }),
    );
  });

export const installAgentFromManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => agentInstallInput.parse(d))
  .handler(async ({ data, context }) => {
    if (LOCAL_DEMO_MODE) return demoInstallAgentFromManager(data);
    const { supabase, userId } = context;
    await assertRole(supabase, userId, ["admin", "operator"]);
    throw new Error("Instalacao via manager ainda nao esta habilitada no modo Supabase.");
  });

function backupDiffText(previous: string, current: string) {
  if (!previous) return "Primeiro backup registrado para este dispositivo.";
  if (previous === current) return "Sem alteracoes em relacao ao backup anterior.";
  const prevLines = new Set(previous.split(/\r?\n/));
  const currentLines = new Set(current.split(/\r?\n/));
  const added = [...currentLines].filter((line) => line && !prevLines.has(line)).slice(0, 120);
  const removed = [...prevLines].filter((line) => line && !currentLines.has(line)).slice(0, 120);
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
  const deviceDir = sanitizePathSegment(input.deviceName);
  const safeFilename = sanitizePathSegment(input.filename).replace(/_xml$/i, ".xml");
  const dir = path.join(root, deviceDir, date);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, safeFilename.endsWith(".xml") ? safeFilename : `${safeFilename}.xml`);
  await fs.writeFile(filePath, input.content, "utf8");
  return filePath;
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "backup";
}

function validateBackupBelongsToDevice(content: string, device: { name: string; host: string }) {
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
