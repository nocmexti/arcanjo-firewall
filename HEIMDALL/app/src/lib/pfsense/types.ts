/**
 * Contrato único de comunicação com um firewall pfSense.
 *
 * Toda a integração real fica isolada atrás desta interface. O app nunca fala
 * diretamente com um pfSense: sempre através de um PfSenseProvider.
 */

export type DeviceConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  /** Token/API key já descriptografado. Nunca sai do servidor. */
  apiKey: string | null;
  authType?: string | null;
  credentialId?: string | null;
  /** Ignorar verificação de certificado (labs com cert self-signed). */
  insecureTls?: boolean;
  agentSecret?: string | null;
};

export type PfInterface = {
  name: string;
  descr: string;
  ipaddr: string;
  subnet: string;
  gateway: string;
  status: "up" | "down";
};

export type PfGateway = {
  name: string;
  gateway: string;
  monitor: string;
  status: "online" | "offline" | "degraded";
  delayMs: number;
  lossPct: number;
};

export type PfGatewayGroup = {
  name: string;
  gateway: string;
  interface: string;
  tier: string;
  trigger: string;
};

export type PfAlias = { name: string; type: string; entries: number; values?: string[] };

export type PfRule = {
  id?: string;
  interface: string;
  action: "pass" | "block" | "reject";
  protocol: string;
  sourcePort: string;
  destinationPort: string;
  source: string;
  destination: string;
  descr: string;
  disabled?: boolean;
};

export type PfService = { name: string; status: "running" | "stopped"; enabled: boolean };

export type PfSystemResources = {
  cpuUsagePct: number | null;
  memoryUsagePct: number | null;
  diskUsagePct: number | null;
};

export type PfNatRule = {
  type: "port_forward" | "outbound";
  interface: string;
  protocol: string;
  source: string;
  destination: string;
  target: string;
  descr: string;
};

export type PfVpnStatus = {
  type: "openvpn" | "wireguard" | "ipsec";
  id?: string;
  name: string;
  status: string;
  remote: string;
  detail?: string;
  virtualAddress?: string;
  lastChange?: string;
  bytesSent?: string;
  bytesReceived?: string;
  peers?: number;
  listenPort?: string;
};

export type PfVpnConnection = {
  type: "openvpn" | "wireguard" | "ipsec";
  id: string;
  parentId: string;
  instance: string;
  user: string;
  realAddress: string;
  virtualAddress: string;
  connectedAt: string;
  bytesSent: string;
  bytesReceived: string;
  cipher: string;
};

export type PfDdnsEntry = {
  provider: string;
  hostname: string;
  status: string;
  interface: string;
  resolvedIp?: string;
  outboundIp?: string;
};

export type PfManagementConfig = {
  webguiPort: number | null;
  sshEnabled: boolean | null;
  sshPort: number | null;
  apiPort: number | null;
};

export type PfAutomationItem = {
  id?: string;
  name: string;
  type: "cron" | "script" | "monitoring";
  status: string;
  command: string;
  schedule?: string;
};

export type PfSenseSnapshot = {
  version: string;
  hostname: string;
  uptimeSeconds: number;
  resources?: PfSystemResources;
  interfaces: PfInterface[];
  gateways: PfGateway[];
  gatewayGroups?: PfGatewayGroup[];
  aliases: PfAlias[];
  firewallRules: PfRule[];
  natRules?: PfNatRule[];
  services: PfService[];
  vpns?: PfVpnStatus[];
  vpnConnections?: PfVpnConnection[];
  ddns?: PfDdnsEntry[];
  management?: PfManagementConfig;
  automation?: PfAutomationItem[];
  collectedAt: string;
  raw?: Record<string, unknown>;
  endpointErrors?: Record<string, string>;
};

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  version?: string | undefined;
  hostname?: string | undefined;
  message: string;
};

export type BackupResult = {
  ok: boolean;
  filename: string;
  sizeBytes: number;
  content?: string;
  diff?: string;
  message: string;
};

export interface PfSenseProvider {
  /** Identificador do provider, gravado junto do snapshot. */
  readonly kind: "mock" | "restapi";
  testConnection(device: DeviceConnection): Promise<ConnectionTestResult>;
  fetchSnapshot(device: DeviceConnection): Promise<PfSenseSnapshot>;
  requestBackup(device: DeviceConnection): Promise<BackupResult>;
}
