import { describe, it, expect } from "vitest";
import { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 49/R23 — el tipo de origen es un CONJUNTO CERRADO de los call-sites de escritura
// de `orden.estatus_id` (design §1.2/§2). La exhaustividad frente al enum Prisma es de
// compile-time (satisfies + chequeo `_EnsureExhaustive` en el modulo); aqui se verifica el
// contenido en runtime.
// Feature 67 (F1.4-b): el conjunto pasa a 12 con `deshacer_gestion` (migracion
// `*_gestion_orden_anulacion` + su down.sql). A diferencia de la 47/48 —que reutilizaron
// `gestion`/`ajuste_estado`—, el deshacer SI necesita valor propio: el proposito de la feature
// es el RASTRO, y reusar `gestion` haria la linea de tiempo indistinguible de una gestion real.
// Feature 99: el conjunto pasa a 15 con `liberacion_devuelta_sla` y `escalado_devuelta_sla` (cron
// SLA): dos valores propios para que la linea de tiempo distinga el reintento del escalado.
// Feature 100: el conjunto pasa a 17 con `reprogramacion_tienda` (adminTienda reprograma desde
// `devuelta`) y `recuperacion_manual` (bodega recupera desde `devuelta`): dos valores propios para
// que la linea de tiempo distinga las acciones MANUALES que resuelven una novedad del cron SLA (99).
// Feature 106: el conjunto pasa a 18 con `cancelacion_api` (cancelacion de la tienda por API key:
// en_bodega/en_ruta_bodega_principal -> devuelta_origen con motivo="cancelada por tienda"): valor
// propio para que la linea de tiempo distinga esa cancelacion de integrador de una devolucion real.
describe("ORDEN_HISTORIAL_ORIGEN_TIPO_SEED (R23)", () => {
  const ESPERADOS = [
    "carga_masiva",
    "creacion_manual",
    "generacion_guia",
    "asignacion_bodega",
    "ruteo_satelite",
    "recepcion_satelite",
    "asignacion_satelite",
    "recoleccion",
    "gestion",
    "liberacion_reprogramada",
    "ajuste_estado",
    "deshacer_gestion", // feature 67: CierreDiaRepository.anularGestionYDevolverAGestion
    "carga_api", // feature 88 (D7): createManyOrdenesConGuia (canal integrador por API)
    "liberacion_devuelta_sla", // feature 99: cron SLA, devuelta -> en_bodega/en_bodega_satelite
    "escalado_devuelta_sla", // feature 99: cron SLA, devuelta -> rechazada (gestion sintetica)
    "reprogramacion_tienda", // feature 100: adminTienda reprograma devuelta -> reprogramada
    "recuperacion_manual", // feature 100: bodega recupera devuelta -> en_bodega/en_bodega_satelite
    "cancelacion_api", // feature 106: OrdenRepository.cancelarViaApi (cancelacion por API key)
    "corte_sin_gestionar", // feature 109: CierreDiaRepository.crearCierre (corte, en_reparto -> sin_gestionar, actor null)
    "liberacion_sin_gestionar", // feature 109: CierresAdminRepository.resolverCierre (aprobar, sin_gestionar -> bodega)
  ];

  it("contiene exactamente los 20 tipos de origen esperados (conjunto cerrado)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(20);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual([...ESPERADOS].sort());
  });

  it("coincide 1:1 con los valores del enum Prisma orden_historial_origen_tipo", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual(
      Object.values(PrismaOrdenHistorialOrigenTipo).sort(),
    );
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).size).toBe(
      ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length,
    );
  });
});
