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
 * Color (feature 208): SOLO tokens que giran con el tema. Antes iba con `navy`
 * fijo (`border-navy/40 text-navy hover:bg-navy/10`) y sobre el `PageHeader`
 * oscuro el control quedaba en 1.03–1.09:1 de contraste — el encabezado se leía
 * y su botón no. `text-foreground` es el mismo token del `<h1>` de al lado, así
 * que ahora los dos se leen igual en los dos temas y en los cinco roles.
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
      className="cursor-pointer bg-transparent text-foreground hover:bg-foreground/10 hover:text-foreground"
    >
      {isPending ? null : <LogOut aria-hidden="true" />}
      {isPending ? "Saliendo…" : "Salir"}
    </Button>
  );
}
