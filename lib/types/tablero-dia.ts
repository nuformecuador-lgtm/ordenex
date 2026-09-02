// Feature 192 (T0.1/T0.2) — CONTRATO COMPARTIDO del tablero del dia.
//
// Es la unica frontera entre el bloque backend y el bloque frontend de esta feature
// (`tasks.md`): lo fija T0 y despues ninguno de los dos lo cambia sin avisar al otro.
//
// Modulo de TIPOS + una tabla de clasificacion. NO importa `repositories/`, `services/`,
// `@/lib/db` ni `next/headers`: cualquiera de esos imports lo convertiria en codigo de
// servidor y lo haria inutilizable desde un Client Component.

import type { GestionResultado } from "@prisma/client";

import type { MotivoDenegacion } from "@/lib/analytics/alcance";
// FEATURE 260 — importacion de TIPO: se borra al compilar y no arrastra un byte al navegador,
// asi que la cabecera de este modulo («no importa `repositories/`, `services/`, `@/lib/db` ni
// `next/headers`») sigue siendo cierta. Es lo que permite que la fila del detalle SEA la del
// listado sin declarar un tipo paralelo (design.md §3.2).
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { AlcanceOrden } from "@/lib/types/recorte-alcance-orden";
import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";

/* -------------------------------------------------------------------------- */
/* 1. Segundo eje: el desglose de "sin resultado" (design.md §1.bis, R21/R43-R46) */
/* -------------------------------------------------------------------------- */

/**
 * R21 — una orden asignada hoy SIN gestion vigente en el dia cae en exactamente uno de
 * estos tres buckets, segun el estatus actual de la orden. No hay un cuarto cubo
 * indiferenciado de "pendientes": el sentido de la pantalla es distinguir al mensajero
 * que todavia no arranco del que ya esta en la calle.
 */
export type BucketSinResultado = "sinRecoger" | "enReparto" | "otros";

/**
 * R43 — la clasificacion estatus -> bucket. **Esta es su UNICA declaracion en todo el
 * arbol** (lo censa `tests/unit/tablero-dia/buckets-estatus.guardia.test.ts`): una
 * segunda tabla paralela es exactamente lo que R46 persigue.
 *
 * Es un mapa PARCIAL a proposito, con `otros` como valor por defecto
 * (`BUCKET_POR_DEFECTO`): asi un estatus retirado del catalogo pero vivo en filas
 * historicas —el caso real de la feature 155, cuya fila sobrevivio huerfana— sigue
 * teniendo bucket y la identidad de ocho sumandos de R25 no se rompe.
 *
 * - `por_recoger`: tiene guia y mensajero, espera que el mensajero la acepte (feature 17).
 * - `recolectando`: alguien va en camino a la tienda (feature 157).
 * - `en_reparto`: FUE recogida por el mensajero y esta en la calle (feature 36).
 *
 * R44 — `por_recolectar_en_tienda` NO esta aqui, y no es un olvido: en ese estatus
 * *nadie va todavia* (la asignacion es la transicion que la saca de ahi, feature 157), asi
 * que verla en `sinRecoger` seria contar como "trabajo parado de este mensajero" algo que
 * no es de nadie. Cae en `otros` por defecto.
 *
 * FEATURE 239 (T1.7, 2026-08-19) — `devolucion_por_confirmar` NO esta aqui, y tampoco es un
 * olvido. Este mapa es PARCIAL con default `otros`, asi que ABSORBE un value nuevo sin quejarse:
 * por eso la decision se afirma en `buckets-estatus.test.ts`. Los tres buckets solo particionan
 * ordenes SIN gestion vigente en el dia; una orden en el pre-estado tiene gestion del dia —la
 * devolucion que el mensajero acaba de registrar—, asi que cuenta en `devueltas` del primer eje
 * y no puede aparecer como "trabajo parado" en `sinRecoger` ni en `enReparto`.
 *
 * FEATURE 235 (T1.5, 2026-08-19) — `ayuda_tienda` TAMPOCO esta aqui, y es la MISMA clase de
 * decision: el mapa es PARCIAL con default `otros`, asi que absorbe el value nuevo sin quejarse y
 * la decision hay que AFIRMARLA (`buckets-estatus.test.ts`). Los buckets `sinRecoger` y `enReparto`
 * describen el AVANCE NORMAL del dia —lo que espera salir y lo que va en la calle—; una orden
 * DETENIDA esperando a que la tienda conteste no es ninguno de los dos: contarla en `enReparto`
 * diria que el reparto avanza cuando lo que hay es una parada. Cae en `otros`, que es el bucket que
 * delata que el mapa se quedo corto — y aqui no se quedo corto: se quedo asi a proposito.
 *
 * El `satisfies` sobre `OrderStatusValue` es lo que hace que un RENAME del catalogo no
 * compile (R46); que no falte ni sobre ningun value lo comprueba el guardia.
 */
export const BUCKET_POR_ESTATUS = {
  por_recoger: "sinRecoger",
  recolectando: "sinRecoger",
  en_reparto: "enReparto",
} as const satisfies Partial<Record<OrderStatusValue, BucketSinResultado>>;

/**
 * R45 — todo lo NO enumerado cae aqui, de forma explicita y visible. `otros` es el bucket
 * que delata que el mapa se quedo corto; absorberlo en `sinRecoger` haria que un cambio de
 * flujo pasara desapercibido.
 */
export const BUCKET_POR_DEFECTO: BucketSinResultado = "otros";

/**
 * R43/R45 — bucket de un estatus. Acepta `string` porque el value llega crudo de la base
 * (`order_status.value`) y puede ser una fila huerfana fuera del catalogo vigente.
 */
export function bucketDeEstatus(estatus: string): BucketSinResultado {
  const explicito: Partial<Record<string, BucketSinResultado>> = BUCKET_POR_ESTATUS;
  return explicito[estatus] ?? BUCKET_POR_DEFECTO;
}

/**
 * Los values del catalogo VIGENTE que caen en `bucket`. Lo consumen la UI (para explicar
 * que contiene cada bucket) y los tests. Se deriva de `ORDER_STATUS_SEED`, no se escribe a
 * mano: una lista paralela es la falla que R46 persigue.
 */
export function estatusDelBucket(bucket: BucketSinResultado): readonly OrderStatusValue[] {
  return ORDER_STATUS_SEED.filter((value) => bucketDeEstatus(value) === bucket);
}

/**
 * Los values con bucket EXPLICITO (los del mapa). El SQL del repositorio los recibe como
 * PARAMETROS (`= ANY($…)`) y construye `otros` con el `NOT IN` de esta misma lista, de
 * modo que las tres ramas sean disjuntas y exhaustivas por construccion (design.md §5,
 * nota 3.bis). Escribir estas listas tambien dentro de la cadena SQL seria declarar la
 * clasificacion dos veces.
 */
export const ESTATUS_CON_BUCKET_EXPLICITO: readonly OrderStatusValue[] = ORDER_STATUS_SEED.filter(
  (value) => value in BUCKET_POR_ESTATUS,
);

/* -------------------------------------------------------------------------- */
/* 2. El tablero (design.md §6)                                                */
/* -------------------------------------------------------------------------- */

/**
 * R25 — los OCHO contadores de una tarjeta. La identidad
 * `asignadas = entregadas + reprogramadas + devueltas + rechazadas + incidentes +
 *  sinRecoger + enReparto + otros`
 * se cumple por construccion (los `FILTER` del SQL son particiones disjuntas del mismo
 * `COUNT(*)`), no por una resta a posteriori.
 */
export interface FilaTableroDia {
  readonly mensajeroId: string;
  /** "Juan Perez" (nombre + primer apellido). */
  readonly mensajeroNombre: string;
  readonly asignadas: number;
  readonly entregadas: number;
  readonly reprogramadas: number;
  readonly devueltas: number;
  readonly rechazadas: number;
  readonly incidentes: number;
  /** R21/R43 — sin gestion vigente hoy y todavia sin arrancar. */
  readonly sinRecoger: number;
  /** R21/R43 — sin gestion vigente hoy, ya en la calle. */
  readonly enReparto: number;
  /** R45 — cualquier otro estatus sin gestion vigente hoy. Se pinta aunque valga 0. */
  readonly otros: number;
}

/** R30 — los totales tienen la forma de una fila menos su identidad. */
export type TotalesTableroDia = Omit<FilaTableroDia, "mensajeroId" | "mensajeroNombre">;

/**
 * FEATURE 258 (B2.1, R50/R52) — un punto de la serie de entregas ACUMULADAS del dia.
 *
 * `hora` es la hora de PARED de Costa Rica (0..23) del dia representado; `acumulado` es el
 * numero de ordenes entregadas desde el inicio del dia CR hasta el FIN de esa hora.
 *
 * ⚠️ EL ACUMULADO DE UNA HORA PUEDE BAJAR ENTRE DOS LECTURAS, Y ESO ES CORRECTO (R72).
 * La serie NO es un registro historico de lo que se vio a cada hora: se RECONSTRUYE entera en
 * cada lectura contando, igual que el contador `entregadas`, la ULTIMA gestion vigente del dia
 * de cada orden. Si una orden entregada a las 10:00 se reprograma a las 15:00, su ultima
 * gestion ya no es `entregada` y el punto de las 10:00 baja en uno — exactamente igual que baja
 * el contador `entregadas` que se pinta a dos centimetros de la linea.
 *
 * Se decidio asi el 2026-08-21 (decision humana, `design.md` §3 y §12.6) despues de ver este
 * caso concreto: se prefiere una curva que retrocede y CUADRA a una curva bonita que miente.
 * La alternativa —contar cualquier gestion `entregada` del dia— da una curva que nunca baja
 * pero infla (una orden con dos gestiones aportaria dos) y contradice al contador de al lado.
 *
 * **Si estas leyendo esto porque viste el grafico retroceder: no es un bug, no lo "arregles".**
 * `tests/integration/tablero-dia-ritmo.test.ts` lo fija como comportamiento ESPERADO.
 */
export interface PuntoRitmoEntregas {
  /** Hora de pared de Costa Rica, 0..23. */
  readonly hora: number;
  /** Ordenes entregadas desde el inicio del dia CR hasta el FIN de `hora`. */
  readonly acumulado: number;
}

export interface TableroDia {
  /** `YYYY-MM-DD` calendario de Costa Rica del dia representado (R34). */
  readonly fecha: string;
  /**
   * R34 — instante en que los conteos se LEYERON de la base. Se estampa dentro de
   * `producir`, viaja dentro del valor cacheado y NO se re-estampa al servir un acierto
   * de cache: si dijera la hora de la respuesta, la pantalla anunciaria como fresco un
   * dato de hasta ~45 s (design.md §5.quater).
   */
  readonly generadoAt: string;
  readonly alcance: "global" | "zona";
  readonly filas: readonly FilaTableroDia[];
  readonly totales: TotalesTableroDia;
  /**
   * FEATURE 258 (R50/R52/R54) — entregas ACUMULADAS por hora de pared de CR, sin huecos desde
   * la hora 0 hasta la hora de pared del instante de lectura. Su ULTIMO punto es
   * `totales.entregadas`: la serie es una particion por hora del MISMO conjunto de ordenes que
   * produce ese contador, asi que el cuadre es cierto por construccion y no a posteriori.
   *
   * Campo OBLIGATORIO a proposito, no opcional: opcional dejaria que una implementacion lo
   * olvidara y la pantalla se quedara sin linea sin que nada se pusiera rojo.
   *
   * Nunca esta vacia mientras haya dia: si el dia no registra ninguna entrega, trae los puntos
   * `0..H` con `acumulado` 0. Es la CAPA DE PRESENTACION la que decide no dibujar una linea
   * plana a cero (R59), no el contrato.
   */
  readonly ritmoEntregas: readonly PuntoRitmoEntregas[];
}

/**
 * FEATURE 258 (B2.1c, R43/R65) — LA UNICA SUMA DE LOS OCHO CONTADORES DEL ARBOL.
 *
 * Vivia dentro de `TableroDiaService` (feature 192, R30) y se MUEVE aqui sin cambiar una
 * linea de su cuerpo. El motivo no es cosmetico: con filtro por nombre activo, el bloque de
 * totales se recalcula sobre las tarjetas VISIBLES (R43), y ese recalculo lo hace un Client
 * Component que NO puede importar el servicio sin arrastrarse `lib/analytics/alcance` y el
 * adaptador de cache al navegador. Este modulo es exactamente el sitio: su cabecera ya declara
 * que no importa `repositories/`, `services/`, `@/lib/db` ni `next/headers`.
 *
 * ⛔ NO se duplica (R65). Dos implementaciones de esta suma son dos identidades de ocho
 * sumandos distintas, y pueden divergir sin que ningun test lo note: es justo la falla que R3
 * persigue. Los dos consumidores —el servicio, para los totales del dia; el modulo de cliente,
 * para los de lo filtrado— llaman a ESTA.
 *
 * Los totales los suma quien pinta y no la base, para que sean por construccion la suma de lo
 * que el usuario ve y para que la identidad de R3 se herede de cada fila al bloque de totales.
 */
export function sumarTotalesTablero(filas: readonly FilaTableroDia[]): TotalesTableroDia {
  return filas.reduce<TotalesTableroDia>(
    (acc, f) => ({
      asignadas: acc.asignadas + f.asignadas,
      entregadas: acc.entregadas + f.entregadas,
      reprogramadas: acc.reprogramadas + f.reprogramadas,
      devueltas: acc.devueltas + f.devueltas,
      rechazadas: acc.rechazadas + f.rechazadas,
      incidentes: acc.incidentes + f.incidentes,
      sinRecoger: acc.sinRecoger + f.sinRecoger,
      enReparto: acc.enReparto + f.enReparto,
      otros: acc.otros + f.otros,
    }),
    {
      asignadas: 0,
      entregadas: 0,
      reprogramadas: 0,
      devueltas: 0,
      rechazadas: 0,
      incidentes: 0,
      sinRecoger: 0,
      enReparto: 0,
      otros: 0,
    },
  );
}

/* -------------------------------------------------------------------------- */
/* 3. El detalle de un mensajero (design.md §6, R47-R51)                       */
/* -------------------------------------------------------------------------- */

/**
 * FEATURE 260 (T0.2, R1/R18) — LA FILA DEL DETALLE **ES** LA DEL LISTADO DE ORDENES.
 *
 * Sustituye a los siete campos propios de la feature 192 (R47-R51) y REVIERTE su R49 —el
 * alcance cerrado en cuatro columnas—, con fecha y motivo escritos en
 * `specs/192-tablero-dia-mensajeros/requirements.md`. La decision no se borra: se anota.
 *
 * Es una INTERSECCION con `OrdenListItemDTO`, no un tipo paralelo, y eso es lo que hace que
 * `ordenesColumns` se monte sobre estas filas **sin un solo cast** (`Column<T>` es
 * contravariante en el parametro de `render` bajo `strictFunctionTypes`, asi que un subtipo
 * estricto encaja). Un tipo paralelo seria una segunda declaracion que puede divergir del
 * listado sin que nada se ponga rojo — justo lo que esta feature viene a cerrar (R2/R26).
 *
 * Solo añade DOS campos, y ninguno de los dos existe en el listado porque ninguno es de la
 * orden: son del DIA. Nada mas se añade nunca aqui (R18: subconjunto, jamas superconjunto).
 */
export type OrdenDetalleDia = OrdenListItemDTO & {
  /** Ultima gestion VIGENTE del dia de esa orden; `null` si hoy no se gestiono. */
  readonly resultadoDelDia: GestionResultado | null;
  /**
   * ISO-8601 UTC. ORDENA la pagina del dia y NO se pinta en ninguna columna: se conserva
   * porque es el campo contra el que los tests de integracion afirman ese orden.
   */
  readonly asignadoAt: string;
};

/**
 * El alcance con el que se resolvio una lectura del tablero. Lista blanca, no el rol.
 *
 * FICHA 349 — es un ALIAS de `AlcanceOrden` (`lib/types/recorte-alcance-orden.ts`), no una
 * segunda union de las mismas dos variantes: el recorte que lo consume vive alli desde que
 * tiene dos pantallas encima. El nombre local se conserva porque es el que viaja en la
 * respuesta del detalle (`DetalleMensajeroDia.alcance`) y lo leen sus consumidores.
 */
export type AlcanceTableroDia = AlcanceOrden;

export interface DetalleMensajeroDia {
  readonly mensajeroId: string;
  readonly fecha: string;
  readonly ordenes: readonly OrdenDetalleDia[];
  /** R51 — debe cuadrar con `asignadas` de la tarjeta desde la que se abrio. */
  readonly total: number;
  readonly pagina: number;
  readonly pageSize: number;
  /**
   * FEATURE 260 (R12) — CON QUE ALCANCE SE RESOLVIO. Decide que columnas monta la pantalla
   * (R14). Viaja en la respuesta y NO se deduce en el cliente: un componente de cliente no
   * puede leer el rol —lo prohibe la clausula (c) del guardia de frontera— y tampoco debe,
   * porque el alcance ya lo resolvio el servidor y aqui solo se consume su respuesta.
   */
  readonly alcance: AlcanceTableroDia;
}

/* -------------------------------------------------------------------------- */
/* 3.bis El recorte por alcance (design.md §5, R13/R43/R46)                    */
/* -------------------------------------------------------------------------- */

/**
 * FICHA 349 (2026-09-01) — EL RECORTE SE MUDO A `lib/types/recorte-alcance-orden.ts` Y AQUI
 * SOLO SE REEXPORTA. Sigue habiendo UNA sola declaracion (R43); lo que cambia es donde vive.
 *
 * POR QUE SE MUDO: el listado «Órdenes de la bodega» del `adminSatelite` es ahora el SEGUNDO
 * consumidor —su proyeccion pasa a ser la misma `toListItemDTO` de `/ordenes`, y sale de la
 * capa de datos recortada por esta misma funcion—. Con dos consumidores el nombre «tablero del
 * dia» dejaba de ser cierto, y ademas la capa de datos habria tenido que importar ESTE modulo,
 * que arrastra `lib/analytics/alcance` -> `lib/auth/acceso-total` por un camino de tipos que el
 * guardia del bundle de cliente recorre sin distinguir `import type` (la misma medicion que
 * motivo `lib/types/alcance-tablero.ts`, cuya cabecera la cuenta entera).
 *
 * Para los consumidores de aqui —`TableroDiaService`, `detalle-columnas`, sus tests— no cambia
 * absolutamente nada: los mismos nombres, importados del mismo sitio.
 */
export {
  CAMPOS_SOLO_ALCANCE_GLOBAL,
  recortarPorAlcance,
} from "@/lib/types/recorte-alcance-orden";

/* -------------------------------------------------------------------------- */
/* 4. Contrato de denegacion (design.md §3.4)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Dominio CERRADO de motivos: literales, nunca un texto con ids ajenos, nombres ni PII.
 * `MotivoDenegacion` viene de `lib/analytics/alcance` con `import type` (sin runtime): el
 * resolutor de alcance es el mismo, asi que sus motivos no se reescriben aqui (R8).
 * `rol_no_autorizado` es el unico motivo propio: lo produce la lista blanca de
 * `global|zona` cuando el alcance resuelto es `tienda` o `mensajero` (R3/R9).
 */
export type MotivoTableroDia = MotivoDenegacion | "rol_no_autorizado";

/** Una Server Action no puede responder 403: devuelve un resultado discriminado (R2/R3). */
export type ResultadoTableroDia =
  | { readonly estado: "ok"; readonly tablero: TableroDia }
  | { readonly estado: "denegado"; readonly motivo: MotivoTableroDia };

/**
 * R42/R63 — el detalle comparte el mismo dominio de motivos. Los tres casos malos
 * (mensajero inexistente, fuera de alcance, sin ordenes hoy) NO se distinguen: los tres
 * dan un detalle VACIO, nunca un motivo distinto que confirme la existencia de un usuario
 * de otra zona.
 */
export type ResultadoDetalleDia =
  | { readonly estado: "ok"; readonly detalle: DetalleMensajeroDia }
  | { readonly estado: "denegado"; readonly motivo: MotivoTableroDia };
