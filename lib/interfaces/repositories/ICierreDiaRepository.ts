import type { GestionResultado, MetodoPagoValue } from "@prisma/client";
import type { CierreDestinoTipo, CierreEstado } from "@/lib/types/cierre";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { OrderStatusValue } from "@/lib/types/order-status";
import type {
  CierrePasadoDTO,
  CierreTotales,
  IngresoOrdenexDTO,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 37 — contrato del repositorio del cierre del dia. Solo queries Prisma;
// sin logica de negocio (esa vive en CierreDiaService). Money-safe: los Decimal se
// devuelven ya serializados a STRING (montoRecibido, totales), y `crearCierre`
// recibe los totales snapshot como STRING para construir Prisma.Decimal.

// Fila de una gestion pendiente de cierre (cierre_id IS NULL) con el detalle de la
// orden ya resuelto (R3/R4). `montoRecibido` en STRING (money-safe, R9), null salvo
// entregada. `evidenciaStoragePath` es el path CRUDO del bucket privado; el service
// lo FIRMA antes de exponerlo (R5).
/**
 * Feature 264 (R9/R10) — UNA ORDEN QUE EL CORTE DIARIO BARRIO A `sin_gestionar` al crear el
 * cierre, leida de `cierre_sin_gestion`.
 *
 * NO es un resultado de gestion: es la AUSENCIA de uno. Por eso NO lleva —ni puede llevar— monto
 * cobrado, monto recibido, metodo de pago, pago al mensajero, ingreso de Ordenex, ingreso de
 * bodega, indemnizacion, evidencia ni resultado (R10). Si algun dia aparece uno de esos campos
 * aqui, es un bug de diseño y no una mejora: la garantia de que esta lista no mueve un total
 * (R19/R20/R22) es que no hay nada que sumar.
 *
 * Todos los descriptivos son los CONGELADOS al barrer (R11), no los que la orden tenga hoy.
 * Vive en este archivo —y no en el del admin— porque lo devuelven los DOS repositorios: el
 * detalle del admin y el detalle propio del mensajero comparten componente de pantalla, asi que
 * tienen que compartir tambien la forma del dato.
 */
export interface CierreSinGestionRow {
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  producto: string;
  tiendaNombre: string;
  zonaNombre: string;
  /** `en_reparto` | `ayuda_tienda`; `null` SOLO si no consta (R4/R32/R33). */
  estatusOrigen: OrderStatusValue | null;
}

export interface CierreGestionPendienteRow {
  gestionId: string;
  ordenId: string;
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  direccion: string | null;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  producto: string;
  tiendaNombre: string;
  resultado: GestionResultado;
  montoRecibido: string | null;
  // Feature 212/R31: columna DEPRECADA (la 213 decide su retiro). Se CONSERVA mientras la
  // presentacion actual la consuma: `null` cuando la gestion tiene 0 o >=2 lineas de pago.
  metodoPago: MetodoPagoValue | null;
  /**
   * Feature 212 (R21/R22): DESGLOSE del recaudo al cliente — 0..N lineas `(metodo, monto)`,
   * money-safe STRING escala 2, en el orden de declaracion del enum (`efectivo`, `SINPE`,
   * `transferencia`), que es el que devuelve `orderBy: { metodo: "asc" }` sobre un enum nativo.
   *
   * OBLIGATORIO y SIN FALLBACK al par escalar (`montoRecibido`/`metodoPago`), a proposito
   * (design §3.1 y alternativa descartada B). `computeTotales` suma EXCLUSIVAMENTE estas
   * lineas: una proyeccion que se olvide de seleccionarlas da CERO —escandaloso e inmediato—
   * en vez de un total «plausible» calculado por el camino viejo, que en un cierre mixto
   * inflaria la `E` del `min(P, E)` del pago al mensajero (feature 44) sin que nadie lo note.
   * `[]` cuando la gestion no tiene ninguna linea (entrega sin cobro, o no `entregada`).
   */
  pagos: { metodo: MetodoPagoValue; monto: string }[];
  motivo: string | null;
  fechaReprogramacion: string | null; // ISO date (YYYY-MM-DD)
  evidenciaStoragePath: string | null;
  // Feature 39: pago al mensajero SNAPSHOTEADO de la gestion (money-safe STRING). `null`
  // en gestiones aun sin cerrar / cierres pre-migracion (R22). En la vista EN VIVO (37)
  // el service lo DERIVA; en el detalle admin (38/40) es el snapshot leido de la columna.
  pagoMensajero: string | null;
  // Feature 56: ingreso de bodega por rechazo SNAPSHOTEADO de la gestion (money-safe
  // STRING). `null` en gestiones aun sin cerrar / cierres pre-migracion (R21/R22). Solo
  // `rechazada` con tarifa que aplica es != 0.00. Concepto INDEPENDIENTE de pagoMensajero
  // (R7b) y del dinero recibido (R20). En vivo (37) el service lo DERIVA; en admin (38/40)
  // es el snapshot leido de la columna.
  ingresoBodegaRechazo: string | null;
  // Feature 102/R1/R3: clasificacion SLA (cron 99) vs manual (mensajero) de una gestion
  // `rechazada`, DERIVADA del historial inmutable (`origen_tipo = escalado_devuelta_sla`), sin
  // columna nueva. La pueblan los repos de ADMIN (38/40); en la vista EN VIVO del mensajero (37)
  // es `false` por defecto (no expone el desglose, R11).
  esRechazoSla: boolean;
  /**
   * 💰 Feature 237 (D6 firmada por el HUMANO el 2026-08-20, R41) — `true` si esta gestion la
   * registro LA TIENDA desde su pestaña de ayuda, no el mensajero.
   *
   * POR QUE VIAJA HASTA AQUI, que es lo que no hay que perder de vista: sin este dato, el
   * mensajero **firma un cierre con una gestion que no hizo y una evidencia que no subio**, y no
   * puede explicarla si le preguntan. Es su dinero (el `cobroRechazado` sale de SU tarifa) y su
   * intento de entrega. La orden desaparece de su portal en cuanto sale de `ayuda_tienda`, asi que
   * la fila de su cierre del dia es el UNICO sitio donde las dos poblaciones aparecen juntas.
   *
   * DERIVADO del historial (`origen_tipo` ∈ `ORIGENES_GESTION_DE_LA_TIENDA`), nunca de una columna
   * nueva en `gestion_orden`: la fuente de verdad de quien actuo es el historial, y duplicarla
   * crearia una segunda verdad que puede divergir. Mismo patron que `esRechazoSla` (102).
   *
   * `false` significa «no la registro la tienda», NO «no lo se» — el porque estructural esta en
   * `lib/utils/gestion-de-la-tienda-flag.ts`, que es donde se decide.
   *
   * ⏳ 2026-08-20 (feature 240, T4.1) — EL NOMBRE SE QUEDA CORTO Y SE SABE. Desde esta ficha el
   * campo vale `true` tambien para el RECHAZO MANUAL de una devolucion anclada, que NO viene de la
   * pantalla de ayuda: lo que el campo significa hoy es «la registro LA TIENDA», y su nombre honesto
   * seria `registradaPorLaTienda`. El rename NO se hace en este cambio, y la razon se escribe aqui
   * para que sea una deuda con dueño y no un descuido: toca ~40 archivos, casi todos fixtures de
   * test de suites ajenas a esta ficha, y varias de ellas estan siendo modificadas en paralelo por
   * otra feature en vuelo. Es un rename de LECTURA —sin cambio de forma, de dato ni de conducta—,
   * asi que se puede hacer solo, guiado por el typecheck, el dia que el arbol este quieto.
   */
  desdeAyudaTienda: boolean;
  // Feature 158/R9: causa TIPIFICADA del incidente, leida de `gestion_orden.causa_incidente`.
  // `null` en cualquier otro resultado (campo POR RAMA). La pueblan LOS DOS caminos: la vista
  // en vivo del mensajero (37) y los detalles de admin (38/40).
  causaIncidente: CausaIncidente | null;
  // Feature 158/R19/R22: monto de la indemnizacion SNAPSHOTEADO en la gestion (money-safe
  // STRING). `null` si el resultado no es `incidente` o si el cierre aun no se aprobo (el
  // monto lo captura el admin AL APROBAR). Solo lo pueblan los repos de ADMIN (38/40): la
  // vista EN VIVO del mensajero (37) NO lo selecciona — la indemnizacion no es plata suya
  // (design §7.2), y no exponerlo en la consulta es mas fuerte que ocultarlo en la pantalla.
  indemnizacion: string | null;
  // Desglose del ingreso de Ordenex + tarifa congelada, DERIVADO del snapshot. Solo lo
  // pueblan los repos de ADMIN (38/40): la vista en vivo del mensajero (37) no lo expone.
  ingresoOrdenex?: IngresoOrdenexDTO | null;
}

// Feature 109 (T1.2, R6/R8): input OPCIONAL del corte diario. Cuando esta presente,
// `crearCierre` transiciona en la MISMA tx las ordenes `en_reparto` del mensajero a
// `sin_gestionar` (via el choke point 49, actor null, `origen_tipo = corte_sin_gestionar`) y
// RELAJA la guarda de "algo paso" (crea el `vencido` money-neutral si transiciono >=1 orden aunque
// vincule 0 gestiones, R8). Ausente = flujo de la 37 (solicitar) SIN cambios. Los estatus ids los
// resuelve el service (`findEstatusIdByValue`), no el repo.
export interface CorteSinGestionarInput {
  enRepartoEstatusId: string;
  /**
   * Feature 235 (T4.4, R26) - OBLIGATORIO, no opcional, y la diferencia importa: un olvido de
   * cableado tiene que romper el TYPECHECK, no dejar ordenes en ayuda sin barrer para siempre.
   * Mismo criterio y mismo precedente que `anclajeDevolucion` en la 239.
   *
   * El corte recorre DOS BLOQUES GUARDADOS -uno por estado de origen- y no un solo `updateMany`
   * con un `in`: con dos origenes posibles en una sola escritura, el append tendria que INVENTARSE
   * de cual salia cada fila y escribiria un historial falso (R27).
   */
  ayudaEstatusId: string;
  sinGestionarEstatusId: string;
  /**
   * Feature 246 (T2.3, R11/R12/R16) — fecha CR de la JORNADA QUE LA CORRIDA CIERRA (convencion
   * `@db.Date`: medianoche UTC), calculada UNA vez en `CorteDiarioService.ejecutarCorte`
   * (`diaQueElCorteCierra`). El barrido solo alcanza a las ordenes cuya `fecha_reparto` sea
   * `<= diaCerrado` o NULL; las reservadas para un dia posterior quedan intactas (R11/R15).
   *
   * OBLIGATORIO, no opcional, y la diferencia importa: un olvido de cableado tiene que romper el
   * TYPECHECK, no dejar el barrido con un criterio silencioso que se lleve por delante lo que la
   * ficha protege. Mismo criterio y mismo precedente que `ayudaEstatusId` aqui arriba.
   *
   * Viaja DENTRO de este input y no como argumento suelto de `crearCierre` para que sea
   * literalmente el mismo valor que filtro la seleccion (R16): las dos consultas son la misma
   * verdad vista dos veces, y la 235 ya costo una regresion por dejarlas divergir.
   */
  diaCerrado: Date;
}

// Datos para crear la solicitud de cierre (R13/R14). Totales snapshot como STRING.
export interface CrearCierreInput {
  mensajeroId: string;
  destinoTipo: CierreDestinoTipo;
  destinoZonaId: string;
  // Feature 41/C1 (R8): estado con el que se crea el cierre. La 37 crea `solicitado`
  // (default); el corte diario crea `vencido` reusando la MISMA tx de vinculacion +
  // snapshot. Solo estos dos valores son validos como estado de creacion.
  estado?: Extract<CierreEstado, "solicitado" | "vencido">;
  // Feature 109 (T1.2, R6/R8): presente SOLO en el corte diario -> transiciona `en_reparto ->
  // sin_gestionar` y relaja la guarda "algo paso". Ausente en `solicitarCierre` (37).
  corteSinGestionar?: CorteSinGestionarInput;
  totales: CierreTotales;
  // Feature 39/R12/R14: pago al mensajero snapshoteado por gestion (gestionId -> STRING)
  // + total del cierre (STRING). Se persisten en la MISMA tx que crea el cierre.
  pagoByGestionId: Record<string, string>;
  totalPagoMensajero: string;
  // Feature 56/R11/R12/R13: ingreso de bodega por rechazo snapshoteado por gestion
  // (gestionId -> STRING) + total del cierre (STRING). Se persisten en la MISMA tx que
  // crea el cierre, en paralelo al pago al mensajero.
  ingresoByGestionId: Record<string, string>;
  totalIngresoBodegaRechazos: string;
}

// Fila cruda de un cierre pasado (R18); el repo la mapea a CierrePasadoDTO.
export type CierrePasadoRow = CierrePasadoDTO & { estado: CierreEstado };

// Feature 67 — proyeccion MINIMA de la gestion candidata a deshacerse + el estado real de su
// orden, con TODO lo que necesitan las guardias del service (design 64 §5.2) y nada mas (no
// expone montos ni evidencia: la decision no los usa). `anuladaAt` != null = ya deshecha (R3);
// `cierreId` != null = ya vinculada a un cierre (R2). `orden.estatusId` es el id REAL leido de
// la fila (no un `value`): se pasa tal cual como guardia del UPDATE, sin re-resolver catalogo.
export interface GestionDeshacerRow {
  gestionId: string;
  ordenId: string;
  mensajeroId: string; // R9: dueño de la gestion (la autz la decide el service)
  resultado: GestionResultado; // R5: insumo de la tabla ESTADOS_ESPERADOS
  cierreId: string | null; // R2
  anuladaAt: Date | null; // R3
  orden: {
    deletedAt: Date | null; // R6
    estatusId: string; // R5: id real del estado actual (guardia del UPDATE)
    estatusValue: string; // R5: `value` legible para contrastar con ESTADOS_ESPERADOS
  };
  /**
   * 💰 Feature 237 (T5.5, D3 firmada por el humano el 2026-08-20, R38) — `true` si esta gestion la
   * registro LA TIENDA desde la pestaña de ayuda.
   *
   * POR QUE HACE FALTA EL DATO, contado entero porque no se ve a simple vista: la gestion de la
   * tienda nace con `mensajero_id` = el mensajero (R3, que es lo que la mete en su cierre) y con
   * `cierre_id = NULL` (R9). Con eso PASA LAS OCHO GUARDIAS del deshacer —es «suya», la ventana
   * esta abierta, es la ultima, y el estado esperado casa— asi que, sin este campo, el mensajero
   * puede revertir la decision de la tienda: la orden vuelve a `en_reparto` reasignada a el, con
   * ella se van el intento contado y el `cobroRechazado`, y LA TIENDA NO SE ENTERA porque la fila
   * ya no esta en ninguna de sus pestañas.
   *
   * No es teorico: medido en produccion el 2026-08-20, deshacer se usa en 7 de 57 gestiones (12 %)
   * y un rechazo mueve hasta ₡1.000. Pasaria de verdad, y cada vez borraria en silencio dinero que
   * decidio otra persona.
   *
   * Se DERIVA del historial (`origen_tipo = gestion_tienda_ayuda` en la fila que enlaza esta
   * gestion), no de una columna nueva: quien la registro ya esta escrito ahi y una segunda verdad
   * habria que mantenerla.
   */
  desdeAyudaTienda: boolean;
}

// Feature 67/R11/R18/R19/R20/R22 — input de la UNICA escritura del deshacer. `estatusEsperadoId`
// es el `orden.estatusId` REAL leido por `findGestionParaDeshacer` (guardia optimista: si la
// orden se movio entre la lectura y la escritura, el UPDATE afecta 0 filas -> rollback).
export interface AnularGestionInput {
  gestionId: string;
  ordenId: string;
  mensajeroId: string; // R19: mensajero AUTOR (al que se repone la asignacion)
  actorUsuarioId: string; // R11/R20: quien deshace (rastro + actor del historial)
  estatusEsperadoId: string; // R5: estado en el que la orden DEBE seguir estando
  estatusEnRepartoId: string; // R18: destino
  /**
   * FEATURE 261 (B6/B7, R16/R19) — el INSTANTE de la reasignacion, resuelto por el SERVICIO.
   *
   * Va como parametro y NO como `NOW()` del motor a proposito: si el instante saliera del reloj
   * de Postgres y el dia (`diaEnCurso`) del reloj de la aplicacion, las dos columnas podrian
   * caer a distinto lado de la medianoche de Costa Rica — la clase exacta de
   * segunda-definicion-del-dia que este repo persigue. Los dos salen del MISMO `now`.
   */
  asignadoAt: Date;
  /**
   * FEATURE 261 (B6/B7, R17/R18/R19) — el DIA DE COSTA RICA EN CURSO (convencion `@db.Date`:
   * medianoche UTC de la fecha calendario CR), resuelto por el SERVICIO con `startOfDayCR(now)`.
   *
   * NO se calcula dentro del repositorio —que es lo que hacia hasta la 261, leyendo el reloj del
   * proceso— ni se deriva del reloj del motor. Es el reloj inyectable de R19: sin el, «deshacer a
   * las 23:59 del 21» no se puede probar sin falsear el reloj global.
   */
  diaEnCurso: Date;
}

/** Feature 146 (R24): proyeccion minima del cierre `solicitado` para componer su aviso. */
export interface CierreSolicitadoInfo {
  id: string;
  destinoZonaId: string | null;
  mensajeroNombre: string | null;
}

export interface ICierreDiaRepository {
  /**
   * R2/R3: gestiones del mensajero con `cierre_id IS NULL` + detalle de la orden
   * (join a orden/tienda/geografia). Filtro por mensajero en el WHERE. Solo query.
   */
  findGestionesPendientes(mensajeroId: string): Promise<CierreGestionPendienteRow[]>;
  /**
   * R10: cuenta las ordenes asignadas al mensajero (no borradas) cuyo estado esta
   * en `estados` (por_recoger/en_reparto/ayuda_tienda = pendientes de gestion) **y** que no esten
   * reservadas para un dia POSTERIOR a `hoyCR` (feature 246: el predicado gemelo del corte).
   *
   * `hoyCR` es la medianoche UTC de la fecha CALENDARIO de CR del dia en curso (`startOfDayCR`),
   * resuelta por el SERVICIO desde su `now` inyectable. Es un parametro REQUERIDO a proposito: con
   * un default, una llamada nueva que lo olvidara volveria al conteo sin dia y el gate contaria de
   * mas otra vez, en silencio.
   */
  contarOrdenesPendientesGestion(
    mensajeroId: string,
    estados: string[],
    hoyCR: Date,
  ): Promise<number>;
  /**
   * Feature 146 (R24) -> FEATURE 271 (R56) — datos MINIMOS de UN cierre CONCRETO: su id (entidad de
   * origen de la notificacion), la zona DESTINO (alcance del `adminSatelite`) y el nombre del
   * mensajero (anexo, §4.6). `null` si el cierre no existe (el aviso simplemente no se emite).
   *
   * ⚠️ RECIBE EL `cierreId`, NO EL `mensajeroId`, Y ESO CIERRA **M9**. Antes era
   * `findCierreSolicitado(mensajeroId)` con `orderBy createdAt DESC`: derogado el invariante de
   * «un solo cierre abierto» (R9), con dos `solicitado` devolvia siempre el mas nuevo y el aviso
   * nombraba el cierre equivocado. El llamador ya tiene el id del cierre que acaba de tocar.
   *
   * OPCIONAL a proposito: declararlo obligatorio romperia los dobles de test de las features
   * 37/38/109/111 que implementan esta interfaz a mano. El repositorio REAL si lo implementa; un
   * doble que no lo traiga simplemente no notifica.
   */
  findCierreParaAviso?(cierreId: string): Promise<CierreSolicitadoInfo | null>;
  /**
   * FEATURE 271 (R18) — el cierre RE-SOLICITABLE (`vencido` o `rechazado`) MAS VIEJO del mensajero,
   * o `null` si no tiene ninguno. Orden `solicitado_at` ASC con desempate estable por `id` ASC.
   *
   * ⚠️ SUSTITUYE A `existeCierreVencido` + `existeCierreRechazado`, que hacian elegir por ESTADO y
   * no por EDAD: con un `rechazado` viejo y un `vencido` nuevo, el servicio resolvia el nuevo
   * primero, contradiciendo «del mas viejo al mas nuevo». Con un solo cierre abierto daba igual;
   * con dos, no.
   */
  findCierreResolicitableMasViejo(
    mensajeroId: string,
  ): Promise<{ id: string; estado: CierreEstado } | null>;
  /**
   * FEATURE 271 (R19/R20) — transiciona ESE cierre a `solicitado`, con el `id` EN EL `where` y la
   * guarda anti-TOCTOU por `estadoEsperado`. `true` si afecto exactamente 1 fila; `false` si 0
   * (carrera: ya lo movieron) -> el service lo traduce a `conflict` SIN haber escrito nada.
   *
   * ⚠️ EL `id` EN EL `where` ES LA CORRECCION DE **M2**. Sus dos predecesores filtraban por
   * `(mensajeroId, estado)`: con dos `rechazado` movian LOS DOS, `count` valia 2 y el `=== 1`
   * devolvia `false` — escribian y reportaban fallo. Con la clave primaria en el `where`, `count`
   * solo puede ser 0 o 1.
   *
   * MONEY-SAFE: SOLO cambia `estado`. NO toca totales snapshot, `total_pago_mensajero`,
   * `total_ingreso_bodega_rechazos`, los `cierre_id` de las gestiones, ni
   * `resuelto_por`/`resuelto_at`/`motivo_rechazo`/`solicitado_at`.
   *
   * El BLOQUEO del mensajero se levanta con esta misma escritura solo si con ella queda en
   * `N <= 1, V = 0` (271/R8): con dos cierres abiertos sigue bloqueado, y la salida es que la
   * bodega apruebe el mas viejo. La liberacion de `sin_gestionar` sigue siendo del admin al
   * aprobar (109/R16), por otro camino.
   */
  transicionarASolicitado(cierreId: string, estadoEsperado: CierreEstado): Promise<boolean>;
  /**
   * R13/R14: bajo prisma.$transaction (todo-o-nada): (a) INSERT cierre_dia con el
   * destino derivado + los totales snapshot (estado `solicitado` por defecto, o
   * `vencido` para el corte diario, feature 41/C1), (b) UPDATE gestion_orden SET
   * cierre_id = <nuevo> WHERE mensajero_id = actor AND cierre_id IS NULL (guardia de
   * propiedad + no-cerradas; concurrencia-segura). Devuelve el id del cierre, o `null`
   * si el UPDATE guardado vincula 0 gestiones (carrera: otra solicitud/corte las vinculo
   * primero) -> rollback de la tx, sin efectos (R8/R9/R23).
   */
  crearCierre(input: CrearCierreInput): Promise<string | null>;
  /** R18: cierres del mensajero (mas reciente primero) con estado + totales. */
  findCierresByMensajero(mensajeroId: string): Promise<CierrePasadoDTO[]>;
  /**
   * Cierre PROPIO del mensajero (cabecera + sus gestiones vinculadas), para el detalle de
   * "ver" un cierre anterior. El scope va en el WHERE (`id` + `mensajero_id`): un cierre de
   * otro mensajero devuelve `null` igual que uno inexistente, sin distinguirse.
   *
   * Usa la MISMA proyeccion que la vista en vivo (`WITH_DETALLE`), que deja la indemnizacion
   * FUERA de la consulta a proposito (design §7.2). Los montos que si viajan (pago al
   * mensajero, ingreso de bodega) son los SNAPSHOT congelados en la gestion al solicitar el
   * cierre, no valores re-derivados de la tarifa de hoy.
   */
  findCierrePropioConGestiones(
    cierreId: string,
    mensajeroId: string,
  ): Promise<{
    cierre: CierrePasadoDTO;
    gestiones: CierreGestionPendienteRow[];
    /**
     * Feature 264 (B9/R7/R30) — las ordenes que el corte barrio al crear ESTE cierre. Cuelgan de
     * `cierre_id`, que el `findFirst` de arriba ya acoto por `mensajero_id` en el WHERE: heredan
     * ese alcance y NO necesitan guardia propia ni un filtro en memoria.
     */
    sinGestion: CierreSinGestionRow[];
    /** R27/R28: `false` = cierre ANTERIOR al registro; `[]` con `false` NO es «no hubo ninguna». */
    sinGestionRegistrado: boolean;
  } | null>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA de los cierres del
   * mensajero + el TOTAL del conjunto.
   *
   * Es `findCierresByMensajero` con el recorte `skip`/`take`, compartiendo proyeccion, mapper
   * y `orderBy solicitadoAt desc` (R51). El `where { mensajeroId }` es el acotamiento por
   * actor y va tambien en el `count`: pagina y total cuentan el MISMO conjunto (R41/R44).
   */
  findCierresByMensajeroPaginado(
    mensajeroId: string,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CierrePasadoDTO>>;
  /**
   * Feature 67 — lee la gestion candidata a deshacerse + el estado real de su orden. Devuelve
   * la fila SIN juzgarla (las guardias de R2/R3/R5/R6/R9 viven en el service); `null` si la
   * gestion no existe. Solo query.
   */
  findGestionParaDeshacer(gestionId: string): Promise<GestionDeshacerRow | null>;
  /**
   * Feature 67/R4 — id de la gestion NO anulada mas reciente de la orden (`orderBy created_at
   * desc`), o `null` si la orden no tiene ninguna vigente. El service exige que coincida con la
   * gestion a deshacer: solo se deshace la ULTIMA. Se ordena por `gestion_orden.created_at` (una
   * gestion por tx) y NO por filas de historial, que pueden empatar en `created_at` (design §8).
   */
  findUltimaGestionNoAnuladaId(ordenId: string): Promise<string | null>;
  /**
   * Feature 67/R11/R18-R23 — UNICA escritura del deshacer, todo-o-nada en UNA `$transaction`
   * (R22): (1) ANULA la gestion con rastro (`anulada_at`/`anulada_por`) conservando intactos
   * todos sus datos originales (R11/R12), (2) devuelve la orden a `en_reparto` REPONIENDO la
   * asignacion al mensajero autor (R18/R19: una gestion `devuelta` con reintento habia limpiado
   * `mensajero_asignado_id`), (3) registra la transicion por el CHOKE POINT del historial
   * (`appendCambioEstado`, `origen_tipo = deshacer_gestion`) en la MISMA tx (R20/R21). NO toca
   * `usuario.orden_en_gestion_id` (R29) ni ninguna fila previa del historial (R23).
   *
   * Ambas escrituras van GUARDADAS en su WHERE (concurrencia-segura): si la gestion dejo de ser
   * deshacible o la orden se movio entre la lectura y la escritura, afecta 0 filas -> rollback
   * -> `false` SIN efectos parciales (el service lo traduce a `conflict`). `true` = deshecha.
   *
   * FEATURE 261 (B7, R16/R17/R18) — el paso (2) escribe `fecha_reparto` EN LA MISMA sentencia
   * que `asignado_at` (la invariante 246/R10 se conserva entera), pero ya no la baja siempre a
   * hoy: **una reserva a FUTURO se conserva**. La regla vive en un `CASE` dentro del `SET`, asi
   * que decide sobre la fila y no sobre una lectura previa.
   */
  anularGestionYDevolverAGestion(input: AnularGestionInput): Promise<boolean>;
}
