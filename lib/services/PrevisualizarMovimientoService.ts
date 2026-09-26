import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IPrevisualizarMovimientoService,
  PrevisualizarMovimientoServiceResult,
} from "@/lib/interfaces/services/IPrevisualizarMovimientoService";
import type { LectorSaldoInicial } from "@/lib/interfaces/services/IWalletService";
import type { PrevisualizarMovimientoInput } from "@/lib/types/efecto-movimiento";
import { EFECTO_POR_TIPO, efectoDeMovimiento, type EstadoActualParaEfecto } from "@/lib/utils/efecto-movimiento";

const ROL_TIENDA = "adminTienda";

/**
 * FICHA 458-B (design §4.4, R44–R47, R82) — «Así queda». Lee lo de HOY sin filtros (el agregado de la
 * caja, si hay saldo inicial vigente, el primer dia, y el saldo de la cuenta si el concepto la lleva)
 * y delega TODA la cuenta en `efectoDeMovimiento` (pura, sobre `derivarCaja`). No escribe nada.
 */
export class PrevisualizarMovimientoService implements IPrevisualizarMovimientoService {
  constructor(
    private readonly caja: Pick<IWalletMovimientoRepository, "agregarPorCategoriaYTipo" | "primerDiaDeLaCaja">,
    private readonly saldoInicial: LectorSaldoInicial,
    private readonly tiendas: Pick<IWalletTiendaMovimientoRepository, "agregarSaldoPorTienda">,
    private readonly usuarios: Pick<IUserRepository, "obtenerCuentaTienda">,
    private readonly mensajeros: Pick<IPagoMensajeroMovimientoRepository, "agregarCuentaPorPagar" | "obtenerNombreMensajero">,
  ) {}

  async previsualizar(
    input: PrevisualizarMovimientoInput,
    actor: Actor,
  ): Promise<PrevisualizarMovimientoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R82: antes de leer

    const pide = EFECTO_POR_TIPO[input.concepto].cuenta;
    if (pide !== null && input.cuentaId === undefined) {
      return { status: "validation_error", fieldErrors: { cuentaId: ["Elija la cuenta."] } };
    }

    let cuenta: EstadoActualParaEfecto["cuenta"] = null;
    if (pide === "tienda") {
      const tiendaId = input.cuentaId as string;
      const c = await this.usuarios.obtenerCuentaTienda(tiendaId);
      if (c === null || c.rol !== ROL_TIENDA) return { status: "no_encontrado" };
      const agregado = await this.tiendas.agregarSaldoPorTienda(tiendaId, {});
      cuenta = { tipo: "tienda", creditos: agregado.creditos, debitos: agregado.debitos };
    } else if (pide === "mensajero") {
      const mensajeroId = input.cuentaId as string;
      if ((await this.mensajeros.obtenerNombreMensajero(mensajeroId)) === null) return { status: "no_encontrado" };
      const agregado = await this.mensajeros.agregarCuentaPorPagar(mensajeroId, {});
      cuenta = { tipo: "mensajero", devengado: agregado.devengado, pagado: agregado.pagado };
    }

    const actual: EstadoActualParaEfecto = {
      caja: await this.caja.agregarPorCategoriaYTipo({}),
      haySaldoInicialVigente: await this.saldoInicial.haySaldoInicialVigente(),
      primerDia: await this.caja.primerDiaDeLaCaja(),
      cuenta,
    };
    return { status: "ok", efecto: efectoDeMovimiento(input.concepto, input.monto, actual) };
  }
}
