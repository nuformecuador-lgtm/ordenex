import type { OrderStatusValue } from "@/lib/types/order-status";
import { ESTATUS_POR_GRUPO } from "@/lib/types/novedad-grupo";

// Feature 266 (T2.1, design §1) — LOS ESTADOS DESDE LOS QUE EL CANAL POR API KEY PUEDE HABILITAR
// un pedido con novedad. Modulo PURO, hermano del que declara los grupos de `/novedades`: no
// conoce Prisma, ni Next, ni HTTP. Lo consume la guarda de estado del service
// (`ApiHabilitacionService`, R14), que es el llamador y no el repositorio.

/**
 * **D1 (puerta del 2026-08-23, FIRMADA).** Los DOS grupos que el repo YA declara en
 * `novedad-grupo.ts` (`ayuda` -> `ayuda_tienda`, `devolucion` -> `devuelta`), y ninguno mas.
 *
 * ⚠️ **`reprogramada` QUEDA FUERA A PROPOSITO** (R13-b). Es «novedad» en la definicion del
 * integrador —y estuvo propuesta como habilitable hasta la puerta—, pero NO es un grupo de
 * `/novedades`. Anadirla «por simetria» abriria una SEGUNDA lista que alguien tendria que
 * mantener de acuerdo con la primera, que es exactamente lo que este modulo existe para evitar.
 * Fuera tambien `rechazada`, `incidente` y `sin_gestionar`.
 *
 * **SE DERIVA de `ESTATUS_POR_GRUPO`, no se reescribe como literales**: dos literales son dos
 * verdades, y el dia que un value cambie alli este endpoint dejaria de habilitar lo que la
 * pantalla llama novedad. El `satisfies` rompe el build si un value deja de existir en
 * `ORDER_STATUS_SEED`.
 *
 * Es lista de **INCLUSION**: un estado nuevo del catalogo NO se vuelve habilitable solo, y un
 * grupo nuevo de `/novedades` tampoco entra sin una decision explicita aqui.
 *
 * Consecuencia declarada del conjunto (requirements, vocabulario): una orden `devuelta` esta
 * SIEMPRE desasignada —su paquete ya volvio a bodega—, asi que de los dos estados habilitables
 * **solo `ayuda_tienda` puede volver a `en_reparto`**. `devuelta` cae SIEMPRE en solo-log.
 */
export const ESTADOS_HABILITABLES_API = [
  ESTATUS_POR_GRUPO.ayuda, // "ayuda_tienda"
  ESTATUS_POR_GRUPO.devolucion, // "devuelta"
] as const satisfies readonly OrderStatusValue[];

export type EstadoHabilitableApi = (typeof ESTADOS_HABILITABLES_API)[number];

/** `true` si el estado ACTUAL de la orden admite una habilitacion por el canal por API key (R13). */
export function esEstadoHabilitableApi(estatusValue: string): boolean {
  return (ESTADOS_HABILITABLES_API as readonly string[]).includes(estatusValue);
}
