import { z } from "zod";
import { ordenesConfig } from "@/lib/config/ordenes";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoResult } from "@/lib/types/listado-paginado";
import type { TarifaDTO, OrigenFlete } from "@/lib/types/tarifa";
import {
  DIRECCIONES_ORDEN,
  esquemaOrdenamiento,
  type DireccionOrden,
} from "@/lib/types/ordenamiento-listado";

// Campos ordenables permitidos (lista blanca, evita inyeccion de columnas; R31).
//
// FICHA 352 — es una union CERRADA de literales, y eso es la mitad del contrato: `sortBy` no
// es «el nombre de una columna» que el cliente elija, es una CLAVE PUBLICA que el repositorio
// traduce por su mapa (`SORT_COLUMN`, en `OrdenRepository`). El schema del listado es ademas
// `.strict()`, asi que un cliente que escriba `orderBy` o `sort` recibe `validation_error` en
// vez de que su clave se ignore en silencio y la tabla siga en el orden por defecto — que es,
// vista desde la pantalla, exactamente la forma de un boton de ordenar que no ordena.
export const SORT_FIELDS = ["created_at", "num_guia", "num_remision"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
// FICHA 352: las direcciones ya no se declaran aqui. Viven en `lib/types/ordenamiento-listado`
// —el contrato que comparten las tablas que se sumen— y esto es un reexport para no tocar a
// los importadores vivos de `SORT_DIRS`/`SortDir`.
export const SORT_DIRS = DIRECCIONES_ORDEN;
export type SortDir = DireccionOrden;

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
    // FICHA 327 (A1, design §8.1) — la direccion entra al schema. Estuvo fuera desde siempre y la
    // 312 la dejo fuera A SABIENDAS; la 327 reabre esa decision (su D1) porque es el error de
    // carga mas caro. Se amplia AQUI, y no con un `.extend()` local en el schema de la
    // correccion, por el mismo motivo por el que la 312 derivo de este objeto: la regla de cada
    // campo de la orden vive en UN sitio.
    //
    // ⚠️ AMPLIAR ESTE SCHEMA NO AMPLIA `OrdenRepository.update`: `toUpdateData()` sigue sin
    // proyectar `direccion` y ningun consumidor vivo la informa. Quien SI la escribe es
    // `corregirDatosCliente`, que comparte con `update` el guard de re-geocodificacion.
    //
    // `min(1)` rechaza la cadena vacia; la de SOLO ESPACIOS la rechaza el servicio al recortarla
    // (`CAMPOS_NO_VACIABLES`), igual que a `destinatario`/`producto`: una sola regla de «vacio».
    direccion: z.string().min(1).optional(),
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
// Feature 169/R1/R19: la whitelist crece en UNA clave, `q` (busqueda de texto libre). No
// se abre: `.strict()` sigue siendo la unica defensa y cualquier otra clave sigue siendo
// `validation_error` antes de tocar la base.
export const ORDEN_FILTER_FIELDS = [
  "status_id",
  "zona_id",
  "tienda_id",
  "provincia_id",
  "canton_id",
  "distrito_id",
  "mensajero_id",
  "created_preset",
  "created_desde",
  "created_hasta",
  "reasignables",
  "q",
  // Pedido humano (2026-08-27): el interruptor de las ELIMINADAS. La whitelist pasa de 12 a 13
  // claves y `.strict()` sigue siendo la unica defensa; quien puede USARLA lo decide el service
  // (solo `maestro`), no este schema.
  "eliminados",
  // FICHA 370: la whitelist pasa de 13 a 14. Parte el listado de la bodega en los dos grupos que
  // quien asigna necesita tratar por separado — las que YA salieron con un mensajero y las que
  // solo tienen la guia generada—. Es la unica clave del conjunto con DOS valores excluyentes
  // (ver `SALIO_A_REPARTO_VALORES`); ausente = no filtra y salen los dos grupos.
  "salio_a_reparto",
] as const;
export type OrdenFilterField = (typeof ORDEN_FILTER_FIELDS)[number];

// Feature 169 (design §4.1) — limites del termino de busqueda. Se EXPORTAN porque el
// minimo lo consume tambien la interfaz: un solo origen del 3, en vez de un 3 en el
// schema y otro en el control de texto que se desincronizan a la primera.
//
// El minimo NO es una preferencia de UX, es de RENDIMIENTO: `pg_trgm` no genera trigramas
// utiles por debajo de 3 caracteres, asi que un termino de 1-2 seria un Seq Scan
// garantizado sobre la tabla mas grande del sistema — dos veces (pagina y conteo).
export const BUSQUEDA_MIN_CHARS = 3;
// El maximo no protege al motor (cuanto mas largo el termino, MAS selectivo y mas barato:
// 3 caracteres generan 1 trigrama, 80 generan 78). Existe para acotar el peso de la clave
// de cache del listado y para que el campo no se use como canal de datos. 80 cubre
// cualquier nombre real de destinatario.
export const BUSQUEDA_MAX_CHARS = 80;

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

/**
 * FICHA 370 — dominio CERRADO de «¿esta orden ya salio a reparto alguna vez?». UNA sola fuente,
 * y por eso se exporta: la barra de filtros declara sus dos opciones desde aqui y no puede
 * ofrecer un valor que el borde vaya a rechazar.
 *
 * ─── POR QUE ESTE NOMBRE, Y NO «INTENTOS» ──────────────────────────────────────────────────
 *
 * La columna «Intentos» del listado ya existe y cuenta OTRA COSA: cierres APROBADOS con un
 * resultado de gestion vigente (`lib/types/orden-historial.ts`), lo que deja fuera a
 * `sin_gestionar` por decision declarada. Medido en produccion: 76 ordenes salieron a reparto,
 * nadie las gestiono y el cron las corto a `sin_gestionar` — su columna «Intentos» dice 0 y sin
 * embargo SI salieron. Si este filtro se llamara «con intentos previos», la fila diria 0 y el
 * filtro diria que si, y nadie sabria a cual creer. Nombrado por lo que de verdad mide —la
 * SALIDA A REPARTO— las dos cifras dejan de contradecirse: son dos datos distintos.
 *
 * ─── POR QUE DOS VALORES Y NO UN BOOLEANO ──────────────────────────────────────────────────
 *
 * En esta barra el `false` de un filtro significa «no filtrar» (`reasignables`, `eliminados`
 * son `z.literal(true)` justamente por eso). Un booleano cuyo `false` significara «nunca salio»
 * seria una trampa esperando a un `?? false`: cualquier valor por defecto encenderia medio
 * filtro en silencio. Con dos valores nombrados, «no filtrar» solo se puede expresar OMITIENDO
 * la clave, y ausente => salen los DOS grupos.
 */
export const SALIO_A_REPARTO_VALORES = ["ya_salio", "nunca_salio"] as const;
export type SalioARepartoValor = (typeof SALIO_A_REPARTO_VALORES)[number];

// `status_id` acepta UN id (contrato previo, sin regresion) o una LISTA de ids
// (filtro multi-estado del listado unico de `/ordenes`, que sustituyo a las tabs
// por estado). La lista se traduce a `IN (...)` en el repositorio; una lista VACIA
// no es valida (equivaldria a "ningun estado": el front omite el filtro en su lugar).
/**
 * Pedido humano (2026-08-19) — el bloque de filtros SIN los dos `refine`, para poder
 * REUSARLO por partes. La barra de `/ordenes` se aplica tambien a la bodega satelite, que
 * toma de aqui geografia, tiempo y buscador (y NO zona ni tienda) en vez de declarar unas
 * claves paralelas que dirian lo mismo con otro nombre. `.strict()` vive aqui: lo hereda
 * todo lo que se derive.
 *
 * Un `refine` convierte el `ZodObject` en otro tipo y con el se pierden `.pick()`/`.omit()`;
 * por eso los dos de abajo se aplican al FINAL, y quien derive de esta base los aplica a su
 * vez con `conRefinesDeCreacion`.
 */
export const ordenFilterBase = z
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
    // Pedido humano (2026-08-25): filtro por MENSAJERO ASIGNADO. Misma forma que el resto
    // de catalogos (lista NO vacia de ids -> `IN (...)`), y por eso hereda R32 y R35 sin
    // ninguna regla propia. La clave publica es `mensajero_id`; la columna
    // (`mensajero_asignado_id`) solo la conoce el mapa del service.
    mensajero_id: idList.optional(),
    // Feature 144/R38/R39: tiempo. Atajo (escalar de dominio cerrado) O rango.
    created_preset: z.enum(CREATED_PRESETS).optional(),
    created_desde: fechaCalendario.optional(),
    created_hasta: fechaCalendario.optional(),
    // Filtro REASIGNABLES: ordenes que esperan una decision de despacho (mensajero o
    // ruteo a satelite). Es un predicado COMPUESTO (en bodega central + sin mensajero
    // asignado), no una columna, y solo sabe ACOTAR: `z.literal(true)` porque "no
    // filtrar" se expresa OMITIENDO la clave, no mandando `false`.
    reasignables: z.literal(true).optional(),
    // Pedido humano (2026-08-27) — ELIMINADAS. `z.literal(true)` por la MISMA razon que
    // `reasignables`: "no filtrar" se expresa OMITIENDO la clave, nunca mandando `false`. Pero
    // al reves que su vecina, esta clave no ACOTA: SUSTITUYE el universo del listado por el de
    // las borradas (`deleted_at IS NOT NULL`). Es la unica del sistema que lo hace, y por eso es
    // la unica que el service ademas AUTORIZA por rol antes de traducirla.
    eliminados: z.literal(true).optional(),
    // FICHA 370 — SALIDA A REPARTO. Como `reasignables`, NO es una columna: es un predicado
    // sobre `orden_historial_estado` («existe una transicion con destino `en_reparto`»), que el
    // repositorio traduce. A diferencia de ella son DOS valores EXCLUYENTES, no un interruptor:
    // `ya_salio` acota a las que ya tuvieron un proceso y `nunca_salio` a las que solo tienen la
    // guia generada. Omitir la clave es lo unico que significa «no filtrar» — y entonces salen
    // los dos grupos, como hasta hoy. El dominio lo cierra `SALIO_A_REPARTO_VALORES`, que es
    // tambien de donde la UI saca sus dos opciones.
    salio_a_reparto: z.enum(SALIO_A_REPARTO_VALORES).optional(),
    // Feature 169/R1/R3/R4 — TERMINO DE BUSQUEDA. Se llama `q` y no `search`/`texto`
    // porque es corto, es la convencion universal de un buscador y NO coincide con ningun
    // nombre de columna: deja claro que no es un filtro de columna (como si lo son
    // `zona_id`…), sino una clave publica que el service traduce, misma familia que
    // `created_preset` y `reasignables`.
    //
    // `.trim()` va ANTES de `.min()` a proposito: `"  a  "` son 1 caracter, no 5 (R3), y
    // lo que llega al service ya viene recortado. Por debajo del minimo o por encima del
    // maximo el borde responde `validation_error` SIN ejecutar ninguna consulta.
    q: z.string().trim().min(BUSQUEDA_MIN_CHARS).max(BUSQUEDA_MAX_CHARS).optional(),
  })
  .strict();

/** Las tres claves temporales, tal como las validan los dos `refine` de abajo. */
type FiltroCreacion = {
  created_preset?: string;
  created_desde?: string;
  created_hasta?: string;
};

/**
 * Las DOS reglas del filtro de tiempo (R39/R40), aplicables a cualquier schema que declare
 * las tres claves. Se extraen para que la barra de la bodega satelite las herede en vez de
 * volver a escribirlas: dos copias de un `refine` es la forma silenciosa de que una superficie
 * acepte lo que la otra rechaza.
 */
export function conRefinesDeCreacion<T extends z.ZodType<FiltroCreacion>>(schema: T) {
  return (
    schema
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
      })
  );
}

export const ordenFilterSchema = conRefinesDeCreacion(ordenFilterBase);
export type OrdenFilterInput = z.infer<typeof ordenFilterSchema>;

// R30/R31/R32/R33: parametros del listado. page/pageSize enteros positivos (R32);
// pageSize se acota a MAX_PAGE_SIZE (R33) via clamp. sortBy/sortDir por lista blanca.
// Feature 63/R6/R10: suma `filter` opcional (whitelist arriba); ausente u objeto
// vacio = comportamiento previo intacto, y el `estatusId` escalar preexistente se
// conserva (R10, sin regresion del contrato de 6/7/8).
//
// FICHA 352 — `.strict()`. Hasta hoy este objeto aceptaba claves desconocidas y las DESCARTABA
// en silencio. Con el ordenamiento llegando desde la cabecera de la tabla eso deja de ser
// inocuo: un cliente que mande `{ sort: "fecha", dir: "asc" }` —los nombres equivocados— no
// recibia ningun error y obtenia el listado en el orden POR DEFECTO. La pantalla enseñaria la
// flecha puesta y las filas sin mover, y nadie tendria a donde mirar. Con `.strict()` el borde
// responde `validation_error`. El `filter` anidado ya era `.strict()` desde la 63; esto lo
// unifica. `listarOrdenesCompletoSchema` lo hereda por el `.omit()` de mas abajo.
export const listarOrdenesSchema = z
  .object({
    page: z.number().int().positive().default(1),
    pageSize: z
      .number()
      .int()
      .positive()
      .default(ordenesConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, ordenesConfig.MAX_PAGE_SIZE)),
    estatusId: z.string().min(1).optional(),
    filter: ordenFilterSchema.optional(),
    // Pedido humano (2026-08-19), INTACTO: el listado va de la orden MÁS NUEVA a la más
    // antigua (`created_at desc`). Derogó el pedido anterior (`asc`, "lo que primero entró se
    // trabaja primero"): lo que se mira a diario es lo que acaba de entrar. Sigue siendo el
    // DEFAULT y la ficha 352 no lo toca — quien pase `sortDir` explícito (la cabecera de la
    // tabla, la API de lectura) es quien cambia el orden, nunca la ausencia del parámetro.
    ...esquemaOrdenamiento(SORT_FIELDS, "created_at", "desc"),
  })
  .strict();
export type ListarOrdenesInput = z.infer<typeof listarOrdenesSchema>;

// Feature 151 (design §4.2) — entrada del modo SIN paginacion (descarga del dataset
// completo). Se DERIVA del schema del listado quitando `page`/`pageSize`: reusarlo es
// lo que da R15 gratis (misma whitelist `.strict()` y los mismos dos `refine` del
// `filter`), y lo que garantiza que el modo completo no acepte una entrada que el
// listado paginado rechazaria. `sortBy`/`sortDir` conservan sus defaults (R17).
export const listarOrdenesCompletoSchema = listarOrdenesSchema.omit({
  page: true,
  pageSize: true,
});
export type ListarOrdenesCompletoInput = z.infer<typeof listarOrdenesCompletoSchema>;

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
  /**
   * Feature 204 — los dos importes DERIVADOS de las columnas "Flete + IVA" y "Comisión +
   * IVA", ya calculados en el servidor con `Prisma.Decimal` y serializados como STRING
   * escala 2 (`costosListadoOrden`, lib/utils/ingreso-ordenex.ts).
   *
   * Son STRING y no `number` por la misma razon que el resto del dinero de esta app: el
   * navegador solo tiene que PINTARLOS. Cuando los derivaba el (los multiplicaba sobre los
   * `number` de `relaciones.tienda.tarifa`), 14 de las 66 ordenes con tarifa activa de la
   * base se veian un centimo desviadas de lo que factura el cierre.
   *
   * SIEMPRE traen un importe, "0.00" incluido: sin tarifa vigente el importe es cero, no
   * "desconocido" (R9), que es lo que la columna ya mostraba. Opcionales (`?`) por el mismo
   * patron aditivo que los campos de arriba: no romper los fixtures de UI que construyen el
   * DTO sin ellos; el repositorio SIEMPRE los envia.
   */
  fleteConIva?: string;
  comisionConIva?: string;
  /**
   * De donde salio el flete de `fleteConIva` (2026-08-25, tarifa especial por distrito).
   *
   * Existe para hacer VISIBLE el caso `especial_sin_pacto`: el distrito esta marcado como
   * zona especial pero la tarifa que le toca no tiene monto pactado, asi que se cobro la
   * tarifa normal. El importe es identico al de una orden corriente, de modo que sin este
   * campo no habria forma de distinguir "cobra la normal porque le toca" de "cobra la normal
   * porque falta configurar el pacto". Opcional por el mismo patron aditivo que sus vecinos;
   * el repositorio SIEMPRE lo envia.
   */
  fleteOrigen?: OrigenFlete;
  // Fecha (`YYYY-MM-DD`) para la que quedo reprogramada la orden: el dia en que el
  // cron de liberacion (feature 46) la desbloquea. Sale de la gestion VIGENTE
  // (`gestion_orden.fecha_reprogramacion` de la mas reciente no anulada), no de la
  // orden: la relacion es 1:N (una orden acumula gestiones entre reintentos). Ya
  // serializada por el repo (patron CierreDiaRepository), no `Date`: el DataTable
  // descarta objetos al renderizar. `null` = la orden no tiene gestion de
  // reprogramacion vigente; en las tabs que no son "reprogramada" lo normal es null.
  fechaReprogramacion?: string | null;
  /**
   * FEATURE 262 (B8, design §7.2) — dia de reparto de la orden, `YYYY-MM-DD` YA SERIALIZADO por el
   * repositorio. `null` = la orden no esta reservada para un dia que aun no ha llegado.
   *
   * PARA QUE: R16 exige que la pantalla de correccion muestre, POR ORDEN, el dia para el que esta
   * marcada hoy («17496963 · hoy está para el 22 de agosto»). Es lo que impide corregir a ciegas un
   * lote mixto.
   *
   * STRING Y NUNCA `Date`, por las dos razones que el propio tipo ya documenta en
   * `fechaReprogramacion`: el `DataTable` de este repo descarta objetos al renderizar, y un
   * `@db.Date` leido por Prisma es la medianoche UTC de esa fecha — formatearlo en el navegador con
   * la hora local devuelve el dia ANTERIOR en media America (R17: ni una fecha se calcula en el
   * cliente). Opcional (`?`) por el patron aditivo del resto del DTO: no rompe los fixtures de UI;
   * el repositorio SIEMPRE lo envia.
   *
   * NO es una columna nueva del listado (limite declarado 2, A7): el dia se ve por orden DENTRO de
   * la pantalla de correccion, que es donde se decide.
   */
  fechaRepartoISO?: string | null;
  /**
   * Feature 160 (R11/R14/R16) + 215 (R6/R20): intentos de entrega de la orden, resueltos EN EL
   * MISMO LOTE de la lectura con el criterio UNICO de `OrdenHistorialService`. Desde la 215 ese
   * criterio es el numero de CIERRES APROBADOS distintos en los que la orden tuvo un resultado
   * de gestion vigente `rechazada`/`devuelta`/`reprogramada`; ya no se deriva de los destinos
   * de las transiciones del historial.
   *
   * Opcional (`?`) por el patron aditivo del repo (`zonaEsGam?`/`prioridad?`): no rompe los
   * fixtures ni los mocks que construyen el DTO sin el. El servicio SIEMPRE lo envia, `0`
   * incluido (R14): el `0` es un valor CONOCIDO, no un dato ausente, y la superficie lo pinta
   * con `?? 0` — el dato SIEMPRE se muestra (R19). NO es ordenable ni filtrable server-side
   * (R29): es derivado en tiempo de lectura, no una columna de `orden`.
   */
  intentosEntrega?: number;
  /**
   * `true` si esta orden SE PUEDE ELIMINAR. Lo resuelve el servidor con el mismo predicado que
   * autoriza el borrado (`esOrdenEliminable`, de `lib/types/order-status-eliminables.ts`), de
   * modo que la pantalla no puede ofrecer un boton que el servidor vaya a rechazar — que es el
   * fallo que este campo existe para impedir, y no un adorno.
   *
   * FICHA 319 (2026-08-28) — se llamaba `sinGestion` y significaba «no registra gestion
   * posterior a su creacion», que era el criterio del 2026-08-27. Ese criterio se retiro (el
   * conteo de transiciones descalificaba una orden solo por haberle impreso la etiqueta: CERO
   * eliminables de 429 vivas en produccion) y paso a mandar la LISTA DE ESTADOS. El nombre cambia
   * con el: dejarlo diciendo `sinGestion` haria que quien lo leyera dedujera una regla que ya no
   * existe.
   *
   * ⭑ PEDIDO HUMANO 2026-09-04 — el criterio vuelve a tener DOS mitades, y el nombre `eliminable`
   * sigue siendo el correcto justamente por eso: dice lo que el campo significa («¿se puede?») y
   * no de que se deduce, asi que sobrevive al cambio de regla. Hoy son la LISTA DE ESTADOS
   * (siete) y CERO INTENTOS DE ENTREGA. Ojo: los intentos NO son las transiciones que la 319
   * retiro — ver la cabecera de `order-status-eliminables.ts`.
   *
   * Solo viaja para el rol que puede borrar (`maestro`); para el resto es `undefined`, porque el
   * dato no alimenta ninguna decision suya. Opcional (`?`) por el patron aditivo del resto del
   * DTO: no rompe los fixtures de UI.
   *
   * `undefined` NO significa "se puede": la UI exige `=== true` para ofrecer el boton (fallo
   * cerrado), y el servidor revalida de todas formas.
   */
  eliminable?: boolean;
  // Datos de las relaciones DIRECTAS (FK) de la orden, resueltas via joins
  // (Prisma `include`) en el mismo query del listado. Aditivo: la UI existente
  // que solo usa los escalares/`*Nombre` sigue funcionando. La `tarifa` anidada en
  // `tienda` NO sale de ese join (feature 274): la resuelve la cascada (tienda, zona)
  // en una query adicional por pagina. Cada relacion es nullable porque el `include`
  // puede no resolver (FK opcional o dato ausente).
  relaciones?: OrdenListItemRelaciones;
};

/**
 * FICHA 349 (2026-09-01) — LA FILA DEL LISTADO «Órdenes de la bodega» DEL `adminSatelite`.
 *
 * ─── EL DEFECTO QUE CIERRA ───────────────────────────────────────────────────────────────
 *
 * Esa pantalla tenia su propia proyeccion: un `select` propio en el repositorio
 * (`WITH_RECEPCION_SATELITE`), su propia interfaz de fila y un mapeo campo a campo hasta el
 * DTO. Tres listas de campos para la MISMA fila de `orden`. Y ya divergieron: `/ordenes`
 * declaraba 19 columnas y la bodega 12. Las siete que faltaban —mensajero, fecha de creacion,
 * tiempo transcurrido, flete, comision, fulfillment y «Liberada el»— no faltaban por una
 * decision de producto: faltaban porque nadie las copio a la segunda lista, y no copiarlas no
 * ponia nada rojo. Mantener la segunda lista y añadirle cinco campos a mano habria repetido
 * exactamente el defecto que la ficha viene a arreglar.
 *
 * ─── POR QUE UNA INTERSECCION Y NO UN TIPO PARALELO ──────────────────────────────────────
 *
 * `Column<OrdenListItemDTO>[]` es asignable a `Column<FilaBodegaSatelite>[]` porque esta fila
 * es un SUBTIPO ESTRICTO de aquella y `render: (row: T) => ReactNode` es contravariante en su
 * parametro bajo `strictFunctionTypes`. Es decir: la pantalla de la bodega puede montar
 * `ordenesColumns` SIN un solo cast, que es lo que pidio el humano («basicamente debe ser el
 * mismo componente»). Un tipo paralelo obligaria a un cast, y el cast es la costura por la que
 * las dos pantallas vuelven a divergir sin que el compilador diga nada. Mismo mecanismo, misma
 * razon y mismo precedente que `OrdenDetalleDia` (feature 260/T0.2, R1/R18).
 *
 * ─── LOS NUEVE CAMPOS PROPIOS ────────────────────────────────────────────────────────────
 *
 * Ninguno es un dato nuevo. Son los que esta pantalla YA leia y que `OrdenListItemDTO` declara
 * OPCIONALES por su patron aditivo (`?`, para no romper fixtures de UI), o que alli viven
 * dentro de `relaciones` en vez de en la raiz —los tres nombres de geografia, que aqui los leen
 * el filtro de canton/distrito y el buscador—. Declararlos obligatorios es lo que impide que
 * una de las tres consultas del modulo deje de enviarlos sin que nada se rompa.
 *
 * ─── LO QUE ESTA FILA **NO** LLEVA, Y NO ES UN OLVIDO ────────────────────────────────────
 *
 * `fleteConIva`, `comisionConIva` y `relaciones.tienda.tarifa` (de donde sale el fulfillment),
 * mas el correo y el telefono de la tienda. La capa de datos los retira con
 * `recortarPorAlcance(fila, "zona")` ANTES de devolverla, de modo que no viajan al navegador ni
 * como `undefined`. Es la decision FIRMADA de la feature 260 (R13/R15/R17), y su motivo esta
 * escrito en `lib/types/recorte-alcance-orden.ts`: `/ordenes` le hace `notFound()` al
 * `adminSatelite`, asi que esas cifras son cosas que su alcance nunca ha podido ver, y ninguna
 * pantalla que si lo admita puede ser la puerta de atras. `montoCobrar` SI se conserva (R17).
 *
 * El tipo NO puede expresar esa ausencia (los tres campos son opcionales en el padre), asi que
 * la afirma la verificacion, no el compilador.
 */
export type FilaBodegaSatelite = OrdenListItemDTO & {
  /** `value` del catalogo de estatus: es lo que parte los seis grupos del modulo. */
  estatusValue: string;
  direccion: string | null;
  montoCobrar: number | null;
  zonaNombre: string;
  /**
   * Nombres de geografia en la RAIZ, que es donde los leen el filtro de canton/distrito
   * (`lib/utils/filtro-canton-distrito.ts`) y el buscador del modulo. Los mismos valores viajan
   * ademas dentro de `relaciones`, que es de donde los lee `ordenesColumns`.
   */
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  /** Feature 101/R9: reasignacion prioritaria. Sort prioridad-first (R7) + resalte de fila (R8). */
  prioridad: boolean;
  /**
   * Feature 262 (B8, R16/R17): dia de reparto, `YYYY-MM-DD` YA SERIALIZADO. `null` = sin dia.
   * Nunca un `Date`: el navegador no construye fechas.
   */
  fechaRepartoISO: string | null;
};

// Referencia liviana (id + nombre) para relaciones a catalogos/usuarios.
export interface RefNombre {
  id: string;
  nombre: string;
}

// Tienda de la orden (Usuario con rol adminTienda) con la tarifa de la orden anidada.
// FEATURE 274: `tarifa` ya no es "la tarifa activa de la tienda" —eso dejo de existir con la
// columna `status`—: es la fila que gana la CASCADA (tienda, zona) para el par de ESTA orden,
// la MISMA que factura el cierre de dia (R18/R21). `null` = ningun nivel de la cascada tiene
// fila para ese par; el listado lo muestra con importes en "0.00" y no bloquea (R20/R39).
// NUNCA expone campos sensibles del usuario (passwordHash, etc.): solo datos de contacto e
// identidad legibles.
export interface OrdenTiendaRef {
  id: string;
  nombre: string;
  /**
   * Feature 260 (T0.1, R13/R43) — CONTACTO DE LA TIENDA, AHORA OPCIONAL. `OrdenRepository`
   * SIEMPRE los envia (`toRelaciones`, sobre el `select` de `WITH_ESTATUS_Y_TIENDA`), asi que
   * `/ordenes` los sigue recibiendo exactamente igual que antes (R46: en alcance `global` no
   * se recorta nada). El `?` no dice "puede que no existan": dice que **se pueden retirar**.
   *
   * POR QUE, y por que aqui y no en un tipo derivado: el detalle del tablero del dia
   * (`OrdenDetalleDia`) es este mismo elemento, y en alcance `zona` —el `adminSatelite`, que
   * tiene PROHIBIDO `/ordenes` (`app/(app)/ordenes/page.tsx`: `notFound()`)— el contacto de la
   * tienda NO puede viajar al cliente. Con `string` obligatorio, "no viajar" no era
   * representable. Derivar el tipo del detalle con `Omit`/`Partial<Pick<…>>` en vez de aflojar
   * este dejaria de hacerlo asignable a `OrdenListItemDTO` y montar las columnas del listado
   * exigiria un **cast** — la costura por la que las dos pantallas divergen sin que el
   * compilador diga nada (`specs/260-detalle-columnas-listado/design.md` §3.1 y §13/A8).
   *
   * Medido antes de tocarlo (design.md §1.10): estos dos campos se ESCRIBEN en
   * `OrdenRepository.toRelaciones` y NO LOS LEE NADIE por este tipo. El `tienda.telefono` de
   * `GestionOrdenRepository` sale de un `select` propio y alimenta otro DTO.
   */
  email?: string;
  telefono?: string;
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

// BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivian
// `CrearOrdenResult` y `ObtenerOrdenResult`, tipos de retorno de dos Server Actions que se
// borraron en la tanda 1 por nacer sin pantalla. Sin ninguna referencia desde entonces.
// Feature 170 (T H.2): se REEXPRESA sobre `ListarPaginadoResult<T>`
// (lib/types/listado-paginado), el contrato comun de pagina+total que la FASE 2 extiende a
// los 13 listados del Anexo III. La forma publica NO cambia —los mismos cinco campos, el
// mismo union de error—, asi que ningun consumidor se entera; lo que cambia es que la
// definicion pasa a estar en UN sitio.
export type ListarOrdenesResult = ListarPaginadoResult<OrdenListItemDTO>;
// Feature 151 (R11/R20): resultado del modo completo en el borde. `limite_excedido`
// lleva SOLO conteos (sin PII) y NUNCA filas; el resto de fallos son `ActionError`.
//
// Feature 170 (T0.1): se REEXPRESA sobre `ListarCompletoResult<T>` (lib/types/descarga-listado),
// que generaliza este mismo union para los siete `listarCompleto` que la 170 anade. La forma
// publica NO cambia —es el mismo union, con los mismos nombres de campo—, asi que ningun
// consumidor de la 151 se entera; lo que cambia es que ahora hay UNA sola definicion.
export type ListarOrdenesCompletoResult = ListarCompletoResult<OrdenListItemDTO>;
// BORRADO 2026-08-07 (tanda 2): idem con `ActualizarOrdenResult` y `BorrarOrdenResult`.
// Lo que SIGUE VIVO en este archivo son los dos resultados del listado, `ListarOrdenesResult`
// y `ListarOrdenesCompletoResult`, que consume `ordenes/_components/OrdenesModule.tsx`.
