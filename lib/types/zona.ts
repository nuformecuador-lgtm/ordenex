import { z } from "zod";
import { zonasConfig } from "@/lib/config/zonas";

// Feature 24. Zod en el borde (R19/R25/R26). Montos como number >= 0 (patron
// cobro.ts); el repo los convierte a Prisma.Decimal(12,2).
const montoSchema = z.number().nonnegative();
const nombreSchema = z.string().min(1);
const idSchema = z.string().min(1);

// R17/R19: campos de una zona. `distritoIds` = conjunto de distritos del catalogo
// global que componen la zona (al menos uno en creacion).
const zonaFields = {
  nombre: nombreSchema,
  pagoEntrega: montoSchema,
  pagoRechazo: montoSchema,
  esGam: z.boolean(),
  distritoIds: z.array(idSchema).min(1),
};

// R17/R19: creacion; strict rechaza campos desconocidos.
export const crearZonaSchema = z.object(zonaFields).strict();
export type CrearZonaInput = z.infer<typeof crearZonaSchema>;

// R22: edicion; `id` obligatorio y el resto de campos opcionales (se aplican solo
// los provistos). `distritoIds`, si viene, es el conjunto COMPLETO deseado (puede
// ser vacio para liberar todos). strict rechaza campos desconocidos.
export const actualizarZonaSchema = z
  .object({
    nombre: nombreSchema,
    pagoEntrega: montoSchema,
    pagoRechazo: montoSchema,
    esGam: z.boolean(),
    distritoIds: z.array(idSchema),
  })
  .partial()
  .extend({ id: idSchema })
  .strict();
export type ActualizarZonaInput = z.infer<typeof actualizarZonaSchema>;

// R24: parametros del listado. page/pageSize enteros positivos; pageSize acotado a
// MAX_PAGE_SIZE via clamp (patron cobro.ts).
export const listarZonasSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(zonasConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, zonasConfig.MAX_PAGE_SIZE)),
});
export type ListarZonasInput = z.infer<typeof listarZonasSchema>;

// R26: DTO expuesto por las Server Actions. Montos Decimal -> number; incluye el
// numero de distritos asignados (R24). Nunca expone campos internos.
export interface ZonaDTO {
  id: string;
  nombre: string;
  pagoEntrega: number;
  pagoRechazo: number;
  esGam: boolean;
  distritosCount: number;
}

// R15: proyeccion ligera reutilizable por otras features (selectores).
export interface ZonaLightDTO {
  id: string;
  nombre: string;
  esGam: boolean;
}

// R14: catalogo geografico global (lectura).
export interface ProvinciaLightDTO {
  id: string;
  nombre: string;
}
export interface CantonLightDTO {
  id: string;
  nombre: string;
}
export interface DistritoCatalogoDTO {
  id: string;
  nombre: string;
  zonaId: string | null;
  zonaNombre: string | null;
}

// R25/R26: resultado discriminado por `status`. El conflicto identifica su causa:
// `nombre` (unicidad normalizada, R21) o `distrito` (ya asignado a otra zona, R20;
// `distritoIds` lleva los distritos en conflicto).
export type ZonaActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R19
  | { status: "unauthenticated" } // R13
  | { status: "forbidden" } // R16
  | { status: "not_found" } // R22
  | { status: "conflict"; reason: "nombre" | "distrito"; distritoIds?: string[] }; // R20/R21

export type CrearZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ObtenerZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ActualizarZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ListarZonasResult =
  | { status: "ok"; items: ZonaDTO[]; page: number; pageSize: number; total: number }
  | ZonaActionError;
export type MarcarZonaGamResult = { status: "ok" } | ZonaActionError;
export type ListarZonasLightResult = { status: "ok"; items: ZonaLightDTO[] } | ZonaActionError;
export type ListarProvinciasResult = { status: "ok"; items: ProvinciaLightDTO[] } | ZonaActionError;
export type ListarCantonesResult = { status: "ok"; items: CantonLightDTO[] } | ZonaActionError;
export type ListarDistritosResult = { status: "ok"; items: DistritoCatalogoDTO[] } | ZonaActionError;
