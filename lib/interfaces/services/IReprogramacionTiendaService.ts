import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 100 (design §2.2) — contrato del servicio de REPROGRAMACION por la tienda: el
// `adminTienda` dueño de una orden que REPOSA en `devuelta` (novedad) la reprograma a una fecha
// futura, sacandola de `devuelta` ANTES de que venza su ventana SLA (feature 99). La accion se
// modela como una GESTION SINTETICA `resultado = reprogramada` con `fecha_reprogramacion` (gate
// F1.4-Q1), de modo que REUSA intacto el bloqueo + liberacion de la feature 46 (su cron lee la
// `fecha_reprogramacion` de esa gestion). Logica de negocio pura (sin HTTP ni Prisma); el borde
// (Server Action) la traduce a resultado tipado.

// Maquina de resultados de dominio (patron DevolverATiendaResult). Todos los rechazos son SIN
// efectos en datos. `ok` transiciona `devuelta` -> `reprogramada`. `conflict` = la orden ya no
// esta en `devuelta` (el cron SLA la movio, o doble submit): idempotente, sin efectos (R7).
// `forbidden` = el actor no es el adminTienda dueño (R6). `config_error` = catalogo sin
// `reprogramada`/`devuelta`. `not_found` = orden inexistente o borrada.
export type ReprogramarNovedadResult =
  | { status: "ok" } // R2/R3 (transiciono + gestion sintetica)
  | { status: "forbidden" } // R6 (no es el adminTienda dueño)
  | { status: "not_found" } // orden inexistente o borrada
  | { status: "conflict"; motivo: string } // R7 (ya salio de `devuelta`)
  | { status: "config_error" }; // catalogo sin `reprogramada`/`devuelta`

export interface IReprogramacionTiendaService {
  /**
   * R2/R3/R5/R6/R7/R11: reprograma una orden en `devuelta` a `reprogramada`. Autoriza SOLO al
   * `adminTienda` dueño (`orden.tienda_id === actor.usuarioId`). Guardia de estado (solo desde
   * `devuelta`; otro estado -> `conflict`). Persiste la transicion + la gestion sintetica
   * `reprogramada` (con `fecha_reprogramacion` y `motivo` opcional) via el choke point de la
   * feature 49, en la MISMA tx, guardada por `estatus_id = devuelta` (R21). La validacion de que
   * `fecha` es mañana o posterior ya la hizo el borde (R4).
   */
  reprogramar(
    ordenId: string,
    fechaReprogramacion: string,
    motivo: string | null,
    actor: Actor,
  ): Promise<ReprogramarNovedadResult>;
}
