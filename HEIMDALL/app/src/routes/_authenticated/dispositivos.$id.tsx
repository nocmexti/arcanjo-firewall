import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, PlugZap, RefreshCw, Archive, KeyRound, Loader2, Copy, Eye, Ban, ExternalLink, Download, Upload, Trash2 } from "lucide-react";
import {
  deleteBackup,
  getDeviceDetail,
  getDirectViewUrl,
  getBackupContent,
  importBackup,
  killVpnConnection,
  requestBackup,
  restartVpn,
  setFirewallRuleEnabled,
  syncDevice,
  testConnection,
} from "@/lib/fleet.functions";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatusBadge,
  ComplianceBadge,
  SeverityBadge,
  formatDateTime,
  formatBytes,
} from "@/components/fleet/ui-kit";
import { useSession, canAccess } from "@/components/fleet/device-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/dispositivos/$id")({
  head: () => ({
    meta: [
      { title: "Detalhes do dispositivo - HEIMDALL" },
      {
        name: "description",
        content: "Snapshot completo do dispositivo: interfaces, gateways, aliases, regras e servicos.",
      },
      { property: "og:title", content: "Detalhes do dispositivo - HEIMDALL" },
      {
        property: "og:description",
        content: "Snapshot completo do dispositivo: interfaces, gateways, aliases, regras e servicos.",
      },
    ],
  }),
  component: DeviceDetail,
});

function DeviceDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const session = useSession();
  const canWrite = canAccess(session.data?.role, 'admin') || canAccess(session.data?.role, 'operator');

  const detailFn = useServerFn(getDeviceDetail);
  const testFn = useServerFn(testConnection);
  const syncFn = useServerFn(syncDevice);
  const backupFn = useServerFn(requestBackup);
  const setRuleFn = useServerFn(setFirewallRuleEnabled);
  const killVpnFn = useServerFn(killVpnConnection);
  const restartVpnFn = useServerFn(restartVpn);
  const getBackupFn = useServerFn(getBackupContent);
  const importBackupFn = useServerFn(importBackup);
  const deleteBackupFn = useServerFn(deleteBackup);
  const directViewFn = useServerFn(getDirectViewUrl);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [suppressedRuleGroups, setSuppressedRuleGroups] = useState<Record<string, boolean>>({});

  const detail = useQuery({
    queryKey: ["device", id],
    queryFn: () => detailFn({ data: { id } }),
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { id } }),
    onSuccess: (res) => {
      res.ok ? toast.success(res.message) : toast.error(res.message);
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: (input?: { silent?: boolean }) =>
      syncFn({ data: { id } }).then((res) => ({ ...res, silent: input?.silent })),
    onSuccess: (res) => {
      if (!res.silent) {
        res.ok
          ? toast.success(`Snapshot coletado - ${res.driftCount} desvio(s).`)
          : toast.error(res.message ?? "Falha ao sincronizar");
      }
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const backup = useMutation({
    mutationFn: () => backupFn({ data: { id } }),
    onSuccess: (res) => {
      res.ok ? toast.success(`Backup gerado: ${res.filename}`) : toast.error(res.message ?? "Falha");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setRule = useMutation({
    mutationFn: (input: { ruleId: string; enabled: boolean }) =>
      setRuleFn({ data: { id, ruleId: input.ruleId, enabled: input.enabled } }),
    onSuccess: () => {
      toast.success("Regra atualizada no dispositivo.");
      sync.mutate({ silent: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const killVpn = useMutation({
    mutationFn: (input: { parentId: string; connectionId: string }) =>
      killVpnFn({ data: { id, parentId: input.parentId, connectionId: input.connectionId } }),
    onSuccess: () => {
      toast.success("Conexao VPN encerrada.");
      sync.mutate({ silent: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const restartVpnMutation = useMutation({
    mutationFn: (input: { type: "openvpn" | "wireguard" | "ipsec"; vpnId?: string | null }) =>
      restartVpnFn({ data: { id, type: input.type, vpnId: input.vpnId ?? null } }),
    onSuccess: () => {
      toast.success("VPN reiniciada.");
      sync.mutate({ silent: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const backupContent = useMutation({
    mutationFn: (backupId: string) => getBackupFn({ data: { id: backupId } }),
    onError: (e: Error) => toast.error(e.message),
  });
  const importBackupMutation = useMutation({
    mutationFn: (input: { filename: string; content: string }) =>
      importBackupFn({ data: { deviceId: id, filename: input.filename, content: input.content } }),
    onSuccess: () => {
      toast.success("Backup importado para o historico.");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteBackupMutation = useMutation({
    mutationFn: (backupId: string) => deleteBackupFn({ data: { id: backupId } }),
    onSuccess: () => {
      toast.success("Backup removido do historico.");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const directView = useMutation({
    mutationFn: () => directViewFn({ data: { id } }),
    onSuccess: (res) => {
      window.open(res.url, "_blank", "noopener,noreferrer");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!canWrite) return undefined;
    const timer = window.setInterval(() => {
      if (!sync.isPending) sync.mutate({ silent: true });
    }, 60000);
    return () => window.clearInterval(timer);
  }, [canWrite, id]);

  if (detail.isLoading) return <LoadingState />;
  if (detail.error) return <ErrorState message={(detail.error as Error).message} />;
  if (!detail.data) return <EmptyState label="Dispositivo nao encontrado" />;

  const { device, snapshot, drift, backups, snapshots, baselineName } = detail.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={device.name}
        description={`${device.client_unit} - ${device.host}:${device.port} - ambiente ${device.environment}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dispositivos">
                <ArrowLeft className="mr-1 size-4" /> Inventory
              </Link>
            </Button>
            <Button size="sm" variant="outline" disabled={!canWrite || test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <PlugZap className="mr-1 size-4" />}
              Testar conexao
            </Button>
            <Button size="sm" disabled={!canWrite || sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <RefreshCw className="mr-1 size-4" />}
              Sincronizar
            </Button>
            <Button size="sm" variant="outline" disabled={directView.isPending} onClick={() => directView.mutate()}>
              {directView.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <ExternalLink className="mr-1 size-4" />}
              WebGUI Manager
            </Button>
            <Button size="sm" variant="outline" disabled={!canWrite || backup.isPending} onClick={() => backup.mutate()}>
              {backup.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Archive className="mr-1 size-4" />}
              Backup
            </Button>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <InfoTile label="Status">
          <StatusBadge status={device.status} />
        </InfoTile>
        <InfoTile label="Compliance">
          <ComplianceBadge compliant={device.compliant !== false} count={drift.length} />
        </InfoTile>
        <InfoTile label="Versao">
          <span className="numeric text-sm">{device.version ?? "-"}</span>
        </InfoTile>
        <InfoTile label="Credencial">
          <span className="inline-flex items-center gap-1 text-sm">
            <KeyRound className="size-3.5 text-muted-foreground" />
            {device.has_credential ? "API key armazenada" : "nao configurada"}
          </span>
        </InfoTile>
      </div>

      {device.last_error && (
        <p className="panel border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Ultimo erro: {device.last_error}
        </p>
      )}

      <Tabs defaultValue="visao">
        <TabsList>
          <TabsTrigger value="visao">Overview</TabsTrigger>
          <TabsTrigger value="rede">Network</TabsTrigger>
          <TabsTrigger value="firewall">Rules</TabsTrigger>
          <TabsTrigger value="vpn">VPN/DDNS</TabsTrigger>
          <TabsTrigger value="automacao">Automation</TabsTrigger>
          <TabsTrigger value="drift">Drift ({drift.length})</TabsTrigger>
          <TabsTrigger value="backups">Backups ({backups.length})</TabsTrigger>
          <TabsTrigger value="snapshots">Collections</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="space-y-4">
          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Dados coletados</h2>
            {!snapshot ? (
              <EmptyState label="Nenhum snapshot coletado" hint="Execute uma sincronizacao para popular os dados." />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <Row label="Hostname" value={snapshot.hostname} />
                <Row label="Versao" value={snapshot.version} />
                <Row
                  label="Uptime"
                  value={
                    Number.isFinite(snapshot.uptimeSeconds)
                      ? `${Math.round(snapshot.uptimeSeconds / 86400)} dias`
                      : "-"
                  }
                />
                <Row label="Coletado em" value={formatDateTime(snapshot.collectedAt)} />
                <Row label="Baseline padrao" value={baselineName ?? "-"} />
                <Row label="Ultimo backup" value={formatDateTime(device.last_backup_at)} />
                <Row label="CPU" value={formatPct(snapshot.resources?.cpuUsagePct)} />
                <Row label="Memoria" value={formatPct(snapshot.resources?.memoryUsagePct)} />
                <Row label="Disco" value={formatPct(snapshot.resources?.diskUsagePct)} />
                <Row label="Porta API" value={formatNumber(snapshot.management?.apiPort)} />
                <Row label="Porta WebGUI" value={formatNumber(snapshot.management?.webguiPort)} />
                <Row label="SSH" value={formatSsh(snapshot.management)} />
              </dl>
            )}
          </section>
          <section className="panel p-4">
            <h2 className="mb-2 text-sm font-semibold">Servicos</h2>
            <div className="flex flex-wrap gap-2">
              {(snapshot?.services ?? []).map((s) => (
                <Badge
                  key={s.name}
                  variant="outline"
                  className={
                    s.status === "running"
                      ? "border-success/40 bg-success/15 text-success"
                      : "border-destructive/40 bg-destructive/15 text-destructive"
                  }
                >
                  {s.name} - {s.status}
                </Badge>
              ))}
              {!snapshot?.services?.length && <p className="text-sm text-muted-foreground">-</p>}
            </div>
          </section>
          {device.notes && (
            <section className="panel p-4">
              <h2 className="mb-2 text-sm font-semibold">Observacoes</h2>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{device.notes}</p>
            </section>
          )}
        </TabsContent>

        <TabsContent value="rede" className="space-y-4">
          <SimpleTable
            title="Interfaces"
            head={["Nome", "Descricao", "IP", "Mascara", "Gateway", "Status"]}
            rows={(snapshot?.interfaces ?? []).map((i) => [
              i.name,
              i.descr,
              i.ipaddr ?? "-",
              i.subnet ?? "-",
              i.gateway ?? "-",
              i.status,
            ])}
          />
          <SimpleTable
            title="Gateways"
            head={["Nome", "Gateway", "Monitor", "Status", "Latencia", "Perda"]}
            rows={(snapshot?.gateways ?? []).map((g) => [
              g.name,
              g.gateway,
              g.monitor,
              g.status,
              `${g.delayMs} ms`,
              `${g.lossPct}%`,
            ])}
          />
          <SimpleTable
            title="Gateway LB"
            head={["Grupo", "Gateway", "Interface", "Tier", "Trigger"]}
            rows={(snapshot?.gatewayGroups ?? []).map((g) => [g.name, g.gateway, g.interface, g.tier, g.trigger])}
          />
        </TabsContent>

        <TabsContent value="firewall" className="space-y-4">
          <AliasTable aliases={snapshot?.aliases ?? []} />
          <GroupedRuleTable
            rules={snapshot?.firewallRules ?? []}
            canWrite={canWrite}
            busy={setRule.isPending}
            suppressed={suppressedRuleGroups}
            onToggleSuppressed={(group) =>
              setSuppressedRuleGroups((current) => ({ ...current, [group]: !current[group] }))
            }
            onSetEnabled={(ruleId, enabled) => setRule.mutate({ ruleId, enabled })}
          />
          <SimpleTable
            title="NAT"
            head={["Tipo", "Interface", "Protocolo", "Origem", "Destino", "Alvo", "Descricao"]}
            rows={natRows(snapshot)}
          />
        </TabsContent>

        <TabsContent value="vpn" className="space-y-4">
          <VpnTechnologyPanels
            vpns={snapshot?.vpns ?? []}
            canWrite={canWrite}
            busy={restartVpnMutation.isPending}
            onRestart={(type, vpnId) => restartVpnMutation.mutate({ type, vpnId })}
          />
          <VpnConnectionTable
            connections={(snapshot?.vpnConnections ?? []).filter((connection) => connection.type !== "ipsec")}
            canWrite={canWrite}
            busy={killVpn.isPending}
            onKill={(parentId, connectionId) => killVpn.mutate({ parentId, connectionId })}
          />
          <SimpleTable
            title="DDNS"
            head={["Provider", "Hostname", "Cache config", "DNS resolve", "IP saida", "Interface"]}
            rows={(snapshot?.ddns ?? []).map((d) => [
              d.provider,
              d.hostname,
              d.status,
              d.resolvedIp ?? "-",
              d.outboundIp ?? "-",
              d.interface,
            ])}
          />
        </TabsContent>

        <TabsContent value="automacao" className="space-y-4">
          <SimpleTable
            title="Cron, backups e monitoria"
            head={["Tipo", "Nome", "Status", "Horario", "Comando"]}
            rows={(snapshot?.automation ?? []).map((a) => [a.type, a.name, a.status, a.schedule ?? "-", a.command])}
          />
          <SimpleTable
            title="Checklist de gerencia"
            head={["Item", "Valor"]}
            rows={[
              ["Porta API", formatNumber(snapshot?.management?.apiPort)],
              ["Porta WebGUI", formatNumber(snapshot?.management?.webguiPort)],
              ["SSH", formatSsh(snapshot?.management)],
              [
                "Zabbix",
                zabbixStatus(snapshot),
              ],
              [
                "Cron urltables",
                (snapshot?.automation ?? []).some((a) => /\/usr\/bin\/nice -n20 \/etc\/rc\.update_urltables/.test(a.command))
                  ? "presente"
                  : "ausente",
              ],
              [
                "Script backup",
                (snapshot?.automation ?? []).some((a) => /\/cf\/conf\/backup\/bkp\/script\/bkpmex\.sh/.test(a.command))
                  ? "presente"
                  : "ausente",
              ],
              ["Alias gerencia", hasManagementAlias(snapshot) ? "presente" : "ausente"],
              ["Portas gerencia", managementPortsStatus(snapshot)],
              [
                "Regra gerencia",
                hasManagementRule(snapshot)
                  ? "presente"
                  : "ausente",
              ],
            ]}
          />
        </TabsContent>

        <TabsContent value="drift">
          <section className="panel overflow-hidden">
            {drift.length === 0 ? (
              <EmptyState label="Dispositivo conforme o baseline" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item fora do padrao</TableHead>
                    <TableHead>Esperado</TableHead>
                    <TableHead>Encontrado</TableHead>
                    <TableHead>Acao sugerida</TableHead>
                    <TableHead>Severidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drift.map((d, i) => (
                    <TableRow key={`${d.rule}-${i}`}>
                      <TableCell className="font-medium">{d.rule}</TableCell>
                      <TableCell className="numeric text-muted-foreground">{d.expected}</TableCell>
                      <TableCell className="numeric">{d.actual}</TableCell>
                      <TableCell className="text-muted-foreground">{driftAction(d.rule)}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={d.severity} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="backups">
          <BackupTable
            backups={backups}
            loading={backupContent.isPending}
            selected={backupContent.data}
            onView={(backupId) => backupContent.mutate(backupId)}
            onDownload={(backupId) => {
              getBackupFn({ data: { id: backupId } }).then((data) => downloadText(data.filename, data.content));
            }}
            onDelete={(backupId) => deleteBackupMutation.mutate(backupId)}
            canWrite={canWrite}
            deleting={deleteBackupMutation.isPending}
            onImportClick={() => importInputRef.current?.click()}
          />
          <input
            ref={importInputRef}
            type="file"
            accept=".xml,text/xml"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const content = await file.text();
              importBackupMutation.mutate({ filename: file.name, content });
              event.currentTarget.value = "";
            }}
          />
        </TabsContent>

        <TabsContent value="snapshots">
          <section className="panel overflow-hidden">
            {snapshots.length === 0 ? (
              <EmptyState label="Nenhuma coleta registrada" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Resultado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{formatDateTime(s.collected_at)}</TableCell>
                      <TableCell className="numeric">{s.provider}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.ok ? "online" : "offline"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="raw" className="space-y-4">
          <section className="panel overflow-hidden">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Snapshot bruto</h2>
                <p className="text-xs text-muted-foreground">
                  JSON coletado dos endpoints, com campos sensiveis mascarados.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!snapshot}
                onClick={() => {
                  navigator.clipboard.writeText(rawSnapshotText(snapshot));
                  toast.success("Raw copiado.");
                }}
              >
                <Copy className="mr-1 size-4" />
                Copiar
              </Button>
            </header>
            {snapshot ? (
              <pre className="max-h-[560px] overflow-auto p-4 text-xs leading-relaxed text-muted-foreground">
                {rawSnapshotText(snapshot)}
              </pre>
            ) : (
              <EmptyState label="Nenhum snapshot coletado" />
            )}
          </section>
          {snapshot?.endpointErrors && Object.keys(snapshot.endpointErrors).length > 0 && (
            <SimpleTable
              title="Erros por endpoint"
              head={["Endpoint", "Erro"]}
              rows={Object.entries(snapshot.endpointErrors).map(([key, value]) => [key, value])}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="numeric mt-0.5">{value}</dd>
    </div>
  );
}

function AliasTable({
  aliases,
}: {
  aliases: Array<{ name: string; type: string; entries: number; values?: string[] }>;
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Entradas dos aliases</h2>
      </header>
      {aliases.length === 0 ? (
        <EmptyState label="Sem dados coletados" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Entradas</TableHead>
                <TableHead>Acao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map((alias) => (
                <TableRow key={alias.name}>
                  <TableCell className="font-medium">{alias.name}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{alias.type}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{alias.entries}</TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <Eye className="mr-1 size-4" />
                          Ver
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>{alias.name}</DialogTitle>
                          <DialogDescription>{alias.type} - {alias.entries} entrada(s)</DialogDescription>
                        </DialogHeader>
                        <pre className="max-h-[420px] overflow-auto rounded border bg-background p-3 text-xs">
                          {(alias.values?.length ? alias.values : ["-"]).join("\n")}
                        </pre>
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function GroupedRuleTable({
  rules,
  canWrite,
  busy,
  suppressed,
  onToggleSuppressed,
  onSetEnabled,
}: {
  rules: Array<{
    id?: string;
    interface: string;
    action: string;
    protocol: string;
    source: string;
    sourcePort: string;
    destination: string;
    destinationPort: string;
    descr: string;
    disabled?: boolean;
  }>;
  canWrite: boolean;
  busy: boolean;
  suppressed: Record<string, boolean>;
  onToggleSuppressed: (group: string) => void;
  onSetEnabled: (ruleId: string, enabled: boolean) => void;
}) {
  const groups = useMemo(() => groupRulesByInterface(rules), [rules]);
  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <section className="panel overflow-hidden">
          <EmptyState label="Sem dados coletados" />
        </section>
      ) : (
        groups.map((group) => {
          const hidden = Boolean(suppressed[group.name]);
          return (
            <section key={group.name} className="panel overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Rules - {group.label}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {group.rules.length} regra(s), {group.disabled} desabilitada(s), {group.blocked} bloqueio(s)
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onToggleSuppressed(group.name)}>
                  {hidden ? <Eye className="mr-1 size-4" /> : <Ban className="mr-1 size-4" />}
                  {hidden ? "Mostrar" : "Suprimir"}
                </Button>
              </header>
              {hidden ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">
                  Quadro suprimido nesta sessao. Use Mostrar para exibir as regras de {group.label}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Acao</TableHead>
                        <TableHead>Protocolo</TableHead>
                        <TableHead>Origem</TableHead>
                        <TableHead>Porta origem</TableHead>
                        <TableHead>Destino</TableHead>
                        <TableHead>Porta destino</TableHead>
                        <TableHead>Descricao</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rules.map((rule, index) => (
                        <TableRow key={`${group.name}-${rule.id ?? index}-${rule.descr}`}>
                          <TableCell className="numeric text-muted-foreground">
                            {rule.disabled ? "disabled" : rule.action}
                          </TableCell>
                          <TableCell className="numeric text-muted-foreground">{rule.protocol}</TableCell>
                          <TableCell className="numeric text-muted-foreground">{rule.source}</TableCell>
                          <TableCell className="numeric text-muted-foreground">{rule.sourcePort}</TableCell>
                          <TableCell className="numeric text-muted-foreground">{rule.destination}</TableCell>
                          <TableCell className="numeric text-muted-foreground">{rule.destinationPort}</TableCell>
                          <TableCell className="numeric text-muted-foreground">{rule.descr}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!canWrite || busy || !rule.id}
                              onClick={() => rule.id && onSetEnabled(rule.id, Boolean(rule.disabled))}
                            >
                              {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Ban className="mr-1 size-4" />}
                              {rule.disabled ? "Habilitar" : "Desabilitar"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function groupRulesByInterface(
  rules: Array<{
    interface: string;
    action: string;
    disabled?: boolean;
  }>,
) {
  const order = ["wan", "lan", "openvpn", "ipsec", "wireguard", "floating"];
  const byInterface = new Map<string, typeof rules>();
  for (const rule of rules) {
    const key = normalizeRuleGroup(rule.interface);
    byInterface.set(key, [...(byInterface.get(key) ?? []), rule]);
  }
  return [...byInterface.entries()]
    .sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    })
    .map(([name, groupRules]) => ({
      name,
      label: name.toUpperCase(),
      rules: groupRules,
      disabled: groupRules.filter((rule) => rule.disabled).length,
      blocked: groupRules.filter((rule) => rule.action === "block" || rule.action === "reject").length,
    }));
}

function normalizeRuleGroup(value: string) {
  const first = String(value || "unknown").split(",")[0]?.trim().toLowerCase() || "unknown";
  if (first === "floating" || first === "true") return "floating";
  return first;
}

function VpnTechnologyPanels({
  vpns,
  canWrite,
  busy,
  onRestart,
}: {
  vpns: Array<{
    id?: string;
    type: "openvpn" | "wireguard" | "ipsec" | string;
    name: string;
    status: string;
    remote: string;
    detail?: string;
    virtualAddress?: string;
    lastChange?: string;
    bytesSent?: string;
    bytesReceived?: string;
    peers?: number;
  }>;
  canWrite: boolean;
  busy: boolean;
  onRestart: (type: "openvpn" | "wireguard" | "ipsec", vpnId?: string | null) => void;
}) {
  const groups = [
    { type: "openvpn" as const, title: "OpenVPN", hint: "Instancias site-to-site e servidores de acesso remoto" },
    { type: "ipsec" as const, title: "IPsec site-to-site", hint: "Phase 1 monitorado pelo agente" },
    { type: "wireguard" as const, title: "WireGuard", hint: "Tuneis e peers com handshake recente" },
  ];

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const rows = vpns.filter((vpn) => vpn.type === group.type);
        const online = rows.filter((vpn) => normalizeVpnUiStatus(vpn.status) === "online").length;
        const offline = rows.filter((vpn) => normalizeVpnUiStatus(vpn.status) === "offline").length;
        const stale = rows.filter((vpn) => normalizeVpnUiStatus(vpn.status) === "stale").length;
        return (
          <section key={group.type} className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">{group.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{group.hint}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{rows.length} total</Badge>
                <Badge className="border-emerald-700/60 bg-emerald-500/15 text-emerald-300">{online} online</Badge>
                {stale > 0 && <Badge className="border-amber-700/60 bg-amber-500/15 text-amber-300">{stale} sem handshake</Badge>}
                {offline > 0 && <Badge className="border-red-700/60 bg-red-500/15 text-red-300">{offline} offline</Badge>}
              </div>
            </header>
            {rows.length === 0 ? (
              <EmptyState label={`Nenhuma VPN ${group.title} coletada`} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">Status</TableHead>
                      <TableHead className="min-w-[260px]">Nome</TableHead>
                      <TableHead className="min-w-[160px]">Remoto</TableHead>
                      <TableHead>Detalhe</TableHead>
                      <TableHead>Uptime/evento</TableHead>
                      <TableHead>RX / TX</TableHead>
                      <TableHead className="w-[72px]">Acao</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((vpn) => (
                      <TableRow key={`${vpn.type}-${vpn.id ?? vpn.name}-${vpn.remote}`}>
                        <TableCell>
                          <VpnStatusBadge status={vpn.status} />
                        </TableCell>
                        <TableCell className="max-w-[420px] font-medium leading-tight" title={vpn.name}>
                          {vpn.name}
                        </TableCell>
                        <TableCell className="max-w-[320px] break-words text-muted-foreground" title={vpn.remote}>
                          {vpn.remote}
                        </TableCell>
                        <TableCell className="max-w-[260px] text-muted-foreground" title={vpn.detail ?? ""}>
                          {vpnDetail(vpn)}
                        </TableCell>
                        <TableCell className="numeric text-muted-foreground">{vpn.lastChange ?? "-"}</TableCell>
                        <TableCell className="numeric text-muted-foreground">
                          {vpn.bytesReceived || vpn.bytesSent ? `${vpn.bytesReceived ?? "-"} / ${vpn.bytesSent ?? "-"}` : "-"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canWrite || busy}
                            onClick={() => onRestart(group.type, vpn.id ?? vpn.name)}
                            title={`Reiniciar ${vpn.name}`}
                          >
                            {busy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                            <span className="sr-only">Reiniciar</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function VpnStatusBadge({ status }: { status: string }) {
  const normalized = normalizeVpnUiStatus(status);
  const label =
    normalized === "online"
      ? "Online"
      : normalized === "stale"
        ? "Sem handshake"
      : normalized === "offline"
        ? "Offline"
        : normalized === "disabled"
          ? "Desabilitada"
          : "Offline";
  const className =
    normalized === "online"
      ? "border-emerald-700/60 bg-emerald-500/15 text-emerald-300"
      : normalized === "stale"
        ? "border-amber-700/60 bg-amber-500/15 text-amber-300"
      : normalized === "offline"
        ? "border-red-700/60 bg-red-500/15 text-red-300"
        : normalized === "disabled"
          ? "border-slate-700 bg-slate-500/15 text-slate-300"
          : "border-amber-700/60 bg-amber-500/15 text-amber-300";
  return <Badge className={className}>{label}</Badge>;
}

function normalizeVpnUiStatus(status: string) {
  const normalized = status.toLowerCase();
  if (["online", "stale", "offline", "disabled"].includes(normalized)) return normalized;
  if (/connected|established|active|running|up/.test(normalized)) return "online";
  if (/handshake|stale|antigo/.test(normalized)) return "stale";
  if (/disabled|disable/.test(normalized)) return "disabled";
  return "offline";
}

function vpnDetail(vpn: {
  detail?: string;
  virtualAddress?: string;
  peers?: number;
  type: "openvpn" | "wireguard" | "ipsec" | string;
}) {
  const parts = [
    vpn.detail,
    vpn.virtualAddress ? `virtual ${vpn.virtualAddress}` : undefined,
    typeof vpn.peers === "number" && vpn.type === "wireguard" ? `${vpn.peers} peers` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" - ") : "-";
}

function VpnConnectionTable({
  connections,
  canWrite,
  busy,
  onKill,
}: {
  connections: Array<{
    id: string;
    parentId: string;
    type: string;
    instance: string;
    user: string;
    realAddress: string;
    virtualAddress: string;
    connectedAt: string;
    bytesSent: string;
    bytesReceived: string;
    cipher: string;
  }>;
  canWrite: boolean;
  busy: boolean;
  onKill: (parentId: string, connectionId: string) => void;
}) {
  const openvpnConnections = connections.filter((connection) => connection.type === "openvpn");
  const wireguardPeers = connections.filter((connection) => connection.type === "wireguard");

  return (
    <section className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Acessos remotos e peers ativos</h2>
          <p className="mt-1 text-xs text-muted-foreground">OpenVPN usuario remoto e peers WireGuard coletados pelo agente.</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline">{openvpnConnections.length} usuarios</Badge>
          <Badge variant="outline">{wireguardPeers.length} peers WG</Badge>
        </div>
      </header>
      {connections.length === 0 ? (
        <EmptyState label="Sem acessos remotos coletados" hint="Atualize o agente HEIMDALL e sincronize o dispositivo." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Instancia</TableHead>
                <TableHead>Usuario/peer</TableHead>
                <TableHead>IP real</TableHead>
                <TableHead>IP virtual</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead>RX / TX</TableHead>
                <TableHead>Cifra</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <TableRow key={`${connection.parentId}-${connection.id}-${connection.user}`}>
                  <TableCell className="font-medium">{connection.type}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{connection.instance}</TableCell>
                  <TableCell className="numeric">{connection.user}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{connection.realAddress}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{connection.virtualAddress}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{connection.connectedAt}</TableCell>
                  <TableCell className="numeric text-muted-foreground">
                    {connection.bytesReceived} / {connection.bytesSent}
                  </TableCell>
                  <TableCell className="numeric text-muted-foreground">{connection.cipher}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canWrite || busy || connection.type !== "openvpn"}
                      onClick={() => onKill(connection.parentId, connection.id)}
                    >
                      {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Ban className="mr-1 size-4" />}
                      Kill
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function BackupTable({
  backups,
  loading,
  selected,
  onView,
  onDownload,
  onDelete,
  canWrite,
  deleting,
  onImportClick,
}: {
  backups: Array<{
    id: string;
    filename: string | null;
    created_at: string;
    size_bytes: number | null;
    status: string;
    imported?: boolean | null;
  }>;
  loading: boolean;
  selected?: { id: string; filename: string; content: string; diff: string };
  onView: (backupId: string) => void;
  onDownload: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  canWrite: boolean;
  deleting: boolean;
  onImportClick: () => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Historico de backups</h2>
        <Button size="sm" variant="outline" onClick={onImportClick}>
          <Upload className="mr-1 size-4" />
          Importar antigo
        </Button>
      </header>
      {backups.length === 0 ? (
        <EmptyState label="Nenhum backup registrado" hint="Solicite ou importe um backup de configuracao." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Tamanho</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((backup) => (
                <TableRow key={backup.id}>
                  <TableCell className="numeric">{backup.filename ?? "-"}</TableCell>
                  <TableCell>{formatDateTime(backup.created_at)}</TableCell>
                  <TableCell className="numeric">{formatBytes(backup.size_bytes ?? 0)}</TableCell>
                  <TableCell className="numeric text-muted-foreground">
                    {backup.imported ? "importado" : "coletado"}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={backup.status === "success" ? "info" : "high"} />
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => onView(backup.id)}>
                          {loading && selected?.id !== backup.id ? (
                            <Loader2 className="mr-1 size-4 animate-spin" />
                          ) : (
                            <Eye className="mr-1 size-4" />
                          )}
                          Ver
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-5xl">
                        <DialogHeader>
                          <DialogTitle>{selected?.filename ?? backup.filename}</DialogTitle>
                          <DialogDescription>Conteudo do backup e diff contra o backup anterior.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 md:grid-cols-2">
                          <pre className="max-h-[560px] overflow-auto rounded border bg-background p-3 text-xs">
                            {selected?.content || "Carregando..."}
                          </pre>
                          <pre className="max-h-[560px] overflow-auto rounded border bg-background p-3 text-xs">
                            {selected?.diff || "Sem diff registrado."}
                          </pre>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button size="sm" variant="outline" onClick={() => onDownload(backup.id)}>
                      <Download className="mr-1 size-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canWrite || deleting}
                      onClick={() => {
                        if (window.confirm(`Apagar o backup ${backup.filename ?? backup.id}?`)) {
                          onDelete(backup.id);
                        }
                      }}
                    >
                      {deleting ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Trash2 className="mr-1 size-4" />}
                      Apagar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function natRows(snapshot: { natRules?: Array<{ type: string; interface: string; protocol: string; source: string; destination: string; target: string; descr: string }> } | null | undefined) {
  const rows = snapshot?.natRules ?? [];
  if (rows.length === 0) {
    return [["masquerade", "wan", "any", "lan", "any", "wan address", "masquerade padrao"]];
  }
  return rows.map((r) => [r.type, r.interface, r.protocol, r.source, r.destination, r.target, r.descr]);
}

function formatPct(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}%` : "-";
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

function formatSsh(management: { sshEnabled?: boolean | null; sshPort?: number | null } | null | undefined) {
  if (!management?.sshPort) return "-";
  return `${management.sshEnabled === false ? "desativado" : "ativo"}:${management.sshPort}`;
}

function zabbixStatus(
  snapshot:
    | {
        automation?: Array<{ type: string; status: string; command: string }>;
      }
    | null
    | undefined,
) {
  const zabbix = (snapshot?.automation ?? []).find((a) => a.type === "monitoring");
  if (!zabbix || !/running/i.test(zabbix.status)) return "ausente/parado";
  const command = zabbix.command.toLowerCase();
  const hasArcanjo = command.includes("monitor.arcanjofirewall.com.br");
  const hasMexcloud = command.includes("monitoria.mexcloud.com.br");
  if (hasArcanjo && hasMexcloud) return "running com servidores padrao";
  return "running; servidores nao confirmados";
}

function driftAction(rule: string) {
  const normalized = rule.toLowerCase();
  if (normalized.includes("version")) return "Planejar upgrade para a versao padrao.";
  if (normalized.includes("service")) return "Validar servico e habilitar inicializacao automatica.";
  if (normalized.includes("alias")) return "Criar ou corrigir alias padrao no dispositivo.";
  if (normalized.includes("gateway")) return "Checar gateway, monitor IP e grupo LB.";
  if (normalized.includes("backup")) return "Padronizar cron e script de backup.";
  if (normalized.includes("ntp")) return "Ajustar NTP conforme baseline.";
  return "Comparar Raw/coleta e aplicar padrao corporativo.";
}

function hasManagementAlias(
  snapshot:
    | {
        aliases?: Array<{ name: string; type: string; values?: string[] }>;
      }
    | null
    | undefined,
) {
  return (snapshot?.aliases ?? []).some((alias) => /mexti.*manager|manager.*mexti|gerenc|acesso/i.test(alias.name));
}

function managementPortsStatus(
  snapshot:
    | {
        aliases?: Array<{ name: string; type: string; values?: string[] }>;
      }
    | null
    | undefined,
) {
  const alias = (snapshot?.aliases ?? []).find((item) => /mexti.*manager|manager.*mexti|gerenc|acesso/i.test(item.name) && /port/i.test(item.type));
  if (!alias) return "alias de portas ausente";
  const values = alias.values ?? [];
  return values.length ? values.join(", ") : "presente sem entradas";
}

function hasManagementRule(
  snapshot:
    | {
        firewallRules?: Array<{ descr: string; source: string; destinationPort?: string }>;
      }
    | null
    | undefined,
) {
  return (snapshot?.firewallRules ?? []).some((rule) =>
    /manager|gerenc|mexti|acesso/i.test(`${rule.descr} ${rule.source} ${rule.destinationPort ?? ""}`),
  );
}

function SimpleTable({
  title,
  head,
  rows,
}: {
  title: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <section className="panel overflow-hidden">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      {rows.length === 0 ? (
        <EmptyState label="Sem dados coletados" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {head.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  {r.map((c, j) => (
                    <TableCell key={j} className={j === 0 ? "font-medium" : "numeric text-muted-foreground"}>
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function rawSnapshotText(snapshot: unknown) {
  return JSON.stringify(redactRaw(snapshot), null, 2);
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "config.xml";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function redactRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRaw);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /token|secret|password|key|hash/i.test(key) ? "***" : redactRaw(entry),
    ]),
  );
}
