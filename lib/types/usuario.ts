import { z } from "zod";
import { usuariosConfig } from "@/lib/config/usuarios";
import { strongPasswordSchema } from "@/lib/types/password-policy";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type {
  RolItem,
  UsuarioListItem,
  UsuarioPublico,
} from "@/lib/interfaces/repositories/IUserRepository";

// Feature 25. Zod en el borde (R5/R6). NO se duplica la politica de contrasena:
// se importa `strongPasswordSchema` de la feature 20 (Decision 3).

// R15: columnas ordenables (lista blanca). Por defecto `createdAt`.
export const USUARIO_SORT_FIELDS = ["createdAt", "nombre", "email", "estado"] as const;
export type UsuarioSortField = (typeof USUARIO_SORT_FIELDS)[number];

// Campos base comunes a la creacion (cualquier rol, set base — Decision 2).
const baseCrearFields = {
  nombre: z.string().min(1),
  email: z.string().email(),
  telefono: z.string().min(1),
  tipoIdentificacionId: z.string().min(1),
  cedula: z.string().min(1),
  rolId: z.string().min(1),
  // Feature 27/R10: flag de fulfillment de tienda, booleano opcional en el borde.
  // El default (false) y la invariante por rol (R4a) los aplica el service.
  fulfillment: z.boolean().optional(),
  // Feature 24/R27/R28: zona del usuario. Solo mensajero/adminSatelite la
  // conservan; el service valida existencia y aplica la invariante por rol.
  zonaId: z.string().min(1).nullable().optional(),
};

// R5/R6/R30/R31/R32: creacion con el bloque de contrasena como union
// discriminada por `passwordMode`:
//  - "manual": exige `password` que cumpla `strongPasswordSchema` (R31).
//  - "generate": sin `password`; el service la genera (R32).
// `strict` en cada rama rechaza campos desconocidos.
export const crearUsuarioSchema = z.discriminatedUnion("passwordMode", [
  z
    .object({
      ...baseCrearFields,
      passwordMode: z.literal("manual"),
      password: strongPasswordSchema,
    })
    .strict(),
  z
    .object({
      ...baseCrearFields,
      passwordMode: z.literal("generate"),
    })
    .strict(),
]);
export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;

// R16: edicion solo de campos editables (nombre/telefono/rolId/
// tipoIdentificacionId). NUNCA email/cedula/password. `strict` rechaza cualquier
// otro campo (incluye intentos de tocar email/cedula/password).
export const actualizarUsuarioSchema = z
  .object({
    nombre: z.string().min(1),
    telefono: z.string().min(1),
    rolId: z.string().min(1),
    tipoIdentificacionId: z.string().min(1),
    // Feature 27/R13: fulfillment editable; el service recalcula la invariante
    // R4a segun el rol resultante. `.strict()` sigue rechazando email/cedula/password.
    fulfillment: z.boolean(),
    // Feature 24/R27/R28: zona editable (null la libera). El service valida
    // existencia y aplica la invariante por rol (solo mensajero/adminSatelite).
    zonaId: z.string().min(1).nullable(),
  })
  .partial()
  .strict();
export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;

// R23: destino del cambio de estado acotado a activo|inactivo (baja logica).
// `bloqueado`/`pendiente` no los usa este modulo (Decision 6).
export const cambiarEstadoUsuarioSchema = z
  .object({
    estado: z.enum(["activo", "inactivo"]),
  })
  .strict();
export type CambiarEstadoUsuarioInput = z.infer<typeof cambiarEstadoUsuarioSchema>;

// R13/R15: parametros del listado. `pageSize` acotado a MAX_PAGE_SIZE via clamp;
// `sortBy`/`sortDir` por lista blanca con defaults.
export const listarUsuariosSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(usuariosConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, usuariosConfig.MAX_PAGE_SIZE)),
  sortBy: z.enum(USUARIO_SORT_FIELDS).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type ListarUsuariosInput = z.infer<typeof listarUsuariosSchema>;

// Feature 170 (T B.1) — entrada del modo SIN paginacion (descarga del dataset completo).
// Se DERIVA del schema del listado quitando `page`/`pageSize`, igual que hizo la 151 con
// `listarOrdenesCompletoSchema`: reusarlo es lo que garantiza que el modo completo no
// acepte una entrada que el listado paginado rechazaria, y que `sortBy`/`sortDir`
// conserven sus MISMOS defaults (createdAt/desc) — sin eso, el archivo saldria en un
// orden distinto del de la pantalla (R11).
//
// `.strict()` se anade AQUI y no en el schema del listado (que no lo tiene y cuyo
// contrato no toca esta feature): una clave desconocida en la peticion del dataset
// completo es `validation_error` sin devolver fila alguna (R18).
export const listarUsuariosCompletoSchema = listarUsuariosSchema
  .omit({ page: true, pageSize: true })
  .strict();
export type ListarUsuariosCompletoInput = z.infer<typeof listarUsuariosCompletoSchema>;

// R14: DTO de fila del listado; se alinea al item del repositorio (nunca hash).
export type UsuarioListItemDTO = UsuarioListItem;

// R26/R28: resultado discriminado y tipado que consume la UI. El conflicto de
// unicidad identifica el campo (R10/R11).
export type ActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R5/R6/R23
  | { status: "unauthenticated" } // R2
  | { status: "forbidden" } // R3/R4
  | { status: "not_found" } // R17/R22
  | { status: "conflict"; campo: "email" | "cedula" }; // R10/R11

export type CrearUsuarioResult =
  | { status: "ok"; usuario: UsuarioPublico; generatedPassword?: string } // R12/R33
  | ActionError;
export type ListarUsuariosResult =
  | { status: "ok"; items: UsuarioListItemDTO[]; page: number; pageSize: number; total: number }
  | ActionError;
// Feature 170 (T B.2): resultado del modo completo en el BORDE. `limite_excedido` lleva
// SOLO conteos (sin PII) y NUNCA filas (R27); el resto de fallos son `ActionError` y
// tampoco viajan con filas (R16/R17/R18).
export type ListarUsuariosCompletoResult = ListarCompletoResult<UsuarioListItemDTO>;
export type ObtenerUsuarioResult = { status: "ok"; usuario: UsuarioPublico } | ActionError;
export type ActualizarUsuarioResult = { status: "ok"; usuario: UsuarioPublico } | ActionError;
export type CambiarEstadoUsuarioResult = { status: "ok"; usuario: UsuarioPublico } | ActionError;
export type ListarTiposIdentificacionResult =
  | { status: "ok"; tipos: { id: string; value: string }[] }
  | ActionError;
export type ListarRolesResult = { status: "ok"; roles: RolItem[] } | ActionError;
