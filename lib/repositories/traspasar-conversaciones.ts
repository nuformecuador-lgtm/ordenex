import { Prisma, type PrismaClient } from "@prisma/client";

// FICHA 427 (T7, design §6.3) — EL CHOKE POINT DEL CHAT en el traspaso de ordenes.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────────┐
// │ POR QUE EXISTE, Y ES EL HALLAZGO QUE EL ARREGLO MANUAL DEL 2026-09-14 PAGO (design §A5):   │
// │                                                                                            │
// │   Mover SOLO `orden.mensajero_asignado_id` deja el hilo INALCANZABLE PARA LOS DOS. El       │
// │   panel de chat del mensajero exige DOS cosas —que la orden sea suya Y que el hilo lo sea   │
// │   (`chat_conversacion.mensajero_id`)—, asi que el DESTINO ve hilo vacio, `ventanaAbierta:   │
// │   false` y texto libre deshabilitado (solo plantilla), y el ORIGEN deja de verlo porque ya  │
// │   no es dueno de la orden. El contador de no leidos cuelga de la misma columna.             │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ ESTE ES EL UNICO SITIO DEL ARBOL QUE MUEVE `chat_conversacion.mensajero_id` EN UN TRASPASO, y
// recibe el `tx` como PRIMER parametro: la atomicidad es del TIPO y no de la disciplina. El `Pick`
// deja fuera `$transaction`, asi que esta funcion NO PUEDE abrir la suya ni escribir fuera de la
// transaccion del traspaso (R23/R31).
//
// LOS ADJUNTOS NO NECESITAN NADA (medido): `/api/chat/media/[mensajeId]` autoriza por
// `conversacion -> orden -> mensajero asignado`, no por el hilo. Es la unica pieza del chat que el
// movimiento de la orden ya arregla sola.

/**
 * Cliente de transaccion aceptado: solo capacidad de mandar SQL crudo. Lo satisfacen el
 * `PrismaClient` entero y el `tx` de un `$transaction` interactivo.
 *
 * SQL CRUDO Y NO `updateMany`, por una razon concreta: `mensajero_leido_at` tiene que quedar en
 * NULL y `updated_at` tiene que escribirse a mano (el `@updatedAt` de Prisma no dispara en SQL
 * crudo). Con una sola sentencia se ve de un vistazo QUE columnas se tocan y —sobre todo— cuales
 * NO, que es la mitad del contrato de esta funcion.
 */
export type TraspasarConversacionesTxClient = Pick<PrismaClient, "$queryRaw">;

/**
 * R18/R19 — pasa al mensajero destino TODAS las conversaciones de esas ordenes, dentro del `tx` en
 * curso. Devuelve cuantas movio (la cifra que R36 pinta: «31 ordenes y 31 conversaciones»).
 *
 * TODAS las de esas ordenes, no una por orden: el unico de `chat_conversacion` es
 * `(orden_id, telefono_e164)`, asi que una orden puede tener MAS DE UN hilo.
 *
 * QUE ESCRIBE, y por que cada cosa:
 *
 *  - **`mensajero_id = destino`** (R18): es la mitad de la puerta del panel. Sin esto el hilo queda
 *    inalcanzable para los dos.
 *  - **`mensajero_leido_at = NULL`** (R19): esa marca significa «hasta donde leyo ESTE mensajero», y
 *    el mensajero ha cambiado. Conservarla haria que el destino viera «0 sin leer» sobre mensajes
 *    que el no ha visto NUNCA — justo el contexto que necesita para no llamar al cliente a ciegas.
 *  - **`updated_at = NOW()`**: a mano, porque el SQL crudo no dispara el `@updatedAt`.
 *
 * QUE **NO** ESCRIBE, y es contrato vigilado por test:
 *
 *  - **`ultimo_entrante_at`**: es del HILO y del CLIENTE, no del mensajero. Es lo que mantiene
 *    abierta la ventana de 24 h para el destino, que es la mitad del valor de mover el hilo — sin
 *    ella solo podria mandar plantilla.
 *  - **`telefono_e164`**, ni ninguna columna de `orden`: este `UPDATE` escribe SOLO en
 *    `chat_conversacion` (misma frontera que `migrarTelefono`).
 *
 * NO-OP con lista vacia: un `IN ()` no es SQL valido y «ninguna orden» no es un error.
 */
export async function traspasarConversaciones(
  tx: TraspasarConversacionesTxClient,
  ordenIds: readonly string[],
  mensajeroDestinoId: string,
): Promise<number> {
  if (ordenIds.length === 0) return 0;

  const filas = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "chat_conversacion"
    SET "mensajero_id" = ${mensajeroDestinoId},
        "mensajero_leido_at" = NULL,
        "updated_at" = NOW()
    WHERE "orden_id" IN (${Prisma.join([...ordenIds])})
    RETURNING "id"`;

  return filas.length;
}
