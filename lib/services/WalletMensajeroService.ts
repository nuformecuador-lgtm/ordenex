import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CuentaPorPagarFiltros,
  IPagoMensajeroMovimientoRepository,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  IWalletMensajeroService,
  ListarCuentasPorPagarCompletoServiceResult,
  ListarCuentasPorPagarPaginadoServiceResult,
  ListarCuentasPorPagarServiceResult,
  ListarPagosDeMensajeroCompletoServiceResult,
  ListarPagosDeMensajeroServiceResult,
} from "@/lib/interfaces/services/IWalletMensajeroService";
import type {
  CuentaPorPagarAgregadoRow,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type {
  CuentaPorPagarResumenDTO,
  ListarCuentasPorPagarCompletoInput,
  ListarCuentasPorPagarPaginadoInput,
  ListarPagosDeMensajeroCompletoInput,
  ListarPagosDeMensajeroInput,
} from "@/lib/types/wallet-mensajero";
import { descargaConfig } from "@/lib/config/descarga";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { rangoDePagina } from "@/lib/utils/rango-pagina";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Roles autorizados (R18/R19). El acceso total (maestro/admin) ve las cuentas por pagar de TODOS
// los mensajeros. El adminSatelite NO ve (el pago a mensajeros es un egreso de la caja central del
// maestro, F1.4-Qe/A2).
//
// Ficha 336 (2026-08-30): la vista PROPIA del mensajero (`verMiCuentaPorPagar`, `listarMisPagos`,
// `listarMisPagosCompleto`) se retiro con la pantalla `/mis-pagos`. Por eso ya no hay guardia por
// `rol === "mensajero"` en este servicio: todo lo que queda es lectura de administracion.

/**
 * Feature 44 — logica de negocio de lectura del LIBRO del pago por mensajero. No conoce HTTP ni
 * Prisma directamente: recibe el repo por inyeccion. Guardias de rol (R18/R19). INMUTABILIDAD
 * (R3): NO expone update/delete; una correccion es un ajuste compensatorio append-only. La cuenta
 * por pagar se DERIVA (R14), nunca se lee de un saldo almacenado. Money-safe: DTOs con montos
 * STRING.
 */
export class WalletMensajeroService implements IWalletMensajeroService {
  constructor(private readonly repo: IPagoMensajeroMovimientoRepository) {}

  /**
   * Feature 170 (T C.1, design §2.1) — los filtros del libro, en UN solo sitio.
   *
   * Es el `construirWhere` de este servicio: las lecturas del libro traducen la entrada con
   * este metodo, de modo que no puedan divergir. Nacio con CUATRO llamantes (T C.1); tras la
   * ficha 336, que retiro la vista propia del mensajero con `/mis-pagos`, le quedan DOS: el
   * desglose de un mensajero, paginado y completo.
   *
   * NO emite `mensajeroId`, y eso es deliberado: el acotamiento no es un filtro. Lo pone el
   * INPUT de la vista del maestro, y se escribe DESPUES de esparcir esto.
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

  /**
   * Feature 170 (T L.1) — la fila del listado del maestro, DERIVADA una sola vez.
   *
   * La escribian las dos lecturas de este listado (entera y paginada) y es dinero: la cuenta
   * por pagar se DERIVA con `derivarCuentaPorPagar` (R14), nunca se lee de un saldo
   * almacenado. Dos copias de esta proyeccion son dos oportunidades de que la pagina y el
   * dataset completo declaren montos distintos para el mismo mensajero.
   */
  private aResumen(r: CuentaPorPagarAgregadoRow): CuentaPorPagarResumenDTO {
    const c = derivarCuentaPorPagar(r.devengado, r.pagado);
    return {
      mensajeroId: r.mensajeroId,
      mensajeroNombre: r.mensajeroNombre,
      devengado: c.devengado,
      pagado: c.pagado,
      cuentaPorPagar: c.cuentaPorPagar,
      signo: c.signo,
    };
  }

  async listarCuentasPorPagar(actor: Actor): Promise<ListarCuentasPorPagarServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19

    const rows = await this.repo.listarCuentasPorPagarTodos();
    return { status: "ok", mensajeros: rows.map((r) => this.aResumen(r)) };
  }

  /**
   * Feature 170 — FASE 2 (T L.1, R40/R41/R45/R51) — el MISMO listado del maestro, en paginas y
   * con la busqueda por nombre resuelta en el SERVIDOR.
   *
   * El guard de rol va PRIMERO, antes de tocar el repositorio: si estuviera despues, la cuenta
   * por pagar de TODOS los mensajeros ya habria salido de la base aunque la respuesta fuera un
   * error. Es la misma decision, y por el mismo motivo, que en `listarSaldosTiendasPaginado`.
   *
   * `busqueda` es el UNICO dato de la peticion que llega al repositorio: nada del input toca
   * el alcance, que lo fija el rol del actor (R44). El repositorio filtra ANTES de recortar y
   * devuelve el total del conjunto filtrado, asi que la pagina y el total no pueden mirar
   * conjuntos distintos (R41).
   */
  async listarCuentasPorPagarPaginado(
    input: ListarCuentasPorPagarPaginadoInput,
    actor: Actor,
  ): Promise<ListarCuentasPorPagarPaginadoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19/R44

    const { items, total } = await this.repo.listarCuentasPorPagarPaginado(
      { busqueda: input.busqueda },
      rangoDePagina(input),
    );

    return {
      status: "ok",
      items: items.map((r) => this.aResumen(r)),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO filtrado, nunca `items.length`
    };
  }

  /**
   * Feature 170 — FASE 2 (T M.1, cierre de Q-L2) — el MISMO listado del maestro sin recorte por
   * pagina, para la descarga (R52).
   *
   * Lo que cierra: hasta hoy la pantalla paginada descargaba releyendo `listarCuentasPorPagar()`
   * —el listado ENTERO, sin busqueda— y volviendo a filtrarlo en el navegador. Funcionaba, pero
   * dejaba dos cosas que esta feature existe para evitar: el conjunto entero cruzando al cliente
   * en el momento de descargar, y el criterio de busqueda escrito dos veces, en dos capas (R45).
   * Aqui la busqueda la resuelve el repositorio con la MISMA linea que arma la pagina, asi que
   * la fila que la tabla enseña y la que el archivo trae no pueden discrepar (R11).
   *
   * El tope se evalua en el SERVIDOR (R29). Superarlo NO devuelve filas ni un dataset truncado:
   * devuelve el total encontrado y el tope vigente para que el control redacte el aviso
   * (R26/R27/R28). Aqui el conjunto se materializa entero antes de contarlo —es una agregacion
   * de todo el libro por mensajero, T L.1 §5— asi que el `N + 1` de R29 no aplica a la base;
   * lo que R29 gobierna en este listado es lo que se TRANSPORTA, y por encima del tope no se
   * transporta ni una fila.
   */
  async listarCuentasPorPagarCompleto(
    input: ListarCuentasPorPagarCompletoInput,
    actor: Actor,
  ): Promise<ListarCuentasPorPagarCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17/R19: mismo gate que la pagina

    const limite = descargaConfig.MAX_FILAS;
    const conjunto = await this.repo.listarCuentasPorPagarCompleto({
      busqueda: input.busqueda,
    });

    // R27/R28: o van TODAS las filas del conjunto filtrado, o va el error con los conteos.
    if (conjunto.length > limite) {
      return { status: "limite_excedido", total: conjunto.length, limite };
    }

    return {
      status: "ok",
      items: conjunto.map((r) => this.aResumen(r)), // el MISMO mapper que la pagina (dinero)
      total: conjunto.length,
    };
  }

  async listarPagosDeMensajero(
    input: ListarPagosDeMensajeroInput,
    actor: Actor,
  ): Promise<ListarPagosDeMensajeroServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19 (mismo gate que listarCuentasPorPagar)

    const filtros = this.construirFiltros(input);

    // R18: el maestro elige el `mensajeroId` del INPUT (NO acotado a si mismo, a diferencia de
    // la vista propia que la ficha 336 retiro). Desglose por cierre paginado (repo ordena fecha desc) + cuenta por pagar y
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
   * `mensajero` pueda pedirse a si mismo por esta via es justamente lo que el guard impide.
   * Su via propia era `listarMisPagosCompleto`, retirada por la ficha 336 con `/mis-pagos`.
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
