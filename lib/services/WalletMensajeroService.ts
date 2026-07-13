import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  IWalletMensajeroService,
  ListarCuentasPorPagarServiceResult,
  ListarMisPagosServiceResult,
  ListarPagosDeMensajeroServiceResult,
  VerMiCuentaPorPagarServiceResult,
} from "@/lib/interfaces/services/IWalletMensajeroService";
import type {
  CuentaPorPagarResumenDTO,
  ListarPagosDeMensajeroInput,
  ListarPagosMensajeroInput,
} from "@/lib/types/wallet-mensajero";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";

// Roles autorizados (R18/R19/R20). El `mensajero` ve SOLO lo suyo (acotado a su usuarioId =
// mensajero_id en el WHERE del repo). El `maestro` ve las cuentas por pagar de TODOS los
// mensajeros. El adminSatelite NO ve (el pago a mensajeros es un egreso de la caja central del
// maestro, F1.4-Qe/A2).
const ROL_MENSAJERO = "mensajero";
const ROL_MAESTRO = "maestro";

/**
 * Feature 44 — logica de negocio de lectura del LIBRO del pago por mensajero. No conoce HTTP ni
 * Prisma directamente: recibe el repo por inyeccion. Guardias de rol (R18/R19/R20). INMUTABILIDAD
 * (R3): NO expone update/delete; una correccion es un ajuste compensatorio append-only. La cuenta
 * por pagar se DERIVA (R14), nunca se lee de un saldo almacenado. Money-safe: DTOs con montos
 * STRING.
 */
export class WalletMensajeroService implements IWalletMensajeroService {
  constructor(private readonly repo: IPagoMensajeroMovimientoRepository) {}

  async verMiCuentaPorPagar(actor: Actor): Promise<VerMiCuentaPorPagarServiceResult> {
    if (actor.rol !== ROL_MENSAJERO) return { status: "forbidden" }; // R20

    // R14/R20: cuenta por pagar total DERIVADA, acotada a SU mensajero_id (= actor.usuarioId).
    const { devengado, pagado } = await this.repo.agregarCuentaPorPagar(actor.usuarioId, {});
    return { status: "ok", cuenta: derivarCuentaPorPagar(devengado, pagado) };
  }

  async listarMisPagos(
    input: ListarPagosMensajeroInput,
    actor: Actor,
  ): Promise<ListarMisPagosServiceResult> {
    if (actor.rol !== ROL_MENSAJERO) return { status: "forbidden" }; // R20

    const filtros = {
      cierreId: input.cierreId,
      desde: input.desde,
      hasta: input.hasta,
    };

    // R20/R22: acotado a SU mensajero_id SIEMPRE en el WHERE (el repo lo aplica), filtros aparte.
    // El `mensajeroId` del input se IGNORA en la vista propia (nunca deja ver a otro mensajero).
    const [{ movimientos, total }, agg] = await Promise.all([
      this.repo.listarPorMensajero({
        mensajeroId: actor.usuarioId,
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
      }),
      this.repo.agregarCuentaPorPagar(actor.usuarioId, filtros),
    ]);

    return {
      status: "ok",
      data: {
        movimientos,
        total,
        page: input.page,
        pageSize: input.pageSize,
        // R22: la cuenta refleja el conjunto FILTRADO (mismos filtros que el listado).
        cuenta: derivarCuentaPorPagar(agg.devengado, agg.pagado),
      },
    };
  }

  async listarCuentasPorPagar(actor: Actor): Promise<ListarCuentasPorPagarServiceResult> {
    if (actor.rol !== ROL_MAESTRO) return { status: "forbidden" }; // R19

    const rows = await this.repo.listarCuentasPorPagarTodos();
    const mensajeros: CuentaPorPagarResumenDTO[] = rows.map((r) => {
      const c = derivarCuentaPorPagar(r.devengado, r.pagado);
      return {
        mensajeroId: r.mensajeroId,
        mensajeroNombre: r.mensajeroNombre,
        devengado: c.devengado,
        pagado: c.pagado,
        cuentaPorPagar: c.cuentaPorPagar,
        signo: c.signo,
      };
    });
    return { status: "ok", mensajeros };
  }

  async listarPagosDeMensajero(
    input: ListarPagosDeMensajeroInput,
    actor: Actor,
  ): Promise<ListarPagosDeMensajeroServiceResult> {
    if (actor.rol !== ROL_MAESTRO) return { status: "forbidden" }; // R19 (mismo gate que listarCuentasPorPagar)

    const filtros = {
      cierreId: input.cierreId,
      desde: input.desde,
      hasta: input.hasta,
    };

    // R18: el maestro elige el `mensajeroId` del INPUT (NO acotado a si mismo, a diferencia de
    // listarMisPagos). Desglose por cierre paginado (repo ordena fecha desc) + cuenta por pagar y
    // nombre del mensajero elegido. R22: la cuenta se agrega con los MISMOS filtros (conjunto
    // filtrado), aplicados en el WHERE por el repo.
    const [{ movimientos, total }, agg, mensajeroNombre] = await Promise.all([
      this.repo.listarPorMensajero({
        mensajeroId: input.mensajeroId,
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
      }),
      this.repo.agregarCuentaPorPagar(input.mensajeroId, filtros),
      this.repo.obtenerNombreMensajero(input.mensajeroId),
    ]);

    return {
      status: "ok",
      data: {
        mensajeroId: input.mensajeroId,
        mensajeroNombre: mensajeroNombre ?? "",
        movimientos,
        total,
        page: input.page,
        pageSize: input.pageSize,
        // R22: la cuenta refleja el conjunto FILTRADO (mismos filtros que el listado).
        cuenta: derivarCuentaPorPagar(agg.devengado, agg.pagado),
      },
    };
  }
}
