import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { HardDrive, Cloud, Save } from "lucide-react";
import { listBackups } from "@/lib/fleet.functions";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  formatDateTime,
  formatBytes,
  SeverityBadge,
} from "@/components/fleet/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BackupDevice = {
  name?: string | null;
  client_unit?: string | null;
};

type BackupTarget = "local" | "ftp" | "google_drive" | "onedrive" | "s3";

type BackupPolicy = {
  target: BackupTarget;
  localPath: string;
  ftpUrl: string;
  googleDriveFolderId: string;
  onedriveFolderId: string;
  s3Bucket: string;
  retentionDays: string;
};

const defaultPolicy: BackupPolicy = {
  target: "local",
  localPath: "C:\\LAB\\HEIMDALL\\backups\\local",
  ftpUrl: "",
  googleDriveFolderId: "",
  onedriveFolderId: "",
  s3Bucket: "",
  retentionDays: "365",
};

function backupDevice(value: unknown): BackupDevice | null {
  if (Array.isArray(value)) return (value[0] as BackupDevice | undefined) ?? null;
  return (value as BackupDevice | null) ?? null;
}

export const Route = createFileRoute("/_authenticated/backups")({
  head: () => ({
    meta: [
      { title: "Backups - HEIMDALL" },
      { name: "description", content: "Historico consolidado de backups de configuracao." },
      { property: "og:title", content: "Backups - HEIMDALL" },
      {
        property: "og:description",
        content: "Historico consolidado de backups de configuracao.",
      },
    ],
  }),
  component: BackupsPage,
});

function BackupsPage() {
  const fn = useServerFn(listBackups);
  const backups = useQuery({ queryKey: ["backups"], queryFn: () => fn() });
  const [policy, setPolicy] = useState<BackupPolicy>(defaultPolicy);

  useEffect(() => {
    const raw = window.localStorage.getItem("heimdall.backup.policy");
    if (!raw) return;
    try {
      setPolicy({ ...defaultPolicy, ...(JSON.parse(raw) as Partial<BackupPolicy>) });
    } catch {
      setPolicy(defaultPolicy);
    }
  }, []);

  const targetLabel = useMemo(() => backupTargetLabel(policy.target), [policy.target]);

  if (backups.isLoading) return <LoadingState />;
  if (backups.error) return <ErrorState message={(backups.error as Error).message} />;

  const rows = backups.data ?? [];

  function savePolicy() {
    window.localStorage.setItem("heimdall.backup.policy", JSON.stringify(policy));
    toast.success("Politica de backup salva.");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Backups de configuracao"
        description="Controle o destino dos arquivos e acompanhe o historico consolidado dos dispositivos."
      />

      <section className="panel p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              {policy.target === "local" ? <HardDrive className="size-4" /> : <Cloud className="size-4" />}
              Destino de backup
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Destino atual: <span className="font-medium text-foreground">{targetLabel}</span>. Uma copia local
              sempre fica fora do container em <span className="numeric">{policy.localPath}</span>.
            </p>
          </div>
          <Button size="sm" onClick={savePolicy}>
            <Save className="mr-1 size-4" />
            Salvar politica
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-4">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">Destino principal</span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={policy.target}
              onChange={(event) => setPolicy((current) => ({ ...current, target: event.target.value as BackupTarget }))}
            >
              <option value="local">Local</option>
              <option value="ftp">FTP</option>
              <option value="google_drive">Google Drive</option>
              <option value="onedrive">OneDrive</option>
              <option value="s3">S3</option>
            </select>
          </label>
          <Field
            label="Retencao local"
            value={policy.retentionDays}
            suffix="dias"
            onChange={(value) => setPolicy((current) => ({ ...current, retentionDays: value }))}
          />
          <Field
            label="Caminho persistente"
            value={policy.localPath}
            className="lg:col-span-2"
            onChange={(value) => setPolicy((current) => ({ ...current, localPath: value }))}
          />
        </div>

        {policy.target !== "local" ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {policy.target === "ftp" ? (
              <Field
                label="FTP URL"
                value={policy.ftpUrl}
                placeholder="ftps://backup.exemplo.local/heimdall"
                onChange={(value) => setPolicy((current) => ({ ...current, ftpUrl: value }))}
              />
            ) : null}
            {policy.target === "google_drive" ? (
              <Field
                label="Google Drive folder ID"
                value={policy.googleDriveFolderId}
                onChange={(value) => setPolicy((current) => ({ ...current, googleDriveFolderId: value }))}
              />
            ) : null}
            {policy.target === "onedrive" ? (
              <Field
                label="OneDrive folder ID"
                value={policy.onedriveFolderId}
                onChange={(value) => setPolicy((current) => ({ ...current, onedriveFolderId: value }))}
              />
            ) : null}
            {policy.target === "s3" ? (
              <Field
                label="S3 bucket"
                value={policy.s3Bucket}
                placeholder="s3://bucket/prefixo"
                onChange={(value) => setPolicy((current) => ({ ...current, s3Bucket: value }))}
              />
            ) : null}
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground lg:col-span-2">
              O destino remoto sera usado pela camada de integracao do HEIMDALL. A copia local persistente permanece
              obrigatoria para recuperacao rapida.
            </div>
          </div>
        ) : null}
      </section>

      <div className="panel overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState label="Nenhum backup registrado" hint="Abra um dispositivo e clique em Backup." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dispositivo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => {
                  const device = backupDevice(b.devices);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        <Link to="/dispositivos/$id" params={{ id: b.device_id }} className="hover:underline">
                          {device?.name ?? "-"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{device?.client_unit ?? "-"}</TableCell>
                      <TableCell className="numeric">{b.filename ?? "-"}</TableCell>
                      <TableCell>{formatDateTime(b.created_at)}</TableCell>
                      <TableCell className="numeric">{formatBytes(b.size_bytes ?? 0)}</TableCell>
                      <TableCell>{b.imported ? "importado" : "coletado"}</TableCell>
                      <TableCell>
                        <SeverityBadge severity={b.status === "success" ? "info" : "high"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  suffix,
  className,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  suffix?: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={className}>
      <Label className="text-xs font-semibold uppercase text-muted-foreground">{label}</Label>
      <div className="mt-2 flex items-center gap-2">
        <Input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function backupTargetLabel(target: BackupTarget) {
  switch (target) {
    case "ftp":
      return "FTP";
    case "google_drive":
      return "Google Drive";
    case "onedrive":
      return "OneDrive";
    case "s3":
      return "S3";
    default:
      return "Local";
  }
}
