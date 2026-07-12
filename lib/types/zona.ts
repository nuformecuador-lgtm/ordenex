import { z } from "zod";
import { zonasConfig } from "@/lib/config/zonas";

// Feature 24 (redefinida). Zod en el borde. Montos >= 0 (patron tarifa.ts).
const montoSchema = z.number().nonnegative();
const nombreSchema = z.string().min(1);
const idSchema = z.string().min(1);

// Elemento de tarifa_zona_mensajero en el input de crear/actualizar. vehiculoId
// opcional: su obligatoriedad depende de cobroVehiculo (ver reglas abajo).
export const tarifaZonaMensajeroInputSchema = z
  .object({
    cobroEntregado: montoSchema,
    cobroRechazado: montoSchema,
    vehiculoId: idSchema.optional(),
  })
  .strict();
export type TarifaZonaMensajeroInput = z.infer<typeof tarifaZonaMensajeroInputSchema>;

// Campos de una zona: datos propios + distritos (N:M) + tarifas por mensajero.
const zonaFields = {
  nombre: nombreSchema,
  cobroVehiculo: z.boolean(),
  // feature 54: flag de zona central (renombrado del viejo esGam). default lo hace
  // opcional en el payload de crear/actualizar.
  esCentral: z.boolean().default(false),
  // distritoIds: conjunto de distritos que componen la zona (N:M). Al menos uno.
  distritoIds: z.array(idSchema).min(1),
  // tarifas: filas de tarifa_zona_mensajero. Su cardinalidad/forma depende de
  // cobroVehiculo (regla en applyTarifaRules). Default [] para poder omitirlo.
  tarifas: z.array(tarifaZonaMensajeroInputSchema).default([]),
};

// Regla condicional cobroVehiculo <-> tarifas:
// - cobroVehiculo=true: >= 1 tarifa, TODAS con vehiculoId, sin vehiculos repetidos.
// - cobroVehiculo=false: a lo sumo 1 tarifa (la "por defecto" de la zona), SIN vehiculoId.
function applyTarifaRules(
  data: { cobroVehiculo: boolean; tarifas: TarifaZonaMensajeroInput[] },
  ctx: z.RefinementCtx,
): void {
  if (data.cobroVehiculo) {
    if (data.tarifas.length < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["tarifas"],
        message: "con cobroVehiculo=true se requiere al menos una tarifa",
      });
    }
    const vistos = new Set<string>();
    data.tarifas.forEach((t, i) => {
      if (t.vehiculoId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["tarifas", i, "vehiculoId"],
          message: "vehiculoId es obligatorio con cobroVehiculo=true",
        });
        return;
      }
      if (vistos.has(t.vehiculoId)) {
        ctx.addIssue({
          code: "custom",
          path: ["tarifas", i, "vehiculoId"],
          message: "vehiculoId repetido: una sola tarifa por vehiculo",
        });
      }
      vistos.add(t.vehiculoId);
    });
  } else {
    if (data.tarifas.length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["tarifas"],
        message: "con cobroVehiculo=false se permite a lo sumo una tarifa",
      });
    }
    data.tarifas.forEach((t, i) => {
      if (t.vehiculoId !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["tarifas", i, "vehiculoId"],
          message: "no se permite vehiculoId con cobroVehiculo=false",
        });
      }
    });
  }
}

// Crear: strict rechaza campos desconocidos; superRefine aplica la regla condicional.
export const crearZonaSchema = z.object(zonaFields).strict().superRefine(applyTarifaRules);
export type CrearZonaInput = z.infer<typeof crearZonaSchema>;

// Actualizar: mismo payload que crear (reemplazo completo de datos + N:M + tarifas).
// El `id` viaja aparte en la Server Action.
export const actualizarZonaSchema = crearZonaSchema;
export type ActualizarZonaInput = z.infer<typeof actualizarZonaSchema>;

// Listado: paginacion + include opcional acotado a ["tarifas"].
export const listarZonasSchema = z
  .object({
    page: z.number().int().positive().default(1),
    pageSize: z
      .number()
      .int()
      .positive()
      .default(zonasConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, zonasConfig.MAX_PAGE_SIZE)),
    include: z.array(z.enum(["tarifas"])).optional(),
  })
  .strict();
export type ListarZonasInput = z.infer<typeof listarZonasSchema>;

// --- DTOs expuestos por las Server Actions ---

export interface TarifaZonaMensajeroDTO {
  id: string;
  cobroEntregado: number;
  cobroRechazado: number;
  vehiculoId: string | null;
}

export interface ZonaDTO {
  id: string;
  nombre: string;
  cobroVehiculo: boolean;
  distritosCount: number;
  esCentral: boolean; // feature 54: flag de zona central (antes esGam)
  // Presente en crear/actualizar/obtener; en listar solo si include incluye "tarifas".
  tarifas?: TarifaZonaMensajeroDTO[];
}

// Feature 24/R14: DTOs del catalogo geografico global (los usa GeoRepository/
// IGeoRepository). Reintroducidos en feature 54 (reconciliacion PR #40).
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

// --- Arbol de zonas indexado por nombre normalizado (get) ---
// Cada nivel es un objeto cuya clave es el nombre normalizado (minuscula, sin
// acentos); el valor lleva el id, el `value` (nombre original) y sus hijos.
export interface ArbolDistritoNode {
  id: string;
  value: string;
}
export interface ArbolCantonNode {
  id: string;
  value: string;
  distritos: Record<string, ArbolDistritoNode>;
}
export interface ArbolZonaNode {
  id: string;
  value: string;
  cantones: Record<string, ArbolCantonNode>;
}
export type ArbolZonas = Record<string, ArbolZonaNode>;

// --- Resultados discriminados ---
export type ZonaActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" }; // borrar una zona referenciada por provincia/orden/tarifas

export type CrearZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ObtenerZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ActualizarZonaResult = { status: "ok"; zona: ZonaDTO } | ZonaActionError;
export type ListarZonasResult =
  | { status: "ok"; items: ZonaDTO[]; page: number; pageSize: number; total: number }
  | ZonaActionError;
export type BorrarZonaResult = { status: "ok" } | ZonaActionError;
export type ArbolZonasResult = { status: "ok"; arbol: ArbolZonas } | ZonaActionError;

// Feature 55/R10: resultados de las Server Actions del catalogo geografico. Reusan
// el shape ZonaActionError (superset: geo solo produce validation_error/
// unauthenticated/forbidden) para no duplicar el manejo tipado de errores.
export type GeoActionError = ZonaActionError;
export type ListarProvinciasResult =
  | { status: "ok"; items: ProvinciaLightDTO[] }
  | GeoActionError;
export type ListarCantonesResult =
  | { status: "ok"; items: CantonLightDTO[] }
  | GeoActionError;
export type ListarDistritosResult =
  | { status: "ok"; items: DistritoCatalogoDTO[] }
  | GeoActionError;
