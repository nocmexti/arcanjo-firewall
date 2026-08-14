import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getSession, saveDevice } from "@/lib/fleet.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function useSession() {
  const fn = useServerFn(getSession);
  return useQuery({ queryKey: ["session"], queryFn: () => fn() });
}

export type DeviceFormValues = {
  id: string | null;
  name: string;
  client_unit: string;
  host: string;
  port: number;
  version: string;
  environment: "producao" | "homologacao" | "laboratorio";
  tags: string;
  notes: string;
  api_key: string;
};

export const emptyDevice: DeviceFormValues = {
  id: null,
  name: "",
  client_unit: "",
  host: "",
  port: 443,
  version: "",
  environment: "producao",
  tags: "",
  notes: "",
  api_key: "",
};

export function DeviceFormDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: DeviceFormValues;
}) {
  const [values, setValues] = useState<DeviceFormValues>(initial);
  const [dirtyKey, setDirtyKey] = useState(initial.id ?? "new");
  const queryClient = useQueryClient();
  const save = useServerFn(saveDevice);

  if (dirtyKey !== (initial.id ?? "new")) {
    setDirtyKey(initial.id ?? "new");
    setValues(initial);
  }

  const mutation = useMutation({
    mutationFn: () =>
      save({
        data: {
          id: values.id,
          values: {
            name: values.name,
            client_unit: values.client_unit,
            host: values.host,
            port: Number(values.port),
            version: values.version || null,
            environment: values.environment,
            tags: values.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            notes: values.notes || null,
            api_key: values.api_key || null,
          },
        },
      }),
    onSuccess: () => {
      toast.success(values.id ? "Dispositivo atualizado." : "Dispositivo cadastrado.");
      queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const set = <K extends keyof DeviceFormValues>(key: K, value: DeviceFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{values.id ? "Editar dispositivo" : "Novo dispositivo"}</DialogTitle>
          <DialogDescription>
            A chave de comunicacao e criptografada no backend e nunca retorna ao navegador.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Nome" htmlFor="name">
            <Input
              id="name"
              required
              maxLength={80}
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Cliente / unidade" htmlFor="client">
            <Input
              id="client"
              required
              maxLength={80}
              value={values.client_unit}
              onChange={(e) => set("client_unit", e.target.value)}
            />
          </Field>
          <Field label="IP ou hostname" htmlFor="host">
            <Input
              id="host"
              required
              maxLength={255}
              value={values.host}
              onChange={(e) => set("host", e.target.value)}
            />
          </Field>
          <Field label="Porta" htmlFor="port">
            <Input
              id="port"
              type="number"
              min={1}
              max={65535}
              required
              value={values.port}
              onChange={(e) => set("port", Number(e.target.value))}
            />
          </Field>
          <Field label="Versao" htmlFor="version">
            <Input
              id="version"
              maxLength={20}
              placeholder="2.8.1"
              value={values.version}
              onChange={(e) => set("version", e.target.value)}
            />
          </Field>
          <Field label="Ambiente" htmlFor="env">
            <Select
              value={values.environment}
              onValueChange={(v) => set("environment", v as DeviceFormValues["environment"])}
            >
              <SelectTrigger id="env">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Producao</SelectItem>
                <SelectItem value="homologacao">Homologacao</SelectItem>
                <SelectItem value="laboratorio">Laboratorio</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tags (separadas por virgula)" htmlFor="tags" full>
            <Input
              id="tags"
              maxLength={200}
              placeholder="core, vpn"
              value={values.tags}
              onChange={(e) => set("tags", e.target.value)}
            />
          </Field>
          <Field label="Chave de comunicacao" htmlFor="apikey" full>
            <Input
              id="apikey"
              type="password"
              maxLength={500}
              autoComplete="off"
              placeholder={values.id ? "Deixe em branco para manter a atual" : ""}
              value={values.api_key}
              onChange={(e) => set("api_key", e.target.value)}
            />
          </Field>
          <Field label="Observacoes" htmlFor="notes" full>
            <Textarea
              id="notes"
              maxLength={1000}
              rows={3}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Função centralizada para verificação de permissões de acesso
 * @param role - O papel do usuário (admin, operator, viewer)
 * @param requiredAccess - Tipo de acesso necessário ('admin', 'operator', 'viewer')
 * @returns boolean indicando se o usuário tem acesso
 */
export function canAccess(role: string | undefined, requiredAccess: 'admin' | 'operator' | 'viewer'): boolean {
  if (!role) return false;
  
  // Acesso administrativo concede acesso a todos os níveis
  if (role === 'admin') return true;
  
  // Acesso de operador concede acesso a operador e visualizador
  if (role === 'operator' && requiredAccess !== 'admin') return true;
  
  // Acesso de visualizador concede apenas acesso ao próprio nível
  if (role === 'viewer' && requiredAccess === 'viewer') return true;
  
  return false;
}

function Field({
  label,
  htmlFor,
  children,
  full,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
