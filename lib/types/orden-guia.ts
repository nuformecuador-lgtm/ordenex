// Feature 17 — Tipos y schemas del backend de "Generar guia" / asignacion de
// mensajero. DTOs propios (no amplian OrdenDTO) para no alterar el contrato del
// CRUD de ordenes (feature 6/7), patron lib/types/carga-masiva-resumen.ts.
import { z } from "zod";

// Feature 156 (R14): la entrada de "Generar guia" es un LOTE DE IDS y NADA MAS. El
// contrato previo (`decisiones: [{ ordenId, mensajeroId }]`) se retiro: generar guia
// ya no decide mensajero, asi que cualquier dato de mensajero en la entrada es un
// error de contrato y se resuelve como `validation_error` en el borde, sin llamar al
// service (zod descarta las claves no declaradas).
//
// COTA INFERIOR DEL LOTE (2026-08-05) — vale para las TRES acciones de este archivo que
// reciben `ordenIds` sueltos (`generarGuia`, `asignarDesdeBodega`, `rutearABodegaSatelite`).
// Un lote vacio NO es una peticion valida: sin `.min(1)` en el array, `{ ordenIds: [] }`
// cruzaba el borde y el service lo resolvia como `{ status: "ok", resultados: [] }`, asi que
// la UI cantaba un exito ("Mensajero asignado a 0 orden(es)") por una accion que no hizo
// nada. Se cierra en la raiz —el schema—, no en cada modal. Es la misma cota que ya tenian
// el resto de acciones de lote del repo (`recogerSchema`, `recibirLoteSchema`,
// `etiquetaGuiaSchema`, `asignarRecoleccionSchema`...), y se declara igual que ellas: SIN
// mensaje propio, porque la UI traduce `validation_error` a un literal fijo
// (`guiaDecisionErrorMessage`) y el texto de zod no llega nunca al usuario.
export const generarGuiaSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1),
});
export type GenerarGuiaActionInput = z.infer<typeof generarGuiaSchema>;

// R26: un solo mensajero para el lote completo (asignacion desde bodega).
export const asignarBodegaSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1), // cota del lote: ver el bloque de arriba
  mensajeroId: z.string().min(1),
});
export type AsignarBodegaActionInput = z.infer<typeof asignarBodegaSchema>;

export interface GenerarGuiaResultadoItem {
  ordenId: string;
  numGuia: number;
  estado: string; // feature 156/R3: SIEMPRE "en_bodega_central"
}

export interface AsignarBodegaResultadoItem {
  ordenId: string;
  estado: string;
}

// Feature 30/R13 — ruteo dedicado de ordenes no-GAM a la bodega satelite. Zod en
// el borde (mismo patron que asignarBodegaSchema).
export const rutearSateliteSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1), // cota del lote: ver el bloque de arriba
});
export type RutearSateliteActionInput = z.infer<typeof rutearSateliteSchema>;

export interface RutearSateliteResultadoItem {
  ordenId: string;
  estado: string; // "en_ruta_bodega_satelite"
}

export interface DetalleConflicto {
  ordenId: string;
  motivo: string;
}

// R42-like: resultado discriminado y tipado; sin filtrar internals ni PII. NO
// reutiliza `ActionError` de lib/types/orden.ts porque `conflict` aqui SIEMPRE
// trae `detalle` por orden (R29), forma distinta del `conflict` generico del CRUD.
export type GenerarGuiaResult =
  | { status: "ok"; resultados: GenerarGuiaResultadoItem[] }
  | { status: "unauthenticated" } // R14
  | { status: "forbidden" } // R12/R13
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R28
  | { status: "conflict"; detalle: DetalleConflicto[] }; // R27/R29

export type AsignarBodegaResult =
  | { status: "ok"; resultados: AsignarBodegaResultadoItem[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

// Feature 157 — asignacion del mensajero que RECOLECTA en la tienda. Mismo shape que
// `AsignarBodegaResult` (a proposito: el modal reusa `guiaDecisionErrorMessage` sin
// cambios), salvo que el item no lleva `estado`: la orden no transiciona (R4).
export const asignarRecoleccionSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  mensajeroId: z.string().uuid(),
});
export type AsignarRecoleccionActionInput = z.infer<typeof asignarRecoleccionSchema>;

// Feature 157 (ampliacion): la reversion no elige mensajero, solo el lote.
export const desasignarRecoleccionSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
});
export type DesasignarRecoleccionActionInput = z.infer<typeof desasignarRecoleccionSchema>;

export type AsignarRecoleccionResult =
  | { status: "ok"; resultados: { ordenId: string }[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

// Feature 30/R13/R16 — resultado discriminado del ruteo a satelite. `conflict`
// trae `detalle` por orden (origen invalido / borrada / orden GAM).
export type RutearSateliteResult =
  | { status: "ok"; resultados: RutearSateliteResultadoItem[] }
  | { status: "unauthenticated" } // R16
  | { status: "forbidden" } // R16
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R4/catalogo
  | { status: "conflict"; detalle: DetalleConflicto[] }; // R17

// T15 — loader de mensajeros para el modal (R28): TODOS los usuarios rol
// mensajero, SIN filtro de zona. La feature 30 restringira el CUERPO del loader
// sin cambiar esta firma (contrato estable, ver design.md).
export interface MensajeroLiteDTO {
  id: string;
  nombre: string;
}

export type ListarMensajerosParaAsignacionResult =
  | {
      status: "ok";
      mensajeros: MensajeroLiteDTO[];
      /**
       * Ajuste maestro: ids de mensajeros GAM con un cierre abierto (`solicitado`/
       * `vencido`). La UI los deshabilita en el selector para no asignarles nuevas
       * órdenes. Opcional (aditivo): ausente = ninguno bloqueado.
       */
      bloqueadosIds?: string[];
      /**
       * Feature 157 (regla de dedicación): ids con órdenes de REPARTO pendientes. No
       * pueden recibir una recolección en tienda —ese viaje se hace sin carga—, así que
       * el selector de ESE modal los deshabilita. Opcional (aditivo).
       */
      conRepartoIds?: string[];
      /**
       * Feature 157: ids con una RECOLECCIÓN en tienda sin confirmar. Tienen un viaje
       * comprometido, así que el selector de la asignación desde bodega los deshabilita.
       * Opcional (aditivo).
       */
      conRecoleccionIds?: string[];
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

// Gate de seleccion del maestro — loader de solo lectura de las zonas BLOQUEADAS:
// las que tienen AL MENOS 1 mensajero con un cierre abierto (`solicitado`/`vencido`).
// Cubre TODAS las zonas (central GAM y satelites) con la misma regla, para que la UI
// deshabilite la seleccion de esas ordenes y no diverja de la guarda del servidor.
export type ListarZonasBloqueadasResult =
  | { status: "ok"; zonasBloqueadasIds: string[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

// BORRADO 2026-08-07 (tanda 2): aqui vivian `EstatusLiteDTO` y `ListarCatalogoEstatusResult`,
// el soporte R15/R16 de `listarCatalogoEstatus` — borrada en la tanda 1 por ser la segunda
// victima de `54757be4`. La lectura viva del catalogo `order_status` es `listarOrderStatus`
// (`lib/actions/order-status.ts`), que tiene sus PROPIOS tipos en `lib/types/order-status.ts`
// (`OrderStatusLiteRow` / `ListarOrderStatusResult`) y no pasaba por estos.
