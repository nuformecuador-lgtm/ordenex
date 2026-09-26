import { z } from "zod";

import { desdeDiaCRSchema, hastaDiaCRSchema } from "@/lib/types/filtro-dias-cr";
import { WALLET_MOVIMIENTO_TIPO_SEED } from "@/lib/types/wallet";

// =================================================================================================
// Ficha 458-A (TA.3/TA.4, design §3.5, R10–R15) — los bordes de los FILTROS de la wallet.
// =================================================================================================
//
// Dos lecturas nuevas, las dos de solo lectura y sin un importe:
//
//  - `conceptosConMovimientos`: los conceptos que TIENEN movimientos en el periodo y la cuenta que se
//    miran, con su numero de movimientos (R13/R14). El filtro de concepto se puebla de aqui, no del
//    catalogo completo (SEED). NO recibe el propio concepto: el conteo no depende del concepto elegido,
//    y el cliente conserva el elegido con 0 (R15).
//  - `cierresDeLaCuenta`: los cierres con movimientos en el libro de UNA tienda o de UN mensajero,
//    con su dia de Costa Rica y el nombre del mensajero, para el selector con busqueda (R10/R11).
//
// Todo identificador que llega es `.uuid()` (R12: el borde rechaza lo que no tiene forma de
// identificador) y todos los objetos son `.strict()`: una clave extra es `validation_error`.

const busquedaSchema = z.string().trim().max(80);

/** El libro cuyo filtro de concepto se puebla. `mi_tienda` = la tienda de la SESION (sin id). */
export const conceptosConMovimientosSchema = z.discriminatedUnion("libro", [
  z
    .object({
      libro: z.literal("caja"),
      tipo: z.enum(WALLET_MOVIMIENTO_TIPO_SEED).optional(),
      desde: desdeDiaCRSchema.optional(),
      hasta: hastaDiaCRSchema.optional(),
    })
    .strict(),
  z
    .object({
      libro: z.literal("tienda"),
      tiendaId: z.string().uuid(),
      cierreId: z.string().uuid().optional(),
      desde: desdeDiaCRSchema.optional(),
      hasta: hastaDiaCRSchema.optional(),
    })
    .strict(),
  z
    .object({
      libro: z.literal("mi_tienda"),
      cierreId: z.string().uuid().optional(),
      desde: desdeDiaCRSchema.optional(),
      hasta: hastaDiaCRSchema.optional(),
    })
    .strict(),
]);

export type ConceptosConMovimientosInput = z.infer<typeof conceptosConMovimientosSchema>;

/**
 * Un concepto del filtro con su numero de movimientos. `categoria` es un valor del catalogo del
 * libro pedido (`WalletMovimientoCategoria` en la caja, `WalletTiendaMovimientoCategoria` en la
 * tienda); el rotulo lo pone la superficie con SU diccionario (desde Ordenex o desde la tienda).
 * `movimientos` es un CARDINAL (cuantas filas), nunca un importe.
 */
export type ConceptoConMovimientosDTO = { categoria: string; movimientos: number };

/** Los cierres del selector: de la tienda o del mensajero cuyo estado de cuenta se mira. */
export const cierresDeLaCuentaSchema = z.discriminatedUnion("cuenta", [
  z
    .object({ cuenta: z.literal("tienda"), tiendaId: z.string().uuid(), busqueda: busquedaSchema.optional() })
    .strict(),
  z
    .object({
      cuenta: z.literal("mensajero"),
      mensajeroId: z.string().uuid(),
      busqueda: busquedaSchema.optional(),
    })
    .strict(),
]);

export type CierresDeLaCuentaInput = z.infer<typeof cierresDeLaCuentaSchema>;

/**
 * UNA opcion del selector de cierre de las superficies de acceso total (R10). Sin importe (el
 * conteo es un cardinal). `cierreId` es el VALOR del control (viaja al filtro `cierreId`), jamas su
 * rotulo: el rotulo se compone con `dia` y `mensajero` (R1/R2).
 */
export type CierreDeCuentaOpcionDTO = {
  cierreId: string;
  /** Dia de Costa Rica en que se solicito el cierre, `YYYY-MM-DD`. */
  dia: string;
  /** Hora de pared de Costa Rica (`HH:mm`), para desambiguar dos cierres del mismo dia. */
  hora: string;
  /** El mensajero del cierre, con `etiquetaDeCuenta`. */
  mensajero: string;
  /** Cuantos movimientos de ESTA cuenta trajo el cierre. Cardinal, no dinero. */
  movimientos: number;
};

export type ConceptosConMovimientosResult =
  | { status: "ok"; conceptos: ConceptoConMovimientosDTO[] }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

export type CierresDeLaCuentaResult =
  | { status: "ok"; opciones: CierreDeCuentaOpcionDTO[]; hayMas: boolean }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
