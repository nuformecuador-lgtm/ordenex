import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  CuentasDeOrigen,
  FilaDeLibroComoQuedo,
  IComoQuedoRepository,
} from "@/lib/interfaces/repositories/IComoQuedoRepository";
import type { AgregadoCajaRow, WalletMovimientoCategoria, WalletMovimientoTipo } from "@/lib/types/wallet";

type Cliente = Pick<PrismaClient, "$queryRaw" | "walletMovimiento" | "walletTiendaMovimiento" | "pagoMensajeroMovimiento">;

/** Los origenes de la caja que nombran al DEBITO de un cobro de Ordenex (461: `origen_id` = el debito). */
const ORIGENES_DEL_COBRO = Prisma.join(["cobro_tienda", "cobro_tienda_completado"]);

const SELECT_FILA = { id: true, origenTipo: true, origenId: true } as const;

/**
 * FICHA 458-B (design §3.7, R58) — «Cómo quedó». SOLO queries. Las posiciones se comparan EN LA BASE
 * con la tupla `(fecha_movimiento, created_at, id)` de la fila de referencia: la misma ordenacion que
 * la ventana del estado de cuenta (§3.2) y que el libro de la caja. La contrapartida en el otro libro:
 * mismo origen y `created_at` mas cercano (ver la interfaz).
 */
export class ComoQuedoRepository implements IComoQuedoRepository {
  constructor(private readonly prisma: Cliente) {}

  async fila(libro: "caja" | "tienda" | "mensajero", id: string): Promise<FilaDeLibroComoQuedo | null> {
    if (libro === "caja") {
      const f = await this.prisma.walletMovimiento.findUnique({ where: { id }, select: SELECT_FILA });
      return f === null ? null : { ...f, cuentaId: null };
    }
    if (libro === "tienda") {
      const f = await this.prisma.walletTiendaMovimiento.findUnique({ where: { id }, select: { ...SELECT_FILA, tiendaId: true } });
      return f === null ? null : { id: f.id, origenTipo: f.origenTipo, origenId: f.origenId, cuentaId: f.tiendaId };
    }
    const f = await this.prisma.pagoMensajeroMovimiento.findUnique({ where: { id }, select: { ...SELECT_FILA, mensajeroId: true } });
    return f === null ? null : { id: f.id, origenTipo: f.origenTipo, origenId: f.origenId, cuentaId: f.mensajeroId };
  }

  async cajaDeFila(libro: "tienda" | "mensajero", filaId: string): Promise<string | null> {
    const ref =
      libro === "tienda"
        ? Prisma.sql`SELECT r.id, r.origen_tipo::text AS origen_tipo, r.origen_id, r.created_at FROM wallet_tienda_movimiento r WHERE r.id = ${filaId}`
        : Prisma.sql`SELECT r.id, r.origen_tipo::text AS origen_tipo, r.origen_id, r.created_at FROM pago_mensajero_movimiento r WHERE r.id = ${filaId}`;
    const delCobro = libro === "tienda" ? Prisma.sql`(m.origen_tipo::text IN (${ORIGENES_DEL_COBRO}) AND m.origen_id = ref.id)` : Prisma.sql`FALSE`;
    const filas = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH ref AS (${ref})
      SELECT m.id FROM wallet_movimiento m, ref
      WHERE (ref.origen_id IS NOT NULL AND m.origen_tipo::text = ref.origen_tipo AND m.origen_id = ref.origen_id)
         OR ${delCobro}
      ORDER BY abs(extract(epoch FROM (m.created_at - ref.created_at))), m.id
      LIMIT 1`;
    return filas[0]?.id ?? null;
  }

  async cuentasDeFilaCaja(cajaFilaId: string): Promise<CuentasDeOrigen> {
    const tiendas = await this.prisma.$queryRaw<{ tienda_id: string; id: string }[]>`
      WITH ref AS (
        SELECT r.origen_tipo::text AS origen_tipo, r.origen_id, r.created_at FROM wallet_movimiento r
        WHERE r.id = ${cajaFilaId} AND r.origen_id IS NOT NULL
      )
      SELECT DISTINCT ON (t.tienda_id) t.tienda_id, t.id
      FROM wallet_tienda_movimiento t, ref
      WHERE (t.origen_tipo::text = ref.origen_tipo AND t.origen_id = ref.origen_id)
         OR (ref.origen_tipo IN (${ORIGENES_DEL_COBRO}) AND t.id = ref.origen_id)
      ORDER BY t.tienda_id, abs(extract(epoch FROM (t.created_at - ref.created_at))), t.id`;
    const mensajeros = await this.prisma.$queryRaw<{ mensajero_id: string; id: string }[]>`
      WITH ref AS (
        SELECT r.origen_tipo::text AS origen_tipo, r.origen_id, r.created_at FROM wallet_movimiento r
        WHERE r.id = ${cajaFilaId} AND r.origen_id IS NOT NULL
      )
      SELECT DISTINCT ON (p.mensajero_id) p.mensajero_id, p.id
      FROM pago_mensajero_movimiento p, ref
      WHERE p.origen_tipo::text = ref.origen_tipo AND p.origen_id = ref.origen_id
      ORDER BY p.mensajero_id, abs(extract(epoch FROM (p.created_at - ref.created_at))), p.id`;
    return {
      tiendas: tiendas.map((t) => ({ tiendaId: t.tienda_id, filaId: t.id })),
      mensajeros: mensajeros.map((p) => ({ mensajeroId: p.mensajero_id, filaId: p.id })),
    };
  }

  async agregadoCajaHasta(cajaFilaId: string): Promise<readonly AgregadoCajaRow[]> {
    const filas = await this.prisma.$queryRaw<{ categoria: string; tipo: string; total: string }[]>`
      WITH ref AS (SELECT r.fecha_movimiento, r.created_at, r.id FROM wallet_movimiento r WHERE r.id = ${cajaFilaId})
      SELECT m.categoria::text AS categoria, m.tipo::text AS tipo, SUM(m.monto)::text AS total
      FROM wallet_movimiento m, ref
      WHERE (m.fecha_movimiento, m.created_at, m.id) <= (ref.fecha_movimiento, ref.created_at, ref.id)
      GROUP BY m.categoria, m.tipo`;
    return filas.map((f) => ({
      categoria: f.categoria as WalletMovimientoCategoria,
      tipo: f.tipo as WalletMovimientoTipo,
      total: new Prisma.Decimal(f.total).toFixed(2),
    }));
  }

  async saldoTiendaHasta(tiendaId: string, filaId: string): Promise<{ creditos: string; debitos: string }> {
    const [s] = await this.prisma.$queryRaw<{ creditos: string; debitos: string }[]>`
      WITH ref AS (SELECT r.fecha_movimiento, r.created_at, r.id FROM wallet_tienda_movimiento r WHERE r.id = ${filaId})
      SELECT COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'credito'), 0)::text AS creditos,
             COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'debito'), 0)::text AS debitos
      FROM wallet_tienda_movimiento m, ref
      WHERE m.tienda_id = ${tiendaId}
        AND (m.fecha_movimiento, m.created_at, m.id) <= (ref.fecha_movimiento, ref.created_at, ref.id)`;
    return { creditos: new Prisma.Decimal(s?.creditos ?? 0).toFixed(2), debitos: new Prisma.Decimal(s?.debitos ?? 0).toFixed(2) };
  }

  async cuentaMensajeroHasta(mensajeroId: string, filaId: string): Promise<{ devengado: string; pagado: string }> {
    const [s] = await this.prisma.$queryRaw<{ devengado: string; pagado: string }[]>`
      WITH ref AS (SELECT r.fecha_movimiento, r.created_at, r.id FROM pago_mensajero_movimiento r WHERE r.id = ${filaId})
      SELECT COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'devengo'), 0)::text AS devengado,
             COALESCE(SUM(m.monto) FILTER (WHERE m.tipo = 'pago'), 0)::text AS pagado
      FROM pago_mensajero_movimiento m, ref
      WHERE m.mensajero_id = ${mensajeroId}
        AND (m.fecha_movimiento, m.created_at, m.id) <= (ref.fecha_movimiento, ref.created_at, ref.id)`;
    return { devengado: new Prisma.Decimal(s?.devengado ?? 0).toFixed(2), pagado: new Prisma.Decimal(s?.pagado ?? 0).toFixed(2) };
  }
}
