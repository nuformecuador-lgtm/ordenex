import type { GestionCausaDevolucion } from "@prisma/client";

// Feature 99 (design §3.4, R5/R15/R16/R17/R18/R19/R20-R25) — contrato del repositorio del cron
// SLA de devoluciones diferidas. SOLO queries Prisma (sin logica de negocio: la ventana, el
// ruteo a bodega y la decision reintento/escalado los decide `DevolucionSlaService`). Reutiliza
// `orden` + `gestion_orden`; no introduce tablas ni RLS nueva.

/**
 * Feature 99/R5 — candidata del cron: una orden en `devuelta` (no borrada). De su ULTIMA gestion
 * `devuelta` VIGENTE (`anulada_at IS NULL`) salen la `causa` (`causa_devolucion`) y el
 * `mensajeroId`, al que se atribuye el ingreso de bodega si la orden escala (R22). `causa` null =
 * dato anterior a la feature 73 o anomalia -> el service la omite sin adivinar ventana (R28).
 *
 * FEATURE 239 (T3.3, R12/R14/R15) — DE DONDE SALE `ancladaAt`, que es el cambio que cierra el
 * fallo. Hasta el 2026-08-19 era el `created_at` de esa gestion, es decir el instante en que el
 * MENSAJERO devolvio. Eso hacia que el reloj arrancara antes de que la tienda pudiera ver la
 * novedad —la visibilidad esperaba a la aprobacion del cierre, con mediana medida de 8,2 h y p90
 * de 22,1 h—, asi que con la ventana `not_found` de 24 h habia ordenes que se escalaban a
 * `rechazada` y se COBRABAN sin haber sido visibles nunca.
 *
 * Desde la 239 el ancla es **el instante de la transicion a `devuelta`**: la fila de historial de
 * familia `anclaje_devolucion`, que escribe la APROBACION DEL CIERRE. La misma aprobacion que
 * hace visible la devolucion arranca su reloj — un solo hecho para las dos cosas.
 */
export interface DevueltaSlaRow {
  ordenId: string;
  zonaId: string;
  mensajeroId: string;
  causa: GestionCausaDevolucion | null;
  /** Instante desde el que corre la ventana de SLA. Ver `origenAncla` para saber de donde sale. */
  ancladaAt: Date;
  /**
   * Feature 239 (R14) — DE DONDE sale `ancladaAt`, viajando en el DTO en vez de decidirse en un
   * `??` mudo dentro de la consulta:
   *
   *  - `aprobacion`: la orden tiene su fila de historial `anclaje_devolucion`. Es el caso NORMAL
   *    y el unico que puede producirse desde la 239: la unica arista de entrada a `devuelta` es
   *    el anclaje, y ese append va en la MISMA transaccion que el cambio de estado.
   *  - `legado`: la orden esta en `devuelta` y NO tiene ninguna fila de anclaje. Son las que
   *    llegaron ahi ANTES de esta feature (grandfather, P6/R30): su ventana se ancla en la fecha
   *    de su gestion `devuelta` vigente mas reciente, que es exactamente el comportamiento que ya
   *    tenian, sin moverles el plazo por debajo.
   *
   * NO es un fallback silencioso, y por eso viaja: el servicio lo CUENTA (`legadas` en el
   * resultado del cron), de modo que la poblacion legada sea observable y se pueda ver
   * extinguirse. Un `legadas` que no baja a cero, o que sube, significa que algo esta metiendo
   * ordenes en `devuelta` por fuera del anclaje — y eso hay que verlo, no absorberlo.
   */
  origenAncla: "aprobacion" | "legado";
}

// Entrada del reintento (R15): destino de bodega ya resuelto por el service, y el estatus de
// ORIGEN esperado (`devuelta`) como guarda de idempotencia/concurrencia (R24/R25).
export interface LiberarDevueltaSlaInput {
  ordenId: string;
  destinoEstatusId: string; // en_bodega_central | en_bodega_satelite (resuelto por el service)
  estatusDevueltaId: string; // guarda: solo actua si la orden sigue en `devuelta`
}

// Entrada del escalado (R16/R17) — Option A del dinero (design §3.4).
export interface EscalarDevueltaSlaInput {
  ordenId: string;
  estatusDevueltaId: string; // guarda de idempotencia/concurrencia (R21/R24/R25)
  estatusRechazadaId: string;
  mensajeroId: string; // R22: mensajero de la gestion `devuelta` vigente -> ingreso de bodega
  motivo: string; // motivo de la gestion sintetica ("escalado SLA <causa>")
}

export interface IDevolucionSlaRepository {
  /**
   * R5: ordenes en `devuelta`, NO borradas, con su ULTIMA gestion `devuelta` VIGENTE
   * (`orderBy createdAt desc`, `take 1`, `anulada_at IS NULL`), de la que salen `causa` y
   * `mensajeroId`. Filtra en memoria las que NO tienen gestion vigente (patron
   * `findOrdenesLiberables`). Las que si la tienen pero con `causa` null SI se devuelven (el
   * service las omite, R28).
   *
   * FEATURE 239 (T3.3, R12/R13/R15): proyecta ADEMAS la ULTIMA fila de historial de familia
   * `anclaje_devolucion` (`orderBy createdAt desc`, `take 1`), que es el instante en que la
   * aprobacion del cierre metio la orden en `devuelta`. Ese instante es el ancla (R12); sin fila,
   * se cae a la rama LEGADA y se marca como tal (R14). El `take 1` descendente implementa R15: si
   * la orden dio la vuelta entera (liberacion -> reasignacion -> nueva devolucion -> nueva
   * aprobacion), gana el anclaje MAS RECIENTE, no el primero.
   *
   * R13 por construccion: el `where` sigue siendo `estatus = devuelta`, asi que una orden en
   * `devolucion_por_confirmar` NO es candidata — ni para liberarse, ni para escalar, ni para
   * cobrarse.
   */
  findDevueltasSla(): Promise<DevueltaSlaRow[]>;
  /**
   * R15/R18/R19/R24/R25: transiciona UNA orden de `devuelta` al destino de bodega y limpia el
   * mensajero, con escritura GUARDADA por `estatus_id = devuelta` + no borrada. El append al
   * historial (`origen_tipo = liberacion_devuelta_sla`, actor NULL) va DENTRO del `if(count>0)`
   * de la MISMA tx. Devuelve `true` si afecto una fila; `false` si ya salio de `devuelta`.
   */
  liberarDevueltaSla(input: LiberarDevueltaSlaInput): Promise<boolean>;
  /**
   * R16/R17/R18/R19/R20-R25 (Option A): transiciona UNA orden de `devuelta` a `rechazada`
   * (guardada por `estatus_id = devuelta`; NO toca el mensajero, paridad con un rechazo
   * directo) y, SOLO si afecto una fila, crea en la MISMA tx una gestion sintetica
   * `resultado = rechazada` (`cierre_id NULL`, del `mensajeroId`) para que el ingreso de bodega
   * lo cobre el snapshot de la 56 sin codigo monetario nuevo; el append
   * (`origen_tipo = escalado_devuelta_sla`, actor NULL) enlaza esa gestion. Reejecucion ->
   * count 0 -> no crea 2.ª gestion (R21). Devuelve `true` si escalo; `false` si ya salio.
   */
  escalarDevueltaSla(input: EscalarDevueltaSlaInput): Promise<boolean>;
}
