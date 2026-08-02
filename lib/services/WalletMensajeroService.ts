import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CuentaPorPagarFiltros,
  IPagoMensajeroMovimientoRepository,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  IWalletMensajeroService,
  ListarCuentasPorPagarServiceResult,
  ListarMisPagosCompletoServiceResult,
  ListarMisPagosServiceResult,
  ListarPagosDeMensajeroCompletoServiceResult,
  ListarPagosDeMensajeroServiceResult,
  VerMiCuentaPorPagarServiceResult,
} from "@/lib/interfaces/services/IWalletMensajeroService";
import type {
  CuentaPorPagarResumenDTO,
  ListarMisPagosCompletoInput,
  ListarPagosDeMensajeroCompletoInput,
  ListarPagosDeMensajeroInput,
  ListarPagosMensajeroInput,
} from "@/lib/types/wallet-mensajero";
import { descargaConfig } from "@/lib/config/descarga";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Roles autorizados (R18/R19/R20). El `mensajero` ve SOLO lo suyo (acotado a su usuarioId =
// mensajero_id en el WHERE del repo). El acceso total (maestro/admin) ve las cuentas por pagar
// de TODOS los mensajeros. El adminSatelite NO ve (el pago a mensajeros es un egreso de la caja
// central del maestro, F1.4-Qe/A2).
const ROL_MENSAJERO = "mensajero";

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

  /**
   * Feature 170 (T C.1, design §2.1) — los filtros del libro, en UN solo sitio.
   *
   * Es el `construirWhere` de este servicio: las CUATRO lecturas del libro (mis pagos
   * paginado, mis pagos completo, desglose de un mensajero paginado y completo) traducen la
   * entrada con este metodo, de modo que no puedan divergir. Se extrae SIN cambio de
   * comportamiento (las mismas tres claves).
   *
   * NO emite `mensajeroId`, y eso es deliberado: el acotamiento no es un filtro. En la vista
   * propia lo pone el ACTOR y en la del maestro lo pone el INPUT; en ambos casos se escribe
   * DESPUES de esparcir esto.
   */
  private construirFiltros(input: {
    cierreId?: string;
    desde?: Date;
    hasta?: Date;
  }): CuentaPorPagarFiltros {
    return {
      cierreId: input.cierreId,
      desde: input.desde,
      hasta: input.hasta,
    };
  }

  async listarMisPagos(
    input: ListarPagosMensajeroInput,
    actor: Actor,
  ): Promise<ListarMisPagosServiceResult> {
    if (actor.rol !== ROL_MENSAJERO) return { status: "forbidden" }; // R20

    const filtros = this.construirFiltros(input);

    // R20/R22: acotado a SU mensajero_id SIEMPRE en el WHERE (el repo lo aplica), filtros aparte.
    // El `mensajeroId` del input se IGNORA en la vista propia (nunca deja ver a otro mensajero).
    const [{ movimientos, total }, agg] = await Promise.all([
      this.repo.listarPorMensajero({
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
        mensajeroId: actor.usuarioId, // AL FINAL (feature 170/R15): nada lo puede pisar
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

  /**
   * Feature 170 (T C.1, R9/R14/R15) — los MISMOS pagos propios sin recorte por pagina, para
   * la descarga.
   *
   * PUNTO CALIENTE de la feature, junto al ledger de la tienda. El alcance no lo define el
   * ROL sino un DATO del actor: el `usuarioId` del mensajero ES su `mensajero_id`. Un fallo
   * en esta linea entrega en un `xlsx` los pagos de OTRO mensajero — dinero ajeno, con
   * nombre y fecha. Por eso el acotamiento se escribe AL FINAL, DESPUES de esparcir los
   * filtros: aunque manana `construirFiltros` emitiera un `mensajeroId`, esta linea lo pisa.
   *
   * El `mensajeroId` del INPUT se ignora aqui exactamente igual que en `listarMisPagos`: el
   * schema lo admite por paridad con el listado, pero este metodo no lo lee jamas (R15).
   *
   * La CUENTA POR PAGAR agregada no se recalcula: es dato de cabecera de la pantalla, no del
   * archivo. Pedirla aqui seria una consulta de mas por descarga, sin columna que la use.
   */
  async listarMisPagosCompleto(
    input: ListarMisPagosCompletoInput,
    actor: Actor,
  ): Promise<ListarMisPagosCompletoServiceResult> {
    if (actor.rol !== ROL_MENSAJERO) return { status: "forbidden" }; // R17

    const limite = descargaConfig.MAX_FILAS;

    // R29: `page: 1` + `pageSize: limite + 1` es `skip 0, take N+1` en el repositorio.
    const { movimientos, total } = await this.repo.listarPorMensajero({
      ...this.construirFiltros(input),
      page: 1,
      pageSize: limite + 1,
      mensajeroId: actor.usuarioId, // AL FINAL (R15): el acotamiento tiene la ultima palabra
    });

    // R27/R28: o van TODOS sus movimientos, o va el error accionable con los conteos.
    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items: movimientos, total };
  }

  async listarCuentasPorPagar(actor: Actor): Promise<ListarCuentasPorPagarServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19

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
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19 (mismo gate que listarCuentasPorPagar)

    const filtros = this.construirFiltros(input);

    // R18: el maestro elige el `mensajeroId` del INPUT (NO acotado a si mismo, a diferencia de
    // listarMisPagos). Desglose por cierre paginado (repo ordena fecha desc) + cuenta por pagar y
    // nombre del mensajero elegido. R22: la cuenta se agrega con los MISMOS filtros (conjunto
    // filtrado), aplicados en el WHERE por el repo.
    const [{ movimientos, total }, agg, mensajeroNombre] = await Promise.all([
      this.repo.listarPorMensajero({
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
        mensajeroId: input.mensajeroId, // AL FINAL (feature 170): misma forma que la vista propia
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

  /**
   * Feature 170 (T C.1, R9) — el MISMO desglose de UN mensajero sin recorte por pagina, para
   * la descarga.
   *
   * Aqui el alcance NO es un dato del actor sino su ROL: el guard es el MISMO `esAccesoTotal`
   * que usa `listarPagosDeMensajero`, evaluado antes de tocar la base (R17). Que un
   * `mensajero` pueda pedirse a si mismo por esta via es justamente lo que el guard impide:
   * su superficie es `listarMisPagosCompleto`, que ignora el `mensajeroId` del input.
   *
   * Ni el NOMBRE del mensajero ni la cuenta por pagar se releen: son cabecera de pantalla, no
   * columnas del archivo. Dos consultas menos por descarga.
   */
  async listarPagosDeMensajeroCompleto(
    input: ListarPagosDeMensajeroCompletoInput,
    actor: Actor,
  ): Promise<ListarPagosDeMensajeroCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    const limite = descargaConfig.MAX_FILAS;

    // R29: `page: 1` + `pageSize: limite + 1` es `skip 0, take N+1` en el repositorio.
    const { movimientos, total } = await this.repo.listarPorMensajero({
      ...this.construirFiltros(input),
      page: 1,
      pageSize: limite + 1,
      mensajeroId: input.mensajeroId, // AL FINAL: misma forma que la vista propia
    });

    // R27/R28: o van TODOS los movimientos del mensajero elegido, o va el error accionable.
    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items: movimientos, total };
  }
}
