import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearGestionDesdeAyudaInput,
  GestionOrdenData,
  IGestionOrdenRepository,
  MiAsignacionRow,
  OrdenGestionRow,
  RechazarDesdeDevueltaInput,
  ReprogramarDesdeDevueltaInput,
  VentanaDia,
} from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import { SinGestionDevueltaError } from "@/lib/interfaces/repositories/IGestionOrdenRepository";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import {
  encolarOptimizacionDebounce,
  encolarOptimizacionInmediata,
} from "@/lib/services/jobs/optimizacion-ruta-encolado";
import { loadRouteOptimizationConfig } from "@/lib/config/route-optimization";
// Feature 261 (B5): el dia de reparto entra al SQL crudo como texto `YYYY-MM-DD` con `::date`.
// NO se importa `startOfDayCR`: este repositorio NO resuelve ningun dia, lo RECIBE resuelto.
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";

// Feature 61: estado terminal de entrega para el KPI "entregadas" del portal.
const ESTATUS_ENTREGADA = "entregada";
// Estado de las ordenes que el mensajero lleva encima. El KPI "Total a cobrar" lo EXCLUYE de
// su parte gestionada porque esa mitad ya la aporta `porCobrar` (ver `gestionadasDelDiaWhere`).
const ESTADO_EN_REPARTO = "en_reparto";
// Feature 235 (R21): los estatus en los que el paquete SIGUE EN LA MANO del mensajero, y que por
// tanto aporta el OTRO sumando de `totalACobrar` (`porCobrar`, calculado sobre
// `porGestionar ∪ conAyuda` en `MisAsignacionesService`). Los dos sumandos se mantienen disjuntos
// excluyendo AQUI exactamente ese conjunto.
const ESTADOS_EN_MANO_DEL_MENSAJERO = [ESTADO_EN_REPARTO, "ayuda_tienda"];

// Feature 100 — `resultado` de la gestion que ancla la ventana en `devuelta` (R5: de ahi se deriva
// el mensajero de la gestion sintetica) y `resultado` de la gestion sintetica de reprogramacion
// (R3). Valores del catalogo `gestion_resultado` ya sembrados; esta feature NO agrega estados.
const RESULTADO_DEVUELTA = "devuelta";
const RESULTADO_REPROGRAMADA = "reprogramada";

// 💰 Feature 240 (D1/D8) — el `resultado` y la FAMILIA de la gestion sintetica del RECHAZO MANUAL
// de la tienda. El `resultado` es EL MISMO que escribe el cron de plazo vencido (99), y esa
// igualdad es el requisito (R17/R22): de el cuelgan `ingresoBodegaPorResultado` (56) y
// `derivarIngresoOrden` (42/43), asi que las dos vias facturan lo mismo sin aritmetica nueva.
// La FAMILIA, en cambio, es propia y NO `escalado_devuelta_sla`: es lo unico que distingue «lo
// decidio la tienda» de «se vencio el plazo», y de ella cuelgan la pestaña «Rechazadas por plazo
// vencido» (102) y `esRechazoSla`.
const RESULTADO_RECHAZADA = "rechazada";
const ORIGEN_TIPO_RECHAZO_TIENDA = "rechazo_tienda" satisfies OrdenHistorialOrigenTipo;

// `resultado` de la gestion que ancla los KPIs de entregadas a SU DIA. Homonimo de
// `ESTATUS_ENTREGADA` pero de otro vocabulario (enum `gestion_resultado`, no el catalogo
// `order_status`): por eso son dos constantes y no una compartida.
const RESULTADO_ENTREGADA = "entregada";

/**
 * Gestion VIGENTE del mensajero dentro de la ventana del dia. Es el acote comun de los dos
 * KPIs de jornada, y va sobre la GESTION —no sobre la orden— porque `orden` no tiene
 * `entregada_at` ni `gestionada_at`: `updatedAt` lo mueve cualquier edicion posterior (una
 * nota, una reasignacion) y sacaria la gestion de su dia real.
 *
 * `anuladaAt: null` es el mismo criterio de "gestion VIGENTE" que usa `RankingRepository`
 * (feature 67/R11): una gestion deshecha deja de contar. `mensajeroId` la ancla a QUIEN
 * gestiono, asi que una reasignacion posterior no le regala el KPI a otro mensajero.
 * `createdAt` half-open cubre el dia sin invadir el primer instante del siguiente.
 */
function gestionDelDia(mensajeroId: string, dia: VentanaDia) {
  return {
    mensajeroId,
    anuladaAt: null,
    createdAt: { gte: dia.desde, lt: dia.hasta },
  } satisfies Prisma.GestionOrdenWhereInput;
}

/** KPI "Entregadas": ordenes propias, no borradas, ENTREGADAS por el mensajero HOY. */
function entregadasDelDiaWhere(mensajeroId: string, dia: VentanaDia) {
  return {
    mensajeroAsignadoId: mensajeroId,
    deletedAt: null,
    estatus: { value: ESTATUS_ENTREGADA },
    gestiones: { some: { ...gestionDelDia(mensajeroId, dia), resultado: RESULTADO_ENTREGADA } },
  } satisfies Prisma.OrdenWhereInput;
}

/**
 * KPI "Total a cobrar" (parte YA GESTIONADA): ordenes propias, no borradas, con una gestion
 * vigente del mensajero HOY, SEA CUAL SEA su resultado.
 *
 * Sin filtro de `resultado` a proposito: el total del dia mide TODO lo que paso por las manos
 * del mensajero, no solo lo que termino cobrado. Una devuelta o una reprogramada gestionadas
 * hoy siguen siendo parte de su jornada; si se filtraran, el total bajaria cada vez que una
 * orden NO se entrega, que es justo cuando el mensajero necesita que el numero no se mueva.
 *
 * La exclusion por estatus es lo que hace DISJUNTOS los dos sumandos de `totalACobrar`. Sin ella
 * habria doble conteo real: una orden gestionada hoy como `reprogramada` y liberada de vuelta a
 * reparto el mismo dia (feature 46) cae en los DOS conjuntos y su COD se sumaria dos veces. La
 * exclusion vive AQUI, en la query, y no en el service, para que ningun llamador futuro pueda
 * combinarlos mal.
 *
 * FEATURE 235 (R21, 2026-08-19) — la lista pasa de UN value a DOS, y es la RED, no el arreglo de un
 * fallo vivo. El otro sumando (`porCobrar`) se calcula sobre `porGestionar ∪ conAyuda`, asi que
 * desde la 235 el conjunto «lo que el mensajero lleva en la mano» incluye `ayuda_tienda` — y esta
 * red solo cubria `en_reparto`.
 *
 * ¿Habia doble conteo de verdad? NO, y conviene decir por que para que nadie la quite: para tener
 * una gestion VIGENTE de hoy y estar ademas en `ayuda_tienda` haria falta volver a `en_reparto`
 * despues de gestionar, y el unico camino que hace eso es `deshacerGestion`, que ANULA la gestion
 * (`anuladaAt`) — y `gestionDelDia` exige `anuladaAt: null`. O sea que el conjunto era vacio por
 * alcanzabilidad. Se amplia igualmente porque «vacio hoy» es justo el argumento que este `where`
 * dice no querer usar: la exclusion esta aqui para que la disjuncion sea CIERTA POR CONSTRUCCION y
 * no dependa de que nadie abra un camino nuevo (la 237 abre aristas desde `ayuda_tienda`).
 */
function gestionadasDelDiaWhere(mensajeroId: string, dia: VentanaDia) {
  return {
    mensajeroAsignadoId: mensajeroId,
    deletedAt: null,
    estatus: { value: { notIn: ESTADOS_EN_MANO_DEL_MENSAJERO } },
    gestiones: { some: gestionDelDia(mensajeroId, dia) },
  } satisfies Prisma.OrdenWhereInput;
}

/**
 * Feature 119/212 + 237 (T5.1) — EL INSERT de una gestion y de sus filas hijas, en UN solo sitio.
 *
 * Lo comparten los DOS caminos que crean una `gestion_orden` en este repositorio: el del mensajero
 * (`crearGestionYTransicionar`) y el de la tienda desde ayuda (`crearGestionDesdeAyuda`). Se
 * extrajo al escribir el segundo, porque 237/R2 exige que la fila de la tienda tenga «la MISMA
 * forma» que la del mensajero para ese resultado — y dos INSERT paralelos son exactamente como esa
 * igualdad deja de ser cierta sin que nadie lo note.
 *
 * Corre SIEMPRE dentro de la `$transaction` del llamador: recibe el `tx`, no el cliente. Lo que NO
 * hace es transicionar la orden, tocar punteros ni appendear historial: eso lo decide cada camino.
 */
async function insertarGestionConHijas(
  tx: Prisma.TransactionClient,
  ordenId: string,
  mensajeroId: string,
  gestion: GestionOrdenData,
): Promise<string> {
  // Feature 119 (R12): PORTADA denormalizada = evidencia indice 0 (o la primera si no hay
  // un 0 explicito). Retro-compat: si el caller aun pasa la portada suelta y no la lista,
  // se cae a `evidenciaStoragePath/_content_type`. La escriben el MISMO INSERT que las hijas.
  const cover =
    gestion.evidencias?.find((e) => e.indice === 0) ?? gestion.evidencias?.[0] ?? null;
  const coverStoragePath = cover?.storagePath ?? gestion.evidenciaStoragePath ?? null;
  const coverContentType = cover?.contentType ?? gestion.evidenciaContentType ?? null;
  const creada = await tx.gestionOrden.create({
    data: {
      ordenId,
      mensajeroId,
      resultado: gestion.resultado,
      montoRecibido:
        gestion.montoRecibido != null ? new Prisma.Decimal(gestion.montoRecibido) : null,
      metodoPago: gestion.metodoPago ?? null,
      // Feature 119 (R12): dual-write de la portada (indice 0) en las columnas viejas para que
      // los consumidores actuales (cierres 37/38/40, API 106) sigan mostrando UNA foto sin cambios.
      evidenciaStoragePath: coverStoragePath,
      evidenciaContentType: coverContentType,
      motivo: gestion.motivo ?? null,
      fechaReprogramacion: gestion.fechaReprogramacion
        ? new Date(`${gestion.fechaReprogramacion}T00:00:00.000Z`)
        : null,
      // Feature 73/R11/R13: la causa entra en el MISMO INSERT que la gestion, dentro de
      // la tx que cambia el estatus -> si algo falla, la causa NO queda persistida
      // (atomicidad ya provista, sin firma nueva).
      causaDevolucion: gestion.causaDevolucion ?? null,
      // Feature 158/R6/R9: la causa del incidente entra en el MISMO INSERT que la gestion,
      // dentro de la tx que cambia el estatus -> si algo falla, NADA queda persistido
      // (atomicidad ya provista, sin firma nueva). `indemnizacion` NO se escribe aqui: el
      // monto lo captura el admin al APROBAR el cierre (R19/R22).
      causaIncidente: gestion.causaIncidente ?? null,
      // Feature 193 (R1/R6): la ubicacion entra en el MISMO INSERT que la gestion, dentro
      // de la tx que cambia el estatus -> si algo falla, NO queda una ubicacion huerfana
      // apuntando a una gestion que no existe (atomicidad ya provista, sin firma nueva).
      // Decimal, no Float: mismo criterio que `montoRecibido` unas lineas arriba.
      ubicacionLat:
        gestion.ubicacionLat != null ? new Prisma.Decimal(gestion.ubicacionLat) : null,
      ubicacionLng:
        gestion.ubicacionLng != null ? new Prisma.Decimal(gestion.ubicacionLng) : null,
      ubicacionAusencia: gestion.ubicacionAusencia ?? null,
    },
    select: { id: true },
  });
  // Feature 119 (R1/R2/R9): las N filas hijas se insertan en la MISMA transaccion (todo-o-nada
  // con la gestion + la transicion). Vacio (reprogramada / sin fotos) no inserta nada.
  if (gestion.evidencias && gestion.evidencias.length > 0) {
    await tx.gestionOrdenEvidencia.createMany({
      data: gestion.evidencias.map((e) => ({
        gestionId: creada.id,
        storagePath: e.storagePath,
        contentType: e.contentType,
        indice: e.indice,
      })),
    });
  }
  // Feature 212 (R17/R20): las 0..N lineas del DESGLOSE del recaudo se insertan en la MISMA
  // transaccion que la gestion y la transicion (todo-o-nada): si algo falla mas abajo, no
  // queda ninguna linea huerfana ni una gestion sin su desglose. Lista vacia (entrega sin
  // cobro, o cualquier otro resultado) no inserta nada. `monto` como `Prisma.Decimal`, mismo
  // criterio que `montoRecibido`: aqui no entra un float.
  if (gestion.pagos && gestion.pagos.length > 0) {
    await tx.gestionOrdenPago.createMany({
      data: gestion.pagos.map((p) => ({
        gestionId: creada.id,
        metodo: p.metodo,
        monto: new Prisma.Decimal(p.monto),
      })),
    });
  }
  return creada.id;
}

type GestionPrismaClient = Pick<
  PrismaClient,
  // Feature 119 (R1/R9): + `gestionOrdenEvidencia` para insertar las N filas hijas dentro de
  // la MISMA transaccion que crea la gestion y transiciona la orden.
  "orden" | "usuario" | "gestionOrden" | "gestionOrdenEvidencia" | "$transaction"
>;

// Proyeccion de "mis asignaciones": la orden + nombres legibles via relaciones ya
// existentes (patron OrdenRepository.WITH_ETIQUETA). No expone deletedAt.
const WITH_ASIGNACION = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    peso: true,
    montoCobrar: true,
    // Feature 97: coordenadas geocodificadas (feature 91) para dibujar el mapa de ruta.
    latitud: true,
    longitud: true,
    notas: true,
    mensajeroAsignadoId: true,
    // Feature 246 (T3.7/T5.1, R26/R35): el dia de reparto viaja en la proyeccion QUE YA EXISTE,
    // sin una consulta nueva. De aqui sale `esParaManana` del DTO, que lo deriva el SERVIDOR: el
    // navegador no vuelve a decidir que dia es hoy.
    fechaReparto: true,
    estatus: { select: { value: true } },
    // Feature 157 (R15): el telefono de la TIENDA acompaña a su nombre — el mensajero que va
    // a recolectar necesita poder contactarla, y el modelo no tiene direccion de tienda.
    tienda: { select: { nombre: true, telefono: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type AsignacionRow = Prisma.OrdenGetPayload<typeof WITH_ASIGNACION>;

function toMiAsignacionRow(row: AsignacionRow): MiAsignacionRow {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatus.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    peso: row.peso ? row.peso.toNumber() : null,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    // Feature 97: Decimal -> number|null con el MISMO patron que `montoCobrar` (una instancia
    // Decimal es siempre truthy, incluida la de valor 0, asi que 0.0 NO se pierde: solo null->null).
    latitud: row.latitud ? row.latitud.toNumber() : null,
    longitud: row.longitud ? row.longitud.toNumber() : null,
    notas: row.notas,
    tiendaNombre: row.tienda.nombre,
    tiendaTelefono: row.tienda.telefono, // feature 157/R15
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
    mensajeroAsignadoId: row.mensajeroAsignadoId,
    // Feature 246 (R35): la fecha CRUDA llega hasta el service, que es quien la compara con el dia
    // de Costa Rica en curso. El repositorio no interpreta el dia: no tiene reloj.
    fechaReparto: row.fechaReparto,
  };
}

/**
 * Feature 240 (design §4.2, T2.1) — LOS TRES PASOS QUE COMPARTEN LAS DOS SALIDAS DE ESCRITORIO DE
 * `devuelta`: la reprogramacion de la tienda (100) y el rechazo manual de la tienda (240). Extraido
 * de `reprogramarDesdeDevuelta`, sin cambiar su conducta ni su firma publica.
 *
 * POR QUE UN HELPER Y NO UNA TERCERA COPIA (alternativa A del design §14): serian TRES
 * transacciones con la misma guarda de estado, la misma derivacion del mensajero (con su `throw` si
 * falta) y el mismo append por el choke point. El dia que alguien arregle una —un `deletedAt` que
 * falta, un `orderBy` mal— las otras dos se enteran EN PRODUCCION. Y no se renombra el metodo
 * publico (alternativa B) porque eso movería los call-sites y los dobles de test de una feature de
 * dinero que ya esta viva, a cambio de nada que este helper no de.
 *
 * La 237 escribio que NO generalizaba `reprogramarDesdeDevuelta` «porque su semantica —derivar el
 * mensajero de la ultima `devuelta` vigente— es otra». Aqui ES LA MISMA, asi que el mismo argumento
 * apunta en la direccion contraria.
 *
 * Lo unico que cada llamador aporta: el destino, la familia del historial, el motivo y COMO se crea
 * su gestion (paso 3, que es lo unico que difiere de verdad).
 *
 * ⚠️ El `data` del UPDATE toca EXCLUSIVAMENTE `estatusId`. Ni `mensajero_asignado_id`, ni
 * `prioridad`, ni ningun monto (240/R14/R20): el paquete ya no esta en ruta y el bloque 139 de la
 * aprobacion busca las `rechazada` POR `mensajeroAsignadoId`, asi que limpiarlo dejaria al paquete
 * sin ruta de vuelta a la tienda.
 */
async function transicionarDesdeDevuelta(
  prisma: GestionPrismaClient,
  input: {
    ordenId: string;
    /** GUARDA del UPDATE: la orden tiene que seguir en `devuelta` (R3/R4). */
    estatusDevueltaId: string;
    estatusDestinoId: string;
    /** Familia propia de cada via: es lo unico que distingue quien decidio. */
    origenTipo: OrdenHistorialOrigenTipo;
    /** Quien lo decidio: el adminTienda. Va al historial, NUNCA a la gestion (R9/R11). */
    actorUsuarioId: string;
    motivo: string | null;
    /** Nombre del metodo publico, para que el `throw` del paso 2 diga de donde viene. */
    llamador: string;
    /** Paso 3: crea la gestion sintetica con el mensajero YA derivado. Devuelve su id. */
    crearGestion: (
      tx: Prisma.TransactionClient,
      mensajeroId: string,
    ) => Promise<{ id: string }>;
  },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // 1) UPDATE guardado por estatus=devuelta + no borrada -> destino. La comprobacion del estado
    //    de origen va EN LA MISMA SENTENCIA que lo muta: entre comprobar y escribir no queda
    //    ninguna ventana, y sobre esta fila hay VARIOS actores (el cron de la 99, la bodega, la
    //    tienda). Una guarda en el service seria una lectura optimista, no una barrera.
    const result = await tx.orden.updateMany({
      where: {
        id: input.ordenId,
        estatusId: input.estatusDevueltaId, // guarda de idempotencia/carrera con el cron 99
        deletedAt: null,
      },
      data: { estatusId: input.estatusDestinoId },
    });
    // La orden ya salio de `devuelta` -> no crea gestion ni append (no-op, sin efectos).
    if (result.count === 0) return false;

    // 2) mensajero de la ULTIMA gestion `devuelta` VIGENTE, leido dentro de la tx (mismo criterio
    //    de vigencia que `findDevueltasSla` de la 99: no anulada, mas reciente).
    const ancla = await tx.gestionOrden.findFirst({
      where: { ordenId: input.ordenId, resultado: RESULTADO_DEVUELTA, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      select: { mensajeroId: true },
    });
    if (!ancla) {
      // Anomalia: una orden en `devuelta` SIN gestion `devuelta` vigente no tiene a quien
      // atribuir la gestion sintetica (`mensajero_id` NOT NULL). Abortar la tx (revierte el
      // UPDATE) es preferible a inventar un actor.
      // 2026-08-20: era un `Error` pelado y salia como `INTERNAL`, que la pantalla no sabe pintar
      // — la tienda pulsaba y no pasaba NADA. Clase propia para que el service lo distinga de una
      // caida de base y lo convierta en un desenlace con texto. El `throw` se queda: es lo que
      // ABORTA la transaccion y revierte el `updateMany` de arriba.
      throw new SinGestionDevueltaError(input.llamador);
    }

    // 3) la gestion sintetica, que es lo unico que difiere entre las dos vias.
    const gestion = await input.crearGestion(tx, ancla.mensajeroId);

    // 4) append por el choke point (49), actor = adminTienda, familia propia, enlazando la gestion;
    //    origen `devuelta` (fijado por la guarda del UPDATE).
    await appendCambioEstado(tx, [
      {
        ordenId: input.ordenId,
        estatusOrigenId: input.estatusDevueltaId,
        estatusDestinoId: input.estatusDestinoId,
        actorUsuarioId: input.actorUsuarioId,
        origenTipo: input.origenTipo,
        motivo: input.motivo,
        gestionOrdenId: gestion.id,
      },
    ]);
    return true;
  });
}

export class GestionOrdenRepository implements IGestionOrdenRepository {
  /**
   * Feature 92 (design §4.3, R16/R19): `jobRepo` se inyecta para el encolado TRANSACTIONAL
   * OUTBOX de la reoptimizacion de ruta, EXACTAMENTE como `OrdenRepository` en la 91. El
   * default apunta al repo real, asi que ninguna fabrica existente cambia.
   */
  constructor(
    private readonly prisma: GestionPrismaClient,
    private readonly jobRepo: IJobRepository = new JobRepository(
      prisma as unknown as ConstructorParameters<typeof JobRepository>[0],
    ),
    /** Reloj inyectable: el `runAfter` del debounce debe ser determinista en tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** R9/R13: filtrado por mensajero + estado en el WHERE, no borradas. */
  async findMisAsignaciones(mensajeroId: string, estados: string[]): Promise<MiAsignacionRow[]> {
    if (estados.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: {
        mensajeroAsignadoId: mensajeroId, // R13: nunca ordenes de otro mensajero
        deletedAt: null,
        estatus: { value: { in: estados } },
      },
      orderBy: { createdAt: "desc" },
      ...WITH_ASIGNACION,
    });
    return rows.map(toMiAsignacionRow);
  }

  /**
   * 2026-08-11 — las MISMAS filas que `findMisAsignaciones`, resueltas por id en vez de por
   * estado. La necesita «Recolectadas hoy» (`/recoleccion`): esa lista sale del HISTORIAL, que
   * solo sabe QUÉ órdenes tocó el mensajero, y desde que pinta la card compartida hace falta el
   * resto de los datos de cada una.
   *
   * NO se puede resolver con `findMisAsignaciones`: una orden ya recolectada esta en
   * `en_ruta_bodega_central` o mas adelante (la bodega central ya la recibio), asi que no hay
   * lista de estados que la acote sin arrastrar ordenes que no son de esa lista.
   *
   * Conserva las dos guardias del hermano —propiedad (`mensajero_asignado_id`) y `deleted_at IS
   * NULL`— en el WHERE, nunca en el cliente: un id de historial no autoriza a leer la orden.
   */
  async findMisAsignacionesByIds(
    mensajeroId: string,
    ids: string[],
  ): Promise<MiAsignacionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: {
        id: { in: ids },
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
      },
      ...WITH_ASIGNACION,
    });
    return rows.map(toMiAsignacionRow);
  }

  /** Feature 61: conteo de entregadas del mensajero (KPI del portal), no borradas. */
  async contarEntregadas(mensajeroId: string, dia: VentanaDia): Promise<number> {
    return this.prisma.orden.count({
      where: entregadasDelDiaWhere(mensajeroId, dia),
    });
  }

  /** Suma de `montoCobrar` (COD) de las GESTIONADAS HOY del mensajero, ya fuera de reparto. */
  async sumMontoCobrarGestionadas(mensajeroId: string, dia: VentanaDia): Promise<number> {
    const agg = await this.prisma.orden.aggregate({
      _sum: { montoCobrar: true },
      where: gestionadasDelDiaWhere(mensajeroId, dia),
    });
    return agg._sum.montoCobrar ? agg._sum.montoCobrar.toNumber() : 0;
  }

  /** R27/R31: filas por id INCLUYENDO borradas (el service distingue el motivo). */
  async findByIdsParaGestion(ids: string[]): Promise<OrdenGestionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        deletedAt: true,
        mensajeroAsignadoId: true,
        montoCobrar: true,
        zonaId: true, // feature 47/R5: insumo del ruteo a bodega responsable en un reintento
        // Feature 261 (B3, R1/R2/R3): insumo de la guarda de reserva de las TRES operaciones del
        // mensajero. Viaja crudo; quien decide «reservada» es el service, con su reloj.
        fechaReparto: true,
        estatus: { select: { value: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      estatusValue: r.estatus.value,
      deletedAt: r.deletedAt,
      mensajeroAsignadoId: r.mensajeroAsignadoId,
      montoCobrar: r.montoCobrar ? r.montoCobrar.toNumber() : null,
      zonaId: r.zonaId,
      fechaReparto: r.fechaReparto,
    }));
  }

  /** R20: puntero de bloqueo 1-a-1 del mensajero. */
  async getOrdenEnGestion(mensajeroId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: mensajeroId },
      select: { ordenEnGestionId: true },
    });
    return row?.ordenEnGestionId ?? null;
  }

  /**
   * R19-R21: fija el puntero de forma condicional e idempotente. El WHERE exige
   * que el puntero este NULL o ya apunte a `ordenId`; si apunta a otra, `count`
   * sera 0 (una fila que no cumple el filtro no se actualiza). Se distingue de
   * "el puntero ya apuntaba a ordenId" releyendo la fila.
   */
  async setOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean> {
    const result = await this.prisma.usuario.updateMany({
      where: {
        id: mensajeroId,
        OR: [{ ordenEnGestionId: null }, { ordenEnGestionId: ordenId }],
      },
      data: { ordenEnGestionId: ordenId },
    });
    if (result.count > 0) return true;
    // count 0: o bien el usuario no existe, o ya tiene OTRA orden activa. Releer
    // para confirmar el estado real (idempotencia ante carreras).
    const actual = await this.getOrdenEnGestion(mensajeroId);
    return actual === ordenId;
  }

  /**
   * R35: limpia el puntero de bloqueo del PROPIO mensajero SOLO si apunta a esa
   * orden. El WHERE guardado (`id = mensajeroId`, `ordenEnGestionId = ordenId`)
   * garantiza que nunca toca el puntero de otro actor ni limpia si apunta a otra
   * orden. Idempotente: `count 0 -> false` (no habia nada que limpiar).
   */
  async liberarOrdenEnGestion(mensajeroId: string, ordenId: string): Promise<boolean> {
    const result = await this.prisma.usuario.updateMany({
      where: { id: mensajeroId, ordenEnGestionId: ordenId },
      data: { ordenEnGestionId: null },
    });
    return result.count > 0;
  }

  /**
   * R15/R16: guardia de propiedad + origen en el WHERE; devuelve filas afectadas.
   *
   * FEATURE 261 (B5, R1/R4/R5/R7/R8) — CUARTA GUARDIA: el DIA DE REPARTO. Una orden reservada
   * para un dia POSTERIOR al de Costa Rica en curso no se recoge, y el rechazo vive AQUI —en la
   * sentencia que muta— y no solo en el service: una peticion que no venga del portal se rechaza
   * igual (R5), y no hay ventana entre comprobar y escribir.
   */
  async recogerLote(
    ordenIds: string[],
    mensajeroId: string,
    origenEstatusId: string,
    destinoEstatusId: string,
    diaEnCurso: Date,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // Feature 49/#8 (R7/R8/R16): UPDATE guardado por propiedad + origen, con `RETURNING id`
    // dentro de un `$transaction` -> el append cubre EXACTAMENTE las ordenes que ganaron la
    // guarda (una que perdio la carrera / no era del mensajero / no estaba en el origen no
    // aparece en el RETURNING, no deja rastro). El actor es el propio mensajero (`mensajeroId`
    // ya es `actor.usuarioId`); origen = `origenEstatusId` (fijado por la guarda). `updated_at`
    // se fija a mano (el raw no dispara el @updatedAt de Prisma). Devuelve el count de filas.
    // Feature 261 (B5): el dia entra como TEXTO `YYYY-MM-DD` con `::date` EXPLICITO, no como
    // `Date`. El porque esta escrito en `dia-reparto.ts` y no es teorico: el driver `pg`
    // serializa un `Date` de JS como `timestamptz` y Postgres lo convierte a `date` con el
    // `TimeZone` DE LA SESION — o sea, el dia dependeria de la configuracion del servidor de
    // base de datos. `'2026-08-21'::date` es el 21 en cualquier sesion.
    const diaTexto = fechaRepartoComoTexto(diaEnCurso);
    return this.prisma.$transaction(async (tx) => {
      // Feature 261 (R1/R8): el predicado del dia es COPIADO del corte, no reinventado — es
      // literalmente el `OR: [{ fechaReparto: null }, { fechaReparto: { lte: diaCerrado } }]` de
      // `CorteDiarioRepository.findMensajerosConPendientes` y de `CierreDiaRepository.crearCierre`.
      // Dos formas distintas de la misma pregunta acaban midiendo cosas distintas; ya paso aqui.
      // `IS NULL` entra por la primera rama y se recoge igual que siempre (R8), y es `<=` y no
      // `<` porque una orden reservada para HOY es de hoy: se recoge.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "orden"
        SET "estatus_id" = ${destinoEstatusId},
            "updated_at" = NOW()
        WHERE "id" IN (${Prisma.join(ordenIds)})
          AND "mensajero_asignado_id" = ${mensajeroId}
          AND "estatus_id" = ${origenEstatusId}
          AND "deleted_at" IS NULL
          AND ("fecha_reparto" IS NULL OR "fecha_reparto" <= ${diaTexto}::date)
        RETURNING "id"`;
      await appendCambioEstado(
        tx,
        rows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: origenEstatusId, // por_recoger (fijado por la guarda)
          estatusDestinoId: destinoEstatusId, // en_reparto
          actorUsuarioId: mensajeroId, // R21: el mensajero que recoge
          origenTipo: "recoleccion", // R23
        })),
      );
      // Feature 92 (R16): la recogida cambia el conjunto de paradas del mensajero -> se
      // encola una reoptimizacion DIFERIDA, DENTRO de esta misma transaccion (outbox): si
      // el UPDATE revierte, el job se va con el. El debounce colapsa las 8 recogidas de
      // "recoger todas" en UN job (R17), no en ocho llamadas facturadas.
      //
      // Solo si alguna orden gano la guarda: `rows.length === 0` significa que nada
      // cambio, asi que no hay nada que reoptimizar.
      if (rows.length > 0) {
        await encolarOptimizacionDebounce(
          this.jobRepo,
          tx as unknown as JobTxClient,
          mensajeroId,
          {
            ahora: this.now(),
            debounceS: loadRouteOptimizationConfig().RUTA_DEBOUNCE_S,
          },
        );
      }
      return rows.length;
    });
  }

  /** R23/R26/R28/R30: INSERT gestion + UPDATE estatus + limpiar puntero, atomico. */
  async crearGestionYTransicionar(input: {
    ordenId: string;
    mensajeroId: string;
    gestion: GestionOrdenData;
    nuevoEstatusId: string;
  }): Promise<string> {
    const { ordenId, mensajeroId, gestion, nuevoEstatusId } = input;
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#9 (R20): estatus de ORIGEN (en_reparto) pre-leido dentro de la tx.
      const actual = await tx.orden.findFirst({
        where: { id: ordenId },
        select: { estatusId: true },
      });
      // Feature 237 (T5.1): el INSERT de la gestion + sus filas hijas se EXTRAJO a un helper
      // privado, compartido con `crearGestionDesdeAyuda`. `gestion_orden_evidencia` se inserta
      // desde UN solo sitio; lo que cambia entre los dos caminos es el actor, la familia de
      // origen y las guardas, no la forma de la fila (237/R2: «la misma forma que la del
      // mensajero»).
      const gestionCreadaId = await insertarGestionConHijas(tx, ordenId, mensajeroId, gestion);
      await tx.orden.update({
        where: { id: ordenId },
        data: { estatusId: nuevoEstatusId },
      });
      // R19: libera el bloqueo 1-a-1 dentro de la misma transaccion.
      await tx.usuario.update({
        where: { id: mensajeroId },
        data: { ordenEnGestionId: null },
      });
      // Feature 49/#9 (R17/R22/R20): registra la transicion (destino = resultado, actor = el
      // mensajero, `origenTipo` = gestion, `gestion_orden_id` = la gestion recien creada,
      // `motivo` = motivo de la gestion si aplica) en la MISMA tx que crea la gestion.
      //
      // Feature 158 (Q-G, R8): la rama `incidente` escribe la familia `incidente`, NO `gestion`.
      // La 154 dio de alta ese valor del enum y lo dejo «declarado SIN PRODUCTOR hasta la 158»
      // (`lib/types/orden-historial.ts`); esta es la linea que lo produce.
      //
      // Feature 215 (R25/R28) — CORREGIDO: aqui se leia que era inocuo porque «el derivador de
      // intentos de entrega (67/160) filtra por `estatus_destino_id IN (devuelta, reprogramada)`».
      // ESE DERIVADOR YA NO EXISTE. La 215 lo sustituyo por el conteo de CIERRES APROBADOS sobre
      // `gestion_orden` (`whereIntentosVigentes`, `lib/repositories/OrdenHistorialRepository.ts`),
      // que no mira NINGUN destino de transicion. Sigue siendo inocuo, pero por dos razones
      // independientes y ninguna de ellas el destino:
      //   (a) por el RESULTADO: `incidente` no esta en `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`
      //       (lista de INCLUSION, 215/R2) — un desenlace terminal no es una visita fallida mas;
      //   (b) por el ORIGEN: la familia `incidente` no esta en `ORIGEN_TIPOS_VISITA_REAL`
      //       (215/R34), la sexta condicion del predicado.
      // Con cualquiera de las dos basta: esta fila no cuenta como intento, no adelanta el
      // escalado del cron SLA (99) y no adelanta por esa via el `cobroRechazado` de la 56. Y NO
      // hace falta anadir `incidente` a `ORIGEN_TIPOS_CON_GESTION`: ese conjunto solo desambigua
      // filas SIN enlace a gestion, y esta nace CON `gestion_orden_id` poblado.
      await appendCambioEstado(tx, [
        {
          ordenId,
          estatusOrigenId: actual?.estatusId ?? null,
          estatusDestinoId: nuevoEstatusId,
          actorUsuarioId: mensajeroId, // R21
          origenTipo: gestion.resultado === "incidente" ? "incidente" : "gestion", // R23 / 158 Q-G
          motivo: gestion.motivo ?? null, // R22
          gestionOrdenId: gestionCreadaId,
        },
      ]);
      // Feature 99 (R1/R29): la rama `devuelta` YA NO aplica una transicion de seguimiento
      // inmediata. La orden REPOSA en `devuelta` (destino = `nuevoEstatusId`) y el cron SLA
      // (`DevolucionSlaService`/`DevolucionSlaRepository`) decide el reintento a bodega o el
      // escalado a `rechazada` al vencer la ventana. Antes, aqui vivia un segundo `orden.update`
      // + append (feature 47); se relocalizo al cron.
      // Feature 92 (R19): la gestion SACA la orden de `en_reparto` -> reoptimizacion
      // INMEDIATA (sin delay), dentro de esta misma transaccion (outbox).
      //
      // ⚠️ Este encolado usa el namespace `:inmediato:`, DISJUNTO del `:debounce:`. Si
      // compartieran espacio de claves, un debounce en vuelo del mismo mensajero lo
      // tragaria EN SILENCIO via el `ON CONFLICT DO NOTHING` y la ruta no se recalcularia
      // tras la entrega. El `eventoId` es el id de la gestion recien creada: unico por
      // evento, disponible aqui sin generar nada nuevo.
      await encolarOptimizacionInmediata(
        this.jobRepo,
        tx as unknown as JobTxClient,
        mensajeroId,
        gestionCreadaId,
      );
      return gestionCreadaId;
    });
  }

  /**
   * Feature 100 (design §2.1, R2/R3/R5/R11/R20/R21): reprograma UNA orden en `devuelta` a
   * `reprogramada`, atomico. (a) UPDATE guardado por `estatus_id = devuelta` + no borrada (R21);
   * si count 0 (carrera con el cron SLA de la 99 / doble submit) -> false, sin efectos (R7).
   * (b) Deriva el mensajero de la ULTIMA gestion `devuelta` VIGENTE (`anulada_at IS NULL`,
   * `createdAt desc`), leido DENTRO de la tx (R5, misma derivacion que `findDevueltasSla`);
   * `gestion_orden.mensajero_id` es NOT NULL, asi que su ausencia (anomalia: una orden en
   * `devuelta` SIN gestion que la explique) ABORTA la tx lanzando -> revierte el UPDATE (R20),
   * en vez de persistir una gestion sintetica sin actor. (c) Crea la gestion sintetica
   * `resultado = reprogramada` con `fecha_reprogramacion` (patron `crearGestionYTransicionar`) y
   * `motivo` opcional, `cierre_id NULL` (entra al proximo cierre pero aporta $0.00: el cierre solo
   * acredita `entregada`/`rechazada`, R10). (d) Appendea la transicion via el choke point
   * (`actor = adminTienda`, `origen_tipo = reprogramacion_tienda`, enlazando la gestion, R11).
   *
   * NO CUENTA COMO INTENTO DE ENTREGA — y desde la feature 215 (R12/R28/R34) el motivo es el
   * ORIGEN, NO el destino. Lo que decia antes esta linea («el destino es `reprogramada`, no
   * `devuelta`, asi que no cuenta») es FALSO hoy: `reprogramada` SI esta en
   * `RESULTADOS_QUE_CUENTAN_COMO_INTENTO` (`lib/types/orden-historial.ts`), y el criterio ya no
   * mira destinos de transicion sino la gestion, su cierre APROBADO y su origen. Lo que deja
   * fuera a esta gestion sintetica es la SEXTA condicion de `whereIntentosVigentes`
   * (`lib/repositories/OrdenHistorialRepository.ts`): la fila de historial que se appendea aqui
   * nace con `origen_tipo = reprogramacion_tienda`, y ese valor NO esta en
   * `ORIGEN_TIPOS_VISITA_REAL` (hoy solo `gestion`, la visita del mensajero en calle).
   *
   * POR QUE IMPORTA LA DIFERENCIA, y no es una precision academica: quien anada
   * `reprogramacion_tienda` a `ORIGEN_TIPOS_VISITA_REAL` creyendo que «el destino ya protege»
   * hace que esta orden sume +1 de mas —su `devuelta` real MAS este tramite de escritorio, el
   * doble conteo que `160/R2` evitaba—, alcance antes el umbral del cron SLA (99), escale antes
   * de tiempo a `rechazada` y dispare el `cobroRechazado` de la 56: DINERO REAL cobrado a la
   * tienda antes de lo debido, en silencio. (Esto reemplaza la justificacion de `100/R8`: la
   * conclusion sobrevive, el razonamiento se reescribe.)
   */
  async reprogramarDesdeDevuelta(input: ReprogramarDesdeDevueltaInput): Promise<boolean> {
    // Feature 240 (T2.1): los pasos 1, 2 y 4 —el UPDATE guardado (R21), la derivacion del
    // mensajero (R5) y el append por el choke point (R11)— viven ahora en
    // `transicionarDesdeDevuelta`, compartidos con el rechazo manual. La FIRMA y la CONDUCTA de
    // este metodo NO cambian: lo que era el cuerpo de la transaccion es ahora el argumento.
    return transicionarDesdeDevuelta(this.prisma, {
      ordenId: input.ordenId,
      estatusDevueltaId: input.estatusDevueltaId,
      estatusDestinoId: input.estatusReprogramadaId,
      origenTipo: "reprogramacion_tienda", // R11
      actorUsuarioId: input.actorUsuarioId, // R11: el adminTienda
      motivo: input.motivo, // consistente con la gestion (puede ser null)
      llamador: "reprogramarDesdeDevuelta",
      // R3: gestion sintetica `reprogramada` en la MISMA tx. `fecha_reprogramacion` -> DATE
      // (patron `crearGestionYTransicionar`). `cierre_id NULL` -> money-neutral (R10).
      crearGestion: (tx, mensajeroId) =>
        tx.gestionOrden.create({
          data: {
            ordenId: input.ordenId,
            mensajeroId, // R5
            resultado: RESULTADO_REPROGRAMADA, // R3
            fechaReprogramacion: new Date(`${input.fechaReprogramacion}T00:00:00.000Z`), // R3
            motivo: input.motivo, // Q1: opcional (puede ser null)
            cierreId: null, // R10: entra al proximo cierre pero aporta $0.00 (no es entregada/rechazada)
          },
          select: { id: true },
        }),
    });
  }

  /**
   * 💰 Feature 240 (design §4.2, D1/D8, T2.2) — EL RECHAZO MANUAL DE LA TIENDA sobre una devolucion
   * anclada. Contrato completo en `IGestionOrdenRepository.rechazarDesdeDevuelta`; aqui van las
   * razones que solo se ven desde el codigo.
   *
   * PARIDAD LITERAL CON EL CRON (D1, firmada): escribe LO MISMO que
   * `DevolucionSlaRepository.escalarDevueltaSla` —transicion guardada + gestion `rechazada` con
   * `cierre_id NULL` y el mensajero de la ultima `devuelta` vigente—. Solo cambia la familia del
   * historial y que aqui SI hay un actor humano. Sin esa paridad, rechazar a mano saldria GRATIS y
   * esperar al plazo costaria, sobre el mismo paquete: una asimetria que invita a usar el camino
   * equivocado.
   *
   * ⚠️ NO SE ESCRIBE NI UNA LINEA DE ARITMETICA. El importe lo derivan `ingresoBodegaPorResultado`
   * (56) y `derivarIngresoOrden` (42/43) a partir del `resultado` de la gestion, al aprobarse el
   * cierre que la recoja. Esta ficha no toca ninguna de las dos: el rechazo manual y el rechazo por
   * plazo vencido facturan lo mismo porque comparten el `resultado`, no porque nadie lo copie.
   *
   * LO QUE NO HACE, y cada ausencia es una decision (R14/R16):
   *   - NO toca `mensajero_asignado_id`: paridad con el escalado del cron, y ademas es CARGA — el
   *     bloque 139 de la aprobacion busca las `rechazada` POR `mensajeroAsignadoId`, asi que
   *     limpiarlo dejaria el paquete sin ruta de vuelta a la tienda.
   *   - NO enciende `prioridad`: la orden no vuelve a reasignarse.
   *   - NO toca `usuario.ordenEnGestionId` ni encola reoptimizacion: la orden salio de la ruta hace
   *     tiempo (por eso este metodo no usa `this.jobRepo`).
   *   - NO escribe `causa_devolucion` ni ubicacion: la causa describe una devolucion y la tienda
   *     decide desde un escritorio, sin coordenadas que aportar.
   *   - NO escribe ningun importe: el `data` del UPDATE toca exclusivamente `estatusId`.
   */
  async rechazarDesdeDevuelta(input: RechazarDesdeDevueltaInput): Promise<boolean> {
    return transicionarDesdeDevuelta(this.prisma, {
      ordenId: input.ordenId,
      estatusDevueltaId: input.estatusDevueltaId,
      estatusDestinoId: input.estatusRechazadaId,
      origenTipo: ORIGEN_TIPO_RECHAZO_TIENDA, // R11/D8: familia propia, NO la del cron
      actorUsuarioId: input.actorUsuarioId, // R11: la persona de la tienda que decidio
      motivo: input.motivo, // R12: el mismo texto en la gestion y en el historial
      llamador: "rechazarDesdeDevuelta",
      // R8/R18: gestion sintetica `rechazada` con `cierre_id NULL`. Ese NULL es lo que deja que la
      // recoja el SIGUIENTE cierre del mensajero por el mismo mecanismo que vincula las suyas
      // (`crearCierre`), sin camino propio y sin mover dinero en este instante.
      crearGestion: (tx, mensajeroId) =>
        tx.gestionOrden.create({
          data: {
            ordenId: input.ordenId,
            mensajeroId, // R9: el MENSAJERO, no la tienda. Es lo que la mete en un cierre.
            resultado: RESULTADO_RECHAZADA, // D1: el mismo que escribe el cron
            motivo: input.motivo, // R12: obligatorio en esta via
            cierreId: null, // R18: ningun movimiento de dinero hasta que se apruebe el cierre
          },
          select: { id: true },
        }),
    });
  }

  /**
   * Feature 237 (design §4.4, T5.1, R2/R3/R4/R5/R9/R10/R18/R24/R25/R28) — LA GESTION QUE
   * REGISTRA LA TIENDA desde la pestaña de ayuda, atribuida al MENSAJERO de la orden.
   *
   * Molde de forma: `reprogramarDesdeDevuelta` (100), que ya hace exactamente esto para otro
   * origen —`updateMany` guardado, gestion con el `mensajero_id` que corresponde, `cierre_id`
   * nulo y append con actor = adminTienda y familia propia—. NO se generaliza aquel metodo: su
   * semantica (derivar el mensajero de la ultima `devuelta` vigente) es otra.
   *
   * POR QUE NO SE REUSA `crearGestionYTransicionar`, que es la pregunta obvia (design §4.2):
   *   1. fija dentro `actorUsuarioId = mensajeroId` y `origenTipo = "gestion"|"incidente"`. Aqui
   *      quien registra y quien queda atribuido son PERSONAS DISTINTAS (R4/R5), y dejar `gestion`
   *      atribuiria al mensajero un acto que no hizo.
   *   2. limpia `usuario.ordenEnGestionId` del mensajero SEA CUAL SEA la orden a la que apunte.
   *      Una orden en `ayuda_tienda` no puede ser su orden en gestion (`escogerParaGestion` exige
   *      `en_reparto` y la solicitud de ayuda ya libero el puntero, 235/R7), asi que copiar ese
   *      bloque LE ARRANCARIA DE LAS MANOS OTRA ORDEN que estuviera gestionando. Es un fallo, no
   *      una diferencia de estilo (R10).
   *   3. su `orden.update` va por PK y SIN guarda de estado: se apoya en que el service ya
   *      valido. Aqui hay DOS actores sobre la misma fila —el mensajero puede recuperarla y el
   *      corte de la noche puede llevarsela— y la guarda tiene que ir EN EL WHERE (R24).
   *
   * Devuelve el id de la gestion, o `null` si la orden ya no estaba en el estatus de ayuda: la
   * carrera la perdio la tienda y no queda NI UN efecto (R25). El service compensa las evidencias.
   */
  async crearGestionDesdeAyuda(input: CrearGestionDesdeAyudaInput): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      // 1) R23/R24 — LA BARRERA. La comprobacion del estado de origen viaja EN LA MISMA SENTENCIA
      //    que lo muta, asi que entre comprobar y escribir no hay ventana. `data` toca UNICAMENTE
      //    `estatusId`: money-safe, sin rozar montos, mensajero asignado ni prioridad (R10/R11).
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusAyudaId, // guarda de carrera (mensajero / corte) e idempotencia
          deletedAt: null,
          // FEATURE 261 (B17, R30) — LA SEGUNDA CAPA DEL BLOQUEO POR RESERVA. La primera es el
          // paso 5-bis del service, que rechaza ANTES de subir fotos (R29); esta es la que gana
          // la carrera: si la reserva cambia entre aquella comprobacion y esta escritura, la
          // orden NO transiciona. Predicado COPIADO del corte, no reinventado
          // (`CorteDiarioRepository` / `crearCierre`): `NULL` entra por la primera rama y se
          // resuelve igual que siempre, y `lte` —no `lt`— porque una orden reservada para HOY es
          // de hoy.
          OR: [{ fechaReparto: null }, { fechaReparto: { lte: input.diaEnCurso } }],
        },
        data: { estatusId: input.estatusDestinoId },
      });
      // R25/R28: la orden ya salio de ayuda -> ni gestion, ni evidencias, ni historial. Y con esto
      // la idempotencia del doble envio sale por construccion, sin un segundo mecanismo que
      // pudiera divergir de este.
      //
      // Feature 261 (R30): este MISMO `null` cubre ahora tambien «la orden paso a estar reservada
      // para un dia posterior». No hay camino de fallo nuevo: el service ya compensa las
      // evidencias subidas y responde `conflict` — solo cambia el motivo que devuelve.
      if (result.count === 0) return null;

      // 2/3) R2/R3/R9 — la gestion y sus N evidencias, por el helper COMPARTIDO con el camino del
      //    mensajero: misma forma de fila para el mismo resultado. `mensajeroId` es EL MENSAJERO
      //    (💰 R3: es lo unico que hace que `crearCierre` la vincule y que el dinero salga solo) y
      //    `cierreId` queda NULO por el default de la columna, para que la vincule EL MISMO
      //    mecanismo que vincula las suyas (R9), sin camino propio.
      //
      //    La ubicacion NO se escribe (R18): `GestionOrdenData` la trae opcional y este camino no
      //    la puebla — la tienda gestiona desde un escritorio y no hay presencia que registrar.
      const gestionId = await insertarGestionConHijas(
        tx,
        input.ordenId,
        input.mensajeroId,
        input.gestion,
      );

      // 4) R4/R5 — el choke point, con su guardia de transicion de fallo cerrado. Actor = LA
      //    TIENDA (la unica evidencia de quien decidio) y familia PROPIA `gestion_tienda_ayuda`,
      //    que es la que hace que esta gestion cuente como intento (R6) sin que el historial
      //    mienta sobre quien la registro. Origen = el estatus de ayuda, fijado por la guarda del
      //    paso 1: no se re-lee, se sabe.
      await appendCambioEstado(tx, [
        {
          ordenId: input.ordenId,
          estatusOrigenId: input.estatusAyudaId,
          estatusDestinoId: input.estatusDestinoId,
          actorUsuarioId: input.actorUsuarioId, // R4: el adminTienda
          origenTipo: "gestion_tienda_ayuda", // R5
          motivo: input.gestion.motivo ?? null,
          gestionOrdenId: gestionId,
        },
      ]);

      // NO se encola reoptimizacion de ruta: la orden salio de la ruta al entrar en ayuda y
      // `transicionarAyuda` (235) tampoco encola. Paridad deliberada, no olvido.
      return gestionId;
    });
  }
}
