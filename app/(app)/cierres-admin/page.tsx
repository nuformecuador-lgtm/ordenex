import { notFound } from "next/navigation";

import { AppPage } from "@/components/shared/AppPage";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { listarCierresAdmin } from "@/lib/actions/cierres-admin";
import {
  listarConsolidacion,
  listarCierresBodegaAdmin,
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

  // Feature 40 — pre-fetch por rol de los datos sensibles del cierre de bodega.
  // adminSatelite: consolidación de SU zona (R1/R3). maestro/admin (acceso total,
  // feature 94): cola + histórico (R2).
  const consolidacionResult =
    actor.rol === "adminSatelite" ? await listarConsolidacion() : null;
  const consolidacion =
    consolidacionResult && consolidacionResult.status === "ok"
      ? consolidacionResult
      : null;

  const bodegaResult =
    esAccesoTotal(actor.rol) ? await listarCierresBodegaAdmin() : null;
  const bodega =
    bodegaResult && bodegaResult.status === "ok" ? bodegaResult : null;

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
          cierresBodegaPasados={consolidacion.cierresBodegaPasados}
          sinZona={consolidacion.sinZona}
        />
      ) : null}

      {/* Feature 40 (maestro): cola + histórico de cierres de bodega satélite. */}
      {bodega ? (
        <CierresBodegaAdminModule
          pendientes={bodega.pendientes}
          historico={bodega.historico}
        />
      ) : null}

      {/* Feature 38: cierres del día de los mensajeros del alcance. */}
      <CierresAdminModule
        pendientes={result.pendientes}
        historico={result.historico}
        sinZona={result.sinZona}
      />
    </AppPage>
  );
}
