import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarRecepcionSatelite } from "@/lib/actions/recepcion-satelite";

import { PorRecibirModule } from "../_components/PorRecibirModule";

/**
 * Feature 279 (T2.2) — pantalla **«Por recibir»** del portal del `adminSatelite`.
 *
 * Es la puerta de entrada del rol: aquí aterriza el post-login (`primerDestino` devuelve
 * el href del primer subítem, R12) y aquí redirige la ruta vieja `/recepcion-satelite`
 * (R13/R14). Una sola puerta, no dos.
 *
 * MISMO gate de rol que su hermana, con la MISMA forma (patrón feature 36): el rol se
 * resuelve sólo server-side y cualquier otro rol —o la ausencia de sesión— cae en
 * `notFound()` ANTES de consultar ningún dato (R19).
 *
 * UNA SOLA LECTURA, y es deliberado (R15/R16). `listarRecepcionSatelite` es la única
 * acción que esta pantalla necesita: trae las órdenes en camino a la bodega y, de paso,
 * `zonaNombre` y `sinZona`. Las otras cinco que hace «En bodega» —mensajeros, bloqueo de
 * bodega, liberadas de hoy, la página del listado y el catálogo de filtros— no se llaman
 * aquí: esta pantalla no monta el listado, ni su barra de filtros, ni su paginación, ni
 * sus acciones de lote, ni sus modales.
 */
export default async function RecepcionSatelitePorRecibirPage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminSatelite") notFound(); // R19

  const result = await listarRecepcionSatelite();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  return (
    <AppPage
      title="Por recibir"
      description="Órdenes en camino a tu bodega satélite. Se reciben escaneando el QR."
    >
      <PorRecibirModule
        porRecibir={result.porRecibir}
        zonaNombre={result.zonaNombre}
        sinZona={result.sinZona}
      />
    </AppPage>
  );
}
