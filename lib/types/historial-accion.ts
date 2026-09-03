import { z } from "zod";

import type {
  HistorialAccionEntidad as PrismaHistorialAccionEntidad,
  HistorialAccionTipo as PrismaHistorialAccionTipo,
  RolValue,
} from "@prisma/client";

// El fragmento de ordenamiento y el minimo de caracteres del buscador se IMPORTAN de donde ya
// viven. Reescribirlos aqui es lo que R32 (y la leccion de la 352) prohiben: dos declaraciones del
// mismo umbral son dos umbrales que un dia divergen, y la pantalla acabaria consultando con dos
// letras mientras el borde exige tres.
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { esquemaOrdenamiento } from "@/lib/types/ordenamiento-listado";
import { esFechaCalendarioValida } from "@/lib/utils/fecha-cr";

// FICHA 362 (design §1.1, R14/R15/R17) — EL CATALOGO CERRADO del historial de acciones.
//
// Modulo PURO: no importa Prisma en runtime (solo los TIPOS del enum, borrados en compilacion),
// ni React, ni `lib/services`. Lo consumen el borde (zod), el servicio, el repositorio, los 42
// puntos de escritura y la pantalla.
//
// LAS DOS DIRECCIONES DEL CIERRE, y por eso hay `satisfies` Y `_AsegurarExhaustivo`:
//   - `satisfies readonly PrismaHistorialAccionTipo[]` rompe el build si esta lista nombra un
//     valor que el enum Postgres NO tiene;
//   - `_AsegurarExhaustivo` rompe el build si el enum gana un valor que esta lista NO nombra.
// Un tipo declarado en la base y ausente del catalogo seria un filtro que no se puede pedir; uno
// en el catalogo y ausente de la base seria un `validation_error` que nadie entiende.
//
// LOS CUARENTA Y DOS, y no los cuarenta del Anexo A: el humano cerro Q1 y Q2 el 2026-09-02 y cada
// una añade UN tipo (`orden_ubicacion_corregida`, `usuario_fulfillment_cambiado`). Los dos entran
// en «mueve dinero» y su motivo esta escrito al lado de cada uno.

/**
 * Los 42 tipos de accion. El ORDEN de esta tupla es el del Anexo A (dinero, desaparicion,
 * permisos) y es el que consume el selector de filtros: no se reordena por gusto.
 */
export const HISTORIAL_ACCION_TIPOS = [
  // --- A.1 · mueve dinero (25) ---
  "cierre_dia_aprobado", // cierres-admin.aprobarCierre
  "cierre_dia_rechazado", // cierres-admin.rechazarCierre
  "cierre_dia_pagos_editados", // cierres-admin.actualizarPagosGestion
  "cierre_bodega_aprobado", // cierre-bodega.aprobarCierreBodega
  "cierre_bodega_rechazado", // cierre-bodega.rechazarCierreBodega
  "pago_mensajero_registrado", // liquidacion.registrarPagoMensajeroAction
  "pago_tienda_registrado", // liquidacion.registrarPagoTiendaAction
  "pago_anulado", // liquidacion.anularPagoAction
  "reparto_mensajero_registrado", // liquidacion.registrarRepartoMensajeroAction
  "reparto_anulado", // liquidacion.anularRepartoAction
  "wallet_movimiento_manual_registrado", // wallet.registrarMovimientoManualAction
  "egreso_administrativo_registrado", // wallet-egresos.registrarEgresoAdministrativoAction
  "egreso_administrativo_reversado", // wallet-egresos.reversarEgresoAdministrativoAction
  "tarifa_creada", // tarifas.crearTarifa
  "tarifa_actualizada", // tarifas.actualizarTarifa
  "incidente_aprobado", // incidentes.aprobarIncidente
  "incidente_rechazado", // incidentes.rechazarIncidente
  "cobro_gasto_fijo_aprobado", // gasto-fijo-cobro.aprobarCobroGastoFijoAction
  "cobro_gasto_fijo_rechazado", // gasto-fijo-cobro.rechazarCobroGastoFijoAction
  "cobro_rechazo_tienda_aprobado", // rechazo-tienda-cobro.aprobarCobroRechazoTiendaAction
  "cobro_rechazo_tienda_rechazado", // rechazo-tienda-cobro.rechazarCobroRechazoTiendaAction
  "premio_ranking_registrado", // premio-ranking-devengo.registrarPremioAction
  "premio_ranking_anulado", // premio-ranking-devengo.anularPremioAction
  // ⭑ Q1, CERRADA POR EL HUMANO EL 2026-09-02 — la correccion de la ubicacion de una orden.
  // Entra en DINERO y no en «desaparicion» ni en «permisos»: el distrito re-deriva la zona y la
  // zona decide la tarifa que se factura, asi que corregirla cambia lo que la orden va a cobrar.
  // La fila registra SOLO EL HECHO (quien, que orden, cuando). NUNCA la direccion vieja ni la
  // nueva, ni el distrito, ni ningun dato del destinatario: eso reabriria D4 de la 312 de verdad,
  // y lo que el humano aprobo fue el rastro, no el volcado.
  "orden_ubicacion_corregida", // corregir-datos-cliente.corregirDatosCliente (solo si cambia la ubicacion)
  // ⭑ Q2, CERRADA POR EL HUMANO EL 2026-09-02 — el `fulfillment` de una tienda.
  // Entra en DINERO porque activa un cobro periodico de bodega. NO entra en «permisos» aunque se
  // edite desde el mismo formulario que el rol: no cambia lo que la persona PUEDE HACER.
  "usuario_fulfillment_cambiado", // usuarios.actualizarUsuario (solo si cambia `fulfillment`)

  // --- A.2 · hace desaparecer algo (6) ---
  "orden_eliminada", // eliminar-orden.eliminarOrdenes Y app/api/ordenes/api-key/orden/[id]
  "orden_recuperada", // recuperar-orden.recuperarOrdenes
  // `tarifa_borrada` esta AQUI y no en «dinero» aunque mueva precio: R17 exige EXACTAMENTE una
  // categoria por tipo, y lo que la fila documenta es la desaparicion irreversible (`tarifas`
  // borra en FISICO, `db/schema.prisma`).
  "tarifa_borrada", // tarifas.borrarTarifa
  "zona_borrada", // zonas.borrarZona — fisico, y arrastra sus tarifas en cascada
  "vehiculo_borrado", // vehiculos.borrarVehiculo
  "plantilla_eliminada", // plantillas.eliminarPlantilla

  // --- A.3 · cambia quien puede hacer que (11) ---
  "usuario_creado", // usuarios.crearUsuario
  "usuario_rol_cambiado", // usuarios.actualizarUsuario (solo si cambia `rolId`)
  "usuario_zona_cambiada", // usuarios.actualizarUsuario (solo si cambia `zonaId`)
  "usuario_estado_cambiado", // usuarios.cambiarEstadoUsuario
  "usuario_contrasena_restablecida", // usuarios.restablecerContrasenaUsuario
  "postulacion_aprobada", // aprobacion-postulaciones.aprobarPostulacion
  "postulacion_rechazada", // aprobacion-postulaciones.rechazarPostulacion
  "api_key_generada", // api-keys.generarApiKey
  "api_key_rotada", // api-keys.rotarApiKey
  "api_key_activada", // api-keys.activarApiKey
  "api_key_desactivada", // api-keys.desactivarApiKey
] as const satisfies readonly PrismaHistorialAccionTipo[];

export type HistorialAccionTipo = (typeof HISTORIAL_ACCION_TIPOS)[number];

/** Los 17 tipos de entidad que una accion del catalogo puede afectar. */
export const HISTORIAL_ACCION_ENTIDADES = [
  "orden",
  "usuario",
  "tarifa",
  "zona",
  "vehiculo",
  "plantilla_mensaje",
  "cierre_dia",
  "cierre_bodega",
  "gestion_orden",
  "liquidacion_pago",
  "liquidacion_reparto",
  "wallet_movimiento",
  "orden_incidente",
  "gasto_fijo_cobro",
  "rechazo_tienda_cobro",
  "ranking_snapshot_fila",
  "api_key",
] as const satisfies readonly PrismaHistorialAccionEntidad[];

export type HistorialAccionEntidad = (typeof HISTORIAL_ACCION_ENTIDADES)[number];

/**
 * Las TRES categorias del criterio que fijo el humano: entra lo que mueve dinero, lo que hace
 * desaparecer algo y lo que cambia quien puede hacer que.
 *
 * NO es una columna de la tabla (R17): se DERIVA con `CATEGORIA_POR_ACCION`. Guardarla seria una
 * segunda fuente de verdad capaz de divergir de la lista de tipos que la define.
 */
export const CATEGORIAS_ACCION = ["mueve_dinero", "hace_desaparecer", "cambia_permisos"] as const;

export type CategoriaAccion = (typeof CATEGORIAS_ACCION)[number];

/**
 * Tipo -> categoria. `Record<HistorialAccionTipo, CategoriaAccion>` EXHAUSTIVO: quitar una clave
 * no compila, y un valor nuevo del enum sin entrada aqui tampoco. Es la unica fuente de la
 * clasificacion (R17).
 */
export const CATEGORIA_POR_ACCION: Record<HistorialAccionTipo, CategoriaAccion> = {
  cierre_dia_aprobado: "mueve_dinero",
  cierre_dia_rechazado: "mueve_dinero",
  cierre_dia_pagos_editados: "mueve_dinero",
  cierre_bodega_aprobado: "mueve_dinero",
  cierre_bodega_rechazado: "mueve_dinero",
  pago_mensajero_registrado: "mueve_dinero",
  pago_tienda_registrado: "mueve_dinero",
  pago_anulado: "mueve_dinero",
  reparto_mensajero_registrado: "mueve_dinero",
  reparto_anulado: "mueve_dinero",
  wallet_movimiento_manual_registrado: "mueve_dinero",
  egreso_administrativo_registrado: "mueve_dinero",
  egreso_administrativo_reversado: "mueve_dinero",
  tarifa_creada: "mueve_dinero",
  tarifa_actualizada: "mueve_dinero",
  incidente_aprobado: "mueve_dinero",
  incidente_rechazado: "mueve_dinero",
  cobro_gasto_fijo_aprobado: "mueve_dinero",
  cobro_gasto_fijo_rechazado: "mueve_dinero",
  cobro_rechazo_tienda_aprobado: "mueve_dinero",
  cobro_rechazo_tienda_rechazado: "mueve_dinero",
  premio_ranking_registrado: "mueve_dinero",
  premio_ranking_anulado: "mueve_dinero",
  orden_ubicacion_corregida: "mueve_dinero",
  usuario_fulfillment_cambiado: "mueve_dinero",
  orden_eliminada: "hace_desaparecer",
  orden_recuperada: "hace_desaparecer",
  tarifa_borrada: "hace_desaparecer",
  zona_borrada: "hace_desaparecer",
  vehiculo_borrado: "hace_desaparecer",
  plantilla_eliminada: "hace_desaparecer",
  usuario_creado: "cambia_permisos",
  usuario_rol_cambiado: "cambia_permisos",
  usuario_zona_cambiada: "cambia_permisos",
  usuario_estado_cambiado: "cambia_permisos",
  usuario_contrasena_restablecida: "cambia_permisos",
  postulacion_aprobada: "cambia_permisos",
  postulacion_rechazada: "cambia_permisos",
  api_key_generada: "cambia_permisos",
  api_key_rotada: "cambia_permisos",
  api_key_activada: "cambia_permisos",
  api_key_desactivada: "cambia_permisos",
};

/** Etiqueta legible de cada tipo. Exhaustiva por el mismo mecanismo que la categoria. */
export const ACCION_LABELS: Record<HistorialAccionTipo, string> = {
  cierre_dia_aprobado: "Aprobó un cierre del día",
  cierre_dia_rechazado: "Rechazó un cierre del día",
  cierre_dia_pagos_editados: "Editó los pagos de una gestión",
  cierre_bodega_aprobado: "Aprobó un cierre de bodega",
  cierre_bodega_rechazado: "Rechazó un cierre de bodega",
  pago_mensajero_registrado: "Registró un pago a mensajero",
  pago_tienda_registrado: "Registró un pago a tienda",
  pago_anulado: "Anuló un pago",
  reparto_mensajero_registrado: "Registró un reparto a mensajero",
  reparto_anulado: "Anuló un reparto",
  wallet_movimiento_manual_registrado: "Registró un movimiento manual de caja",
  egreso_administrativo_registrado: "Registró un egreso administrativo",
  egreso_administrativo_reversado: "Reversó un egreso administrativo",
  tarifa_creada: "Creó una tarifa",
  tarifa_actualizada: "Actualizó una tarifa",
  incidente_aprobado: "Aprobó un incidente",
  incidente_rechazado: "Rechazó un incidente",
  cobro_gasto_fijo_aprobado: "Aprobó un cobro de gasto fijo",
  cobro_gasto_fijo_rechazado: "Rechazó un cobro de gasto fijo",
  cobro_rechazo_tienda_aprobado: "Aprobó un cobro por rechazo de tienda",
  cobro_rechazo_tienda_rechazado: "Rechazó un cobro por rechazo de tienda",
  premio_ranking_registrado: "Registró un premio del ranking",
  premio_ranking_anulado: "Anuló un premio del ranking",
  orden_ubicacion_corregida: "Corrigió la ubicación de una orden",
  usuario_fulfillment_cambiado: "Cambió el fulfillment de una tienda",
  orden_eliminada: "Eliminó una orden",
  orden_recuperada: "Recuperó una orden",
  tarifa_borrada: "Borró una tarifa",
  zona_borrada: "Borró una zona",
  vehiculo_borrado: "Borró un vehículo",
  plantilla_eliminada: "Eliminó una plantilla",
  usuario_creado: "Creó un usuario",
  usuario_rol_cambiado: "Cambió el rol de un usuario",
  usuario_zona_cambiada: "Cambió la zona de un usuario",
  usuario_estado_cambiado: "Cambió el estado de un usuario",
  usuario_contrasena_restablecida: "Restableció la contraseña de un usuario",
  postulacion_aprobada: "Aprobó una postulación",
  postulacion_rechazada: "Rechazó una postulación",
  api_key_generada: "Generó una API key",
  api_key_rotada: "Rotó una API key",
  api_key_activada: "Activó una API key",
  api_key_desactivada: "Desactivó una API key",
};

/** Etiqueta legible de cada categoria, para el selector de filtros y la descarga. */
export const CATEGORIA_LABELS: Record<CategoriaAccion, string> = {
  mueve_dinero: "Mueve dinero",
  hace_desaparecer: "Hace desaparecer algo",
  cambia_permisos: "Cambia permisos",
};

/** Etiqueta legible de cada tipo de entidad. */
export const ENTIDAD_LABELS: Record<HistorialAccionEntidad, string> = {
  orden: "Orden",
  usuario: "Usuario",
  tarifa: "Tarifa",
  zona: "Zona",
  vehiculo: "Vehículo",
  plantilla_mensaje: "Plantilla",
  cierre_dia: "Cierre del día",
  cierre_bodega: "Cierre de bodega",
  gestion_orden: "Gestión",
  liquidacion_pago: "Pago",
  liquidacion_reparto: "Reparto",
  wallet_movimiento: "Movimiento de caja",
  orden_incidente: "Incidente",
  gasto_fijo_cobro: "Cobro de gasto fijo",
  rechazo_tienda_cobro: "Cobro por rechazo",
  ranking_snapshot_fila: "Fila del ranking",
  api_key: "API key",
};

/** Los tipos de UNA categoria. Es la traduccion `categoria -> accion IN (…)` del borde (R17). */
export function accionesDeCategoria(categoria: CategoriaAccion): HistorialAccionTipo[] {
  return HISTORIAL_ACCION_TIPOS.filter((tipo) => CATEGORIA_POR_ACCION[tipo] === categoria);
}

/**
 * El cierre en la direccion que el `satisfies` no cubre: si el enum de Prisma gana un valor que
 * `HISTORIAL_ACCION_TIPOS` no lista, `never` deja de ser asignable y el build se cae. Igual para
 * las entidades.
 */
type _AsegurarExhaustivoTipos = Exclude<PrismaHistorialAccionTipo, HistorialAccionTipo> extends never
  ? true
  : ["falta un tipo en HISTORIAL_ACCION_TIPOS", Exclude<PrismaHistorialAccionTipo, HistorialAccionTipo>];
type _AsegurarExhaustivoEntidades = Exclude<
  PrismaHistorialAccionEntidad,
  HistorialAccionEntidad
> extends never
  ? true
  : [
      "falta una entidad en HISTORIAL_ACCION_ENTIDADES",
      Exclude<PrismaHistorialAccionEntidad, HistorialAccionEntidad>,
    ];

const _tiposExhaustivos: _AsegurarExhaustivoTipos = true;
const _entidadesExhaustivas: _AsegurarExhaustivoEntidades = true;
void _tiposExhaustivos;
void _entidadesExhaustivas;

// =================================================================================================
// FICHA 362 — EL BORDE DE LECTURA (design §4.2/§4.3)
// =================================================================================================

/**
 * Los campos por los que el listado se puede ordenar. UNO, y la lista es cerrada a proposito: el
 * unico orden que este modulo tiene sentido ofrecer es el temporal, y `esquemaOrdenamiento`
 * rechaza cualquier otro valor con `validation_error` sin ejecutar consulta (R26).
 */
export const HISTORIAL_SORT_FIELDS = ["created_at"] as const;
export type HistorialSortField = (typeof HISTORIAL_SORT_FIELDS)[number];

/** Tamaño de pagina por defecto y su tope. 25 es el de las demas tablas del repo. */
export const HISTORIAL_PAGE_SIZE_DEFECTO = 25;
export const HISTORIAL_PAGE_SIZE_MAX = 100;

/** Longitud maxima del termino de busqueda libre. */
export const HISTORIAL_BUSQUEDA_MAX_CHARS = 120;

/**
 * El filtro del listado, tal como llega del cliente.
 *
 * `.strict()` NO ES DECORATIVO (leccion de la 352): una clave desconocida es `validation_error`,
 * no un descarte mudo. Un filtro que se ignora en silencio le enseña al usuario un conjunto que no
 * es el que pidio, y eso en un registro de auditoria es peor que un error.
 *
 * `esquemaOrdenamiento` se IMPORTA de `lib/types/ordenamiento-listado.ts` y no se reescribe: dos
 * declaraciones de la direccion son la forma silenciosa de que una superficie acepte lo que la
 * otra rechaza.
 */
export const filtroHistorialAccionSchema = z
  .object({
    /**
     * El termino libre. `min(BUSQUEDA_MIN_CHARS)` sale de la MISMA constante que valida el borde
     * de `/ordenes` (`lib/types/orden.ts`): escribir un `3` a mano aqui —o en el control de la
     * pantalla— es la mutacion que R32 prohibe.
     */
    q: z.string().trim().min(BUSQUEDA_MIN_CHARS).max(HISTORIAL_BUSQUEDA_MAX_CHARS).optional(),
    actorId: z.array(z.string().min(1)).nonempty().optional(),
    /** Union CERRADA sobre los 42 tipos (R15): un valor inventado no llega a la consulta. */
    accion: z.array(z.enum(HISTORIAL_ACCION_TIPOS)).nonempty().optional(),
    /** Se traduce a `accion IN (…)` en el servicio con `CATEGORIA_POR_ACCION` (R17). */
    categoria: z.array(z.enum(CATEGORIAS_ACCION)).nonempty().optional(),
    entidadTipo: z.array(z.enum(HISTORIAL_ACCION_ENTIDADES)).nonempty().optional(),
    /** Fechas de CALENDARIO de Costa Rica (`YYYY-MM-DD`), no instantes. */
    desde: z.string().refine(esFechaCalendarioValida, "Fecha invalida").optional(),
    hasta: z.string().refine(esFechaCalendarioValida, "Fecha invalida").optional(),
    page: z.number().int().positive().default(1),
    pageSize: z
      .number()
      .int()
      .positive()
      .default(HISTORIAL_PAGE_SIZE_DEFECTO)
      .transform((n) => Math.min(n, HISTORIAL_PAGE_SIZE_MAX)),
    // R26: el defecto es EL MAS RECIENTE PRIMERO, y se puede invertir. Un campo o una direccion
    // fuera de la lista blanca es `validation_error` SIN consulta.
    ...esquemaOrdenamiento(HISTORIAL_SORT_FIELDS, "created_at", "desc"),
  })
  .strict();

export type FiltroHistorialAccionInput = z.input<typeof filtroHistorialAccionSchema>;
export type FiltroHistorialAccion = z.output<typeof filtroHistorialAccionSchema>;

/**
 * UNA fila del registro tal como cruza al cliente.
 *
 * ⚠️ `monto` ES UN STRING Y NUNCA UN `number` (R6). La conversion `Decimal -> string` ocurre en el
 * servicio con `.toFixed(2)`, que es del propio `Decimal` y no pasa por coma flotante. Un
 * `Number()` en cualquier punto de este camino es la mutacion que la guardia money-safe caza.
 *
 * ⚠️ `entidadId` NO CRUZA (design §4.3): no aporta nada en pantalla y `columnas-sensibles.guardia`
 * prohibe la forma uuid en una celda de la descarga. Correlacionar con la entidad es trabajo de
 * base, no de pantalla.
 *
 * ⚠️ NO HAY `motivo`, y no es un olvido: R5.
 */
export interface HistorialAccionDTO {
  id: string;
  /** ISO. La pantalla lo pinta en la zona horaria de Costa Rica (R35). */
  fecha: string;
  accion: HistorialAccionTipo;
  accionLabel: string;
  categoria: CategoriaAccion;
  entidadTipo: HistorialAccionEntidad;
  entidadEtiqueta: string;
  /** `null` = el sistema (R36). La pantalla NO lo pinta en blanco ni como un identificador. */
  actorNombre: string | null;
  actorRol: RolValue | null;
  /** ⚠ STRING de escala 2, o `null`. NUNCA un `number` (R6). */
  monto: string | null;
  valorAnterior: string | null;
  valorNuevo: string | null;
  loteId: string;
}

/** Un actor que aparece en el registro, para el selector de filtros. */
export interface ActorHistorialDTO {
  id: string;
  nombre: string;
}

/**
 * El desenlace del listado paginado. Los cuatro estados son EXPLICITOS y ninguno es un error
 * generico: `forbidden` es «tu rol no lee este modulo», `unauthenticated` es «no hay sesion» y
 * `validation_error` trae el motivo del primer problema del borde SIN ecoar el valor recibido.
 */
export type ListarHistorialAccionesResult =
  | {
      status: "ok";
      items: HistorialAccionDTO[];
      page: number;
      pageSize: number;
      total: number;
    }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; motivo: string };

/**
 * El desenlace de la DESCARGA. Mismo conjunto filtrado que la pantalla (R30) y el MISMO gate por
 * rol (R33). `limite_excedido` es un error ACCIONABLE y no un truncado silencioso: el usuario
 * tiene que poder saber que el archivo no traeria todo.
 */
export type ListarHistorialAccionesCompletoResult =
  | { status: "ok"; items: HistorialAccionDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; motivo: string }
  | { status: "limite_excedido"; maximo: number };

/** El desenlace del catalogo de actores del selector. */
export type CatalogoActoresHistorialResult =
  | { status: "ok"; actores: ActorHistorialDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
