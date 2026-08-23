import { describe, it, expect } from "vitest";
import { OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo } from "@prisma/client";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
} from "@/lib/types/orden-historial";

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
    "anclaje_devolucion", // feature 239 (2026-08-19): CierresAdminRepository.resolverCierre (aprobar, devolucion_por_confirmar -> devuelta). El cron del SLA la busca POR ESTA FAMILIA para anclar el reloj
    "solicitud_ayuda_tienda", // feature 235 (2026-08-19): SolicitudAyudaService.solicitar (en_reparto -> ayuda_tienda, actor = el mensajero asignado)
    "rescate_ayuda_tienda", // feature 235 (2026-08-19): rescatarOrdenAyuda (ayuda_tienda -> en_reparto). UN productor, DOS puertas: «Recuperar» del mensajero y «Habilitar» de la tienda
    "gestion_tienda_ayuda", // feature 237 (2026-08-20): GestionOrdenRepository.crearGestionDesdeAyuda (ayuda_tienda -> reprogramada|rechazada, actor = el adminTienda dueño). La UNICA de las tres de la ayuda que SI es visita real
    "rechazo_tienda", // feature 240 (2026-08-20): GestionOrdenRepository.rechazarDesdeDevuelta (devuelta -> rechazada, actor = el adminTienda dueño). NO es visita real: la orden ya tiene contada su `devuelta`, como `reprogramacion_tienda`
    "habilitacion_api", // feature 266 (2026-08-23): ApiHabilitacionService -> OrdenRepository.transicionarAyuda (ayuda_tienda -> en_reparto, actor = el usuario dedicado de la API key). Familia propia y NO `rescate_ayuda_tienda`: el actor no distingue las vias, porque el usuario de la key ES la tienda. NO es visita real (R26): nadie fue a ninguna puerta
  ];

  it("contiene exactamente los 32 tipos de origen esperados (conjunto cerrado)", () => {
    expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED).toHaveLength(32); // 2026-08-19 (235): +solicitud_ayuda_tienda, +rescate_ayuda_tienda · 2026-08-20 (237): +gestion_tienda_ayuda · 2026-08-20 (240): +rechazo_tienda · 2026-08-23 (266): +habilitacion_api
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

  // -------------------------------------------------------------------------------------------
  // FEATURE 235 (T1.2, R10/R11) — las DOS familias de la ayuda a la tienda.
  //
  // El caso que protege DINERO es el segundo. Si alguna de las dos entrara en
  // `ORIGEN_TIPOS_VISITA_REAL`, cada solicitud de ayuda sumaria un intento de entrega de mas: el
  // cron del SLA (99) alcanzaria antes el umbral, escalaria antes a `rechazada` y dispararia el
  // `cobroRechazado` (56) — dinero real cobrado a la tienda antes de tiempo, en silencio y
  // castigando justamente a la orden sobre la que se pidio auxilio.
  // -------------------------------------------------------------------------------------------
  it("235/R10: las DOS familias estan en el SEED, una por cada SENTIDO del viaje", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("solicitud_ayuda_tienda");
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("rescate_ayuda_tienda");
    // Y el enum de la DB (via Prisma) tambien: sin drift en ninguna direccion (R9 de la 154).
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain("solicitud_ayuda_tienda");
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain("rescate_ayuda_tienda");
  });

  it("235/R11: NINGUNA de las dos es VISITA REAL — pedir ayuda no es un intento de entrega", () => {
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("solicitud_ayuda_tienda");
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("rescate_ayuda_tienda");
    // ⚠️ 2026-08-20 (feature 237, T2.1/R6) — EL CENSO PASA DE UNO A DOS MIEMBROS, a mano.
    // Antes: `toEqual(["gestion"])`. Ahora `gestion_tienda_ayuda` entra, porque es EL DESENLACE de
    // la visita que el mensajero si hizo (design 237 §7.3); las DOS familias de la 235 siguen
    // fuera, que es lo que este caso vigila.
    //
    // ESTE LITERAL ES EL CONTRATO, no un polizon: es el censo CERRADO que impide que una familia
    // futura entre de rebote y empiece a sumar intentos —y a cobrar `cobroRechazado` (56)— sin que
    // nadie lo decida. Se ACTUALIZA A MANO cuando alguien decide una alta, y JAMAS se sustituye por
    // una derivacion de su propia fuente: eso quedaria verde para siempre y el candado
    // desapareceria sin que se notara.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  it("235: ninguna de las dos entra en `ORIGEN_TIPOS_CON_GESTION` (sus filas nacen sin gestion)", () => {
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain("solicitud_ayuda_tienda");
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain("rescate_ayuda_tienda");
    expect([...ORIGEN_TIPOS_CON_GESTION]).toEqual(["gestion", "deshacer_gestion"]);
  });

  // -------------------------------------------------------------------------------------------
  // FEATURE 237 (T1.2/T2.1/T2.3, R5/R6/R43) — la TERCERA familia del viaje de la ayuda, la que
  // resuelve la orden.
  //
  // ⏳ 2026-08-20: aqui vivia el caso «235/P2: `gestion_tienda_ayuda` NO se declara — nace con su
  // productor (ficha 237)», que afirmaba `not.toContain`. Su unica funcion era ponerse rojo si
  // alguien adelantaba el valor sin productor (precedente `incidente`, 154, que costo el tren
  // 154+155+156). El productor ya existe —`GestionOrdenRepository.crearGestionDesdeAyuda`—, asi que
  // el caso CUMPLIO y se invierte: ahora vigila lo contrario, que la familia este declarada en los
  // DOS lados sin drift. No se borra, se le da la vuelta y queda escrito por que.
  // -------------------------------------------------------------------------------------------
  it("237/R5: la familia esta en el SEED y en el enum de la DB, sin drift en ninguna direccion", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("gestion_tienda_ayuda");
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain("gestion_tienda_ayuda");
  });

  it("237/R43: NO entra en `ORIGEN_TIPOS_CON_GESTION`, aunque su fila SI enlace gestion", () => {
    // Esa lista solo desambigua la NULIDAD del enlace `gestion_orden_id` (67/R25-R26): sus filas
    // nacen CON el enlace poblado, exactamente como `escalado_devuelta_sla` y `anclaje_devolucion`,
    // que tampoco estan. El literal de arriba (`["gestion","deshacer_gestion"]`) sigue verde SIN
    // tocarse, y esa inmovilidad es el punto.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain("gestion_tienda_ayuda");
  });

  // -------------------------------------------------------------------------------------------
  // FEATURE 240 (T1.3, D8/R6/R19/R44) — el RECHAZO MANUAL DE LA TIENDA, `devuelta -> rechazada`.
  //
  // La familia existe para poder responder «¿quien decidio esto?» sin adivinarlo por el par de
  // estatus: ese par YA lo produce el cron de plazo vencido (99, `escalado_devuelta_sla`) y las dos
  // vias cobran lo mismo. Sin familia propia, la pestaña «Rechazadas por plazo vencido» (102)
  // listaria rechazos que no vencieron ningun plazo.
  // -------------------------------------------------------------------------------------------
  it("240/R6: la familia esta en el SEED y en el enum de la DB, sin drift en ninguna direccion", () => {
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("rechazo_tienda");
    expect(Object.values(PrismaOrdenHistorialOrigenTipo)).toContain("rechazo_tienda");
  });

  it("240/R19: NO es visita real — la orden ya tiene contada su `devuelta`", () => {
    // 💰 EL CASO QUE PROTEGE EL DINERO DE ESTA FICHA, y la mutacion que hay que matar (T7.3).
    // Meter `rechazo_tienda` en esa lista haria que el rechazo manual sumase +1 sobre una orden que
    // YA cuenta su gestion `devuelta` real: el DOBLE CONTEO que 160/R2 evitaba. Ese +1 adelanta el
    // umbral del cron del SLA (99) sobre OTRAS ordenes de la misma tienda y con el el
    // `cobroRechazado` (56) — dinero real cobrado antes de tiempo, en silencio.
    //
    // La asimetria con `gestion_tienda_ayuda`, que SI esta, es deliberada y se afirma aqui junto a
    // esta para que se lean a la vez: aquella se hace sobre una orden en la que el mensajero NO
    // registro ningun desenlace (sin ella nadie cuenta esa visita); esta, sobre una que ya lo tiene.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("rechazo_tienda");
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toContain("gestion_tienda_ayuda");
    // Y el mismo trato que su hermana de forma, `reprogramacion_tienda` (100): las dos son
    // transiciones de escritorio sobre una orden ya contada.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("reprogramacion_tienda");
  });

  it("240/R6: NO entra en `ORIGEN_TIPOS_CON_GESTION`, aunque su fila SI enlace gestion", () => {
    // Igual que `escalado_devuelta_sla`, `anclaje_devolucion` y `gestion_tienda_ayuda`: esa lista
    // solo desambigua la NULIDAD del enlace (67/R25-R26), y estas filas nacen con el poblado.
    expect([...ORIGEN_TIPOS_CON_GESTION]).not.toContain("rechazo_tienda");
  });
});
