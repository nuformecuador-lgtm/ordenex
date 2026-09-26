import type { PrismaClient } from "@prisma/client";

import type {
  FilaDeLibroParaAnular,
  FilaDeMensajeroParaAnular,
  IWalletAnulacionDestinoRepository,
} from "@/lib/interfaces/repositories/IWalletAnulacionDestinoRepository";

type Cliente = Pick<
  PrismaClient,
  "walletMovimiento" | "walletTiendaMovimiento" | "pagoMensajeroMovimiento" | "rechazoTiendaCobro" | "rankingSnapshotFila"
>;

const SELECT_FILA = { id: true, tipo: true, categoria: true, origenTipo: true, origenId: true } as const;

/**
 * FICHA 458-B (design §4.2) — las lecturas con las que la accion unica decide el camino de una
 * anulacion. SOLO queries, por clave primaria o unica.
 */
export class WalletAnulacionDestinoRepository implements IWalletAnulacionDestinoRepository {
  constructor(private readonly prisma: Cliente) {}

  async filaDeCaja(id: string): Promise<FilaDeLibroParaAnular | null> {
    return this.prisma.walletMovimiento.findUnique({ where: { id }, select: SELECT_FILA });
  }

  async filaDeTienda(id: string): Promise<FilaDeLibroParaAnular | null> {
    return this.prisma.walletTiendaMovimiento.findUnique({ where: { id }, select: SELECT_FILA });
  }

  async filaDeMensajero(id: string): Promise<FilaDeMensajeroParaAnular | null> {
    return this.prisma.pagoMensajeroMovimiento.findUnique({
      where: { id },
      select: { ...SELECT_FILA, mensajeroId: true, premioDia: true },
    });
  }

  async cobroRechazoDeGestion(gestionId: string): Promise<string | null> {
    const cobro = await this.prisma.rechazoTiendaCobro.findUnique({
      where: { gestionId },
      select: { id: true },
    });
    return cobro?.id ?? null;
  }

  async filaDelPodio(mensajeroId: string, premioDia: Date): Promise<string | null> {
    const fila = await this.prisma.rankingSnapshotFila.findFirst({
      where: { mensajeroId, snapshot: { fecha: premioDia } },
      select: { id: true },
    });
    return fila?.id ?? null;
  }
}
