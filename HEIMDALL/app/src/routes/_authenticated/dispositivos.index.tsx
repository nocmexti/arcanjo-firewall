import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, PlugZap, Search, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  listDevices,
  testConnection,
  syncDevice,
  deleteDevice,
} from "@/lib/fleet.functions";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  StatusBadge,
  ComplianceBadge,
  formatRelative,
} from "@/components/fleet/ui-kit";
import {
  DeviceFormDialog,
  ConfirmDialog,
  emptyDevice,
  useSession,
  type DeviceFormValues,
} from "@/components/fleet/device-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/dispositivos/")({
  head: () => ({
    meta: [
      { title: "Devices - HEIMDALL" },
      {
        name: "description",
        content: "Complete device inventory with filters, connection test and sync.",
      },
      { property: "og:title", content: "Devices - HEIMDALL" },
      {
        property: "og:description",
        content: "Complete device inventory with filters, connection test and sync.",
      },
    ],
  }),
  component: DevicesPage,
});

const ALL = "__all__";

function DevicesPage() {
  const queryClient = useQueryClient();
  const session = useSession();
  const canWrite = session.data?.role === "admin" || session.data?.role === "operator";

  const listFn = useServerFn(listDevices);
  const testFn = useServerFn(testConnection);
  const syncFn = useServerFn(syncDevice);
  const removeFn = useServerFn(deleteDevice);

  const devices = useQuery({ queryKey: ["devices"], queryFn: () => listFn() });

  const [search, setSearch] = useState("");
  const [client, setClient] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [version, setVersion] = useState(ALL);
  const [tag, setTag] = useState(ALL);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState<DeviceFormValues>(emptyDevice);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);

  const rows = devices.data ?? [];

  const options = useMemo(() => {
    const clients = new Set<string>();
    const versions = new Set<string>();
    const tags = new Set<string>();
    for (const d of rows) {
      clients.add(d.client_unit);
      if (d.version) versions.add(d.version);
      for (const t of d.tags ?? []) tags.add(t);
    }
    return {
      clients: [...clients].sort(),
      versions: [...versions].sort(),
      tags: [...tags].sort(),
    };
  }, [rows]);

  const filtered = rows.filter((d) => {
    const q = search.trim().toLowerCase();
    if (q && !`${d.name} ${d.host} ${d.client_unit}`.toLowerCase().includes(q)) return false;
    if (client !== ALL && d.client_unit !== client) return false;
    if (status !== ALL && d.status !== status) return false;
    if (version !== ALL && d.version !== version) return false;
    if (tag !== ALL && !(d.tags ?? []).includes(tag)) return false;
    return true;
  });

  const test = useMutation({
    mutationFn: (id: string) => testFn({ data: { id } }),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message);
      else toast.error(res.message ?? "Falha na conexao");
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: (id: string) => syncFn({ data: { id } }),
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (res) => {
      if (res.ok) toast.success(`Snapshot coletado - ${res.driftCount} desvio(s).`);
      else toast.error(res.message ?? "Falha ao sincronizar");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Dispositivo removido.");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Device inventory"
        description={`${filtered.length} de ${rows.length} dispositivos listados`}
        actions={
          canWrite && (
            <Button
              size="sm"
              onClick={() => {
                setFormValues(emptyDevice);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-1 size-4" /> Novo dispositivo
            </Button>
          )
        }
      />

      <div className="grid gap-2 md:grid-cols-5">
        <div className="relative md:col-span-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="hostname, IP ou nome"
            className="pl-8"
            maxLength={80}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect value={client} onChange={setClient} placeholder="Cliente" options={options.clients} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="Status"
          options={["online", "offline", "degraded", "unknown"]}
        />
        <FilterSelect value={version} onChange={setVersion} placeholder="Versao" options={options.versions} />
        <FilterSelect value={tag} onChange={setTag} placeholder="Tag" options={options.tags} />
      </div>

      <div className="panel overflow-hidden">
        {devices.isLoading ? (
          <LoadingState />
        ) : devices.error ? (
          <ErrorState message={(devices.error as Error).message} />
        ) : filtered.length === 0 ? (
          <EmptyState label="Nenhum dispositivo encontrado" hint="Ajuste os filtros ou cadastre um novo dispositivo." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Versao</TableHead>
                  <TableHead>Ambiente</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Padrao</TableHead>
                  <TableHead>Ultimo sync</TableHead>
                  <TableHead className="text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <Link to="/dispositivos/$id" params={{ id: d.id }} className="hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{d.client_unit}</TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {d.host}:{d.port}
                    </TableCell>
                    <TableCell className="numeric">{d.version ?? "-"}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{d.environment}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(d.tags ?? []).slice(0, 3).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[11px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell>
                      <ComplianceBadge compliant={d.compliant !== false} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRelative(d.last_sync_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Testar conexao"
                          disabled={!canWrite || busyId === d.id}
                          onClick={() => test.mutate(d.id)}
                        >
                          {busyId === d.id && test.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <PlugZap className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Sincronizar agora"
                          disabled={!canWrite || busyId === d.id}
                          onClick={() => sync.mutate(d.id)}
                        >
                          {busyId === d.id && sync.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <RefreshCw className="size-4" />
                          )}
                        </Button>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Editar"
                            onClick={() => {
                              setFormValues({
                                id: d.id,
                                name: d.name,
                                client_unit: d.client_unit,
                                host: d.host,
                                port: d.port,
                                version: d.version ?? "",
                                environment: d.environment as DeviceFormValues["environment"],
                                tags: (d.tags ?? []).join(", "),
                                notes: d.notes ?? "",
                                api_key: "",
                              });
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        )}
                        {session.data?.role === "admin" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Remover"
                            onClick={() => setToDelete({ id: d.id, name: d.name })}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <DeviceFormDialog open={formOpen} onOpenChange={setFormOpen} initial={formValues} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={`Remover ${toDelete?.name ?? ""}?`}
        description="Esta acao e destrutiva: o dispositivo, seus snapshots e backups registrados serao removidos do manager. A acao sera registrada na auditoria."
        confirmLabel="Remover dispositivo"
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}: todos</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
