import type { PrismaClient } from "@prisma/client";

import type {
  AbonoDeOrigen,
  CierreDeOrigen,
  IOrigenLegibleRepository,
  MovimientoTiendaDeOrigen,
  OrdenDeOrigen,
  PagoDeOrigen,
  PagoPorCuentaDeOrigen,
  PodioDeOrigen,
} from "@/lib/interfaces/repositories/IOrigenLegibleRepository";
import { CUENTA_USUARIO_SELECT, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";

type OrigenPrismaClient = Pick<
  PrismaClient,
  | "cierreDia"
  | "gestionOrden"
  | "ordenIncidente"
  | "liquidacionPago"
  | "rankingSnapshotFila"
  | "pagoPorCuentaTienda"
  | "abonoTienda"
  | "walletTiendaMovimiento"
>;

const ORDEN_SELECT = { numGuia: true, numRemision: true } as const;

/** `@db.Date` (medianoche UTC, convencion 172) → su dia `YYYY-MM-DD` tal cual. */
function dia(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function guiaDe(orden: { numGuia: number | null; numRemision: string } | null): {
  guia: string | null;
  remision: string | null;
} {
  if (orden === null) return { guia: null, remision: null };
  const remision = orden.numRemision.trim();
  return {
    guia: orden.numGuia === null ? null : String(orden.numGuia),
    remision: remision === "" ? null : remision,
  };
}

/**
 * Ficha 458-A (TA.2, design §3.3) — las lecturas de la entidad de origen, UNA consulta por tipo
 * (`WHERE id IN (...)`). Solo ejecuta Prisma: la composicion del texto y el enlace viven en
 * `OrigenLegibleService`. Nada de importes: solo nombres, dias, metodos y guias.
 */
export class OrigenLegibleRepository implements IOrigenLegibleRepository {
  constructor(private readonly prisma: OrigenPrismaClient) {}

  async cierres(ids: readonly string[]): Promise<CierreDeOrigen[]> {
    const filas = await this.prisma.cierreDia.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, solicitadoAt: true, mensajero: { select: CUENTA_USUARIO_SELECT } },
    });
    return filas.map((f) => ({
      id: f.id,
      solicitadoAt: f.solicitadoAt.toISOString(),
      mensajero: etiquetaDeCuenta(f.mensajero),
    }));
  }

  async gestiones(ids: readonly string[]): Promise<OrdenDeOrigen[]> {
    const filas = await this.prisma.gestionOrden.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, orden: { select: ORDEN_SELECT } },
    });
    return filas.map((f) => ({ id: f.id, ...guiaDe(f.orden) }));
  }

  async incidentes(ids: readonly string[]): Promise<OrdenDeOrigen[]> {
    const filas = await this.prisma.ordenIncidente.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, orden: { select: ORDEN_SELECT } },
    });
    return filas.map((f) => ({ id: f.id, ...guiaDe(f.orden) }));
  }

  async pagos(ids: readonly string[]): Promise<PagoDeOrigen[]> {
    const filas = await this.prisma.liquidacionPago.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        fechaPago: true,
        metodo: true,
        mensajero: { select: CUENTA_USUARIO_SELECT },
        tienda: { select: CUENTA_USUARIO_SELECT },
      },
    });
    return filas.map((f) => ({
      id: f.id,
      fechaPago: dia(f.fechaPago),
      metodo: f.metodo,
      beneficiario: etiquetaDeCuenta(f.mensajero ?? f.tienda),
    }));
  }

  async podios(ids: readonly string[]): Promise<PodioDeOrigen[]> {
    const filas = await this.prisma.rankingSnapshotFila.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, snapshot: { select: { fecha: true } } },
    });
    return filas.map((f) => ({ id: f.id, fecha: dia(f.snapshot.fecha) }));
  }

  async pagosPorCuenta(ids: readonly string[]): Promise<PagoPorCuentaDeOrigen[]> {
    const filas = await this.prisma.pagoPorCuentaTienda.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, beneficiario: true, tienda: { select: CUENTA_USUARIO_SELECT } },
    });
    return filas.map((f) => ({
      id: f.id,
      tienda: etiquetaDeCuenta(f.tienda),
      beneficiario: f.beneficiario,
    }));
  }

  async abonos(ids: readonly string[]): Promise<AbonoDeOrigen[]> {
    const filas = await this.prisma.abonoTienda.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fechaPago: true, metodo: true, tienda: { select: CUENTA_USUARIO_SELECT } },
    });
    return filas.map((f) => ({
      id: f.id,
      tienda: etiquetaDeCuenta(f.tienda),
      fechaPago: dia(f.fechaPago),
      metodo: f.metodo,
    }));
  }

  async movimientosTienda(ids: readonly string[]): Promise<MovimientoTiendaDeOrigen[]> {
    const filas = await this.prisma.walletTiendaMovimiento.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, tienda: { select: CUENTA_USUARIO_SELECT } },
    });
    return filas.map((f) => ({ id: f.id, tienda: etiquetaDeCuenta(f.tienda) }));
  }
}
