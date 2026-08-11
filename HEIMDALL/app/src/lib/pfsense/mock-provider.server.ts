import type {
  BackupResult,
  ConnectionTestResult,
  DeviceConnection,
  PfSenseProvider,
  PfSenseSnapshot,
} from "./types";

/** PRNG determinístico para que o mesmo dispositivo gere sempre o mesmo mock. */
function seedOf(input: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERSIONS = ["2.7.2", "2.7.2", "2.7.1", "2.7.0", "2.6.0", "24.03"];

function pick<T>(rnd: () => number, list: T[]): T {
  return list[Math.floor(rnd() * list.length)]!;
}

/**
 * Provider de desenvolvimento. Simula um pfSense com dados coerentes e
 * estáveis por dispositivo, incluindo falhas ocasionais de conexão.
 */
export class MockPfSenseProvider implements PfSenseProvider {
  readonly kind = "mock" as const;

  async testConnection(device: DeviceConnection): Promise<ConnectionTestResult> {
    const rnd = seedOf(`${device.host}:${device.port}`);
    const latencyMs = Math.round(8 + rnd() * 180);
    await new Promise((r) => setTimeout(r, Math.min(latencyMs, 120)));
    const fails = rnd() < 0.18;
    if (fails) {
      return {
        ok: false,
        latencyMs,
        message: `Falha ao conectar em ${device.host}:${device.port} (timeout na API REST)`,
      };
    }
    const version = pick(seedOf(device.host), VERSIONS);
    return {
      ok: true,
      latencyMs,
      version,
      hostname: device.name,
      message: `Conectado via pfSense REST API em ${latencyMs} ms`,
    };
  }

  async fetchSnapshot(device: DeviceConnection): Promise<PfSenseSnapshot> {
    const rnd = seedOf(device.host + device.name);
    const version = pick(seedOf(device.host), VERSIONS);
    const ifCount = 2 + Math.floor(rnd() * 3);
    const interfaces = Array.from({ length: ifCount }, (_, i) => ({
      name: ["wan", "lan", "opt1", "opt2", "vpn"][i] ?? `opt${i}`,
      descr: ["WAN", "LAN", "DMZ", "GUEST", "IPSEC"][i] ?? `OPT${i}`,
      ipaddr: i === 0 ? `200.${Math.floor(rnd() * 250)}.10.2` : `10.${10 + i}.0.1`,
      status: (rnd() < 0.93 ? "up" : "down") as "up" | "down",
    }));

    const gateways = [
      {
        name: "WAN_DHCP",
        monitor: "8.8.8.8",
        status: (rnd() < 0.9 ? "online" : "degraded") as "online" | "degraded",
        delayMs: Math.round(4 + rnd() * 60),
        lossPct: Math.round(rnd() * 3),
      },
    ];

    const aliasPool = ["RFC1918", "ADMIN_NETS", "BLOCKLIST", "VPN_PEERS", "SRV_WEB"];
    const aliases = aliasPool
      .filter(() => rnd() < 0.75)
      .map((name) => ({ name, type: "network", entries: 1 + Math.floor(rnd() * 40) }));

    const firewallRules = Array.from({ length: 5 + Math.floor(rnd() * 10) }, (_, i) => ({
      interface: pick(rnd, ["wan", "lan", "opt1"]),
      action: pick(rnd, ["pass", "block", "reject"] as const),
      protocol: pick(rnd, ["tcp", "udp", "icmp", "any"]),
      source: pick(rnd, ["any", "LAN net", "RFC1918", "ADMIN_NETS"]),
      destination: pick(rnd, ["any", "WAN address", "SRV_WEB", "10.0.0.0/8"]),
      descr: `Regra ${i + 1} — ${pick(rnd, ["acesso admin", "saída internet", "bloqueio", "vpn site-to-site"])}`,
    }));

    const servicePool = ["sshd", "ntpd", "unbound", "dhcpd", "openvpn", "haproxy"];
    const services = servicePool.map((name) => ({
      name,
      enabled: rnd() < 0.85,
      status: (rnd() < 0.88 ? "running" : "stopped") as "running" | "stopped",
    }));

    return {
      version,
      hostname: device.name,
      uptimeSeconds: Math.floor(rnd() * 400 * 86400),
      interfaces,
      gateways,
      aliases,
      firewallRules,
      services,
      collectedAt: new Date().toISOString(),
    };
  }

  async requestBackup(device: DeviceConnection): Promise<BackupResult> {
    const rnd = seedOf(device.host + "backup" + Date.now());
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return {
      ok: true,
      filename: `config-${device.name}-${stamp}.xml`,
      sizeBytes: 160000 + Math.floor(rnd() * 120000),
      message: "Backup de configuração gerado (mock).",
    };
  }
}
