import { createFileRoute, Outlet, redirect, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, Radio } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppSidebar } from "@/components/fleet/app-sidebar";
import { useSession } from "@/components/fleet/device-form";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (import.meta.env["VITE_LOCAL_DEMO_MODE"] === "true") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
  },
  component: ConsoleLayout,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  operator: "Operador",
  viewer: "Somente leitura",
};

function ConsoleLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") navigate({ to: "/auth", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b bg-card/80 px-3 backdrop-blur">
            <SidebarTrigger />
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <img src="/logo.png" alt="" className="h-6 w-6 rounded-sm object-cover" />
              HEIMDALL
            </Link>
            <Badge variant="outline" className="gap-1 text-[11px]">
              <Radio className="size-3" />
              provider: {session.data?.provider ?? "..."}
            </Badge>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium leading-tight">{session.data?.email ?? "-"}</p>
                <p className="text-[11px] leading-tight text-muted-foreground">
                  {ROLE_LABEL[session.data?.role ?? ""] ?? "-"}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="size-4" />
                <span className="sr-only sm:not-sr-only sm:ml-1">Sair</span>
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
