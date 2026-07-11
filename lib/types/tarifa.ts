import { z } from "zod";
import { tarifasConfig } from "@/lib/config/tarifas";

// R2/R5: montos >= 0, precision fija (nunca punto flotante ni texto en DB).
const montoSchema = z.number().nonnegative();
// R3/R5/D2/D3: porcentaje 0..100.
const porcentajeSchema = z.number().min(0).max(100);
// D1/R5: nombre no vacio, distingue tarifas.
const nombreSchema = z.string().min(1);

// R14/R15: validacion de creacion en el borde. nombre + las 8 columnas
// numericas obligatorias (D5); strict para rechazar campos desconocidos.
export const crearTarifaSchema = z
  .object({
    nombre: nombreSchema,
    valorFlete: montoSchema,
    valorFleteDevuelto: montoSchema,
    valorFleteGam: montoSchema,
    valorFleteDevueltoGam: montoSchema,
    fulfillment: montoSchema, // D3: monto
    comisionCod: porcentajeSchema, // D3: porcentaje 0..100
    ivaFlete: porcentajeSchema, // D2: porcentaje 0..100
    ivaComisionCod: porcentajeSchema, // D2: porcentaje 0..100
  })
  .strict();
export type CrearTarifaInput = z.infer<typeof crearTarifaSchema>;

// R20/R23: actualizacion; todos los campos opcionales, mismas reglas de rango
// que en creacion; strict rechaza campos desconocidos.
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
// columnas numericas. NUNCA expone deletedAt.
export interface TarifaDTO {
  id: string;
  nombre: string;
  valorFlete: number;
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  fulfillment: number;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
  createdAt: Date;
  updatedAt: Date;
}

// R26: resultado discriminado y tipado; sin filtrar internals ni PII.
// NO hay estado `conflict` (id es uuid, nombre no es unico).
export type ActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R15/R23
  | { status: "unauthenticated" } // R8
  | { status: "forbidden" } // R11/R12/R13
  | { status: "not_found" }; // R17/R21/R25

export type CrearTarifaResult = { status: "ok"; tarifa: TarifaDTO } | ActionError;
export type ObtenerTarifaResult = { status: "ok"; tarifa: TarifaDTO } | ActionError;
export type ListarTarifasResult =
  | { status: "ok"; items: TarifaDTO[]; page: number; pageSize: number; total: number }
  | ActionError;
export type ActualizarTarifaResult = { status: "ok"; tarifa: TarifaDTO } | ActionError;
export type BorrarTarifaResult = { status: "ok" } | ActionError;
