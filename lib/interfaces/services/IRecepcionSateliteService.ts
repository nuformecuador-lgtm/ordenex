import type { CreatedPreset, FilaBodegaSatelite, SalioARepartoValor } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 33 — contrato del servicio de la bodega satelite: listar "Mis
// asignaciones" del adminSatelite (dos grupos: por recibir / recibidas) y recibir
// una orden por escaneo de QR (transicion 1-a-1 guardada por estado+zona). Logica
// de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado. Solo el rol `adminSatelite`, SIEMPRE acotado a su `usuario.zonaId`.

/**
 * FICHA 349 (2026-09-01) — EL DTO DEL MODULO SATELITE **ES** LA FILA DEL REPOSITORIO, QUE A SU
 * VEZ **ES** LA DEL LISTADO DE ORDENES (`OrdenListItemDTO`). Un alias, no una tercera lista.
 *
 * ─── QUE ARREGLA ─────────────────────────────────────────────────────────────────────────
 *
 * Habia TRES declaraciones de la misma fila —el `select` del repositorio, `RecepcionSateliteRow`
 * y este DTO— y un mapeo campo a campo entre las dos ultimas. Ese mapeo era el filtro silencioso:
 * un campo que el repositorio empezara a enviar no llegaba a la pantalla hasta que alguien lo
 * copiara a mano, y no copiarlo no rompia nada. Es literalmente como la tabla de la bodega acabo
 * con 12 columnas mientras `/ordenes` tenia 19.
 *
 * ─── QUE SIGNIFICA PARA LA PANTALLA (el contrato) ────────────────────────────────────────
 *
 * La fila trae ahora, ademas de lo que ya traia:
 *
 *   · `createdAt: Date`                          — «Fecha de creación» y «Tiempo»
 *   · `relaciones.mensajeroAsignado`              — «Mensajero» (nombre ya resuelto, no el id)
 *   · `fechaReprogramacion: string | null`        — «Liberada el» (`YYYY-MM-DD`, ya serializada)
 *   · `relaciones.{estatus,tienda,zona,provincia,canton,distrito}` — lo mismo que `/ordenes`
 *
 * Y NO trae, a proposito (feature 260/R13, decision firmada): `fleteConIva`, `comisionConIva`
 * ni `relaciones.tienda.tarifa` —de donde sale el fulfillment—, ni el correo/telefono de la
 * tienda. La capa de datos los retira con `recortarPorAlcance(..., "zona")` ANTES de devolver
 * la fila: no es que la pantalla no los pinte, es que no viajan. `montoCobrar` SI se conserva
 * (R17): el satelite ya lo ve en su propia pantalla de recepcion.
 *
 * Consecuencia buscada: `Column<OrdenListItemDTO>[]` es asignable a `Column<RecepcionSateliteDTO>[]`
 * sin un solo cast, asi que la tabla de la bodega puede montar `ordenesColumns` —menos las tres
 * columnas de dinero, exactamente como hace `columnasDetalle` en `/monitoreo`— en vez de declarar
 * una segunda lista de columnas que vuelva a quedarse atras.
 */
export type RecepcionSateliteDTO = FilaBodegaSatelite;

// R3/R4/R5/R6/R8: dos grupos separados (por recibir vs recibidas) + nombre de la
// zona del actor y `sinZona` (adminSatelite sin zona asignada -> listas vacias +
// aviso accionable, R5). `forbidden` si el rol no es adminSatelite (R3/R17).
export type ListarRecepcionSateliteServiceResult =
  | {
      status: "ok";
      porRecibir: RecepcionSateliteDTO[];
      recibidas: RecepcionSateliteDTO[];
      // Feature 139/T2.5/R21: ordenes en estado `por_devolver` de la MISMA zona del adminSatelite,
      // elegibles para la accion (por lote) "Enviar a central" (transicion
      // por_devolver -> devolviendo_a_bodega_central la ejecuta EnvioDevolucionCentralService).
      // REEMPLAZA el viejo scope `rechazada` (feature 48): la rechazada sale de ese estado solo al
      // aprobar el cierre, que la deja en `por_devolver`. Acotado server-side por zona
      // (findRecepcionSateliteByZona(zonaId, ...)); un adminSatelite NO ve las de otra zona. Solo
      // listado; la autz de ejecutar el envio la impone EnvioDevolucionCentralService (rol + zona).
      porDevolver: RecepcionSateliteDTO[];
      // Feature 139/T2.5/R21: ordenes en estado `devolviendo_a_bodega_central` de la MISMA zona,
      // INFORMATIVAS (ya enviadas y en transito a la central; la recepcion la hace la central por QR,
      // no el satelite). Acotado server-side por zona; solo lectura, sin accion desde satelite.
      enTransitoACentral: RecepcionSateliteDTO[];
      // Feature 100/T4.1/R12: ordenes en estado `devuelta` (novedad que reposa bajo la
      // feature 99) de la MISMA zona del adminSatelite, elegibles para "Recuperar a bodega"
      // (transicion devuelta -> en_bodega_satelite la ejecuta RecuperacionBodegaService).
      // Acotado server-side por zona (findRecepcionSateliteByZona(zonaId, ...)); un
      // adminSatelite NO ve devueltas de otra zona. Solo listado; la autz de ejecutar la
      // recuperacion la impone RecuperacionBodegaService (rol + zona).
      devueltas: RecepcionSateliteDTO[];
      // Feature 149/T6.3/R35: ordenes en estado `por_recoger` de la MISMA zona del adminSatelite
      // —ya asignadas a un mensajero que AUN no las recogio—, elegibles para la accion por lote
      // "Deshacer asignacion" (transicion por_recoger -> en_bodega_satelite la ejecuta
      // `DeshacerAsignacionService`, que deriva el destino del historial). Acotado server-side por
      // zona (`findRecepcionSateliteByZona(zonaId, ...)`): un adminSatelite NO ve —ni puede
      // deshacer— las de otra zona. Solo listado; la autz de ejecutar la reversion (rol + zona +
      // destino derivado = `en_bodega_satelite`) la impone el service de la 149.
      // R36: el caso (b) (`en_ruta_bodega_satelite`) NO entra aqui — sigue en `porRecibir`, sin
      // accion de deshacer: es competencia de la bodega central.
      asignadas: RecepcionSateliteDTO[];
      zonaNombre: string | null;
      sinZona: boolean;
    }
  | { status: "forbidden" };

/**
 * Feature 170 — FASE 2 (T K.1, R40/R44/R45) — entrada del listado «Órdenes de la bodega»
 * paginado. `page`/`pageSize` llegan YA validados y acotados por el schema del borde.
 *
 * Los tres filtros son los MISMOS que hasta ahora resolvia el navegador, con su misma
 * semantica: lista ausente o vacia = «todos», y los tres se cruzan en AND. Aqui NO hay —ni
 * puede haber— una clave de alcance (`zonaId`): la zona sale del actor, siempre.
 */
export interface ListarOrdenesBodegaPaginadoInput
  extends ListarOrdenesBodegaCompletoInput {
  page: number;
  pageSize: number;
}

/**
 * Feature 170 — FASE 2 (T K.1) — la pagina del listado. Contrato COMUN de T H.2, sin un solo
 * campo extra: `zonaNombre` y `sinZona` siguen saliendo de `listar()`, que la pantalla
 * tambien llama (y que ademas le da «Por recibir»).
 */
export type ListarOrdenesBodegaPaginadoServiceResult =
  ListarPaginadoServiceResult<RecepcionSateliteDTO>;

/**
 * Feature 184 — Tanda A (T A.3, R1/R3/R4) — entrada del CONJUNTO del listado «Órdenes de la
 * bodega» para la descarga: los MISMOS filtros de la pagina, sin `page`/`pageSize`.
 *
 * Aqui tampoco hay —ni puede haber— una clave de alcance: la zona sale del actor, siempre.
 */
export interface ListarOrdenesBodegaCompletoInput {
  /** `estatus.value` elegidos; se intersecan con la lista blanca de los cinco (R4). */
  estados?: string[];
  /**
   * Pedido humano (2026-08-19) — geografia, tiempo y buscador con las MISMAS claves y la
   * MISMA semantica que el `filter` de `/ordenes`: esta pantalla monta aquella barra, sin la
   * zona (sale del actor) ni la tienda (no ve el directorio de cuentas).
   *
   * Geografia por ID (antes eran nombres): las opciones salen de la geografia de la ZONA del
   * actor. Lista ausente o vacia = todas; las tres se cruzan en AND.
   */
  /**
   * Pedido humano (2026-08-25) — mensajeros ASIGNADOS elegidos; ausente = todos. Las opciones
   * salen del catalogo del rol, que para el adminSatelite son los mensajeros de SU zona. No
   * amplia nada: el acotamiento por zona del listado se impone igual.
   */
  mensajero_id?: string[];
  provincia_id?: string[];
  canton_id?: string[];
  /** Con distritos elegidos, una orden SIN distrito queda fuera del conjunto. */
  distrito_id?: string[];
  /**
   * Filtro de creacion: atajo de antiguedad O rango de fechas calendario, nunca los dos
   * (el borde lo rechaza). El servicio los traduce a instantes con el huso de Costa Rica; el
   * cliente no manda instantes jamas.
   */
  created_preset?: CreatedPreset;
  created_desde?: string;
  created_hasta?: string;
  /** Termino del buscador, ya validado por el borde (minimo y maximo de `/ordenes`). */
  q?: string;
  /**
   * FICHA 370 — «salida a reparto», la MISMA clave publica y los MISMOS dos valores que
   * `/ordenes` (`SALIO_A_REPARTO_VALORES`): `ya_salio` para las que ya salieron con un mensajero
   * alguna vez, `nunca_salio` para las que solo tienen la guia generada. AUSENTE = no filtra y
   * salen los dos grupos.
   *
   * No es una clave de alcance: PARTE lo que el adminSatelite ya puede ver (su bodega), no lo
   * ensancha. El servicio la traduce con el util compartido y llega a los TRES caminos del
   * listado —pagina, descarga y vigencia de la seleccion—, que miran el mismo conjunto.
   */
  salio_a_reparto?: SalioARepartoValor;
}

/**
 * Feature 184 — Tanda A (T A.3, R6): el conjunto entero o el aviso de tope, nunca las dos cosas
 * ni un conjunto truncado. El tope (`descargaConfig.MAX_FILAS`) se evalua AQUI, en el servidor.
 */
export type ListarOrdenesBodegaCompletoServiceResult =
  ListarCompletoServiceResult<RecepcionSateliteDTO>;

/**
 * Feature 184 — Tanda A (T A.3, R19/R21) — entrada de la comprobacion de vigencia: los filtros
 * VIGENTES del listado mas los identificadores marcados fuera de la pagina visible.
 *
 * Los filtros no son decorativos: la pertenencia se decide sobre el conjunto FILTRADO (R19), que
 * es lo que el usuario esta viendo, y no sobre «todo lo de la zona».
 */
export interface ListarIdsVigentesBodegaInput extends ListarOrdenesBodegaCompletoInput {
  /** Identificadores por los que se pregunta. Vacio -> `[]` sin consultar (R23). */
  ids: string[];
}

/**
 * Feature 184 — Tanda A (T A.3, R21/R22): los que SIGUEN en el conjunto, subconjunto de los
 * preguntados. Un id fuera del alcance del actor simplemente no vuelve, y de el no viaja ningun
 * dato. `forbidden` si el rol no es adminSatelite.
 */
export type ListarIdsVigentesBodegaServiceResult =
  | { status: "ok"; ids: string[] }
  | { status: "forbidden" };

// R11-R18: maquina de resultados de la recepcion por QR (design §2.3). Todos los
// rechazos son SIN efectos en datos; `ok` transiciona a en_bodega_satelite.
// `estado_invalido` reporta el estado actual (R13). `validation_error` cubre el
// catalogo de estados incompleto (seed pendiente del destino). `conflict` cubre la
// carrera irresoluble (la orden se movio a un estado inesperado entre lectura y
// escritura, R18).
export type RecibirServiceResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_satelite" } // R11
  | { status: "forbidden" } // R17
  | { status: "sin_zona" } // R5
  | { status: "zona_ajena" } // R12
  | { status: "estado_invalido"; estado: string } // R13
  | { status: "ya_recibida" } // R14 (idempotente)
  | { status: "no_encontrada" } // R15 (inexistente o borrada)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // catalogo incompleto
  | { status: "conflict" }; // R18 (race irresoluble)

export interface IRecepcionSateliteService {
  /**
   * R3/R4/R5/R6/R8: lista los dos grupos de la zona del adminSatelite (por
   * recibir = en_ruta_bodega_satelite, recibidas = en_bodega_satelite). Rol !=
   * adminSatelite -> forbidden; sin zona -> listas vacias + sinZona.
   */
  listar(actor: Actor): Promise<ListarRecepcionSateliteServiceResult>;
  /**
   * Feature 170 — FASE 2 (T K.1, R40/R41/R44/R45/R51): UNA pagina del listado «Órdenes de la
   * bodega» (los cinco estados que hoy concatena el modulo), con los TRES filtros —estado ∧
   * canton ∧ distrito— resueltos en el SERVIDOR y el total del conjunto.
   *
   * Mismo acotamiento que `listar`: rol `adminSatelite` (R3/R17) y zona resuelta desde el
   * USUARIO (R4). Sin zona -> pagina vacia, no `forbidden`: el rol tiene acceso al modulo, lo
   * que no tiene es alcance. Filtrar NUNCA amplia ese acotamiento.
   */
  listarOrdenesBodegaPaginado(
    input: ListarOrdenesBodegaPaginadoInput,
    actor: Actor,
  ): Promise<ListarOrdenesBodegaPaginadoServiceResult>;
  /**
   * Feature 184 — Tanda A (T A.3, R1/R2/R4/R6/R11): el CONJUNTO filtrado entero del mismo
   * listado, para producir el archivo. Mismo guard de rol, misma zona del actor y la MISMA
   * lista blanca de estados que la pagina: descargar no amplia el alcance ni una fila.
   *
   * El tope de filas se evalua aqui (R6): superarlo NO entrega filas ni un conjunto truncado,
   * devuelve el total encontrado y el tope vigente. Sin zona -> conjunto vacio, no `forbidden`.
   */
  listarOrdenesBodegaCompleto(
    input: ListarOrdenesBodegaCompletoInput,
    actor: Actor,
  ): Promise<ListarOrdenesBodegaCompletoServiceResult>;
  /**
   * Feature 184 — Tanda A (T A.3, R19/R21/R23): cuales de los identificadores preguntados
   * siguen perteneciendo al conjunto filtrado. Es lo que permite PODAR la seleccion cuando una
   * orden marcada deja de estar en el listado.
   *
   * Se decide sobre el CONJUNTO con los filtros vigentes, nunca sobre la pagina visible (R19), y
   * acotado al alcance del actor: un id de otra zona vuelve como no vigente y de el no se revela
   * nada (R21). Sin ids —o sin zona— devuelve `[]` sin consultar (R23).
   */
  listarIdsVigentesBodega(
    input: ListarIdsVigentesBodegaInput,
    actor: Actor,
  ): Promise<ListarIdsVigentesBodegaServiceResult>;
  /**
   * R11-R18: recibe una orden por su `num_guia` (lo que codifica el QR:
   * `/paquete/<numGuia>`). Transiciona a en_bodega_satelite solo si sigue en
   * en_ruta_bodega_satelite y es de la zona del actor; idempotente si ya estaba
   * recibida (R14). Sin orden con ese `num_guia` -> no_encontrada (R15).
   */
  recibir(numGuia: number, actor: Actor): Promise<RecibirServiceResult>;
}
