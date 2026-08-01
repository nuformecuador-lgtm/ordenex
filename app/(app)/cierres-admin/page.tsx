import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  listarCierresAdmin,
  listarHistoricoCierresAdminPaginado,
} from "@/lib/actions/cierres-admin";
import {
  listarConsolidacion,
  listarCierresBodegaAdmin,
  listarCierresBodegaSolicitadosPaginado,
  listarHistoricoCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";

import { CierresAdminModule } from "./_components/CierresAdminModule";
import { ConsolidacionBodegaModule } from "./_components/ConsolidacionBodegaModule";
import { CierresBodegaAdminModule } from "./_components/CierresBodegaAdminModule";

/**
 * Feature 38 (T12, R1/R3) + Feature 40 (T8, F1.4-l): módulo "Cierres" role-aware. El
 * rol se resuelve SOLO server-side vía `resolveActorFromSession` (patrón features
 * 33/36/37): cualquier rol distinto de `maestro`/`adminSatelite` (o sin sesión) NO
 * ve el módulo (`notFound`, defensa real). Sobre la base de la 38 (cierres de
 * mensajero) se añaden, POR ROL, las secciones de la feature 40 (cierre de bodega),
 * con los datos sensibles pre-fetch server-side y pasados por props a los
 * componentes cliente (el padre valida permisos, patrón architecture.md):
 * - adminSatelite: consolidación de su zona + "Solicitar cierre de bodega" (R1/R3-R10).
 * - maestro: cola + histórico de cierres de bodega para aprobar/rechazar (R2/R11-R20).
 * Si una Server Action de la 40 no responde `ok` (forbidden/unauthenticated), la
 * sección simplemente no se muestra (no rompe la página, defensa en profundidad).
 */
export default async function CierresAdminPage() {
  const actor = await resolveActorFromSession();
  // Feature 94 (paridad adm↔maestro): roles de ACCESO TOTAL (`maestro`/`admin`) y
  // `adminSatelite` ven el módulo; cualquier otro rol (o sin sesión) → `notFound`.
  if (!actor || (!esAccesoTotal(actor.rol) && actor.rol !== "adminSatelite")) {
    notFound(); // R1
  }

  const result = await listarCierresAdmin();
  if (result.status !== "ok") notFound(); // forbidden/unauthenticated → sin módulo

  // Feature 170 — FASE 2 (T I.2, R40/R41): el listado compuesto sigue trayendo la cola, los
  // totales y `sinZona`; el HISTÓRICO llega como PÁGINA 1 y su total, no como array entero.
  // El input va vacío: los defaults de `page`/`pageSize` los pone el schema del dominio.
  const historicoResult = await listarHistoricoCierresAdminPaginado({});
  if (historicoResult.status !== "ok") notFound(); // defensa en profundidad

  // Feature 40 — pre-fetch por rol de los datos sensibles del cierre de bodega.
  // adminSatelite: consolidación de SU zona (R1/R3). maestro/admin (acceso total,
  // feature 94): cola + histórico (R2).
  //
  // Feature 170 — FASE 2 (T I.2): los DOS históricos de bodega («solicitados» de la zona y
  // «resueltos» de la central) llegan también como página 1. Si el listado paginado no
  // responde `ok`, la sección entera no se muestra, igual que ya pasaba con su compuesto: la
  // pantalla no se rompe y no expone nada.
  const [consolidacionResult, solicitadosResult] =
    actor.rol === "adminSatelite"
      ? await Promise.all([
          listarConsolidacion(),
          listarCierresBodegaSolicitadosPaginado({}),
        ])
      : [null, null];
  const consolidacion =
    consolidacionResult &&
    consolidacionResult.status === "ok" &&
    solicitadosResult?.status === "ok"
      ? { ...consolidacionResult, solicitados: solicitadosResult }
      : null;

  const [bodegaResult, resueltosResult] = esAccesoTotal(actor.rol)
    ? await Promise.all([
        listarCierresBodegaAdmin(),
        listarHistoricoCierresBodegaPaginado({}),
      ])
    : [null, null];
  const bodega =
    bodegaResult && bodegaResult.status === "ok" && resueltosResult?.status === "ok"
      ? { ...bodegaResult, resueltos: resueltosResult }
      : null;

  return (
    <AppPage
      title="Cierres del día"
      description="Revisá el detalle de cada cierre solicitado por tus mensajeros y aprobalo o rechazalo"
    >
      {/* Feature 40 (adminSatelite): consolidación + solicitud de cierre de bodega. */}
      {consolidacion ? (
        <ConsolidacionBodegaModule
          consolidables={consolidacion.consolidables}
          totalesAgregados={consolidacion.totalesAgregados}
          totalPagoMensajeroAgregado={consolidacion.totalPagoMensajeroAgregado}
          totalIngresoBodegaRechazosAgregado={
            consolidacion.totalIngresoBodegaRechazosAgregado
          }
          totalNetoAgregado={consolidacion.totalNetoAgregado}
          totalCentralDebeAgregado={consolidacion.totalCentralDebeAgregado}
          puedesSolicitar={consolidacion.puedesSolicitar}
          motivoBloqueo={consolidacion.motivoBloqueo}
          cierresBodegaPasados={{
            items: consolidacion.solicitados.items,
            total: consolidacion.solicitados.total,
            pageSize: consolidacion.solicitados.pageSize,
          }}
          sinZona={consolidacion.sinZona}
        />
      ) : null}

      {/* Feature 40 (maestro): cola + histórico de cierres de bodega satélite. */}
      {bodega ? (
        <CierresBodegaAdminModule
          pendientes={bodega.pendientes}
          historico={{
            items: bodega.resueltos.items,
            total: bodega.resueltos.total,
            pageSize: bodega.resueltos.pageSize,
          }}
        />
      ) : null}

      {/* Feature 38: cierres del día de los mensajeros del alcance. */}
      <CierresAdminModule
        pendientes={result.pendientes}
        historico={{
          items: historicoResult.items,
          total: historicoResult.total,
          pageSize: historicoResult.pageSize,
        }}
        sinZona={result.sinZona}
      />
    </AppPage>
  );
}
