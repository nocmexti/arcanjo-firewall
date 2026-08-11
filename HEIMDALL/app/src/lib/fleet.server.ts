import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { decryptSecret } from "@/lib/crypto.server";
import { getPfSenseProvider } from "@/lib/pfsense/provider.server";
import type { DeviceConnection, PfSenseSnapshot } from "@/lib/pfsense/types";
import { evaluateDrift, parseRules, type DriftItem } from "@/lib/baseline";

export type Client = SupabaseClient<Database>;
export type AppRole = "admin" | "operator" | "viewer";

export const DEVICE_COLUMNS =
  "id,name,client_unit,host,port,version,environment,tags,status,compliant,notes,last_sync_at,last_backup_at,last_error,created_at,updated_at,api_key_encrypted";

export type DeviceRow = Database["public"]["Tables"]["devices"]["Row"];
export type PublicDevice = Omit<DeviceRow, "api_key_encrypted"> & { has_credential: boolean };

/** Remove qualquer credencial antes de o registro sair do servidor. */
export function toPublicDevice(row: DeviceRow): PublicDevice {
  const { api_key_encrypted, ...rest } = row;
  return { ...rest, has_credential: Boolean(api_key_encrypted) };
}

export async function getRole(supabase: Client, userId: string): Promise<AppRole> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r) => r.role as AppRole);
  if (roles.includes("admin")) return "admin";
  if (roles.includes("operator")) return "operator";
  return "viewer";
}

export async function assertRole(
  supabase: Client,
  userId: string,
  allowed: AppRole[],
): Promise<AppRole> {
  const role = await getRole(supabase, userId);
  if (!allowed.includes(role)) {
    throw new Error(`Permissão negada: ação exige perfil ${allowed.join(" ou ")}.`);
  }
  return role;
}

export async function audit(
  supabase: Client,
  userId: string,
  entry: {
    action: string;
    target_type?: string;
    target_id?: string;
    severity?: "info" | "warning" | "critical";
    details?: Record<string, unknown>;
  },
) {
  const email = (await supabase.from("profiles").select("email").eq("id", userId).maybeSingle())
    .data?.email;
  await supabase.from("audit_logs").insert({
    actor_id: userId,
    actor_email: email ?? null,
    action: entry.action,
    target_type: entry.target_type ?? null,
    target_id: entry.target_id ?? null,
    severity: entry.severity ?? "info",
    details: (entry.details ?? {}) as never,
  });
}

export async function toConnection(row: DeviceRow): Promise<DeviceConnection> {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    apiKey: await decryptSecret(row.api_key_encrypted),
  };
}

export async function collectSnapshot(row: DeviceRow): Promise<{
  snapshot: PfSenseSnapshot | null;
  provider: string;
  ok: boolean;
  error: string | null;
}> {
  const provider = getPfSenseProvider();
  const connection = await toConnection(row);
  try {
    const test = await provider.testConnection(connection);
    if (!test.ok) {
      return { snapshot: null, provider: provider.kind, ok: false, error: test.message };
    }
    const snapshot = await provider.fetchSnapshot(connection);
    return { snapshot, provider: provider.kind, ok: true, error: null };
  } catch (error) {
    return {
      snapshot: null,
      provider: provider.kind,
      ok: false,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    };
  }
}

export function driftFor(
  device: { version: string | null },
  snapshot: PfSenseSnapshot | null,
  rules: unknown,
): DriftItem[] {
  return evaluateDrift({ version: device.version, snapshot }, parseRules(rules));
}
