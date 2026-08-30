import { z } from "zod";
import type { ActionError } from "@/lib/types/orden";

// Ficha 333 (B1, design §6.1/§6.2) — FRONTERA CONTRACTUAL del COBRO de gasto fijo: el DTO que
// cruza al cliente, los schemas de borde de las cuatro Server Actions y los resultados tipados
// de servicio y de action.
//
// ⚠️ MONEY-SAFE, Y ES LA REGLA QUE MANDA EN ESTE ARCHIVO (R43): el monto es STRING de punta a
// punta —`Decimal(12,2)` en la base, `toFixed(2)` en el mapper del repositorio, STRING aqui y
// STRING al pintar—. NUNCA `number`, nunca `parseFloat`, nunca aritmetica fuera de
// `Prisma.Decimal`. Un `number` intermedio es una perdida de precision silenciosa sobre dinero
// que nadie vuelve a mirar.

/** Espejo del enum Postgres `gasto_fijo_cobro_estado`. Inventario cerrado (design §1.2). */
export type GastoFijoCobroEstado = "pendiente" | "aprobado" | "rechazado" | "cancelado";

/**
 * DTO que viaja del servidor al cliente (design §6.1).
 *
 * NO lleva `origenId`, ni `plantillaId`, ni `movimientoId`, y la ausencia es deliberada: la
 * pantalla no los necesita para pintar la cola ni para decidir, y un identificador que ES la
 * clave de idempotencia del libro en el navegador es superficie que no hace falta abrir.
 */
export type GastoFijoCobroDTO = {
  id: string;
  concepto: string;
  /** `Decimal` -> STRING con 2 decimales. NUNCA `number` (R43). */
  monto: string;
  /** `YYYY-MM` (periodicidad `meses`) | `YYYY-MM-DD` (`dias`/`semanas`). Lo que se ENSENA. */
  periodo: string;
  /** `YYYY-MM-DD`: dia CR de la corrida que genero el cobro. Es la columna de orden (R39). */
  generadoEl: string;
  estado: GastoFijoCobroEstado;
};

// ---------------------------------------------------------------------------
// Schemas de borde (zod, `.strict()`): toda entrada externa muere AQUI si trae
// una clave desconocida, antes de llegar al servicio.
// ---------------------------------------------------------------------------

/**
 * Listado de la cola de pendientes: sin filtros y sin paginacion (design §7, pregunta abierta 4).
 * La lista blanca resultante tiene CERO claves, lo que no lo vuelve prescindible sino
 * maximamente estricto: cualquier clave —`page`, `pageSize`, un `estado` que ensanchara el
 * conjunto— muere en el borde con `validation_error`.
 */
export const listarCobrosPendientesSchema = z.object({}).strict();
export type ListarCobrosPendientesInput = z.infer<typeof listarCobrosPendientesSchema>;

/**
 * Aprobar / rechazar: SOLO el identificador del cobro.
 *
 * ⚠️ NINGUNA DE LAS DOS ACEPTA EL MONTO DEL CLIENTE, y eso es R16 en el borde: el importe que se
 * cobra sale de la COPIA que el cobro guardo cuando se genero, leida server-side. Es la misma
 * regla por la que `reversarEgreso` lee el monto en el servidor.
 */
export const decidirCobroGastoFijoSchema = z.object({ id: z.string().uuid() }).strict();
export type DecidirCobroGastoFijoInput = z.infer<typeof decidirCobroGastoFijoSchema>;

/**
 * Conteo de los cobros pendientes de UNA plantilla (R55): lo que el dialogo de confirmacion de
 * borrado lee AL ABRIRSE para poder decir «se cancelaran N cobros pendientes» ANTES de aceptar.
 * Se pide en ese momento y no se cuelga de un listado traido con la pagina: un numero con
 * minutos de antiguedad estaria autorizando un borrado.
 */
export const contarCobrosPendientesDePlantillaSchema = z
  .object({ plantillaId: z.string().uuid() })
  .strict();
export type ContarCobrosPendientesDePlantillaInput = z.infer<
  typeof contarCobrosPendientesDePlantillaSchema
>;

// ---------------------------------------------------------------------------
// Resultados de DOMINIO del servicio (sin acoplarse a HTTP ni a Next).
// ---------------------------------------------------------------------------

/**
 * La cola de pendientes. `total` es el numero que devuelve el SERVIDOR y NO el largo de `items`
 * (R41): `items` viene recortado por el tope de `lib/config/gasto-fijo.ts`, asi que si algun dia
 * hubiera mas, el numero lo dice y la pantalla no miente.
 */
export type ListarCobrosPendientesServiceResult =
  | { status: "ok"; items: GastoFijoCobroDTO[]; total: number }
  | { status: "forbidden" };

/**
 * Aprobar. `yaEstabaEnElLibro` distingue los dos finales felices y NO es cosmetico (R19): si
 * alguien cambio el interruptor de la plantilla a mitad de periodo, puede existir ya un
 * movimiento con la clave del cobro; entonces no se crea un segundo, se ENLAZA el que hay y el
 * mensaje tiene que decir la verdad («ya estaba en el libro»), no «acabo de cobrarse».
 *
 * `ya_decidido` es el resultado de que la transicion `WHERE id AND estado = 'pendiente'` afecte
 * CERO filas: o alguien decidio antes, o dos aprobaciones llegaron a la vez (R17/R18).
 */
export type AprobarCobroGastoFijoServiceResult =
  | { status: "ok"; yaEstabaEnElLibro: boolean }
  | { status: "ya_decidido" }
  | { status: "not_found" }
  | { status: "forbidden" };

/** Rechazar. Sin payload: no escribe nada en el libro (R21). */
export type RechazarCobroGastoFijoServiceResult =
  | { status: "ok" }
  | { status: "ya_decidido" }
  | { status: "not_found" }
  | { status: "forbidden" };

/** Conteo para la confirmacion de borrado (R55). Autoriza `esAccesoTotal`, no el maestro solo. */
export type ContarCobrosPendientesDePlantillaServiceResult =
  | { status: "ok"; pendientes: number }
  | { status: "forbidden" };

// ---------------------------------------------------------------------------
// Resultados tipados de las Server Actions (lo que consume la pantalla).
// El borde anade `unauthenticated` y `validation_error`; el resto lo decide el
// servicio como resultado de dominio (design §6.2).
// ---------------------------------------------------------------------------

export type ListarCobrosPendientesResult =
  | { status: "ok"; items: GastoFijoCobroDTO[]; total: number }
  | ActionError;

export type AprobarCobroGastoFijoResult =
  | { status: "ok"; yaEstabaEnElLibro: boolean }
  | { status: "ya_decidido" }
  | ActionError;

export type RechazarCobroGastoFijoResult =
  | { status: "ok" }
  | { status: "ya_decidido" }
  | ActionError;

export type ContarCobrosPendientesDePlantillaResult =
  | { status: "ok"; pendientes: number }
  | ActionError;
