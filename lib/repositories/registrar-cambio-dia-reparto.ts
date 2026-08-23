import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// Feature 262 (B4, design §5.3) — EL CHOKE POINT DEL RASTRO de las correcciones del dia de reparto.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────────┐
// │ LA REGLA, y este archivo existe para que tenga UN SITIO donde estar escrita:               │
// │                                                                                            │
// │   Toda escritura de `orden.fecha_reparto` que NO sea una asignacion ni una limpieza DEBE    │
// │   invocar esta funcion en su MISMA transaccion, y SOLO con las ordenes que efectivamente    │
// │   cambiaron.                                                                                │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// Es el molde de `registrar-cambio-estado.ts` (49/design §3.3) pero MUCHO mas pequeno: sin webhook,
// sin notificaciones y sin catalogo. El aviso al mensajero NO se emite desde aqui a proposito
// (design §15.5/A22): dentro de una transaccion de Postgres un error de sentencia aborta la
// transaccion ENTERA, asi que un aviso caido revertiria una correccion legitima y devolveria la
// orden al estado inalcanzable del que la ficha 262 existe para sacarla. La direccion segura del
// error es la contraria: la correccion manda, el aviso es cortesia (R49).
//
// «¿Y por que una funcion y no un `createMany` suelto en el repositorio?» Porque un `createMany`
// suelto no tiene donde llevar la regla de arriba, y la regla es lo unico que impide que la segunda
// escritura del dia —la que llegue dentro de seis meses— se olvide del rastro sin que nada se ponga
// rojo. Es el mismo motivo por el que existe `appendCambioEstado`.
//
// ⚠️ ESTE ES EL UNICO SITIO DEL ARBOL QUE INSERTA EN `orden_dia_reparto_cambio`. Si aparece un
// segundo, es un bug: el rastro dejaria de tener un punto por el que pasar.

/**
 * Cliente de transaccion aceptado: cualquier cosa que exponga la tabla del rastro. Lo satisfacen
 * tanto el `PrismaClient` completo como el `tx` de un `$transaction` (patron
 * `OrdenHistorialTxClient` / `NotificacionTxClient`).
 */
export type CambioDiaRepartoTxClient = Pick<PrismaClient, "ordenDiaRepartoCambio">;

/** Una correccion a registrar. Las dos fechas ya vienen resueltas por quien escribio la fila. */
export interface CambioDiaRepartoEntrada {
  ordenId: string;
  /** El dia que la fila TENIA en el instante de la escritura (R24), leido bajo `FOR UPDATE`. */
  fechaAnterior: Date;
  fechaNueva: Date;
  /** NOT NULL: aqui nunca escribe un cron. Quien corrigio es la evidencia (R20). */
  actorUsuarioId: string;
  /** R21: obligatorio, ya recortado en el borde. */
  motivo: string;
}

/** Lo que el llamante necesita de vuelta: el id de cada fila escrita, en el MISMO orden. */
export interface CambioDiaRepartoRegistrado {
  ordenId: string;
  /** Id de la fila de `orden_dia_reparto_cambio`: LA ENTIDAD del aviso al mensajero (§15.3). */
  cambioId: string;
}

/**
 * R20/R22/R23 — inserta UNA fila por correccion efectiva, dentro del `tx` en curso.
 *
 * LOS `id` SE GENERAN AQUI con `randomUUID()` en vez de dejarlos al `@default(uuid())` de Prisma, y
 * no es un capricho: `createMany` sobre Postgres NO devuelve los ids generados, y el aviso al
 * mensajero necesita el de la fila del rastro como `entidad_id` (design §15.5). Generarlos arriba
 * permite seguir haciendo UN SOLO `createMany` —una sentencia, no N— y devolverlos en el mismo
 * orden en que entraron.
 *
 * NO-OP con lista vacia: sin correcciones no hay rastro que escribir, y una lista vacia no es un
 * error (el llamante ya aborto el lote por otra via si algo fallo).
 *
 * SOLO INSERTA. No actualiza, no borra y no lee: la tabla es append-only (R23) y esta funcion es la
 * unica escritura que existe sobre ella.
 */
export async function registrarCambioDiaReparto(
  tx: CambioDiaRepartoTxClient,
  entradas: readonly CambioDiaRepartoEntrada[],
): Promise<CambioDiaRepartoRegistrado[]> {
  if (entradas.length === 0) return [];

  const filas = entradas.map((e) => ({
    id: randomUUID(),
    ordenId: e.ordenId,
    fechaAnterior: e.fechaAnterior,
    fechaNueva: e.fechaNueva,
    actorUsuarioId: e.actorUsuarioId,
    motivo: e.motivo,
  }));

  await tx.ordenDiaRepartoCambio.createMany({ data: filas });

  return filas.map((f) => ({ ordenId: f.ordenId, cambioId: f.id }));
}
