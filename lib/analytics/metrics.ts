// Feature 135 (T3.1) — EL catalogo de KPIs de analitica. FUENTE UNICA (R2): ninguna
// de las 13 features consumidoras (122-134) declara un KPI por su cuenta; todas leen
// `METRICAS` de aqui.
//
// El contenido NO es opinion del implementer: es `design.md §3.3`, aprobado ENTERO por
// el humano el 2026-07-30 (D1 «todas») = **15 ids operativos + 8 financieros = 23**.
// Anadir o quitar una metrica exige una decision humana nueva y fechada.
//
// R1 (modulo puro): este archivo no importa `@/lib/db`, ni repositorios, ni servicios,
// ni `next/headers`, ni `@prisma/client` como valor, ni ejecuta efectos al importarse.
// Lo unico que importa en runtime son catalogos de dominio ya puros del repo
// (`ORDER_STATUS_SEED`, `ESTADOS_CREACION`, `ESTADOS_TERMINALES`), a proposito: citar
// los estados a mano seria una lista paralela que se desincroniza en silencio.
//
// Decisiones del humano materializadas aqui:
// - D5/R30  cubo `sin_asignar`: toda metrica con grano `mensajero` declara
//           `definicion.sinAsignar: "incluir"` (las ordenes sin mensajero NO se descartan).
// - D7/R32  el dinero es de DOS roles: `maestro` y `admin` (los de `esAccesoTotal`);
//           `adminSatelite`, `adminTienda` y `mensajero` -> `prohibido`, nunca `acotado`.
// - D8/R33  `estadoProduccion`: una metrica `declarada` NO es deuda de la 126/127.
// - D9/R34  toda metrica con grano `zona` atribuye por `orden.zona_id` CONGELADO,
//           jamas por la zona del mensajero que la gestiono (que puede diferir).
// - D10/R35 UNA sola convencion: entregas/devoluciones/rechazos/reprogramaciones/
//           incidentes cuentan GESTIONES vigentes (`anulada_at IS NULL`), no ordenes; las
//           tres tasas son sobre gestiones y su denominador NO es el numero de ordenes.
// - D10/R36 `unidadDeConteo` + `sonSumables()`: dos metricas de unidad distinta no se
//           suman entre si (una orden reprogramada y luego entregada aporta 2 gestiones).
//
// El catalogo vive en TypeScript congelado (`as const`), no en base de datos: ver la
// alternativa 1 descartada en `design.md §7`.

import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import { ESTADOS_CREACION, ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import type {
  AlcanceMetrica,
  EstadoProduccion,
  Metrica,
  MetricaDominio,
  RolAnalitica,
} from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* Alcance por rol (R7 / R32)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Operativas: `total` para los dos roles de `esAccesoTotal` (`maestro`, `admin`) y
 * `acotado` para los otros tres — la ven, pero recortada por el WHERE de la 122.
 */
const ALCANCE_OPERATIVA = {
  maestro: "total",
  admin: "total",
  adminSatelite: "acotado",
  adminTienda: "acotado",
  mensajero: "acotado",
} as const satisfies Readonly<Record<RolAnalitica, AlcanceMetrica>>;

/**
 * Financieras (D7/R32): el dinero es de DOS roles. `adminTienda` NO ve su cuenta por
 * pagar y `mensajero` NO ve su devengado aunque la 127 los calcule; no existe vista
 * financiera recortada (aviso dirigido a la 132 y a la 133, `design.md §6.1`).
 */
const ALCANCE_FINANCIERA = {
  maestro: "total",
  admin: "total",
  adminSatelite: "prohibido",
  adminTienda: "prohibido",
  mensajero: "prohibido",
} as const satisfies Readonly<Record<RolAnalitica, AlcanceMetrica>>;

/* -------------------------------------------------------------------------- */
/* Vocabularios citados (R8 / R9)                                              */
/* -------------------------------------------------------------------------- */

/** Lo que NUNCA cuenta una metrica por gestion (D10/R35). Cita la columna real. */
const EXCLUYE_GESTIONES_ANULADAS = ["gestion_orden.anulada_at IS NOT NULL"] as const;

/** Denominador comun de las tres tasas: GESTIONES, no ordenes (D10/R35). */
const DENOMINADOR_GESTIONES = ["entregas", "devoluciones", "rechazos", "incidentes"] as const;

/** Creacion -> terminal: los extremos del tiempo de ciclo, sin listas paralelas. */
const ESTADOS_CICLO = [
  ...ESTADOS_CREACION,
  ...ESTADOS_TERMINALES,
] as const satisfies readonly OrderStatusValue[];

/* -------------------------------------------------------------------------- */
/* EL catalogo (design.md §3.3, D1 «todas»)                                    */
/* -------------------------------------------------------------------------- */

/**
 * El catalogo LITERAL. Se declara privado y `as const` para poder derivar de el la
 * union de ids (`MetricaId`); lo que se exporta es `METRICAS`, con el tipo ancho
 * `readonly Metrica[]` que declara `design.md §3.2` — asi los consumidores acceden a
 * los campos opcionales de `definicion` sin estrechar por metrica.
 */
const CATALOGO = [
  /* ---------------------------- 15 OPERATIVAS ---------------------------- */
  {
    id: "ordenes_creadas",
    etiqueta: "Ordenes creadas",
    descripcion:
      "Ordenes nacidas en el rango (en_preparacion o por_recolectar_en_tienda); cuenta ORDENES, no gestiones, asi que las gestiones anuladas (anulada_at) no la afectan ni la inflan.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "orden",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: { estados: ESTADOS_CREACION, atribucionZona: "orden" },
  },
  {
    id: "ordenes_por_estado",
    etiqueta: "Ordenes por estado",
    descripcion:
      "Embudo: ORDENES agrupadas por su estado actual entre los 19 values vigentes del catalogo; no cuenta gestiones, asi que una gestion anulada no mueve esta cifra (solo la mueve el estado real de la orden).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "orden",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero", "estatus"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: { estados: ORDER_STATUS_SEED, sinAsignar: "incluir", atribucionZona: "orden" },
  },
  {
    id: "entregas",
    etiqueta: "Entregas",
    descripcion:
      "Gestiones VIGENTES con resultado entregada; no cuenta ordenes ni gestiones anuladas (anulada_at IS NOT NULL).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      categorias: ["entregada"],
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "devoluciones",
    etiqueta: "Devoluciones",
    descripcion:
      "Gestiones VIGENTES con resultado devuelta; no cuenta ordenes ni gestiones anuladas (anulada_at IS NOT NULL).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      categorias: ["devuelta"],
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "rechazos",
    etiqueta: "Rechazos",
    descripcion:
      "Gestiones VIGENTES con resultado rechazada; no cuenta ordenes ni gestiones anuladas (anulada_at IS NOT NULL).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      categorias: ["rechazada"],
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "reprogramaciones",
    etiqueta: "Reprogramaciones",
    descripcion:
      "Gestiones VIGENTES con resultado reprogramada; no cuenta ordenes ni gestiones anuladas (anulada_at IS NOT NULL), y una misma orden puede aportar varias.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      categorias: ["reprogramada"],
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "incidentes",
    etiqueta: "Incidentes",
    descripcion:
      "Gestiones VIGENTES con resultado incidente (paquete danado, perdido o robado); no cuenta ordenes ni gestiones anuladas (anulada_at IS NOT NULL).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    // `producida` desde ⟨D11⟩ (humano, 2026-08-03 — ver `progress/decision_175.md`). Decia
    // `declarada` afirmando que el rollup no la compromete, y es falso: `analytics_daily` tiene
    // su columna real `incidentes` (`db/schema.prisma:1891`, «4.o termino de
    // DENOMINADOR_GESTIONES (R18)»), asi que la 126 ya divide entre ella en las tres tasas.
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      categorias: ["incidente", "danado", "perdido", "robado"],
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "sin_gestionar",
    etiqueta: "Sin gestionar",
    descripcion:
      "ORDENES que el corte diario congelo en el estado sin_gestionar; cuenta ordenes, no gestiones, y son justamente las que no tienen gestion vigente del dia (las gestiones anuladas tampoco las rescatan).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "orden",
    // `producida` desde ⟨D11⟩ (humano, 2026-08-03 — ver `progress/decision_175.md`). Decia
    // `declarada` porque la ficha de la 126 no la nombra, pero la 126 SI la sirve: la deriva del
    // embudo, proyectando la medida `ordenes_estado_stock` sobre este estatus
    // (`lib/services/AnaliticaOperativaService.ts:88,316-318,348-362`).
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: { estados: ["sin_gestionar"], sinAsignar: "incluir", atribucionZona: "orden" },
  },
  {
    id: "tasa_entrega",
    etiqueta: "Tasa de entrega",
    descripcion:
      "Entregas sobre el total de gestiones vigentes de resultado (entregas+devoluciones+rechazos+incidentes); es una tasa SOBRE GESTIONES: el denominador NO es el numero de ordenes (una orden reprogramada y luego entregada aporta dos gestiones) y excluye las gestiones anuladas.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "porcentaje",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      razon: { numerador: "entregas", denominador: DENOMINADOR_GESTIONES },
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "tasa_devolucion",
    etiqueta: "Tasa de devolucion",
    descripcion:
      "Devoluciones sobre el total de gestiones vigentes de resultado (entregas+devoluciones+rechazos+incidentes); es una tasa SOBRE GESTIONES: el denominador NO es el numero de ordenes y excluye las gestiones anuladas.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "porcentaje",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      razon: { numerador: "devoluciones", denominador: DENOMINADOR_GESTIONES },
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "tasa_rechazo",
    etiqueta: "Tasa de rechazo",
    descripcion:
      "Rechazos sobre el total de gestiones vigentes de resultado (entregas+devoluciones+rechazos+incidentes); es una tasa SOBRE GESTIONES: el denominador NO es el numero de ordenes y excluye las gestiones anuladas.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "porcentaje",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      razon: { numerador: "rechazos", denominador: DENOMINADOR_GESTIONES },
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "primer_intento_ok",
    etiqueta: "Entrega al primer intento",
    descripcion:
      "Entregas logradas sin intento previo, contadas con el criterio UNICO ya existente en el repo (transiciones vigentes del historial con destino devuelta, o destino reprogramada de familia gestion), que excluye las causadas por gestiones anuladas; esta metrica NO define umbral propio ni columna materializada.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "porcentaje",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "mensajero"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      // R11: se REMITE al criterio de la feature 160 (`OrdenHistorialService.contarIntentos`).
      // No hay `umbral` ni parametro propio: el tipo `DefinicionMetrica` ni siquiera
      // admite uno, y este comentario existe para que nadie lo anada "por comodidad".
      criterio: "intentos_vigentes_historial",
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      sinAsignar: "incluir",
      atribucionZona: "orden",
    },
  },
  {
    id: "motivos_devolucion",
    etiqueta: "Motivos de devolucion",
    descripcion:
      "Gestiones VIGENTES de resultado devuelta agrupadas por su causa tipificada (not_found, wrong_number, wrong_address); no cuenta ordenes ni gestiones anuladas (anulada_at IS NOT NULL).",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "conteo",
    unidadDeConteo: "gestion",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "causa_devolucion"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: {
      // OJO: `GestionCausaDevolucion` tiene TRES valores en el esquema vigente
      // (`db/schema.prisma`), no cinco como dice de memoria `design.md §3.3`.
      categorias: ["devuelta", "not_found", "wrong_number", "wrong_address"],
      excluye: EXCLUYE_GESTIONES_ANULADAS,
      atribucionZona: "orden",
    },
  },
  {
    id: "tiempo_ciclo",
    etiqueta: "Tiempo de ciclo",
    descripcion:
      "Segundos entre la creacion de la orden y su llegada a un estado terminal (entregada, devuelta_a_tienda, incidente); mide tiempo de ORDENES, no volumen de gestiones, y no lo alteran las gestiones anuladas.",
    dominio: "operativa",
    clase: "snapshot",
    unidad: "segundos",
    unidadDeConteo: "tiempo",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda"],
    fuente: { tipo: "rollup", tablas: ["analytics_daily"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: { estados: ESTADOS_CICLO, atribucionZona: "orden" },
  },
  {
    id: "aging_por_estado",
    etiqueta: "Antiguedad por estado",
    descripcion:
      "Segundos que las ordenes vivas llevan en su estado actual, leidos INTRADIA de las tablas vivas; mide tiempo de ordenes, no volumen de gestiones, y las gestiones anuladas no cuentan porque no producen transicion vigente.",
    dominio: "operativa",
    // Unica metrica `live` del catalogo: se calcula sobre las tablas vivas, no sobre el
    // rollup. R5 exige la equivalencia `snapshot` <=> fuente `rollup`.
    clase: "live",
    unidad: "segundos",
    unidadDeConteo: "tiempo",
    estadoProduccion: "producida",
    granos: ["fecha", "zona", "tienda", "estatus"],
    fuente: { tipo: "tabla_viva", tablas: ["orden", "orden_historial_estado"] },
    alcance: ALCANCE_OPERATIVA,
    definicion: { estados: ORDER_STATUS_SEED, atribucionZona: "orden" },
  },

  /* ---------------------------- 8 FINANCIERAS ---------------------------- */
  // R6: fuente EXCLUSIVA ledgers append-only + snapshots de cierre. Ninguna cita
  // `orden`, `gestion_orden`, `orden_historial_estado` ni `analytics_daily`: el dinero
  // NUNCA se recalcula desde ordenes (consigna de la 127). Por eso ninguna es `snapshot`
  // (R5: `snapshot` <=> rollup) y ninguna declara los granos `zona`/`mensajero`, cuya
  // semantica en este catalogo es la de la ORDEN (D9/D5) y no la del ledger.
  {
    id: "cod_recaudado",
    etiqueta: "COD recaudado",
    descripcion:
      "Contra-entrega recaudado por metodo de pago (efectivo, SINPE, transferencia) segun los totales SNAPSHOT del cierre y el credito cod_recaudado del ledger de tienda; no se recalcula desde ordenes ni desde gestiones, asi que las gestiones anuladas no la tocan.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha", "tienda", "metodo_pago"],
    fuente: { tipo: "snapshot_cierre", tablas: ["cierre_dia", "wallet_tienda_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: { categorias: ["efectivo", "SINPE", "transferencia", "cod_recaudado"] },
  },
  {
    id: "ingreso_flete",
    etiqueta: "Ingreso por flete",
    descripcion:
      "Ingreso de Ordenex por flete y por flete de devolucion segun el libro append-only de la wallet; se lee del ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha"],
    fuente: { tipo: "ledger", tablas: ["wallet_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: { categorias: ["ingreso_flete", "ingreso_flete_devolucion"] },
  },
  {
    id: "ingreso_comision_cod",
    etiqueta: "Ingreso por comision COD",
    descripcion:
      "Ingreso de Ordenex por comision sobre el contra-entrega segun el libro append-only de la wallet; se lee del ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha"],
    fuente: { tipo: "ledger", tablas: ["wallet_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: { categorias: ["ingreso_comision_cod"] },
  },
  {
    id: "ingreso_iva",
    etiqueta: "Ingreso por IVA",
    descripcion:
      "IVA facturado sobre flete, flete de devolucion y comision COD segun el libro append-only de la wallet; se lee del ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha"],
    fuente: { tipo: "ledger", tablas: ["wallet_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: {
      categorias: ["ingreso_iva_flete", "ingreso_iva_flete_devolucion", "ingreso_iva_comision_cod"],
    },
  },
  {
    id: "egresos",
    etiqueta: "Egresos",
    descripcion:
      "Salidas de la caja principal (pagos a tienda y mensajero, sueldos, gastos fijos y variables, indemnizaciones y ajustes) segun el libro append-only de la wallet; se lee del ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    // `producida` desde ⟨D8⟩ (humano, 2026-08-02 — ver `progress/decision_C2_127.md`). La ficha
    // original de la 127 comprometia ingresos, cuentas por pagar y conciliacion de cierres, y los
    // egresos NO aparecian ahi: por eso esto decia `declarada`. El humano amplio el alcance y la
    // 127 los sirve de verdad (Σ de las ocho categorias `egreso_*`, tarea D.5).
    estadoProduccion: "producida",
    granos: ["fecha"],
    fuente: { tipo: "ledger", tablas: ["wallet_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: {
      categorias: [
        "egreso_pago_tienda",
        "egreso_pago_mensajero",
        "egreso_gasto",
        "egreso_sueldo",
        "egreso_ajuste",
        "egreso_gasto_fijo",
        "egreso_gasto_variable",
        "egreso_indemnizacion",
      ],
    },
  },
  {
    id: "cuenta_por_pagar_tienda",
    etiqueta: "Cuenta por pagar a tiendas",
    descripcion:
      "Saldo derivado del ledger por tienda (SUM credito - SUM debito): lo que Ordenex le debe entregar a cada tienda; se lee del ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha", "tienda"],
    fuente: { tipo: "ledger", tablas: ["wallet_tienda_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: {
      categorias: [
        "cod_recaudado",
        "flete",
        "flete_devolucion",
        "comision_cod",
        "iva_flete",
        "iva_flete_devolucion",
        "iva_comision_cod",
        "pago_tienda",
        "ajuste_credito",
        "ajuste_debito",
      ],
    },
  },
  {
    id: "cuenta_por_pagar_mensajero",
    etiqueta: "Cuenta por pagar a mensajeros",
    descripcion:
      "Saldo derivado del libro de pago al mensajero (SUM devengo - SUM pago); se lee del ledger, no de ordenes, y las gestiones anuladas no generan movimiento que contar. No declara el grano mensajero: el cubo sin_asignar (D5) es del mundo de la orden, no del ledger.",
    dominio: "financiera",
    clase: "live",
    unidad: "moneda",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha"],
    fuente: { tipo: "ledger", tablas: ["pago_mensajero_movimiento"] },
    alcance: ALCANCE_FINANCIERA,
    definicion: {
      categorias: ["pago_devengado", "pago_efectivo", "liquidacion", "ajuste_devengo", "ajuste_pago"],
    },
  },
  {
    id: "conciliacion_cierres",
    etiqueta: "Conciliacion de cierres",
    descripcion:
      "Cierres de dia y de bodega por estado (solicitado, aprobado, rechazado, vencido) con sus totales snapshot; se lee de los cierres, no de ordenes, y las gestiones anuladas no alteran un total ya congelado.",
    dominio: "financiera",
    clase: "live",
    unidad: "conteo",
    unidadDeConteo: "moneda",
    estadoProduccion: "producida",
    granos: ["fecha"],
    // ⟨D10⟩ humano, 2026-08-02 (`progress/decision_C2_127.md`): los TRES ledgers se declaran
    // aqui ademas de los dos cierres, porque R23 de la 127 concilia el snapshot aprobado
    // CONTRA el dinero realmente movido (`origen_tipo = cierre_dia`).
    fuente: {
      tipo: "snapshot_cierre",
      tablas: [
        "cierre_dia",
        "cierre_bodega",
        "wallet_movimiento",
        "wallet_tienda_movimiento",
        "pago_mensajero_movimiento",
      ],
    },
    alcance: ALCANCE_FINANCIERA,
    // `definicion` sin `categorias` A PROPOSITO: los cuatro estados de cierre viven en el
    // enum `CierreEstado`, que NO esta en la lista cerrada de vocabularios que R9 permite
    // citar (GestionResultado, GestionCausaDevolucion, GestionCausaIncidente,
    // MetodoPagoValue y las tres categorias de wallet). Meterlos aqui obligaria a aflojar
    // el guard de R9; van en la `descripcion`, que es texto y no vocabulario citado.
    definicion: {},
  },
] as const satisfies readonly Metrica[];

/* -------------------------------------------------------------------------- */
/* Tipos derivados y lookup                                                    */
/* -------------------------------------------------------------------------- */

/** Los 23 ids como union literal: autocompletado y error en compilacion (R4). */
export type MetricaId = (typeof CATALOGO)[number]["id"];

/** Una fila del catalogo, con sus `razon` estrechadas a ids reales. */
export type MetricaCatalogo = Metrica<MetricaId>;

/**
 * La anotacion de tipo NO es decorativa: obliga a que todo id citado en un `razon`
 * (numerador y denominador) sea un `MetricaId` REAL del catalogo. Si alguien escribe
 * `denominador: ["ordenes"]`, esta linea deja de compilar.
 */
export const METRICAS: readonly MetricaCatalogo[] = CATALOGO;

const POR_ID: ReadonlyMap<string, MetricaCatalogo> = new Map(METRICAS.map((m) => [m.id, m]));

/** Busqueda TOTAL por id: devuelve la metrica o `undefined`. No lanza, sin `any` (R4). */
export function getMetrica(id: string): MetricaCatalogo | undefined {
  return POR_ID.get(id);
}

/**
 * Filtro de PRESENTACION, no de autorizacion (R24): `rol` devuelve las metricas cuyo
 * alcance para ese rol no es `prohibido` — el recorte de FILAS lo hace la 122 y el
 * gating de la ruta la 129.
 */
export function listarMetricas(filtro?: {
  dominio?: MetricaDominio;
  rol?: RolAnalitica;
  estadoProduccion?: EstadoProduccion;
}): readonly MetricaCatalogo[] {
  if (!filtro) return METRICAS;
  return METRICAS.filter((m) => {
    if (filtro.dominio && m.dominio !== filtro.dominio) return false;
    if (filtro.estadoProduccion && m.estadoProduccion !== filtro.estadoProduccion) return false;
    if (filtro.rol && m.alcance[filtro.rol] === "prohibido") return false;
    return true;
  });
}

/**
 * D10/R36 — dos metricas se pueden sumar entre si SOLO si cuentan lo mismo.
 * `sonSumables("entregas", "ordenes_creadas") === false`: gestiones y ordenes no se
 * suman (una orden reprogramada y luego entregada aporta dos gestiones).
 */
export function sonSumables(a: MetricaId, b: MetricaId): boolean {
  const ma = getMetrica(a);
  const mb = getMetrica(b);
  if (!ma || !mb) return false;
  return ma.unidadDeConteo === mb.unidadDeConteo;
}

/* -------------------------------------------------------------------------- */
/* Etiquetas de cache por dominio (R12, consumidas por la 128)                 */
/* -------------------------------------------------------------------------- */

/** Cadenas ESTABLES: la 128 invalida con estas, nadie las escribe a mano dos veces. */
export const ANALITICA_TAGS = {
  operativa: "analitica:operativa",
  financiera: "analitica:financiera",
} as const satisfies Readonly<Record<MetricaDominio, string>>;

export function tagDeDominio(dominio: MetricaDominio): string {
  return ANALITICA_TAGS[dominio];
}
