import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Cpu, Download, KeyRound, PlugZap, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { installAgentFromManager, listAgentHealth } from "@/lib/fleet.functions";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  StatusBadge,
  formatDateTime,
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

type AgentAction = "validate" | "restapi" | "agent" | "all";
type StepStatus = "idle" | "running" | "ok" | "error";
type AgentForm = {
  name: string;
  host: string;
  sshUser: string;
  sshPassword: string;
  heimdallUser: string;
  heimdallPassword: string;
  ensureHeimdallUser: boolean;
  sshPort: string;
  apiPort: string;
};
type AgentRequest = { action: AgentAction; values: AgentForm };
type HealthPoint = {
  time: string;
  alive: number;
  registered: number;
  offline: number;
};

const historyKey = "heimdall.agent.health.history";

export const Route = createFileRoute("/_authenticated/agentes")({
  head: () => ({
    meta: [
      { title: "Agents - HEIMDALL" },
      { name: "description", content: "Instalacao e monitoramento dos agentes HEIMDALL." },
      { property: "og:title", content: "Agents - HEIMDALL" },
      { property: "og:description", content: "Instalacao e monitoramento dos agentes HEIMDALL." },
    ],
  }),
  component: AgentsPage,
});

function AgentsPage() {
  const queryClient = useQueryClient();
  const healthFn = useServerFn(listAgentHealth);
  const installFn = useServerFn(installAgentFromManager);
  const [form, setForm] = useState({
    name: "",
    host: "",
    sshUser: "admin",
    sshPassword: "",
    heimdallUser: "heimdall-admin",
    heimdallPassword: "",
    ensureHeimdallUser: false,
    sshPort: "2222",
    apiPort: "58443",
  });
  const [pendingAction, setPendingAction] = useState<AgentAction | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<AgentAction, StepStatus>>({
    validate: "idle",
    restapi: "idle",
    agent: "idle",
    all: "idle",
  });
  const [history, setHistory] = useState<HealthPoint[]>(() => loadHealthHistory());

  const health = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => healthFn(),
    refetchInterval: 60_000,
  });
  const install = useMutation({
    mutationFn: ({ action, values }: AgentRequest) =>
      installFn({
        data: {
          name: values.name || null,
          host: values.host,
          sshUser: values.sshUser,
          sshPassword: values.sshPassword,
          heimdallUser: values.heimdallUser,
          heimdallPassword: values.heimdallPassword || undefined,
          ensureHeimdallUser: values.ensureHeimdallUser,
          sshPort: Number(values.sshPort),
          apiPort: Number(values.apiPort),
          action,
          packageBaseUrl: `${window.location.origin}/api/packages`,
        },
      }),
    onMutate: ({ action }) => {
      setPendingAction(action);
      setStepStatus((current) => ({ ...current, [action]: "running" }));
    },
    onSuccess: async (result, { action }) => {
      toast.success(actionSuccessText(action, result.host));
      if (action === "agent" || action === "all") {
        setForm((current) => ({ ...current, sshPassword: "" }));
      }
      setStepStatus((current) => ({ ...current, [action]: "ok" }));
      await queryClient.invalidateQueries({ queryKey: ["agent-health"] });
      await health.refetch();
    },
    onError: (error, { action }) => {
      setStepStatus((current) => ({ ...current, [action]: "error" }));
      toast.error((error as Error).message);
    },
    onSettled: () => setPendingAction(null),
  });

  const rows = health.data ?? [];
  const registered = rows.filter((row) => row.registered).length;
  const alive = rows.filter((row) => row.alive).length;
  const offline = rows.filter((row) => row.registered && !row.alive).length;

  useEffect(() => {
    if (!health.data) return;
    const point: HealthPoint = {
      time: new Date().toISOString(),
      alive,
      registered,
      offline,
    };
    setHistory((current) => saveHealthPoint(current, point));
  }, [health.data, alive, registered, offline]);

  const chartData = useMemo(
    () =>
      history.map((point) => ({
        ...point,
        label: new Date(point.time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      })),
    [history],
  );

  if (health.isLoading) return <LoadingState />;
  if (health.error) return <ErrorState message={(health.error as Error).message} />;

  function run(action: AgentAction) {
    if (!form.host.trim()) {
      toast.error("Informe o endereco do dispositivo.");
      return;
    }
    if (!form.sshUser.trim()) {
      toast.error("Informe o usuario SSH.");
      return;
    }
    if (!form.sshPassword) {
      toast.error("Informe a senha SSH para executar esta etapa.");
      return;
    }
    if (!Number(form.sshPort) || !Number(form.apiPort)) {
      toast.error("Informe portas validas.");
      return;
    }
    install.mutate({ action, values: form });
  }

  function updateAgent(row: { name: string; host: string; port: number; sshPort?: number; sshUser?: string | null }) {
    const sameDeviceLoaded = form.host.trim() === row.host;
    const sshUser = sameDeviceLoaded && form.sshUser.trim() ? form.sshUser.trim() : row.sshUser?.trim() || "admin";
    const next = {
      name: row.name,
      host: row.host,
      sshUser,
      sshPassword: form.sshPassword,
      heimdallUser: form.heimdallUser || "heimdall-admin",
      heimdallPassword: form.heimdallPassword,
      ensureHeimdallUser: form.ensureHeimdallUser,
      sshPort: String(row.sshPort || 2222),
      apiPort: String(row.port || 58443),
    };
    setForm(next);
    if (!next.sshPassword) {
      toast.info(`Dados de ${row.name} carregados. Confira o usuario SSH, informe a senha e clique em Atualizar novamente.`);
      return;
    }
    install.mutate({ action: "agent", values: next });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="HEIMDALL Agents"
        description="Cadastre, instale e monitore os agentes seguros sem executar scripts manualmente."
        actions={
          <Button size="sm" variant="outline" onClick={() => health.refetch()}>
            <RefreshCw className="mr-1 size-4" />
            Atualizar alive
          </Button>
        }
      />

      <section className="panel overflow-hidden">
        <div className="grid gap-4 p-4 lg:grid-cols-[160px_1fr]">
          <div className="flex items-center justify-center rounded-md border bg-background/60 p-3">
            <img src="/icones.png" alt="" className="h-28 w-28 rounded object-cover" />
          </div>
          <div className="flex flex-col justify-center">
            <h2 className="text-sm font-semibold">Secure agent operation</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Atualize o agente usando o usuario SSH ja conhecido do equipamento. A senha nao fica salva; informe apenas no momento da manutencao.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Registrados" value={registered} icon={Cpu} hint={`${rows.length} dispositivos avaliados`} />
        <MetricCard label="Alive" value={alive} tone="success" icon={ShieldCheck} hint="Responderam ao healthcheck" />
        <MetricCard label="Sem resposta" value={offline} tone="danger" icon={PlugZap} hint="Agente registrado sem alive" />
      </div>

      <section className="panel overflow-hidden">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Cadastrar dispositivo e executar instalacao</h2>
        </header>
        <div className="grid gap-4 p-4 lg:grid-cols-6">
          <Field label="Nome" value={form.name} placeholder="ex: matriz-rj" onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="Endereco" value={form.host} placeholder="ex: unidade.hopto.org" required onChange={(value) => setForm((current) => ({ ...current, host: value }))} />
          <Field label="Usuario SSH" value={form.sshUser} required onChange={(value) => setForm((current) => ({ ...current, sshUser: value }))} />
          <Field label="Senha SSH" value={form.sshPassword} type="password" required onChange={(value) => setForm((current) => ({ ...current, sshPassword: value }))} />
          <Field label="Porta SSH" value={form.sshPort} type="number" required onChange={(value) => setForm((current) => ({ ...current, sshPort: value }))} />
          <Field label="Porta gerencia" value={form.apiPort} type="number" required onChange={(value) => setForm((current) => ({ ...current, apiPort: value }))} />
        </div>
        <div className="grid gap-4 border-t p-4 lg:grid-cols-[1fr_1fr_2fr]">
          <Field label="Usuario dedicado" value={form.heimdallUser} placeholder="heimdall-admin" onChange={(value) => setForm((current) => ({ ...current, heimdallUser: value }))} />
          <Field label="Senha dedicada" value={form.heimdallPassword} type="password" placeholder="vazio = usa senha SSH" onChange={(value) => setForm((current) => ({ ...current, heimdallPassword: value }))} />
          <label className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={form.ensureHeimdallUser}
              onChange={(event) => setForm((current) => ({ ...current, ensureHeimdallUser: event.target.checked }))}
            />
            <span>
              <span className="block font-semibold">Criar/atualizar usuario heimdall-admin</span>
              <span className="text-xs text-muted-foreground">Opcional. Em pfSense 2.7.x mantenha desligado e crie o usuario pela WebGUI ate validarmos o fluxo seguro.</span>
            </span>
          </label>
        </div>
        <div className="grid gap-3 border-t p-4 lg:grid-cols-4">
          <StepAction
            icon={KeyRound}
            title="1. Validar acesso"
            text="Confirma SSH, porta e versao antes de alterar o equipamento."
            status={stepStatus.validate}
            pending={pendingAction === "validate"}
            disabled={install.isPending}
            onClick={() => run("validate")}
          />
          <StepAction
            icon={Download}
            title="2. Instalar API"
            text="Instala o pacote compativel usando o repositorio interno."
            status={stepStatus.restapi}
            pending={pendingAction === "restapi"}
            disabled={install.isPending}
            onClick={() => run("restapi")}
          />
          <StepAction
            icon={UserPlus}
            title="3. Instalar agente"
            text="Atualiza o agente, WebGUI Manager, backup por agente e sinal alive."
            status={stepStatus.agent}
            pending={pendingAction === "agent"}
            disabled={install.isPending}
            onClick={() => run("agent")}
          />
          <StepAction
            icon={CheckCircle2}
            title="Executar fluxo completo"
            text="Valida acesso, instala API e instala agente em uma operacao."
            status={stepStatus.all}
            pending={pendingAction === "all"}
            disabled={install.isPending}
            primary
            onClick={() => run("all")}
          />
        </div>
        {install.data ? (
          <div className="border-t p-4">
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs">
              <p className="font-semibold">Ultimo resultado</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {install.data.steps.map((step) => (
                  <li key={step.step}>
                    <span className="font-medium text-foreground">{step.step}</span>: {step.detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel overflow-hidden">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Health dos agentes - ultimos 60 minutos</h2>
            <p className="text-xs text-muted-foreground">Amostra coletada a cada refresh da tela.</p>
          </div>
          <StatusBadge status={offline === 0 ? "online" : "degraded"} />
        </header>
        <div className="h-64 p-4">
          {chartData.length === 0 ? (
            <EmptyState label="Sem historico suficiente" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 8, right: 16, top: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="aliveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                  }}
                />
                <Area type="monotone" dataKey="alive" name="Alive" stroke="hsl(var(--primary))" fill="url(#aliveGradient)" strokeWidth={2} />
                <Area type="monotone" dataKey="offline" name="Sem resposta" stroke="hsl(var(--destructive))" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Alive dos agentes</h2>
        </header>
        {rows.length === 0 ? (
          <EmptyState label="Nenhum dispositivo avaliado" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Porta</TableHead>
                <TableHead>Registro</TableHead>
                <TableHead>Alive</TableHead>
                <TableHead>Versao</TableHead>
                <TableHead>Ultimo sinal</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.deviceId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="numeric text-muted-foreground">{row.host}</TableCell>
                  <TableCell className="numeric">{row.port}</TableCell>
                  <TableCell><StatusBadge status={row.registered ? "online" : "unknown"} /></TableCell>
                  <TableCell><StatusBadge status={row.alive ? "online" : "offline"} /></TableCell>
                  <TableCell className="numeric">{row.version ?? "-"}</TableCell>
                  <TableCell>{formatDateTime(row.lastSeenAt)}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">{row.error ?? "-"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled={install.isPending} onClick={() => updateAgent(row)}>
                      <RefreshCw className="mr-1 size-4" />
                      Atualizar agente
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  type = "text",
  required,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase text-muted-foreground">{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} required={required} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function StepAction({
  icon: Icon,
  title,
  text,
  status,
  pending,
  disabled,
  primary,
  onClick,
}: {
  icon: typeof Cpu;
  title: string;
  text: string;
  status: StepStatus;
  pending: boolean;
  disabled: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <StatusPill status={status} />
      </div>
      <p className="mt-2 min-h-10 text-sm text-muted-foreground">{text}</p>
      <Button className="mt-3 w-full" variant={primary ? "default" : "outline"} size="sm" disabled={disabled} onClick={onClick}>
        {pending ? <RefreshCw className="mr-1 size-4 animate-spin" /> : <Icon className="mr-1 size-4" />}
        Executar
      </Button>
    </div>
  );
}

function StatusPill({ status }: { status: StepStatus }) {
  const label = {
    idle: "Aguardando",
    running: "Executando",
    ok: "OK",
    error: "Erro",
  }[status];
  const className = {
    idle: "border-border text-muted-foreground",
    running: "border-warning/40 bg-warning/10 text-warning",
    ok: "border-success/40 bg-success/10 text-success",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
  }[status];
  return <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${className}`}>{label}</span>;
}

function loadHealthHistory() {
  try {
    const raw = window.localStorage.getItem(historyKey);
    return raw ? (JSON.parse(raw) as HealthPoint[]) : [];
  } catch {
    return [];
  }
}

function saveHealthPoint(current: HealthPoint[], point: HealthPoint) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const next = [...current.filter((item) => new Date(item.time).getTime() >= cutoff), point].slice(-80);
  window.localStorage.setItem(historyKey, JSON.stringify(next));
  return next;
}

function actionSuccessText(action: AgentAction, host: string) {
  if (action === "validate") return `Acesso validado em ${host}.`;
  if (action === "restapi") return `API instalada/validada em ${host}.`;
  if (action === "agent") return `Agente instalado em ${host}.`;
  return `Fluxo completo finalizado em ${host}.`;
}
