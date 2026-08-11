import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listBaselines, complianceReport } from "@/lib/fleet.functions";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  MetricCard,
  ComplianceBadge,
  SeverityBadge,
} from "@/components/fleet/ui-kit";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/conformidade")({
  head: () => ({
    meta: [
      { title: "Conformidade - HEIMDALL" },
      {
        name: "description",
        content: "Preview de drift entre cada dispositivo e o baseline selecionado.",
      },
      { property: "og:title", content: "Conformidade - HEIMDALL" },
      {
        property: "og:description",
        content: "Preview de drift entre cada dispositivo e o baseline selecionado.",
      },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  const baselinesFn = useServerFn(listBaselines);
  const reportFn = useServerFn(complianceReport);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [onlyDrift, setOnlyDrift] = useState(true);

  const baselines = useQuery({ queryKey: ["baselines"], queryFn: () => baselinesFn() });
  const report = useQuery({
    queryKey: ["compliance", baselineId],
    queryFn: () => reportFn({ data: { baselineId } }),
  });

  if (report.isLoading) return <LoadingState label="Comparando frota com o baseline..." />;
  if (report.error) return <ErrorState message={(report.error as Error).message} />;

  const rows = report.data?.rows ?? [];
  const shown = onlyDrift ? rows.filter((r) => !r.compliant) : rows;
  const compliant = rows.filter((r) => r.compliant).length;
  const high = rows.reduce((acc, r) => acc + r.highCount, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Conformidade e drift"
        description={`Baseline aplicado: ${report.data?.baseline?.name ?? "nenhum"} - nenhuma alteracao e aplicada automaticamente`}
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={baselineId ?? "__default__"}
              onValueChange={(v) => setBaselineId(v === "__default__" ? null : v)}
            >
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Baseline" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Baseline padrao</SelectItem>
                {(baselines.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={onlyDrift ? "drift" : "todos"} onValueChange={(v) => setOnlyDrift(v === "drift")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="drift">So fora do padrao</SelectItem>
                <SelectItem value="todos">Todos os dispositivos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Conformes" value={compliant} tone="success" icon={ShieldCheck} />
        <MetricCard label="Fora do padrao" value={rows.length - compliant} tone="warning" icon={ShieldAlert} />
        <MetricCard label="Desvios de alta severidade" value={high} tone="danger" icon={AlertTriangle} />
      </div>

      <div className="panel overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState label="Nenhum desvio no filtro atual" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Versao</TableHead>
                  <TableHead>Situacao</TableHead>
                  <TableHead>Desvios detectados (preview)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <Link to="/dispositivos/$id" params={{ id: r.id }} className="hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.client_unit}</TableCell>
                    <TableCell className="numeric">{r.version ?? "-"}</TableCell>
                    <TableCell>
                      <ComplianceBadge compliant={r.compliant} count={r.drift.length} />
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-1">
                        {r.drift.slice(0, 4).map((d, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs">
                            <SeverityBadge severity={d.severity} />
                            <span className="font-medium">{d.rule}</span>
                            <span className="numeric text-muted-foreground">
                              esperado {d.expected} - atual {d.actual}
                            </span>
                          </li>
                        ))}
                        {r.drift.length > 4 && (
                          <li className="text-xs text-muted-foreground">
                            +{r.drift.length - 4} outros desvios
                          </li>
                        )}
                        {r.drift.length === 0 && <li className="text-xs text-muted-foreground">-</li>}
                      </ul>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
