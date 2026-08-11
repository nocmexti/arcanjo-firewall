import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTeam } from "@/lib/fleet.functions";
import { useSession } from "@/components/fleet/device-form";
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  formatDateTime,
} from "@/components/fleet/ui-kit";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configuracoes - HEIMDALL" },
      {
        name: "description",
        content: "Provider de comunicacao, perfis de acesso e postura de seguranca.",
      },
      { property: "og:title", content: "Configuracoes - HEIMDALL" },
      {
        property: "og:description",
        content: "Provider de comunicacao, perfis de acesso e postura de seguranca.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const session = useSession();
  const teamFn = useServerFn(listTeam);
  const team = useQuery({ queryKey: ["team"], queryFn: () => teamFn() });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configuracoes"
        description="Camada de comunicacao, perfis de acesso e diretrizes de seguranca do manager."
      />

      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Provider de comunicacao</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Provider ativo: <span className="numeric font-medium">{session.data?.provider ?? "..."}</span>.
          O provider local gera dados deterministicos para desenvolvimento. Para conectar aos dispositivos
          reais, habilite o adapter REST no backend e use a chave de comunicacao criptografada de cada
          equipamento via cabecalho <span className="numeric">X-API-Key</span>.
        </p>
      </section>

      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Seguranca</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>Credenciais sao cifradas com AES-256-GCM e nunca trafegam ao frontend.</li>
          <li>RBAC: admin, operador e somente leitura, com perfis customizados pelo administrador.</li>
          <li>Login profissional por e-mail com TOTP 2FA previsto para o ambiente de producao.</li>
          <li>Acoes destrutivas exigem confirmacao explicita e sao registradas na auditoria.</li>
          <li>Mudancas em massa passam por preview e diff antes de qualquer aplicacao.</li>
        </ul>
      </section>

      <section className="panel overflow-hidden">
        <header className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Usuarios e perfis</h2>
        </header>
        {team.isLoading ? (
          <LoadingState />
        ) : team.error ? (
          <ErrorState message={(team.error as Error).message} />
        ) : (team.data ?? []).length === 0 ? (
          <EmptyState label="Nenhum usuario visivel" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Perfis</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(team.data ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="numeric font-medium">{u.email ?? "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.display_name ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDateTime(u.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
