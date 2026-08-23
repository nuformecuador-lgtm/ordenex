import type { CreatedPreset } from "@/lib/types/orden";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type { ListarPaginadoServiceResult } from "@/lib/types/listado-paginado";

// Feature 33 — contrato del servicio de la bodega satelite: listar "Mis
// asignaciones" del adminSatelite (dos grupos: por recibir / recibidas) y recibir
// una orden por escaneo de QR (transicion 1-a-1 guardada por estado+zona). Logica
// de negocio pura (sin HTTP ni Prisma); el borde (Server Action) la traduce a
// resultado tipado. Solo el rol `adminSatelite`, SIEMPRE acotado a su `usuario.zonaId`.

// DTO de una orden del modulo satelite con el detalle para la UI (R6/R8/R9). Los
// nombres ya resueltos (no IDs de catalogo); `montoCobrar` serializado a
// number|null. `estatusValue` distingue "Por recibir" (en_ruta_bodega_satelite)
// de "Recibidas" (en_bodega_satelite).
export interface RecepcionSateliteDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
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
  // Feature 101/R9: flag de reasignacion prioritaria. Opcional (`?`, patron aditivo
  // `zonaEsGam`): no rompe fixtures/mocks de UI que construyen el DTO sin el; el service
  // SIEMPRE lo envia (boolean desde la fila del repo). El grupo "Recibidas" lo usa para el
  // resalte de fila (R8); las prioritarias ademas llegan primero por el sort del repo (R7).
  prioridad?: boolean;
  /**
   * Feature 160 (R11/R14/R16/R25): intentos de entrega VIGENTES de la orden, derivados del
   * historial en UN SOLO lote para los CINCO grupos del modulo (criterio unico de
   * `OrdenHistorialService`, design §1.1). Opcional (`?`, mismo patron aditivo que
   * `prioridad?`): no rompe fixtures/mocks que construyen el DTO sin el; el service SIEMPRE lo
   * envia, `0` incluido (R14).
   */
  intentosEntrega?: number;
  /**
   * FEATURE 262 (B8, R16/R17): dia de reparto de la orden, `YYYY-MM-DD` YA SERIALIZADO por el
   * repositorio; `null` = sin dia. Es lo que la pantalla de correccion del listado satelite muestra
   * POR ORDEN antes de confirmar («17496963 · hoy está para el 22 de agosto»), y sin ello se
   * corregiria a ciegas un lote mixto.
   *
   * Opcional (`?`) por el mismo patron aditivo que `prioridad?` e `intentosEntrega?`: no rompe
   * fixtures ni mocks de UI que construyen el DTO sin el; el service SIEMPRE lo envia. STRING y
   * nunca `Date`: un `@db.Date` formateado con el reloj del navegador devuelve el dia anterior en
   * media America (R17).
   */
  fechaRepartoISO?: string | null;
}

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

// Feature 63 — input de la recepcion EN LOTE (paridad con "Recoger todas" del
// mensajero): la lista de ids de orden que el adminSatelite acepta de una vez.
export interface RecibirLoteInput {
  ordenIds: string[];
}

// Feature 63 — resultado de dominio de la recepcion en lote. El alcance por zona y
// el estado de origen se imponen server-side (WHERE guardado): las ordenes ajenas a
// la zona / fuera de `en_ruta_bodega_satelite` se OMITEN (no cuentan), asi que el
// resultado normal es `ok` con el conteo de las efectivamente recibidas. `forbidden`
// (rol != adminSatelite) y `sin_zona` (adminSatelite sin zona) espejan a `recibir`.
// `validation_error` cubre el catalogo de estados incompleto (seed pendiente).
// `unauthenticated` NO vive aqui: lo agrega el borde (Server Action).
export type RecibirLoteServiceResult =
  | { status: "ok"; recibidas: number }
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

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
  /**
   * Feature 63: recibe EN LOTE las ordenes indicadas que sigan en
   * `en_ruta_bodega_satelite` y sean de la zona del adminSatelite, pasandolas a
   * `en_bodega_satelite` (paridad con "Recoger todas" del mensajero). El alcance por
   * zona + estado de origen se impone server-side; las ajenas se omiten. Idempotente
   * (re-ejecutar no dobla) y atomico (una sola tx con append de historial).
   */
  recibirLote(input: RecibirLoteInput, actor: Actor): Promise<RecibirLoteServiceResult>;
}
