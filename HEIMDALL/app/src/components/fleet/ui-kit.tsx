import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, Inbox, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

const STATUS_STYLES: Record<string, string> = {
  online: "border-success/40 bg-success/15 text-success",
  offline: "border-destructive/40 bg-destructive/15 text-destructive",
  degraded: "border-warning/40 bg-warning/15 text-warning",
  unknown: "border-border bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  degraded: "Degradado",
  unknown: "Desconhecido",
};

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        className={cn(
          "size-2 rounded-full",
          status === "online" && "bg-success",
          status === "offline" && "bg-destructive",
          status === "degraded" && "bg-warning",
          status === "unknown" && "bg-muted-foreground",
        )}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_STYLES[status])}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

export function ComplianceBadge({ compliant, count }: { compliant: boolean; count?: number }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium",
        compliant
          ? "border-success/40 bg-success/15 text-success"
          : "border-warning/40 bg-warning/15 text-warning",
      )}
    >
      {compliant ? "Conforme" : `Fora do padrao${count ? ` (${count})` : ""}`}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    high: "border-destructive/40 bg-destructive/15 text-destructive",
    critical: "border-destructive/40 bg-destructive/15 text-destructive",
    medium: "border-warning/40 bg-warning/15 text-warning",
    warning: "border-warning/40 bg-warning/15 text-warning",
    low: "border-info/40 bg-info/15 text-info",
    info: "border-border bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cn("font-medium capitalize", map[severity])}>
      {severity}
    </Badge>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
    info: "text-info",
  }[tone];

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn("size-4", toneClass)} />}
      </div>
      <p className={cn("numeric mt-2 text-2xl font-semibold", toneClass)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function LoadingState({ label = "Carregando dados..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Inbox className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{label}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <TriangleAlert className="size-6 text-destructive" />
      <p className="text-sm font-medium">Nao foi possivel carregar</p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatRelative(value: string | null | undefined) {
  if (!value) return "nunca";
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `ha ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `ha ${hours} h`;
  return `ha ${Math.round(hours / 24)} d`;
}

export function formatBytes(bytes: number) {
  if (!bytes) return "-";
  const kb = bytes / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
}
