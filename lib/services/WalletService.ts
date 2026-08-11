import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BalanceFiltros,
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  IWalletService,
  ListarMovimientosCompletoServiceResult,
  ListarMovimientosServiceResult,
  RegistrarMovimientoManualServiceResult,
  VerResumenCajaServiceResult,
} from "@/lib/interfaces/services/IWalletService";
import type {
  ListarMovimientosCompletoInput,
  ListarMovimientosInput,
  RegistrarMovimientoManualInput,
  WalletMovimientoCategoria,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { descargaConfig } from "@/lib/config/descarga";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { invalidarAnaliticaFinanciera } from "@/lib/analytics/invalidacion-financiera";
import { cacheNula } from "@/lib/cache/cache-nula";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";

// Roles autorizados (R19/R65): acceso total (maestro/admin, dueños de la caja central).
// Cualquier otro rol -> forbidden SIN exponer movimientos ni cifras.

/**
 * Feature 173 (T D.2, [P7] = (a)) — ¿la consulta lleva algún filtro puesto?
 *
 * Se calcula sobre los filtros YA construidos, no sobre la entrada cruda: el dia que el libro
 * gane un filtro, esta funcion lo ve sola. Nada de dinero depende de esto —el numero es el
 * mismo con filtros y sin ellos—; lo que depende es el ROTULO, y de eso decide la pantalla
 * (T G.1). El servidor solo dice el hecho.
 */
function hayFiltros(filtros: BalanceFiltros): boolean {
  return Object.values(filtros).some((v) => v !== undefined);
}

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
    /**
     * Feature 179 (T3.2, R10) — el puerto de la cache de analitica.
     *
     * **ESTE ESCRITOR NO ESTABA EN LA LISTA DE LA FICHA** (`requirements.md §0.a`), y es el
     * hallazgo que justifica que el mecanismo de vigilancia de la 179 sea un CENSO DEL ARBOL
     * (R17) y no una lista de rutas: un ingreso o egreso que un maestro mete a mano entra en
     * `egresos`, `dinero_en_caja` y `ganancia_ordenex`. Servirlo rancio en silencio es, palabra
     * por palabra, el modo de fallo que D2 de la 128 rechazo.
     *
     * Default `cacheNula()` para no romper las suites que no invalidan.
     */
    private readonly cache: IAnaliticaCache = cacheNula(),
  ) {}

  /**
   * Feature 170 (T C.1, design §2.1) — los filtros del libro, en UN solo sitio.
   *
   * Es el `construirWhere` de este servicio: los tres caminos que leen el libro (listado
   * paginado, balance y descarga del dataset completo) traducen la entrada con este metodo,
   * de modo que no puedan divergir. Antes estaba escrito inline tres veces; se extrae SIN
   * cambio de comportamiento (las mismas cuatro claves, en el mismo orden).
   *
   * Lo que NO se copia es tan importante como lo que se copia: `page`/`pageSize` se quedan
   * fuera a proposito, porque son del RECORTE, no del conjunto.
   */
  private construirFiltros(input: {
    tipo?: WalletMovimientoTipo;
    categoria?: WalletMovimientoCategoria;
    desde?: Date;
    hasta?: Date;
  }): BalanceFiltros {
    return {
      tipo: input.tipo,
      categoria: input.categoria,
      desde: input.desde,
      hasta: input.hasta,
    };
  }

  async listarMovimientos(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<ListarMovimientosServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R19

    const { movimientos, total } = await this.repo.listar({
      page: input.page,
      pageSize: input.pageSize,
      ...this.construirFiltros(input),
    });
    return {
      status: "ok",
      data: { movimientos, total, page: input.page, pageSize: input.pageSize },
    };
  }

  /**
   * Feature 170 (T C.1) — el MISMO libro sin recorte por pagina, para la descarga.
   *
   * Alcance por rol: la caja principal es de los roles de ACCESO TOTAL, y el guard es
   * literalmente el mismo `esAccesoTotal` que usa `listarMovimientos`, evaluado ANTES de
   * tocar la base (R17). Aqui no hay acotamiento por dato propio que escribir al final del
   * `where`: el conjunto es el mismo para maestro y admin, y nadie mas llega.
   *
   * Paridad con el listado (R14): los filtros salen de `construirFiltros`, el mismo metodo
   * que usa la pantalla. Si manana el libro gana un filtro, lo ganan los dos a la vez.
   */
  async listarMovimientosCompleto(
    input: ListarMovimientosCompletoInput,
    actor: Actor,
  ): Promise<ListarMovimientosCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R17

    const limite = descargaConfig.MAX_FILAS;

    // R29: `pageSize: limite + 1` con `page: 1` es exactamente `skip 0, take N+1` en el
    // repositorio. Acota la MEMORIA por construccion: aunque el libro tenga 50 000
    // movimientos, nunca se materializan mas de N+1. El `total` sigue siendo exacto porque
    // sale de un `count` independiente del `take`.
    const { movimientos, total } = await this.repo.listar({
      ...this.construirFiltros(input),
      page: 1,
      pageSize: limite + 1,
    });

    // R27/R28: por encima del tope no se entrega NADA. Nunca un archivo truncado en
    // silencio: o van todos los movimientos, o va el error accionable con los conteos.
    if (total > limite) return { status: "limite_excedido", total, limite };

    return { status: "ok", items: movimientos, total };
  }

  /**
   * Feature 173 (T D.2, design §5.2 — R8/R64/R65) — las DOS cifras de la caja.
   *
   * Sustituye a `verBalance`, que devolvia una sola cifra rotulada «balance». Mientras la caja
   * solo contuviera dinero DE ORDENEX ese numero era la ganancia; desde que entra el
   * contra-entrega —dinero de las tiendas que solo PASA por la caja— deja de significar una
   * sola cosa.
   *
   * Tres cosas que la task exige y que aqui se ven en el orden en que ocurren:
   *
   *  1. **El guardia va ANTES de tocar la base** (R65). No es estilo: un `forbidden` que se
   *     evaluara despues del `groupBy` ya habria leido las cifras de la caja para tirarlas.
   *  2. **Los filtros son los MISMOS del listado y los resuelve el MISMO metodo** (R8):
   *     `construirFiltros`, el que ya usan `listarMovimientos` y la descarga. Una copia aqui
   *     permitiria que la cabecera y su propio listado dejaran de cuadrar.
   *  3. **`periodoFiltrado` [P7] se deriva de ESOS filtros**, no de la entrada cruda: asi la
   *     bandera no puede desalinearse del conjunto que de verdad se agrego. El servidor NO
   *     pinta texto — solo dice si hay filtros puestos; el rotulo lo elige la pantalla.
   *
   * El servicio no resta nada: agrega con el repositorio y deriva con `derivarCaja`, que es
   * pura y ya esta probada. Money-safe: STRING de punta a punta (R64).
   */
  async verResumenCaja(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<VerResumenCajaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R65: ANTES de la base

    const filtros = this.construirFiltros(input);
    const filas = await this.repo.agregarPorCategoriaYTipo(filtros);
    return {
      status: "ok",
      resumen: derivarCaja(filas, { periodoFiltrado: hayFiltros(filtros) }),
    };
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

    // R10/R8 — el INSERT ya confirmo (transaccion implicita del cliente de escritura). La
    // invalidacion va DESPUES, nunca dentro: entre una invalidacion prematura y el commit cabe
    // una lectura que repuebla la cache con el estado ANTERIOR y se queda ahi el TTL entero.
    await invalidarAnaliticaFinanciera(this.cache, "ledger_movimiento_manual");

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
