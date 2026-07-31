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
// en_bodega_central/en_ruta_bodega_central -> devolviendo_a_tienda con motivo="cancelada por tienda"): valor
// propio para que la linea de tiempo distinga esa cancelacion de integrador de una devolucion real.
// Feature 138: el conjunto pasa a 21 con `recepcion_bodega_central` (recepcion fisica en la central).
// Feature 139: el conjunto pasa a 22 con `devolucion_rechazada` (al APROBAR el cierre, rechazada ->
// por_devolver/por_devolver_a_tienda por zona): valor propio para que la linea de tiempo distinga la
// salida de `rechazada` disparada por la aprobacion del cierre de las cuatro transiciones de lote/recepcion
// del flujo (que reusan `ajuste_estado` / `recepcion_bodega_central`).
// Feature 154: el conjunto pasa a 24 con `recoleccion_tienda` (el mensajero recolecta en la tienda:
// por_recolectar_en_tienda -> en_ruta_bodega_central, #43) e `incidente` (familia propia del
// resultado `incidente` de la gestion). AMBAS nacen DECLARADAS Y SIN PRODUCTOR: ningun repo las
// emite hasta las features 157/158 (por eso no estan en PUNTOS_DE_ESCRITURA, ver
// tests/unit/repositories/orden-historial-cobertura.test.ts).
// Feature 149: el conjunto pasa a 25 con `deshacer_asignacion` (reversion de la asignacion/ruteo
// ANTES de la recogida: por_recoger -> en_bodega_central/en_bodega_satelite y
// en_ruta_bodega_satelite -> en_bodega_central): valor propio para que la linea de tiempo distinga
// la reversion de la asignacion que la produjo (`asignacion_bodega`/`asignacion_satelite`/
// `ruteo_satelite`) y de un parche administrativo generico (`ajuste_estado`). SI tiene productor
// (`OrdenRepository.deshacerAsignacionLote`), a diferencia de las dos de la 154.
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
    "liberacion_devuelta_sla", // feature 99: cron SLA, devuelta -> en_bodega_central/en_bodega_satelite
    "escalado_devuelta_sla", // feature 99: cron SLA, devuelta -> rechazada (gestion sintetica)
    "reprogramacion_tienda", // feature 100: adminTienda reprograma devuelta -> reprogramada
    "recuperacion_manual", // feature 100: bodega recupera devuelta -> en_bodega_central/en_bodega_satelite
    "cancelacion_api", // feature 106: OrdenRepository.cancelarViaApi (cancelacion por API key)
    "corte_sin_gestionar", // feature 109: CierreDiaRepository.crearCierre (corte, en_reparto -> sin_gestionar, actor null)
    "liberacion_sin_gestionar", // feature 109: CierresAdminRepository.resolverCierre (aprobar, sin_gestionar -> bodega)
    "recepcion_bodega_central", // feature 138: OrdenRepository.recibirEnBodegaCentral (recepcion fisica, en_ruta_bodega_central -> en_bodega_central)
    "devolucion_rechazada", // feature 139: CierresAdminRepository.resolverCierre (aprobar, rechazada -> por_devolver/por_devolver_a_tienda)
    "recoleccion_tienda", // feature 154 (R7): recoleccion en tienda, por_recolectar_en_tienda -> en_ruta_bodega_central (#43). SIN PRODUCTOR hasta la 157
    "incidente", // feature 154 (R8): familia propia del resultado `incidente`. SIN PRODUCTOR hasta la 158
    "deshacer_asignacion", // feature 149: OrdenRepository.deshacerAsignacionLote (reversion antes de la recogida); la 157 le suma la reversion de una recoleccion
    "asignacion_recoleccion", // feature 157 (ampliacion): GuiaAsignacionService.asignarRecoleccion (por_recolectar_en_tienda -> recolectando)
  ];

  it("contiene exactamente los 26 tipos de origen esperados (conjunto cerrado)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(26);
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual([...ESPERADOS].sort());
  });

  // Feature 154/R9: correspondencia EXACTA en AMBAS direcciones entre el catalogo declarado en
  // TS y el enum respaldado en base de datos. La direccion codigo -> DB la fuerza el `satisfies`
  // del modulo y la direccion DB -> codigo el `_EnsureExhaustive`: las dos rompen el BUILD. Este
  // test lo verifica ademas en runtime contra el enum que Prisma genera del schema.
  it("coincide 1:1 con los valores del enum Prisma orden_historial_origen_tipo", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED].sort()).toEqual(
      Object.values(PrismaOrdenHistorialOrigenTipo).sort(),
    );
  });

  it("feature 154/R7/R8: reconoce recoleccion_tienda e incidente como familias de origen", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("recoleccion_tienda");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("incidente");
    // Y el enum de la DB (via Prisma) tambien: sin drift en ninguna direccion (R9).
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain("recoleccion_tienda");
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain("incidente");
  });

  it("no tiene valores duplicados", () => {
    expect(new Set(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).size).toBe(
      ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length,
    );
  });
});
