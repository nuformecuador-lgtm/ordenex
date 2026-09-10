import { describe } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  prepararConteoEntregas,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import { CohorteCargaRepository } from "@/lib/repositories/CohorteCargaRepository";
import type { CohorteCuboCrudo } from "@/lib/interfaces/repositories/ICohorteCargaRepository";

import { HAY_BASE_DE_DATOS } from "./_postgres-real";
import type { TxDeTest } from "./_semilla-rollup";

/**
 * Ficha 411 — utilidades COMPARTIDAS de los siete archivos de integracion de la cohorte.
 *
 * NO es un archivo de test (no acaba en `.test.ts`): vitest no lo recoge.
 *
 * ─── TRES DECISIONES QUE SOSTIENEN TODO LO DEMAS ────────────────────────────────────────
 *
 * 1. **Las coordenadas y las ordenes se siembran** con `_semilla-rollup.ts` (`sembrarBase`,
 *    `crearOrden`, `agregarTransicion`), dentro de una transaccion que SIEMPRE se revierte. La
 *    base de desarrollo la comparten varias sesiones: si un test dejara una fila, rompe a otro.
 *
 * 2. **Todo vive en el ano 2001**, donde la base real no tiene nada. La cohorte SI esta acotada
 *    por fecha —el rango es obligatorio— asi que el aislamiento por fecha ya basta; el alcance
 *    por tienda de `ACTOR_TIENDA` es el segundo cinturon, para los casos que se leen con un
 *    recorte concreto.
 *
 * 3. **Se ejercita el REPOSITORIO REAL sobre la transaccion**, no una copia del SQL escrita en
 *    el test. Un test que reescribiera la consulta demostraria que un SQL inventado funciona, no
 *    que funcione el que corre en produccion — que es el que puede cambiar sin avisar.
 */

export const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** El dia D de casi todos los casos, y sus vecinos. Ano 2001: la base real no tiene nada ahi. */
export const D_MENOS_1 = "2001-06-14";
export const D = "2001-06-15";
export const D_MAS_1 = "2001-06-16";
export const D_MAS_2 = "2001-06-17";

/** Reloj congelado. Ningun caso depende de «ahora»: el rango siempre es personalizado. */
export const AHORA = new Date("2001-07-01T12:00:00.000Z");

/**
 * Prepara la consulta por la puerta REAL (`prepararConteoEntregas`), nunca forjando el tipo
 * opaco: forjarlo se saltaria el resolutor de alcance, que es justo lo que varios de estos
 * casos vienen a medir.
 */
export function consultaDe(
  raw: object,
  actor: { usuarioId: string; rol: string; zonaId?: string },
): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, actor as never, AHORA);
  if (preparada.status !== "ok") {
    throw new Error(`consulta de prueba no concedida: ${JSON.stringify(preparada)}`);
  }
  return preparada.consulta;
}

/** Un rango personalizado inclusivo en las dos puntas, tal y como lo manda la barra. */
export function rangoDe(desde: string, hasta: string): { rango: "personalizado"; desde: string; hasta: string } {
  return { rango: "personalizado", desde, hasta };
}

/** El repositorio REAL, apuntado a la transaccion del test. */
export function repositorioSobre(tx: TxDeTest): CohorteCargaRepository {
  return new CohorteCargaRepository(tx as unknown as PrismaClient);
}

/** Atajo: lee las cohortes con el repositorio real sobre la transaccion del test. */
export async function leerCohortes(
  tx: TxDeTest,
  consulta: ConsultaConteoEntregas,
): Promise<readonly CohorteCuboCrudo[]> {
  return repositorioSobre(tx).contarCohortes(consulta);
}

/** Las celdas de un dia concreto, indexadas por desenlace. */
export function cubosDelDia(
  filas: readonly CohorteCuboCrudo[],
  fecha: string,
): Map<string, CohorteCuboCrudo> {
  return new Map(filas.filter((f) => f.fecha === fecha).map((f) => [f.desenlace, f]));
}

/** Cuantas ordenes tiene una cohorte en total (la suma de sus cubos). */
export function cargadasDe(filas: readonly CohorteCuboCrudo[], fecha: string): number {
  return filas.filter((f) => f.fecha === fecha).reduce((suma, f) => suma + f.n, 0);
}
