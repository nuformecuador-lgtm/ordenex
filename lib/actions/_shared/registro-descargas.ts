// Ficha 470 (design §2.1/§3.5, R12/R13/R24) — el REGISTRO de las acciones de descarga de Familia A: la
// lista cerrada de lo que `prepararDescargaAction` puede ejecutar. Un nombre fuera de aqui se rechaza
// sin ejecutar nada (R12).
//
// Cada entrada es un envoltorio de UN SOLO argumento: la accion recibe la entrada que manda el
// navegador y NUNCA un segundo argumento (`deps`), asi que desde el navegador no se puede inyectar nada
// en una accion (R13). `listarCoberturaDistritos` no tiene entrada: su primer parametro es `deps`, y su
// envoltorio descarta lo que llegue.
//
// IMPORTS ESTATICOS a proposito (no `import()` dinamico): `superficie-de-uso.guardia` resuelve la
// alcanzabilidad por imports estaticos, y asi las acciones siguen alcanzables a traves del registro.
//
// Modulo de servidor normal (NO "use server": exporta un objeto). El cliente solo importa sus TIPOS
// (`import type { NombreDescarga, RegistroDescargas }`), que se borran al compilar.
import { listarOrdenesCompleto } from "@/lib/actions/ordenes";
import { listarUsuariosCompleto } from "@/lib/actions/usuarios";
import { listarApiKeysCompleto } from "@/lib/actions/api-keys";
import { listarPlantillasCompleto } from "@/lib/actions/plantillas";
import { listarCoberturaDistritos } from "@/lib/actions/cobertura";
import { listarPlantillasCompletoAction } from "@/lib/actions/gasto-fijo-plantilla";
import { listarCierresPasadosCompleto } from "@/lib/actions/cierre-dia";
import {
  listarGestionesCierresAdminCompleto,
  listarHistoricoCierresAdminCompleto,
  listarPendientesCierresAdminCompleto,
} from "@/lib/actions/cierres-admin";
import {
  listarCierresBodegaSolicitadosCompleto,
  listarConsolidablesCompleto,
  listarGestionesCierresBodegaCompleto,
  listarHistoricoCierresBodegaCompleto,
  listarPendientesCierresBodegaCompleto,
} from "@/lib/actions/cierre-bodega";
import {
  listarConsolidacionesSateliteCompletoAction,
  listarSaldosSatelitesCompletoAction,
} from "@/lib/actions/conciliacion-satelites";
import { listarHistorialAccionesCompleto } from "@/lib/actions/historial-acciones";
import { listarHistoricoIncidentesCompleto, listarPendientesIncidentesCompleto } from "@/lib/actions/incidentes";
import { listarAyudaTiendaCompletoAction, listarNovedadesCompletoAction } from "@/lib/actions/novedades";
import { listarOrdenesBodegaCompleto } from "@/lib/actions/recepcion-satelite";
import { listarCuentasPorPagarCompletoAction } from "@/lib/actions/wallet-mensajero";
import {
  libroCajaKardexAction,
  libroCajaKardexConDetalleAction,
  verDetalleDeMovimientoCompletoAction,
} from "@/lib/actions/wallet";
import { listarSaldosTiendasCompletoAction, verDetalleDeMiMovimientoCompletoAction } from "@/lib/actions/wallet-tienda";
import {
  estadoCuentaKardexAction,
  estadoCuentaKardexConDetalleAction,
  miEstadoCuentaKardexAction,
  miEstadoCuentaKardexConDetalleAction,
} from "@/lib/actions/estado-cuenta";

/** Las 33 descargas de Familia A (design §2.1). La clave es la que usa `descargarDatos("<clave>", …)`. */
export const REGISTRO_DESCARGAS = {
  listarOrdenesCompleto: (input: unknown) => listarOrdenesCompleto(input),
  listarUsuariosCompleto: (input: unknown) => listarUsuariosCompleto(input),
  listarApiKeysCompleto: (input: unknown) => listarApiKeysCompleto(input),
  listarPlantillasCompleto: (input: unknown) => listarPlantillasCompleto(input),
  // Sin entrada: el primer parametro de la accion es `deps`; lo que llegue del navegador se DESCARTA.
  listarCoberturaDistritos: (_input?: unknown) => listarCoberturaDistritos(),
  listarPlantillasGastoFijoCompleto: (input?: unknown) => listarPlantillasCompletoAction(input),
  listarCierresPasadosCompleto: (input?: unknown) => listarCierresPasadosCompleto(input),
  listarPendientesCierresAdminCompleto: (input?: unknown) => listarPendientesCierresAdminCompleto(input),
  listarHistoricoCierresAdminCompleto: (input?: unknown) => listarHistoricoCierresAdminCompleto(input),
  listarGestionesCierresAdminCompleto: (input: unknown) => listarGestionesCierresAdminCompleto(input),
  listarCierresBodegaSolicitadosCompleto: (input?: unknown) => listarCierresBodegaSolicitadosCompleto(input),
  listarConsolidablesCompleto: (input?: unknown) => listarConsolidablesCompleto(input),
  listarPendientesCierresBodegaCompleto: (input?: unknown) => listarPendientesCierresBodegaCompleto(input),
  listarHistoricoCierresBodegaCompleto: (input?: unknown) => listarHistoricoCierresBodegaCompleto(input),
  listarGestionesCierresBodegaCompleto: (input: unknown) => listarGestionesCierresBodegaCompleto(input),
  listarSaldosSatelitesCompleto: (input: unknown) => listarSaldosSatelitesCompletoAction(input),
  listarConsolidacionesSateliteCompleto: (input: unknown) => listarConsolidacionesSateliteCompletoAction(input),
  listarHistorialAccionesCompleto: (input: unknown) => listarHistorialAccionesCompleto(input),
  listarHistoricoIncidentesCompleto: (input?: unknown) => listarHistoricoIncidentesCompleto(input),
  listarPendientesIncidentesCompleto: (input?: unknown) => listarPendientesIncidentesCompleto(input),
  listarNovedadesCompleto: (input?: unknown) => listarNovedadesCompletoAction(input),
  listarAyudaTiendaCompleto: (input?: unknown) => listarAyudaTiendaCompletoAction(input),
  listarOrdenesBodegaCompleto: (input?: unknown) => listarOrdenesBodegaCompleto(input),
  listarCuentasPorPagarCompleto: (input: unknown) => listarCuentasPorPagarCompletoAction(input),
  libroCajaKardex: (input: unknown) => libroCajaKardexAction(input),
  libroCajaKardexConDetalle: (input: unknown) => libroCajaKardexConDetalleAction(input),
  verDetalleDeMovimientoCompleto: (input: unknown) => verDetalleDeMovimientoCompletoAction(input),
  listarSaldosTiendasCompleto: (input?: unknown) => listarSaldosTiendasCompletoAction(input),
  verDetalleDeMiMovimientoCompleto: (input: unknown) => verDetalleDeMiMovimientoCompletoAction(input),
  estadoCuentaKardex: (input: unknown) => estadoCuentaKardexAction(input),
  estadoCuentaKardexConDetalle: (input: unknown) => estadoCuentaKardexConDetalleAction(input),
  miEstadoCuentaKardex: (input: unknown) => miEstadoCuentaKardexAction(input),
  miEstadoCuentaKardexConDetalle: (input: unknown) => miEstadoCuentaKardexConDetalleAction(input),
} as const;

export type RegistroDescargas = typeof REGISTRO_DESCARGAS;
export type NombreDescarga = keyof RegistroDescargas;

/** Los nombres validos, para el `z.enum` del borde (R12). */
export const NOMBRES_DESCARGA = Object.keys(REGISTRO_DESCARGAS) as [NombreDescarga, ...NombreDescarga[]];
