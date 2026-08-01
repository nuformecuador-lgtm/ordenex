import { z } from "zod";
import { plantillasConfig } from "@/lib/config/plantillas";
import type {
  PlantillaListItem,
  PlantillaPublica,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

// Feature 107 — zod en el borde (patron lib/types/usuario.ts, `.strict()`).

// R8/R9/R11: crear con nombre y cuerpo no vacios. El cliente NO envia `variables`: el
// service las DERIVA del cuerpo (R15). La validacion de llaves malformadas (R16) es de
// dominio y se hace en el service con `validarCuerpo` (validation_error sobre `cuerpo`).
export const crearPlantillaSchema = z
  .object({
    nombre: z.string().min(1),
    cuerpo: z.string().min(1),
  })
  .strict();
export type CrearPlantillaInput = z.infer<typeof crearPlantillaSchema>;

// R20/R22: edicion parcial de nombre y/o cuerpo. `.strict()` rechaza cualquier otro
// campo (incluye un intento del cliente de enviar `variables` o `estado`). Si el cuerpo
// cambia, el service recalcula `variables`.
export const actualizarPlantillaSchema = crearPlantillaSchema.partial().strict();
export type ActualizarPlantillaInput = z.infer<typeof actualizarPlantillaSchema>;

// R24/R25: el front SOLO desactiva. `z.literal("inactivo")` es lo que rechaza CUALQUIER
// otro destino (`activo`/`pending`/`refused`). ACTIVAR no existe en este alcance.
export const cambiarEstadoPlantillaSchema = z
  .object({
    estado: z.literal("inactivo"),
  })
  .strict();
export type CambiarEstadoPlantillaInput = z.infer<typeof cambiarEstadoPlantillaSchema>;

// R7: parametros del listado. `pageSize` acotado a MAX_PAGE_SIZE via clamp; nunca se
// expone una consulta sin limite.
export const listarPlantillasSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(plantillasConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, plantillasConfig.MAX_PAGE_SIZE)),
});
export type ListarPlantillasInput = z.infer<typeof listarPlantillasSchema>;

// Feature 170 (T B.1) — entrada del modo SIN paginacion (descarga del dataset completo).
// Derivada del schema del listado quitando `page`/`pageSize` (molde: la 151 con
// `listarOrdenesCompletoSchema`), de modo que el modo completo no pueda aceptar una
// entrada que el listado paginado rechazaria. `.strict()`: una clave desconocida es
// `validation_error` sin devolver fila alguna (R18).
export const listarPlantillasCompletoSchema = listarPlantillasSchema
  .omit({ page: true, pageSize: true })
  .strict();
export type ListarPlantillasCompletoInput = z.infer<typeof listarPlantillasCompletoSchema>;

// R18: vista previa de un cuerpo arbitrario (no requiere que la plantilla exista).
export const previewPlantillaSchema = z.string().min(1);

// DTO de fila del listado; se alinea al item del repositorio.
export type PlantillaListItemDTO = PlantillaListItem;
export type { PlantillaPublica };

// Resultado discriminado que consume la UI. El conflicto de unicidad identifica el
// campo (R10). Reutiliza la forma de lib/types/usuario.ts.
export type ActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R9/R11/R16/R25
  | { status: "unauthenticated" } // R4
  | { status: "forbidden" } // R5
  | { status: "not_found" } // R21/R26/R29
  | { status: "conflict"; campo: "nombre" }; // R10

export type CrearPlantillaResult = { status: "ok"; plantilla: PlantillaPublica } | ActionError;
export type ListarPlantillasResult =
  | { status: "ok"; items: PlantillaListItemDTO[]; page: number; pageSize: number; total: number }
  | ActionError;
// Feature 170 (T B.2): resultado del modo completo en el BORDE. `limite_excedido` lleva
// SOLO conteos (R27) y ninguna rama de error viaja con filas (R16/R17/R18).
export type ListarPlantillasCompletoResult = ListarCompletoResult<PlantillaListItemDTO>;
export type ObtenerPlantillaResult = { status: "ok"; plantilla: PlantillaPublica } | ActionError;
export type ActualizarPlantillaResult = { status: "ok"; plantilla: PlantillaPublica } | ActionError;
export type CambiarEstadoPlantillaResult =
  | { status: "ok"; plantilla: PlantillaPublica }
  | ActionError;
export type EliminarPlantillaResult = { status: "ok" } | ActionError;
export type PreviewPlantillaResult = { status: "ok"; texto: string } | ActionError;
