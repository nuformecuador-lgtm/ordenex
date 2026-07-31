import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletTiendaMovimientoRepository,
  SaldoTiendaFiltros,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  IWalletTiendaService,
  ListarMisMovimientosCompletoServiceResult,
  ListarMisMovimientosServiceResult,
  ListarSaldosTiendasServiceResult,
  VerMiSaldoServiceResult,
} from "@/lib/interfaces/services/IWalletTiendaService";
import type {
  ListarMovimientosTiendaCompletoInput,
  ListarMovimientosTiendaInput,
  SaldoTiendaResumenDTO,
} from "@/lib/types/wallet-tienda";
import { descargaConfig } from "@/lib/config/descarga";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Roles autorizados (R19/R20). El `adminTienda` ES la tienda: su usuarioId = tienda_id, y solo
// ve lo suyo (acotado en el WHERE del repo). El acceso total (maestro/admin) ve el saldo de
// TODAS las tiendas.
const ROL_TIENDA = "adminTienda";

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

  /**
   * Feature 170 (T C.1, design §2.1) — los filtros del desglose, en UN solo sitio.
   *
   * Es el `construirWhere` de este servicio: el listado paginado y la descarga del dataset
   * completo traducen la entrada con este metodo, de modo que no puedan divergir. Se extrae
   * SIN cambio de comportamiento (las mismas cuatro claves).
   *
   * NO emite `tiendaId`, y eso es deliberado: el acotamiento por rol NO es un filtro. Lo
   * pone quien conoce al actor, y se escribe DESPUES de esparcir esto (ver mas abajo).
   */
  private construirFiltros(input: ListarMovimientosTiendaCompletoInput): SaldoTiendaFiltros {
    return {
      cierreId: input.cierreId,
      categoria: input.categoria,
      desde: input.desde,
      hasta: input.hasta,
    };
  }

  async listarMisMovimientos(
    input: ListarMovimientosTiendaInput,
    actor: Actor,
  ): Promise<ListarMisMovimientosServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R19

    const filtros = this.construirFiltros(input);

    // R19/R22: acotado a SU tienda_id SIEMPRE en el WHERE (el repo lo aplica), filtros aparte.
    const [{ movimientos, total }, saldoAgg] = await Promise.all([
      this.repo.listarPorTienda({
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
        tiendaId: actor.usuarioId, // AL FINAL (feature 170/R15): nada lo puede pisar
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

  /**
   * Feature 170 (T C.1, R9/R14/R15) — el MISMO ledger sin recorte por pagina, para la
   * descarga.
   *
   * PUNTO CALIENTE de la feature. Aqui el alcance no lo define el ROL sino un DATO del
   * actor: `adminTienda` ES la tienda, su `usuarioId` ES el `tienda_id`. Un fallo en esta
   * linea no devuelve menos filas de la cuenta: devuelve el ledger de OTRA tienda dentro de
   * un `xlsx` descargable. Por eso el acotamiento se escribe AL FINAL del objeto que va al
   * repositorio, DESPUES de esparcir los filtros: aunque manana `construirFiltros` llegara
   * a emitir un `tiendaId` —o alguien anadiera un spread nuevo encima—, esta linea lo pisa.
   * Es el mismo recurso que usa `OrdenService.construirWhere` con `adminTienda`.
   *
   * A eso se suman dos cierres independientes de la misma fuga: el schema `.strict()` del
   * borde rechaza un `tiendaId` inyectado antes de llegar aqui (R18), y `construirFiltros`
   * lee claves EXPLICITAS, asi que ninguna clave desconocida llega al repositorio (R15).
   *
   * El SALDO agregado NO se recalcula: es dato de cabecera de la pantalla, no del archivo.
   * Pedirlo aqui seria una consulta de mas por descarga, sin columna que la use.
   */
  async listarMisMovimientosCompleto(
    input: ListarMovimientosTiendaCompletoInput,
    actor: Actor,
  ): Promise<ListarMisMovimientosCompletoServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R17

    const limite = descargaConfig.MAX_FILAS;

    // R29: `page: 1` + `pageSize: limite + 1` es `skip 0, take N+1` en el repositorio.
    const { movimientos, total } = await this.repo.listarPorTienda({
      ...this.construirFiltros(input),
      page: 1,
      pageSize: limite + 1,
      tiendaId: actor.usuarioId, // AL FINAL (R15): el acotamiento por rol tiene la ultima palabra
    });

    // R27/R28: o van TODOS los movimientos de la tienda, o va el error accionable.
    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items: movimientos, total };
  }

  async listarSaldosTiendas(actor: Actor): Promise<ListarSaldosTiendasServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R20

    const rows = await this.repo.listarSaldosTodasTiendas();
    const tiendas: SaldoTiendaResumenDTO[] = rows.map((r) => {
      const s = derivarSaldoTienda(r.creditos, r.debitos);
      return { tiendaId: r.tiendaId, tiendaNombre: r.tiendaNombre, saldo: s.saldo, signo: s.signo };
    });
    return { status: "ok", tiendas };
  }
}
