import { randomUUID } from "node:crypto";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BalanceFiltros,
  IWalletMovimientoRepository,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  IWalletService,
  ListarMovimientosCompletoServiceResult,
  ListarMovimientosDeFilaServiceResult,
  ListarMovimientosServiceResult,
  RegistrarMovimientoManualServiceResult,
  VerResumenCajaServiceResult,
} from "@/lib/interfaces/services/IWalletService";
import type {
  ListarMovimientosCompletoInput,
  ListarMovimientosDeFilaInput,
  ListarMovimientosInput,
  RegistrarMovimientoManualInput,
  DocumentoCajaDTO,
  WalletMovimientoCategoria,
  WalletMovimientoDTO,
  WalletMovimientoTipo,
} from "@/lib/types/wallet";
import { descargaConfig } from "@/lib/config/descarga";
import {
  categoriasDeFilaComposicion,
  derivarCaja,
  derivarComposicionGanancia,
} from "@/lib/utils/caja-tesoreria";
import { instanteDelMovimientoManual } from "@/lib/utils/fecha-movimiento-manual";
import type {
  LectorSaldoInicial,
  LectoresDocumentosCaja,
} from "@/lib/interfaces/services/IWalletService";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

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
 * Ficha 459 (design §7.3) — ¿es esta fila la ORIGINAL de un documento? Categoria Y origen, los
 * dos: la salida de un cobro reclasificado comparte categoria con el pago por cuenta pero su
 * origen es el cobro, y los contra-asientos comparten origen pero no categoria.
 *
 * Ficha 461 (design §5.4, R20/R37): la linea de caja de un cobro de Ordenex a una tienda es
 * original con CUALQUIERA de sus dos origenes —`cobro_tienda` (la escribio el servicio) o
 * `cobro_tienda_completado` (la añadio la migracion de datos)—: las dos se anulan igual. El reverso
 * (`egreso_reverso_cobro_tienda`, mismo origen) NO es original. Mutacion 14 de design §14.2: sin el
 * origen `cobro_tienda_completado` aqui, las lineas completadas perderian su «Anular…».
 */
function tipoDeDocumentoOriginal(m: WalletMovimientoDTO): DocumentoCajaDTO["tipo"] | null {
  if (m.categoria === "egreso_pago_por_cuenta_tienda" && m.origenTipo === "pago_por_cuenta_tienda") {
    return "pago_por_cuenta_tienda";
  }
  if (m.categoria === "ingreso_aporte_capital" && m.origenTipo === "aporte_capital") {
    return "aporte_capital";
  }
  if (
    m.categoria === "ingreso_cobro_tienda" &&
    (m.origenTipo === "cobro_tienda" || m.origenTipo === "cobro_tienda_completado")
  ) {
    return "cobro_tienda";
  }
  // Ficha 457 (design §8.5, R41): la ENTRADA del pago de una tienda a Ordenex es la original; su
  // reverso (`egreso_reverso_abono_tienda`, mismo origen) queda en `null` y no se anula.
  if (m.categoria === "ingreso_abono_tienda" && m.origenTipo === "abono_tienda") {
    return "abono_tienda";
  }
  // Ficha 461 (R71, auditoria D3): la CORRECCION de caja original —origen `manual` y SIN `origen_id`—.
  // Su contra-asiento comparte categoria y origen pero lleva `origen_id` = la correccion: no es
  // original y no se anula. El reverso de un egreso (`ingreso_ajuste`, origen `gasto`) tampoco.
  if (
    (m.categoria === "ingreso_ajuste" || m.categoria === "egreso_ajuste") &&
    m.origenTipo === "manual" &&
    m.origenId === null
  ) {
    return "ajuste_caja";
  }
  // Ficha 458-B (design §3.6, R63/R71): los EGRESOS sin documento propio. Todo egreso con origen
  // `gasto` es un original (su reverso es un `ingreso_ajuste`): sueldo, gasto de Ordenex y gasto
  // fijo cobrado. La indemnizacion SOLO con origen `orden_incidente` (la del cierre no se anula, R65).
  if (m.tipo === "egreso" && m.origenTipo === "gasto") return "egreso_caja";
  if (m.categoria === "egreso_indemnizacion" && m.origenTipo === "orden_incidente") return "indemnizacion";
  // Ficha 458-B (D7, R63): las DOS lineas del cobro por rechazo aprobado (origen `gestion_orden`)
  // son originales del MISMO documento; sus reversos (`egreso_reverso_*`) no. Mutacion 10 de design
  // §8.2: sin esta rama, la fila no ofreceria «Anular…».
  if (
    (m.categoria === "ingreso_flete_devolucion" || m.categoria === "ingreso_iva_flete_devolucion") &&
    m.origenTipo === "gestion_orden"
  ) {
    return "rechazo_tienda_cobro";
  }
  return null;
}

/**
 * Ficha 461 (R71) — el id del DOCUMENTO de una fila original. Para el pago de un gasto, el aporte y
 * el cobro es el `origenId` (el documento vive en otra tabla o es el debito de la tienda); para la
 * correccion de caja es la PROPIA fila, porque la correccion no tiene documento aparte.
 *
 * Ficha 458-B: el egreso y la indemnizacion tampoco tienen documento aparte (la PROPIA fila); el
 * cobro por rechazo se lee por su GESTION (el `origenId` de sus dos lineas).
 */
function idDeDocumento(m: WalletMovimientoDTO, tipo: DocumentoCajaDTO["tipo"]): string | null {
  return tipo === "ajuste_caja" || tipo === "egreso_caja" || tipo === "indemnizacion" ? m.id : m.origenId;
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
     * Ficha 459 (R14/R21) — el lector de «hay un saldo inicial vigente». SIN valor por defecto a
     * proposito: un composition root que se olvidara de pasarlo dejaria la caja en «flujo» para
     * siempre aunque alguien registrara un saldo inicial (memoria «el composition root que no
     * inyecta»). Si falta, no compila.
     */
    private readonly saldoInicial: LectorSaldoInicial,
    /**
     * Ficha 459 (design §7.3, R66/R67) — los lectores del estado de los documentos del libro.
     * Tambien SIN valor por defecto y por la misma razon: sin ellos ninguna fila ofreceria
     * «Anular…» ni «Ver comprobante», y ningun test de servicio lo notaria.
     */
    private readonly documentos: LectoresDocumentosCaja,
  ) {}

  /**
   * Ficha 459 (design §7.3) — el documento de cada fila ORIGINAL de la pagina, EN LOTE: una
   * consulta por tipo de documento PRESENTE (ninguna si la pagina no tiene filas de ese tipo).
   *
   * Solo cuentan como originales la salida del pago por cuenta con SU origen y la entrada del
   * saldo inicial o aporte con el suyo. Los contra-asientos (otra categoria, mismo origen) y las
   * salidas de los cobros reclasificados (misma categoria, origen `cobro_manual_reclasificado`)
   * se quedan en `null`: sobre ellas no hay nada que anular (R66).
   */
  private async conDocumentos(
    movimientos: WalletMovimientoDTO[],
  ): Promise<WalletMovimientoDTO[]> {
    const idsDe = (tipo: DocumentoCajaDTO["tipo"]) =>
      movimientos
        .filter((m) => tipoDeDocumentoOriginal(m) === tipo)
        .map((m) => idDeDocumento(m, tipo))
        .filter((id): id is string => id !== null);
    const idsPagos = idsDe("pago_por_cuenta_tienda");
    const idsAportes = idsDe("aporte_capital");
    const idsCobros = idsDe("cobro_tienda");
    const idsAjustes = idsDe("ajuste_caja");
    const idsAbonos = idsDe("abono_tienda");
    const idsEgresos = idsDe("egreso_caja");
    const idsIndemnizaciones = idsDe("indemnizacion");
    // Las dos lineas de un cobro por rechazo comparten documento: se pide UNA vez por gestion.
    const idsRechazos = [...new Set(idsDe("rechazo_tienda_cobro"))];

    const [pagos, aportes, cobros, ajustes, abonos, egresos, indemnizaciones, rechazos] = await Promise.all([
      idsPagos.length > 0 ? this.documentos.pagosPorCuenta.estadoDeDocumentos(idsPagos) : [],
      idsAportes.length > 0 ? this.documentos.aportes.estadoDeDocumentos(idsAportes) : [],
      idsCobros.length > 0 ? this.documentos.cobros.estadoDeDocumentos(idsCobros) : [],
      idsAjustes.length > 0 ? this.documentos.ajustes.estadoDeDocumentos(idsAjustes) : [],
      idsAbonos.length > 0 ? this.documentos.abonos.estadoDeDocumentos(idsAbonos) : [],
      idsEgresos.length > 0 ? this.documentos.egresos.estadoDeDocumentos(idsEgresos) : [],
      idsIndemnizaciones.length > 0
        ? this.documentos.indemnizaciones.estadoDeDocumentos(idsIndemnizaciones)
        : [],
      idsRechazos.length > 0 ? this.documentos.rechazos.estadoDeDocumentos(idsRechazos) : [],
    ]);
    const estado = {
      pago_por_cuenta_tienda: new Map(pagos.map((e) => [e.id, e])),
      aporte_capital: new Map(aportes.map((e) => [e.id, e])),
      cobro_tienda: new Map(cobros.map((e) => [e.id, e])),
      ajuste_caja: new Map(ajustes.map((e) => [e.id, e])),
      abono_tienda: new Map(abonos.map((e) => [e.id, e])),
      egreso_caja: new Map(egresos.map((e) => [e.id, e])),
      indemnizacion: new Map(indemnizaciones.map((e) => [e.id, e])),
      rechazo_tienda_cobro: new Map(rechazos.map((e) => [e.id, e])),
    };

    return movimientos.map((m) => {
      const tipo = tipoDeDocumentoOriginal(m);
      const idDoc = tipo === null ? null : idDeDocumento(m, tipo);
      const e = tipo === null || idDoc === null ? undefined : estado[tipo].get(idDoc);
      // Una fila original cuyo documento no aparece (no deberia pasar: la FK es del mismo
      // servicio) no ofrece acciones: mejor ningun boton que uno que responda «no encontrado».
      if (tipo === null || e === undefined) return { ...m, documento: null };
      return {
        ...m,
        documento: {
          tipo,
          anulado: e.anulado,
          tieneComprobante: e.tieneComprobante,
          ...(e.sinConstancia === true ? { motivoNoRegistrado: true } : {}),
        },
      };
    });
  }

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

  /** Ficha 459 (R14) — ¿hay un saldo inicial vigente? Lo lee el repositorio de `aporte_capital`. */
  private async haySaldoInicialVigente(): Promise<boolean> {
    return this.saldoInicial.haySaldoInicialVigente();
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
      data: {
        movimientos: await this.conDocumentos(movimientos),
        total,
        page: input.page,
        pageSize: input.pageSize,
      },
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
   *
   * Feature 231 (design §3.2 — R24): **UNA lectura, DOS derivaciones.** El MISMO array `filas`
   * alimenta `derivarCaja` y `derivarComposicionGanancia`. Eso es lo que garantiza que la
   * tarjeta de la ganancia y la cifra de la caja hablen del mismo instante y del mismo
   * conjunto: con dos consultas podrian discrepar si alguien registra un movimiento entre
   * ellas, y la resta de la pantalla dejaria de cuadrar sin que nada fallara.
   */
  async verResumenCaja(
    input: ListarMovimientosInput,
    actor: Actor,
  ): Promise<VerResumenCajaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R65: ANTES de la base

    const filtros = this.construirFiltros(input);
    const filas = await this.repo.agregarPorCategoriaYTipo(filtros);
    // Ficha 459 (design §2.5, R14/R15) — dos datos de la CONSULTA, leidos SIN filtros: si hay un
    // saldo inicial vigente (decide el estado de la caja) y el dia del primer movimiento (el
    // «desde» del flujo registrado). El numero no cambia con ellos; cambia el rotulo.
    const haySaldoInicialVigente = await this.haySaldoInicialVigente();
    const primerDia = await this.repo.primerDiaDeLaCaja();
    return {
      status: "ok",
      resumen: derivarCaja(filas, {
        periodoFiltrado: hayFiltros(filtros),
        haySaldoInicialVigente,
        primerDia,
      }),
      composicion: derivarComposicionGanancia(filas),
    };
  }

  /**
   * Ficha 339 (T3.3, design §4.3 — R18/R20/R33/R38/R39) — los movimientos que componen el
   * importe de UNA fila de la tarjeta de la ganancia.
   *
   * Los cuatro pasos van en ESTE orden, y el orden es parte del requisito:
   *
   *  1. **El guardia, ANTES de la base** (R39). Mismo `esAccesoTotal` que el listado y que el
   *     resumen, por el motivo ya escrito alli: un `forbidden` evaluado despues del `SELECT` ya
   *     habria leido el dinero para tirarlo.
   *  2. **Los filtros, por `construirFiltros`** — el MISMO metodo privado que usan el listado,
   *     la descarga y el resumen (R20). Sin copia: el detalle y el importe de la fila hablan
   *     siempre del mismo conjunto.
   *  3. **El conjunto de la fila lo resuelve el SERVIDOR** con `categoriasDeFilaComposicion`, la
   *     misma definicion que deriva el importe. Se INTERSECA con el filtro de categoria vigente
   *     si lo hay; la interseccion vacia se pasa tal cual (`in: []` → cero filas en Postgres):
   *     el recorte lo hace el `WHERE`, nunca un `if` en memoria (R33).
   *  4. `repo.listar`, que acota con `IN (…)` en la consulta y cuenta el total con un `count`
   *     independiente del `take` (R31).
   *
   * Aqui no hay ni una operacion de dinero: los importes ya venian derivados y solo se leen.
   */
  async listarMovimientosDeFila(
    input: ListarMovimientosDeFilaInput,
    actor: Actor,
  ): Promise<ListarMovimientosDeFilaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R39: ANTES de la base

    const filtros = this.construirFiltros(input);
    const deLaFila = categoriasDeFilaComposicion(input.fila);
    const categorias =
      filtros.categoria === undefined
        ? deLaFila
        : deLaFila.filter((categoria) => categoria === filtros.categoria);

    const { movimientos, total } = await this.repo.listar({
      ...filtros,
      categorias,
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      status: "ok",
      data: { movimientos, total, page: input.page, pageSize: input.pageSize },
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
    //
    // Ficha 334 (R28, design §5): el `id` lo genera EL SERVICIO y viaja en la insercion, para
    // poder releer despues EXACTAMENTE esta fila. `createMany` sobre Postgres no devuelve los
    // ids generados y sigue habiendo UN SOLO INSERT (precedente: registrar-cambio-dia-reparto).
    const id = randomUUID();
    // Ficha 334 (R22/R23): con «hoy» la clave NO viaja y manda el DEFAULT de la columna.
    const fechaMovimiento = instanteDelMovimientoManual(input.fecha);
    // FICHA 362 (R6/R9) — `wallet_movimiento_manual_registrado`. Se usa
    // `crearMovimientoRegistrado` y no `crearMovimientos`: el ajuste manual es una DECISION
    // humana sobre el dinero de la casa, y el registro tiene que ir en la misma transaccion que
    // el asiento. `this.writeClient` ya no interviene en este camino — la transaccion la abre el
    // repositorio, que es quien conoce Prisma.
    const escritas = await this.repo.crearMovimientoRegistrado(
      {
        id,
        tipo: input.tipo,
        categoria: input.categoria,
        monto: input.monto,
        origenTipo: "manual",
        origenId: null, // fuera del indice unico parcial: la idempotencia la da la CLAVE (461/R67)
        descripcion: input.descripcion,
        registradoPor: actor.usuarioId,
        ...(fechaMovimiento !== undefined ? { fechaMovimiento } : {}),
        claveIdempotencia: input.claveIdempotencia, // ficha 461 (R66/R67)
      },
      { accion: "wallet_movimiento_manual_registrado", actorUsuarioId: actor.usuarioId },
    );
    // Ficha 461 (R68, auditoria D2): `0` = la clave YA tenia su fila (doble clic, reintento). No se
    // escribio nada —ni asiento ni historial— y se responde con la correccion ORIGINAL, releida por
    // la clave. Antes, dos envios iguales eran dos filas y nada lo notaba.
    if (escritas === 0) {
      const original = await this.repo.obtenerPorClave(input.claveIdempotencia);
      if (original === null) {
        throw new Error("wallet: clave de idempotencia repetida sin movimiento que releer");
      }
      return { status: "ya_registrado", movimiento: original };
    }

    // Ficha 334 (R28): se relee POR ID, no «el mas reciente de esta categoria».
    //
    // La relectura vieja (`listar({ page: 1, pageSize: 1, tipo, categoria })`) funcionaba por
    // ACCIDENTE —todo se fechaba con `now()`, asi que el mas reciente era siempre el recien
    // creado—. Con una fecha del pasado devolveria OTRO ajuste de la misma categoria: el
    // servicio afirmaria «este es el movimiento que registraste» sobre una fila ajena.
    const movimiento = await this.repo.obtenerPorId(id);
    if (movimiento === null) {
      // Imposible por construccion: `escritas` fue 1, asi que la fila con ESTE id existe. Se propaga
      // con contexto en vez de devolver una fila inventada: en el libro de la caja, mentir es peor
      // que fallar.
      throw new Error(`wallet: el movimiento manual ${id} no se pudo releer tras insertarlo`);
    }
    return { status: "ok", movimiento };
  }
}
