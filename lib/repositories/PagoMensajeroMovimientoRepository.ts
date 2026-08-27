import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  CrearPagoMensajeroInput,
  CuentaPorPagarAgregado,
  CuentaPorPagarAgregadoRow,
  CuentaPorPagarFiltros,
  CuentasPorPagarFiltro,
  IPagoMensajeroMovimientoRepository,
  ListarPorMensajeroFiltros,
  ListarPorMensajeroPage,
  PagoMensajeroTxClient,
  PremioRegistradoRow,
} from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import {
  filtrarPorBusquedaMensajero,
  ordenarCuentasPorPagar,
} from "@/lib/utils/cuentas-por-pagar-listado";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletTiendaMovimientoRepository).
// Feature 172 (T C.3): + `liquidacionPago`, SOLO para LEER los ids de pago de un cierre (§5).
// Ningun metodo de esta clase lo escribe: el documento del pago lo escribe su propio repositorio.
type PagoMensajeroPrismaClient = Pick<
  PrismaClient,
  "pagoMensajeroMovimiento" | "usuario" | "liquidacionPago"
>;

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
type MovimientoRow = Prisma.PagoMensajeroMovimientoGetPayload<Record<string, never>>;

/**
 * Feature 205 (T2.4, R43, design §7.3) — el cierre de la fila, DERIVADO. `cierrePorPago` es el
 * mapa `id de pago -> cierre`, resuelto por el caller con UNA consulta para toda la pagina.
 *
 * Las tres ramas son exhaustivas sobre `WalletOrigenTipo` y el orden importa: un `origen_id`
 * ausente cae en `null` en cualquiera de ellas, y un `pago_mensajero` cuyo pago no aparezca en el
 * mapa —imposible por la FK, pero el tipo lo admite— tambien. Nunca se inventa un cierre.
 */
function toDTO(
  r: MovimientoRow,
  cierrePorPago: ReadonlyMap<string, string | null>,
): PagoMensajeroMovimientoDTO {
  return {
    id: r.id,
    mensajeroId: r.mensajeroId,
    tipo: r.tipo,
    categoria: r.categoria,
    monto: r.monto.toFixed(2),
    origenTipo: r.origenTipo,
    origenId: r.origenId,
    descripcion: r.descripcion,
    fechaMovimiento: r.fechaMovimiento.toISOString(),
    cierreId: cierreDeLaFila(r, cierrePorPago),
  };
}

function cierreDeLaFila(
  r: MovimientoRow,
  cierrePorPago: ReadonlyMap<string, string | null>,
): string | null {
  if (r.origenId === null) return null; // `manual`: el unico origen con origen_id NULL
  // El feed del cierre aprobado escribe con `origen_id = <cierre>`: la fila ES su propio enlace.
  if (r.origenTipo === "cierre_dia") return r.origenId;
  // El pago (y sus contraasientos de anulacion) escriben con `origen_id = <pago>`: el cierre vive
  // en el documento y se resuelve por consulta. `?? null` cubre el pago que no esta en el mapa.
  if (r.origenTipo === "pago_mensajero") return cierrePorPago.get(r.origenId) ?? null;
  return null;
}

/**
 * Feature 44 — repositorio del LIBRO de movimientos del pago por mensajero. SOLO queries Prisma.
 * Inserta idempotentemente (skipDuplicates -> ON CONFLICT DO NOTHING, R6/R12), lista paginado
 * por fecha desc acotado a `mensajero_id` en el WHERE (R20/R22) y agrega la cuenta por pagar por
 * mensajero (R14). Money-safe: montos entran/salen como STRING.
 */
export class PagoMensajeroMovimientoRepository implements IPagoMensajeroMovimientoRepository {
  constructor(private readonly prisma: PagoMensajeroPrismaClient) {}

  /**
   * WHERE de los filtros opcionales del desglose (R22), SIN el acotado por mensajero (lo pone
   * el caller).
   *
   * **Feature 172 (T C.3, R52, design §5) — el filtro por cierre son DOS orígenes, no uno.**
   * Hasta la 172, «los movimientos de este cierre» era literalmente `origen_tipo = 'cierre_dia'
   * AND origen_id = <cierre>`, porque el feed de la aprobacion era el unico que escribia en
   * este libro. La liquidacion añade un segundo escritor cuyo origen es el **PAGO**
   * (`origen_tipo = 'pago_mensajero'`, `origen_id = <pago>`), asi que con el filtro viejo el
   * pago de un cierre quedaba FUERA de su propio cierre: la pantalla mostraria la deuda sin
   * mostrar lo que ya se entrego contra ella.
   *
   * Se resuelve en dos pasos, como manda §5: (1) leer los ids de pago de ese cierre —0-3 filas,
   * por el indice `cierre_id` de `liquidacion_pago`— y (2) un `OR` de las dos formas de
   * pertenecer al cierre. El `OR` trae **tambien los contraasientos** de una anulacion, porque
   * comparten `origen_id` con su pago (§6.2): por eso la rama del pago filtra por `origen_id`
   * y no por categoria.
   *
   * Alternativa descartada (§11.G): añadir `cierre_id` a este libro. Exigiria backfillear filas
   * de una tabla declarada inmutable y crearia una segunda forma de decir de donde viene un
   * movimiento.
   *
   * El `OR` compone con el resto por AND (el `mensajeroId` del caller y el rango de fechas
   * siguen a nivel raiz), asi que ni ensancha el alcance ni se salta el acotado por mensajero.
   */
  private async buildFiltrosWhere(
    f: CuentaPorPagarFiltros,
  ): Promise<Prisma.PagoMensajeroMovimientoWhereInput> {
    const where: Prisma.PagoMensajeroMovimientoWhereInput = {};
    if (f.cierreId !== undefined) {
      const pagos = await this.prisma.liquidacionPago.findMany({
        where: { cierreId: f.cierreId },
        select: { id: true },
      });
      where.OR = [
        // (a) lo que el feed escribio AL APROBAR el cierre.
        { origenTipo: "cierre_dia", origenId: f.cierreId },
        // (b) lo que nacio de un PAGO registrado contra ese cierre, y sus contraasientos.
        // Sin pagos, `in: []` no casa nada: la rama existe pero no ensancha el resultado.
        { origenTipo: "pago_mensajero", origenId: { in: pagos.map((p) => p.id) } },
      ];
    }
    if (f.desde !== undefined || f.hasta !== undefined) {
      where.fechaMovimiento = {
        ...(f.desde !== undefined ? { gte: f.desde } : {}),
        ...(f.hasta !== undefined ? { lte: f.hasta } : {}),
      };
    }
    return where;
  }

  /** R6/R12: inserta en la tx `tx` con skipDuplicates (no TOCTOU); devuelve filas insertadas. */
  async crearMovimientos(
    tx: PagoMensajeroTxClient,
    movs: CrearPagoMensajeroInput[],
  ): Promise<number> {
    if (movs.length === 0) return 0;
    const data = movs.map((m) => ({
      mensajeroId: m.mensajeroId,
      tipo: m.tipo,
      categoria: m.categoria,
      monto: new Prisma.Decimal(m.monto), // STRING -> Decimal (money-safe)
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      descripcion: m.descripcion ?? null,
      registradoPor: m.registradoPor ?? null,
      // Feature 172 (T B.2, R37): la fecha del movimiento se pasa SOLO si viene. La clave
      // no se emite cuando el caller no la manda —no se emite `undefined`, no se emite la
      // clave— asi que el feed del cierre sigue cayendo en el `DEFAULT CURRENT_TIMESTAMP`
      // de la columna exactamente como antes.
      ...(m.fechaMovimiento !== undefined ? { fechaMovimiento: m.fechaMovimiento } : {}),
      // Feature 293 (T4.2, R17): la fecha del PODIO, mismo criterio de opcionalidad. Es la
      // columna sobre la que la base impone «un premio por (mensajero, dia)»; quien no la
      // manda deja `premio_dia` en NULL y cae en la primera rama del CHECK.
      ...(m.premioDia !== undefined ? { premioDia: m.premioDia } : {}),
    }));
    const res = await tx.pagoMensajeroMovimiento.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /**
   * Feature 205 (T2.4, R43, design §7.3) — el cierre de cada PAGO que aparece en la pagina, en
   * UNA sola consulta. Mismo patron de dos pasos que `buildFiltrosWhere`, y por el mismo motivo:
   * el numero de consultas NO crece con el tamano de pagina.
   *
   * Sin ids de pago devuelve un mapa vacio y no toca la base: una pagina que solo trae devengos
   * del cierre no paga una consulta por nada.
   */
  private async resolverCierrePorPago(
    rows: readonly MovimientoRow[],
  ): Promise<ReadonlyMap<string, string | null>> {
    const pagoIds = [
      ...new Set(
        rows
          .filter((r) => r.origenTipo === "pago_mensajero" && r.origenId !== null)
          .map((r) => r.origenId as string),
      ),
    ];
    if (pagoIds.length === 0) return new Map();
    const pagos = await this.prisma.liquidacionPago.findMany({
      where: { id: { in: pagoIds } },
      select: { id: true, cierreId: true },
    });
    return new Map(pagos.map((p) => [p.id, p.cierreId]));
  }

  /** R20/R22: pagina el libro de UN mensajero, mas reciente primero, mensajero + filtros en el WHERE. */
  async listarPorMensajero(filtros: ListarPorMensajeroFiltros): Promise<ListarPorMensajeroPage> {
    // R20: el acotado por mensajero va SIEMPRE en el WHERE, nunca en memoria.
    const where: Prisma.PagoMensajeroMovimientoWhereInput = {
      mensajeroId: filtros.mensajeroId,
      ...(await this.buildFiltrosWhere(filtros)),
    };
    const skip = (filtros.page - 1) * filtros.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.pagoMensajeroMovimiento.findMany({
        where,
        orderBy: { fechaMovimiento: "desc" },
        skip,
        take: filtros.pageSize,
      }),
      this.prisma.pagoMensajeroMovimiento.count({ where }),
    ]);
    // Feature 205 (T2.4/R43): UNA consulta mas por pagina, solo si la pagina trae pagos.
    const cierrePorPago = await this.resolverCierrePorPago(rows);
    return { movimientos: rows.map((r) => toDTO(r, cierrePorPago)), total };
  }

  /** R14/R20: SUM(monto) por tipo acotado a `mensajeroId` + filtros. Salida STRING (money-safe). */
  async agregarCuentaPorPagar(
    mensajeroId: string,
    filtros: CuentaPorPagarFiltros,
  ): Promise<CuentaPorPagarAgregado> {
    const where: Prisma.PagoMensajeroMovimientoWhereInput = {
      mensajeroId, // R20: acotado por mensajero en el WHERE
      // Feature 172 (T C.3/R52): el MISMO where que el listado, incluido el `OR` del cierre.
      // Si aqui se filtrara distinto, la cabecera del desglose diria una cifra y la tabla de
      // debajo mostraria otra — el pago contado en una y no en la otra.
      ...(await this.buildFiltrosWhere(filtros)),
    };
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["tipo"],
      where,
      _sum: { monto: true },
    });
    let devengado = new Prisma.Decimal(0);
    let pagado = new Prisma.Decimal(0);
    for (const g of grupos) {
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "devengo") devengado = new Prisma.Decimal(suma);
      else pagado = new Prisma.Decimal(suma);
    }
    return { devengado: devengado.toFixed(2), pagado: pagado.toFixed(2) };
  }

  /** R18: una fila por mensajero (con nombre) + totales devengado/pagado, para la vista del maestro. */
  async listarCuentasPorPagarTodos(): Promise<CuentaPorPagarAgregadoRow[]> {
    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["mensajeroId", "tipo"],
      _sum: { monto: true },
    });
    // Agrega devengo/pago por mensajero (Prisma.Decimal, money-safe).
    const porMensajero = new Map<
      string,
      { devengado: Prisma.Decimal; pagado: Prisma.Decimal }
    >();
    for (const g of grupos) {
      const acc = porMensajero.get(g.mensajeroId) ?? {
        devengado: new Prisma.Decimal(0),
        pagado: new Prisma.Decimal(0),
      };
      const suma = g._sum.monto ?? new Prisma.Decimal(0);
      if (g.tipo === "devengo") acc.devengado = acc.devengado.add(suma);
      else acc.pagado = acc.pagado.add(suma);
      porMensajero.set(g.mensajeroId, acc);
    }
    if (porMensajero.size === 0) return [];

    const mensajeroIds = [...porMensajero.keys()];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: mensajeroIds } },
      select: { id: true, nombre: true },
    });
    const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));

    return mensajeroIds.map((mensajeroId) => {
      const acc = porMensajero.get(mensajeroId)!;
      return {
        mensajeroId,
        mensajeroNombre: nombrePorId.get(mensajeroId) ?? "",
        devengado: acc.devengado.toFixed(2),
        pagado: acc.pagado.toFixed(2),
      };
    });
  }

  /**
   * Feature 170 — FASE 2 (T L.1, R40/R41/R45/R51) — la misma vista del maestro, con la
   * busqueda por nombre resuelta en el servidor, ordenada y recortada a una pagina.
   *
   * **No corta en la base, y es deliberado** (precedente exacto: `listarSaldosTiendasPaginado`,
   * T I.1 §6.6). Cada fila es la agregacion de TODO el libro de ese mensajero: no hay nada que
   * empujar al `LIMIT` sin cambiar el dinero que la fila declara. Ademas el filtro es por
   * NOMBRE, que vive en `usuario` y no en el libro que se agrega, asi que un `WHERE` sobre la
   * agregacion no lo expresaria sin una segunda lectura de `usuario` cuyo `ILIKE` casaria un
   * conjunto distinto del que casa hoy el navegador (`%` y `_` son comodines en SQL y no en
   * `String.includes`) — que es justo lo que R45 prohibe.
   *
   * Consecuencias, las tres medidas: R44 se cumple por construccion (es literalmente el mismo
   * conjunto que `listarCuentasPorPagarTodos`), R54 en su forma fuerte (cero consultas nuevas,
   * ni la del conteo) y lo que baja no es el coste en Postgres sino lo que cruza a la pantalla,
   * que es de lo que habla el Anexo III para este listado.
   */
  async listarCuentasPorPagarPaginado(
    filtro: CuentasPorPagarFiltro,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<CuentaPorPagarAgregadoRow>> {
    const conjunto = await this.listarCuentasPorPagarCompleto(filtro);
    return {
      items: conjunto.slice(rango.skip, rango.skip + rango.take),
      total: conjunto.length, // R41: el total del CONJUNTO FILTRADO, no el de la pagina
    };
  }

  /**
   * Feature 170 — FASE 2 (T M.1, cierre de Q-L2) — el CONJUNTO filtrado y ordenado, entero.
   *
   * Es la lista de la que el metodo de arriba saca su `slice`, extraida para que la DESCARGA
   * pueda pedirla sin releer el listado sin busqueda y filtrar despues en el navegador (lo que
   * hacia T L.2). Con esto la busqueda deja de tener dos implementaciones vivas —la del
   * servidor y la del cliente— y R45 pasa a cumplirse por construccion tambien en el archivo.
   *
   * Sigue SIN cortar en la base, por el mismo motivo que el metodo paginado: cada fila es la
   * agregacion de todo el libro de ese mensajero y el nombre por el que se busca vive en
   * `usuario`, no en el libro que se agrega.
   */
  async listarCuentasPorPagarCompleto(
    filtro: CuentasPorPagarFiltro,
  ): Promise<CuentaPorPagarAgregadoRow[]> {
    return ordenarCuentasPorPagar(
      // R45: la busqueda ANTES del recorte. Al reves, buscaria dentro de la pagina — que es
      // exactamente la regresion que esta tanda existe para evitar.
      filtrarPorBusquedaMensajero(await this.listarCuentasPorPagarTodos(), filtro.busqueda),
    );
  }

  /** R18: nombre de UN mensajero para la vista del maestro (desglose por cierre); null si no existe. */
  async obtenerNombreMensajero(mensajeroId: string): Promise<string | null> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: mensajeroId },
      select: { nombre: true },
    });
    return u?.nombre ?? null;
  }

  /**
   * Feature 293 (T2.2, design §5, R24) — Σ de los premios VIVOS de cada cierre, en UNA consulta.
   *
   * Vivo = registrado menos anulado, y la resta es la unica forma correcta: la anulacion NO
   * borra ni edita la fila del premio (R21), escribe una compensacion `ajuste_pago` con el mismo
   * `premio_dia`. Por eso el `groupBy` va por `(origenId, categoria)` y el signo lo pone esta
   * funcion, no la base.
   *
   * Tres piezas del WHERE, y las tres cargan peso:
   *  - `origenTipo: 'cierre_dia'` — sin el, el `origen_id` de un PAGO podria contarse como si
   *    fuera un cierre. Es lo que un test [PG] mata con una mutacion; un doble no lo ve.
   *  - `origenId: { in: cierreIds }` — el acotado al conjunto pedido.
   *  - el `OR` de las dos categorias, con `premioDia: { not: null }` SOLO en la rama del
   *    `ajuste_pago`: esa categoria existe desde la 44 para ajustes manuales que no tienen nada
   *    que ver con el premio, y contarlos aqui restaria de lo pagable un dinero ajeno.
   */
  async sumarPremiosVivosPorCierre(cierreIds: string[]): Promise<Record<string, string>> {
    const total: Record<string, string> = {};
    for (const id of cierreIds) total[id] = "0.00"; // entrada por CADA id pedido
    if (cierreIds.length === 0) return total;

    const grupos = await this.prisma.pagoMensajeroMovimiento.groupBy({
      by: ["origenId", "categoria"],
      where: {
        origenTipo: "cierre_dia",
        origenId: { in: cierreIds },
        OR: [
          { categoria: "premio_ranking" },
          { categoria: "ajuste_pago", premioDia: { not: null } },
        ],
      },
      _sum: { monto: true },
    });

    const acumulado = new Map<string, Prisma.Decimal>();
    for (const g of grupos) {
      if (g.origenId === null) continue; // imposible por el `in`; el tipo lo admite
      const suma = new Prisma.Decimal(g._sum.monto ?? 0);
      const previo = acumulado.get(g.origenId) ?? new Prisma.Decimal(0);
      // `premio_ranking` SUMA (devengo) y su compensacion RESTA (pago del mismo importe).
      acumulado.set(
        g.origenId,
        g.categoria === "premio_ranking" ? previo.add(suma) : previo.sub(suma),
      );
    }
    for (const [cierreId, valor] of acumulado) total[cierreId] = valor.toFixed(2);
    return total;
  }

  /**
   * Feature 293 (T3.3, R9) — las filas del mundo del premio de UN mensajero en unos dias.
   *
   * El acotado por mensajero va en el WHERE (R20), como en el resto de este repositorio, y los
   * dias entran por `in` sobre `premio_dia`: la columna es `@db.Date`, asi que el caller pasa
   * medianoches UTC (`fechaComoDate`) y la comparacion es exacta, sin rangos que puedan
   * desbordar a un dia vecino.
   *
   * Con `tx` la lectura va POR ESA TRANSACCION (revision de la 293, m4); sin el, por el cliente
   * propio del repositorio, que es lo que quiere el listado del podio. Es el mismo criterio que
   * `crearMovimientos`, con la diferencia de que ahi el `tx` es obligatorio porque escribe.
   */
  async listarPremiosPorDias(
    mensajeroId: string,
    dias: Date[],
    tx?: PagoMensajeroTxClient,
  ): Promise<PremioRegistradoRow[]> {
    if (dias.length === 0) return [];
    const cliente = tx ?? this.prisma;
    const rows = await cliente.pagoMensajeroMovimiento.findMany({
      where: {
        mensajeroId, // R20: acotado por mensajero en el WHERE
        premioDia: { in: dias },
        categoria: { in: ["premio_ranking", "ajuste_pago"] },
      },
      select: {
        categoria: true,
        premioDia: true,
        monto: true,
        origenTipo: true,
        origenId: true,
        fechaMovimiento: true,
      },
      orderBy: { fechaMovimiento: "asc" },
    });
    return rows.flatMap((r) => {
      // `premio_dia` no puede ser NULL aqui (el `in` lo excluye), pero el tipo lo admite y no
      // se inventa una fecha: la fila que no la tenga simplemente no sale.
      if (r.premioDia === null) return [];
      if (r.categoria !== "premio_ranking" && r.categoria !== "ajuste_pago") return [];
      return [
        {
          categoria: r.categoria,
          premioDia: r.premioDia,
          monto: r.monto.toFixed(2),
          cierreId: r.origenTipo === "cierre_dia" ? r.origenId : null,
          fechaMovimiento: r.fechaMovimiento,
        },
      ];
    });
  }
}
