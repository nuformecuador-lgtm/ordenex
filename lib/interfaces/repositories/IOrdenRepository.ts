import type { GestionCausaDevolucion } from "@prisma/client";
import type { OrdenDTO, OrdenListItemDTO, SortField, SortDir } from "@/lib/types/orden";
import type { ResumenCargaOrdenDTO } from "@/lib/types/carga-masiva-resumen";
import type { HistorialContexto } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { OrdenAsignabilidadRow } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type { ZonaDeOrden } from "@/lib/utils/filtro-canton-distrito";

// Datos listos para persistir una orden. `estatusId` y `tiendaId` ya resueltos
// por el servicio (default de estatus, alcance de tienda). `numGuia` lo asigna
// la secuencia de la DB, nunca se envia (R8). `peso` nullable (feature 15/R4:
// la carga masiva no trae peso); el CRUD (feature 6) siempre envia un numero,
// pues `crearOrdenSchema` sigue exigiendo `peso > 0`. `direccion` y `montoCobrar`
// son columnas nuevas de feature 15, opcionales.
export interface CreateOrdenData {
  numRemision: string;
  estatusId: string;
  destinatario: string;
  telefonoDest: string;
  tiendaId: string;
  zonaId: string;
  provinciaId: string;
  cantonId: string;
  distritoId?: string | null;
  producto: string;
  peso: number | null;
  notas?: string | null;
  direccion?: string | null;
  montoCobrar?: number | null;
}

// Campos actualizables a nivel de datos (ya filtrados por rol en el servicio).
export interface UpdateOrdenData {
  estatusId?: string;
  destinatario?: string;
  telefonoDest?: string;
  tiendaId?: string;
  zonaId?: string;
  provinciaId?: string;
  cantonId?: string;
  distritoId?: string | null;
  producto?: string;
  peso?: number | null;
  notas?: string | null;
  /**
   * Feature 91 (R10/R11, decision Q1): campo del GUARD LATENTE de re-geocodificacion.
   * Hoy NADIE lo informa: `actualizarOrdenSchema` es `.strict()` y no lo admite, y
   * `OrdenRepository.toUpdateData()` NO lo proyecta, asi que `update()` sigue siendo
   * incapaz de ESCRIBIR la direccion. Declararlo aqui permite que el guard exista y sea
   * testeable hoy, sin ampliar el CRUD (permitir editar la direccion es otra feature,
   * explicitamente fuera de alcance). NO eliminar por "no usado".
   */
  direccion?: string | null;
}

/**
 * Feature 144 (R33/R34/R44) — `where` YA traducido por el service a columnas Prisma
 * (nunca claves publicas del `filter`). Cada clave presente es una condicion AND; una
 * clave con lista se traduce a `IN (...)` (OR dentro del mismo filtro). Una clave
 * AUSENTE es "sin filtro"; una clave presente NUNCA puede degradar a "sin filtro" (un
 * id inexistente estrecha el resultado a cero, no lo ensancha, R35).
 *
 * `tiendaId` admite lista (filtro de tienda) o escalar: el escalar es el ACOTAMIENTO POR
 * ROL del `adminTienda`, que el service escribe AL FINAL y por tanto PISA cualquier lista
 * que el filtro hubiera puesto (R36). El repositorio no decide nada de eso: recibe el
 * `where` ya resuelto.
 */
export interface ListOrdenesWhere {
  // `tiendaId` escalar = scoping por rol (adminTienda); lista = filtro de tienda.
  tiendaId?: string | string[];
  // `estatusId` admite un id (filtro por un estado) o una lista de ids (filtro
  // multi-estado del listado de `/ordenes`), que el repositorio traduce a `IN (...)`.
  estatusId?: string | string[];
  mensajeroAsignadoId?: string;
  // Feature 144: filtros de catalogo de la orden (columnas propias, sin JOIN).
  zonaId?: string | string[];
  provinciaId?: string | string[];
  cantonId?: string | string[];
  // `distritoId` es NULLABLE en la tabla: `IN (...)` excluye las ordenes sin distrito
  // (decision (f) del spec: no hay opcion "sin distrito").
  distritoId?: string | string[];
  // Rango temporal YA calculado server-side (instantes UTC). `gte` inclusivo,
  // `lt` EXCLUSIVO (= comienzo del dia CR siguiente al `hasta` pedido).
  createdAt?: { gte?: Date; lt?: Date };
  /**
   * Filtro REASIGNABLES: ordenes que esperan una decision de despacho — que se les
   * ponga mensajero, o que se ruteen a una bodega satelite—. NO es una columna: es el
   * predicado COMPUESTO `estado = en_bodega_central` Y `mensajero_asignado_id IS NULL`
   * (el origen unico de ambas decisiones), que el repositorio traduce comparando el
   * estado por VALUE via la relacion. Solo acota: `true` filtra, ausente no filtra.
   *
   * NO exige `prioridad`: esa columna solo se enciende al deshacer una asignacion, asi
   * que exigirla dejaba fuera a las ordenes que nunca tuvieron mensajero.
   */
  reasignables?: true;
  /**
   * Feature 169 (design §4.2) — TERMINO de busqueda YA NORMALIZADO por el service
   * (minusculas, sin los acentos del mapa, espacios colapsados). Es un TERMINO, nunca un
   * patron: los comodines y su escape son dialecto de la capa de datos y se aplican en el
   * repositorio (R7). Se resuelve contra la columna generada `busqueda_texto`, que solo
   * contiene los CINCO campos buscables (guia, remision, telefono, destinatario y
   * producto) — por construccion no puede coincidir con la direccion, las notas ni el
   * nombre de la tienda (R2). `producto` entro despues, con la migracion
   * `20260808120000_orden_busqueda_producto`; ni esta interfaz ni el repositorio
   * cambiaron por ello: el campo buscable es un dato de la COLUMNA, no del contrato.
   *
   * Es una clave HERMANA de las demas => AND con todo lo que haya (R14/R21). Meterla
   * dentro de un `OR` con cualquier otra cosa abriria una fuga: el acotamiento por rol
   * dejaria de acotar.
   */
  busqueda?: string;
  /**
   * Feature 169 (M1 del review) — la MISMA busqueda, en su forma SOLO DIGITOS, cuando el
   * termino tecleado trae separadores (`8888-0000` -> `88880000`). Solo se escribe si esa
   * forma DIFIERE de `busqueda`; con un termino ya limpio no existe y el `where` es el de
   * siempre.
   *
   * Por que hacen falta las dos: la columna generada indexa el telefono en sus dos formas,
   * pero la REMISION va tal cual. Buscando SOLO los digitos, `2026-0912` no encuentra
   * `REM-2026-0912` (falso negativo silencioso: el dato existe y la busqueda calla);
   * buscando SOLO el texto tecleado, `8888-0000` no encuentra un telefono guardado sin
   * guiones (R13). Se buscan las dos y se unen.
   *
   * El repositorio las resuelve con un `OR` que vive DENTRO de la dimension de busqueda:
   * las dos ramas comparan la MISMA columna (`busqueda_texto`) y el `OR` entero sigue
   * siendo una clave hermana => AND con el acotamiento por rol. Un `OR` que mezclara el
   * termino con cualquier OTRA cosa seguiria siendo un rechazo automatico (design §7).
   */
  busquedaDigitos?: string;
  /**
   * Feature 169 (design §5) — RUTA RAPIDA: igualdad contra `num_guia`, que ya tiene indice
   * unico (`orden_num_guia_key`). Es el caso mas frecuente en operacion (el operador tiene
   * la guia delante) y cuesta una busqueda por indice unico, sin tocar el trigram.
   *
   * NO es terminal: si la consulta con esta clave devuelve `total === 0`, el service
   * reintenta con `busqueda` (R10), porque "los ultimos digitos del telefono" tambien es
   * un termino de solo digitos. El disparador es el TOTAL, nunca `items.length`.
   */
  numGuia?: number;
}

export interface ListOrdenesParams {
  where: ListOrdenesWhere;
  sortBy: SortField;
  sortDir: SortDir;
  skip: number;
  take: number;
}

export interface ListOrdenesResult {
  items: OrdenListItemDTO[];
  total: number;
}

// BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivia `GeoExistence`,
// el resultado de `existsGeo`. Se fue con el alta MANUAL. La carga masiva resuelve la
// geografia por NOMBRE, no comprobando ids uno a uno.

/**
 * Feature 141 (design §3.1) — contexto del LOTE de carga masiva que acompana a una insercion
 * batch. NO es logica de negocio: el service ya decidio quien carga y cuantas filas tiene el
 * lote; el repo solo asegura la fila de `carga` y cuelga de ella las ordenes creadas.
 */
export interface LoteContexto {
  /**
   * Token de lote EMITIDO POR EL SERVIDOR y reenviado por el cliente en los chunks 2..N.
   * `null` = esta peticion CREA el lote y el repo genera el id (R15/R16). NUNCA es un valor
   * elegido por el usuario: con id presente el repo solo LEE y verifica propiedad (R17/R19).
   */
  cargaId: string | null;
  /** `carga.usuario_carga`: el actor de la carga (R2/R31). */
  usuarioCargaId: string;
  /**
   * Tamano TOTAL del lote (R7/R29/R32). Sesion = filas de la SESION declaradas por el
   * cliente; API = `ordenes.length` del payload. NUNCA el tamano del chunk ni del batch: solo
   * lo escribe la peticion que CREA el lote; las que lo reutilizan no lo tocan.
   */
  totalFiles: number;
  /**
   * `carga.name` OPCIONAL definido por el usuario (R8/R20). Solo lo usa la CREACION del lote
   * (R21/R22); al reutilizar un lote existente se ignora (R23). Repetir un nombre propio
   * produce `CargaNombreDuplicadoError` (R24).
   */
  name?: string | null;
}

/**
 * Feature 141 (R19) — el `carga_id` recibido no corresponde a ninguna fila, o corresponde a un
 * lote de OTRO usuario. El borde lo traduce a 403 sin crear ninguna orden ni modificar el lote
 * existente; es el MISMO error en ambos casos, para no revelar si el lote existe. Vive aqui
 * (junto a `NumRemisionDuplicadoError`) para que el controller lo reconozca sin importar el repo.
 */
export class CargaLoteAjenoError extends Error {
  constructor(public readonly cargaId: string) {
    super(`carga_id desconocido o de otro usuario: ${cargaId}`);
    this.name = "CargaLoteAjenoError";
  }
}

/**
 * Feature 141 (R24) — el actor ya tiene un lote con ese `name` (viola el unico compuesto
 * `carga_usuario_carga_name_key`). El borde lo traduce a 409 nombrando el duplicado; la
 * transaccion revierte, asi que ni el lote ni las ordenes de esa peticion quedan persistidos.
 */
export class CargaNombreDuplicadoError extends Error {
  constructor(public readonly nombre: string) {
    super(`ya existe una carga con el nombre '${nombre}'`);
    this.name = "CargaNombreDuplicadoError";
  }
}

/** R28/R14: `num_remision` provisto ya existe en otra orden. */
export class NumRemisionDuplicadoError extends Error {
  constructor(public readonly numRemision: string) {
    super(`num_remision duplicado: ${numRemision}`);
    this.name = "NumRemisionDuplicadoError";
  }
}

// --- Feature 149: deshacer asignacion a mensajero o bodega antes de la recogida ---

/**
 * Feature 149 (design §3.2) — una orden del lote a revertir, con su destino YA derivado por el
 * service (del historial, R11-R15). El repo no deriva nada: recibe la decision.
 */
export interface DeshacerAsignacionItem {
  ordenId: string;
  destinoEstatusId: string;
}

/**
 * Feature 149 (design §3.2, R20/R21) — al menos una orden del lote NO gano la guarda de
 * escritura (estado de origen / zona / no borrada): la carrera se perdio. Se LANZA dentro de la
 * `$transaction` para revertirla ENTERA (todo-o-nada REAL, desviacion deliberada del precedente
 * de `asignarSateliteLote`, que deja pasar a los ganadores: aqui una reversion parcial dejaria
 * medio lote sin mensajero y medio con el, sin forma de distinguirlos desde la UI).
 *
 * `ordenIdsNoTransicionadas` NO se renderiza como texto en la UI (R40): sirve para que el
 * service re-lea esas ordenes y componga el `detalle` por orden con motivos tipados.
 */
export class DeshacerAsignacionConflictoError extends Error {
  constructor(public readonly ordenIdsNoTransicionadas: readonly string[]) {
    super(
      `deshacer asignacion: ${ordenIdsNoTransicionadas.length} orden(es) del lote no transicionaron`,
    );
    this.name = "DeshacerAsignacionConflictoError";
  }
}

// Feature 17 — fila de orden proyectada para validar transiciones de "Generar
// guia"/"asignar desde bodega" (R27/R29). NO filtra deleted_at en el repo: el
// service necesita distinguir "no existe" de "borrada" para reportar el motivo
// exacto en `conflict.detalle` (R29).
// Feature 30/R8/R9/R11/R12 — la fila de transicion suma la zona de la orden
// (`zonaId` NOT NULL) y el flag GAM de esa zona (`zonaEsGam`), para que el
// service clasifique cada orden GAM/no-GAM por `zonaId === gamZonaId` sin una
// consulta extra.
export interface OrdenTransicionRow {
  id: string;
  estatusValue: string;
  numGuia: number | null;
  deletedAt: Date | null;
  zonaId: string;
  zonaEsGam: boolean;
  // Tienda DUEÑA de la orden (FK a `usuario`; para el adminTienda su `usuarioId` ES
  // el tiendaId, misma identidad que usa OrdenService.listar). Permite acotar por
  // tienda sin una consulta extra, igual que `zonaId` lo permite por zona.
  tiendaId: string;
  /**
   * Feature 157 (R30): mensajero asignado, para que la guardia de PROPIEDAD de la
   * recoleccion en tienda pueda resolverse sin una consulta extra. OPCIONAL (`?`) por el
   * mismo patron aditivo que `OrdenListItemDTO.mensajeroAsignadoId?`: no rompe los dobles
   * de test de las features 138/139, y el repo SIEMPRE lo emite.
   */
  mensajeroAsignadoId?: string | null;
}

/**
 * Feature 92 (design §5) — una orden en reparto del mensajero, candidata a ser parada de
 * la ruta. `latitud`/`longitud` nullable: la orden pudo asignarse antes de que existiera
 * el gate de coordenadas (R8) o perder la geocodificacion al corregirse la direccion.
 */
export interface ParadaRutaRow {
  ordenId: string;
  latitud: number | null;
  longitud: number | null;
  createdAt: Date;
}

// Feature 17/T15 — fila liviana de mensajero para el loader del modal (R28).
export interface MensajeroLiteRow {
  id: string;
  nombre: string;
}

// Feature 17 — fila liviana del catalogo `order_status` para que la UI resuelva
// value -> estatusId y siga filtrando `listarOrdenes` por `estatusId` (R15/R16,
// mismo patron que design.md §4). Solo lectura, sin logica de negocio.
export interface OrderStatusLiteRow {
  id: string;
  value: string;
}

// Feature 17 — decision final por orden ya resuelta por el service (estatusId y
// mensajeroAsignadoId concretos, no el `value`/`mensajeroId` crudo del input).
export interface GenerarGuiaDecisionData {
  ordenId: string;
  estatusId: string;
  mensajeroAsignadoId: string | null;
}

export interface GenerarGuiaResultRow {
  ordenId: string;
  numGuia: number;
}

// Feature 88 — fila devuelta por `createManyOrdenesConGuia`: por cada orden EFECTIVAMENTE
// creada (no las duplicadas que `skipDuplicates` salto), su `numGuia` YA asignado en la
// misma tx (R9/R10) y el `value` del estado inicial, que desde la feature 155 lo resuelve la
// bifurcacion por bodega y ya no es un literal fijo.
export interface CreateOrdenConGuiaResultRow {
  ordenId: string;
  numRemision: string;
  /** Feature 155/R21: `null` si el lote se creo con `conGuia: false` (rama defensiva). */
  numGuia: number | null;
  estatusValue: string;
}

/**
 * Feature 155 (R3/R8/R12) — opciones de `create`. Hoy solo lleva la numeracion de la rama (b)
 * de la bifurcacion de creacion; el default (`conGuia` ausente = `false`) es el comportamiento
 * historico: la orden nace SIN `num_guia`.
 */
export interface CreateOrdenOpciones {
  /**
   * `true` => dentro de la MISMA transaccion de la creacion se ejecuta
   * `UPDATE orden SET num_guia = siguiente_num_guia() WHERE id = $1 AND num_guia IS NULL`.
   * La guarda `num_guia IS NULL` lo hace idempotente: nunca consume dos numeros para la misma
   * orden, y la secuencia es la MISMA que usa el resto del sistema (ninguna guia colisiona).
   */
  conGuia?: boolean;
}

// Feature 15 — filas de catalogo geografico usadas para resolver por nombre
// (R19/R21), jerarquicas: canton dentro de provincia, distrito dentro de canton.
export interface ProvinciaRow {
  id: string;
  nombre: string;
  // feature 54: la zona de la orden ya NO se deriva de la provincia (provincia.zona_id
  // fue eliminada en la migracion de zonas); se deriva del distrito. Ver BulkOrdenService.
}

export interface CantonRow {
  id: string;
  nombre: string;
  provinciaId: string;
}

export interface DistritoRow {
  id: string;
  nombre: string;
  cantonId: string;
  zonaId: string | null; // feature 24/R4: la zona de la orden se deriva del distrito (carga masiva).
  // Feature 98 (design §3.3, R2): flag `esCentral` de la zona del distrito, para elegir la
  // columna del flete (`valorFleteGam` si central) al tarifar la carga por API SIN N+1. `false`
  // cuando el distrito no resuelve UNA zona (0 o >1 zonas -> `zonaId` null -> no se tarifa).
  esCentral: boolean;
}

// Feature 32 — fila proyectada para armar la etiqueta de guia (R1). Trae los
// nombres legibles de tienda/geografia (no IDs) y `montoCobrar` ya como
// number|null (Decimal->number, R5). `numGuia` puede venir null: el filtro
// `sin_guia` (R2) lo decide el service, no el repo. NUNCA incluye `deletedAt`
// (R6): el repo YA filtra `deletedAt: null` para que una orden borrada cuente
// como no encontrada (R3), no como fila con guia. `distritoNombre` es nullable
// (R4: la orden puede no tener distrito).
export interface EtiquetaRow {
  id: string;
  // Feature 136: dueño de la orden. Lo necesita `EtiquetaGuiaService` para filtrar
  // por propietario cuando el actor es una API key (aislamiento entre tiendas
  // explicito en el service, no solo garantizado por el borde).
  tiendaId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
}

// Feature 148 — fila proyectada para armar el MANIFIESTO de un lote (R4/R6/R7).
// Molde de `EtiquetaRow` (nombres legibles, no IDs; `montoCobrar` Decimal->number),
// con dos diferencias que el manifiesto SI necesita y la etiqueta no:
//   - `mensajeroAsignadoNombre`: alimenta la columna `responsable` cuando el flujo
//     dejo mensajero asignado (R9 / design.md §9.8). Null si la orden no lo tiene.
//   - `zonaEsCentral`: distingue la orden GAM de la no-GAM para resolver
//     `origen`/`destino` de `generacion_guia` sin un parametro extra (design.md §4).
// A cambio NO trae provincia/canton/distrito: el manifiesto no los usa
// (R11). NUNCA incluye `deletedAt` (R11): el repo YA filtra `deletedAt: null` para
// que una orden borrada cuente como no encontrada (R12). `numGuia` puede venir null
// (R5): la celda queda vacia, la fila NO se descarta.
export interface ManifiestoOrdenRow {
  id: string;
  // Dueño de la orden. Lo necesita `ManifiestoService` para filtrar por propietario
  // cuando el actor es una API key (R29), igual que `EtiquetaRow.tiendaId`.
  tiendaId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  // Dato propio de la orden: es columna del manifiesto por la regla 160/R28 (el conjunto de
  // columnas CRECE cuando la orden expone un dato mas). NOT NULL en `orden`.
  producto: string;
  montoCobrar: number | null;
  tiendaNombre: string;
  zonaNombre: string;
  zonaEsCentral: boolean;
  mensajeroAsignadoNombre: string | null;
}

// Feature 33 — fila proyectada para el modulo de la bodega satelite ("Mis
// asignaciones" del adminSatelite, R6/R8/R9). Trae los nombres legibles de
// tienda/geografia (no IDs, patron EtiquetaRow) y `montoCobrar` ya como
// number|null (Decimal->number). `estatusValue` distingue "Por recibir"
// (en_ruta_bodega_satelite) de "Recibidas" (en_bodega_satelite); el service parte
// en grupos. NUNCA incluye `deletedAt`: el repo YA filtra `deletedAt: null`.
// `distritoNombre` es nullable (la orden puede no tener distrito).
export interface RecepcionSateliteRow {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string; // en_ruta_bodega_satelite | en_bodega_satelite
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  // Feature 101/R9: flag de reasignacion prioritaria de la orden (contrato interno repo->
  // service, siempre presente: el `select` de WITH_RECEPCION_SATELITE lo pide explicito).
  // Alimenta el sort prioridad-first del grupo "Recibidas" (R7) y el resalte (R8).
  prioridad: boolean;
}

/**
 * Feature 170 — FASE 2 (T K.1, R44/R45) — el conjunto del listado «Órdenes de la bodega»
 * cuando el recorte lo hace la BASE.
 *
 * `zonaId` es el ACOTAMIENTO y no es opcional: sale del `usuario.zona_id` del actor, jamas
 * de la peticion. Los otros tres campos son los TRES filtros que hasta ahora resolvia el
 * navegador (`SateliteOrdenesListado`, `visibles`), en el mismo AND y con la misma semantica:
 * una lista VACIA no filtra, dos listas distintas se cruzan.
 */
export interface RecepcionSateliteFiltro {
  /** Zona del `adminSatelite`. Se impone SIEMPRE (R44). */
  zonaId: string;
  /** Lista blanca de estados ya intersecada por el servicio; vacia -> pagina vacia. */
  estatusValues: readonly string[];
  /** Nombres de canton elegidos; vacio/ausente = todos los cantones. */
  cantonNombres?: readonly string[];
  /**
   * Nombres de distrito elegidos; vacio/ausente = todos. Con distritos elegidos, una orden
   * SIN distrito queda fuera — igual que hoy en el cliente (`distritoNombre === null`).
   */
  distritoNombres?: readonly string[];
}

// Feature 41 (R17/R18) — resultado del bloqueo derivado de una bodega satelite.
// `bloqueada = porMensajeros || porCierreBodega`. `porCierreBodega` = existe su propio
// CierreBodega hacia la central en `solicitado` (causa ii, bloqueo duro).
//
// Causa (i), mensajeros: `porMensajeros` es `true` (bloqueo duro) si AL MENOS 1 mensajero
// de la zona tiene un cierre abierto (`solicitado`/`vencido`). Con un cierre pendiente la
// bodega esta cuadrando caja, asi que no recibe ordenes nuevas hasta resolverlo. Una zona
// SIN mensajeros no bloquea por (i) (no hay cierre que resolver). Es la misma regla que
// aplica el gate de seleccion del maestro, para que lectura y escritura no diverjan.
// Los campos informativos alimentan el detalle del aviso y el deshabilitado
// por-mensajero en el selector:
//   - `cierresAbiertos`         = mensajeros de la zona con un cierre abierto.
//   - `totalMensajeros`         = mensajeros de la zona.
//   - `mensajerosConCierreIds`  = ids de esos mensajeros (para deshabilitarlos al asignar).
// Son opcionales (aditivos): los consumidores que solo deciden el bloqueo usan los tres
// primeros campos.
export interface BodegaBloqueoResult {
  bloqueada: boolean;
  porMensajeros: boolean;
  porCierreBodega: boolean;
  cierresAbiertos?: number;
  totalMensajeros?: number;
  mensajerosConCierreIds?: string[];
}

// Feature 87 (T2, design §2.1) — fila de una orden en `devuelta` para la lista de NOVEDADES.
// Los campos que consume el DTO (R9) + `createdAt` para el reordenamiento por fecha de
// gestion (R21, fallback). NO expone `deletedAt` (el repo ya filtra `deletedAt: null`, R4).
//
// 2026-08-13 (pedido humano): deja de ser una fila "liviana". `NovedadDTO` pasa a extender
// `MiAsignacionDTO` porque `/novedades` pinta las MISMAS cards POS que el portal del
// mensajero (ver la cabecera de `lib/types/novedad.ts`), asi que esta fila espeja a
// `MiAsignacionRow` (`lib/interfaces/repositories/IGestionOrdenRepository.ts`): nombres de
// catalogo YA RESUELTOS (nunca IDs) y decimales YA serializados a `number | null` con
// `.toNumber()` (`montoCobrar` es `Decimal(12,2)?`; `latitud`/`longitud`, `Decimal(10,7)?`;
// `peso`, `Decimal(10,3)?`). Ningun `Prisma.Decimal` cruza la frontera de capa.
//
// `createdAt` es lo UNICO que no viaja al DTO: lo consume el service para ordenar por
// recencia (R12, fallback) y ahi muere — un `Date` no sobrevive al borde RSC.
export interface NovedadOrdenRow {
  id: string;
  numGuia: number | null;
  /** REAL de la orden (`num_remision`, NOT NULL). Que el front lo tape con la etiqueta «Guia N» (R9) es cosa suya. */
  numRemision: string;
  /** Proyectado de la relacion `estatus`, no hardcodeado: el predicado ya lo ancla a `devuelta`, pero el dato es el dato. */
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  /** `orden.direccion` es NULLABLE (feature 15/R1): `null` = sin direccion, nunca `""`. */
  direccion: string | null;
  /** NOT NULL en el schema. */
  producto: string;
  /** `Decimal(10,3)?` NULLABLE (feature 15/R4: la carga masiva no trae peso) -> `.toNumber()` o `null`. */
  peso: number | null;
  /** `Decimal(12,2)?` NULLABLE -> `.toNumber()` o `null`. `null` = sin cobro, NUNCA `0`. */
  montoCobrar: number | null;
  /** Feature 91: geocodificacion de `direccion`, `Decimal(10,7)?` -> `.toNumber()` o `null` (aun sin geocodificar). */
  latitud: number | null;
  longitud: number | null;
  /** Nota de la TIENDA (`orden.notas`, nullable). */
  notas: string | null;
  /** Tienda DUEÑA de la orden = la tienda que mira esta pantalla; no es PII de un tercero. */
  tiendaNombre: string;
  /** `zona_id`/`provincia_id`/`canton_id` son NOT NULL -> sus nombres siempre existen. */
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  /** `distrito_id` es el UNICO FK geografico nullable -> `null` cuando la orden no lo tiene. */
  distritoNombre: string | null;
  createdAt: Date;
}

// Feature 87 (T2, design §2.1) — causa de devolucion VIGENTE resuelta para UNA orden: el
// valor `causaDevolucion` (nullable, R7) de su ultima gestion `devuelta` no anulada, con la
// `fecha` (createdAt) de esa gestion para el orden por recencia (R21).
export interface CausaDevueltaVigente {
  causa: GestionCausaDevolucion | null;
  fecha: Date;
}

// Feature 106 — fila liviana de una orden para el canal integrador (API por key). Los
// campos son los PUBLICOS que el DTO expone (sin `id`, sin `tiendaId` en la salida). El
// repo la produce ya con `estatusValue` y `montoCobrar` como number (Decimal -> number).
export interface ApiOrdenRow {
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  direccion: string | null;
  montoCobrar: number | null;
  createdAt: Date;
}

export interface ApiOrdenListResult {
  items: ApiOrdenRow[];
  total: number;
}

// Feature 106 — UNA evidencia de la orden en el detalle. El repo devuelve el `storagePath`
// CRUDO (el service lo firma y NUNCA lo expone). `resultado` acotado a los dos que llevan
// evidencia (entregada/rechazada), garantizado por el WHERE de la query.
export interface ApiOrdenEvidenciaRow {
  resultado: "entregada" | "rechazada";
  storagePath: string;
  contentType: string | null;
}

export interface ApiOrdenDetalleRow extends ApiOrdenRow {
  evidencias: ApiOrdenEvidenciaRow[];
}

// Feature 106 — resultado discriminado de `cancelarViaApi` (sin acoplarse a HTTP):
//   - `ok`        -> transiciono a `devolviendo_a_tienda`; `estadoAnterior` = estado previo real.
//   - `not_found` -> no existe, borrada, o de otro owner (R23/R24).
//   - `conflict`  -> estado actual no cancelable (incl. ya `devolviendo_a_tienda`); NO se modifico (R20).
export type CancelarViaApiResult =
  | { status: "ok"; estadoAnterior: string }
  | { status: "not_found" }
  | { status: "conflict"; estadoActual: string };

// Feature 102 (T7, design §5.2) — fila de una orden RECHAZADA POR SLA de la tienda, para la
// superficie derivada de solo-lectura (dentro de /novedades). Molde de `NovedadOrdenRow`, mas el
// `numRemision` y el `monto` de 56. `monto` = `ingreso_bodega_rechazo` de la gestion sintetica SLA
// de esa orden, YA serializado a STRING escala 2 (money-safe, R14/R18); `null` = pendiente de
// cierre (la gestion sintetica nace sin snapshot hasta el proximo cierre, Q2 default). NO expone
// `deletedAt` (el repo ya filtra `deletedAt: null`, R15).
export interface RechazoSlaTiendaRow {
  id: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  monto: string | null;
}

export interface IOrdenRepository {
  /**
   * Feature 106/R6/R7/R11: pagina de ordenes cuyo `tienda_id` = `ownerId` (owner FORZADO en
   * el WHERE, no ampliable desde el input) y no borradas (`deleted_at IS NULL`). Opcional
   * `estatusId` acota por estado. Devuelve `{ items, total }` para la paginacion offset/limit.
   */
  listByOwner(params: {
    ownerId: string;
    estatusId?: string;
    skip: number;
    take: number;
  }): Promise<ApiOrdenListResult>;
  /**
   * Feature 106/R12/R13/R14/R15/R18: detalle de UNA orden por `num_guia` SOLO si su
   * `tienda_id` = `ownerId` y no esta borrada; `null` en cualquier otro caso (no existe,
   * borrada, o de otro owner -> el service lo traduce a 404 uniforme). Incluye las gestiones
   * con `resultado IN ('entregada','rechazada')` y `evidencia_storage_path` no nulo (evidencias);
   * `[]` si no hay. LEE `gestion_orden`, nunca escribe.
   */
  findDetalleByNumGuiaForOwner(numGuia: number, ownerId: string): Promise<ApiOrdenDetalleRow | null>;

  // --- Feature 177: consulta por identificador libre + PDF de etiquetas por API key ---

  /**
   * Feature 177/R6-R12: hasta DOS filas (como maximo una por columna, dado que `num_guia` y
   * `num_remision` son `@unique` GLOBALES por separado) que casan por IGUALDAD EXACTA con el
   * identificador, con el scope FORZADO en el WHERE (`tienda_id = ownerId` +
   * `deleted_at IS NULL`). `identificador.numGuia` es `null` cuando `{id}` no es un entero
   * positivo: en ese caso la condicion sobre `num_guia` NO se emite y la resolucion cae solo
   * en `num_remision` (R8). NUNCA usa `contains`/`startsWith`/`mode` (R10).
   *
   * Devuelve AMBAS coincidencias sin desempatar: la precedencia de R14 (`num_guia` gana) es
   * una regla de NEGOCIO y vive en `ApiOrdenResolucionService`, no en esta query
   * (`docs/architecture.md` §Capas, design §4.2).
   */
  findByGuiaORemisionForOwner(
    identificador: { numGuia: number | null; numRemision: string },
    ownerId: string,
  ): Promise<Array<{ id: string; numGuia: number | null; numRemision: string }>>;
  /**
   * Feature 177/R16/R17: MISMO detalle y MISMA proyeccion que
   * `findDetalleByNumGuiaForOwner`, pero resuelto por `orden.id` (una orden puede tener
   * `num_guia` NULL, asi que la resolucion de la 177 devuelve el id). `null` si no existe,
   * esta borrada o es de otro owner. El metodo de la 106 NO cambia de firma ni de resultado.
   */
  findDetalleByOrdenIdForOwner(ordenId: string, ownerId: string): Promise<ApiOrdenDetalleRow | null>;
  /**
   * Feature 177/R20/R21/R37/R38: lee la referencia persistida del PDF individual
   * (`orden.download_storage_path`) de una orden del owner. `null` = no hay PDF que reusar,
   * incluidas las filas heredadas de la 136/141 que tienen `download_url` poblada y esta
   * columna a NULL (R38). NUNCA lee `download_url`.
   */
  findDownloadStoragePathByOrdenForOwner(ordenId: string, ownerId: string): Promise<string | null>;
  /**
   * Feature 177/R20/R26: escribe SOLO `orden.download_storage_path`. El `data` del UPDATE
   * lleva UNA sola clave: no toca `download_url`, `estatus_id`, `num_guia`, `carga_id` ni
   * ninguna otra columna, y no escribe historial.
   */
  setOrdenDownloadStoragePath(ordenId: string, path: string): Promise<void>;
  /**
   * Feature 177/R29/R32: carga propia (`usuario_carga = ownerId`) con la referencia
   * persistida de su PDF consolidado y los ids de sus ordenes VIVAS del owner
   * (`tienda_id = ownerId` + `deleted_at IS NULL`). `null` si la carga no existe o es de
   * otro usuario (el service lo traduce a un 404 identico: no filtra existencia).
   */
  findCargaConOrdenesForOwner(
    cargaId: string,
    ownerId: string,
  ): Promise<{ downloadStoragePath: string | null; ordenIds: string[] } | null>;
  /**
   * Feature 177/R30/R35: escribe SOLO `carga.download_storage_path`. El `data` del UPDATE
   * lleva UNA sola clave: no toca `download_url` ni ninguna otra columna de `carga`.
   */
  setCargaDownloadStoragePath(cargaId: string, path: string): Promise<void>;

  /**
   * Feature 106/R19-R26: cancela UNA orden del owner en una sola transaccion (R25). Pre-lee la
   * orden por `num_guia` DENTRO de la tx exigiendo `tienda_id = ownerId` y `deleted_at IS NULL`
   * (R23/R24 -> `not_found`); si su estado NO es cancelable (`en_bodega_central` /
   * `en_ruta_bodega_central`) devuelve `conflict` sin tocar nada (R20). En estado cancelable
   * hace `UPDATE orden.estatus_id = devueltaOrigenEstatusId` e invoca `appendCambioEstado` con
   * `origenTipo:'cancelacion_api'` y `motivo:'cancelada por tienda'` en la MISMA tx (R21/R22/R26);
   * NO escribe en `gestion_orden`.
   */
  cancelarViaApi(params: {
    numGuia: number;
    ownerId: string;
    devueltaOrigenEstatusId: string;
  }): Promise<CancelarViaApiResult>;
  // BORRADO 2026-08-07 (tanda 2): aqui se declaraba `create`, el insert de UNA orden (alta
  // manual). Sin llamador desde que se retiro `OrdenService.crear`. El insert vivo es EN
  // LOTE: `createManyOrdenes` y `createManyOrdenesConGuia`, mas abajo. El argumento sobre
  // `opciones.conGuia` que vivia en este jsdoc sigue siendo valido y esta en el de
  // `createManyOrdenesConGuia`.
  /** Excluye borradas (deleted_at IS NOT NULL); null si no existe o esta borrada (R34). */
  findById(id: string): Promise<OrdenDTO | null>;
  list(params: ListOrdenesParams): Promise<ListOrdenesResult>;
  /**
   * Aplica cambios solo si la orden existe y no esta borrada; null si no (R36).
   * Feature 49/#11 (R19/R20): SI el update cambia `estatus_id`, registra la transicion en
   * el historial (origen = estatus previo pre-leido, destino = nuevo, `origenTipo` =
   * `ajuste_estado`) en la MISMA tx; si el update NO toca `estatus_id`, no deja rastro.
   */
  update(
    id: string,
    data: UpdateOrdenData,
    historial: HistorialContexto,
  ): Promise<OrdenDTO | null>;
  // BORRADO 2026-08-07 (tanda 2): `softDelete` (unico writer de `deleted_at`) y
  // `existsEstatus`. El predicado `deleted_at IS NULL` sigue vivo en TODAS las lecturas.
  findEstatusIdByValue(value: string): Promise<string | null>;
  /**
   * Feature 27/R15/R16/R17: lee `usuario.fulfillment` de la tienda que realiza la
   * carga masiva (el `adminTienda` autenticado). `false` por defecto si el usuario
   * no resuelve, coherente con el default de la columna (R3).
   */
  findUsuarioFulfillment(usuarioId: string): Promise<boolean>;
  // BORRADO 2026-08-07 (tanda 2): `existsGeo`. Ver la lapida de `GeoExistence` arriba.

  // --- Feature 15: carga masiva (metodos batch, R19/R21/R22/R25/R27) ---

  /**
   * R25: remisiones ya existentes (orden no borrada) de entre las provistas.
   * Mapa num_remision -> estatus.value de la orden existente.
   */
  findExistingRemisiones(nums: string[]): Promise<Map<string, string>>;
  /**
   * R19/R21: TODAS las provincias (catálogo pequeño). El match por nombre lo hace el
   * service normalizando ambos lados (`normalizeName`: minúsculas + sin acentos), por
   * eso NO se filtra por nombre en la query (evita descartar "Bogotá" ante "Bogota").
   */
  findAllProvincias(): Promise<ProvinciaRow[]>;
  /** R19: cantones de las provincias resueltas. */
  findCantonesByProvinciaIds(provinciaIds: string[]): Promise<CantonRow[]>;
  /** R19: distritos de los cantones resueltos. */
  findDistritosByCantonIds(cantonIds: string[]): Promise<DistritoRow[]>;
  /**
   * R27: inserta en lotes de `batchSize` con `skipDuplicates`; devuelve el total insertado.
   * Feature 49/#1 (R9/R8/R20): por cada orden EFECTIVAMENTE insertada (no las duplicadas que
   * `skipDuplicates` saltó) registra una fila de historial (origen null, destino = estado
   * inicial, `origenTipo` = `carga_masiva`, actor = la tienda) en la MISMA tx del chunk.
   *
   * Feature 141 (R15/R16/R17/R34/R35/R36): en esa MISMA tx resuelve la fila de `carga` del
   * lote —CREANDOLA con un id generado por el SERVIDOR si `lote.cargaId` es `null` (R15/R16),
   * o LEYENDOLA y verificando propiedad si viene un token previo (R17/R19)— y escribe
   * `carga_id` en las ordenes que inserta. Solo la resuelve si el batch tiene al menos una
   * fila por insertar (sin lotes huerfanos, R28/R35); las duplicadas que `skipDuplicates`
   * salta conservan su `carga_id` previo (R36). Devuelve el total insertado y el `cargaId`
   * resuelto (`null` si no se creo ni reutilizo ningun lote).
   */
  createManyOrdenes(
    data: CreateOrdenData[],
    batchSize: number,
    historial: HistorialContexto,
    lote: LoteContexto,
  ): Promise<{ inserted: number; cargaId: string | null }>;

  /**
   * Feature 88/R8/R9/R10: inserta en lotes de `batchSize` con `skipDuplicates` (patron
   * `createManyOrdenes`) y, en la MISMA transaccion del chunk, asigna a cada orden
   * EFECTIVAMENTE creada un `num_guia = siguiente_num_guia()` SOLO si `num_guia IS
   * NULL` (idempotente, misma secuencia y guarda que `generarGuiaLote` -> ninguna guia puede
   * colisionar con la feature 17/30) y registra su primera fila de historial (origen null,
   * destino = estado inicial, `origenTipo` = `carga_api`). Las filas duplicadas (saltadas por
   * `skipDuplicates`) NO consumen `num_guia` (R11). Devuelve una fila por orden creada con su
   * `num_guia` asignado. El estado inicial ya viene resuelto en `data[].estatusId`: desde la
   * feature 155 lo decide `resolverDestinoCreacion`, no un literal fijo del service.
   *
   * Feature 155/R11: encola ademas la geocodificacion de cada orden EFECTIVAMENTE insertada,
   * dentro de la misma tx del chunk. Antes NO lo hacia (a diferencia de `createManyOrdenes`):
   * las ordenes de esta ruta nacian sin coordenadas y el gate de asignabilidad de la 92 las
   * bloqueaba despues sin explicacion.
   *
   * Feature 141 (R30/R32/R34/R36): igual que `createManyOrdenes`, resuelve la fila de `carga`
   * del lote y escribe `carga_id` en las ordenes creadas dentro de la MISMA tx. La via API key
   * siempre entra con `lote.cargaId = null`: el repo genera UN id la primera vez y lo REUSA en
   * los batches internos siguientes de la misma llamada (una peticion = un lote, R30).
   * Devuelve las creadas y el `cargaId` resuelto (`null` si no se creo ningun lote).
   */
  createManyOrdenesConGuia(
    data: CreateOrdenData[],
    batchSize: number,
    historial: HistorialContexto,
    lote: LoteContexto,
    /**
     * Feature 155/R21: `conGuia: false` inserta y registra historial igual, pero NO toca la
     * secuencia y devuelve `numGuia: null`. Es un PARAMETRO y no un metodo hermano por el
     * mismo motivo que en `create`: duplicar la tx entera por una sentencia de diferencia es
     * como esta ruta y `createManyOrdenes` acabaron divergiendo. Default `true`.
     */
    opciones?: CreateOrdenOpciones,
  ): Promise<{ creadas: CreateOrdenConGuiaResultRow[]; cargaId: string | null }>;

  // --- Feature 141: persistencia de las URLs de descarga de etiquetas (R47/R48) ---

  /**
   * Feature 141/R47: fija `carga.download_url` del lote con la URL del PDF CONSOLIDADO (modo
   * `consolidate`). Escritura POST-COMMIT de la carga (best-effort en el borde): NO toca
   * ninguna otra columna de `carga` ni ninguna orden.
   */
  setCargaDownloadUrl(cargaId: string, url: string): Promise<void>;
  /**
   * Feature 141/R48: fija `orden.download_url` de cada orden con la URL de SU PDF individual
   * (modo `individual`), en una sola transaccion. Escritura POST-COMMIT: NO toca `carga_id`,
   * `num_guia`, `estatus_id` ni ninguna otra columna. Lista vacia -> no-op.
   */
  setOrdenesDownloadUrl(items: { ordenId: string; url: string }[]): Promise<void>;

  // --- Feature 16: resumen del lote recien cargado (solo lectura) ---

  /**
   * R6/R8/R9/R10: filas del resumen del lote (por `num_remision`), acotadas a la
   * tienda del actor y no borradas. Preserva unicidad de `num_remision`.
   * Feature 159: sobrevive al retiro de la sugerencia de mensajero (design §2.2);
   * su proyeccion ya no incluye ningun campo de mensajero.
   */
  findResumenByNumRemisiones(nums: string[], tiendaId: string): Promise<ResumenCargaOrdenDTO[]>;

  // --- Feature 17: "Generar guia" / asignacion de mensajero (R5/R18-R29) ---

  /**
   * R27/R29: filas de orden por id, INCLUYE borradas (deletedAt !== null) para
   * que el service pueda distinguir "no existe" de "borrada" y reportar el
   * motivo exacto en `conflict.detalle`. Vacio si `ids` esta vacio.
   */
  findByIdsForTransicion(ids: string[]): Promise<OrdenTransicionRow[]>;
  /**
   * Feature 92 (design §7, R8): proyeccion MINIMA que consume el gate de asignabilidad
   * por coordenadas (direccion + coordenadas + `geocode_status`). Metodo PROPIO en vez de
   * cinco columnas mas en `OrdenTransicionRow`: esa fila la consumen media docena de
   * services que no tienen nada que ver con la geocodificacion, y ensancharla les costaria
   * ancho de banda en cada transicion del sistema. Vacio si `ids` esta vacio.
   */
  findParaAsignabilidad(ids: string[]): Promise<OrdenAsignabilidadRow[]>;
  /**
   * Feature 92 (design §5, R35/R37/R38): paradas candidatas de la ruta de UN mensajero —
   * sus ordenes en `en_reparto` no borradas, con sus coordenadas (nullable: una orden sin
   * coordenadas NO se excluye aqui, el service la registra como parada sin posicion, R37).
   * Ordenadas por `createdAt asc`, que es el criterio de recorte de R38.
   */
  findParadasEnReparto(mensajeroId: string): Promise<ParadaRutaRow[]>;
  /**
   * Feature 33 (QR por guia): fila de transicion resuelta por `num_guia` (UNIQUE en
   * `orden`). Como `findByIdsForTransicion`, INCLUYE borradas (`deletedAt !== null`)
   * para que el service distinga "no existe" de "borrada"; `null` si ninguna orden
   * tiene ese `num_guia`.
   */
  findByNumGuiaForTransicion(numGuia: number): Promise<OrdenTransicionRow | null>;
  /**
   * R28: subconjunto de `ids` que corresponde a un usuario con rol `mensajero`,
   * SIN filtro de zona (el filtrado por zona/GAM es la feature 30, ver design.md
   * "Limites"). Feature 159: la referencia cruzada de este comentario apuntaba al
   * metodo gemelo de la carga masiva, retirado con la sugerencia de mensajero.
   */
  findMensajeroIdsValidos(ids: string[]): Promise<Set<string>>;
  /** R28/T15: TODOS los usuarios con rol `mensajero`, SIN filtro de zona. */
  findAllMensajeros(): Promise<MensajeroLiteRow[]>;
  /**
   * Feature 30/R5 + feature 34/R5: usuarios con rol `mensajero` cuyo `zonaId`
   * sea la zona pasada, ordenados por nombre. Filtra por la `zonaId` recibida (el
   * maestro pasa la zona GAM; el adminSatelite pasa su propia zona): un mensajero
   * de otra zona o sin zona NO aparece.
   */
  findMensajerosByZona(zonaId: string): Promise<MensajeroLiteRow[]>;
  /**
   * Feature 30/R6 + feature 34/R9: subconjunto de `ids` que corresponde a un
   * usuario con rol `mensajero` cuyo `zonaId` sea la zona pasada. Defensa en
   * profundidad sobre R5 (el service revalida el mensajero recibido contra la
   * zona del actor, aunque la lista visible ya venga filtrada por zona).
   */
  findMensajeroIdsValidosByZona(ids: string[], zonaId: string): Promise<Set<string>>;
  /**
   * R15/R16: catalogo completo `order_status` (id, value) de solo lectura, para
   * que la UI resuelva `value` -> `estatusId` y siga filtrando `listarOrdenes`
   * por `estatusId` (contrato feature 6/7 intacto).
   */
  listOrderStatus(): Promise<OrderStatusLiteRow[]>;
  /**
   * R5/R19/R25: transaccional (todo-o-nada). Por cada decision, asigna
   * `num_guia = siguiente_num_guia()` SOLO si `num_guia IS NULL`
   * (idempotente, R5) y fija `estatusId`/`mensajeroAsignadoId`; TODAS las
   * decisiones reciben `num_guia` (incluidas las que van a en_bodega_central, R19). El
   * llamador DEBE haber validado el lote completo antes de invocar este metodo
   * (sin validaciones de negocio aqui, solo persistencia).
   */
  generarGuiaLote(
    decisiones: GenerarGuiaDecisionData[],
    historial: HistorialContexto,
  ): Promise<GenerarGuiaResultRow[]>;
  /**
   * R26: fija `mensajeroAsignadoId`/`estatusId` en lote; NUNCA toca `numGuia`
   * (idempotencia R5, esas ordenes ya lo tienen). Devuelve el numero de filas
   * afectadas.
   * Feature 49/#4 (R12/R7/R8): registra la transicion (destino `por_recoger`,
   * `origenTipo` = `asignacion_bodega`) SOLO de las ordenes afectadas, en la MISMA tx.
   */
  asignarBodegaLote(
    ordenIds: string[],
    mensajeroId: string,
    estatusId: string,
    historial: HistorialContexto,
  ): Promise<number>;

  // --- Feature 30: ruteo a bodega satelite (R10/R13) ---

  /**
   * Feature 30/R10/R13: rutea un lote homogeneo de ordenes no-GAM a
   * `en_ruta_bodega_satelite`. Transaccional (todo-o-nada): por cada orden asigna
   * `num_guia = siguiente_num_guia()` SOLO si `num_guia IS NULL`
   * (idempotente, R10), fija `estatusId` y deja `mensajeroAsignadoId = NULL`
   * (R9). El llamador DEBE haber validado el lote (existencia, origen permitido,
   * zona no-GAM) antes de invocar (sin logica de negocio aqui). Devuelve el
   * numero de ordenes ruteadas.
   */
  rutearBodegaSateliteLote(
    ordenIds: string[],
    estatusId: string,
    historial: HistorialContexto,
  ): Promise<number>;

  // --- Feature 32: etiqueta de guia (READ derivado, R1/R3) ---

  /**
   * Feature 32/R1/R3: filas para la etiqueta por id, con los nombres legibles de
   * tienda/zona/provincia/canton/distrito resueltos (no IDs). Filtra
   * `deletedAt: null` para que una orden borrada NO aparezca (el service la
   * reporta como `no_encontrada`, R3). NO filtra por `num_guia`: devuelve filas
   * con `numGuia` posible null y el service decide `sin_guia` (R2). Solo query,
   * sin logica de negocio. Vacio si `ids` esta vacio.
   */
  findEtiquetasByIds(ids: string[]): Promise<EtiquetaRow[]>;
  /**
   * Feature 32/R1/R3 (QR por guia): fila para la etiqueta resuelta por `num_guia`
   * (UNIQUE en `orden`), con los mismos nombres legibles y el mismo filtro
   * `deletedAt: null` que `findEtiquetasByIds` (R3: borrada/inexistente -> `null`).
   * La fila devuelta SIEMPRE tiene `numGuia` no nulo (se busca justamente por el).
   * Solo query, sin logica de negocio.
   */
  findEtiquetaByNumGuia(numGuia: number): Promise<EtiquetaRow | null>;

  // --- Feature 148: manifiesto Excel por lote (READ derivado, R4/R6/R7/R12/R29) ---

  /**
   * Feature 148/R4/R6/R7/R12: filas del manifiesto por id de orden, con el NOMBRE de
   * la zona (R6, no su id), el de la tienda y el del mensajero ASIGNADO resueltos, y
   * `montoCobrar` ya como number|null (Decimal->number, R7). Filtra `deletedAt: null`
   * (R12): una orden borrada NO aparece y el service la reporta como `no_encontrada`.
   * NO filtra por `num_guia`: devuelve filas con `numGuia` posible null y el service
   * deja la celda vacia (R5). Solo query, sin logica de negocio. Vacio si `ids` esta
   * vacio.
   */
  findManifiestoByIds(ids: string[]): Promise<ManifiestoOrdenRow[]>;
  /**
   * Feature 148/R4/R12/R29: mismas filas resueltas por `num_remision`, la UNICA
   * seleccion disponible tras una carga masiva (su `BulkSummary` no lleva ids,
   * design.md §2). Acotado por `tiendaId` —igual que `findResumenByNumRemisiones`—
   * para que el lote no pueda alcanzar ordenes de otra tienda (R29). Mismo filtro
   * `deletedAt: null` (R12). Vacio si `remisiones` esta vacio.
   */
  findManifiestoByRemisiones(
    remisiones: string[],
    tiendaId: string,
  ): Promise<ManifiestoOrdenRow[]>;
  /**
   * Feature 148/R9: `usuario.nombre` del actor que ejecuto la operacion, resuelto
   * server-side por `usuarioId` (espejo de `findUsuarioFulfillment`/`findUsuarioZonaId`).
   * Alimenta la columna `responsable` cuando el flujo NO deja mensajero asignado
   * (design.md §9.8). `null` si el usuario no resuelve. `Actor` solo lleva
   * `{ usuarioId, rol }`, por eso el nombre se lee aqui y no viaja desde el borde.
   */
  findUsuarioNombre(usuarioId: string): Promise<string | null>;

  // --- Feature 33: recepcion por QR en la bodega satelite (R4/R5/R6/R8/R11/R18) ---

  /**
   * Feature 33/R4/R5: `usuario.zonaId` del adminSatelite autenticado, resuelto
   * server-side por `usuarioId` (espejo de `findUsuarioFulfillment`). `null` si
   * el usuario no resuelve o no tiene zona asignada (R5: modulo vacio + sin_zona
   * en la recepcion). No hay logica de negocio: solo la query.
   */
  findUsuarioZonaId(usuarioId: string): Promise<string | null>;
  /**
   * Feature 39/R1/R4: `usuario.vehiculoId` del mensajero, resuelto server-side por
   * `usuarioId` (espejo de `findUsuarioZonaId`). `null` si el usuario no resuelve o no
   * tiene vehiculo asignado -> el resolver de tarifa cae a la tarifa por defecto de la
   * zona (vehiculo_id IS NULL). Solo la query, sin logica de negocio.
   */
  findUsuarioVehiculoId(usuarioId: string): Promise<string | null>;
  /**
   * Feature 33/R6/R8/R9: ordenes NO borradas (`deletedAt: null`) de `zonaId`
   * cuyo `estatus.value` esta en `estatusValues` (["en_ruta_bodega_satelite",
   * "en_bodega_satelite"]), con los nombres legibles de tienda/geografia (patron
   * `findEtiquetasByIds`). El service parte en "Por recibir"/"Recibidas" por el
   * `estatusValue`. Solo query. Vacio si `estatusValues` esta vacio.
   */
  findRecepcionSateliteByZona(
    zonaId: string,
    estatusValues: string[],
  ): Promise<RecepcionSateliteRow[]>;
  /**
   * Feature 170 — FASE 2 (T K.1, R40/R41/R44/R45/R51): UNA pagina del listado «Órdenes de la
   * bodega» mas el TOTAL del conjunto que casa el filtro, resueltos los dos en la base.
   *
   * Es el hermano paginado de `findRecepcionSateliteByZona`, con dos diferencias que no son
   * de forma:
   *
   *  - **los tres filtros del cliente viajan en `filtro`** (estado ∧ canton ∧ distrito) y se
   *    aplican al CONJUNTO, no a la pagina;
   *  - **el orden lleva el rango de GRUPO por delante** (`ESTADOS_BODEGA_SATELITE`), que es
   *    lo que hoy produce la concatenacion de los cinco arrays en el modulo. Sin el, las
   *    filas cambiarian de pagina respecto a lo que la pantalla enseña hoy (R51).
   *
   * `total` cuenta el conjunto entero, nunca la pagina (R41). Solo query.
   */
  findRecepcionSatelitePaginada(
    filtro: RecepcionSateliteFiltro,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<RecepcionSateliteRow>>;
  /**
   * Feature 184 — Tanda A (T A.1, R1/R2/R15/R16): el CONJUNTO FILTRADO ENTERO del mismo
   * listado, sin recorte, para producir el archivo de la descarga.
   *
   * Comparte con `findRecepcionSatelitePaginada` el criterio y el orden —los dos salen del
   * mismo fragmento SQL, no de dos declaraciones parecidas—, asi que la fila N del archivo es
   * la fila N que la pantalla enseña paginando (R5/R16). Lo unico que NO lleva es
   * `LIMIT`/`OFFSET`.
   *
   * El tope de filas es una regla de NEGOCIO y no se evalua aqui (R6: lo aplica el servicio).
   * Vacio si `estatusValues` esta vacio. Solo query.
   */
  findRecepcionSateliteCompleta(
    filtro: RecepcionSateliteFiltro,
  ): Promise<RecepcionSateliteRow[]>;
  /**
   * Feature 184 — Tanda A (T A.2, R19/R21): cuales de `ids` siguen perteneciendo al conjunto
   * filtrado. Es la comprobacion con la que la pantalla PODA su seleccion cuando una orden
   * marcada deja de estar en el listado.
   *
   * Devuelve los VIGENTES (subconjunto de `ids`), nunca los caducados: una respuesta vacia por
   * error no puede leerse como «desmarca todo». El acotamiento del listado —zona, no borradas,
   * estados y filtros vigentes— se repite ENTERO en el `WHERE`: el `IN` de ids no es la guarda,
   * porque los ids los propone el cliente (R21).
   *
   * Una sola consulta de UNA columna. Vacio —y sin consultar— si `ids` o `estatusValues` estan
   * vacios. Solo query.
   */
  findIdsVigentesEnBodega(
    filtro: RecepcionSateliteFiltro,
    ids: readonly string[],
  ): Promise<string[]>;
  /**
   * Feature 170 — FASE 2 (T K.2, R44/R46): los pares canton/distrito DISTINTOS del conjunto
   * del actor (su zona + los estados del listado), para las OPCIONES de los desplegables.
   *
   * Se lee el conjunto COMPLETO a proposito: R46 exige que las opciones sigan siendo las de
   * todas las filas del actor y no las de la pagina visible. Se piden solo los tres nombres
   * de geografia —lo unico que el desplegable necesita— y filas repetidas se descartan en la
   * base. Solo query.
   */
  findRecepcionSateliteGeoByZona(
    zonaId: string,
    estatusValues: string[],
  ): Promise<ZonaDeOrden[]>;
  /**
   * Feature 33/R11/R18: transicion atomica y concurrencia-segura de UNA orden a
   * `en_bodega_satelite`. UPDATE guardado por estado de ORIGEN (solo si sigue en
   * `en_ruta_bodega_satelite`), zona (`zonaId`) y no borrada (`deletedAt IS
   * NULL`). Devuelve `true` si afecto 1 fila (recibida), `false` si 0 (ya no
   * estaba en el origen -> race). NO toca `mensajeroAsignadoId` ni `numGuia` (R11).
   */
  recibirEnSatelite(
    ordenId: string,
    zonaId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean>;
  /**
   * Recepcion en la tienda de ORIGEN: transicion atomica y concurrencia-segura de
   * UNA orden a `devuelta_a_tienda`, cerrando el flujo de devolucion. Espejo de
   * `recibirEnSatelite` cambiando la guarda de zona por la de TIENDA: UPDATE
   * guardado por estado de origen (solo si sigue en `devolviendo_a_tienda`), tienda
   * duenna (`tiendaId`) y no borrada. Devuelve `true` si afecto 1 fila, `false` si
   * 0 (ya no estaba en el origen -> race). NO toca `mensajeroAsignadoId` ni
   * `numGuia`.
   */
  recibirEnOrigen(
    ordenId: string,
    tiendaId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean>;

  // --- Feature 138 + 139: recepcion por QR en la bodega CENTRAL (STATE-AWARE) ---

  /**
   * Feature 138/R2/R3/R9/R18 + feature 139/R17 (STATE-AWARE): recepcion en la BODEGA CENTRAL:
   * transicion atomica y concurrencia-segura de UNA orden a `destinoEstatusId`, con el par
   * ORIGEN->DESTINO resuelto por el SERVICE segun el estado de origen de la orden:
   *   - `en_ruta_bodega_central` -> `en_bodega_central` (caso 138: cierra el dead-end de la carga API).
   *   - `devolviendo_a_bodega_central` -> `por_devolver_a_tienda` (caso 139: retorno satelite).
   * UN solo escaner/accion. Espejo de `recibirEnOrigen`/`recibirEnSatelite` pero SIN guarda de
   * tienda ni de zona: la bodega central es global (R11). UPDATE guardado SOLO por estado de ORIGEN
   * (`estatus.value = origenValue`, pasado por el service) + no borrada (`deletedAt IS NULL`); origen
   * pre-leido bajo la misma guarda y append del historial (`origenTipo` = el pasado en `historial`,
   * `recepcion_bodega_central` en ambos casos) en la MISMA tx, SOLO si transiciono. Devuelve `true`
   * si afecto 1 fila (recibida), `false` si 0 (ya no estaba en el origen -> race). NO toca
   * `mensajeroAsignadoId` ni `numGuia` (R18).
   */
  recibirEnBodegaCentral(
    ordenId: string,
    origenValue: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean>;

  // --- Feature 157: recoleccion en tienda por el mensajero (R3-R5, R26-R38) ---

  /**
   * Feature 157 (regla de dedicacion) — de `ids`, los mensajeros con AL MENOS una orden VIVA
   * en alguno de los `estados`. El llamador decide que cuenta como "ocupado": el reparto y la
   * recoleccion se excluyen mutuamente, pero varias recolecciones conviven (un viaje a la
   * tienda son N ordenes).
   */
  findMensajerosConOrdenesEn(ids: string[], estados: string[]): Promise<Set<string>>;

  /**
   * Feature 157 (R3/R5/R38, ampliada 2026-07-31): asigna el mensajero que ira a la tienda y
   * TRANSICIONA el lote de `origenValue` (`por_recolectar_en_tienda`) a `destinoEstatusId`
   * (`recolectando`), con su rastro (`asignacion_recoleccion`) en la MISMA tx.
   *
   * Antes solo escribia el mensajero: la orden se quedaba en el estado de espera, seguia
   * ofreciendose como asignable y se podia reasignar indefinidamente. NO estampa `asignadoAt`
   * (R38: denominador del ranking), ni toca `numGuia` ni `prioridad`. Todo-o-nada (R5).
   */
  asignarRecoleccionLote(
    ordenIds: string[],
    mensajeroId: string,
    origenValue: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number>;

  /**
   * Feature 157 (ampliacion 2026-07-31): revierte la asignacion — `recolectando` ->
   * `por_recolectar_en_tienda`— dejando la orden SIN mensajero, para que vuelva al monton de
   * asignables. Es el camino explicito que sustituye a la reasignacion silenciosa: cambiar de
   * mensajero exige revertir primero, y las dos mitades quedan en el historial. Familia
   * `deshacer_asignacion` (149). Todo-o-nada.
   */
  desasignarRecoleccionLote(
    ordenIds: string[],
    origenValue: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number>;

  /**
   * Feature 157 (R26/R28/R34/R35): transiciona `por_recolectar_en_tienda ->
   * en_ruta_bodega_central` (arista #43) la orden del mensajero que la recolecta. Espejo de
   * `recibirEnBodegaCentral` con `mensajeroAsignadoId` en la guarda atomica (ambos `where`),
   * de modo que la PROPIEDAD no dependa de una comprobacion previa (R34). Append del historial
   * (`origenTipo` = `recoleccion_tienda`) en la MISMA tx y SOLO si transiciono. NO toca
   * `numGuia` ni `mensajeroAsignadoId` (R35). Devuelve `true` si afecto 1 fila, `false` si 0
   * (ya no estaba en el origen, o no es suya -> race).
   */
  recolectarEnTienda(
    ordenId: string,
    origenValue: string,
    destinoEstatusId: string,
    mensajeroId: string,
    historial: HistorialContexto,
  ): Promise<boolean>;

  /**
   * Feature 63 — recepcion EN LOTE en la bodega satelite (paridad con el "Recoger
   * todas" del mensajero). Transiciona un lote de ordenes a `en_bodega_satelite`
   * con escritura GUARDADA por estado de ORIGEN + zona (patron `asignarSateliteLote`):
   * UPDATE raw con `WHERE id IN (ordenIds) AND estatus_id = origenEstatusId AND
   * zona_id = zonaId AND deleted_at IS NULL RETURNING "id"` dentro de un
   * `$transaction`, + append de historial (origenTipo `recepcion_satelite`) de EXACTAMENTE
   * las filas retornadas, en la MISMA tx. Concurrencia-segura e idempotente: una orden
   * de otra zona, en otro estado, borrada o re-ejecutada NO aparece en el RETURNING
   * (no se toca, no deja rastro). NO toca `mensajeroAsignadoId` ni `numGuia`. Devuelve
   * el numero de filas efectivamente recibidas.
   */
  recibirLoteEnSatelite(
    ordenIds: string[],
    zonaId: string,
    origenEstatusId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number>;

  // --- Feature 34: asignacion satelite a mensajeros de la zona (R7/R14) ---

  /**
   * Feature 34/R7/R14: transiciona un lote de ordenes a `por_recoger`
   * fijando `mensajeroAsignadoId`, con escritura GUARDADA por estado de origen +
   * zona (patron `recibirEnSatelite`): `updateMany` con
   * `WHERE id IN (ordenIds) AND estatusId = origenEstatusId AND zonaId AND
   * deletedAt IS NULL`. Concurrencia-segura: una orden que ya cambio de estado o
   * de zona entre la lectura y la escritura NO se toca. Usa `estatusId` (el id del
   * estado de origen ya resuelto por el service via `findEstatusIdByValue`), NO la
   * relacion `estatus.value`. NUNCA toca `numGuia` (R8; las ordenes ya lo tienen
   * del ruteo a satelite). Devuelve el numero de filas efectivamente
   * transicionadas (el service compara con `ordenIds.length` para detectar carrera).
   */
  asignarSateliteLote(
    ordenIds: string[],
    mensajeroId: string,
    zonaId: string,
    destinoEstatusId: string,
    origenEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number>;

  // --- Feature 149: deshacer asignacion / ruteo antes de la recogida (R8-R10/R20/R21) ---

  /**
   * Feature 149 (design §3.2) — REVIERTE un lote de asignaciones/ruteos en UNA transaccion.
   * Por cada item hace un UPDATE crudo GUARDADO por estado de ORIGEN (el de
   * `origenEstatusIdPorOrden`, que el service leyo antes) + `deleted_at IS NULL` + `zona_id`
   * cuando `zonaId` no es null (caso `adminSatelite`, defensa en profundidad anti-TOCTOU), con
   * `RETURNING "id"`. El `SET` fija `estatus_id` al destino, `mensajero_asignado_id = NULL` y
   * `asignado_at = NULL` (R8/R9/R10), y NO menciona `num_guia` (D2/R29) ni `prioridad`
   * (Q2/R30): la ausencia es el mecanismo.
   *
   * SIN guarda de `cierre_dia` (Q1 CERRADA, R19): a diferencia de `asignarSateliteLote`, este
   * writer NO consulta cierres — el cierre pendiente del mensajero NO bloquea el deshacer. La
   * asimetria con la ASIGNACION es deliberada (design §8-Q1).
   *
   * TODO-O-NADA REAL (R20/R21): si el total de filas devueltas es distinto de `items.length`,
   * LANZA `DeshacerAsignacionConflictoError` con los ids que no transicionaron; el `throw`
   * revierte la `$transaction` completa, sin efectos parciales.
   *
   * Tras el UPDATE, y en la MISMA tx, `appendCambioEstado` registra una fila de historial por
   * orden (`origen_tipo = deshacer_asignacion`, `motivo` = el del lote) y encola el webhook de
   * estado (R31/R32/R33). Devuelve el numero de ordenes revertidas (== `items.length`).
   */
  deshacerAsignacionLote(
    items: readonly DeshacerAsignacionItem[],
    origenEstatusIdPorOrden: ReadonlyMap<string, string>,
    historial: HistorialContexto & { motivo: string },
    zonaId: string | null,
  ): Promise<number>;

  // --- Feature 41: bloqueo derivado en asignacion (R12/R16/R17/R23) ---

  /**
   * R12/R16: de `ids`, subconjunto de mensajeros BLOQUEADOS = tienen al menos un
   * `cierre_dia` en estado bloqueante (`solicitado` o `vencido`). `rechazado`/`aprobado`
   * NO bloquean (R16). Usa el indice (mensajero_id, estado). Vacio si `ids` esta vacio.
   */
  findMensajerosBloqueados(ids: string[]): Promise<Set<string>>;
  /**
   * Zonas (central y satelite) con AL MENOS 1 mensajero con un cierre abierto
   * (`solicitado`/`vencido`): misma regla y mismos estados que la causa (i) de
   * `existeBodegaSateliteBloqueada`, para que el gate de lectura de la UI y la guarda de
   * escritura del servidor no diverjan. Una zona sin mensajeros nunca aparece. La
   * pertenencia se lee de `usuario.zonaId`, no del snapshot `cierre_dia.destino_zona_id`.
   */
  findZonasConMensajeroBloqueado(): Promise<Set<string>>;
  /**
   * R17 (regla estricta F1.4-Q4): la bodega satelite de `zonaId` esta BLOQUEADA para
   * asignar a sus mensajeros si existe CUALQUIERA de: (i) un `cierre_dia`
   * `destino_tipo='bodega_satelite'`, `destino_zona_id=zonaId`, `estado IN
   * ('solicitado','vencido')`; O (ii) un `cierre_bodega` `zona_id=zonaId`,
   * `estado='solicitado'` (su propio cierre hacia la central pendiente; mismo criterio
   * que la guardia de unicidad de la feature 40, respaldado por su indice unico parcial).
   * Devuelve los dos flags + `bloqueada = i || ii` para que el borde distinga el motivo.
   */
  existeBodegaSateliteBloqueada(zonaId: string): Promise<BodegaBloqueoResult>;

  // --- Feature 87/89: lista de novedades (devoluciones del mensajero de la tienda) ---

  /**
   * Feature 99/R7/R8 (Q7): cuenta las NOVEDADES de `tiendaId`. El predicado se ANCLA AL ESTADO
   * REAL: una orden es novedad si su estatus ACTUAL es `devuelta` (R7), es de la tienda (R9) y no
   * esta borrada (R5). Bajo la feature 99 la orden REPOSA en `devuelta` hasta que el cron SLA la
   * libere/escale o la 100 la resuelva; al salir cae del conteo sin doble conteo (R8). Reemplaza
   * el predicado por gestion vigente + estatus abierto de la feature 89 (ya innecesario).
   * Alimenta el `total` paginado; comparte `where` con `findDevueltasByTienda` (R8).
   */
  countDevueltasByTienda(tiendaId: string): Promise<number>;
  /**
   * Feature 99/R7/R8/R9 (Q7): una PAGINA de NOVEDADES de `tiendaId` con el MISMO predicado que
   * `countDevueltasByTienda` (estatus actual `= devuelta` + no borrada, R8), ordenada por
   * `Orden.createdAt` desc (fallback; el orden estricto por fecha de la ultima gestion `devuelta`
   * vigente lo aplica el service con la fecha traida por `findCausasDevueltaVigentes`, R9).
   * `skip`/`take` para la paginacion. Solo los campos que consume el DTO + `createdAt`.
   */
  findDevueltasByTienda(
    tiendaId: string,
    pagination: { skip: number; take: number },
  ): Promise<NovedadOrdenRow[]>;
  /**
   * Feature 87/R6/R7/R8 (T2): resuelve la causa de devolucion VIGENTE de TODAS las ordenes
   * de la pagina con UNA sola consulta agregada (evita N+1). `findMany` sobre `gestion_orden`
   * con `resultado: "devuelta", anuladaAt: null` (mismo criterio de vigencia que
   * `contarPorDestinoVigentes`, feature 67), `orderBy createdAt desc`, y reduce en memoria a
   * `Map<ordenId, { causa, fecha }>` quedandose con la fila MAS RECIENTE por orden (R6). Las
   * ordenes sin fila en el mapa (sin gestion vigente) NO aparecen -> causa ausente (R7). `[]`
   * -> `Map` vacio.
   */
  findCausasDevueltaVigentes(ordenIds: string[]): Promise<Map<string, CausaDevueltaVigente>>;

  // --- Feature 102: rechazos por SLA de la tienda (superficie derivada de solo-lectura) ---

  /**
   * Feature 102/R12/R13/R15: cuenta los RECHAZOS POR SLA de `tiendaId`. Predicado (mismo `where`
   * que `findRechazadasSlaByTienda`, R15): la orden es de la tienda del actor, no esta borrada
   * (`deleted_at IS NULL`), su estatus ACTUAL es `rechazada` Y existe una transicion del cron SLA
   * en su historial (`origen_tipo = escalado_devuelta_sla`, feature 99). Al salir de `rechazada` o
   * al borrarse, cae del conteo (R15). Alimenta el `total` paginado.
   */
  countRechazadasSlaByTienda(tiendaId: string): Promise<number>;
  /**
   * Feature 102/R12/R14/R15: una PAGINA de RECHAZOS POR SLA de `tiendaId` con el MISMO predicado
   * que `countRechazadasSlaByTienda`, ordenada por `Orden.createdAt` desc. Por cada orden, el
   * `monto` = `ingreso_bodega_rechazo` de su gestion sintetica SLA (la enlazada por la transicion
   * `origen_tipo = escalado_devuelta_sla`), YA serializado a STRING escala 2; `null` mientras no
   * este snapshoteada (pendiente de cierre, Q2 default). `skip`/`take` para la paginacion.
   */
  findRechazadasSlaByTienda(
    tiendaId: string,
    pagination: { skip: number; take: number },
  ): Promise<RechazoSlaTiendaRow[]>;
}
