// Feature 179 (T4.1, design §6) — EL REGISTRO DECLARADO DE ESCRITORES DE LEDGER (R17/R18).
//
// Modulo de DATOS, puro: sin Next, sin Prisma, sin `process.env` y sin efectos al importarse.
//
// ─── QUE ES ESTO Y POR QUE NO ES UNA LISTA EN PROSA ─────────────────────────────────────────
// La ficha de esta feature traia CINCO escritores. El arbol tiene OCHO puntos de escritura
// (`requirements.md §0.a`, medido). **La lista ya estaba desactualizada antes de que nadie
// escribiera codigo** — y no por descuido: una lista de rutas en prosa no la actualiza nadie
// cuando aparece un servicio nuevo. Lo que le faltaba era, entre otros,
// `WalletService.registrarMovimientoManual`: un ingreso o egreso de caja que un maestro mete a
// mano y que entra en `egresos`, `dinero_en_caja` y `ganancia_ordenex`. Servirlo rancio en
// silencio es, palabra por palabra, el modo de fallo que D2 de la 128 rechazo.
//
// Por eso el mecanismo de vigilancia es un **CENSO DEL ARBOL** y no una lista:
// `tests/unit/analytics/ledger-escritores.guardia.test.ts` compara, en cada corrida,
//
//   eje 1 — escritura CRUDA de las tres tablas ⊆ {los tres repositorios de ledger}
//   eje 2 — archivos que llaman a `.crearMovimientos(` == las claves de este registro,
//           **en las dos direcciones**, y cada entrada nombra un test que EXISTE (R18)
//
// Un servicio nuevo que mueva dinero aparece en el eje 2 el dia que se escribe y pone el guardia
// rojo con un mensaje que dice que hacer. No hace falta que nadie se acuerde de esta feature.
// Un escritor retirado tambien lo pone rojo, por el lado contrario, para que el registro no
// acumule entradas muertas.
//
// ESTADO (T4.1, cerrada en la tanda T3-T5): las OCHO entradas tienen su invalidador en el arbol
// y su test escrito, y `ledger-escritores.guardia.test.ts` cuadra las dos direcciones en cada
// corrida. Este archivo dejo de ser una declaracion y paso a ser la mitad declarada de una
// prueba: R18 exige ademas que cada entrada nombre un test que EXISTE y que declara en el
// nombre de alguno de sus casos el requisito que cubre. Sin R18, R17 se satisface escribiendo
// una linea en este array.

import type { OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";

/**
 * COMO invalida un escritor. Dominio cerrado, porque las tres formas tienen consecuencias
 * distintas y confundirlas es el fallo que esta feature persigue.
 */
export type Invalidador =
  /** Llama a `invalidarAnaliticaFinanciera` tras confirmar su transaccion (R8). */
  | { readonly clase: "directo"; readonly origen: OrigenInvalidacion }
  /**
   * ENCOLA un job de invalidacion. Reservado a quien escribe FUERA de un request de Next, donde
   * `revalidateTag` lanza (`revalidate.js:104-107`): hoy, solo el backfill de tesoreria (D2).
   */
  | { readonly clase: "por_job"; readonly origen: OrigenInvalidacion }
  /**
   * No invalida por su cuenta porque NO es un escritor autonomo: solo lo instancian los
   * llamadores que se nombran, y son ellos quienes invalidan tras confirmar. Se registra igual
   * —aparece en el eje 2 del censo— para que «no invalida» sea una decision escrita y no un
   * hueco.
   */
  | { readonly clase: "por_su_llamador"; readonly llamadores: readonly string[] };

export interface EscritorDeLedger {
  /** El archivo que llama a `crearMovimientos`. Es la clave del cuadre del eje 2. */
  readonly archivo: string;
  /** Donde se engancha la invalidacion, que puede NO ser el propio archivo (ver `motivo`). */
  readonly invalidaEn: readonly string[];
  readonly invalidadores: readonly Invalidador[];
  /** Los tests de cinco pasos que lo cubren. R18: cada uno DEBE existir. */
  readonly tests: readonly string[];
  /** Requisitos que cubre, para que el mapa `R<n> → test` no se reconstruya de memoria. */
  readonly requisitos: readonly string[];
  /** Por que se engancha ahi y no en otro sitio. */
  readonly motivo: string;
}

const INVALIDACION = "lib/analytics/invalidacion-financiera.ts";

/**
 * LOS OCHO PUNTOS DE ESCRITURA DE LOS TRES LEDGERS, censados en el arbol de `C:/w179`.
 *
 * Las claves son las rutas de los archivos que llaman a `crearMovimientos`. Los tres ledgers
 * —`wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`— se escriben
 * EXCLUSIVAMENTE por esos tres repositorios (eje 1), lo que hace que este censo sea posible y
 * barato: hay una sola frontera que vigilar y es estrecha.
 */
export const ESCRITORES_DE_LEDGER: readonly EscritorDeLedger[] = [
  {
    archivo: "lib/services/WalletEgresoService.ts",
    invalidaEn: ["lib/services/WalletEgresoService.ts", INVALIDACION],
    invalidadores: [{ clase: "directo", origen: "ledger_egreso_admin" }],
    tests: ["tests/unit/analytics/cache-financiera-escritor-egreso.test.ts"],
    requisitos: ["R9"],
    motivo:
      "es quien posee el cliente de escritura; cada llamada es su propia transaccion implicita. " +
      "Cubre `registrarEgreso` Y `reversarEgreso`: el reverso mueve dinero igual.",
  },
  {
    archivo: "lib/services/WalletService.ts",
    invalidaEn: ["lib/services/WalletService.ts", INVALIDACION],
    invalidadores: [{ clase: "directo", origen: "ledger_movimiento_manual" }],
    tests: ["tests/unit/analytics/cache-financiera-escritor-manual.test.ts"],
    requisitos: ["R10"],
    motivo:
      "`registrarMovimientoManual` NO estaba en la lista de la ficha (§0.a) y entra en `egresos`, " +
      "`dinero_en_caja` y `ganancia_ordenex`. Es el hallazgo que justifica que esto sea un censo.",
  },
  {
    archivo: "lib/services/LiquidacionService.ts",
    invalidaEn: ["lib/services/LiquidacionService.ts", INVALIDACION],
    invalidadores: [{ clase: "directo", origen: "ledger_liquidacion" }],
    tests: [
      "tests/unit/analytics/cache-financiera-escritor-liquidacion.test.ts",
      "tests/unit/analytics/cache-financiera-invalidacion-orden.test.ts",
    ],
    requisitos: ["R11", "R8"],
    motivo:
      "sus escrituras viven DENTRO de `tx` (`:225`, `:322`, `:549`, `:565`): la invalidacion va " +
      "tras cada `$transaction` que resuelve, nunca dentro (R8). Cubre los tres ledgers y, con " +
      "ellos, el egreso de caja que emite `CajaPagoTiendaFeedService` en la misma operacion.",
  },
  {
    archivo: "lib/services/GeneracionGastosFijosService.ts",
    invalidaEn: ["lib/services/GeneracionGastosFijosService.ts", INVALIDACION],
    invalidadores: [{ clase: "directo", origen: "ledger_gastos_fijos" }],
    tests: ["tests/unit/analytics/cache-financiera-escritor-gastos-fijos.test.ts"],
    requisitos: ["R12"],
    motivo:
      "el cron de gastos fijos es un ROUTE HANDLER (`app/api/cron/generar-gastos-fijos/route.ts`), " +
      "o sea dentro de un request: `revalidateTag` funciona ahi. Solo invalida si " +
      "`egresosGenerados > 0`: vaciar la cache cada madrugada sin haber movido dinero es coste " +
      "sin motivo.",
  },
  {
    archivo: "lib/repositories/IncidenteAdminRepository.ts",
    invalidaEn: ["lib/services/IncidenteAdminService.ts", INVALIDACION],
    invalidadores: [{ clase: "directo", origen: "ledger_indemnizacion" }],
    tests: ["tests/unit/analytics/cache-financiera-escritor-indemnizacion.test.ts"],
    requisitos: ["R13"],
    motivo:
      "la escritura esta en el REPOSITORIO (`:327`), dentro de su `$transaction`. Se engancha en " +
      "el SERVICIO por dos razones a la vez: un repositorio no debe conocer la cache, y invalidar " +
      "ahi seria ANTES del commit (R8). Un rechazo o un `no_aplicado` no invalidan.",
  },
  {
    archivo: "lib/repositories/CierresAdminRepository.ts",
    invalidaEn: [
      "lib/services/CierresAdminService.ts",
      "lib/services/CierresBodegaAdminService.ts",
      INVALIDACION,
    ],
    invalidadores: [
      { clase: "directo", origen: "ledger_cierre_dia" },
      { clase: "directo", origen: "ledger_cierre_bodega" },
    ],
    tests: [
      "tests/unit/analytics/cache-financiera-escritor-cierre-dia.test.ts",
      "tests/unit/analytics/cache-financiera-escritor-cierre-bodega.test.ts",
    ],
    requisitos: ["R14", "R15"],
    motivo:
      "un solo archivo de repositorio (`:665-725`, las seis escrituras) al que entran DOS servicios " +
      "distintos: `aprobarCierre` (`CierresAdminService`) y `aprobarCierreBodega` " +
      "(`CierresBodegaAdminService`). Por eso son dos requisitos, dos origenes y dos tests: un " +
      "solo test cubriria uno y dejaria el otro suelto.",
  },
  {
    archivo: "lib/services/CajaPagoTiendaFeedService.ts",
    invalidaEn: ["lib/services/LiquidacionService.ts", "scripts/backfill-caja-tesoreria.ts"],
    invalidadores: [
      {
        clase: "por_su_llamador",
        llamadores: [
          "lib/services/LiquidacionService.ts",
          "lib/services/CajaBackfillTesoreriaService.ts",
        ],
      },
    ],
    tests: [
      "tests/unit/analytics/cache-financiera-escritor-liquidacion.test.ts",
      "tests/unit/scripts/backfill-caja-tesoreria-invalidacion.test.ts",
    ],
    requisitos: ["R11", "R26"],
    motivo:
      "NO es un escritor autonomo: emite el egreso de caja del pago a tienda dentro de la " +
      "transaccion de quien lo instancia, y solo lo instancian esos dos. Se registra igual para " +
      "que «no invalida por su cuenta» sea una decision escrita y no un hueco del censo.",
  },
  {
    archivo: "lib/services/CajaBackfillTesoreriaService.ts",
    invalidaEn: ["scripts/backfill-caja-tesoreria.ts", "lib/services/jobs/analitica-invalidacion-cache-handler.ts"],
    invalidadores: [{ clase: "por_job", origen: "job_backfill_tesoreria" }],
    tests: [
      "tests/unit/scripts/backfill-caja-tesoreria-invalidacion.test.ts",
      "tests/unit/analytics/cache-financiera-invalidacion-backfill.test.ts",
    ],
    requisitos: ["R26", "R27"],
    motivo:
      "EL OCTAVO, y el unico que escribe FUERA de un request de Next: `scripts/backfill-caja-" +
      "tesoreria.ts` es un proceso `tsx` y `revalidateTag` LANZA ahi (`revalidate.js:104-107`). " +
      "El script ENCOLA el job `analitica_invalidacion_cache` con `{ dominio: \"financiera\" }` " +
      "(D2, sin migracion: el valor de enum ya existe desde la 128) y el drenador invalida dentro " +
      "de un request, con reintentos y backoff. El servicio no conoce jobs: encola el script.",
  },
];

/** Las rutas de los ocho archivos escritores. Es el lado «declarado» del cuadre del eje 2. */
export const ARCHIVOS_ESCRITORES: readonly string[] = ESCRITORES_DE_LEDGER.map((e) => e.archivo);

/**
 * Los TRES repositorios que son la unica puerta de escritura de los tres ledgers (eje 1).
 *
 * No hay ni un `walletMovimiento.create*` fuera de ellos en `lib/`, `app/` ni `scripts/`, y eso
 * es exactamente lo que hace posible el censo del eje 2: si alguien pudiera escribir la tabla
 * por su cuenta, la lista de llamadores de `crearMovimientos` dejaria de ser la lista de quien
 * mueve dinero.
 */
export const REPOSITORIOS_DE_LEDGER: readonly string[] = [
  "lib/repositories/WalletMovimientoRepository.ts",
  "lib/repositories/WalletTiendaMovimientoRepository.ts",
  "lib/repositories/PagoMensajeroMovimientoRepository.ts",
];
