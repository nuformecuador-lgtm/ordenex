import { randomUUID } from "node:crypto";
import type { PrismaClient, RolValue } from "@prisma/client";

// FICHA 427 (T6, design §5) — EL CHOKE POINT DEL RASTRO de los traspasos de una orden entre
// mensajeros.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────────┐
// │ LA REGLA, y este archivo existe para que tenga UN SITIO donde estar escrita:               │
// │                                                                                            │
// │   Toda escritura de `orden.mensajero_asignado_id` que NO sea una asignacion desde bodega    │
// │   ni una limpieza del deshacer —es decir, todo TRASPASO entre mensajeros— DEBE invocar      │
// │   esta funcion en su MISMA transaccion, y SOLO con las ordenes que efectivamente se         │
// │   movieron (R31).                                                                           │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// Es el molde de `registrar-cambio-dia-reparto.ts` (262/B4), que a su vez es el de
// `registrar-cambio-estado.ts` (49): sin webhook, sin notificaciones y sin catalogo. Los avisos a
// los dos mensajeros NO se emiten desde aqui a proposito (design §6.5): dentro de una transaccion
// de Postgres un error de sentencia aborta la transaccion ENTERA, asi que un aviso caido
// REVERTIRIA un traspaso legitimo y dejaria el paquete en manos de quien ya no puede entregarlo. La
// direccion segura del error es la contraria: EL TRASPASO MANDA, EL AVISO ES CORTESIA (R41).
//
// «¿Y por que una funcion y no un `createMany` suelto en el repositorio?» Porque un `createMany`
// suelto no tiene donde llevar la regla de arriba, y la regla es lo unico que impide que la segunda
// escritura de esta familia —la que llegue dentro de seis meses, cuando se abra el traspaso al
// `adminSatelite` (seguimiento S1)— se olvide del rastro sin que nada se ponga rojo.
//
// ⚠️ ESTE ES EL UNICO SITIO DEL ARBOL QUE INSERTA EN `orden_traspaso_mensajero`. Si aparece un
// segundo, es un bug: el rastro dejaria de tener un punto por el que pasar.

/**
 * Cliente de transaccion aceptado: SOLO la tabla del rastro (`Pick`). Que el tipo sea tan estrecho
 * es el mecanismo, no estetica — un `PrismaClient` completo traeria `$transaction` consigo y esta
 * funcion podria abrir la suya, que es exactamente lo que la haria dejar de ser atomica con la
 * escritura que la llama. Lo satisfacen tanto el `PrismaClient` entero como el `tx` de un
 * `$transaction` (patron `CambioDiaRepartoTxClient`).
 */
export type TraspasoMensajeroTxClient = Pick<PrismaClient, "ordenTraspasoMensajero">;

/** Una fila de rastro a registrar. Todo viene YA resuelto por quien ejecuto el traspaso. */
export interface TraspasoMensajeroEntrada {
  ordenId: string;
  /** R25: de quien venia. NOT NULL — una orden sin mensajero no se traspasa, se asigna. */
  mensajeroAnteriorId: string;
  /** R25: a quien va. El CHECK de la base rechaza que sea igual al anterior (R7). */
  mensajeroNuevoId: string;
  /** NOT NULL: aqui nunca escribe un cron. Quien traspaso es la evidencia (R25). */
  actorUsuarioId: string;
  /**
   * R26 — el rol del actor CONGELADO en este instante. Se persiste, no se resuelve por join al
   * leer: el rol de una persona cambia y leer el rol vivo al pintar RE-ETIQUETARIA la historia.
   */
  actorRol: RolValue;
  /** R28: obligatorio, ya recortado en el borde (`trim().min(10).max(300)`). */
  motivo: string;
}

/** Lo que el llamante necesita de vuelta: el id de cada fila escrita, en el MISMO orden. */
export interface TraspasoMensajeroRegistrado {
  ordenId: string;
  /** Id de la fila de `orden_traspaso_mensajero`. */
  traspasoId: string;
}

/**
 * R25/R27/R30 — inserta UNA fila por orden movida, todas con el MISMO `loteId`, dentro del `tx` en
 * curso.
 *
 * EL `loteId` ES UN PARAMETRO Y NO SE GENERA AQUI, y es deliberado: es UNO POR ACTO (R27), no uno
 * por llamada a esta funcion ni uno por fila. Lo genera el servicio, que es quien sabe donde empieza
 * y donde acaba un acto, y es ademas LA ENTIDAD de los dos avisos (design §6.5) — que se emiten
 * FUERA de esta transaccion y necesitan el mismo valor.
 *
 * LOS `id` DE FILA SI SE GENERAN AQUI con `randomUUID()` en vez de dejarlos al `@default(uuid())` de
 * Prisma: `createMany` sobre Postgres NO devuelve los ids generados, y generarlos arriba permite
 * seguir haciendo UN SOLO `createMany` —una sentencia, no N— y devolverlos en el mismo orden en que
 * entraron.
 *
 * NO-OP con lista vacia: sin ordenes movidas no hay rastro que escribir, y una lista vacia no es un
 * error (el llamante ya aborto el lote por otra via si algo fallo).
 *
 * SOLO INSERTA. No actualiza, no borra y no lee: la tabla es append-only (R30) y esta funcion es la
 * unica escritura que existe sobre ella.
 */
export async function registrarTraspasoMensajero(
  tx: TraspasoMensajeroTxClient,
  loteId: string,
  entradas: readonly TraspasoMensajeroEntrada[],
): Promise<TraspasoMensajeroRegistrado[]> {
  if (entradas.length === 0) return [];

  const filas = entradas.map((e) => ({
    id: randomUUID(),
    ordenId: e.ordenId,
    mensajeroAnteriorId: e.mensajeroAnteriorId,
    mensajeroNuevoId: e.mensajeroNuevoId,
    actorUsuarioId: e.actorUsuarioId,
    actorRol: e.actorRol, // R26: el rol CONGELADO que el llamante leyo del actor
    motivo: e.motivo,
    loteId, // R27: el MISMO para todas las filas de este acto
  }));

  await tx.ordenTraspasoMensajero.createMany({ data: filas });

  return filas.map((f) => ({ ordenId: f.ordenId, traspasoId: f.id }));
}
