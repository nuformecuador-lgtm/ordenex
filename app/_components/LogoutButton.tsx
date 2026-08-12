"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { useToast } from "@/hooks/useToast";
import { Button } from "@/components/ui/button";

/**
 * Control "Salir" del topbar (feature 57). Vive en el `PageHeader` compartido
 * (esquina superior derecha), presente en toda página autenticada. Un click:
 * `logout()` (Server Action que invalida la sesión + expira la cookie) →
 * `router.push("/")` (home pública). Mientras la operación está en curso el botón queda
 * deshabilitado ("Saliendo…") para impedir doble envío (R11). Si `logout()`
 * falla, NO se navega: se rehabilita el control y se avisa con un toast (R10).
 *
 * Las clases de contraste (border/texto navy) lo hacen legible sobre el
 * fondo claro del `PageHeader`.
 */
export function LogoutButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      try {
        await logout();
        // R7: al completar el logout, redirige a la home pública (/).
        router.push("/");
      } catch (error) {
        // R10: el fallo NO simula éxito; feedback visible (toast, feature 11).
        console.error("Logout failed:", error);
        toast.error("No se pudo cerrar sesión");
      }
    });
  };

  return (
    <Button
      onClick={handleLogout}
      loading={isPending}
      variant="outline"
      className="cursor-pointer border-navy/40 bg-transparent text-navy hover:bg-navy/10 hover:text-navy"
    >
      {isPending ? null : <LogOut aria-hidden="true" />}
      {isPending ? "Saliendo…" : "Salir"}
    </Button>
  );
}
