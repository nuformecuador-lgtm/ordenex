import { z } from "zod";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { TarifaDTO } from "@/lib/types/tarifa";

// Campos ordenables permitidos (lista blanca, evita inyeccion de columnas; R31).
export const SORT_FIELDS = ["created_at", "num_guia", "num_remision"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export const SORT_DIRS = ["asc", "desc"] as const;
export type SortDir = (typeof SORT_DIRS)[number];

// R25/R26: validacion de creacion en el borde. zona/provincia/canton obligatorios
// (R12); distrito/notas/tienda opcionales. peso numerico estrictamente > 0
// (R13/R26). num_remision provisto por el usuario, no vacio (R9).
//
// FEATURE 155/R5 — la entrada de creacion DEJA de exponer un estatus inicial. `estatusId`
// se retiro: el estado en que nace la orden lo decide `resolverDestinoCreacion` a partir del
// flag `fulfillment` de la tienda dueña, y NADA de la peticion puede alterarlo. El schema no
// es `.strict()` a proposito, asi que una entrada legada que siga mandando `estatusId` se
// ignora en silencio en vez de romper — pero no cambia donde nace la orden.
export const crearOrdenSchema = z.object({
  numRemision: z.string().min(1),
  destinatario: z.string().min(1),
  telefonoDest: z.string().min(1),
  producto: z.string().min(1),
  peso: z.number().positive(),
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
// Feature 144/B1 (R30): la whitelist pasa de 1 a 9 claves — los cinco catalogos
// (zona/tienda/provincia/canton/distrito), mas las TRES claves temporales (atajo de
// antiguedad, fecha desde y fecha hasta). `.strict()` sigue siendo la unica defensa
// que impide que un nombre de columna arbitrario alcance Prisma (R31).
export const ORDEN_FILTER_FIELDS = [
  "status_id",
  "zona_id",
  "tienda_id",
  "provincia_id",
  "canton_id",
  "distrito_id",
  "created_preset",
  "created_desde",
  "created_hasta",
  "reasignables",
] as const;
export type OrdenFilterField = (typeof ORDEN_FILTER_FIELDS)[number];

// Feature 144/R32: todo filtro de catalogo NUEVO es una LISTA NO VACIA de ids no
// vacios. No se admite el escalar (eso es retrocompatibilidad exclusiva de
// `status_id`), ni la lista vacia: una lista vacia significaria "ningun valor" y
// degradaria a "sin filtro" si el repositorio la descartara. Falla cerrado.
const idList = z.array(z.string().min(1)).nonempty();

// Feature 144/R39: fecha CALENDARIO `YYYY-MM-DD` (lo que emite `<input type="date">`).
// El cliente NUNCA manda instantes ni offsets: los bordes temporales se calculan
// server-side (R43), en horario de Costa Rica (lib/utils/fecha-cr.ts).
const fechaCalendario = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado YYYY-MM-DD");

// Feature 144/R38: dominio CERRADO del atajo de antiguedad. Un solo valor (nunca
// una lista): `["7d","30d"]` no tiene interpretacion util y seria ambiguo.
export const CREATED_PRESETS = ["7d", "15d", "30d", "90d"] as const;
export type CreatedPreset = (typeof CREATED_PRESETS)[number];

// `status_id` acepta UN id (contrato previo, sin regresion) o una LISTA de ids
// (filtro multi-estado del listado unico de `/ordenes`, que sustituyo a las tabs
// por estado). La lista se traduce a `IN (...)` en el repositorio; una lista VACIA
// no es valida (equivaldria a "ningun estado": el front omite el filtro en su lugar).
export const ordenFilterSchema = z
  .object({
    status_id: z
      .union([z.string().min(1), z.array(z.string().min(1)).nonempty()])
      .optional(),
    // Feature 144/R30/R32: filtros de catalogo. Zona sale de `orden.zona_id`
    // (valor CONGELADO de la orden), no se deriva del distrito.
    zona_id: idList.optional(),
    tienda_id: idList.optional(),
    provincia_id: idList.optional(),
    canton_id: idList.optional(),
    distrito_id: idList.optional(),
    // Feature 144/R38/R39: tiempo. Atajo (escalar de dominio cerrado) O rango.
    created_preset: z.enum(CREATED_PRESETS).optional(),
    created_desde: fechaCalendario.optional(),
    created_hasta: fechaCalendario.optional(),
    // Filtro REASIGNABLES: ordenes que esperan que alguien les vuelva a poner
    // mensajero. Es un predicado COMPUESTO (prioridad + no reprogramada + sin
    // mensajero asignado), no una columna, y solo sabe ACOTAR: `z.literal(true)`
    // porque "no filtrar" se expresa OMITIENDO la clave, no mandando `false`.
    reasignables: z.literal(true).optional(),
  })
  .strict()
  // R39: rango no invertido. La comparacion lexicografica de `YYYY-MM-DD` es
  // equivalente a la cronologica (formato de ancho fijo, mayor a menor).
  .refine(
    (f) => !(f.created_desde && f.created_hasta) || f.created_desde <= f.created_hasta,
    { path: ["created_hasta"], message: "El rango de fechas esta invertido" },
  )
  // R40: atajo y rango son EXCLUYENTES. La UI ya lo hace inalcanzable (el control
  // vacia uno al elegir el otro); el borde falla CERRADO en vez de inventar una
  // precedencia silenciosa para un cliente que construya el filter a mano.
  .refine((f) => !(f.created_preset && (f.created_desde || f.created_hasta)), {
    path: ["created_preset"],
    message: "Usa el atajo o el rango, no ambos",
  });
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
