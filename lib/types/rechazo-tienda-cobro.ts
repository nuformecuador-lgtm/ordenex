import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";

// 💰 FICHA 337 (segunda mitad, 2026-08-31) — FRONTERA CONTRACTUAL del COBRO POR RECHAZO DESDE
// NOVEDADES: el DTO que cruza al cliente, los schemas de borde de las Server Actions y los
// resultados tipados de servicio y de action.
//
// Espejo literal de `lib/types/gasto-fijo-cobro.ts` (ficha 333). Se copia la FORMA, no se
// generaliza aquel archivo: tiene horas de vida en produccion y hacerlo generico con la
// operacion en marcha es el riesgo que no toca correr.
//
// ⚠️ MONEY-SAFE, Y ES LA REGLA QUE MANDA EN ESTE ARCHIVO: los importes son STRING de punta a
// punta —`Decimal(12,2)` en la base, `toFixed(2)` en el mapper del repositorio, STRING aqui y
// STRING al pintar—. NUNCA `number`, nunca `parseFloat`, nunca aritmetica fuera de
// `Prisma.Decimal`.
//
// ⚠️ Y ADEMAS: EN TODO ESTE DOMINIO NO SE CALCULA DINERO. Los dos importes salen de
// `derivarIngresoOrden` (`lib/utils/ingreso-ordenex.ts`) en el instante del rechazo y viajan
// COPIADOS hasta el libro. Por eso el DTO **no lleva un total**: sumarlos aqui seria la unica
// operacion de dinero de la ficha, y existiria solo para pintar una celda. La cola enseña los
// dos conceptos por separado, que es como los enseña el detalle del cierre.

/** Espejo del enum Postgres `rechazo_tienda_cobro_estado`. Inventario cerrado (3 valores). */
export type RechazoTiendaCobroEstado = "pendiente" | "aprobado" | "rechazado";

/**
 * DTO que viaja del servidor al cliente.
 *
 * NO lleva `gestionId`, ni `ordenId`, ni `tiendaId`, ni `tarifaId`, y la ausencia es deliberada
 * (mismo criterio que la 333 con `origenId`): la pantalla no los necesita para decidir, y
 * `gestionId` ES la clave de idempotencia del libro — un identificador asi en el navegador es
 * superficie que no hace falta abrir.
 */
export type RechazoTiendaCobroDTO = {
  id: string;
  /** Nombre legible de la tienda a la que se le cobra. Sale del `tienda_id` CONGELADO. */
  tiendaNombre: string;
  /** Guia de la orden; `null` mientras la orden no tenga numero asignado. */
  numGuia: number | null;
  numRemision: string;
  /** `ingreso_flete_devolucion` congelado. STRING 2 dec, NUNCA `number`. */
  montoFlete: string;
  /** `ingreso_iva_flete_devolucion` congelado. STRING 2 dec; `"0.00"` es un valor real. */
  montoIva: string;
  /** `YYYY-MM-DD`: dia CALENDARIO CR del rechazo. Es la columna por la que ordena la cola. */
  generadoEl: string;
  estado: RechazoTiendaCobroEstado;
};

// ---------------------------------------------------------------------------
// Schemas de borde (zod, `.strict()`): toda entrada externa muere AQUI si trae
// una clave desconocida, antes de llegar al servicio.
// ---------------------------------------------------------------------------

/**
 * La cola de pendientes: sin filtros y sin paginacion. La lista blanca tiene CERO claves, lo que
 * no la vuelve prescindible sino maximamente estricta: cualquier clave —`page`, `pageSize`, un
 * `estado` que ensanchara el conjunto, un `tiendaId` que convirtiera la cola en un listado
 * dirigido— muere en el borde con `validation_error`.
 */
export const listarCobrosRechazoTiendaSchema = z.object({}).strict();
export type ListarCobrosRechazoTiendaInput = z.infer<typeof listarCobrosRechazoTiendaSchema>;

/**
 * Aprobar / rechazar: SOLO el identificador del cobro.
 *
 * ⚠️ NINGUNA DE LAS DOS ACEPTA UN IMPORTE DEL CLIENTE. Lo que se cobra sale de la COPIA que el
 * cobro congelo cuando la tienda rechazo, leida server-side. Es la misma regla por la que
 * `aprobarCobroGastoFijoAction` (333) y `reversarEgreso` (45) leen el monto en el servidor.
 */
export const decidirCobroRechazoTiendaSchema = z.object({ id: z.string().uuid() }).strict();
export type DecidirCobroRechazoTiendaInput = z.infer<typeof decidirCobroRechazoTiendaSchema>;

// ---------------------------------------------------------------------------
// Resultados de DOMINIO del servicio (sin acoplarse a HTTP ni a Next).
// ---------------------------------------------------------------------------

/**
 * La cola de pendientes. `total` es el numero que devuelve el SERVIDOR y NO el largo de `items`:
 * `items` viene recortado por el tope de `lib/config/rechazo-tienda-cobro.ts`, asi que si algun
 * dia hubiera mas, el numero lo dice y la pantalla no miente.
 */
export type ListarCobrosRechazoTiendaServiceResult =
  | { status: "ok"; items: RechazoTiendaCobroDTO[]; total: number }
  | { status: "forbidden" };

/**
 * Aprobar. `yaEstabaEnElLibro` distingue los dos finales felices y NO es cosmetico: los dos
 * libros son idempotentes por sus indices unicos, asi que un reintento tras una caida a medias
 * puede encontrar los apuntes ya escritos. Entonces no se duplica nada y el mensaje tiene que
 * decir la verdad («ya estaba en el libro»), no «acabo de cobrarse».
 *
 * `ya_decidido` es el resultado de que la transicion `WHERE id AND estado = 'pendiente'` afecte
 * CERO filas: o alguien decidio antes, o dos aprobaciones llegaron a la vez y el motor serializo.
 * NO es un error: es el final normal de la segunda.
 */
export type AprobarCobroRechazoTiendaServiceResult =
  | { status: "ok"; yaEstabaEnElLibro: boolean }
  | { status: "ya_decidido" }
  | { status: "not_found" }
  | { status: "forbidden" };

/** Rechazar el cobro. Sin payload: no escribe absolutamente nada en ningun libro. */
export type RechazarCobroRechazoTiendaServiceResult =
  | { status: "ok" }
  | { status: "ya_decidido" }
  | { status: "not_found" }
  | { status: "forbidden" };

// ---------------------------------------------------------------------------
// Resultados tipados de las Server Actions (lo que consume la pantalla).
// El borde anade `unauthenticated` y `validation_error`; el resto lo decide el
// servicio como resultado de dominio.
// ---------------------------------------------------------------------------

export type ListarCobrosRechazoTiendaResult =
  | { status: "ok"; items: RechazoTiendaCobroDTO[]; total: number }
  | ActionError;

export type AprobarCobroRechazoTiendaResult =
  | { status: "ok"; yaEstabaEnElLibro: boolean }
  | { status: "ya_decidido" }
  | ActionError;

export type RechazarCobroRechazoTiendaResult =
  | { status: "ok" }
  | { status: "ya_decidido" }
  | ActionError;
