"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";
import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";
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
 *
 * FICHA 410 (T5.5 — R19/R20): antes de salir, este dispositivo se da de baja del canal de push.
 * Es lo que impide que el siguiente aviso de esta persona suene en un teléfono donde ya no tiene
 * sesión. Se hace ANTES de `logout()` porque la baja necesita la sesión para autorizarse (el
 * usuario sale de la cookie, R50), y **solo se toca ESTE dispositivo**: sus otros teléfonos siguen
 * suscritos. Si la baja falla, la sesión se cierra igualmente y el fallo queda registrado (R20):
 * nadie se queda dentro de la aplicación porque un servicio de push no respondiera.
 *
 * FICHA 422 (T3.2 — R8/R13): esa baja ahora declara su motivo, y el de aquí es
 * `"cierre-de-sesion"`. Lo que ese motivo significa —y por eso se elige— es que **la preferencia
 * de la persona NO se borra**: salir no es decir que no, es solo irse. La distinción es el
 * objetivo entero de la ficha: con `"la-persona-apago-el-interruptor"` aquí, cada cierre de sesión
 * borraría la decisión y la aplicación no podría volver a avisar al entrar de nuevo — que es el
 * fallo que la 422 vino a arreglar. El trabajo sobre el dispositivo es EXACTAMENTE el mismo con
 * los dos motivos (R9): este botón no deja de dar de baja este teléfono, y sigue sin tocar los
 * otros (410/R19 intacto).
 */
export function LogoutButton() {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      // R20: no lleva `try`. `darDeBajaDeEsteDispositivo` no lanza nunca por contrato, y envolverla
      // aquí escondería que el que decide es ella.
      // 422/R8: el motivo NO es un adorno. «Cierre de sesión» = solo se va, y la preferencia se
      // conserva para poder volver a avisarle cuando entre otra vez en este dispositivo.
      await darDeBajaDeEsteDispositivo("cierre-de-sesion");
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
