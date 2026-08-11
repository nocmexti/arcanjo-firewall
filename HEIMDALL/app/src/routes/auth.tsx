import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Entrar - HEIMDALL" },
      { name: "description", content: "Acesso restrito ao console HEIMDALL." },
      { property: "og:title", content: "Entrar - HEIMDALL" },
      {
        property: "og:description",
        content: "Acesso restrito ao console HEIMDALL.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const target = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/";

  useEffect(() => {
    if (import.meta.env["VITE_LOCAL_DEMO_MODE"] === "true") {
      navigate({ to: target, replace: true });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: target, replace: true });
    });
  }, [navigate, target]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: target, replace: true });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      navigate({ to: target, replace: true });
    } else {
      toast.success("Conta criada. Confirme o e-mail para acessar o HEIMDALL.");
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between border-r bg-sidebar p-10 lg:flex">
        <div className="flex items-center gap-3 text-sidebar-foreground">
          <img src="/logo-login.png" alt="HEIMDALL" className="h-16 w-16 rounded-sm object-cover" />
          <div>
            <span className="block font-semibold tracking-tight">HEIMDALL</span>
            <span className="text-[11px] text-muted-foreground">Centralized Security Management</span>
          </div>
        </div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight">
            Gestao centralizada e segura de dispositivos
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Inventario, padronizacao, backups, auditoria e operacao remota por agente seguro em um
            unico console operacional.
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground numeric">
            <li>- Login corporativo com e-mail validado</li>
            <li>- RBAC administravel pelo perfil ADM</li>
            <li>- MFA/TOTP obrigatorio para funcoes sensiveis</li>
            <li>- Sem dependencia do usuario admin local dos equipamentos</li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Operacao recomendada atras de HTTPS e VPN corporativa.</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/logo-login.png" alt="HEIMDALL" className="h-14 w-14 rounded-sm object-cover" />
            <div>
              <h1 className="text-lg font-semibold leading-tight">HEIMDALL</h1>
              <p className="text-xs text-muted-foreground">Centralized Security Management</p>
            </div>
          </div>
          <h2 className="mb-1 text-xl font-semibold">Acesso ao HEIMDALL</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Use uma conta corporativa validada. O primeiro usuario cadastrado recebe o perfil de administrador.
          </p>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            {(["signin", "signup"] as const).map((mode) => (
              <TabsContent key={mode} value={mode}>
                <form
                  onSubmit={mode === "signin" ? signIn : signUp}
                  className="space-y-4 pt-2"
                  noValidate
                >
                  <div className="space-y-2">
                    <Label htmlFor={`${mode}-email`}>E-mail corporativo</Label>
                    <Input
                      id={`${mode}-email`}
                      type="email"
                      required
                      maxLength={255}
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`${mode}-password`}>Senha</Label>
                    <Input
                      id={`${mode}-password`}
                      type="password"
                      required
                      minLength={10}
                      maxLength={128}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                    {mode === "signin" ? "Entrar" : "Criar conta"}
                  </Button>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <KeyRound className="mt-0.5 size-3.5 shrink-0" />
                    MFA/TOTP sera exigido para contas operacionais antes de permitir acoes sensiveis.
                  </p>
                </form>
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </div>
  );
}
