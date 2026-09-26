import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  AnulacionLeida,
  FilaDeLibroRow,
  IEstadoCuentaRepository,
  MovimientoDelPeriodoRow,
  PaginaDeLibro,
  ParDeChip,
  TipoDeDocumentoDeLibro,
  VentanaDeLibro,
} from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";

type Cliente = Pick<
  PrismaClient,
  | "$queryRaw"
  | "usuario"
  | "zona"
  | "walletTiendaMovimiento"
  | "pagoMensajeroMovimiento"
  | "cierreBodega"
  | "liquidacionAnulacion"
  | "cobroTiendaAnulacion"
  | "pagoPorCuentaTiendaAnulacion"
  | "abonoTiendaAnulacion"
  | "walletComprobante"
  | "pagoPorCuentaTienda"
  | "abonoTienda"
  | "cierreDia"
>;

/** Lo que devuelve la ventana, tal como sale de la base (montos ya en texto). */
interface FilaCruda {
  id: string;
  tipo: string;
  categoria: string;
  origen_tipo: string;
  origen_id: string | null;
  descripcion: string | null;
  registrado_por: string | null;
  registrado_por_nombre: string | null;
  fecha_movimiento: Date;
  monto: string;
  saldo_corrido: string;
  premio_dia: Date | null;
}

const NOMBRE_SQL = Prisma.sql`NULLIF(trim(concat_ws(' ', u.nombre, u.primer_apellido, u.segundo_apellido)), '')`;

function aFila(r: FilaCruda): FilaDeLibroRow {
  return {
    id: r.id,
    tipo: r.tipo,
    categoria: r.categoria,
    origenTipo: r.origen_tipo,
    origenId: r.origen_id,
    descripcion: r.descripcion,
    registradoPor: r.registrado_por,
    registradoPorNombre: r.registrado_por_nombre,
    fechaMovimiento: r.fecha_movimiento,
    monto: new Prisma.Decimal(r.monto).toFixed(2),
    saldoCorrido: new Prisma.Decimal(r.saldo_corrido).toFixed(2),
    premioDia: r.premio_dia,
  };
}

/** El filtro del chip: la lista CERRADA de pares que el servicio calculo con el diccionario total. */
function filtroDeChip(pares: ParDeChip[] | null, conPremio: boolean): Prisma.Sql {
  if (pares === null) return Prisma.empty;
  if (pares.length === 0) return Prisma.sql` AND FALSE`;
  const unaCondicion = (p: ParDeChip) =>
    conPremio && p.esPremio !== undefined
      ? Prisma.sql`(l.categoria = ${p.categoria} AND l.origen_tipo = ${p.origen} AND (l.premio_dia IS NOT NULL) = ${p.esPremio})`
      : Prisma.sql`(l.categoria = ${p.categoria} AND l.origen_tipo = ${p.origen})`;
  return Prisma.sql` AND (${Prisma.join(pares.map(unaCondicion), " OR ")})`;
}

const desdeSql = (desde?: Date) => (desde === undefined ? Prisma.empty : Prisma.sql` AND l.fecha_movimiento >= ${desde}`);

/**
 * FICHA 458-B (design §3.2, R16–R25) — las lecturas del estado de cuenta. SOLO queries.
 *
 * LA VENTANA (R21/R23): `SUM(± monto) OVER (ORDER BY fecha, created_at, id)` sobre la cuenta ENTERA
 * hasta `hastaUtc`; el periodo y el chip filtran DESPUES y se pagina al final. El orden es el mismo
 * dentro y fuera de la ventana, y es TOTAL (`id` cierra los empates), asi que dos lecturas seguidas
 * dan el mismo orden y el mismo corrido, y ninguna pagina repite ni omite filas.
 *
 * Mutacion 1 de design §8.2 (el signo del corrido al reves) y 2 (sin `created_at` en el ORDER BY de
 * la ventana) → rojas en `wallet-caracterizacion-458` y `estado-cuenta-saldo-corrido`.
 */
export class EstadoCuentaRepository implements IEstadoCuentaRepository {
  constructor(private readonly prisma: Cliente) {}

  async nombreDeCuenta(tipo: "tienda" | "mensajero" | "bodega", id: string): Promise<string | null> {
    if (tipo === "bodega") {
      const zona = await this.prisma.zona.findFirst({ where: { id, esCentral: false }, select: { nombre: true } });
      return zona?.nombre ?? null;
    }
    const usuario = await this.prisma.usuario.findFirst({
      where: { id, rol: { value: tipo === "tienda" ? "adminTienda" : "mensajero" } },
      select: NOMBRE_USUARIO_SELECT,
    });
    return usuario === null ? null : nombreCompletoUsuario(usuario);
  }

  // ── Paginas con saldo corrido ─────────────────────────────────────────────────────────────

  async paginaDeTienda(tiendaId: string, v: VentanaDeLibro): Promise<PaginaDeLibro> {
    const hasta = v.hastaUtc === undefined ? Prisma.empty : Prisma.sql` AND m.fecha_movimiento < ${v.hastaUtc}`;
    const libro = Prisma.sql`
      WITH libro AS (
        SELECT m.id, m.tipo::text AS tipo, m.categoria::text AS categoria, m.origen_tipo::text AS origen_tipo,
               m.origen_id, m.descripcion, m.registrado_por, m.fecha_movimiento, m.created_at, m.monto,
               NULL::date AS premio_dia,
               SUM(CASE WHEN m.tipo = 'credito' THEN m.monto ELSE -m.monto END)
                 OVER (ORDER BY m.fecha_movimiento, m.created_at, m.id) AS saldo_corrido
        FROM wallet_tienda_movimiento m
        WHERE m.tienda_id = ${tiendaId}${hasta}
      )`;
    return this.paginar(libro, v, false);
  }

  async paginaDeMensajero(mensajeroId: string, v: VentanaDeLibro): Promise<PaginaDeLibro> {
    const hasta = v.hastaUtc === undefined ? Prisma.empty : Prisma.sql` AND m.fecha_movimiento < ${v.hastaUtc}`;
    const libro = Prisma.sql`
      WITH libro AS (
        SELECT m.id, m.tipo::text AS tipo, m.categoria::text AS categoria, m.origen_tipo::text AS origen_tipo,
               m.origen_id, m.descripcion, m.registrado_por, m.fecha_movimiento, m.created_at, m.monto,
               m.premio_dia,
               SUM(CASE WHEN m.tipo = 'devengo' THEN m.monto ELSE -m.monto END)
                 OVER (ORDER BY m.fecha_movimiento, m.created_at, m.id) AS saldo_corrido
        FROM pago_mensajero_movimiento m
        WHERE m.mensajero_id = ${mensajeroId}${hasta}
      )`;
    return this.paginar(libro, v, true);
  }

  /**
   * La bodega no tiene libro: se ARMA con una UNION sobre `cierre_bodega` de la zona (design §3.2).
   * «Declarado» = el efectivo de la consolidacion, al solicitarla; «Recibido» = lo que llego, al
   * marcarla. El corrido es el PENDIENTE acumulado (Σ declarado − Σ recibido): la misma resta que
   * `saldoDe` aplica por consolidacion. Las rechazadas no cuentan (como en `/wallet/satelites`).
   */
  async paginaDeBodega(zonaId: string, v: VentanaDeLibro): Promise<PaginaDeLibro> {
    const hasta = v.hastaUtc === undefined ? Prisma.empty : Prisma.sql` WHERE mv.fecha_movimiento < ${v.hastaUtc}`;
    const libro = Prisma.sql`
      WITH mov AS (
        SELECT cb.id, 'declarado'::text AS tipo, 'declarado'::text AS categoria, 'cierre_bodega'::text AS origen_tipo,
               cb.id AS origen_id, NULL::text AS descripcion, cb.solicitado_por AS registrado_por,
               cb.solicitado_at AS fecha_movimiento, cb.solicitado_at AS created_at, cb.total_efectivo AS monto, 0 AS orden
        FROM cierre_bodega cb
        WHERE cb.zona_id = ${zonaId} AND cb.estado::text <> 'rechazado'
        UNION ALL
        SELECT cb.id, 'recibido'::text, 'recibido'::text, 'cierre_bodega'::text,
               cb.id, NULL::text, cb.conciliado_por,
               cb.conciliado_at, cb.conciliado_at, cb.monto_recibido, 1
        FROM cierre_bodega cb
        WHERE cb.zona_id = ${zonaId} AND cb.estado::text <> 'rechazado' AND cb.conciliado_at IS NOT NULL
      ), libro AS (
        SELECT mv.id, mv.tipo, mv.categoria, mv.origen_tipo, mv.origen_id, mv.descripcion, mv.registrado_por,
               mv.fecha_movimiento, mv.created_at, mv.monto, mv.orden, NULL::date AS premio_dia,
               SUM(CASE WHEN mv.tipo = 'declarado' THEN mv.monto ELSE -mv.monto END)
                 OVER (ORDER BY mv.fecha_movimiento, mv.orden, mv.id) AS saldo_corrido
        FROM mov mv${hasta}
      )`;
    const where = Prisma.sql`WHERE TRUE${desdeSql(v.desdeUtc)}${filtroDeChip(v.pares, false)}`;
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      ${libro}
      SELECT l.id, l.tipo, l.categoria, l.origen_tipo, l.origen_id, l.descripcion, l.registrado_por,
             ${NOMBRE_SQL} AS registrado_por_nombre, l.fecha_movimiento, l.monto::text AS monto,
             l.saldo_corrido::text AS saldo_corrido, l.premio_dia
      FROM libro l LEFT JOIN usuario u ON u.id = l.registrado_por
      ${where}
      ORDER BY l.fecha_movimiento, l.orden, l.id
      LIMIT ${v.take} OFFSET ${v.skip}`;
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      ${libro}
      SELECT count(*)::int AS total FROM libro l ${where}`;
    return { filas: filas.map(aFila), total };
  }

  private async paginar(libro: Prisma.Sql, v: VentanaDeLibro, conPremio: boolean): Promise<PaginaDeLibro> {
    const where = Prisma.sql`WHERE TRUE${desdeSql(v.desdeUtc)}${filtroDeChip(v.pares, conPremio)}`;
    const filas = await this.prisma.$queryRaw<FilaCruda[]>`
      ${libro}
      SELECT l.id, l.tipo, l.categoria, l.origen_tipo, l.origen_id, l.descripcion, l.registrado_por,
             ${NOMBRE_SQL} AS registrado_por_nombre, l.fecha_movimiento, l.monto::text AS monto,
             l.saldo_corrido::text AS saldo_corrido, l.premio_dia
      FROM libro l LEFT JOIN usuario u ON u.id = l.registrado_por
      ${where}
      ORDER BY l.fecha_movimiento, l.created_at, l.id
      LIMIT ${v.take} OFFSET ${v.skip}`;
    const [{ total }] = await this.prisma.$queryRaw<{ total: number }[]>`
      ${libro}
      SELECT count(*)::int AS total FROM libro l ${where}`;
    return { filas: filas.map(aFila), total };
  }

  // ── Saldos (sin ventana) ──────────────────────────────────────────────────────────────────

  async totalesDeTienda(tiendaId: string, antesDe?: Date): Promise<{ creditos: string; debitos: string }> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tipo"],
      where: { tiendaId, ...(antesDe === undefined ? {} : { fechaMovimiento: { lt: antesDe } }) },
      _sum: { monto: true },
    });
    return { creditos: sumaDe(grupos, "credito"), debitos: sumaDe(grupos, "debito") };
  }

  async totalesDeMensajero(mensajeroId: string, antesDe?: Date): Promise<{ devengado: string; pagado: string }> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where: { mensajeroId, ...(antesDe === undefined ? {} : { fechaMovimiento: { lt: antesDe } }) },
      _sum: { monto: true },
    });
    return { devengado: sumaDe(grupos, "devengo"), pagado: sumaDe(grupos, "pago") };
  }

  async totalesDeBodega(zonaId: string, antesDe?: Date): Promise<{ efectivo: string; recibido: string }> {
    const noRechazadas = { zonaId, estado: { not: "rechazado" as const } };
    const declarado = await this.prisma.cierreBodega.aggregate({
      where: { ...noRechazadas, ...(antesDe === undefined ? {} : { solicitadoAt: { lt: antesDe } }) },
      _sum: { totalEfectivo: true },
    });
    const recibido = await this.prisma.cierreBodega.aggregate({
      where: {
        ...noRechazadas,
        conciliadoAt: antesDe === undefined ? { not: null } : { not: null, lt: antesDe },
      },
      _sum: { montoRecibido: true },
    });
    return {
      efectivo: new Prisma.Decimal(declarado._sum.totalEfectivo ?? 0).toFixed(2),
      recibido: new Prisma.Decimal(recibido._sum.montoRecibido ?? 0).toFixed(2),
    };
  }

  // ── Periodo (para los totales netos) ──────────────────────────────────────────────────────

  async periodoDeTienda(tiendaId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]> {
    const filas = await this.prisma.walletTiendaMovimiento.findMany({
      where: { tiendaId, fechaMovimiento: rango(desdeUtc, hastaUtc) },
      select: { id: true, tipo: true, categoria: true, origenTipo: true, origenId: true, monto: true },
    });
    return filas.map((f) => ({ ...f, premioDia: null, monto: f.monto.toFixed(2) }));
  }

  async periodoDeMensajero(mensajeroId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]> {
    const filas = await this.prisma.pagoMensajeroMovimiento.findMany({
      where: { mensajeroId, fechaMovimiento: rango(desdeUtc, hastaUtc) },
      select: { id: true, tipo: true, categoria: true, origenTipo: true, origenId: true, premioDia: true, monto: true },
    });
    return filas.map((f) => ({ ...f, monto: f.monto.toFixed(2) }));
  }

  async periodoDeBodega(zonaId: string, desdeUtc?: Date, hastaUtc?: Date): Promise<MovimientoDelPeriodoRow[]> {
    const noRechazadas = { zonaId, estado: { not: "rechazado" as const } };
    const declaradas = await this.prisma.cierreBodega.findMany({
      where: { ...noRechazadas, solicitadoAt: rango(desdeUtc, hastaUtc) },
      select: { id: true, totalEfectivo: true },
    });
    const recibidas = await this.prisma.cierreBodega.findMany({
      where: { ...noRechazadas, conciliadoAt: { not: null, ...rango(desdeUtc, hastaUtc) } },
      select: { id: true, montoRecibido: true },
    });
    return [
      ...declaradas.map((d) => ({
        id: d.id,
        tipo: "declarado",
        categoria: "declarado",
        origenTipo: "cierre_bodega",
        origenId: d.id,
        premioDia: null,
        monto: d.totalEfectivo.toFixed(2),
      })),
      ...recibidas.map((r) => ({
        id: r.id,
        tipo: "recibido",
        categoria: "recibido",
        origenTipo: "cierre_bodega",
        origenId: r.id,
        premioDia: null,
        monto: new Prisma.Decimal(r.montoRecibido ?? 0).toFixed(2),
      })),
    ];
  }

  // ── Anulaciones y comprobantes, en lote ───────────────────────────────────────────────────

  async anulacionesDe(tipo: TipoDeDocumentoDeLibro, ids: readonly string[]): Promise<AnulacionLeida[]> {
    if (ids.length === 0) return [];
    const lista = [...ids];
    const seleccion = {
      motivo: true,
      createdAt: true,
      anulador: { select: NOMBRE_USUARIO_SELECT },
    } as const;
    const leer = (documentoId: string, f: { motivo: string; createdAt: Date; anulador: Parameters<typeof nombreCompletoUsuario>[0] }) => ({
      documentoId,
      motivo: f.motivo,
      anuladoPorNombre: nombreCompletoUsuario(f.anulador),
      fecha: f.createdAt,
    });
    switch (tipo) {
      case "liquidacion_pago":
        return (
          await this.prisma.liquidacionAnulacion.findMany({ where: { pagoId: { in: lista } }, select: { pagoId: true, ...seleccion } })
        ).map((f) => leer(f.pagoId, f));
      case "cobro_tienda":
        return (
          await this.prisma.cobroTiendaAnulacion.findMany({ where: { cobroId: { in: lista } }, select: { cobroId: true, ...seleccion } })
        ).map((f) => leer(f.cobroId, f));
      case "pago_por_cuenta_tienda":
        return (
          await this.prisma.pagoPorCuentaTiendaAnulacion.findMany({ where: { pagoId: { in: lista } }, select: { pagoId: true, ...seleccion } })
        ).map((f) => leer(f.pagoId, f));
      case "abono_tienda":
        return (
          await this.prisma.abonoTiendaAnulacion.findMany({ where: { abonoId: { in: lista } }, select: { abonoId: true, ...seleccion } })
        ).map((f) => leer(f.abonoId, f));
    }
  }

  async conComprobante(tipo: TipoDeDocumentoDeLibro, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const lista = [...ids];
    switch (tipo) {
      case "liquidacion_pago":
        return new Set(
          (
            await this.prisma.walletComprobante.findMany({ where: { liquidacionPagoId: { in: lista } }, select: { liquidacionPagoId: true } })
          ).map((c) => c.liquidacionPagoId as string),
        );
      case "cobro_tienda":
        return new Set(
          (
            await this.prisma.walletComprobante.findMany({ where: { tiendaMovimientoId: { in: lista } }, select: { tiendaMovimientoId: true } })
          ).map((c) => c.tiendaMovimientoId as string),
        );
      case "pago_por_cuenta_tienda":
        return new Set(
          (
            await this.prisma.pagoPorCuentaTienda.findMany({ where: { id: { in: lista }, comprobantePath: { not: null } }, select: { id: true } })
          ).map((p) => p.id),
        );
      case "abono_tienda":
        return new Set(
          (
            await this.prisma.abonoTienda.findMany({ where: { id: { in: lista }, comprobantePath: { not: null } }, select: { id: true } })
          ).map((p) => p.id),
        );
    }
  }

  async reversosDePremio(mensajeroId: string, dias: readonly Date[]): Promise<AnulacionLeida[]> {
    if (dias.length === 0) return [];
    const filas = await this.prisma.pagoMensajeroMovimiento.findMany({
      where: { mensajeroId, categoria: "ajuste_pago", premioDia: { in: [...dias] } },
      select: { premioDia: true, descripcion: true, fechaMovimiento: true, registrador: { select: NOMBRE_USUARIO_SELECT } },
    });
    return filas.map((f) => ({
      documentoId: (f.premioDia as Date).toISOString(),
      motivo: f.descripcion,
      anuladoPorNombre: nombreONulo(f.registrador),
      fecha: f.fechaMovimiento,
    }));
  }

  async quienAproboLosCierres(cierreIds: readonly string[]): Promise<Map<string, string | null>> {
    if (cierreIds.length === 0) return new Map();
    const cierres = await this.prisma.cierreDia.findMany({
      where: { id: { in: [...cierreIds] } },
      select: { id: true, resueltoPorUsuario: { select: NOMBRE_USUARIO_SELECT } },
    });
    return new Map(cierres.map((c) => [c.id, nombreONulo(c.resueltoPorUsuario)]));
  }
}

function nombreONulo(u: Parameters<typeof nombreCompletoUsuario>[0] | null): string | null {
  return u === null ? null : nombreCompletoUsuario(u);
}

function rango(desde?: Date, hasta?: Date): Prisma.DateTimeFilter {
  return {
    ...(desde === undefined ? {} : { gte: desde }),
    ...(hasta === undefined ? {} : { lt: hasta }),
  };
}

/** La Σ de un tipo en el `groupBy` por tipo (`0.00` si no hay filas). STRING escala 2. */
function sumaDe(grupos: { tipo: string; _sum: { monto: Prisma.Decimal | null } }[], tipo: string): string {
  return (grupos.find((g) => g.tipo === tipo)?._sum.monto ?? new Prisma.Decimal(0)).toFixed(2);
}
