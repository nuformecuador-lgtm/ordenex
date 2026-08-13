// Feature 135 (T1.1) — contrato de tipos de la analitica: dominios cerrados,
// forma de una metrica y forma de un rango. Es el archivo fundacional del lote
// (122-134): nadie declara por su cuenta un KPI, una dimension ni una ventana.
//
// R1 (modulo puro): este archivo NO importa NADA de runtime. Solo `import type`.
// Sin `'use server'`, sin `next/headers`, sin `@/lib/db`, sin `@prisma/client` en
// import de valor, sin efectos al importarse. Se puede importar sin base de datos,
// sin red, sin cookies y sin variables de entorno.
//
// `RolAnalitica` se declara como union literal propia (y no como
// `Exclude<RolValue, "apiKey">`) precisamente para no arrastrar `@prisma/client`:
// la consistencia con el esquema la vigila `tests/unit/analytics/types.test.ts`,
// que lee `db/schema.prisma` y rompe si alguien renombra un rol.
//
// Sin datos: el catalogo vive en `metrics.ts` (fuente unica, R2), la resolucion de
// rangos en `ranges.ts` y el esquema zod de filtros en `filters.ts`.

import type { OrderStatusValue } from "@/lib/types/order-status";

/* -------------------------------------------------------------------------- */
/* 1. Dominios cerrados (design.md §3.1)                                       */
/* -------------------------------------------------------------------------- */

/** Familia de la metrica. El dinero (`financiera`) tiene fronteras propias: R6 y R32. */
export type MetricaDominio = "operativa" | "financiera";

/** `snapshot` <=> la fuente es el rollup `analytics_daily`; `live` = intradia (R5). */
export type MetricaClase = "live" | "snapshot";

/**
 * Unidad de PRESENTACION (la consumen la 130 para la grafica y la 134 para el CSV).
 * La moneda concreta NO se hardcodea aqui: se resuelve por `lib/config/moneda.ts`.
 */
export type MetricaUnidad = "conteo" | "porcentaje" | "moneda" | "segundos";

/** Granos legales de agregacion (R10). Toda metrica DEBE incluir `fecha`. */
export const DIMENSIONES = [
  "fecha",
  "zona",
  "tienda",
  "mensajero",
  "estatus",
  "metodo_pago",
  "causa_devolucion",
] as const;

export type DimensionAnalitica = (typeof DIMENSIONES)[number];

/**
 * Los CINCO roles lectores de analitica (R7). Subconjunto explicito de `RolValue`
 * (`db/schema.prisma`) que deja fuera `apiKey`: esa cuenta es un integrador sin
 * sesion de UI, no un lector de tableros.
 */
export const ROLES_ANALITICA = [
  "maestro",
  "admin",
  "adminSatelite",
  "adminTienda",
  "mensajero",
] as const;

export type RolAnalitica = (typeof ROLES_ANALITICA)[number];

/**
 * Que puede ver un rol de una metrica:
 * - `total`: todas las filas (los dos roles de `esAccesoTotal`: maestro y admin).
 * - `acotado`: la ve, pero recortada por el WHERE que resuelve la 122.
 * - `prohibido`: no se le ofrece ni recortada (todas las financieras salvo D7).
 */
export type AlcanceMetrica = "total" | "acotado" | "prohibido";

/** D10 / R36 — que se cuenta. Dos metricas de unidad distinta NO son sumables. */
export type UnidadDeConteo = "gestion" | "orden" | "moneda" | "tiempo";

/** D8 / R33 — una metrica puede estar declarada sin productor todavia (patron 154). */
export type EstadoProduccion = "producida" | "declarada";

/**
 * D5 / R30 — cubo explicito de las ordenes con `mensajero_asignado_id IS NULL`.
 * Constante UNICA: ninguna feature consumidora escribe este literal a mano.
 */
export const MENSAJERO_SIN_ASIGNAR = "sin_asignar" as const;

export type MensajeroSinAsignar = typeof MENSAJERO_SIN_ASIGNAR;

/* -------------------------------------------------------------------------- */
/* 2. Fuentes declaradas (design.md §1 y §3.2)                                 */
/* -------------------------------------------------------------------------- */

/** Rollup diario; lo crea la feature 123. */
export type TablaRollup = "analytics_daily";

/** Tablas vivas (solo metricas OPERATIVAS pueden citarlas, R6). */
export type TablaViva = "orden" | "gestion_orden" | "orden_historial_estado";

/** Ledgers append-only del dinero. */
export type TablaLedger = "wallet_movimiento" | "wallet_tienda_movimiento" | "pago_mensajero_movimiento";

/** Snapshots de cierre. */
export type TablaCierre = "cierre_dia" | "cierre_bodega";

/**
 * Universo legal de una metrica financiera (R6): ledgers + snapshots de cierre, y
 * NUNCA `orden`/`gestion_orden`/`orden_historial_estado`/`analytics_daily`.
 * Se declara como un solo conjunto porque el catalogo v1 tiene metricas que cruzan
 * las dos familias dentro de una misma fuente (design.md §3.3, `cod_recaudado`:
 * `cierre_dia` + `wallet_tienda_movimiento`); el `tipo` sigue diciendo cual manda.
 */
export type TablaDinero = TablaLedger | TablaCierre;

export type TablaAnalitica = TablaRollup | TablaViva | TablaDinero;

export interface FuenteRollup {
  readonly tipo: "rollup";
  readonly tablas: readonly ["analytics_daily"];
}

export interface FuenteViva {
  readonly tipo: "tabla_viva";
  readonly tablas: readonly TablaViva[];
}

export interface FuenteLedger {
  readonly tipo: "ledger";
  readonly tablas: readonly TablaDinero[];
}

export interface FuenteCierre {
  readonly tipo: "snapshot_cierre";
  readonly tablas: readonly TablaDinero[];
}

export type FuenteMetrica = FuenteRollup | FuenteViva | FuenteLedger | FuenteCierre;

/* -------------------------------------------------------------------------- */
/* 3. Forma de una metrica (design.md §3.2 · R3: 12 campos exactos)            */
/* -------------------------------------------------------------------------- */

/**
 * Que determina exactamente a la metrica, en el vocabulario del repo.
 *
 * El parametro `TMetricaId` existe para que `metrics.ts` pueda estrechar
 * `razon` a su union literal `MetricaId` sin que `types.ts` importe de
 * `metrics.ts` (evita el ciclo que §2 del design quiere evitar). Por defecto es
 * `string`, asi que `DefinicionMetrica` se usa sin parametros donde no importe.
 */
export interface DefinicionMetrica<TMetricaId extends string = string> {
  /** `value` de order_status que la determinan; DEBEN existir en ORDER_STATUS_SEED (R8). */
  readonly estados?: readonly OrderStatusValue[];
  /** categorias de enum del esquema (GestionResultado, MetodoPagoValue, wallet_*_categoria...) (R9). */
  readonly categorias?: readonly string[];
  /** criterio derivado ya existente en el repo, si aplica (intentos; 124/R11, 215/R23). */
  readonly criterio?: "intentos_por_cierre_aprobado";
  /** numerador/denominador cuando la unidad es porcentaje. */
  readonly razon?: {
    readonly numerador: TMetricaId;
    /** D10/R35: SUMA de gestiones (lista), nunca "el numero de ordenes". */
    readonly denominador: readonly TMetricaId[];
  };
  /** lo que NO cuenta; obligatorio citar `anulada_at` en las metricas por gestion (D10/R35). */
  readonly excluye?: readonly string[];
  /** D5/R30 — que hace con `mensajero_asignado_id IS NULL` toda metrica con grano `mensajero`. */
  readonly sinAsignar?: "incluir";
  /** D9/R34 — que zona atribuye toda metrica con grano `zona`. Solo hay un valor legal. */
  readonly atribucionZona?: "orden";
  /** 175 — universo temporal de la medida del rollup que la encarna (B2 de la 124: vivas al corte + las que llegaron a terminal ese dia). */
  readonly universo?: "b2_vivas_mas_cierres_del_dia";
  /** 175 — la metrica NO tiene medida propia en analytics_daily: se proyecta de esta otra. */
  readonly derivadaDe?: TMetricaId;
}

/**
 * Una fila del catalogo. R3: estos DOCE campos, ni uno menos ni uno mas — una
 * entrada a la que le falte uno, o que declare uno extra, no compila.
 */
export interface Metrica<TMetricaId extends string = string> {
  /** snake_case, unico, estable (R4). */
  readonly id: string;
  /** texto de UI (130/134). */
  readonly etiqueta: string;
  /** una frase: que cuenta y que NO cuenta. */
  readonly descripcion: string;
  readonly dominio: MetricaDominio;
  /** snapshot <=> fuente rollup (R5). */
  readonly clase: MetricaClase;
  readonly unidad: MetricaUnidad;
  /** D10 / R36: gestion vs orden, EVIDENTE en la propia metrica. */
  readonly unidadDeConteo: UnidadDeConteo;
  /** D8 / R33: puede no tener productor todavia. */
  readonly estadoProduccion: EstadoProduccion;
  /** incluye siempre "fecha" (R10). */
  readonly granos: readonly DimensionAnalitica[];
  readonly fuente: FuenteMetrica;
  /** los CINCO roles, exhaustivo: omitir uno no compila (R7). */
  readonly alcance: Readonly<Record<RolAnalitica, AlcanceMetrica>>;
  readonly definicion: DefinicionMetrica<TMetricaId>;
}

/* -------------------------------------------------------------------------- */
/* 4. Rangos temporales (design.md §4.2)                                       */
/* -------------------------------------------------------------------------- */

/**
 * D4 — los tres presets Y el rango arbitrario. Dominio cerrado de 4 valores.
 * Ojo (design.md §4.3): `semana` tiene borde de CALENDARIO (lunes, D2) y `mes` es
 * una ventana MOVIL de 30 dias (D3). Conviven dos convenciones A PROPOSITO.
 */
export const RANGO_PRESETS = ["dia", "semana", "mes", "personalizado"] as const;

export type RangoPreset = (typeof RANGO_PRESETS)[number];

/** D4 — tope de la ventana arbitraria, en dias calendario CR contando ambos extremos. */
export const RANGO_TOPE_DIAS = 366;

/**
 * Feature 180 ⟨D2⟩ — tope de PUNTOS por serie que el SERVIDOR usa para decidir la
 * granularidad temporal de una serie (`dia` hasta aqui inclusive, `semana` por encima).
 * Se declara junto a `RANGO_TOPE_DIAS` por la misma razon que aquel: un tope se escribe
 * una vez, y `lib/analytics/cubo-temporal.ts` lo importa en vez de repetir el literal.
 *
 * ESTE NUMERO **DEBE** COINCIDIR CON `MAX_PUNTOS_SERIE` DE
 * `components/private/analytics/topes.ts`, y son DOS constantes a proposito, no un
 * descuido: `lib/` **no puede** importar de `components/` porque seria una inversion de
 * capas (un servicio dependiendo de un componente de presentacion), y el guardia de
 * modulo puro de `lib/analytics/` lo prohibe. La igualdad la ata un TEST —
 * `tests/unit/analytics/cubo-temporal-tope.guardia.test.ts` (R20)— que lee las dos
 * fuentes y las compara. Es el mismo patron de dos-fuentes-independientes que la feature
 * 127 usa con `IDS_FINANCIERAS_SERVIDAS` contra el catalogo.
 *
 * Por que 62 y no otro numero: lo justifica el propio comentario de `topes.ts`, «53
 * semanas (el peor caso legitimo ya agregado en un rango de 366 dias) mas margen». Es
 * decir, el 62 se eligio **dando por supuesta la agregacion semanal** de ⟨D2⟩: por encima
 * del tope el servidor no recorta, agrega en cubos semanales, y 366 dias caben siempre en
 * 53 cubos. Si alguien cambia este numero sin cambiar el otro, el test R20 lo dice y el
 * comentario de arriba explica cual de los dos mover.
 */
export const TOPE_PUNTOS_SERIE = 62;

/**
 * Ventana resuelta. Semiabierta en instantes `[desde, hasta)` para las tablas
 * vivas; fechas calendario CR INCLUSIVAS para el rollup (`analytics_daily.fecha`).
 */
export interface RangoResuelto {
  readonly preset: RangoPreset;
  /** instante UTC, INCLUSIVO (...T06:00:00.000Z = 00:00 de Costa Rica). */
  readonly desde: Date;
  /** instante UTC, EXCLUSIVO (...T06:00:00.000Z). */
  readonly hasta: Date;
  /** "YYYY-MM-DD" calendario CR, inclusivo. */
  readonly desdeFecha: string;
  /** "YYYY-MM-DD" calendario CR, INCLUSIVO para el consumidor. */
  readonly hastaFecha: string;
}

/** Entrada de `resolverRango`: un preset, o el par de fechas calendario (D4). */
export type EntradaRango =
  | { readonly preset: "dia" | "semana" | "mes" }
  | { readonly preset: "personalizado"; readonly desde: string; readonly hasta: string };
