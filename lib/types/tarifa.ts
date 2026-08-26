import { z } from "zod";
import { tarifasConfig } from "@/lib/config/tarifas";

/**
 * De donde salio el monto del flete de una orden (tarifa especial por distrito, 2026-08-25).
 *
 * - `normal`             -> el distrito no es especial; columna estandar (o GAM).
 * - `especial`           -> el distrito es especial y habia pacto; se cobro el pacto.
 * - `especial_sin_pacto` -> el distrito es especial pero la tarifa resuelta no tiene monto
 *                           pactado. Se cobra la tarifa NORMAL (no se bloquea ni se cobra 0),
 *                           pero queda dicho: es un hueco de configuracion, no una decision.
 *
 * VIVE AQUI Y NO JUNTO A `resolverFlete` a proposito: `lib/types/orden.ts` lo necesita para el
 * DTO del listado, y ese modulo lo consumen componentes de CLIENTE. `ingreso-ordenex.ts`
 * importa `Prisma` como valor, asi que colgar el tipo de alli metia el cliente de Prisma en el
 * grafo del navegador. Este archivo no importa nada de `@prisma/client`.
 */
export type OrigenFlete = "normal" | "especial" | "especial_sin_pacto";

// R2/R5: montos >= 0, precision fija (nunca punto flotante ni texto en DB).
const montoSchema = z.number().nonnegative();
// R3/R5/D2/D3: porcentaje 0..100.
const porcentajeSchema = z.number().min(0).max(100);
// id de la tienda (usuario) duena de la tarifa. FK OPCIONAL: ver `crearTarifaSchema`.
const idSchema = z.string().min(1);

// Roles de usuario a los que se les puede asignar una tarifa. `adminTienda` es
// la tienda humana; `apiKey` es la cuenta dedicada de una API key (feature 81:
// 1:1 con `api_key`), que factura sus propias ordenes y por tanto necesita su
// propia tarifa. La FK `tarifas.tienda_id` apunta a `usuario` en ambos casos,
// asi que no hace falta columna nueva: solo se ensancha la invariante.
export const ROLES_TARIFABLES = ["adminTienda", "apiKey"] as const;
export type RolTarifable = (typeof ROLES_TARIFABLES)[number];

/** Etiqueta del grupo con que el select diferencia el origen de cada opcion. */
export const GRUPO_TARIFABLE: Record<RolTarifable, string> = {
  adminTienda: "Administradores de tienda",
  apiKey: "API keys",
};

// Validacion de creacion en el borde: las 8 columnas numericas obligatorias (D5);
// strict para rechazar campos desconocidos. La invariante "el duenno debe tener un
// rol tarifable" la valida el service (no el schema).
export const crearTarifaSchema = z
  .object({
    // Acotado por tienda. `null`/ausente = la tarifa NO se acota a ninguna tienda
    // (aplica a cualquiera). Cuando viene es FK a usuario (adminTienda | apiKey), y
    // que ese rol sea tarifable lo valida el service, no el schema.
    tiendaId: idSchema.nullable().optional(),
    valorFlete: montoSchema,
    valorFleteDevuelto: montoSchema,
    valorFleteGam: montoSchema,
    valorFleteDevueltoGam: montoSchema,
    // OPCIONAL (migracion `tarifa_fulfillment_opcional`): ausente/`null` = esta tarifa no
    // lleva fulfillment, LO MISMO que 0. No es el caso de `tarifaEspecial` (ver abajo): alli
    // el `null` es un hecho distinto del cero, aqui no. El formulario de ZONA no manda el
    // campo con valor nunca: lo manda `null`.
    fulfillment: montoSchema.nullable().optional(), // D3: monto; null = sin fulfillment
    comisionCod: porcentajeSchema, // D3: porcentaje 0..100
    ivaFlete: porcentajeSchema, // D2: porcentaje 0..100
    ivaComisionCod: porcentajeSchema, // D2: porcentaje 0..100
    // Cobro pactado aparte. UNICO campo opcional: `null` (o ausente) = "sin
    // tarifa especial", que no es lo mismo que 0 (un cobro especial de cero).
    tarifaEspecial: montoSchema.nullable().optional(),
    // Hermana de la anterior para la DEVOLUCION, e independiente de ella: se puede
    // pactar el flete de entrega y dejar la devolucion en la tarifa normal. Mismo
    // significado del `null`: sin pacto, que no es 0.
    tarifaEspecialDevuelta: montoSchema.nullable().optional(),
    // Acotado por zona. `null`/ausente = la tarifa NO se acota a ninguna zona
    // (aplica a la tienda entera), que es el estado de todas las filas historicas.
    zonaId: idSchema.nullable().optional(),
    // Tarifa a la que se cae cuando ninguna acotada por zona aplica. Ausente =
    // false: marcarla como la de por defecto es un acto explicito.
    isDefault: z.boolean().optional(),
  })
  .strict();
export type CrearTarifaInput = z.infer<typeof crearTarifaSchema>;

// R20/R23: actualizacion; todos los campos opcionales; mismas reglas de rango que
// en creacion; strict rechaza campos desconocidos.
// 274/R11: `status` YA NO es un campo de entrada (la columna `tarifas.status` y el
// tipo `estado_tarifa` se fueron con `20260825120000_drop_tarifa_status`). No hace
// falta ninguna validacion nueva para rechazarlo: como el schema es `.strict()`,
// mandar `status` cae solo en `validation_error`.
// 274/R14-R15: la prohibicion de la tarifa global `(tiendaId null, zonaId null)` NO
// vive aqui: el par efectivo de un `actualizar` depende de la fila existente en la
// base, y zod no la ve. La guarda esta en `TarifaService` (design 274 §3.3).
export const actualizarTarifaSchema = crearTarifaSchema.partial().strict();
export type ActualizarTarifaInput = z.infer<typeof actualizarTarifaSchema>;

// R18: parametros del listado. page/pageSize enteros positivos; pageSize se
// acota a MAX_PAGE_SIZE via clamp.
export const listarTarifasSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(tarifasConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, tarifasConfig.MAX_PAGE_SIZE)),
});
export type ListarTarifasInput = z.infer<typeof listarTarifasSchema>;

// R27: DTO expuesto por las Server Actions. Decimal -> number en las 8
// columnas numericas. La tabla ya no tiene `deleted_at`: borrar una tarifa es
// sacarla de la tabla (ver la migracion tarifa_zona_is_default).
// 274/R12: tampoco tiene `status`. Una tarifa ya no se activa ni se inactiva: se
// aplica o no segun la cascada `(tienda, zona)`, y la que no aplica se borra.
export interface TarifaDTO {
  id: string;
  tiendaId: string | null; // null = no acotada a una tienda (aplica a cualquiera)
  valorFlete: number;
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  // La columna es nullable en la base, pero el DTO NO propaga la ausencia: el repositorio
  // normaliza NULL a 0 porque para esta columna "sin monto" y "cero" son el mismo hecho
  // (ver `db/schema.prisma`). Quien lee un 0 aqui sabe lo unico que hay que saber: esta
  // tarifa no lleva fulfillment.
  fulfillment: number;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
  tarifaEspecial: number | null; // null = sin tarifa especial pactada
  tarifaEspecialDevuelta: number | null; // null = sin pacto especial para la DEVOLUCION
  zonaId: string | null; // null = no acotada a una zona (aplica a la tienda entera)
  isDefault: boolean; // la tarifa a la que se cae si ninguna zona aplica
  createdAt: Date;
  updatedAt: Date;
}

// R26: resultado discriminado y tipado; sin filtrar internals ni PII.
export type ActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R15/R23
  | { status: "unauthenticated" } // R8
  | { status: "forbidden" } // R11/R12/R13
  | { status: "not_found" } // R17/R21
  // SI hay conflicto de unicidad, aunque el diseno original dijera que no: la
  // tabla tiene un unico `(zona_id, tienda_id)` -con NULLS NOT DISTINCT, asi que
  // dos "generales de la tienda X" tambien chocan-. Ademas cubre el borrado de
  // una tarifa que algun cierre ya liquido (FK RESTRICT desde `cierre_detail`).
  | { status: "conflict" };

export type CrearTarifaResult = { status: "ok"; tarifa: TarifaDTO } | ActionError;
export type ObtenerTarifaResult = { status: "ok"; tarifa: TarifaDTO } | ActionError;
export type ListarTarifasResult =
  | { status: "ok"; items: TarifaDTO[]; page: number; pageSize: number; total: number }
  | ActionError;
export type ActualizarTarifaResult = { status: "ok"; tarifa: TarifaDTO } | ActionError;
export type BorrarTarifaResult = { status: "ok" } | ActionError;
