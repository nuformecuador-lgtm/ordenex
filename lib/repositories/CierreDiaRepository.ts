import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AnularGestionInput,
  CierreGestionPendienteRow,
  CierreSinGestionRow,
  CierreSolicitadoInfo,
  CrearCierreInput,
  GestionDeshacerRow,
  ICierreDiaRepository,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type {
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
import type { CierrePasadoDTO } from "@/lib/interfaces/services/ICierreDiaService";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
// Feature 274 (design §4.2, R21/R22): la clave del Map del resolver batch la define el modulo
// puro de la cascada, no este repositorio. Indexar aqui con una clave propia seria la segunda
// declaracion de la regla que R21 existe para impedir.
import { clavePar } from "@/lib/utils/cascada-tarifa";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import { ORIGENES_GESTION_DE_LA_TIENDA } from "@/lib/utils/gestion-de-la-tienda-flag";
// Feature 264 (B9): la MISMA proyeccion y el MISMO orden que usa el detalle del admin.
import {
  ORDEN_SIN_GESTION,
  SIN_GESTION_SELECT,
  toSinGestionRow,
} from "@/lib/utils/cierre-sin-gestion";
import { toLineasPago } from "@/lib/utils/lineas-pago";
// Feature 246 (T3.4, R8): las vias que reasignan SIN ofrecer la eleccion de dia estampan el dia de
// Costa Rica EN CURSO, en la convencion `@db.Date` de `fecha_reparto`.
//
// ⚠️ FEATURE 261 (B7, R19) — AQUI VIVIA `import { startOfDayCR }`, y se RETIRO A PROPOSITO. Este
// repositorio llamaba `startOfDayCR()` SIN ARGUMENTO, o sea LEIA EL RELOJ DEL PROCESO para decidir
// un dia de reparto. Eso choca de frente con la doctrina que la propia 246 escribio tres archivos
// mas alla («`now` es un PARAMETRO con default: el reloj se inyecta en los tests y jamas se lee
// dentro del calculo») y hacia imposible probar «deshacer a las 23:59 del 21» sin falsear el reloj
// global del proceso. Desde la 261 el DIA lo resuelve el SERVICIO (`CierreDiaService
// .deshacerGestion`, con su `now` inyectable) y llega ya resuelto en `AnularGestionInput`. Ningun
// repositorio vuelve a leer el reloj para decidir un dia de reparto. NO lo vuelvas a importar.
//
// Lo unico que este archivo hace con ese dia es SERIALIZARLO para el SQL crudo:
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
// Feature 271 — la lista de estados RE-SOLICITABLES vive en el modulo puro de la regla, no aqui.
import { CIERRE_ESTADOS_RESOLICITABLES } from "@/lib/utils/bloqueo-cierre";
import type { CierreEstado } from "@/lib/types/cierre";

// El estado que representa una solicitud viva de cierre (R12) y el que crea la 37 por
// defecto (R13). Feature 41/C1: `crearCierre` acepta ademas `vencido` (corte diario).
const ESTADO_SOLICITADO = "solicitado";

// FEATURE 271 — LOS DOS ESTADOS RE-SOLICITABLES (`vencido` del corte y `rechazado` del admin) ya
// no se nombran por separado aqui: la re-solicitud elige por EDAD, no por estado, asi que la lista
// entra entera en un solo `where`. La lista vive en el modulo puro de la regla.
//
// ⚠️ 271/R17 — AQUI DECIA «DOS `vencido` A LA VEZ ES IMPOSIBLE». **NO LO ES**, y por eso este
// comentario se reescribio el 2026-08-23, el mismo dia que se midio.
//
// LO ALCANZABLE, medido en `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts`: el
// argumento decia «el corte que creo el `vencido` ya barrio sus ordenes en la misma transaccion», y
// eso tiene una EXCEPCION desde la feature 246 — una orden reservada para un dia posterior NO se
// barre (246/R11) y su proteccion CADUCA SOLA (246/R13). La noche siguiente esa orden vence, el
// bloqueado vuelve a entrar por la rama (b) de la seleccion del corte, se barre, y nace el SEGUNDO
// `vencido`. Via de produccion: `CorreccionDiaRepartoService` (262) mueve el dia de una orden que YA
// esta en `en_reparto`. Y LO INTRODUCE LA PROPIA 271: antes, la exclusion por cierre abierto sacaba
// al bloqueado de la corrida siguiente.
//
// SIGUE SIN AÑADIRSE NINGUNA GUARDA, y ahora por la razon correcta: no porque el estado no exista,
// sino porque YA ESTA CUBIERTO. Es la fila 7 de la tabla de verdad (`N=2, V=2`) con dos `vencido` en
// vez de dos `rechazado`; la regla general cuenta N y V sin mirar el estado; el `id` que este mismo
// archivo lleva en el `WHERE` de `transicionarASolicitado` (el arreglo de M2, puesto «por si acaso»
// para el gemelo del `vencido`) mueve UNO, el mas viejo (R18); y la rama `v === n` del aviso ya dice
// lo correcto. Donde tambien se acumulan dos re-solicitables es en el RECHAZO, que es retroactivo —
// y ese caso tiene test desde el principio (M2, los cuatro pasos).

// Feature 41/C1: sentinela interno para forzar el rollback de la tx cuando el UPDATE
// guardado vincula 0 gestiones (carrera). Se captura fuera de la tx -> `crearCierre`
// devuelve null (sin efectos), NO se propaga como error real.
class SinGestionesVinculadas extends Error {}

// Feature 67: sentinela interno del deshacer (mismo patron que SinGestionesVinculadas). Una
// guardia que afecta 0 filas DENTRO de la tx (carrera con `solicitarCierre` / doble submit /
// la orden se movio) fuerza el rollback -> `anularGestionYDevolverAGestion` devuelve `false`
// SIN efectos parciales (R22). NO es un error real: no se propaga.
class NoAnulable extends Error {}

// Feature 69/T10: `cierreDetail` (el snapshot que se puebla en la tx de `crearCierre`) y
// `tarifa` (el resolver batch corre DENTRO de esa misma tx, design §3.1).
type CierrePrismaClient = Pick<
  PrismaClient,
  | "gestionOrden"
  | "orden"
  | "cierreDia"
  | "cierreDetail"
  // Feature 264 (B3/B9): el VINCULO cierre <-> orden barrida. Se ESCRIBE en la tx del corte
  // (`crearCierre`) y se LEE en el detalle propio del mensajero (`findCierrePropioConGestiones`).
  | "cierreSinGestion"
  | "tarifa"
  // Feature 237 (T5.5, D3): + `ordenHistorialEstado` para LEER —solo leer— de que familia nacio
  // una gestion candidata a deshacerse. Este repositorio no escribe historial: eso pasa siempre
  // por el choke point (`appendCambioEstado`).
  | "ordenHistorialEstado"
  | "$transaction"
>;

// Feature 69 (design §3, paso 5) — proyeccion del snapshot: TODO lo que `cierre_detail`
// congela de la orden. Se lee DENTRO de la tx, de las gestiones que el `updateMany`
// REALMENTE vinculo (no de la lista que el service leyo antes).
const SNAPSHOT_SELECT = {
  ordenId: true,
  orden: {
    select: {
      // money-critical (R6): las entradas de la formula.
      montoCobrar: true,
      cobraComision: true,
      zonaId: true,
      tiendaId: true,
      // descriptivos (R7).
      numGuia: true,
      numRemision: true,
      destinatario: true,
      direccion: true,
      producto: true,
      // `esCentral` (R6) + los 5 nombres (R7): se congelan como VALOR, no como FK, porque
      // son mutables (design §2.1).
      zona: { select: { nombre: true, esCentral: true } },
      tienda: { select: { nombre: true } },
      provincia: { select: { nombre: true } },
      canton: { select: { nombre: true } },
      // `zonaEspecial` (R6, 2026-08-25) viaja junto al nombre: es una entrada de la formula
      // desde que el pacto por distrito especial cobra. La columna de origen es NULLABLE
      // (`null` = nadie lo decidio); se normaliza a dos valores AL CONGELAR, abajo.
      distrito: { select: { nombre: true, zonaEspecial: true } },
    },
  },
} as const;

type SnapshotRow = Prisma.GestionOrdenGetPayload<{ select: typeof SNAPSHOT_SELECT }>;

// Money-safe: STRING escala 2 -> Decimal (nunca number/parseFloat), R11. `null` = la tienda
// no tenia tarifa vigente al solicitar (gap R9): las 9 columnas quedan NULL, todas o ninguna.
// `tarifaFulfillment` (2026-08-19) entra por la MISMA puerta aunque no alimente la formula:
// congelarlo aparte seria abrir una segunda regla de "todas o ninguna".
function tarifaColumnas(t: TarifaVigenteResuelta | null) {
  if (t === null) {
    return {
      tarifaId: null,
      tarifaValorFlete: null,
      tarifaValorFleteGam: null,
      tarifaValorFleteDevuelto: null,
      tarifaValorFleteDevueltoGam: null,
      tarifaComisionCod: null,
      tarifaIvaFlete: null,
      tarifaIvaComisionCod: null,
      tarifaFulfillment: null,
      tarifaEspecial: null,
      tarifaEspecialDevuelta: null,
    };
  }
  return {
    tarifaId: t.tarifaId,
    tarifaValorFlete: new Prisma.Decimal(t.valorFlete),
    tarifaValorFleteGam: new Prisma.Decimal(t.valorFleteGam),
    tarifaValorFleteDevuelto: new Prisma.Decimal(t.valorFleteDevuelto),
    tarifaValorFleteDevueltoGam: new Prisma.Decimal(t.valorFleteDevueltoGam),
    tarifaComisionCod: new Prisma.Decimal(t.comisionCod),
    tarifaIvaFlete: new Prisma.Decimal(t.ivaFlete),
    tarifaIvaComisionCod: new Prisma.Decimal(t.ivaComisionCod),
    tarifaFulfillment: new Prisma.Decimal(t.fulfillment),
    // NULLABLES tambien con tarifa presente, a diferencia de sus hermanas: `null` aqui no es
    // "no habia tarifa", es "esta tarifa no pacto nada especial". Congelarlo como 0 cobraria
    // un pacto de cero colones que nadie acordo.
    tarifaEspecial: t.tarifaEspecial == null ? null : new Prisma.Decimal(t.tarifaEspecial),
    tarifaEspecialDevuelta:
      t.tarifaEspecialDevuelta == null ? null : new Prisma.Decimal(t.tarifaEspecialDevuelta),
  };
}

// Proyeccion de una gestion pendiente de cierre con el detalle de la orden via las
// relaciones existentes (patron GestionOrdenRepository.WITH_ASIGNACION). Exportada
// para reuso por CierresAdminRepository (feature 38): mismo detalle de gestion,
// distinto WHERE (cierre_id = X en vez de cierre_id IS NULL).
export const WITH_DETALLE = {
  select: {
    id: true,
    ordenId: true,
    resultado: true,
    montoRecibido: true,
    metodoPago: true,
    motivo: true,
    fechaReprogramacion: true,
    evidenciaStoragePath: true,
    pagoMensajero: true, // feature 39: snapshot del pago al mensajero (reuso 38/40)
    ingresoBodegaRechazo: true, // feature 56: snapshot del ingreso de bodega por rechazo (reuso 38/40)
    causaIncidente: true, // feature 158/R9: causa tipificada del incidente (null en el resto)
    // Feature 212/R21/R22/R23: el DESGLOSE del recaudo. Sin esto la fila de dominio no
    // compila, y si compilara los totales del cierre saldrian en CERO: `computeTotales` suma
    // EXCLUSIVAMENTE estas lineas, sin fallback al par escalar (design §3.1). `orderBy` sobre
    // un enum NATIVO ordena por orden de DECLARACION (efectivo, SINPE, transferencia): orden
    // determinista sin columna que mantener.
    pagos: { select: { metodo: true, monto: true }, orderBy: { metodo: "asc" } },
    // ⚠️ `indemnizacion` NO se selecciona A PROPOSITO. Esta es la proyeccion de la vista EN
    // VIVO del MENSAJERO, y la indemnizacion es plata que Ordenex paga por el paquete, no del
    // mensajero (R17/design §7.2). Dejarla fuera de la CONSULTA —y no solo de la pantalla— es
    // lo que impide que un cambio de UI la exponga sin que nadie lo decida.
    orden: {
      select: {
        numGuia: true,
        numRemision: true,
        destinatario: true,
        direccion: true,
        producto: true,
        tienda: { select: { nombre: true } },
        zona: { select: { nombre: true } },
        provincia: { select: { nombre: true } },
        canton: { select: { nombre: true } },
        distrito: { select: { nombre: true } },
      },
    },
  },
} as const;

export type DetalleRow = Prisma.GestionOrdenGetPayload<typeof WITH_DETALLE>;

// Money-safe: Decimal -> string con escala 2 fija (nunca number/parseFloat).
function decimalToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

// Mapper de la proyeccion WITH_DETALLE a la fila de dominio. Exportado para reuso
// por CierresAdminRepository (feature 38).
export function toPendienteRow(
  row: DetalleRow,
  desdeAyudaTienda: boolean,
): CierreGestionPendienteRow {
  return {
    gestionId: row.id,
    ordenId: row.ordenId,
    numGuia: row.orden.numGuia,
    numRemision: row.orden.numRemision,
    destinatario: row.orden.destinatario,
    direccion: row.orden.direccion,
    zonaNombre: row.orden.zona.nombre,
    provinciaNombre: row.orden.provincia.nombre,
    cantonNombre: row.orden.canton.nombre,
    distritoNombre: row.orden.distrito?.nombre ?? null,
    producto: row.orden.producto,
    tiendaNombre: row.orden.tienda.nombre,
    resultado: row.resultado,
    montoRecibido: decimalToString(row.montoRecibido),
    // Feature 212/R31: el par escalar se CONSERVA (la 213 decide su retiro)...
    metodoPago: row.metodoPago,
    // ...pero el dinero que suma es ESTE: el desglose por metodo, money-safe STRING, en el
    // orden que impuso el `orderBy` de la proyeccion (R21/R22).
    pagos: toLineasPago(row.pagos),
    motivo: row.motivo,
    fechaReprogramacion: row.fechaReprogramacion
      ? row.fechaReprogramacion.toISOString().slice(0, 10)
      : null,
    evidenciaStoragePath: row.evidenciaStoragePath,
    // Feature 39: snapshot del pago al mensajero (Decimal->string; null si aun sin cerrar
    // o cierre pre-migracion, R22). En la vista EN VIVO (37) el service lo DERIVA aparte.
    pagoMensajero: decimalToString(row.pagoMensajero),
    // Feature 56: snapshot del ingreso de bodega por rechazo (Decimal->string; null si aun
    // sin cerrar o cierre pre-migracion, R21/R22). En la vista EN VIVO (37) el service lo DERIVA.
    ingresoBodegaRechazo: decimalToString(row.ingresoBodegaRechazo),
    // Feature 102/R11: la vista EN VIVO del mensajero (37) NO expone el desglose SLA -> `false`.
    // La clasificacion SLA solo la deriva el detalle del admin (38/40) desde el historial.
    esRechazoSla: false,
    // 💰 Feature 237 (D6/R41): lo contrario que el de arriba — este SI se deriva para la vista del
    // mensajero, porque es SU cierre el que tiene que decir que la gestion la hizo la tienda. Llega
    // ya resuelto por `marcarDesdeAyudaTienda`, que lo lee EN LOTE (una consulta para las N filas,
    // no una por fila).
    desdeAyudaTienda,
    // Feature 158/R9: la causa SI viaja a la vista del mensajero — es el hecho que el mismo
    // reporto, no un dato de dinero ni de otro actor.
    causaIncidente: row.causaIncidente,
    // Feature 158/R17 (design §7.2): la vista EN VIVO del mensajero NO lleva el monto. No es
    // `null` por casualidad de que aqui las gestiones tengan `cierre_id IS NULL`: la columna
    // ni se pide en `WITH_DETALLE`, asi que no hay nada que filtrar aguas abajo.
    indemnizacion: null,
  };
}

/**
 * Proyeccion de la CABECERA de un cierre del mensajero (histórico R18 y detalle de "ver").
 * Una sola definicion para las dos lecturas: los totales que se listan y los que se abren
 * salen de las mismas columnas.
 *
 * Feature 170 (T I.1): la comparte ademas la version PAGINADA de `findCierresByMensajero`,
 * que lee exactamente estas columnas y las serializa con este mismo mapper. Dos copias
 * divergen en cuanto una gane un campo — que es justo lo que estuvo a punto de pasar aqui.
 * Money-safe: los Decimal salen como STRING escala 2 (nunca number/parseFloat).
 */
const CIERRE_PASADO_SELECT = {
  id: true,
  estado: true,
  destinoTipo: true,
  destinoZonaId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R13: total snapshot del pago al mensajero
  totalIngresoBodegaRechazos: true, // feature 56/R12: total snapshot del ingreso de bodega por rechazos
  solicitadoAt: true,
  // Resolucion del cierre: el mensajero ve en SU histórico cuándo se resolvió y, si se
  // rechazó, por qué (sin el motivo no sabe qué corregir).
  resueltoAt: true,
  motivoRechazo: true,
  // Feature 264 (R27/R28): la marca viaja con la cabecera. NO entra en `CierrePasadoDTO` —el
  // DTO del historico no la necesita— sino que el detalle propio la lee de esta misma fila,
  // sin una segunda consulta.
  sinGestionRegistrado: true,
} as const;

type CierrePasadoSelectRow = Prisma.CierreDiaGetPayload<{
  select: typeof CIERRE_PASADO_SELECT;
}>;

/**
 * Feature 184 — Tanda C (R16) — el ALCANCE del listado «Cierres solicitados por el mensajero»,
 * declarado UNA vez.
 *
 * El `mensajero_id` es TODO el acotamiento de este listado (no filtra por estado: el mensajero ve
 * sus cierres en cualquiera, incluido el `solicitado`/`vencido` que le esta bloqueando las
 * guias). Lo escribe siempre el servicio desde la sesion, jamas la peticion.
 *
 * Estaba escrito dos veces —una en el conjunto y otra en la pagina—, y con dos literales basta
 * que una gane un predicado para que el archivo y la tabla dejen de contar el mismo conjunto.
 */
function cierresDeMensajeroWhere(mensajeroId: string): Prisma.CierreDiaWhereInput {
  return { mensajeroId };
}

/**
 * Feature 184 — Tanda C (R16/R5) — el ORDEN del mismo listado, compartido por el conjunto y la
 * pagina. No es simetria: la pagina N que la tabla pinta tiene que ser el segmento N del conjunto
 * del que sale el archivo, y eso solo se sostiene si las dos consultas ordenan igual.
 */
const ORDEN_CIERRES_MENSAJERO: Prisma.CierreDiaOrderByWithRelationInput = { solicitadoAt: "desc" };

/** Mapper de la cabecera: Decimal -> STRING escala 2 (money-safe), fechas -> ISO. */
function toCierrePasadoDTO(r: CierrePasadoSelectRow): CierrePasadoDTO {
  return {
    cierreId: r.id,
    estado: r.estado,
    destinoTipo: r.destinoTipo,
    destinoZonaId: r.destinoZonaId,
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R13: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R12
    solicitadoAt: r.solicitadoAt.toISOString(),
    resueltoAt: r.resueltoAt ? r.resueltoAt.toISOString() : null,
    motivoRechazo: r.motivoRechazo,
  };
}

/**
 * Feature 37 — repositorio del cierre del dia. SOLO queries Prisma (sin logica de
 * negocio: los estados "pendientes" los decide el service y se pasan por parametro;
 * los totales snapshot llegan ya calculados como STRING). `crearCierre` es
 * transaccional y consume las gestiones pendientes con un WHERE guardado.
 */
export class CierreDiaRepository implements ICierreDiaRepository {
  constructor(
    private readonly prisma: CierrePrismaClient,
    // Feature 69 (design §3.1): el resolver de la tarifa vigente, por INTERFAZ (precedente:
    // `CierresAdminRepository` recibe repos y services). `crearCierre` lo invoca DENTRO de su
    // tx para congelar la tarifa (R8). Es el UNICO consumidor del resolver tras la 69: los
    // feeds de wallet dejan de depender de el (leen el snapshot), y ese es justo el cambio
    // que mata el vector "cambio la tarifa entre solicitar y aprobar" (R18).
    //
    // Feature 274: el resolver ya NO resuelve "por tienda" sino por el PAR (tienda, zona) con
    // la cascada de R1. Este repositorio no lo sabe: pide `resolveTarifas(pares, tx)` y la
    // regla vive entera en `lib/utils/cascada-tarifa.ts` (R8/R21).
    private readonly tarifaRepo: ITarifaVigenteRepository,
  ) {}

  /**
   * 💰 Feature 237 (D6/R41) — ¿cuales de estas gestiones las registro LA TIENDA?
   *
   * UNA sola consulta para las N filas (nunca una por fila), y con `orden_id` DELANTE. Ese orden
   * no es cosmetico y esta MEDIDO, no supuesto (2026-08-20, `EXPLAIN` sobre la base local con
   * `enable_seqscan = off`):
   *
   *   - con `origen_tipo + gestion_orden_id` (lo que produce un `select` anidado de Prisma):
   *     **Seq Scan**. `orden_historial_estado` NO tiene indice por `gestion_orden_id` —la FK no
   *     crea indice en Postgres— y su unica alternativa es recorrer entero
   *     `orden_historial_actor_origen_created_idx`, cuya columna guia es `actor_usuario_id`.
   *   - añadiendo `orden_id`: **Bitmap Heap Scan** por
   *     `orden_historial_estado_orden_id_created_at_idx`, tocando solo las filas de esas ordenes.
   *
   * Es el MISMO truco que documenta `whereIntentosVigentes` (`OrdenHistorialRepository`) y que usa
   * `findGestionParaDeshacer` unas lineas mas abajo. **No se crea ningun indice nuevo**: se entra
   * por el que ya existe. Sin esto, la pantalla mas caliente del cierre recorreria una tabla
   * append-only que crece con CADA transicion del sistema.
   *
   * Lista vacia -> ni una consulta.
   */
  private async marcarDesdeAyudaTienda(rows: DetalleRow[]): Promise<Set<string>> {
    if (rows.length === 0) return new Set();
    const filas = await this.prisma.ordenHistorialEstado.findMany({
      where: {
        ordenId: { in: [...new Set(rows.map((r) => r.ordenId))] }, // la columna GUIA del indice
        gestionOrdenId: { in: rows.map((r) => r.id) },
        // Feature 237/R41 + 240/R43: de UNA igualdad a un `in` de la lista. Ninguna consulta
        // nueva y el mismo indice: lo unico que cambia es cuantas familias acepta el filtro.
        origenTipo: { in: [...ORIGENES_GESTION_DE_LA_TIENDA] },
      },
      select: { gestionOrdenId: true },
    });
    return new Set(
      filas.map((f) => f.gestionOrdenId).filter((id): id is string => id !== null),
    );
  }

  /** R2/R3: gestiones del mensajero sin cierre (cierre_id IS NULL) + detalle. */
  async findGestionesPendientes(mensajeroId: string): Promise<CierreGestionPendienteRow[]> {
    const rows = await this.prisma.gestionOrden.findMany({
      // R2: nunca gestiones de otro mensajero; R3: solo sin cierre.
      // Feature 67/R13/R14/R15: `anuladaAt: null` = solo gestiones VIGENTES. ESTA lista es la
      // que consumen los 4 grupos (R13), `computeTotales` (R14), `derivarPagos` (39) y
      // `derivarIngresoBodega` (56) (R15), tanto en la vista EN VIVO (`listarCierreDia`) como
      // en el SNAPSHOT (`solicitarCierre` y el corte diario de la 41): un solo filtro cubre
      // los tres requisitos. Usa el indice parcial `gestion_orden_mensajero_pendiente_idx`.
      where: { mensajeroId, cierreId: null, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      ...WITH_DETALLE,
    });
    const deLaTienda = await this.marcarDesdeAyudaTienda(rows);
    return rows.map((r) => toPendienteRow(r, deLaTienda.has(r.id)));
  }

  /**
   * R10: ordenes asignadas al mensajero (no borradas) en los estados pendientes.
   *
   * FEATURE 246 (TERCERA COPIA DEL PREDICADO GEMELO) — LA SELECCION ES POR ESTATUS **Y DIA**.
   * Una orden reservada para un dia que AUN NO HA LLEGADO no es deuda de la jornada en curso: esta
   * en la mano del mensajero, y el corte nocturno ya acordo no tocarla (el `OR` identico de
   * `CorteDiarioRepository.findMensajerosConActividadSinCierre` y el de `crearCierre`, mas abajo en
   * este mismo archivo). Hasta que este predicado llego aqui la 246 estaba a DOS TERCIOS: el corte
   * respetaba la reserva y el gate de la pantalla la contaba como pendiente, asi que a un mensajero
   * con trabajo asignado para mañana se le deshabilitaba «Solicitar cierre» del dia que SI habia
   * terminado — sin motivo que el pudiera resolver, porque gestionar algo de mañana no se puede.
   *
   * `NULL` BLOQUEA, igual que en las otras dos copias (R19/R20): significa «no reservada», no
   * «reservada para nunca». Se pregunta «¿esta reservada para DESPUES de `hoyCR`?», no «¿es de hoy?».
   *
   * `hoyCR` LLEGA YA CALCULADO desde el servicio, con su `now` inyectable — este repositorio no lee
   * el reloj para decidir un dia de reparto (ver el bloque del principio del archivo). OJO al ancla,
   * que es lo unico que NO se comparte con las otras dos copias: aqui es HOY (`startOfDayCR(now)`)
   * y alli es `diaCerrado`, porque el corte cierra la jornada ANTERIOR y el mensajero la EN CURSO.
   */
  async contarOrdenesPendientesGestion(
    mensajeroId: string,
    estados: string[],
    hoyCR: Date,
  ): Promise<number> {
    if (estados.length === 0) return 0;
    return this.prisma.orden.count({
      where: {
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
        estatus: { value: { in: estados } },
        OR: [{ fechaReparto: null }, { fechaReparto: { lte: hoyCR } }],
      },
    });
  }

  /**
   * Feature 146/R24 -> FEATURE 271 (T6.8, R56) — proyeccion minima de UN cierre CONCRETO (zona
   * destino + nombre del mensajero) para componer su aviso.
   *
   * ⚠️ ANTES ERA `findCierreSolicitado(mensajeroId)`, UN `findFirst … orderBy createdAt DESC`, Y ESO
   * ES EL FALLO MUDO **M9**. Con el invariante 109/R30 vivo —un solo cierre abierto— daba igual cual
   * devolviera. La ficha 271 DEROGA ese invariante (R9), asi que con DOS `solicitado` aquel orden
   * devolvia SIEMPRE el mas nuevo: al re-solicitar el MAS VIEJO (R18), el aviso apuntaba al otro
   * cierre y la clave de dedupe se calculaba sobre la entidad equivocada — silencio o aviso falso,
   * sin que nada se pusiera rojo.
   *
   * La correccion no es cambiar el `orderBy`: es que el llamador YA TIENE el id del cierre sobre el
   * que acaba de actuar y lo pasa. Un cierre buscado por mensajero no puede ser «el que se acaba de
   * tocar» mas que por casualidad.
   */
  async findCierreParaAviso(cierreId: string): Promise<CierreSolicitadoInfo | null> {
    const fila = await this.prisma.cierreDia.findUnique({
      where: { id: cierreId },
      select: { id: true, destinoZonaId: true, mensajero: { select: { nombre: true } } },
    });
    if (fila === null) return null;
    return {
      id: fila.id,
      destinoZonaId: fila.destinoZonaId ?? null,
      mensajeroNombre: fila.mensajero?.nombre ?? null,
    };
  }

  /**
   * FEATURE 271 (T2.3, R18) — el cierre RE-SOLICITABLE (`vencido` o `rechazado`) MAS VIEJO del
   * mensajero, o `null`.
   *
   * ⚠️ SUSTITUYE A `existeCierreVencido` + `existeCierreRechazado`, QUE ELEGIAN POR ESTADO Y NO POR
   * EDAD. `solicitarCierre` miraba primero el `vencido` y solo despues el `rechazado`: con un
   * `rechazado` VIEJO y un `vencido` NUEVO resolvia el nuevo primero, que contradice «del mas viejo
   * al mas nuevo». Con un solo cierre abierto daba igual; con dos, no.
   *
   * Orden `solicitado_at` ASC con desempate ESTABLE por `id` ASC, el mismo que `findBloqueoDetalle`
   * (R11): dos criterios distintos para «el mas viejo» harian que el aviso y la escritura hablaran
   * de cierres distintos.
   */
  async findCierreResolicitableMasViejo(
    mensajeroId: string,
  ): Promise<{ id: string; estado: CierreEstado } | null> {
    const fila = await this.prisma.cierreDia.findFirst({
      where: { mensajeroId, estado: { in: [...CIERRE_ESTADOS_RESOLICITABLES] } },
      orderBy: [{ solicitadoAt: "asc" }, { id: "asc" }],
      select: { id: true, estado: true },
    });
    return fila ?? null;
  }

  /**
   * FEATURE 271 (T2.3, R19/R20) — transiciona ESE cierre a `solicitado`. UNA fila o ninguna.
   *
   * ⚠️ AQUI SE CIERRA EL FALLO MUDO **M2**, Y MUERDE POR EL `rechazado`. Los dos metodos que este
   * sustituye (`transicionarVencidoASolicitado` / `transicionarRechazadoASolicitado`) eran
   * `updateMany` por `(mensajeroId, estado)` **sin `id`**, y devolvian `count === 1`. Con DOS
   * `rechazado` —secuencia alcanzable en cuatro pasos: solicita el dia 1, solicita el dia 2, el
   * admin rechaza los dos— transicionaban **LOS DOS**, `count` valia 2 y el `=== 1` devolvia
   * **false**: el servicio respondia `conflict` y el mensajero leia «no se pudo» con sus dos cierres
   * YA movidos. Escribia y reportaba fallo.
   *
   * Con `id` (clave primaria) en el `where`, `count` solo puede ser 0 o 1 y `count === 1` vuelve a
   * significar lo que dice (R19). El anti-TOCTOU por estado se CONSERVA intacto: `estadoEsperado`
   * sigue en el `where`, asi que una carrera que ya lo movio devuelve `false` sin escribir.
   *
   * Los dos metodos viejos DESAPARECEN, no se parchean: dejar uno «por si acaso» conserva el
   * `updateMany` sin `id`, que es el fallo.
   *
   * MONEY-SAFE (R20): el `data` cambia UNICAMENTE `estado`. Totales, pago al mensajero, ingreso de
   * bodega, `cierre_id` de las gestiones, `resuelto_por`/`resuelto_at`, `motivo_rechazo` y
   * `solicitado_at` quedan INTACTOS — no es una resolucion.
   */
  async transicionarASolicitado(cierreId: string, estadoEsperado: CierreEstado): Promise<boolean> {
    const { count } = await this.prisma.cierreDia.updateMany({
      where: { id: cierreId, estado: estadoEsperado },
      data: { estado: ESTADO_SOLICITADO },
    });
    return count === 1; // con `id` en el where solo hay 0 o 1: `false` = carrera, sin efectos
  }

  /**
   * R13/R14 + feature 41/C1 (R8/R9/R23): INSERT cierre_dia (estado `solicitado` por
   * defecto o `vencido` para el corte) + vincular gestiones pendientes + snapshot pago,
   * atomico. Devuelve null (rollback) si el UPDATE guardado vincula 0 gestiones.
   */
  async crearCierre(input: CrearCierreInput): Promise<string | null> {
    const {
      mensajeroId,
      destinoTipo,
      destinoZonaId,
      estado = ESTADO_SOLICITADO,
      corteSinGestionar,
      totales,
      pagoByGestionId,
      totalPagoMensajero,
      ingresoByGestionId,
      totalIngresoBodegaRechazos,
    } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cierre = await tx.cierreDia.create({
          data: {
            mensajeroId,
            estado,
            destinoTipo,
            destinoZonaId,
            totalEfectivo: new Prisma.Decimal(totales.efectivo),
            totalSimpe: new Prisma.Decimal(totales.simpe),
            totalTransferencia: new Prisma.Decimal(totales.transferencia),
            totalGeneral: new Prisma.Decimal(totales.general),
            // Feature 39/R13/R14: total snapshot del pago al mensajero, en la misma tx.
            totalPagoMensajero: new Prisma.Decimal(totalPagoMensajero),
            // Feature 56/R12/R13: total snapshot del ingreso de bodega por rechazos, en la misma tx.
            totalIngresoBodegaRechazos: new Prisma.Decimal(totalIngresoBodegaRechazos),
          },
          select: { id: true },
        });

        // Feature 109 (T1.2, R4/R6/R22): CORTE DIARIO — transiciona en la MISMA tx las ordenes que
        // el mensajero dejo sin desenlace a `sin_gestionar`, CONSERVANDO `mensajero_asignado_id`
        // (asociacion orden<->cierre por mensajero, Q1: se limpia SOLO al liberar al aprobar, R16)
        // y registrando el cambio por el CHOKE POINT (49) con actor null y
        // `origen_tipo = corte_sin_gestionar`. Ausente el input = flujo 37 sin cambios.
        //
        // FEATURE 235 (T4.4, R26/R27/R28) — DOS BLOQUES GUARDADOS, NO UNO CON DOS ORIGENES.
        //
        // Antes habia un solo bloque: pre-SELECT por `estatusId = enReparto`, `updateMany` guardado
        // por ese mismo id, y un `appendCambioEstado` con `estatusOrigenId: enRepartoEstatusId` y el
        // comentario «la guarda garantiza este origen». ESE COMENTARIO ES LA RAZON POR LA QUE NO SE
        // PUEDE METER `ayuda_tienda` EN UN `in`: con dos origenes posibles en un solo `updateMany`,
        // el append tendria que INVENTARSE de cual salia cada fila, y escribiria un historial falso
        // — justo lo que R27 prohibe («el estado de origen REAL, y NO uno supuesto»).
        //
        // Asi que el bloque se recorre UNA VEZ POR ORIGEN. Cada vuelta lleva su propia guarda en el
        // WHERE y su propio append, y `sinGestionarTransicionadas` ACUMULA las dos: un mensajero
        // cuyo dia entero acabo en ayuda SI genera su cierre `vencido` (guarda «algo paso», R26).
        //
        // R29 se cumple POR CONSTRUCCION: despues del barrido la orden esta en `sin_gestionar` y no
        // queda ninguna señal de ayuda viva, porque no existe ninguna marca que apagar. Ese era
        // EXACTAMENTE el agujero de la auditoria §2.1 (el corte barria la orden sin apagar la
        // bandera y la fila se quedaba en `/novedades` para siempre), cerrado por el mismo
        // mecanismo que lo creo.
        //
        // MONEY-NEUTRAL (R28): el `data` de las dos vueltas toca UNICAMENTE `estatusId`. Ni
        // `prioridad`, ni `mensajeroAsignadoId`, ni un solo total del cierre. Igual que antes.
        //
        // FEATURE 246 (T2.3, R11/R12/R15/R16) — EL DIA ENTRA EN EL `WHERE`, NO EN MEMORIA.
        //
        // El corte deja de barrer las ordenes RESERVADAS para un dia que aun no ha llegado. La
        // condicion es `fecha_reparto IS NULL OR fecha_reparto <= diaCerrado`, y va en el `where`
        // del pre-`SELECT` Y en el del `updateMany` guardado — no en un `filter` posterior. Filtrar
        // en memoria dejaria el `updateMany` escribiendo sobre filas que la lista ya descarto en
        // cuanto alguien tocara una de las dos, y el `updateMany` es quien de verdad escribe.
        //
        // Es EL MISMO predicado que aplica `CorteDiarioRepository` al SELECCIONAR (R16), con el
        // MISMO valor: `diaCerrado` viaja dentro de `corteSinGestionar` desde el service, que lo
        // calcula una vez por corrida.
        //
        // R15 se cumple por construccion: si el mensajero ademas tiene gestiones sin cerrar, su
        // `vencido` se crea igual (lo decide `vinculadas.count` mas abajo) y aqui solo se barren
        // las NO protegidas. Las reservadas se quedan donde estan, en la mano del mensajero.
        let sinGestionarTransicionadas = 0;
        if (corteSinGestionar) {
          const { enRepartoEstatusId, ayudaEstatusId, sinGestionarEstatusId, diaCerrado } =
            corteSinGestionar;
          // R20: se pregunta «¿esta reservada para un dia que AUN NO ha llegado?», no «¿es de
          // hoy?». A eso `NULL` responde una sola cosa —no— y por eso se barre igual que siempre.
          const noReservadaParaDespues = [
            { fechaReparto: null },
            { fechaReparto: { lte: diaCerrado } },
          ];
          for (const origenEstatusId of [enRepartoEstatusId, ayudaEstatusId]) {
            const pendientes = await tx.orden.findMany({
              where: {
                mensajeroAsignadoId: mensajeroId,
                estatusId: origenEstatusId,
                deletedAt: null,
                OR: noReservadaParaDespues, // feature 246/R11
              },
              // FEATURE 264 (B3, R1/R9/R11): el pre-SELECT proyecta ADEMAS los descriptivos que la
              // fila del vinculo congela. Es una sola consulta —la que ya se hacia—, no una
              // segunda: cuando llegue el `createMany` la orden YA estara en `sin_gestionar` y
              // releerla devolveria lo mismo, pero costaria otra ida a la base dentro de la
              // transaccion del cron.
              select: {
                id: true,
                numGuia: true,
                numRemision: true,
                destinatario: true,
                producto: true,
                tienda: { select: { nombre: true } },
                zona: { select: { nombre: true } },
              },
            });
            if (pendientes.length === 0) continue; // no-op: ni update, ni append, ni ruido
            const ids = pendientes.map((o) => o.id);
            const movidas = await tx.orden.updateMany({
              // LA GUARDA: `estatusId: origenEstatusId`. Es lo que garantiza que el origen que se
              // registra abajo es el REAL de esta vuelta y no el de la otra.
              // Feature 246 (R11/R16): el filtro de dia se REPITE aqui a proposito. Es la escritura
              // real; el pre-SELECT solo sirve para el historial.
              where: {
                id: { in: ids },
                estatusId: origenEstatusId,
                deletedAt: null,
                OR: noReservadaParaDespues,
              },
              data: { estatusId: sinGestionarEstatusId },
            });
            sinGestionarTransicionadas += movidas.count;
            if (movidas.count > 0) {
              await appendCambioEstado(
                tx,
                ids.map((ordenId) => ({
                  ordenId,
                  estatusOrigenId: origenEstatusId, // R27: el origen de SU bloque, no uno supuesto
                  estatusDestinoId: sinGestionarEstatusId,
                  actorUsuarioId: null, // R6: sistema/cron
                  origenTipo: "corte_sin_gestionar", // R6
                })),
              );
              // FEATURE 264 (B3, R1/R2/R4/R11) — EL VINCULO PERSISTIDO, EN ESTA MISMA TRANSACCION.
              //
              // POR QUE AQUI Y NO EN UNA LECTURA POSTERIOR. Hasta hoy la relacion cierre <-> orden
              // barrida era un predicado VIVO (`orden.mensajero_asignado_id = cierre.mensajero_id
              // AND estatus = sin_gestionar`), y la APROBACION lo destruye: libera la orden a
              // bodega y le borra `mensajero_asignado_id`. Un cierre `aprobado` —el que se audita,
              // porque es el que ya movio dinero— mostraba CERO ordenes, indistinguible de uno que
              // de verdad no barrio ninguna. Escribirlo aqui es lo unico que sobrevive a eso (R5).
              //
              // R2/R3 SE CUMPLEN POR LA TRANSACCION: si algo revienta despues, ni el barrido ni
              // este vinculo quedan. R6 tambien, y sin una linea: `crearCierre` sin
              // `corteSinGestionar` (flujo 37) no entra a este bloque.
              //
              // R4 — `estatusOrigenId: origenEstatusId` es el origen de SU vuelta. Es literalmente
              // la razon por la que este bucle tiene dos vueltas guardadas (feature 235/R27): con
              // dos origenes en un solo `updateMany` habria que INVENTARSE de cual salio cada
              // fila.
              //
              // MONEY-NEUTRAL: `cierre_sin_gestion` no tiene ni una columna de dinero, asi que
              // esta escritura no puede mover un total ni aunque quisiera. No es disciplina: es
              // que no hay donde guardar un importe.
              //
              // `skipDuplicates`: el `@@unique([cierreId, ordenId])` es la red por si una segunda
              // corrida del corte entrara por el mismo cierre. Mismo criterio que el
              // `ON CONFLICT DO NOTHING` del backfill de la migracion.
              await tx.cierreSinGestion.createMany({
                data: pendientes.map((o) => ({
                  cierreId: cierre.id,
                  ordenId: o.id,
                  numGuia: o.numGuia,
                  numRemision: o.numRemision,
                  destinatario: o.destinatario,
                  producto: o.producto,
                  tiendaNombre: o.tienda.nombre,
                  zonaNombre: o.zona.nombre,
                  estatusOrigenId: origenEstatusId, // R4: el origen REAL de esta vuelta
                })),
                skipDuplicates: true,
              });
            }
          }
        }

        // R13: consume las gestiones pendientes con guardia de propiedad + no-cerradas
        // en el WHERE (concurrencia-segura: solo las cierre_id IS NULL del actor).
        // Feature 41/C1 (R8/R9/R23): si vincula 0 (otra solicitud/corte concurrente las
        // vinculo primero), fuerza el rollback -> crearCierre devuelve null (sin efectos).
        //
        // Feature 67/R16 — PUNTO MONEY-CRITICAL DE LA FEATURE. `anuladaAt: null` NO es una
        // optimizacion: este updateMany es el que VINCULA la gestion al cierre, y los feeds de
        // wallet (`WalletFeedService`/`WalletTiendaFeedService`/`WalletMensajeroFeedService`)
        // leen `gestionOrden.findMany({ where: { cierreId } })` dentro de la tx de aprobacion
        // (`CierresAdminRepository`). Sin este filtro, una gestion DESHECHA recibiria
        // `cierre_id` y la wallet la COBRARIA al aprobar el cierre: exactamente el bug que la
        // feature 67 viene a evitar. No basta con filtrar la lista de la vista (design §3-#2).
        const vinculadas = await tx.gestionOrden.updateMany({
          where: { mensajeroId, cierreId: null, anuladaAt: null },
          data: { cierreId: cierre.id },
        });
        // Feature 41/C1 + feature 109 (R8/R9/R23): guarda "algo paso". El cierre se conserva si
        // vinculo >=1 gestion O (corte diario) transiciono >=1 orden a `sin_gestionar`. Si AMBOS
        // son 0 -> rollback -> null (carrera / no-op real). La 37 (solicitar, sin corteSinGestionar)
        // exige >=1 gestion como antes (sinGestionarTransicionadas queda 0). El `vencido`
        // money-neutral (0 gestiones + >=1 sin_gestionar) YA NO se descarta (R8).
        if (vinculadas.count === 0 && sinGestionarTransicionadas === 0) {
          throw new SinGestionesVinculadas();
        }
        // Feature 39/R12/R14: puebla pago_mensajero por gestion AGRUPADO por valor de pago
        // (F1.4: a lo sumo 2 valores distintos — cobroEntregado para `entregada`, "0.00" para
        // el resto). Guardia por cierreId=nuevo (las que acabamos de vincular). Todo en la tx.
        const idsByPago = new Map<string, string[]>();
        for (const [gestionId, pago] of Object.entries(pagoByGestionId)) {
          const arr = idsByPago.get(pago);
          if (arr) arr.push(gestionId);
          else idsByPago.set(pago, [gestionId]);
        }
        for (const [pago, ids] of idsByPago) {
          await tx.gestionOrden.updateMany({
            where: { id: { in: ids }, cierreId: cierre.id },
            data: { pagoMensajero: new Prisma.Decimal(pago) },
          });
        }
        // Feature 56/R11/R13: puebla ingreso_bodega_rechazo por gestion AGRUPADO por valor
        // (a lo sumo 2 valores distintos — cobroRechazado para `rechazada` que aplica, "0.00"
        // para el resto). Guardia por cierreId=nuevo (las que acabamos de vincular). Todo en
        // la MISMA tx que el INSERT y el pago al mensajero (atomico, R13).
        const idsByIngreso = new Map<string, string[]>();
        for (const [gestionId, ingreso] of Object.entries(ingresoByGestionId)) {
          const arr = idsByIngreso.get(ingreso);
          if (arr) arr.push(gestionId);
          else idsByIngreso.set(ingreso, [gestionId]);
        }
        for (const [ingreso, ids] of idsByIngreso) {
          await tx.gestionOrden.updateMany({
            where: { id: { in: ids }, cierreId: cierre.id },
            data: { ingresoBodegaRechazo: new Prisma.Decimal(ingreso) },
          });
        }

        // Feature 69/R3-R9 — EL SNAPSHOT. Se construye en ESTA tx (R3/R4: todo-o-nada) y
        // DESPUES del updateMany que vincula, leyendo LO QUE LA TX REALMENTE VINCULO
        // (`where: { cierreId }`), NO la lista que el service leyo antes
        // (`findGestionesPendientes`, CierreDiaService:204). Porque: el updateMany no lleva
        // lista de ids, asi que una gestion creada entre la lectura del service y esta tx se
        // vincula IGUAL. Con el patron de la 39/56 eso solo dejaba un pago nulo (inofensivo);
        // aqui dejaria una orden SIN fila de detalle y, sin fallback (R14), la APROBACION
        // abortaria. Leer dentro de la tx elimina la carrera por construccion (design §3).
        //
        // R5: no hace falta filtrar `anuladaAt` — el updateMany de arriba ya solo vincula
        // gestiones vigentes (67/R16), asi que `where: { cierreId }` no puede traer anuladas.
        const gestiones = (await tx.gestionOrden.findMany({
          where: { cierreId: cierre.id },
          select: SNAPSHOT_SELECT,
        })) as SnapshotRow[];

        // R2 — EL GRANO: dedupe por ordenId. Una orden puede acumular varias gestiones
        // vigentes en el mismo cierre (reintentos 46/47); el detalle es de la ORDEN, y el
        // UNIQUE (cierre_id, orden_id) rechazaria la segunda fila.
        const porOrden = new Map<string, SnapshotRow>();
        for (const g of gestiones) if (!porOrden.has(g.ordenId)) porOrden.set(g.ordenId, g);
        const filas = [...porOrden.values()];

        if (filas.length > 0) {
          // Feature 69/R8 + feature 274/R22 — la tarifa vigente de cada PAR (tienda, zona)
          // distinto, EN LA MISMA tx y en UNA query (sin N+1, R7). Hasta la 273 esto se
          // resolvia por TIENDA sola (`resolveTarifasPorTiendas`), asi que dos ordenes de la
          // misma tienda en zonas distintas congelaban la MISMA fila; desde la 274 la fila la
          // elige la cascada sobre el par (design §4.2), la misma que usa el listado (R21).
          // `null` para un par sin tarifa = gap R9/R23: las 9 columnas quedan NULL y el cierre
          // se crea igual (decision (c) + R39: el gap NO bloquea, y el 409 de las APIs por key
          // NO llega hasta aqui).
          const pares = filas.map((f) => ({
            tiendaId: f.orden.tiendaId,
            zonaId: f.orden.zonaId,
          }));
          const tarifas = await this.tarifaRepo.resolveTarifas(pares, tx);
          await tx.cierreDetail.createMany({
            data: filas.map((f) => ({
              cierreId: cierre.id,
              ordenId: f.ordenId,
              // money-critical (R6). `montoCobrar` ya es Decimal|null en origen: se copia
              // tal cual, sin pasar por number (R11).
              montoCobrar: f.orden.montoCobrar,
              cobraComision: f.orden.cobraComision,
              zonaId: f.orden.zonaId,
              tiendaId: f.orden.tiendaId,
              esCentral: f.orden.zona.esCentral,
              // `=== true` y no `!!`: la columna es tri-valuada y `null` ("nadie lo decidio")
              // NO es especial. Una orden sin distrito (el unico FK nullable de `orden`)
              // congela `false`: sin distrito no hay marca que aplicar.
              esZonaEspecial: f.orden.distrito?.zonaEspecial === true,
              ...tarifaColumnas(
                tarifas.get(
                  clavePar({ tiendaId: f.orden.tiendaId, zonaId: f.orden.zonaId }),
                ) ?? null,
              ),
              // descriptivos (R7).
              numGuia: f.orden.numGuia,
              numRemision: f.orden.numRemision,
              destinatario: f.orden.destinatario,
              direccion: f.orden.direccion,
              producto: f.orden.producto,
              tiendaNombre: f.orden.tienda.nombre,
              zonaNombre: f.orden.zona.nombre,
              provinciaNombre: f.orden.provincia.nombre,
              cantonNombre: f.orden.canton.nombre,
              distritoNombre: f.orden.distrito?.nombre ?? null,
            })),
          });
        }
        return cierre.id;
      });
    } catch (err) {
      // Feature 41/C1: 0 gestiones vinculadas -> null (sin efectos). Cualquier otro
      // error se propaga (no se traga; convenciones de manejo de errores).
      if (err instanceof SinGestionesVinculadas) return null;
      throw err;
    }
  }

  /**
   * R18: cierres del mensajero (mas reciente primero) con totales snapshot.
   *
   * Feature 184 — Tanda C: es tambien el CONJUNTO del que sale el archivo de «Cierres solicitados»
   * (`listarCierresPasadosCompleto`). No hizo falta un metodo nuevo: este ya devolvia el conjunto
   * entero del mensajero, con el mismo `where`, el mismo orden y el mismo mapper que la pagina, y
   * un gemelo `…Completo` habria sido la tercera declaracion del mismo criterio (R16).
   */
  async findCierresByMensajero(mensajeroId: string): Promise<CierrePasadoDTO[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: cierresDeMensajeroWhere(mensajeroId),
      orderBy: ORDEN_CIERRES_MENSAJERO,
      select: CIERRE_PASADO_SELECT,
    });
    return rows.map(toCierrePasadoDTO);
  }

  /**
   * Cierre PROPIO + sus gestiones, para el detalle de "ver" un cierre anterior. El scope
   * (`id` + `mensajeroId`) va en el WHERE: un cierre ajeno devuelve `null` igual que uno
   * inexistente. La cabecera reusa el MISMO select/mapper que el histórico, así las dos
   * vistas no pueden divergir en los totales.
   *
   * Las gestiones salen de `WITH_DETALLE` (la proyección de la vista del MENSAJERO, que deja
   * la indemnización fuera de la consulta a propósito, design §7.2). Los montos por gestión
   * son los SNAPSHOT congelados al solicitar (`pago_mensajero` / `ingreso_bodega_rechazo`),
   * que es justo lo que el service NO debe re-derivar en un cierre ya cerrado.
   */
  async findCierrePropioConGestiones(
    cierreId: string,
    mensajeroId: string,
  ): Promise<{
    cierre: CierrePasadoDTO;
    gestiones: CierreGestionPendienteRow[];
    sinGestion: CierreSinGestionRow[];
    sinGestionRegistrado: boolean;
  } | null> {
    const cierre = await this.prisma.cierreDia.findFirst({
      where: { id: cierreId, mensajeroId }, // scope propio en el WHERE
      select: CIERRE_PASADO_SELECT,
    });
    if (cierre === null) return null;

    const [rows, sinGestion] = await Promise.all([
      this.prisma.gestionOrden.findMany({
        // `anuladaAt: null` por coherencia con el resto del módulo: una gestión anulada no
        // llega a vincularse a un cierre, pero el filtro deja la intención escrita.
        where: { cierreId, anuladaAt: null },
        orderBy: { createdAt: "desc" },
        ...WITH_DETALLE,
      }),
      // FEATURE 264 (B9/Q1, R7/R12/R30) — LA MISMA LISTA, PARA LA MISMA PANTALLA.
      //
      // `CierreFacturaDetalle` lo renderizan DOS modulos: el del admin y el del propio mensajero.
      // Siendo el mismo componente, la seccion aparece en los dos (R30) — que pintara en uno y
      // callara en otro es el arreglo a medias que se corrigio en la 263. Asi que el camino del
      // mensajero tiene que TRAER el dato, no solo saber pintarlo.
      //
      // Consulta GEMELA a la del admin: mismo `select` y mismo `orderBy`, importados del mismo
      // sitio, para que el mismo cierre no se lea distinto segun quien lo abra.
      //
      // SIN GUARDIA NUEVA: cuelga de `cierreId`, y el `findFirst` de arriba ya acoto ese id por
      // `mensajeroId` en el WHERE. Un cierre ajeno devolvio `null` y esta consulta ni se ejecuta.
      //
      // Nada de dinero cruza por aqui, asi que la regla de audiencia de la 38/40 (§7.2, «el
      // mensajero no ve la plata de la empresa») no aplica: son SUS ordenes, las que le
      // bloquearon el cierre.
      this.prisma.cierreSinGestion.findMany({
        where: { cierreId },
        orderBy: ORDEN_SIN_GESTION,
        select: SIN_GESTION_SELECT,
      }),
    ]);
    const deLaTienda = await this.marcarDesdeAyudaTienda(rows);
    return {
      cierre: toCierrePasadoDTO(cierre),
      gestiones: rows.map((r) => toPendienteRow(r, deLaTienda.has(r.id))),
      sinGestion: sinGestion.map(toSinGestionRow),
      sinGestionRegistrado: cierre.sinGestionRegistrado, // R27/R28
    };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina de los cierres del mensajero
   * + el total.
   *
   * Es `findCierresByMensajero` con el recorte `skip`/`take`, y comparte con el la proyeccion
   * y el mapper (`CIERRE_PASADO_SELECT` / `toCierrePasadoDTO`): las dos lecturas del mismo
   * listado no pueden devolver columnas distintas.
   *
   * `where { mensajeroId }` es el acotamiento por actor: lo escribe el servicio desde la
   * sesion, jamas la peticion. Y es el MISMO objeto en `findMany` y en `count`, para que el
   * total no pueda contar los cierres de todos los mensajeros.
   */
  async findCierresByMensajeroPaginado(
    mensajeroId: string,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CierrePasadoDTO>> {
    const where = cierresDeMensajeroWhere(mensajeroId); // R16: el MISMO alcance del conjunto
    const [rows, total] = await Promise.all([
      this.prisma.cierreDia.findMany({
        where,
        orderBy: ORDEN_CIERRES_MENSAJERO, // R51/R16: el MISMO orden del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: CIERRE_PASADO_SELECT,
      }),
      this.prisma.cierreDia.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toCierrePasadoDTO), total };
  }

  /**
   * Feature 67 — gestion candidata a deshacerse + estado real de su orden. Devuelve la fila tal
   * cual (sin juzgarla: las guardias viven en el service, `docs/architecture.md`). `null` = no
   * existe -> el service lo trata como `forbidden` (R9: no distingue inexistente de ajena).
   */
  async findGestionParaDeshacer(gestionId: string): Promise<GestionDeshacerRow | null> {
    const row = await this.prisma.gestionOrden.findUnique({
      where: { id: gestionId },
      select: {
        id: true,
        ordenId: true,
        mensajeroId: true, // R9
        resultado: true, // R5
        cierreId: true, // R2
        anuladaAt: true, // R3
        orden: { select: { deletedAt: true, estatusId: true, estatus: { select: { value: true } } } },
      },
    });
    if (row === null) return null;
    // 💰 Feature 237 (T5.5, D3/R38) — ¿la registro LA TIENDA desde la pestaña de ayuda? Se deriva
    // del historial, que es donde ya esta escrito quien la registro (`actor_usuario_id` +
    // `origen_tipo`), en vez de una columna nueva que habria que mantener.
    //
    // ⚠️ EL `ordenId` REPETIDO NO ES DECORATIVO — es rendimiento, y es el mismo truco que usa
    // `whereIntentosVigentes` (`OrdenHistorialRepository`). `orden_historial_estado` NO tiene
    // indice por `gestion_orden_id`: los tres que existen son `[ordenId, createdAt]`,
    // `[ordenId, estatusDestinoId]` y `[actorUsuarioId, origenTipo, createdAt]`, y la FK no crea
    // indice en Postgres. Filtrando tambien por `orden_id` el planner entra por
    // `@@index([ordenId, createdAt])` y `gestion_orden_id` queda como filtro residual sobre el
    // puñado de filas de esa orden. Sin el, esta consulta recorreria entera una tabla append-only
    // que crece con CADA transicion del sistema — en el camino de un boton. No se crea un indice
    // nuevo: se copia el acceso que ya estaba medido.
    const deLaTienda = await this.prisma.ordenHistorialEstado.findFirst({
      where: {
        ordenId: row.ordenId,
        gestionOrdenId: row.id,
        origenTipo: "gestion_tienda_ayuda",
      },
      select: { id: true },
    });
    return {
      gestionId: row.id,
      ordenId: row.ordenId,
      mensajeroId: row.mensajeroId,
      resultado: row.resultado,
      cierreId: row.cierreId,
      anuladaAt: row.anuladaAt,
      orden: {
        deletedAt: row.orden.deletedAt,
        estatusId: row.orden.estatusId, // R5: id REAL (guardia del UPDATE, sin re-resolver catalogo)
        estatusValue: row.orden.estatus.value,
      },
      desdeAyudaTienda: deLaTienda !== null,
    };
  }

  /** Feature 67/R4: id de la gestion NO anulada mas reciente de la orden (o null). */
  async findUltimaGestionNoAnuladaId(ordenId: string): Promise<string | null> {
    const row = await this.prisma.gestionOrden.findFirst({
      where: { ordenId, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Feature 67/R11/R18-R23 — UNICA escritura del deshacer, en UNA `$transaction` (R22). Las dos
   * escrituras van GUARDADAS en su WHERE (concurrencia-segura, patron `crearCierre`/`recogerLote`):
   * si alguna afecta 0 filas, el sentinela fuerza el rollback -> `false` sin efectos parciales.
   */
  async anularGestionYDevolverAGestion(input: AnularGestionInput): Promise<boolean> {
    const {
      gestionId,
      ordenId,
      mensajeroId,
      actorUsuarioId,
      estatusEsperadoId,
      estatusEnRepartoId,
      asignadoAt,
      diaEnCurso,
    } = input;
    // Feature 261 (B7): el dia entra al SQL como TEXTO `YYYY-MM-DD` con `::date` explicito. El
    // porque esta en `dia-reparto.ts` y no es teorico: el driver `pg` serializa un `Date` de JS
    // como `timestamptz` y Postgres lo convierte a `date` con el `TimeZone` DE LA SESION, asi que
    // el dia dependeria de la configuracion del servidor de base de datos.
    const diaTexto = fechaRepartoComoTexto(diaEnCurso);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1) R11: ANULA con rastro (quien la deshizo + cuando). Guardias: sigue siendo del
        // mensajero autor, sigue SIN cierre y sigue SIN anular (carrera con `solicitarCierre`
        // o doble submit). R12: `data` toca SOLO las dos columnas de anulacion — resultado,
        // monto, metodo, motivo, fecha, evidencia, mensajero autor y created_at quedan INTACTOS.
        const anulada = await tx.gestionOrden.updateMany({
          where: { id: gestionId, mensajeroId, cierreId: null, anuladaAt: null },
          data: { anuladaAt: new Date(), anuladaPor: actorUsuarioId },
        });
        if (anulada.count === 0) throw new NoAnulable();

        // 2) R18/R19: devuelve la orden a `en_reparto` (unico estado desde el que se puede
        // volver a gestionar) y REPONE la asignacion al mensajero autor. `mensajero_asignado_id`
        // incondicional: es idempotente cuando la asignacion ya era ese mensajero
        // (entregada/reprogramada/rechazada) y repone la que el seguimiento de un reintento
        // limpio (47/R6, `limpiaMensajero: true`). No puede pisar a otro mensajero: una
        // reasignacion habria cambiado el estado y esta misma guardia fallaria.
        // Guardias: la orden sigue EXACTAMENTE en el estado leido (R5) y no esta borrada (R6).
        //
        // Feature 76/R23 (W4): al deshacer una gestion se REPONE la asignacion al mensajero autor
        // (reasignacion efectiva) -> estampa `asignado_at`.
        //
        // FEATURE 246 (T3.4, R8/R10) — EL MOTIVO ORIGINAL, QUE SIGUE SIENDO CIERTO Y NO SE TIRA:
        // esta via NO ofrece la eleccion de dia —nadie esta asignando un lote, se esta
        // deshaciendo una gestion—, asi que el dia de reparto se estampa AQUI, en la misma
        // escritura que `asignado_at`, porque LAS DOS COLUMNAS NO PUEDEN CONTAR HISTORIAS
        // DISTINTAS. Si `asignado_at` dijera «te la acabo de reasignar» y `fecha_reparto`
        // conservara la reserva de AYER, el corte de esta misma noche la protegeria o la barreria
        // segun un dato que ya no describe nada.
        //
        // ⚠️ FEATURE 261 (B7, R16/R17/R18) — LO QUE AQUEL RAZONAMIENTO NO CONTEMPLO: LA RESERVA A
        // FUTURO. Ahi la combinacion «reasignada ahora, para un dia que aun no llega» NO es una
        // incoherencia: es exactamente lo que produce la via de asignacion cuando bodega elige
        // «mañana» (`asignado_at = NOW()`, `fecha_reparto = mañana`). Bajarla a hoy no repara
        // nada: CANCELA UNA DECISION QUE ALGUIEN TOMO A PROPOSITO, sin avisar, y entrega la orden
        // al corte de esa misma noche. Medido en produccion el 2026-08-21 con la guia 17496963:
        // gestionada 22:10, anulada 22:18, y en ese mismo instante `fecha_reparto` paso de
        // 2026-08-22 a 2026-08-21.
        //
        // LA REGLA NUEVA, con su excepcion nombrada: el dia de reparto se escribe SIEMPRE en la
        // misma escritura que `asignado_at`; al deshacer, ese dia es el de Costa Rica EN CURSO,
        // SALVO que la orden ya este reservada para un dia POSTERIOR — una reserva futura no se
        // cancela por reponer una asignacion.
        //
        // POR QUE UN `CASE` EN LA SENTENCIA Y NO UNA LECTURA PREVIA EN TypeScript: el `WHERE` de
        // este `UPDATE` solo protege `estatus_id`, asi que una fecha leida antes y escrita
        // despues podria pisarse con una decision rancia — el mismo genero de defecto que esta
        // ficha arregla. El `CASE` decide SOBRE LA FILA: no hay ventana entre leer y escribir.
        // Y no `GREATEST(...)`, que tambien funcionaria en Postgres (ignora los NULL) pero cuya
        // semantica es especifica del motor y contraria a lo que la mayoria espera.
        //
        // El `NULL` cae por el `ELSE` sin caso especial: `NULL > x` es `NULL`, que no es `TRUE`,
        // asi que una orden sin dia queda con el dia de hoy — que es R18 y lo que ya hacia.
        const movidas = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "orden"
          SET "estatus_id" = ${estatusEnRepartoId},
              "mensajero_asignado_id" = ${mensajeroId},
              "asignado_at" = ${asignadoAt},
              "fecha_reparto" = CASE
                WHEN "fecha_reparto" > ${diaTexto}::date THEN "fecha_reparto"
                ELSE ${diaTexto}::date
              END,
              "updated_at" = NOW()
          WHERE "id" = ${ordenId}
            AND "estatus_id" = ${estatusEsperadoId}
            AND "deleted_at" IS NULL
          RETURNING "id"`;
        if (movidas.length === 0) throw new NoAnulable();

        // 3) R20/R21/R23: CHOKE POINT del historial (49) en la MISMA tx que el cambio de estado.
        // Origen = estado real previo, destino = `en_reparto`, actor = quien deshizo,
        // `gestion_orden_id` = la gestion anulada, `origen_tipo` = `deshacer_gestion` (12.º
        // valor, F1.4-b) para que la linea de tiempo NO lo confunda con una gestion real.
        // Es un APPEND: ninguna fila previa del historial se modifica ni se borra (R23).
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: estatusEsperadoId,
            estatusDestinoId: estatusEnRepartoId,
            actorUsuarioId, // R20: el mensajero que deshizo
            origenTipo: "deshacer_gestion", // R20/R23
            gestionOrdenId: gestionId, // R20: enlace a la gestion anulada
          },
        ]);
        // R29 (F1.4-c): el puntero `usuario.orden_en_gestion_id` NO se toca. La orden se retoma
        // con `escogerParaGestion` (36), que ya tiene la guardia 1-a-1 idempotente.
        return true;
      });
    } catch (err) {
      // Guardia perdida (carrera) -> false (sin efectos). Cualquier otro error se propaga.
      if (err instanceof NoAnulable) return false;
      throw err;
    }
  }
}
