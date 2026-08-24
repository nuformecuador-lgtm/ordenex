import { z } from "zod";
import type { EstadoTarifa } from "@prisma/client";
import { tarifasConfig } from "@/lib/config/tarifas";

// R2/R5: montos >= 0, precision fija (nunca punto flotante ni texto en DB).
const montoSchema = z.number().nonnegative();
// R3/R5/D2/D3: porcentaje 0..100.
const porcentajeSchema = z.number().min(0).max(100);
// id de la tienda (usuario) duena de la tarifa. FK OPCIONAL: ver `crearTarifaSchema`.
const idSchema = z.string().min(1);
// Estado de la tarifa: solo activo|inactivo.
export const estadoTarifaSchema = z.enum(["activo", "inactivo"]);

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
    fulfillment: montoSchema, // D3: monto
    comisionCod: porcentajeSchema, // D3: porcentaje 0..100
    ivaFlete: porcentajeSchema, // D2: porcentaje 0..100
    ivaComisionCod: porcentajeSchema, // D2: porcentaje 0..100
    // Cobro pactado aparte. UNICO campo opcional: `null` (o ausente) = "sin
    // tarifa especial", que no es lo mismo que 0 (un cobro especial de cero).
    tarifaEspecial: montoSchema.nullable().optional(),
    // Acotado por zona. `null`/ausente = la tarifa NO se acota a ninguna zona
    // (aplica a la tienda entera), que es el estado de todas las filas historicas.
    zonaId: idSchema.nullable().optional(),
    // Tarifa a la que se cae cuando ninguna acotada por zona aplica. Ausente =
    // false: marcarla como la de por defecto es un acto explicito.
    isDefault: z.boolean().optional(),
  })
  .strict();
export type CrearTarifaInput = z.infer<typeof crearTarifaSchema>;

// R20/R23: actualizacion; todos los campos opcionales + `status` (activo/inactivo);
// mismas reglas de rango que en creacion; strict rechaza campos desconocidos.
export const actualizarTarifaSchema = crearTarifaSchema
  .partial()
  .extend({ status: estadoTarifaSchema.optional() })
  .strict();
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
export interface TarifaDTO {
  id: string;
  tiendaId: string | null; // null = no acotada a una tienda (aplica a cualquiera)
  status: EstadoTarifa; // activo | inactivo
  valorFlete: number;
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  fulfillment: number;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
  tarifaEspecial: number | null; // null = sin tarifa especial pactada
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
