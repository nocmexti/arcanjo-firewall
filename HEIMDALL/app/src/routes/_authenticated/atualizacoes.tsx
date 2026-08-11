import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowUpCircle, ListChecks, CircleAlert } from "lucide-react";
import { listDevices, listBaselines } from "@/lib/fleet.functions";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  MetricCard,
  StatusBadge,
} from "@/components/fleet/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/atualizacoes")({
  head: () => ({
    meta: [
      { title: "Atualizacoes - HEIMDALL" },
      {
        name: "description",
        content: "Planejamento de janelas de atualizacao para dispositivos divergentes.",
      },
      { property: "og:title", content: "Atualizacoes - HEIMDALL" },
      {
        property: "og:description",
        content: "Planejamento de janelas de atualizacao para dispositivos divergentes.",
      },
    ],
  }),
  component: UpdatesPage,
});

function UpdatesPage() {
  const devicesFn = useServerFn(listDevices);
  const baselinesFn = useServerFn(listBaselines);
  const devices = useQuery({ queryKey: ["devices"], queryFn: () => devicesFn() });
  const baselines = useQuery({ queryKey: ["baselines"], queryFn: () => baselinesFn() });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const target = useMemo(() => {
    const def = (baselines.data ?? []).find((b) => b.is_default) ?? (baselines.data ?? [])[0];
    const rules = (def?.rules ?? {}) as Record<string, unknown>;
    return String(rules["min_version"] ?? "-");
  }, [baselines.data]);

  if (devices.isLoading) return <LoadingState />;
  if (devices.error) return <ErrorState message={(devices.error as Error).message} />;

  const rows = devices.data ?? [];
  const outdated = rows.filter((d) => (d.version ?? "") !== target);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planejamento de atualizacao"
        description={`Versao-alvo do baseline padrao: ${target}`}
        actions={
          <Button size="sm" disabled={selected.size === 0} variant="outline">
            <ListChecks className="mr-1 size-4" />
            Gerar plano ({selected.size})
          </Button>
        }
      />

      <Alert>
        <CircleAlert className="size-4" />
        <AlertTitle>Execucao real desabilitada no MVP</AlertTitle>
        <AlertDescription>
          Esta tela monta a janela de atualizacao e o preview dos equipamentos afetados. Nenhuma
          mudanca em massa ocorre sem preview, confirmacao e trilha de auditoria.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Na versao-alvo" value={rows.length - outdated.length} tone="success" />
        <MetricCard label="Divergentes" value={outdated.length} tone="warning" icon={ArrowUpCircle} />
        <MetricCard label="Selecionados" value={selected.size} tone="info" />
      </div>

      <div className="panel overflow-hidden">
        {outdated.length === 0 ? (
          <EmptyState label="Toda a frota esta na versao-alvo" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ambiente</TableHead>
                  <TableHead>Versao atual</TableHead>
                  <TableHead>Alvo</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outdated.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(d.id)}
                        onCheckedChange={() => toggle(d.id)}
                        aria-label={`Selecionar ${d.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link to="/dispositivos/$id" params={{ id: d.id }} className="hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.client_unit}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {d.environment}
                      </Badge>
                    </TableCell>
                    <TableCell className="numeric text-warning">{d.version ?? "-"}</TableCell>
                    <TableCell className="numeric">{target}</TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
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
