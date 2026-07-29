import { z } from "zod";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { TarifaDTO } from "@/lib/types/tarifa";

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

// Feature 63/B1 (R6/R7/R8/R11): filtro generico `filter` del listado. WHITELIST
// v1 = solo `status_id` (clave PUBLICA que se mapea a la FK `estatusId` en el
// service, ver FILTER_TO_COLUMN). `.strict()` es la clave de R7/R11: una clave
// fuera de la whitelist produce un ZodError (validation_error) ANTES de construir
// el `where`, de modo que ningun nombre de columna arbitrario llega a Prisma. Se
// mantiene deliberadamente estrecha (un solo campo) y se amplia por demanda.
export const ORDEN_FILTER_FIELDS = ["status_id"] as const;
export type OrdenFilterField = (typeof ORDEN_FILTER_FIELDS)[number];

// `status_id` acepta UN id (contrato previo, sin regresion) o una LISTA de ids
// (filtro multi-estado del listado unico de `/ordenes`, que sustituyo a las tabs
// por estado). La lista se traduce a `IN (...)` en el repositorio; una lista VACIA
// no es valida (equivaldria a "ningun estado": el front omite el filtro en su lugar).
export const ordenFilterSchema = z
  .object({
    status_id: z
      .union([z.string().min(1), z.array(z.string().min(1)).nonempty()])
      .optional(),
  })
  .strict();
export type OrdenFilterInput = z.infer<typeof ordenFilterSchema>;

// R30/R31/R32/R33: parametros del listado. page/pageSize enteros positivos (R32);
// pageSize se acota a MAX_PAGE_SIZE (R33) via clamp. sortBy/sortDir por lista blanca.
// Feature 63/R6/R10: suma `filter` opcional (whitelist arriba); ausente u objeto
// vacio = comportamiento previo intacto, y el `estatusId` escalar preexistente se
// conserva (R10, sin regresion del contrato de 6/7/8).
export const listarOrdenesSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(ordenesConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, ordenesConfig.MAX_PAGE_SIZE)),
  estatusId: z.string().min(1).optional(),
  filter: ordenFilterSchema.optional(),
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
  // Feature 101/R9: flag de reasignacion prioritaria (orden liberada por SLA que espera
  // reasignacion en la bodega dueña). Opcional (`?`) por el patron aditivo ya usado por
  // `mensajeroAsignadoId?`/`zonaEsGam?`: no rompe mocks/fixtures que construyen OrdenDTO sin
  // el; `toDTO` SIEMPRE lo envia (boolean desde la columna orden). Alimenta el sort
  // prioridad-first (R6) y el resalte de fila (R8) del listado de reasignacion.
  prioridad?: boolean;
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
// Feature 17/R20: agrega `mensajeroAsignadoId` (solo el listado, para que las
// secciones por_recoger/en_bodega_central muestren el mensajero asignado). Cambio aditivo:
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
  mensajeroAsignadoId?: string | null;
  zonaNombre?: string;
  zonaEsGam?: boolean;
  // Escalares de la orden que el listado muestra en columnas de dinero/detalle
  // (dirección, valor de cobro COD y si la orden cobra comisión). Ya vienen en la
  // fila (el `include` del listado no restringe escalares); se exponen aquí de
  // forma ADITIVA para las columnas de flete+IVA/fulfillment/comisión. Opcionales
  // (`?`) por el mismo motivo que los campos previos: no romper mocks/fixtures de
  // UI que construyen OrdenListItemDTO sin ellos. `montoCobrar` Decimal -> number.
  direccion?: string | null;
  montoCobrar?: number | null;
  cobraComision?: boolean;
  // Fecha (`YYYY-MM-DD`) para la que quedo reprogramada la orden: el dia en que el
  // cron de liberacion (feature 46) la desbloquea. Sale de la gestion VIGENTE
  // (`gestion_orden.fecha_reprogramacion` de la mas reciente no anulada), no de la
  // orden: la relacion es 1:N (una orden acumula gestiones entre reintentos). Ya
  // serializada por el repo (patron CierreDiaRepository), no `Date`: el DataTable
  // descarta objetos al renderizar. `null` = la orden no tiene gestion de
  // reprogramacion vigente; en las tabs que no son "reprogramada" lo normal es null.
  fechaReprogramacion?: string | null;
  /**
   * Feature 160 (R11/R14/R16): intentos de entrega VIGENTES de la orden, derivados del
   * historial EN EL MISMO LOTE de la lectura (criterio unico de `OrdenHistorialService`,
   * design §1.1: destino `devuelta`, o destino `reprogramada` con familia `gestion`).
   *
   * Opcional (`?`) por el patron aditivo del repo (`zonaEsGam?`/`prioridad?`): no rompe los
   * fixtures ni los mocks que construyen el DTO sin el. El servicio SIEMPRE lo envia, `0`
   * incluido (R14): el `0` es un valor CONOCIDO, no un dato ausente, y la superficie lo pinta
   * con `?? 0` — el dato SIEMPRE se muestra (R19). NO es ordenable ni filtrable server-side
   * (R29): es derivado en tiempo de lectura, no una columna de `orden`.
   */
  intentosEntrega?: number;
  // Datos de las relaciones DIRECTAS (FK) de la orden, resueltas via joins
  // (Prisma `include`) en el mismo query del listado. Aditivo: la UI existente
  // que solo usa los escalares/`*Nombre` sigue funcionando. La relacion `tienda`
  // trae ademas su tarifa activa (relacion Usuario.tarifasTienda, 1:N por-tienda,
  // el include se acota a la activa/no borrada). Cada relacion es nullable porque
  // el `include` puede no resolver (FK opcional o dato ausente).
  relaciones?: OrdenListItemRelaciones;
};

// Referencia liviana (id + nombre) para relaciones a catalogos/usuarios.
export interface RefNombre {
  id: string;
  nombre: string;
}

// Tienda de la orden (Usuario con rol adminTienda) con su tarifa activa anidada
// (relacion Usuario.tarifasTienda, 1:N por-tienda). `tarifa` es la ACTIVA (o
// `null` si la tienda aun no tiene tarifa activa). NUNCA expone campos sensibles
// del usuario (passwordHash, etc.): solo datos de contacto e identidad legibles.
export interface OrdenTiendaRef {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  tarifa: TarifaDTO | null;
}

// Relaciones directas (FK) de la orden, expuestas por el listado.
export interface OrdenListItemRelaciones {
  estatus: { id: string; value: string } | null;
  tienda: OrdenTiendaRef | null;
  zona: { id: string; nombre: string; esCentral: boolean } | null;
  provincia: RefNombre | null;
  canton: RefNombre | null;
  distrito: RefNombre | null;
  mensajeroAsignado: RefNombre | null;
}

export type CrearOrdenResult = { status: "ok"; orden: OrdenDTO } | ActionError;
export type ObtenerOrdenResult = { status: "ok"; orden: OrdenDTO } | ActionError;
export type ListarOrdenesResult =
  | { status: "ok"; items: OrdenListItemDTO[]; page: number; pageSize: number; total: number }
  | ActionError;
export type ActualizarOrdenResult = { status: "ok"; orden: OrdenDTO } | ActionError;
export type BorrarOrdenResult = { status: "ok" } | ActionError;
