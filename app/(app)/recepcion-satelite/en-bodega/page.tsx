import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarRecepcionSatelite,
  listarMensajerosSatelite,
  estadoBloqueoBodegaSatelite,
  listarOrdenesBodegaPaginado,
} from "@/lib/actions/recepcion-satelite";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import { listarLiberadasHoy } from "@/lib/actions/liberacion-reprogramada";
import { recepcionSateliteConfig } from "@/lib/config/recepcion-satelite";
import { fechaCalendarioCR, mananaCalendarioCR } from "@/lib/utils/fecha-cr";

import { RecepcionSateliteModule } from "../_components/RecepcionSateliteModule";

/**
 * Feature 33 (T11, R3/R4) · Feature 278 (T2.1) — pantalla **«En bodega»** del portal del
 * `adminSatelite`.
 *
 * Es el Server Component que hasta el 2026-08-24 servía la pantalla ÚNICA
 * `/recepcion-satelite`; con la partición de la ficha 278 se muda aquí tal cual, con sus
 * seis lecturas y sus degradaciones suaves intactas. Lo que cambia es sólo la envoltura:
 * el `title` pasa a «En bodega», la descripción describe SU contenido, y **deja de bajar
 * `porRecibir`** — el bloque que lo consumía se fue a `/recepcion-satelite/por-recibir`
 * (R16/R18) y nada lo sustituye, porque con el escáner incondicional (R42) esta pantalla
 * ya no necesita saber cuántas órdenes vienen en camino.
 *
 * El rol se resuelve SOLO server-side vía `resolveActorFromSession` (patrón feature 36):
 * cualquier rol distinto de `adminSatelite` (o sin sesión) NO ve el módulo (`notFound`,
 * defensa real, R19). Los datos sensibles bajan por props desde aquí, que es el punto
 * donde ya se validó el permiso.
 *
 * El H1 «Mis asignaciones» DESAPARECE (R44): era el nombre del portal del MENSAJERO
 * viviendo en la pantalla del satélite, y con dos pantallas propias ya no tiene dónde
 * agarrarse.
 */
export default async function RecepcionSateliteEnBodegaPage() {
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
  // FEATURE 271 (T9.5, R32): de esos mensajeros, los que la asignación va a rechazar por su
  // cierre. Viene de la MISMA lectura que la lista, así que las dos no pueden discrepar. Con la
  // acción degradada la lista ya viene vacía y no hay a quién marcar.
  const mensajerosBloqueadosIds =
    mensajerosResult.status === "ok" ? (mensajerosResult.bloqueadosIds ?? []) : [];

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

  // Feature 170 — FASE 2 (T K.3, R40/R41): PÁGINA 1 del listado «Órdenes de la bodega»,
  // sin filtros, resuelta server-side. Baja por props y alimenta el `fallbackData` de SWR:
  // el usuario ve las mismas filas que antes en el primer pintado, sin esperar un viaje al
  // servidor por un dato que ya viajó. Degradación suave a página vacía (el módulo enseña
  // su estado vacío); el acceso ya lo decidió el `notFound` de arriba.
  const paginaResult = await listarOrdenesBodegaPaginado({});
  const ordenesBodega =
    paginaResult.status === "ok"
      ? {
          items: paginaResult.items,
          total: paginaResult.total,
          pageSize: paginaResult.pageSize,
        }
      : {
          items: [],
          total: 0,
          pageSize: recepcionSateliteConfig.DEFAULT_PAGE_SIZE,
        };

  // Pedido humano (2026-08-19): el catálogo de los filtros es el de `/ordenes` — la misma
  // acción, el mismo servicio—, que para el `adminSatelite` responde ACOTADO: la geografía de
  // SU zona (leída de la N:M de la zona, no derivada de las órdenes cargadas) y ni zonas ni
  // cuentas tienda. Va por props, resuelto tras la guardia de rol: los filtros están
  // operativos en el primer paint, sin una consulta por cada selección del usuario.
  //
  // La página NO falla si el catálogo falla: cualquier resultado que no sea `ok` deja `null`
  // y la barra se monta deshabilitada con la tabla viva (R64 de la 144).
  const catalogoResult = await obtenerCatalogoFiltrosOrdenes();
  const catalogoFiltros =
    catalogoResult.status === "ok" ? catalogoResult.catalogo : null;

  // Feature 246 (T4.3, R5/R29): las MISMAS dos fechas calendario que en `/ordenes`, resueltas
  // aquí, en el servidor, con el día de Costa Rica. La decisión D4 exige que la elección del día
  // signifique lo mismo desde las dos bodegas, y eso empieza por que la etiqueta salga del mismo
  // sitio. El caso de la medianoche (D6) está nombrado en `SelectorDiaReparto`.
  const fechasDiaReparto = {
    hoy: fechaCalendarioCR(),
    manana: mananaCalendarioCR(),
  };

  return (
    <AppPage
      title="En bodega"
      description="Órdenes que ya están en tu bodega satélite: asignar a un mensajero, enviar a central o recuperar."
    >
      <RecepcionSateliteModule
        // Feature 170 — FASE 2 (T K.3): el listado de la bodega recibe UNA PÁGINA, no los
        // cinco arrays por estado (`recibidas`, `asignadas`, `porDevolver`,
        // `enTransitoACentral`, `devueltas`) que `listarRecepcionSatelite` sigue trayendo.
        // Esos arrays ya no cruzan al cliente: quedan aquí, en el servidor.
        //
        // Feature 278 (T2.1, R18): `porRecibir` TAMPOCO cruza ya. Esta pantalla no lista
        // las órdenes en camino ni necesita ningún dato sobre ellas; `listarRecepcionSatelite`
        // se sigue llamando porque es de donde salen `zonaNombre` y `sinZona`.
        ordenesBodega={ordenesBodega}
        catalogoFiltros={catalogoFiltros}
        zonaNombre={result.zonaNombre}
        sinZona={result.sinZona}
        mensajeros={mensajeros}
        mensajerosBloqueadosIds={mensajerosBloqueadosIds}
        bloqueoBodega={bloqueoBodega}
        liberadasHoy={liberadasHoy}
        fechasDiaReparto={fechasDiaReparto}
      />
    </AppPage>
  );
}
