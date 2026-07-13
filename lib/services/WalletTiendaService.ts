import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  IWalletTiendaService,
  ListarMisMovimientosServiceResult,
  ListarSaldosTiendasServiceResult,
  VerMiSaldoServiceResult,
} from "@/lib/interfaces/services/IWalletTiendaService";
import type { ListarMovimientosTiendaInput, SaldoTiendaResumenDTO } from "@/lib/types/wallet-tienda";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

// Roles autorizados (R19/R20). El `adminTienda` ES la tienda: su usuarioId = tienda_id, y solo
// ve lo suyo (acotado en el WHERE del repo). El `maestro` ve el saldo de TODAS las tiendas.
const ROL_TIENDA = "adminTienda";
const ROL_MAESTRO = "maestro";

/**
 * Feature 43 — logica de negocio de lectura del ledger POR TIENDA. No conoce HTTP ni Prisma
 * directamente: recibe el repo por inyeccion. Guardias de rol (R19/R20). INMUTABILIDAD (R3):
 * NO expone update/delete; una correccion es un ajuste compensatorio append-only. El saldo se
 * DERIVA (R16), nunca se lee de un saldo almacenado. Money-safe: DTOs con montos STRING.
 */
export class WalletTiendaService implements IWalletTiendaService {
  constructor(private readonly repo: IWalletTiendaMovimientoRepository) {}

  async verMiSaldo(actor: Actor): Promise<VerMiSaldoServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R19

    // R16/R19: saldo total DERIVADO, acotado a SU tienda_id (= actor.usuarioId) en el WHERE.
    const { creditos, debitos } = await this.repo.agregarSaldoPorTienda(actor.usuarioId, {});
    return { status: "ok", saldo: derivarSaldoTienda(creditos, debitos) };
  }

  async listarMisMovimientos(
    input: ListarMovimientosTiendaInput,
    actor: Actor,
  ): Promise<ListarMisMovimientosServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R19

    const filtros = {
      cierreId: input.cierreId,
      categoria: input.categoria,
      desde: input.desde,
      hasta: input.hasta,
    };

    // R19/R22: acotado a SU tienda_id SIEMPRE en el WHERE (el repo lo aplica), filtros aparte.
    const [{ movimientos, total }, saldoAgg] = await Promise.all([
      this.repo.listarPorTienda({
        tiendaId: actor.usuarioId,
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
      }),
      this.repo.agregarSaldoPorTienda(actor.usuarioId, filtros),
    ]);

    return {
      status: "ok",
      data: {
        movimientos,
        total,
        page: input.page,
        pageSize: input.pageSize,
        // R22: el saldo refleja el conjunto FILTRADO (mismos filtros que el listado).
        saldo: derivarSaldoTienda(saldoAgg.creditos, saldoAgg.debitos),
      },
    };
  }

  async listarSaldosTiendas(actor: Actor): Promise<ListarSaldosTiendasServiceResult> {
    if (actor.rol !== ROL_MAESTRO) return { status: "forbidden" }; // R20

    const rows = await this.repo.listarSaldosTodasTiendas();
    const tiendas: SaldoTiendaResumenDTO[] = rows.map((r) => {
      const s = derivarSaldoTienda(r.creditos, r.debitos);
      return { tiendaId: r.tiendaId, tiendaNombre: r.tiendaNombre, saldo: s.saldo, signo: s.signo };
    });
    return { status: "ok", tiendas };
  }
}
