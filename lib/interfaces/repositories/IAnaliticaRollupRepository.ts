import type { GestionCausaDevolucion } from "@prisma/client";
import type { VentanaDia } from "@/lib/analytics/rollup-dia";

// Feature 124 (design §2/§4) — contrato del repositorio de agregacion del rollup diario.
// Las SEIS consultas (Q1-Q6) + la escritura transaccional de UNA fecha. Nada de logica de
// negocio: quien funde los cubos, quien valida los invariantes y quien decide abortar es
// `AnaliticaRollupService`, que NO habla Prisma (design §2).
//
// LAS COTAS VIENEN YA RESUELTAS en `VentanaDia` (R5/R6): el repositorio no deriva fechas ni
// hace aritmetica de zona horaria. La ventana la construye `lib/analytics/rollup-dia.ts`
// sobre `lib/utils/fecha-cr.ts`, semiabierta `[desde, hasta)`, y `hasta` ES el CORTE del dia
// (cota superior ESTRICTA, design §3).

// `VentanaDia` NO se declara aqui: vive en `lib/analytics/rollup-dia.ts`, junto a
// `ventanaDelDia`, que es su unico constructor. La dependencia va en esa direccion y no en la
// contraria porque `lib/analytics/` es un modulo PURO y su guardia (R1 de la feature 135)
// prohibe que nombre la capa `repositories`, aunque sea en un `import type`. Una interfaz SI
// puede depender de un tipo de dominio puro. El porque completo esta en `rollup-dia.ts`.

/**
 * Coordenadas de una MEDIDA DE ORDEN (R22/R23): zona y tienda de la ORDEN, mensajero de
 * `orden.mensajero_asignado_id` (nullable ⇒ cubo `sin_asignar`, R25) y `estatus_id` = estado
 * AL CORTE derivado del historial (R24), nunca `orden.estatus_id`.
 */
export interface CoordenadasDeOrden {
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string | null;
  readonly estatusId: string;
}

/** Q1 — `ordenes_creadas` (flujo): ordenes NACIDAS en la ventana, no borradas (R10/D7). */
export interface GrupoOrdenesCreadas extends CoordenadasDeOrden {
  readonly ordenesCreadas: number;
}

/** Q2 — `ordenes_estado_stock`: stock al corte sobre el universo B2 (R11/R12, D2). */
export interface GrupoEstadoStock extends CoordenadasDeOrden {
  readonly ordenesEstadoStock: number;
}

/**
 * Q3 — las CINCO medidas de gestion (R13). `mensajeroId` es `string` y no `string | null`
 * a proposito: `gestion_orden.mensajero_id` es NOT NULL, asi que el cubo `sin_asignar` NO
 * puede aparecer por esta via (design §4.4). `causaDevolucion` solo se informa en las filas
 * que cuentan `devuelta` (R15).
 */
export interface GrupoGestiones {
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string;
  readonly estatusId: string;
  readonly causaDevolucion: GestionCausaDevolucion | null;
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
}

/**
 * Q4 — una fila POR GESTION vigente de resultado `entregada` del dia, con las MISMAS
 * coordenadas que su fila de `entregas` en Q3 (R17). El criterio de "primer intento" NO se
 * resuelve aqui: el servicio pasa estos `ordenId` por `contarIntentosEnLote` (feature 160),
 * que es el punto unico del repo (design §4.5, alternativa 11 descartada).
 */
export interface EntregaVigente {
  readonly ordenId: string;
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string;
  readonly estatusId: string;
}

/** Q5 — tiempo de ciclo: numerador y denominador, jamas el promedio (R19/R21). */
export interface GrupoCiclo extends CoordenadasDeOrden {
  readonly segCicloAcum: bigint;
  readonly segCicloN: number;
}

/**
 * Q6 — los SIETE escalares del dia (design §4.7). Son el material de la reconciliacion de
 * R34 y se calculan por un camino DISTINTO al de Q1-Q5 (no es "la misma consulta sin
 * `GROUP BY`"). Las tres medidas restantes del grano no entran: `primer_intento_ok` se
 * deriva en el servicio a partir de Q4 y el par de ciclo no tiene escalar independiente
 * barato — su contencion es el CHECK `analytics_daily_ciclo_coherente` (declarado).
 */
export interface MedidasReconciliables {
  readonly ordenesCreadas: number;
  readonly ordenesEstadoStock: number;
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
}

/** Las siete claves de `MedidasReconciliables`, para recorrerlas sin repetir la lista. */
export const MEDIDAS_RECONCILIABLES = [
  "ordenesCreadas",
  "ordenesEstadoStock",
  "entregas",
  "devoluciones",
  "rechazos",
  "reprogramaciones",
  "incidentes",
] as const satisfies readonly (keyof MedidasReconciliables)[];

export type MedidaReconciliable = (typeof MEDIDAS_RECONCILIABLES)[number];

/** Una fila del rollup: las 6 coordenadas del grano (menos `fecha`) + las 10 medidas. */
export interface FilaRollup {
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroId: string | null;
  readonly estatusId: string;
  readonly causaDevolucion: GestionCausaDevolucion | null;
  readonly ordenesCreadas: number;
  readonly ordenesEstadoStock: number;
  readonly entregas: number;
  readonly devoluciones: number;
  readonly rechazos: number;
  readonly reprogramaciones: number;
  readonly incidentes: number;
  readonly primerIntentoOk: number;
  readonly segCicloAcum: bigint;
  readonly segCicloN: number;
}

/**
 * Escritura de UNA fecha, TODO-O-NADA en UNA sola transaccion y SIN LOTES (R30, D9).
 *
 * `verificarReconciliacion` se invoca DENTRO de la transaccion, despues del upsert y de la
 * retirada de rancias, con la suma REAL de las medidas de esa fecha leida de la tabla. Debe
 * LANZAR para abortar (R34/D5): asi la decision (que medida no cuadra y con que mensaje)
 * vive en el servicio, que es puro y testeable, mientras la transaccion vive en el
 * repositorio, que es el unico que habla Prisma.
 */
export interface EscrituraFecha {
  /** Fecha calendario CR `YYYY-MM-DD`. Se materializa como `@db.Date` (design §3). */
  readonly fecha: string;
  readonly filas: readonly FilaRollup[];
  readonly verificarReconciliacion: (sumasEscritas: MedidasReconciliables) => void;
}

export interface ResultadoEscritura {
  readonly filasEscritas: number;
  readonly filasRetiradas: number;
}

export interface IAnaliticaRollupRepository {
  /** Q1 (R10). */
  contarOrdenesCreadas(ventana: VentanaDia): Promise<GrupoOrdenesCreadas[]>;
  /** Q2 (R11/R12, universo B2 de D2). */
  contarOrdenesEnEstadoAlCorte(ventana: VentanaDia): Promise<GrupoEstadoStock[]>;
  /** Q3 (R13/R14/R15/R16). */
  contarGestionesVigentes(ventana: VentanaDia): Promise<GrupoGestiones[]>;
  /** Q4 (R17): las entregas vigentes del dia, sin resolver todavia el primer intento. */
  listarEntregasVigentes(ventana: VentanaDia): Promise<EntregaVigente[]>;
  /** Q5 (R19/R20). */
  acumularCiclosCerrados(ventana: VentanaDia): Promise<GrupoCiclo[]>;
  /** Q6 (R34): los siete escalares independientes de la fecha. */
  totalesDeControl(ventana: VentanaDia): Promise<MedidasReconciliables>;
  /** Upsert + retirada de rancias + reconciliacion, en UNA transaccion (R27-R31/R34). */
  escribirFecha(escritura: EscrituraFecha): Promise<ResultadoEscritura>;
}
