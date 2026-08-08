import { z } from "zod";
import { cierreConfig } from "@/lib/config/cierre";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import { paginaInputSchema } from "@/lib/types/pagina-input";
import type {
  CierreBodegaResumen,
  CierreBodegaResumenLite,
  ListarConsolidacionServiceResult,
  SolicitarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierreBodegaService";
import type {
  ListarCierresBodegaAdminServiceResult,
  CierreBodegaDetalleServiceResult,
  AprobarCierreBodegaServiceResult,
  RechazarCierreBodegaServiceResult,
} from "@/lib/interfaces/services/ICierresBodegaAdminService";

// Feature 40 — schemas zod del borde de las Server Actions "Cierre de bodega" + los
// *Result de action (resultado de dominio del service + `unauthenticated` que resuelve
// el borde, patron lib/types/cierres-admin.ts).

// R11/R16/R17: identifica el cierre de bodega a ver/aprobar/rechazar. `uuid` casa el
// @default(uuid()) de cierre_bodega; un id mal formado -> VALIDATION_ERROR en el borde.
export const cierreBodegaIdSchema = z.object({
  cierreBodegaId: z.string().uuid(),
});

export const aprobarCierreBodegaSchema = cierreBodegaIdSchema;

// R17: el motivo de rechazo es OBLIGATORIO y no vacio. `.trim().min(1)` rechaza el
// string en blanco (defensa de borde; el service lo re-valida).
export const rechazarCierreBodegaSchema = z.object({
  cierreBodegaId: z.string().uuid(),
  motivo: z.string().trim().min(1),
});

export type CierreBodegaIdInput = z.infer<typeof cierreBodegaIdSchema>;
export type RechazarCierreBodegaInput = z.infer<typeof rechazarCierreBodegaSchema>;

/**
 * Feature 170 — FASE 2 (T I.1 + T J.1, R40) — entrada de los TRES listados paginados de
 * `cierre_bodega`: el historico del maestro (cierres resueltos), la COLA de pendientes del
 * maestro (T J.1) y los cierres solicitados por la zona del adminSatelite. Ninguno tiene
 * filtros (design §11.3) y ninguno acepta su alcance por la peticion: el rol y la zona salen
 * del actor.
 *
 * Los tres COMPARTEN schema porque comparten dominio, tabla y config; lo que los distingue es
 * el metodo del servicio al que llega el input, no su forma.
 *
 * `.strict()` para que una clave colada —`zonaId`, la que abriria el historico de otra
 * bodega— muera en el BORDE con `validation_error` y no en un servicio que la ignoraria en
 * silencio. Tamano de pagina desde `cierreBodegaConfig` (T H.1), recortado a `MAX_PAGE_SIZE`.
 */
export const listarCierresBodegaPaginadoSchema = paginaInputSchema(cierreBodegaConfig);

export type ListarCierresBodegaPaginadoInput = z.infer<typeof listarCierresBodegaPaginadoSchema>;

/**
 * Feature 170 — FASE 2 (T J.1, R40) — entrada de la COLA de cierre_dia CONSOLIDABLES.
 *
 * Schema propio y config propia: sus filas son `cierre_dia`, no `cierre_bodega`, y
 * `cierreConfig` es el dominio que T H.1 declaro para «la cola a consolidar». Usar aqui
 * `cierreBodegaConfig` haria que ajustar el tamano de pagina de los cierres de bodega moviera
 * tambien el de una tabla de cierres del dia.
 */
export const listarConsolidablesSchema = paginaInputSchema(cierreConfig);

export type ListarConsolidablesInput = z.infer<typeof listarConsolidablesSchema>;

/**
 * Feature 184 — Tanda B (R17) — entrada de los DOS conjuntos de esta tanda: el de «Cierres de
 * bodega solicitados» y el de «Cierres del dia a consolidar».
 *
 * Se DERIVAN del schema de su pagina quitando `page`/`pageSize`, igual que los `…CompletoSchema`
 * de la 170: asi los dos caminos —la tabla y el archivo— no pueden entender cosas distintas por
 * «entrada». Como ninguno de los dos listados tiene filtros, lo que queda es una lista blanca de
 * CERO claves, que es exactamente lo correcto: la zona sale del actor y nunca de la peticion, y
 * un `zonaId` colado —el que abriria el dinero de la bodega vecina— muere aqui con
 * `validation_error` sin llegar al servicio (R4/R17).
 *
 * Son dos constantes y no una, aunque hoy su forma coincida, por el mismo motivo por el que sus
 * hermanas paginadas son dos: si manana uno de los dos listados gana un filtro, lo gana en su
 * schema de pagina y lo hereda AQUI, sin arrastrar al otro.
 *
 * `.strict()` se reescribe aunque `.omit()` lo herede: la barrera es de ESTOS listados y no debe
 * depender de que el schema base nunca se afloje.
 */
export const listarCierresBodegaSolicitadosCompletoSchema = listarCierresBodegaPaginadoSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarCierresBodegaSolicitadosCompletoInput = z.infer<
  typeof listarCierresBodegaSolicitadosCompletoSchema
>;

export const listarConsolidablesCompletoSchema = listarConsolidablesSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarConsolidablesCompletoInput = z.infer<typeof listarConsolidablesCompletoSchema>;

/**
 * Feature 184 — Tanda E (R17) — entrada de los DOS conjuntos del ADMIN: el de «Cierres de bodega
 * pendientes» (listado 4) y el de «Cierres de bodega resueltos» (listado 5).
 *
 * Se DERIVAN del schema de su pagina quitando `page`/`pageSize`, igual que los de la tanda B: asi
 * los dos caminos —la tabla y el archivo— no pueden entender cosas distintas por «entrada». Como
 * ninguno de los dos listados tiene filtros, lo que queda es una lista blanca de CERO claves, y
 * eso es exactamente lo correcto: el alcance de estos dos es el ROL (acceso total, toda la
 * operacion), lo decide el servicio desde la sesion y no hay nada que la peticion pueda decir al
 * respecto. Un `zonaId` o un `estado` colados mueren aqui con `validation_error` sin llegar al
 * servicio (R4/R17).
 *
 * Son dos constantes y no una, aunque hoy su forma coincida y aunque compartan schema de pagina:
 * el nombre es lo unico que dice cual de las dos mitades se pide, y si manana una de ellas gana
 * un filtro lo hereda AQUI sin arrastrar a la otra.
 *
 * `.strict()` se reescribe aunque `.omit()` lo herede: la barrera es de ESTOS listados y no debe
 * depender de que el schema base nunca se afloje.
 */
export const listarPendientesCierresBodegaCompletoSchema = listarCierresBodegaPaginadoSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarPendientesCierresBodegaCompletoInput = z.infer<
  typeof listarPendientesCierresBodegaCompletoSchema
>;

export const listarHistoricoCierresBodegaCompletoSchema = listarCierresBodegaPaginadoSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarHistoricoCierresBodegaCompletoInput = z.infer<
  typeof listarHistoricoCierresBodegaCompletoSchema
>;

/** Errores de BORDE de los listados de este modulo (dominio + los dos que resuelve la action). */
export type CierreBodegaListadoError =
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };

// Feature 170 (T I.1, R41): el contrato comun aplicado a los dos listados del dominio.
export type ListarHistoricoCierresBodegaResult = ListarPaginadoResult<
  CierreBodegaResumen,
  CierreBodegaListadoError
>;
export type ListarCierresBodegaSolicitadosResult = ListarPaginadoResult<
  CierreBodegaResumen,
  CierreBodegaListadoError
>;

// Feature 170 (T J.1, R41/R42): la COLA de cierres de bodega pendientes. Su `total` sustituye
// al `({pendientes.length})` de la cabecera.
export type ListarPendientesCierresBodegaResult = ListarPaginadoResult<
  CierreBodegaResumen,
  CierreBodegaListadoError
>;

// Feature 170 (T J.1, R41/R42): la COLA de cierre_dia consolidables. Fila distinta
// (`CierreBodegaResumenLite`, un cierre del dia) y por eso alias propio, no un rename.
export type ListarConsolidablesResult = ListarPaginadoResult<
  CierreBodegaResumenLite,
  CierreBodegaListadoError
>;

/**
 * Feature 184 — Tanda B (R6/R7) — los dos conjuntos tal como los recibe el cliente.
 *
 * Union de error ANCHO (`ActionError`, dentro de `ListarCompletoResult`) y no el estrecho de la
 * pagina: quien los consume es `filasDesdeResultado`, el adaptador comun de la descarga, que
 * redacta el mensaje de CUALQUIER error de borde en un solo sitio. `limite_excedido` lleva SOLO
 * conteos, jamas filas ni un conjunto truncado (R6).
 */
export type ListarCierresBodegaSolicitadosCompletoResult =
  ListarCompletoResult<CierreBodegaResumen>;
export type ListarConsolidablesCompletoResult = ListarCompletoResult<CierreBodegaResumenLite>;

/**
 * Feature 184 — Tanda E (R6/R7) — los dos conjuntos del ADMIN tal como los recibe el cliente.
 *
 * Union de error ANCHO por el mismo motivo que los de la tanda B: quien los consume es
 * `filasDesdeResultado`, el adaptador comun de la descarga, que redacta el mensaje de CUALQUIER
 * error de borde en un solo sitio. `limite_excedido` lleva SOLO conteos, jamas filas ni un
 * conjunto truncado (R6).
 */
export type ListarPendientesCierresBodegaCompletoResult =
  ListarCompletoResult<CierreBodegaResumen>;
export type ListarHistoricoCierresBodegaCompletoResult =
  ListarCompletoResult<CierreBodegaResumen>;

// Resultados de las Server Actions: resultado de dominio del service +
// `unauthenticated` (sin sesion, lo resuelve el borde). Para ver-detalle/aprobar se
// agrega `validation_error` (el borde zod puede rechazar el id); rechazar ya lo trae
// en su ServiceResult.
export type ListarConsolidacionResult =
  | ListarConsolidacionServiceResult
  | { status: "unauthenticated" };
export type SolicitarCierreBodegaResult =
  | SolicitarCierreBodegaServiceResult
  | { status: "unauthenticated" };
export type ListarCierresBodegaAdminResult =
  | ListarCierresBodegaAdminServiceResult
  | { status: "unauthenticated" };
export type VerCierreBodegaDetalleResult =
  | CierreBodegaDetalleServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type AprobarCierreBodegaResult =
  | AprobarCierreBodegaServiceResult
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
export type RechazarCierreBodegaResult =
  | RechazarCierreBodegaServiceResult
  | { status: "unauthenticated" };
