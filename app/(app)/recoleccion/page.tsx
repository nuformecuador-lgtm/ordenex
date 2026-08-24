import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarRecoleccion } from "@/lib/actions/recoleccion-tienda";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

import { RecoleccionModule } from "./_components/RecoleccionModule";

/**
 * Feature 167 (R1/R2/R3/R6) — apartado PROPIO de la recolección en tienda del rol
 * `mensajero`. Vivía dentro de "Entregas" (`/mis-asignaciones`) y el mensajero no lo
 * encontraba: se ocultaba entero cuando la lista estaba vacía, que es justo cuando iba a
 * buscarlo. Aquí tiene ruta y entrada de menú propias, y el escáner está SIEMPRE montado.
 *
 * El rol se resuelve SOLO server-side vía `resolveActorFromSession` (patrón de las features
 * 17/26/36): cualquier rol distinto de `mensajero` —o sin sesión— NO ve la página
 * (`notFound`, defensa REAL, R3). Pre-fetch de los datos por la Server Action y paso al
 * componente cliente POR PROPS: datos de una superficie autenticada, el padre valida los
 * permisos y el hijo no fetchea por su cuenta (R6).
 */
export default async function RecoleccionPage() {
  const actor = await resolveActorFromSession();
  if (actor?.rol !== "mensajero") notFound(); // R3

  // R21/R24: las dos listas del apartado, ambas acotadas server-side al PROPIO actor (la de
  // pendientes por `mensajero_asignado_id`, la de hoy por `actor_usuario_id` del historial).
  const result = await listarRecoleccion();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin apartado

  // Feature 111/R12/R14 + 167/R9 -> FEATURE 271: el DETALLE del bloqueo, derivado server-side
  // por la regla N/V. Se obtiene AQUÍ y no en el service de recolección para que haya una sola
  // derivación del bloqueo en todo el portal (la misma que usa `/mis-asignaciones`). Con el
  // mensajero bloqueado el módulo muestra el aviso —cuántos cierres arrastra y cuál toca
  // primero— y no monta el escáner (defensa suave; el backend de la 157/R31 es la defensa real).
  // Si la acción degrada, baja `SIN_BLOQUEO` y no se bloquea nada.
  const estado = await estadoBloqueoMensajero();
  const bloqueo = estado.status === "ok" ? estado.bloqueo : SIN_BLOQUEO;

  return (
    <AppPage
      title="Recolección"
      description="Órdenes por recolectar en tienda"
    >
      <RecoleccionModule
        porRecolectar={result.porRecolectar}
        recolectadasHoy={result.recolectadasHoy}
        recolectadasHoyRecortada={result.recolectadasHoyRecortada}
        bloqueo={bloqueo}
      />
    </AppPage>
  );
}
