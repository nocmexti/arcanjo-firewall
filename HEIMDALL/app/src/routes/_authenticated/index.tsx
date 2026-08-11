import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Server,
  Wifi,
  WifiOff,
  ShieldAlert,
  GitCompare,
  RefreshCw,
  ArrowRight,
  Cpu,
} from "lucide-react";
import { listDevices, listAuditLogs, complianceReport, listAgentHealth } from "@/lib/fleet.functions";
import {
  MetricCard,
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatusBadge,
  SeverityBadge,
  formatRelative,
  formatDateTime,
} from "@/components/fleet/ui-kit";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Dashboard - HEIMDALL" },
      {
        name: "description",
        content: "Fleet overview: availability, versions, drift and alerts.",
      },
      { property: "og:title", content: "Dashboard - HEIMDALL" },
      {
        property: "og:description",
        content: "Fleet overview: availability, versions, drift and alerts.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const devicesFn = useServerFn(listDevices);
  const logsFn = useServerFn(listAuditLogs);
  const complianceFn = useServerFn(complianceReport);
  const agentHealthFn = useServerFn(listAgentHealth);

  const devices = useQuery({ queryKey: ["devices"], queryFn: () => devicesFn() });
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => logsFn() });
  const compliance = useQuery({
    queryKey: ["compliance", null],
    queryFn: () => complianceFn({ data: { baselineId: null } }),
  });
  const agentHealth = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => agentHealthFn(),
    refetchInterval: 60_000,
  });

  if (devices.isLoading) return <LoadingState />;
  if (devices.error) return <ErrorState message={(devices.error as Error).message} />;

  const rows = devices.data ?? [];
  const online = rows.filter((d) => d.status === "online").length;
  const offline = rows.filter((d) => d.status === "offline").length;
  const degraded = rows.filter((d) => d.status === "degraded").length;
  const nonCompliant = rows.filter((d) => d.compliant === false).length;
  const agentsAlive = (agentHealth.data ?? []).filter((row) => row.alive).length;
  const versions = new Map<string, number>();
  for (const d of rows) versions.set(d.version ?? "desconhecida", (versions.get(d.version ?? "desconhecida") ?? 0) + 1);
  const versionList = [...versions.entries()].sort((a, b) => b[1] - a[1]);
  const lastSync = rows
    .map((d) => d.last_sync_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard operacional"
        description={`Frota de ${rows.length} dispositivos - ultima sincronizacao ${formatRelative(lastSync)}`}
        actions={
          <Button asChild size="sm">
            <Link to="/dispositivos">
              Ir para inventario <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Devices" value={rows.length} icon={Server} hint="Total registered" />
        <MetricCard label="Online" value={online} tone="success" icon={Wifi} hint={`${Math.round((online / (rows.length || 1)) * 100)}% da frota`} />
        <MetricCard label="Offline" value={offline} tone="danger" icon={WifiOff} hint={`${degraded} degradados`} />
        <MetricCard label="Agents alive" value={agentsAlive} tone="success" icon={Cpu} hint="Signal received from agent" />
        <MetricCard label="Fora do padrao" value={nonCompliant} tone="warning" icon={ShieldAlert} hint="Contra baseline padrao" />
        <MetricCard label="Versoes distintas" value={versionList.length} tone="info" icon={GitCompare} hint="Divergencia de firmware" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-1">
          <header className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Distribuicao de versoes</h2>
          </header>
          <div className="space-y-3 p-4">
            {versionList.map(([version, count]) => (
              <div key={version} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="numeric font-medium">{version}</span>
                  <span className="numeric text-muted-foreground">{count}</span>
                </div>
                <Progress value={(count / (rows.length || 1)) * 100} className="h-1.5" />
              </div>
            ))}
          </div>
        </section>

        <section className="panel lg:col-span-2">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Highest drift devices</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/conformidade">Ver conformidade</Link>
            </Button>
          </header>
          {compliance.isLoading ? (
            <LoadingState label="Avaliando baseline..." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Versao</TableHead>
                  <TableHead className="text-right">Desvios</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(compliance.data?.rows ?? [])
                  .filter((r) => !r.compliant)
                  .sort((a, b) => b.drift.length - a.drift.length)
                  .slice(0, 8)
                  .map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <Link to="/dispositivos/$id" params={{ id: r.id }} className="hover:underline">
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.client_unit}</TableCell>
                      <TableCell className="numeric">{r.version ?? "-"}</TableCell>
                      <TableCell className="numeric text-right text-warning">{r.drift.length}</TableCell>
                    </TableRow>
                  ))}
                {compliance.data && compliance.data.rows.every((r) => r.compliant) && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <EmptyState label="Nenhum desvio encontrado" />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Offline devices</h2>
            <RefreshCw className="size-4 text-muted-foreground" />
          </header>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ultimo erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows
                .filter((d) => d.status !== "online")
                .slice(0, 8)
                .map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <Link to="/dispositivos/$id" params={{ id: d.id }} className="hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">{d.host}</TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {d.last_error ?? "-"}
                    </TableCell>
                  </TableRow>
                ))}
              {rows.every((d) => d.status === "online") && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState label="Toda a frota esta online" />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        <section className="panel">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Alertas e eventos recentes</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/auditoria">Ver auditoria</Link>
            </Button>
          </header>
          {logs.isLoading ? (
            <LoadingState label="Carregando eventos..." />
          ) : (logs.data ?? []).length === 0 ? (
            <EmptyState label="Nenhum evento registrado ainda" hint="Acoes criticas aparecem aqui." />
          ) : (
            <ul className="divide-y">
              {(logs.data ?? []).slice(0, 8).map((log) => (
                <li key={log.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <SeverityBadge severity={log.severity} />
                  <span className="numeric font-medium">{log.action}</span>
                  <span className="truncate text-muted-foreground">{log.actor_email ?? "sistema"}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(log.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
