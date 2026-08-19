import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  listarCierresAdmin,
  listarHistoricoCierresAdminPaginado,
  listarPendientesCierresAdminPaginado,
  obtenerCatalogoFiltrosCierres,
} from "@/lib/actions/cierres-admin";
import { CATALOGO_FILTROS_CIERRES_VACIO } from "@/lib/types/filtros-cierres";
import {
  listarConsolidacion,
  listarCierresBodegaSolicitadosPaginado,
  listarConsolidablesPaginado,
  listarHistoricoCierresBodegaPaginado,
  listarPendientesCierresBodegaPaginado,
} from "@/lib/actions/cierre-bodega";

import { CierresAdminModule } from "./_components/CierresAdminModule";
import { ConsolidacionBodegaModule } from "./_components/ConsolidacionBodegaModule";
import { CierresBodegaAdminModule } from "./_components/CierresBodegaAdminModule";
import { CierresTabs } from "./_components/CierresTabs";

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

  // Feature 170 — FASE 2 (T I.2/T J.2, R40/R41): el listado compuesto sigue trayendo los
  // totales y `sinZona`; las DOS tablas —la COLA de pendientes y el HISTÓRICO— llegan como
  // PÁGINA 1 con su total, no como arrays enteros. El input va vacío: los defaults de
  // `page`/`pageSize` los pone el schema del dominio.
  //
  // Pedido humano del 2026-08-16 — se resuelve tambien el CATALOGO de los filtros (bodegas
  // destino y mensajeros del alcance). Va en el MISMO `Promise.all` y no en una lectura aparte:
  // es independiente de las otras dos, y secuenciarla sumaria su latencia al TTFB sin ganar
  // nada. Las dos paginas se piden SIN filtros, que es el estado inicial de la pantalla.
  const [pendientesResult, historicoResult, catalogoResult] = await Promise.all([
    listarPendientesCierresAdminPaginado({}),
    listarHistoricoCierresAdminPaginado({}),
    obtenerCatalogoFiltrosCierres(),
  ]);
  if (pendientesResult.status !== "ok") notFound(); // defensa en profundidad
  if (historicoResult.status !== "ok") notFound(); // defensa en profundidad
  // El catalogo NO tumba la pagina si falla: sin opciones la pantalla se queda sin filtrar,
  // que es exactamente lo que era antes de esta feature. Un listado de cierres que no se
  // puede abrir es peor que uno que no se puede filtrar.
  const catalogoFiltros =
    catalogoResult.status === "ok"
      ? catalogoResult.catalogo
      : CATALOGO_FILTROS_CIERRES_VACIO;

  // Feature 40 — pre-fetch por rol de los datos sensibles del cierre de bodega.
  // adminSatelite: consolidación de SU zona (R1/R3). maestro/admin (acceso total,
  // feature 94): cola + histórico (R2).
  //
  // Feature 170 — FASE 2 (T I.2/T J.2): las tablas de las dos secciones llegan como página 1
  // («consolidables» y «solicitados» del satélite; «pendientes» y «resueltos» de la central).
  // El compuesto de la CONSOLIDACIÓN sigue haciendo falta, y es el aviso medido que la tanda J
  // dejó escrito: de él salen los cinco agregados de dinero calculados sobre el conjunto
  // COMPLETO (R49), el gate `puedesSolicitar`/`motivoBloqueo` y `sinZona`. Su array no puede
  // desaparecer —el dinero se calcula sobre él— pero ya no cruza al cliente: se queda aquí.
  // Si un listado paginado no responde `ok`, la sección entera no se muestra, igual que ya
  // pasaba con su compuesto: la pantalla no se rompe y no expone nada.
  const [consolidacionResult, consolidablesResult, solicitadosResult] =
    actor.rol === "adminSatelite"
      ? await Promise.all([
          listarConsolidacion(),
          listarConsolidablesPaginado({}),
          listarCierresBodegaSolicitadosPaginado({}),
        ])
      : [null, null, null];
  const consolidacion =
    consolidacionResult &&
    consolidacionResult.status === "ok" &&
    consolidablesResult?.status === "ok" &&
    solicitadosResult?.status === "ok"
      ? {
          ...consolidacionResult,
          paginaConsolidables: consolidablesResult,
          solicitados: solicitadosResult,
        }
      : null;

  // Feature 170 — FASE 2 (T M.1, cierre de Q-J1/Q-I4): el listado COMPUESTO de esta sección
  // (`listarCierresBodegaAdmin`) sale del render. Sus dos arrays —cola e histórico— dejaron de
  // tener lector de tabla en T I.2/T J.2, y su `status` no decidía nada que no decidiera ya el
  // `esAccesoTotal` de esta misma línea, que es el MISMO guard que aplican los dos listados
  // paginados. Traerlo era una lectura de TODOS los cierres de bodega por render cuyo único
  // efecto era un `if` redundante.
  //
  // Feature 184 — Tanda E (T E.3): la acción tampoco es ya de donde sale el archivo. Las dos
  // tablas de esta sección descargan cada una SU mitad (`listarPendientesCierresBodegaCompleto`
  // y `listarHistoricoCierresBodegaCompleto`), así que `listarCierresBodegaAdmin` se queda sin
  // ningún lector de producción. No se retira aquí: es candidata a retirada de la tanda H,
  // anotada en `progress/impl_184_tandaE_frontend.md §8`.
  const [bodegaPendientesResult, resueltosResult] = esAccesoTotal(actor.rol)
    ? await Promise.all([
        listarPendientesCierresBodegaPaginado({}),
        listarHistoricoCierresBodegaPaginado({}),
      ])
    : [null, null];
  const bodega =
    bodegaPendientesResult?.status === "ok" && resueltosResult?.status === "ok"
      ? { pendientesPagina: bodegaPendientesResult, resueltos: resueltosResult }
      : null;

  return (
    <AppPage
      title="Cierres del día"
      description="Revisá el detalle de cada cierre solicitado por tus mensajeros y aprobalo o rechazalo"
    >
      {/* Pedido humano del 2026-08-16 — la pantalla se divide en BODEGA y MENSAJERO, con el
          conmutador segmentado del portal del mensajero (ver `CierresTabs`). Cuál es la mitad
          de «bodega» depende del ROL, y esa decisión sigue donde estaba: el `adminSatelite`
          consolida la suya, el maestro decide sobre las de todos, y quien no tenga ninguna de
          las dos ve los cierres del día sin conmutador. */}
      <CierresTabs
        bodega={
          consolidacion === null && bodega === null ? null : (
          <>
      {/* Feature 40 (adminSatelite): consolidación + solicitud de cierre de bodega. */}
      {consolidacion ? (
        <ConsolidacionBodegaModule
          consolidables={{
            items: consolidacion.paginaConsolidables.items,
            total: consolidacion.paginaConsolidables.total,
            pageSize: consolidacion.paginaConsolidables.pageSize,
          }}
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
          catalogoFiltros={catalogoFiltros}
        />
      ) : null}

      {/* Feature 40 (maestro): cola + histórico de cierres de bodega satélite. */}
      {bodega ? (
        <CierresBodegaAdminModule
          pendientes={{
            items: bodega.pendientesPagina.items,
            total: bodega.pendientesPagina.total,
            pageSize: bodega.pendientesPagina.pageSize,
          }}
          historico={{
            items: bodega.resueltos.items,
            total: bodega.resueltos.total,
            pageSize: bodega.resueltos.pageSize,
          }}
          catalogoFiltros={catalogoFiltros}
        />
      ) : null}
          </>
          )
        }
        mensajero={
      /* Feature 38: cierres del día de los mensajeros del alcance. */
      <CierresAdminModule
        pendientes={{
          items: pendientesResult.items,
          total: pendientesResult.total,
          pageSize: pendientesResult.pageSize,
        }}
        historico={{
          items: historicoResult.items,
          total: historicoResult.total,
          pageSize: historicoResult.pageSize,
        }}
        sinZona={result.sinZona}
        catalogoFiltros={catalogoFiltros}
        /**
         * Feature 172 (T E.1/T E.2, [P3]/R6) — el permiso de PAGAR se resuelve SOLO
         * server-side y con el MISMO predicado (`esAccesoTotal`) que `LiquidacionService` usa
         * para responder `forbidden`. Son las dos mitades del control de acceso: ocultar el
         * botón no es una de ellas por sí solo, y la acción tampoco lo es sin la otra.
         *
         * Aquí sí hay un rol al que le da `false` y que igualmente ve la pantalla: el
         * `adminSatelite`, que APRUEBA los cierres de su zona y NO mueve dinero (respuesta P3
         * del humano: aprobar un cierre y mover dinero no son la misma responsabilidad). Para
         * él, aprobar sigue funcionando exactamente como antes de esta feature.
         */
        puedeRegistrarPago={esAccesoTotal(actor.rol)}
        /**
         * Pedido humano (2026-08-19) — el permiso de CORREGIR el desglose de pago, resuelto
         * server-side con el MISMO predicado que exige `CierresAdminService`. Al
         * `adminSatelite` le da `false` A PROPÓSITO aunque vea (y apruebe) los cierres de su
         * zona: reescribir lo que un mensajero declaró haber cobrado no es aprobar, es tocar
         * la caja. El servicio le responde `forbidden` aunque alguien invoque la acción a mano.
         */
        puedeCorregirPagos={esAccesoTotal(actor.rol)}
      />
        }
      />
    </AppPage>
  );
}
