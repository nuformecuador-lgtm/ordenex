import type { PrismaClient } from "@prisma/client";

import type {
  ComprobanteGuardado,
  DestinoLateral,
  DocumentoConComprobantePropio,
  DuenoDeDestino,
  IWalletComprobanteRepository,
  ObjetoComprobante,
  WalletComprobanteTxClient,
} from "@/lib/interfaces/repositories/IWalletComprobanteRepository";

type Cliente = Pick<
  PrismaClient,
  | "walletComprobante"
  | "walletMovimiento"
  | "walletTiendaMovimiento"
  | "liquidacionPago"
  | "pagoPorCuentaTienda"
  | "aporteCapital"
  | "abonoTienda"
>;

/** La columna del UNIQUE de cada destino (R79). */
function columnaDe(destino: DestinoLateral):
  | { cajaMovimientoId: string }
  | { tiendaMovimientoId: string }
  | { liquidacionPagoId: string } {
  if ("caja" in destino) return { cajaMovimientoId: destino.caja };
  if ("tienda" in destino) return { tiendaMovimientoId: destino.tienda };
  return { liquidacionPagoId: destino.pago };
}

function objeto(path: string | null, contentType: string | null): ObjetoComprobante | null {
  return path === null || contentType === null ? null : { storagePath: path, contentType };
}

/**
 * FICHA 458-B (design §4.1, D12, R74–R80) — `wallet_comprobante` y las lecturas del alcance. SOLO
 * queries: la regla (quien puede, que destino admite comprobante) vive en `WalletComprobanteService`.
 */
export class WalletComprobanteRepository implements IWalletComprobanteRepository {
  constructor(private readonly prisma: Cliente) {}

  async crear(
    tx: WalletComprobanteTxClient,
    destino: DestinoLateral,
    comprobante: ComprobanteGuardado & { subidoPor: string },
  ): Promise<"creado" | "ya_tiene"> {
    // R79: el UNIQUE del destino decide. `skipDuplicates` ⇒ `count = 0` es «ya tenia uno».
    const r = await tx.walletComprobante.createMany({
      data: [
        {
          ...columnaDe(destino),
          storagePath: comprobante.storagePath,
          contentType: comprobante.contentType,
          subidoPor: comprobante.subidoPor,
        },
      ],
      skipDuplicates: true,
    });
    return r.count === 1 ? "creado" : "ya_tiene";
  }

  async lateralDe(destino: DestinoLateral): Promise<ObjetoComprobante | null> {
    const fila = await this.prisma.walletComprobante.findFirst({
      where: columnaDe(destino),
      select: { storagePath: true, contentType: true },
    });
    return fila === null ? null : objeto(fila.storagePath, fila.contentType);
  }

  async duenoDeLateral(destino: DestinoLateral): Promise<DuenoDeDestino | null> {
    if ("caja" in destino) {
      const f = await this.prisma.walletMovimiento.findUnique({
        where: { id: destino.caja },
        select: { categoria: true, fechaMovimiento: true },
      });
      return f === null ? null : { tiendaId: null, categoria: f.categoria, fecha: f.fechaMovimiento };
    }
    if ("tienda" in destino) {
      const f = await this.prisma.walletTiendaMovimiento.findUnique({
        where: { id: destino.tienda },
        select: { tiendaId: true, categoria: true, fechaMovimiento: true },
      });
      return f === null ? null : { tiendaId: f.tiendaId, categoria: f.categoria, fecha: f.fechaMovimiento };
    }
    const p = await this.prisma.liquidacionPago.findUnique({
      where: { id: destino.pago },
      select: { tiendaId: true, fechaPago: true },
    });
    return p === null ? null : { tiendaId: p.tiendaId, categoria: "liquidacion_pago", fecha: p.fechaPago };
  }

  async documento(
    tipo: DocumentoConComprobantePropio,
    id: string,
  ): Promise<(DuenoDeDestino & { comprobante: ObjetoComprobante | null }) | null> {
    switch (tipo) {
      case "pago_por_cuenta_tienda": {
        const d = await this.prisma.pagoPorCuentaTienda.findUnique({
          where: { id },
          select: { tiendaId: true, fechaPago: true, comprobantePath: true, comprobanteContentType: true },
        });
        return d === null
          ? null
          : { tiendaId: d.tiendaId, categoria: tipo, fecha: d.fechaPago, comprobante: objeto(d.comprobantePath, d.comprobanteContentType) };
      }
      case "abono_tienda": {
        const d = await this.prisma.abonoTienda.findUnique({
          where: { id },
          select: { tiendaId: true, fechaPago: true, comprobantePath: true, comprobanteContentType: true },
        });
        return d === null
          ? null
          : { tiendaId: d.tiendaId, categoria: tipo, fecha: d.fechaPago, comprobante: objeto(d.comprobantePath, d.comprobanteContentType) };
      }
      case "aporte_capital": {
        const d = await this.prisma.aporteCapital.findUnique({
          where: { id },
          select: { fecha: true, comprobantePath: true, comprobanteContentType: true },
        });
        return d === null
          ? null
          : { tiendaId: null, categoria: tipo, fecha: d.fecha, comprobante: objeto(d.comprobantePath, d.comprobanteContentType) };
      }
    }
  }

  async tiendaDeFila(movimientoId: string): Promise<string | null> {
    const f = await this.prisma.walletTiendaMovimiento.findUnique({
      where: { id: movimientoId },
      select: { tiendaId: true },
    });
    return f?.tiendaId ?? null;
  }
}
