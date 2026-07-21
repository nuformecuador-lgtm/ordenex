import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  IWalletService,
  ListarMovimientosServiceResult,
  RegistrarMovimientoManualServiceResult,
  VerBalanceServiceResult,
} from "@/lib/interfaces/services/IWalletService";
import type {
  ListarMovimientosInput,
  RegistrarMovimientoManualInput,
} from "@/lib/types/wallet";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Roles autorizados (R19): acceso total (maestro/admin, dueños de la caja central). Cualquier
// otro rol -> forbidden SIN exponer movimientos ni balance.

/**
 * Feature 42 — logica de negocio de la wallet (libro + balance + manual). No conoce HTTP
 * ni Prisma directamente: recibe el repo por inyeccion. Guardia de rol maestro (R19).
 * INMUTABILIDAD (R3): NO expone update/delete; una correccion es un movimiento manual de
 * ajuste compensatorio (registrarMovimientoManual). Money-safe: DTOs con montos STRING.
 */
export class WalletService implements IWalletService {
  constructor(
    private readonly repo: IWalletMovimientoRepository,
    // Cliente de escritura para el movimiento manual (fuera de una tx de cierre): el
    // repo acepta cualquier WalletTxClient; aqui inyectamos el PrismaClient completo.
    private readonly writeClient: WalletTxClient,
  ) {}

  async listarMovimientos(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<ListarMovimientosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19

    const { movimientos, total } = await this.repo.listar({
      page: input.page,
      pageSize: input.pageSize,
      tipo: input.tipo,
      categoria: input.categoria,
      desde: input.desde,
      hasta: input.hasta,
    });
    return {
      status: "ok",
      data: { movimientos, total, page: input.page, pageSize: input.pageSize },
    };
  }

  async verBalance(input: ListarMovimientosInput, actor: Actor): Promise<VerBalanceServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19

    // R16: balance DERIVADO del conjunto filtrado (mismos filtros que el listado), nunca
    // de un saldo almacenado.
    const { ingresos, egresos } = await this.repo.agregarBalance({
      tipo: input.tipo,
      categoria: input.categoria,
      desde: input.desde,
      hasta: input.hasta,
    });
    return { status: "ok", balance: derivarBalance(ingresos, egresos) };
  }

  async registrarMovimientoManual(
    input: RegistrarMovimientoManualInput,
    actor: Actor,
  ): Promise<RegistrarMovimientoManualServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19

    // R15/Q6: manual = origen_tipo manual, origen_id NULL, registrado_por = actor, monto
    // > 0, descripcion obligatoria (ya validado por zod en el borde; se persiste como
    // fila INMUTABLE, R3). El repo NO expone update/delete: la correccion es otro ajuste.
    await this.repo.crearMovimientos(this.writeClient, [
      {
        tipo: input.tipo,
        categoria: input.categoria,
        monto: input.monto,
        origenTipo: "manual",
        origenId: null, // fuera del indice unico parcial: los manuales no se deduplican
        descripcion: input.descripcion,
        registradoPor: actor.usuarioId,
      },
    ]);

    // Devuelve el movimiento recien creado (el manual no se deduplica, siempre se inserta).
    // Se relee el mas reciente del actor para exponer id/fecha reales.
    const { movimientos } = await this.repo.listar({
      page: 1,
      pageSize: 1,
      tipo: input.tipo,
      categoria: input.categoria,
    });
    const movimiento = movimientos[0];
    return { status: "ok", movimiento };
  }
}
