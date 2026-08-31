import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CierreBodegaResumenRow,
  CierreDiaConsolidableRow,
  CrearCierreBodegaInput,
  ICierreBodegaRepository,
} from "@/lib/interfaces/repositories/ICierreBodegaRepository";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type { FiltrosCierresBodega } from "@/lib/types/filtros-cierres";
import {
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";

// Estados/destino relevantes (fuente de verdad en lib/types/cierre.ts). El cierre de
// bodega se crea SIEMPRE en `solicitado`; consolida SOLO cierre_dia `aprobado`.
const ESTADO_SOLICITADO = "solicitado";
const ESTADO_APROBADO = "aprobado";
const DESTINO_SATELITE = "bodega_satelite";

type CierreBodegaPrismaClient = Pick<PrismaClient, "cierreDia" | "cierreBodega" | "$transaction">;

// Money-safe: Decimal -> string escala 2 (nunca number/parseFloat).
function totalesToString(r: {
  totalEfectivo: Prisma.Decimal;
  totalSimpe: Prisma.Decimal;
  totalTransferencia: Prisma.Decimal;
  totalGeneral: Prisma.Decimal;
}) {
  return {
    efectivo: r.totalEfectivo.toFixed(2),
    simpe: r.totalSimpe.toFixed(2),
    transferencia: r.totalTransferencia.toFixed(2),
    general: r.totalGeneral.toFixed(2),
  };
}

// Proyeccion de la cabecera de un cierre_dia consolidable (mensajero + totales).
const CONSOLIDABLE_SELECT = {
  id: true,
  mensajeroId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R18: snapshot del pago al mensajero del cierre_dia
  totalIngresoBodegaRechazos: true, // feature 56/R17: snapshot del ingreso de bodega por rechazos del cierre_dia
  mensajero: { select: NOMBRE_USUARIO_SELECT },
} as const;

// Proyeccion de la cabecera de un cierre de bodega (join a zona/usuario + _count).
// Exportada para reuso por CierresBodegaAdminRepository (lado maestro): mismo mapper,
// distinto WHERE (todos vs por zona).
export const BODEGA_RESUMEN_SELECT = {
  id: true,
  zonaId: true,
  solicitadoPor: true,
  estado: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R19/R20: snapshot agregado del pago a mensajeros
  totalIngresoBodegaRechazos: true, // feature 56/R18/R19: snapshot agregado del ingreso de bodega por rechazos
  solicitadoAt: true,
  resueltoAt: true,
  motivoRechazo: true,
  zona: { select: { nombre: true } },
  solicitadoPorUsuario: { select: { nombre: true } },
  _count: { select: { cierresDia: true } },
} as const;

type BodegaResumenRow = Prisma.CierreBodegaGetPayload<{ select: typeof BODEGA_RESUMEN_SELECT }>;

// Mapper cabecera cruda -> fila de dominio (totales STRING, fechas ISO). Exportado
// para reuso por CierresBodegaAdminRepository.
export function toBodegaResumenRow(r: BodegaResumenRow): CierreBodegaResumenRow {
  return {
    cierreBodegaId: r.id,
    zonaId: r.zonaId,
    zonaNombre: r.zona.nombre,
    solicitadoPorId: r.solicitadoPor,
    solicitadoPorNombre: r.solicitadoPorUsuario.nombre,
    estado: r.estado,
    totales: totalesToString(r),
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R19/R20: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R18/R19: snapshot money-safe STRING
    cantidadCierres: r._count.cierresDia,
    solicitadoAt: r.solicitadoAt.toISOString(),
    resueltoAt: r.resueltoAt ? r.resueltoAt.toISOString() : null,
    motivoRechazo: r.motivoRechazo,
  };
}

/**
 * R3/R5 — el conjunto CONSOLIDABLE de una zona: los cuatro predicados que definen «cierre_dia
 * que esta bodega puede cerrar hoy». Feature 170 (T J.1): estaba escrito a mano en
 * `findCierresDiaConsolidables` y la version paginada habria sido la segunda copia.
 *
 * Extraerlo NO es higiene: de este mismo conjunto salen los totales AGREGADOS de la pantalla
 * (`totalesAgregados`, `totalPagoMensajeroAgregado`, `totalNetoAgregado`, `totalCentralDebe`),
 * que `CierreBodegaService` calcula sobre el conjunto COMPLETO (R49). Si la pagina filtrara
 * con un predicado distinto —por ejemplo sin `cierreBodegaId: null`—, la tabla mostraria filas
 * que el total no cuenta y el adminSatelite veria dos numeros de dinero que no cuadran entre
 * si, sin nada que se lo diga.
 */
/**
 * Pedido humano del 2026-08-16 — el recorte por FECHA de un listado de esta pantalla, en la
 * forma que Prisma entiende para las DOS tablas que aqui se leen.
 *
 * Las fechas son de CALENDARIO DE COSTA RICA: `solicitadoAt` es un instante, y el limite
 * superior es `lt` del dia SIGUIENTE —no `lte` del mismo dia— porque con `lte` se caerian los
 * cierres solicitados entre las 00:00 y las 23:59:59.999 del ultimo dia del rango, que es justo
 * el dia que el usuario acaba de pedir. Mismo criterio que en los otros dos repositorios de
 * cierres, escrito aqui porque las tablas son otras.
 */
function rangoSolicitadoAt(
  filtros: FiltrosCierresBodega | undefined,
): { gte?: Date; lt?: Date } | undefined {
  if (!filtros || (filtros.desde === undefined && filtros.hasta === undefined)) return undefined;
  return {
    ...(filtros.desde !== undefined ? { gte: inicioDelDiaCREnUtc(filtros.desde) } : {}),
    ...(filtros.hasta !== undefined ? { lt: inicioDelDiaSiguienteCREnUtc(filtros.hasta) } : {}),
  };
}

/**
 * Pedido humano del 2026-08-16 — el recorte por ZONA, que aqui NO puede escribirse como clave
 * hermana: el alcance ya fija `zonaId`/`destinoZonaId` a la del actor, y una segunda clave con
 * el mismo nombre lo PISARIA. Va dentro de un `AND`, que es la unica forma de que las dos
 * condiciones se exijan a la vez: un adminSatelite que filtre por la zona vecina obtiene la
 * interseccion —vacio—, nunca la zona vecina.
 *
 * En esta pantalla el filtro de zona es casi siempre trivial (el actor tiene UNA), pero se
 * aplica igual: la barra es la misma que la del maestro y lo que ofrece tiene que hacer lo que
 * dice. Ofrecer un control que no filtra es peor que no ofrecerlo.
 */
function recorteZona<T extends { destinoZonaId?: unknown; zonaId?: unknown }>(
  filtros: FiltrosCierresBodega | undefined,
  clave: "destinoZonaId" | "zonaId",
): T[] {
  if (!filtros || filtros.destinoZonaIds === undefined) return [];
  return [{ [clave]: { in: [...filtros.destinoZonaIds] } } as T];
}

function consolidablesWhere(
  zonaId: string,
  filtros?: FiltrosCierresBodega,
): Prisma.CierreDiaWhereInput {
  const rango = rangoSolicitadoAt(filtros);
  const zonas = recorteZona<Prisma.CierreDiaWhereInput>(filtros, "destinoZonaId");
  return {
    estado: ESTADO_APROBADO, // R5: solo aprobados aportan dinero cuadrado
    destinoTipo: DESTINO_SATELITE, // R5: destino bodega satelite
    destinoZonaId: zonaId, // R3/R5: acotado a SU zona (en el WHERE)
    cierreBodegaId: null, // R5: aun no consolidados
    ...(rango ? { solicitadoAt: rango } : {}),
    // Sin filtros no se escribe `AND`: el criterio queda IDENTICO al de antes del 2026-08-16.
    ...(zonas.length > 0 ? { AND: zonas } : {}),
  };
}

/**
 * Feature 184 — Tanda B (R16) — el ORDEN del listado de consolidables, declarado una vez.
 *
 * `consolidablesWhere` ya evitaba la segunda copia del criterio de SELECCION; el ORDEN seguia
 * escrito dos veces, una en cada metodo. No es simetria: la pagina N que la tabla pinta tiene
 * que ser el segmento N del conjunto del que sale el archivo (feature 184/R5), y eso solo se
 * sostiene si las dos consultas ordenan igual. Con dos literales, cambiar uno deja el archivo
 * ordenado de una forma y la tabla de otra, y ninguna prueba de servicio lo ve.
 */
const ORDEN_CONSOLIDABLES: Prisma.CierreDiaOrderByWithRelationInput = { solicitadoAt: "desc" };

/**
 * Feature 184 — Tanda B (R16) — el ALCANCE del listado «Cierres de bodega solicitados».
 *
 * La zona es TODO el acotamiento de este listado (no filtra por estado: muestra los cierres de
 * la bodega en cualquier estado). Estaba escrito dos veces —una en el conjunto y otra en la
 * pagina—; que las dos digan `{ zonaId }` por separado es justo lo que permite que una se quede
 * atras el dia que este listado gane un predicado.
 */
function cierresBodegaDeZonaWhere(
  zonaId: string,
  filtros?: FiltrosCierresBodega,
): Prisma.CierreBodegaWhereInput {
  const rango = rangoSolicitadoAt(filtros);
  const zonas = recorteZona<Prisma.CierreBodegaWhereInput>(filtros, "zonaId");
  return {
    zonaId, // R3: el alcance por zona, en el WHERE y nunca en memoria
    ...(rango ? { solicitadoAt: rango } : {}),
    ...(zonas.length > 0 ? { AND: zonas } : {}),
  };
}

/** El orden de «Cierres de bodega solicitados», compartido por el conjunto y la pagina (R16). */
const ORDEN_CIERRES_BODEGA: Prisma.CierreBodegaOrderByWithRelationInput = {
  solicitadoAt: "desc",
};

type ConsolidableRow = Prisma.CierreDiaGetPayload<{ select: typeof CONSOLIDABLE_SELECT }>;

/** Fila cruda de un cierre_dia consolidable -> DTO de dominio (money-safe STRING). */
function toConsolidableRow(r: ConsolidableRow): CierreDiaConsolidableRow {
  return {
    cierreDiaId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: nombreCompletoUsuario(r.mensajero),
    totales: totalesToString(r),
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R18: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R17: snapshot money-safe STRING
  };
}

/**
 * Feature 40 — repositorio del "Cierre de bodega" (lado adminSatelite). SOLO queries
 * Prisma. El alcance (zona/estado) va SIEMPRE en el WHERE (R3/R5/R6), nunca en memoria.
 * `crearCierreBodega` es transaccional (INSERT + link atomico, R9/R10) con guardia de
 * concurrencia en el updateMany; una violacion del indice unico parcial (P2002) se
 * PROPAGA para que el service la traduzca a `conflict` (R8).
 */
export class CierreBodegaRepository implements ICierreBodegaRepository {
  constructor(private readonly prisma: CierreBodegaPrismaClient) {}

  /**
   * R5: cierre_dia aprobados de la zona, destino satelite, sin cierre de bodega.
   *
   * Feature 184 — Tanda B: es tambien el CONJUNTO del que sale el archivo del listado «Cierres
   * del dia a consolidar» (`listarConsolidablesCompleto`). No hizo falta un metodo nuevo: este
   * ya devolvia el conjunto entero, con el mismo criterio, el mismo orden y el mismo mapper que
   * la pagina, y anadir un gemelo habria sido la tercera declaracion del mismo `where`.
   */
  async findCierresDiaConsolidables(
    zonaId: string,
    filtros?: FiltrosCierresBodega,
  ): Promise<CierreDiaConsolidableRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: consolidablesWhere(zonaId, filtros),
      orderBy: ORDEN_CONSOLIDABLES,
      select: CONSOLIDABLE_SELECT,
    });
    return rows.map(toConsolidableRow);
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R49/R51/R54): una pagina de los cierre_dia
   * CONSOLIDABLES de la zona + el total.
   *
   * MISMO `consolidablesWhere` y MISMO `orderBy solicitadoAt desc` que
   * `findCierresDiaConsolidables` (R44/R51): la pagina es un recorte de aquel conjunto, no
   * otra consulta parecida.
   *
   * **Este metodo NO calcula ni devuelve totales, y es deliberado (R49).** Los agregados de
   * dinero de la pantalla se siguen calculando en `CierreBodegaService.listarConsolidacion`
   * sobre el conjunto COMPLETO. Dos de ellos —`totalNetoAgregado` y `totalCentralDebe`— no son
   * una suma: salen de repartir el efectivo entre los pagos individuales ORDENADOS de menor a
   * mayor, asi que ni siquiera un `SUM` en la base los produciria. Una pagina no puede
   * responderlos.
   */
  async findCierresDiaConsolidablesPaginado(
    zonaId: string,
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreDiaConsolidableRow>> {
    const where = consolidablesWhere(zonaId, filtros);
    const [rows, total] = await Promise.all([
      this.prisma.cierreDia.findMany({
        where,
        orderBy: ORDEN_CONSOLIDABLES, // R51/R16: el MISMO orden del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: CONSOLIDABLE_SELECT,
      }),
      this.prisma.cierreDia.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toConsolidableRow), total };
  }

  /** R6: cierre_dia de la zona aun `solicitado` (sin resolver por el adminSatelite). */
  async contarCierresDiaSolicitados(zonaId: string): Promise<number> {
    return this.prisma.cierreDia.count({
      where: {
        destinoTipo: DESTINO_SATELITE,
        destinoZonaId: zonaId,
        estado: ESTADO_SOLICITADO,
      },
    });
  }

  /** R8: existe un CierreBodega de la zona en estado `solicitado`. */
  async existeCierreBodegaSolicitado(zonaId: string): Promise<boolean> {
    const count = await this.prisma.cierreBodega.count({
      where: { zonaId, estado: ESTADO_SOLICITADO },
    });
    return count > 0;
  }

  /** R9/R10: INSERT cierre_bodega (snapshot Decimal) + vincular cierre_dia, atomico. */
  async crearCierreBodega(input: CrearCierreBodegaInput): Promise<string> {
    const { zonaId, solicitadoPor, cierreDiaIds, totales, totalPagoMensajero, totalIngresoBodegaRechazos } =
      input;
    return this.prisma.$transaction(async (tx) => {
      const cierre = await tx.cierreBodega.create({
        data: {
          zonaId,
          solicitadoPor,
          estado: ESTADO_SOLICITADO,
          totalEfectivo: new Prisma.Decimal(totales.efectivo),
          totalSimpe: new Prisma.Decimal(totales.simpe),
          totalTransferencia: new Prisma.Decimal(totales.transferencia),
          totalGeneral: new Prisma.Decimal(totales.general),
          // Feature 39/R19: snapshot agregado del pago a mensajeros, en la misma tx.
          totalPagoMensajero: new Prisma.Decimal(totalPagoMensajero),
          // Feature 56/R18: snapshot agregado del ingreso de bodega por rechazos, en la misma tx.
          totalIngresoBodegaRechazos: new Prisma.Decimal(totalIngresoBodegaRechazos),
        },
        select: { id: true },
      });
      // R9: vincula SOLO los cierre_dia consolidables de la zona (guardia de propiedad
      // + no-consolidados + aprobados en el WHERE; concurrencia-segura).
      await tx.cierreDia.updateMany({
        where: {
          id: { in: cierreDiaIds },
          cierreBodegaId: null,
          estado: ESTADO_APROBADO,
          destinoZonaId: zonaId,
        },
        data: { cierreBodegaId: cierre.id },
      });
      return cierre.id;
    });
  }

  /**
   * F1.4-h: historico propio de la zona, mas reciente primero, totales -> STRING.
   *
   * Feature 184 — Tanda B: es tambien el CONJUNTO del que sale el archivo del listado «Cierres
   * de bodega solicitados» (`listarCierresBodegaSolicitadosCompleto`). Igual que en los
   * consolidables, no se anadio un metodo nuevo: este devuelve ya el conjunto entero de la zona
   * con el mismo orden y el mismo mapper que la pagina.
   */
  async findCierresBodegaByZona(
    zonaId: string,
    filtros?: FiltrosCierresBodega,
  ): Promise<CierreBodegaResumenRow[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: cierresBodegaDeZonaWhere(zonaId, filtros),
      orderBy: ORDEN_CIERRES_BODEGA,
      select: BODEGA_RESUMEN_SELECT,
    });
    return rows.map(toBodegaResumenRow);
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina de los cierres de bodega de
   * la zona + el total.
   *
   * El `where` con el acotamiento por zona se construye UNA vez y lo comparten `findMany` y
   * `count`. Que el `zonaId` sea el MISMO objeto en las dos consultas no es cosmetico: es lo
   * que impide que el total cuente los cierres de toda la operacion mientras la pagina muestra
   * los de una bodega.
   */
  async findCierresBodegaByZonaPaginado(
    zonaId: string,
    rango: RangoPagina,
    filtros?: FiltrosCierresBodega,
  ): Promise<PaginaRepositorio<CierreBodegaResumenRow>> {
    // R3/R16: el MISMO alcance —y el mismo recorte— que el conjunto del archivo.
    const where = cierresBodegaDeZonaWhere(zonaId, filtros);
    const [rows, total] = await Promise.all([
      this.prisma.cierreBodega.findMany({
        where,
        orderBy: ORDEN_CIERRES_BODEGA, // R51/R16: el MISMO orden del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: BODEGA_RESUMEN_SELECT,
      }),
      this.prisma.cierreBodega.count({ where }), // R41: el total del CONJUNTO
    ]);
    return { items: rows.map(toBodegaResumenRow), total };
  }
}
