import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarRecepcionSatelite,
  listarMensajerosSatelite,
  estadoBloqueoBodegaSatelite,
} from "@/lib/actions/recepcion-satelite";
import { listarLiberadasHoy } from "@/lib/actions/liberacion-reprogramada";

import { RecepcionSateliteModule } from "./_components/RecepcionSateliteModule";

/**
 * Feature 33 (T11, R3/R4): módulo "Mis asignaciones" de la bodega satélite. El rol
 * se resuelve SOLO server-side vía `resolveActorFromSession` (patrón feature
 * 36): cualquier rol distinto de `adminSatelite` (o sin sesión) NO ve el módulo
 * (`notFound`, defensa real). Pre-fetch del listado por la Server Action y paso de
 * datos sensibles a los componentes cliente por props (el padre valida permisos).
 * La ruta es `/recepcion-satelite` (el path `/mis-asignaciones` es del mensajero,
 * feature 36); el título de la UI sí es "Mis asignaciones".
 */
export default async function RecepcionSatelitePage() {
  const actor = await resolveActorFromSession();
  if (!actor || actor.rol !== "adminSatelite") notFound(); // R3

  const result = await listarRecepcionSatelite();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  // Feature 34/T7 (R2): pre-fetch de los mensajeros de la zona del actor para el
  // modal de asignación (datos por props desde el Server Component que ya validó
  // el rol). Degradación suave: si el loader no responde `ok`, se pasa lista vacía
  // (la sección "Recibidas" desactiva la asignación, R6) sin romper la página.
  const mensajerosResult = await listarMensajerosSatelite();
  const mensajeros =
    mensajerosResult.status === "ok" ? mensajerosResult.mensajeros : [];

  // Feature 41 (R22): flag DERIVADO server-side del bloqueo de la bodega satélite
  // (regla estricta R17). Si la acción degrada (forbidden/unauthenticated), se pasa
  // no-bloqueada (defensa suave: no se bloquea la asignación por un fallo de lectura).
  const bloqueoResult = await estadoBloqueoBodegaSatelite();
  const bloqueoBodega =
    bloqueoResult.status === "ok"
      ? bloqueoResult.bloqueo
      : {
          bloqueada: false,
          porMensajeros: false,
          porCierreBodega: false,
          cierresAbiertos: 0,
          totalMensajeros: 0,
          mensajerosConCierreIds: [],
        };

  // Feature 46 (R15/R16): pre-fetch server-side del aviso derivado "Liberadas hoy
  // (reprogramación)" de la bodega satélite del actor (estatus `en_bodega_satelite` +
  // su zona + `liberada_reprogramada_at::date = hoy` CR). Datos por props al módulo
  // (componente privado); degradación suave a lista vacía si la acción no responde ok.
  const liberadasResult = await listarLiberadasHoy();
  const liberadasHoy =
    liberadasResult.status === "ok" ? liberadasResult.liberadas : [];

  return (
    <AppPage
      title="Mis asignaciones"
      description="Recepción de órdenes de tu bodega satélite por escaneo de QR"
    >
      <RecepcionSateliteModule
        porRecibir={result.porRecibir}
        recibidas={result.recibidas}
        porDevolver={result.porDevolver}
        enTransitoACentral={result.enTransitoACentral}
        devueltas={result.devueltas}
        // Feature 149/T6.3 (R35): órdenes `por_recoger` de SU zona (acotadas server-side por
        // `RecepcionSateliteService.listar`), sobre las que el módulo ofrece "Deshacer asignación".
        asignadas={result.asignadas}
        zonaNombre={result.zonaNombre}
        sinZona={result.sinZona}
        mensajeros={mensajeros}
        bloqueoBodega={bloqueoBodega}
        liberadasHoy={liberadasHoy}
      />
    </AppPage>
  );
}
