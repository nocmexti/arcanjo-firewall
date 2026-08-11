import type { PfSenseSnapshot } from "./pfsense/types";

export type BaselineRules = {
  min_version: string;
  required_services: string[];
  required_aliases: string[];
  max_uptime_days: number;
  require_ntp: boolean;
  require_dns_resolver: boolean;
  forbid_default_password: boolean;
};

export type DriftItem = {
  rule: string;
  label: string;
  severity: "high" | "medium" | "low";
  expected: string;
  actual: string;
};

export const DEFAULT_RULES: BaselineRules = {
  min_version: "2.7.2",
  required_services: ["sshd", "ntpd", "unbound"],
  required_aliases: [],
  max_uptime_days: 365,
  require_ntp: true,
  require_dns_resolver: true,
  forbid_default_password: true,
};

export function parseRules(raw: unknown): BaselineRules {
  const r = (raw ?? {}) as Partial<BaselineRules>;
  return { ...DEFAULT_RULES, ...r };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

type DriftInput = {
  version: string | null;
  snapshot: PfSenseSnapshot | null;
};

/** Compara um dispositivo (versão + último snapshot) com uma baseline. */
export function evaluateDrift(input: DriftInput, rules: BaselineRules): DriftItem[] {
  const drift: DriftItem[] = [];
  const version = input.snapshot?.version ?? input.version;

  if (!version) {
    drift.push({
      rule: "version",
      label: "Versão desconhecida",
      severity: "medium",
      expected: `>= ${rules.min_version}`,
      actual: "não coletada",
    });
  } else if (compareVersions(version, rules.min_version) < 0) {
    drift.push({
      rule: "version",
      label: "Versão abaixo do mínimo",
      severity: "high",
      expected: `>= ${rules.min_version}`,
      actual: version,
    });
  }

  const snap = input.snapshot;
  if (!snap) {
    drift.push({
      rule: "snapshot",
      label: "Sem coleta recente",
      severity: "low",
      expected: "snapshot disponível",
      actual: "nunca sincronizado",
    });
    return drift;
  }

  for (const svc of rules.required_services) {
    const found = snap.services.find((s) => s.name === svc);
    if (!found || found.status !== "running") {
      drift.push({
        rule: `service:${svc}`,
        label: `Serviço ${svc} fora do padrão`,
        severity: svc === "sshd" ? "medium" : "high",
        expected: "running",
        actual: found ? found.status : "ausente",
      });
    }
  }

  for (const alias of rules.required_aliases) {
    if (!snap.aliases.some((a) => a.name === alias)) {
      drift.push({
        rule: `alias:${alias}`,
        label: `Alias ${alias} ausente`,
        severity: "medium",
        expected: "presente",
        actual: "ausente",
      });
    }
  }

  const uptimeDays = Math.floor(snap.uptimeSeconds / 86400);
  if (uptimeDays > rules.max_uptime_days) {
    drift.push({
      rule: "uptime",
      label: "Uptime acima do limite (sem reinício após updates)",
      severity: "low",
      expected: `<= ${rules.max_uptime_days} dias`,
      actual: `${uptimeDays} dias`,
    });
  }

  if (rules.require_ntp && !snap.services.some((s) => s.name === "ntpd" && s.enabled)) {
    drift.push({
      rule: "ntp",
      label: "NTP não habilitado",
      severity: "medium",
      expected: "habilitado",
      actual: "desabilitado",
    });
  }

  if (rules.require_dns_resolver && !snap.services.some((s) => s.name === "unbound" && s.enabled)) {
    drift.push({
      rule: "dns",
      label: "DNS Resolver não habilitado",
      severity: "medium",
      expected: "habilitado",
      actual: "desabilitado",
    });
  }

  const anyAnyPass = snap.firewallRules.some(
    (r) => r.action === "pass" && r.source === "any" && r.destination === "any",
  );
  if (anyAnyPass) {
    drift.push({
      rule: "rule:any-any",
      label: "Regra permissiva any→any encontrada",
      severity: "high",
      expected: "nenhuma regra any→any",
      actual: "1 ou mais regras",
    });
  }

  const downGw = snap.gateways.filter((g) => g.status !== "online");
  if (downGw.length > 0) {
    drift.push({
      rule: "gateway",
      label: "Gateway degradado ou offline",
      severity: "high",
      expected: "todos online",
      actual: downGw.map((g) => `${g.name}=${g.status}`).join(", "),
    });
  }

  return drift;
}
