import { z } from "zod";
import { ordenesConfig } from "@/lib/config/ordenes";

// Campos ordenables permitidos (lista blanca, evita inyeccion de columnas; R31).
export const SORT_FIELDS = ["created_at", "num_guia", "num_remision"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

// R25/R26: validacion de creacion en el borde. zona/provincia/canton obligatorios
// (R12); distrito/estatus/notas/tienda opcionales. peso numerico estrictamente > 0
// (R13/R26). num_remision provisto por el usuario, no vacio (R9).
export const crearOrdenSchema = z.object({
  numRemision: z.string().min(1),
  destinatario: z.string().min(1),
  telefonoDest: z.string().min(1),
  producto: z.string().min(1),
  peso: z.number().positive(),
  estatusId: z.string().min(1).optional(),
  tiendaId: z.string().min(1).optional(),
  zonaId: z.string().min(1),
  provinciaId: z.string().min(1),
  cantonId: z.string().min(1),
  distritoId: z.string().min(1).optional(),
  notas: z.string().optional(),
});
export type CrearOrdenInput = z.infer<typeof crearOrdenSchema>;

// R35/R37: actualizacion; todos los campos opcionales, sin num_guia/id/num_remision
// (inmutables). El alcance por rol (mensajero: solo estatusId) lo aplica el service.
export const actualizarOrdenSchema = z
  .object({
    destinatario: z.string().min(1).optional(),
    telefonoDest: z.string().min(1).optional(),
    producto: z.string().min(1).optional(),
    peso: z.number().positive().optional(),
    estatusId: z.string().min(1).optional(),
    tiendaId: z.string().min(1).optional(),
    zonaId: z.string().min(1).optional(),
    provinciaId: z.string().min(1).optional(),
    cantonId: z.string().min(1).optional(),
    distritoId: z.string().min(1).nullable().optional(),
    notas: z.string().nullable().optional(),
  })
  .strict();
export type ActualizarOrdenInput = z.infer<typeof actualizarOrdenSchema>;

// R30/R31/R32/R33: parametros del listado. page/pageSize enteros positivos (R32);
// pageSize se acota a MAX_PAGE_SIZE (R33) via clamp. sortBy/sortDir por lista blanca.
export const listarOrdenesSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(ordenesConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, ordenesConfig.MAX_PAGE_SIZE)),
  estatusId: z.string().min(1).optional(),
  sortBy: z.enum(SORT_FIELDS).default("created_at"),
  sortDir: z.enum(SORT_DIRS).default("desc"),
});
export type ListarOrdenesInput = z.infer<typeof listarOrdenesSchema>;

// R42/N3: DTO expuesto por las Server Actions. `numGuia` crudo (entero); `peso`
// serializado a number (no Decimal). NUNCA expone `deletedAt`.
// Feature 17/R30: `numGuia` es `number | null` — la guia se asigna en "Generar
// guia" (feature 17), no al crear la orden (R1/R2); una orden sin guia aun se
// lista con `numGuia: null` (pendiente).
export interface OrdenDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusId: string;
  estatusValue?: string;
  destinatario: string;
  telefonoDest: string;
  tiendaId: string;
  zonaId: string;
  provinciaId: string;
  cantonId: string;
  distritoId: string | null;
  producto: string;
  peso: number | null; // feature 15/R4: nullable (carga masiva no trae peso)
  notas: string | null;
  // Feature 49/R27: mensajero ASIGNADO de la orden, para autorizar la lectura del
  // historial (el mensajero ve las que le fueron/estan asignadas). Opcional (`?`) por el
  // mismo motivo que en OrdenListItemDTO: no romper mocks/fixtures que construyen OrdenDTO
  // sin el; `findById`/`toDTO` SIEMPRE lo envian (string|null desde la columna orden).
  mensajeroAsignadoId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// R42: resultado discriminado y tipado; sin filtrar internals ni PII.
export type ActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R26/R32/R38
  | { status: "unauthenticated" } // R18
  | { status: "forbidden" } // R22/R24/R41
  | { status: "not_found" } // R29/R36/R40
  | { status: "conflict" }; // R28

// R25/R26: elemento del LISTADO. Extiende OrdenDTO con el nombre legible de la
// tienda (`Usuario.nombre` del usuario tienda). Solo aplica al listado; crear/
// obtener/actualizar siguen devolviendo OrdenDTO sin `tiendaNombre`.
// Feature 17/R20: agrega `mensajeroSugeridoId`/`mensajeroAsignadoId` (solo el
// listado, para que el modal "Generar guia" agrupe por sugerido y las secciones
// en_espera_aceptacion/en_bodega muestren el mensajero asignado). Cambio aditivo:
// NO se agrega a OrdenDTO base para no ampliar el contrato del CRUD. Opcionales
// (`?`) para no romper mocks/fixtures de UI existentes que construyen
// OrdenListItemDTO sin estos campos; el repositorio SIEMPRE los envia (string|null).
// Feature 30/R14/R19: agrega `zonaNombre` (columna de zona del listado) y
// `zonaEsGam` (la UI decide por fila si muestra select de mensajero (GAM) o
// "-> bodega satelite" (no-GAM)). Opcionales (`?`) por el mismo motivo que los
// campos de mensajero (feature 17): no romper mocks/fixtures de UI existentes que
// construyen OrdenListItemDTO sin ellos (R19, cambio aditivo); el repositorio
// SIEMPRE los envia (string/boolean concretos desde la relacion Orden.zona).
export type OrdenListItemDTO = OrdenDTO & {
  tiendaNombre: string;
  mensajeroSugeridoId?: string | null;
  mensajeroAsignadoId?: string | null;
  zonaNombre?: string;
  zonaEsGam?: boolean;
};

export type CrearOrdenResult = { status: "ok"; orden: OrdenDTO } | ActionError;
export type ObtenerOrdenResult = { status: "ok"; orden: OrdenDTO } | ActionError;
export type ListarOrdenesResult =
  | { status: "ok"; items: OrdenListItemDTO[]; page: number; pageSize: number; total: number }
  | ActionError;
export type ActualizarOrdenResult = { status: "ok"; orden: OrdenDTO } | ActionError;
export type BorrarOrdenResult = { status: "ok" } | ActionError;
