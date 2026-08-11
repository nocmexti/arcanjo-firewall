import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listAuditLogs } from "@/lib/fleet.functions";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  SeverityBadge,
  formatDateTime,
} from "@/components/fleet/ui-kit";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria - HEIMDALL" },
      { name: "description", content: "Trilha de auditoria das acoes criticas no manager." },
      { property: "og:title", content: "Auditoria - HEIMDALL" },
      {
        property: "og:description",
        content: "Trilha de auditoria das acoes criticas no manager.",
      },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const fn = useServerFn(listAuditLogs);
  const logs = useQuery({ queryKey: ["audit"], queryFn: () => fn() });
  const [q, setQ] = useState("");

  if (logs.isLoading) return <LoadingState />;
  if (logs.error) return <ErrorState message={(logs.error as Error).message} />;

  const rows = (logs.data ?? []).filter((l) =>
    `${l.action} ${l.actor_email ?? ""} ${l.target_id ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs de auditoria"
        description="Ultimos 200 eventos registrados para acoes criticas."
        actions={
          <Input
            className="w-64"
            maxLength={80}
            placeholder="filtrar por acao, usuario ou alvo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />
      <div className="panel overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState label="Nenhum evento registrado" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Severidade</TableHead>
                  <TableHead>Acao</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Alvo</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(l.created_at)}</TableCell>
                    <TableCell>
                      <SeverityBadge severity={l.severity} />
                    </TableCell>
                    <TableCell className="numeric font-medium">{l.action}</TableCell>
                    <TableCell className="text-muted-foreground">{l.actor_email ?? "sistema"}</TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {l.target_type ?? "-"}
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground">
                      {JSON.stringify(l.details ?? {})}
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
