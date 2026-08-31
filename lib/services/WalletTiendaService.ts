import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  IWalletTiendaMovimientoRepository,
  SaldoTiendaAgregadoRow,
  SaldoTiendaFiltros,
} from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  IWalletTiendaService,
  ListarMisCierresServiceResult,
  ListarMisMovimientosCompletoServiceResult,
  ListarMisMovimientosServiceResult,
  ListarMovimientosDeTiendaCompletoServiceResult,
  ListarMovimientosDeTiendaServiceResult,
  ListarSaldosTiendasCompletoServiceResult,
  ListarSaldosTiendasPaginadoServiceResult,
  ListarSaldosTiendasServiceResult,
  VerMiSaldoServiceResult,
} from "@/lib/interfaces/services/IWalletTiendaService";
import type {
  CierreTiendaOpcionDTO,
  ListarMovimientosDeTiendaCompletoInput,
  ListarMovimientosDeTiendaInput,
  ListarMovimientosTiendaCompletoInput,
  ListarMovimientosTiendaInput,
  SaldoTiendaResumenDTO,
} from "@/lib/types/wallet-tienda";
import { descargaConfig } from "@/lib/config/descarga";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";
import { derivarDesgloseTienda } from "@/lib/utils/desglose-tienda";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// Roles autorizados (R19/R20). El `adminTienda` ES la tienda: su usuarioId = tienda_id, y solo
// ve lo suyo (acotado en el WHERE del repo). El acceso total (maestro/admin) ve el saldo de
// TODAS las tiendas.
const ROL_TIENDA = "adminTienda";

/**
 * Feature 184 — Tanda G (R16) — la fila de «Saldos de tiendas», derivada UNA vez.
 *
 * Estaba escrita dos veces (el listado sin paginar y el paginado) con el mismo cuerpo, y esta
 * tanda habria hecho tres. No es simetria: es el mapper de DINERO de una pantalla de dinero.
 * Dos copias divergentes producen una tabla y un archivo que dicen cifras distintas del mismo
 * libro, y ninguna de las dos falla.
 *
 * El saldo se DERIVA con `derivarSaldoTienda` (R16 de la 43), nunca se lee de un saldo
 * almacenado. Money-safe: entra y sale STRING.
 */
function toSaldoResumen(r: SaldoTiendaAgregadoRow): SaldoTiendaResumenDTO {
  const s = derivarSaldoTienda(r.creditos, r.debitos);
  return { tiendaId: r.tiendaId, tiendaNombre: r.tiendaNombre, saldo: s.saldo, signo: s.signo };
}

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
    //
    // Feature 172 (T G.2, R55) — la tercera lectura es el DESGLOSE por concepto, y es la MISMA
    // agregacion que alimenta la cabecera del maestro (`listarMovimientosDeTienda`, mas abajo),
    // con los MISMOS filtros y el `tienda_id` del actor. Sin ella la tienda veria el pago que
    // recibio sumado dentro de «debitos», indistinguible de un cargo de Ordenex.
    const [{ movimientos, total }, saldoAgg, desgloseAgg] = await Promise.all([
      this.repo.listarPorTienda({
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
        tiendaId: actor.usuarioId, // AL FINAL (feature 170/R15): nada lo puede pisar
      }),
      this.repo.agregarSaldoPorTienda(actor.usuarioId, filtros),
      this.repo.agregarDesglosePorTienda(actor.usuarioId, filtros),
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
        // Feature 172 (R55): la clasificacion NO se reimplementa aqui. Es literalmente la
        // funcion que usa el desglose del maestro; si divergieran, la tienda y quien le paga
        // leerian dos cifras distintas del mismo libro.
        desglose: derivarDesgloseTienda(desgloseAgg),
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

  /**
   * FICHA 335 (design §2.3, R1/R2/R3/R5/R8/R9) — los cierres del libro de la PROPIA tienda, para
   * el selector del filtro de `/mi-wallet`.
   *
   * **SIN PARAMETRO DE ENTRADA, y es la barrera mas fuerte disponible (R5).** Los otros metodos
   * de este servicio se defienden de una clave colada con tres cierres independientes (el
   * `.strict()` del borde, `construirFiltros` leyendo claves explicitas y el `tiendaId` escrito
   * al final). Aqui no hace falta ninguno: no hay entrada donde escribir esa clave. El unico
   * origen posible del alcance es `actor.usuarioId`.
   *
   * **Guard PRIMERO (R3).** Si estuviera despues, la lista de cierres de la tienda ya habria
   * salido de la base aunque la respuesta fuera `forbidden`. Mismo criterio que `verMiSaldo`
   * (`:66`) y `listarSaldosTiendasPaginado`.
   *
   * **Tope `N + 1` (R8).** Se piden `limite + 1` filas y `hayMas` es el sobrante: la pantalla
   * puede avisar de que solo ofrece los mas recientes sin pagar una segunda consulta (R10). Es
   * el mismo patron de `listarMisMovimientosCompleto`.
   *
   * `ultimaFecha` del repositorio se renombra a `fecha` en el DTO de frontera y NO se
   * transforma: quien la formatea es la pantalla, con el mismo formateador de dia que ya usa la
   * columna «Fecha» de la tabla.
   */
  async listarMisCierres(actor: Actor): Promise<ListarMisCierresServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R3: antes del repositorio

    const limite = walletTiendaConfig.MAX_CIERRES_FILTRO;

    // R2: el acotado sale del ACTOR y el repositorio lo pone en el WHERE. R8: `limite + 1`.
    const filas = await this.repo.listarCierresDeTienda(actor.usuarioId, limite + 1);

    const hayMas = filas.length > limite;
    const cierres: CierreTiendaOpcionDTO[] = filas.slice(0, limite).map((f) => ({
      cierreId: f.cierreId,
      fecha: f.ultimaFecha,
      movimientos: f.movimientos,
    }));

    return { status: "ok", cierres, hayMas };
  }

  async listarSaldosTiendas(actor: Actor): Promise<ListarSaldosTiendasServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R20

    const rows = await this.repo.listarSaldosTodasTiendas();
    const tiendas: SaldoTiendaResumenDTO[] = rows.map(toSaldoResumen);
    return { status: "ok", tiendas };
  }

  /**
   * Feature 184 — Tanda G (R1/R4/R5/R6/R16) — el CONJUNTO de «Saldos de tiendas», sin recorte,
   * para el archivo (listado 12 del Anexo A).
   *
   * **Lo que esta migracion cuesta en base: NADA.** Son las mismas dos consultas de siempre —el
   * `groupBy` del ledger entero y la resolucion de nombres—, ni una mas ni una menos. Aqui no
   * hay ahorro que presumir. Lo que si arregla, y no es cosmetico:
   *
   * **el archivo estaba SIN ORDENAR.** `listarSaldosTodasTiendas()` devuelve las filas en el
   * orden en que le conviene al planificador de Postgres —lo dice el propio repositorio, y por
   * eso la 170 tuvo que anadir el orden al paginar—, mientras que la tabla las presenta por
   * nombre de tienda. Con la relectura de hoy, la fila 26 del archivo NO es la primera de la
   * pagina 2, y entre dos descargas seguidas el mismo conjunto puede salir en otro orden. Eso
   * es exactamente lo que R5 prohibe, y la 170 lo dejo declarado como desviacion consciente
   * porque entonces ese conjunto no sostenia ningun archivo. Ahora lo sostiene.
   *
   * Por eso el conjunto NO se pide a `listarSaldosTodasTiendas` —que es lo que el inventario
   * anoto, y seria heredar el defecto— sino al MISMO metodo del que sale la pagina, que es
   * donde vive la unica declaracion del orden (R16). `page: 1` + `pageSize: limite + 1` es el
   * patron ya establecido en este servicio (`listarMisMovimientosCompleto`): pide UNA fila mas
   * que el tope, lo justo para saber que se supero sin construir nunca un archivo truncado.
   *
   * El `total` sale de la misma llamada y cuenta el CONJUNTO, no las filas devueltas: sin eso,
   * el aviso de tope diria «hay 5001» tenga el ledger las tiendas que tenga.
   */
  async listarSaldosTiendasCompleto(
    actor: Actor,
  ): Promise<ListarSaldosTiendasCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R4: antes del repositorio

    const limite = descargaConfig.MAX_FILAS;

    const { items, total } = await this.repo.listarSaldosTiendasPaginado(
      rangoDePagina({ page: 1, pageSize: limite + 1 }),
    );

    // R6: o van TODAS las tiendas del conjunto, o van solo los conteos. Nunca un archivo al que
    // le faltan filas sin avisar.
    if (total > limite) return { status: "limite_excedido", total, limite };

    // R16: el MISMO mapper de dinero que la pagina, no una copia con el mismo aspecto.
    return { status: "ok", items: items.map(toSaldoResumen), total };
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54) — los saldos por tienda, paginados.
   *
   * El guard de rol va PRIMERO, antes de tocar el repositorio: si estuviera despues, el saldo
   * de TODAS las tiendas ya habria salido de la base aunque la respuesta fuera un error. Es la
   * misma decision, y por el mismo motivo, que en `listarMovimientosDeTienda`.
   *
   * UNA sola llamada al repositorio (R54), la misma que hace el listado sin paginar: el total
   * sale de esa agregacion y no de un conteo aparte.
   */
  async listarSaldosTiendasPaginado(
    input: { page: number; pageSize: number },
    actor: Actor,
  ): Promise<ListarSaldosTiendasPaginadoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R20

    const { items, total } = await this.repo.listarSaldosTiendasPaginado(rangoDePagina(input));

    return {
      status: "ok",
      // R16: el saldo se DERIVA con el MISMO helper que el listado sin paginar y que el
      // conjunto del archivo; nunca se lee de un saldo almacenado ni se recalcula aparte.
      items: items.map(toSaldoResumen),
      page: input.page,
      pageSize: input.pageSize,
      total, // R41: el total del CONJUNTO, nunca `items.length`
    };
  }

  /**
   * Feature 171 (T1.4, design §4.4) — DESGLOSE de UNA tienda elegida por el acceso total.
   *
   * Alcance por ROL, no por dato de la peticion (R26/R27/R28). El guard es el MISMO
   * `esAccesoTotal` que `listarSaldosTiendas`, y va PRIMERO, antes de tocar el repositorio:
   * si estuviera despues, el ledger de la tienda ya habria salido de la base aunque la
   * respuesta fuera un error. Que `adminTienda` reciba `forbidden` incluso pidiendo su PROPIA
   * tienda no es un descuido: su superficie es `listarMisMovimientos`, que IGNORA cualquier
   * `tiendaId` del input y acota por `actor.usuarioId`. Abrir esta puerta a la tienda
   * convertiria un contrato cuyo alcance fija el ROL en uno cuyo alcance fija un DATO de la
   * peticion, con un `===` como unica barrera entre una tienda y el ledger de su competencia.
   *
   * `tiendaId: input.tiendaId` se escribe AL FINAL del objeto que va al repositorio, despues
   * de esparcir los filtros (R24): aunque `construirFiltros` llegara a emitir un `tiendaId`, o
   * alguien anadiera un spread encima, esta linea lo pisa. Es la ULTIMA de tres barreras
   * independientes contra una clave extra que pretenda ampliar el alcance; las otras dos son
   * el schema del borde y `construirFiltros`, que lee claves EXPLICITAS.
   *
   * Precision sobre el borde de ESTE camino: `listarMovimientosDeTiendaSchema` NO es
   * `.strict()`. Zod DESCARTA las claves desconocidas en vez de rechazarlas, asi que una
   * clave colada no llega hasta aqui, pero tampoco devuelve `validation_error`. El
   * `.strict()` que si responde error es el del modo completo
   * (`listarMovimientosDeTiendaCompletoSchema`, R37). La contencion es equivalente —la clave
   * no llega al repositorio— y esta probada en `tests/unit/services/wallet-tienda-desglose.
   * test.ts` («R24: el repositorio recibe EXACTAMENTE el tiendaId de la entrada, tambien con
   * claves extra coladas»).
   *
   * DOS llamadas al repositorio, en paralelo y constantes (R34): la pagina y la cabecera. Y
   * NINGUNA para el nombre de la tienda (R35), que ya baja por props desde la fila.
   */
  async listarMovimientosDeTienda(
    input: ListarMovimientosDeTiendaInput,
    actor: Actor,
  ): Promise<ListarMovimientosDeTiendaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R26/R27/R28

    const filtros = this.construirFiltros(input);

    const [{ movimientos, total }, desgloseAgg] = await Promise.all([
      this.repo.listarPorTienda({
        page: input.page,
        pageSize: input.pageSize,
        ...filtros,
        tiendaId: input.tiendaId, // AL FINAL (R24): nada lo puede pisar
      }),
      this.repo.agregarDesglosePorTienda(input.tiendaId, filtros),
    ]);

    return {
      status: "ok",
      data: {
        tiendaId: input.tiendaId,
        movimientos,
        total,
        page: input.page,
        pageSize: input.pageSize,
        // R12: los cuatro importes reflejan el conjunto FILTRADO (mismos filtros que el
        // listado), no el agregado total de la tienda.
        desglose: derivarDesgloseTienda(desgloseAgg),
      },
    };
  }

  /**
   * Feature 171 (T1.4) — el MISMO desglose sin recorte por pagina, para la descarga.
   *
   * Calcado de `listarPagosDeMensajeroCompleto`: mismo guard de rol evaluado antes de la base,
   * mismos filtros, `page: 1` + `pageSize: limite + 1` (= `skip 0, take N+1`) y `tiendaId` al
   * final. O van TODAS las filas del conjunto filtrado, o va el error accionable con sus
   * conteos: `limite_excedido` NUNCA lleva un dataset truncado (R39/R40).
   *
   * La CABECERA no se recalcula aqui: es dato de pantalla, no columna del archivo. Pedirla
   * seria una consulta de mas por descarga sin nadie que la use — el mismo criterio con el que
   * la 170 dejo fuera el saldo agregado en los otros cuatro ledgers.
   */
  async listarMovimientosDeTiendaCompleto(
    input: ListarMovimientosDeTiendaCompletoInput,
    actor: Actor,
  ): Promise<ListarMovimientosDeTiendaCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R27

    const limite = descargaConfig.MAX_FILAS;

    const { movimientos, total } = await this.repo.listarPorTienda({
      ...this.construirFiltros(input),
      page: 1,
      pageSize: limite + 1,
      tiendaId: input.tiendaId, // AL FINAL (R24)
    });

    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items: movimientos, total };
  }
}
