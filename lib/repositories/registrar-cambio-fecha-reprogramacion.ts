import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// FICHA 371 — EL CHOKE POINT DEL RASTRO de las correcciones de la fecha de una reprogramacion.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────────┐
// │ LA REGLA, y este archivo existe para que tenga UN SITIO donde estar escrita:               │
// │                                                                                            │
// │   Toda escritura de `gestion_orden.fecha_reprogramacion` que NO sea el registro original    │
// │   de la gestion DEBE invocar esta funcion en su MISMA transaccion, y SOLO con las           │
// │   gestiones que efectivamente cambiaron.                                                    │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// Es el molde EXACTO de `registrar-cambio-dia-reparto.ts` (feature 262), sobre la otra columna:
// alli el dia en que el paquete SALE, aqui el dia en que la orden VUELVE a circular.
//
// «¿Y por que una funcion y no un `create` suelto en el repositorio?» Porque un `create` suelto no
// tiene donde llevar la regla de arriba, y la regla es lo unico que impide que la segunda escritura
// —la que llegue dentro de seis meses— se olvide del rastro sin que nada se ponga rojo. Mismo
// motivo por el que existen `appendCambioEstado` y `appendAccion`.
//
// ⚠️ ESTE ES EL UNICO SITIO DEL ARBOL QUE INSERTA EN `gestion_fecha_reprogramacion_cambio`. Si
// aparece un segundo, es un bug: el rastro dejaria de tener un punto por el que pasar. Lo vigila
// `tests/unit/guards/correccion-fecha-reprogramacion.guardia.test.ts`.

/**
 * Cliente de transaccion aceptado: cualquier cosa que exponga la tabla del rastro. Lo satisfacen
 * tanto el `PrismaClient` completo como el `tx` de un `$transaction` (patron
 * `CambioDiaRepartoTxClient`).
 *
 * RECIBE la `tx`, no un cliente Prisma, y eso es lo que hace ESTRUCTURAL —no disciplinada— la
 * atomicidad: desde aqui no se puede abrir otra transaccion ni escribir fuera de la que se recibio.
 */
export type CambioFechaReprogramacionTxClient = Pick<
  PrismaClient,
  "gestionFechaReprogramacionCambio"
>;

/** Una correccion a registrar. Las dos fechas ya vienen resueltas por quien escribio la fila. */
export interface CambioFechaReprogramacionEntrada {
  /** La gestion corregida: la `reprogramada` VIGENTE de la orden, la misma que el cron mira. */
  gestionId: string;
  ordenId: string;
  /**
   * La fecha que la fila TENIA en el instante de la escritura, leida bajo `FOR UPDATE`. Si se
   * fotografiara DESPUES del `UPDATE`, este rastro diria que se corrigio de X a X y nadie se
   * enteraria: un rastro que miente es peor que no tenerlo.
   */
  fechaAnterior: Date;
  fechaNueva: Date;
  /** NOT NULL: aqui nunca escribe un cron. Quien corrigio es la evidencia. */
  actorUsuarioId: string;
  /** Obligatorio, ya recortado en el borde con `motivoSchema` (el mismo de reprogramar). */
  motivo: string;
}

/** Lo que el llamante necesita de vuelta: el id de la fila escrita. */
export interface CambioFechaReprogramacionRegistrado {
  gestionId: string;
  cambioId: string;
}

/**
 * Inserta UNA fila por correccion efectiva, dentro del `tx` en curso.
 *
 * LOS `id` SE GENERAN AQUI con `randomUUID()` en vez de dejarlos al `@default(uuid())` de Prisma,
 * por el mismo motivo que en el molde de la 262: `createMany` sobre Postgres NO devuelve los ids
 * generados, y devolverlos permite seguir haciendo UNA sola sentencia.
 *
 * NO-OP con lista vacia: sin correcciones no hay rastro que escribir, y una lista vacia no es un
 * error (el llamante ya aborto por otra via si algo fallo).
 *
 * SOLO INSERTA. No actualiza, no borra y no lee: la tabla es append-only y esta funcion es la unica
 * escritura que existe sobre ella. El CHECK `fecha_nueva <> fecha_anterior` vive en la base: una
 * «correccion» que no corrige nada no es escribible ni por error.
 */
export async function registrarCambioFechaReprogramacion(
  tx: CambioFechaReprogramacionTxClient,
  entradas: readonly CambioFechaReprogramacionEntrada[],
): Promise<CambioFechaReprogramacionRegistrado[]> {
  if (entradas.length === 0) return [];

  const filas = entradas.map((e) => ({
    id: randomUUID(),
    gestionId: e.gestionId,
    ordenId: e.ordenId,
    fechaAnterior: e.fechaAnterior,
    fechaNueva: e.fechaNueva,
    actorUsuarioId: e.actorUsuarioId,
    motivo: e.motivo,
  }));

  await tx.gestionFechaReprogramacionCambio.createMany({ data: filas });

  return filas.map((f) => ({ gestionId: f.gestionId, cambioId: f.id }));
}
