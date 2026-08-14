import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Star } from "lucide-react";
import { listBaselines, saveBaseline } from "@/lib/fleet.functions";
import { PageHeader, LoadingState, ErrorState, EmptyState, formatDateTime } from "@/components/fleet/ui-kit";
import { useSession, canAccess } from "@/components/fleet/device-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/baselines")({
  head: () => ({
    meta: [
      { title: "Baselines - HEIMDALL" },
      { name: "description", content: "Politicas de padronizacao aplicadas a frota." },
      { property: "og:title", content: "Baselines - HEIMDALL" },
      {
        property: "og:description",
        content: "Politicas de padronizacao aplicadas a frota.",
      },
    ],
  }),
  component: BaselinesPage,
});

type FormState = {
  id: string | null;
  name: string;
  description: string;
  is_default: boolean;
  min_version: string;
  required_services: string;
  required_aliases: string;
  max_uptime_days: number;
  require_ntp: boolean;
  require_dns_resolver: boolean;
  forbid_default_password: boolean;
};

const emptyForm: FormState = {
  id: null,
  name: "",
  description: "",
  is_default: false,
  min_version: "2.7.2",
  required_services: "ntpd, unbound, sshd",
  required_aliases: "RFC1918",
  max_uptime_days: 365,
  require_ntp: true,
  require_dns_resolver: true,
  forbid_default_password: true,
};

function BaselinesPage() {
  const queryClient = useQueryClient();
  const session = useSession();
  const isAdmin = canAccess(session.data?.role, 'admin');
  const listFn = useServerFn(listBaselines);
  const saveFn = useServerFn(saveBaseline);

  const baselines = useQuery({ queryKey: ["baselines"], queryFn: () => listFn() });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          id: form.id,
          name: form.name,
          description: form.description || null,
          is_default: form.is_default,
          rules: {
            min_version: form.min_version,
            required_services: split(form.required_services),
            required_aliases: split(form.required_aliases),
            max_uptime_days: Number(form.max_uptime_days),
            require_ntp: form.require_ntp,
            require_dns_resolver: form.require_dns_resolver,
            forbid_default_password: form.forbid_default_password,
          },
        },
      }),
    onSuccess: () => {
      toast.success("Baseline salvo.");
      queryClient.invalidateQueries();
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Baselines e politicas"
        description="Padrao esperado de versao, servicos e configuracao para nivelar a frota."
        actions={
          isAdmin && (
            <Button
              size="sm"
              onClick={() => {
                setForm(emptyForm);
                setOpen(true);
              }}
            >
              <Plus className="mr-1 size-4" /> Novo baseline
            </Button>
          )
        }
      />

      {baselines.isLoading ? (
        <LoadingState />
      ) : baselines.error ? (
        <ErrorState message={(baselines.error as Error).message} />
      ) : (baselines.data ?? []).length === 0 ? (
        <EmptyState label="Nenhum baseline definido" hint="Crie uma politica para avaliar conformidade." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(baselines.data ?? []).map((b) => {
            const rules = (b.rules ?? {}) as Record<string, unknown>;
            return (
              <article key={b.id} className="panel p-4">
                <header className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      {b.name}
                      {b.is_default && (
                        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                          <Star className="size-3" /> padrao
                        </Badge>
                      )}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">{b.description ?? "-"}</p>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setForm({
                          id: b.id,
                          name: b.name,
                          description: b.description ?? "",
                          is_default: b.is_default,
                          min_version: String(rules["min_version"] ?? "2.7.2"),
                          required_services: join(rules["required_services"]),
                          required_aliases: join(rules["required_aliases"]),
                          max_uptime_days: Number(rules["max_uptime_days"] ?? 365),
                          require_ntp: Boolean(rules["require_ntp"]),
                          require_dns_resolver: Boolean(rules["require_dns_resolver"]),
                          forbid_default_password: Boolean(rules["forbid_default_password"]),
                        });
                        setOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                  )}
                </header>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <Rule label="Versao minima" value={String(rules["min_version"] ?? "-")} />
                  <Rule label="Uptime maximo" value={`${rules["max_uptime_days"] ?? "-"} dias`} />
                  <Rule label="Servicos obrigatorios" value={join(rules["required_services"]) || "-"} />
                  <Rule label="Aliases obrigatorios" value={join(rules["required_aliases"]) || "-"} />
                  <Rule label="NTP" value={rules["require_ntp"] ? "obrigatorio" : "opcional"} />
                  <Rule label="DNS Resolver" value={rules["require_dns_resolver"] ? "obrigatorio" : "opcional"} />
                </dl>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Atualizado em {formatDateTime(b.updated_at)}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar baseline" : "Novo baseline"}</DialogTitle>
            <DialogDescription>
              Alteracoes no baseline mudam a avaliacao de conformidade de toda a frota.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bl-name">Nome</Label>
              <Input id="bl-name" required maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bl-desc">Descricao</Label>
              <Textarea id="bl-desc" rows={2} maxLength={300} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bl-version">Versao minima</Label>
              <Input id="bl-version" required maxLength={20} value={form.min_version} onChange={(e) => set("min_version", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bl-uptime">Uptime maximo (dias)</Label>
              <Input
                id="bl-uptime"
                type="number"
                min={1}
                max={3650}
                required
                value={form.max_uptime_days}
                onChange={(e) => set("max_uptime_days", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bl-services">Servicos obrigatorios</Label>
              <Input id="bl-services" maxLength={200} value={form.required_services} onChange={(e) => set("required_services", e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bl-aliases">Aliases obrigatorios</Label>
              <Input id="bl-aliases" maxLength={200} value={form.required_aliases} onChange={(e) => set("required_aliases", e.target.value)} />
            </div>
            <Toggle label="Exigir NTP" checked={form.require_ntp} onChange={(v) => set("require_ntp", v)} />
            <Toggle label="Exigir DNS Resolver" checked={form.require_dns_resolver} onChange={(v) => set("require_dns_resolver", v)} />
            <Toggle
              label="Proibir senha padrao"
              checked={form.forbid_default_password}
              onChange={(v) => set("forbid_default_password", v)}
            />
            <Toggle label="Definir como padrao" checked={form.is_default} onChange={(v) => set("is_default", v)} />
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Salvar baseline
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="numeric mt-0.5">{value}</dd>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function split(value: string) {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function join(value: unknown) {
  return Array.isArray(value) ? value.join(", ") : "";
}
