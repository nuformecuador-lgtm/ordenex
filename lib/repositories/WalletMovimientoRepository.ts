import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import type { HistorialAccionTipo } from "@/lib/types/historial-accion";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  BalanceFiltros,
  CrearMovimientoInput,
  DesgloseEgresosAgregado,
  IWalletMovimientoRepository,
  LateralesDelRegistro,
  ListarMovimientosFiltros,
  ListarMovimientosPage,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { ISaldoCorridoCajaRepository } from "@/lib/interfaces/repositories/ISaldoCorridoCajaRepository";
import type {
  AgregadoCajaRow,
  WalletMovimientoCategoria,
  WalletMovimientoDTO,
  WalletOrigenTipo,
} from "@/lib/types/wallet";
import { NATURALEZA_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { whereLibroCajaConTerminoSql, whereLibroCajaSql } from "@/lib/repositories/libro-caja-a-quien-sql";
import type { AQuienFiltro } from "@/lib/types/libro-caja-a-quien";
import { ordenTotal, type DireccionOrden } from "@/lib/types/ordenamiento-listado";
import { derivarBalance } from "@/lib/utils/wallet-balance";

/** Ficha 459 — las categorias de capital, DERIVADAS de la clasificacion (nunca una lista a mano). */
const CATEGORIAS_DE_CAPITAL: readonly WalletMovimientoCategoria[] =
  WALLET_MOVIMIENTO_CATEGORIA_SEED.filter((c) => NATURALEZA_POR_CATEGORIA[c] === "capital");

// Cliente Prisma acotado a lo que este repo necesita (patron CierresAdminRepository).
// FICHA 362 (R9): los TRES movimientos que nacen de una DECISION humana —el ajuste manual de
// caja y los dos del egreso administrativo— registran su accion en la MISMA transaccion, asi que
// el `Pick` gana `$transaction`, `historialAccion` y `usuario`.
type WalletPrismaClient = Pick<
  PrismaClient,
  "walletMovimiento" | "$transaction" | "historialAccion" | "usuario" | "$queryRaw"
>;

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
type MovimientoRow = Prisma.WalletMovimientoGetPayload<Record<string, never>>;

/**
 * Feature 231 (R31/R32, design §3.3) — `dueno` se asigna AQUI, en el unico punto de proyeccion
 * a DTO por el que pasan `listar`, `listarCompleto` y `obtenerPorId`.
 *
 * Desviacion consciente de `docs/architecture.md` («el repositorio no lleva logica de
 * negocio»), declarada en design §3.3 y §6.2: lo que se anade no es una regla, es una BUSQUEDA
 * TOTAL en un `Record` ya existente durante la proyeccion, que es justo lo que esta funcion
 * hace con los demas campos. Mapear en el servicio obligaria a repetir el `map` en los cuatro
 * caminos que consumen este DTO y abriria la puerta a que la tabla y la descarga dijeran cosas
 * distintas — que es exactamente lo que la columna «Dueño» existe para impedir.
 *
 * `NATURALEZA_POR_CATEGORIA` es un `Record` TOTAL sobre el union de categorias: el dia que el
 * enum gane un valor, esto deja de compilar hasta que alguien decida de quien es ese dinero.
 */
function toDTO(r: MovimientoRow): WalletMovimientoDTO {
  return {
    id: r.id,
    tipo: r.tipo,
    categoria: r.categoria,
    monto: r.monto.toFixed(2),
    origenTipo: r.origenTipo,
    origenId: r.origenId,
    descripcion: r.descripcion,
    registradoPor: r.registradoPor,
    fechaMovimiento: r.fechaMovimiento.toISOString(),
    dueno: NATURALEZA_POR_CATEGORIA[r.categoria],
    // Ficha 459 (design §7.3): el repositorio no conoce los documentos. Lo resuelve EN LOTE
    // `WalletService.listarMovimientos` para la pagina que se pinta; en cualquier otro camino
    // (descarga, detalle de una fila) la fila no ofrece acciones y el campo queda en `null`.
    documento: null,
  };
}

// WHERE comun a listado y balance (R20): filtros opcionales tipo/categoria/rango fechas
// sobre fecha_movimiento. `desde` inclusivo, `hasta` EXCLUSIVO.
//
// Ficha 461 (R72, auditoria T1): `hasta` pasa de `lte` a `lt`. El borde manda el INICIO del dia CR
// SIGUIENTE (`hastaDiaCRSchema`), asi que `<` cubre el dia entero elegido y ni un instante mas; con
// `lte` un asiento fechado exactamente a las 06:00Z del dia siguiente entraria dos veces (en su dia y
// en el anterior). `desde` sigue siendo `gte` sobre el inicio del dia CR.
//
// Ficha 339 (T3.2, design §4.4 — R33): + `categorias`, el CONJUNTO de una fila de la tarjeta de
// la ganancia. Va en `AND` y NO sobreescribiendo `where.categoria`, para que CONVIVAN el filtro
// de categoria del usuario y el conjunto de la fila; si los dos se contradicen el resultado es
// vacio, que es lo correcto —el importe de esa fila bajo esos filtros tambien es 0,00—.
// El recorte lo hace el motor: `categoria IN (…)` viaja en el `WHERE`, nunca es un `filter` en
// memoria sobre lo que la base ya devolvio.
function buildWhere(f: BalanceFiltros): Prisma.WalletMovimientoWhereInput {
  const where: Prisma.WalletMovimientoWhereInput = {};
  if (f.tipo !== undefined) where.tipo = f.tipo;
  if (f.categoria !== undefined) where.categoria = f.categoria;
  if (f.categorias !== undefined) where.AND = [{ categoria: { in: [...f.categorias] } }];
  if (f.desde !== undefined || f.hasta !== undefined) {
    where.fechaMovimiento = {
      ...(f.desde !== undefined ? { gte: f.desde } : {}),
      ...(f.hasta !== undefined ? { lt: f.hasta } : {}), // ficha 461/R72: cota EXCLUSIVA
    };
  }
  return where;
}

/**
 * Ficha 458-E (TE.2, R59) — ¿lleva el filtro «A quién»? Entonces el conjunto lo decide
 * `whereLibroCajaSql` (el cruce por origen es un `EXISTS` que el `where` de Prisma no expresa) y los
 * TRES caminos —paginar, contar y agregar— usan ese mismo WHERE: por construccion, las tarjetas y el
 * desglose suman exactamente las filas del libro filtrado.
 */
function conAQuien<F extends BalanceFiltros>(f: F): (F & { aQuien: AQuienFiltro }) | null {
  return f.aQuien === undefined ? null : (f as F & { aQuien: AQuienFiltro });
}

/** Una suma por grupo, leida en SQL: `numeric` llega como `Prisma.Decimal` (nunca `number`). */
type GrupoSql = { categoria: WalletMovimientoCategoria; tipo: MovimientoRow["tipo"]; total: Prisma.Decimal | null };

/**
 * Ficha 458-E (R59): `SUM(monto)` por (categoria, tipo) con el WHERE de «A quién». Funcion del modulo
 * y no metodo: la superficie de la clase sigue siendo la de R47 (nueve metodos, ninguno que escriba).
 */
async function gruposConAQuien(
  prisma: Pick<PrismaClient, "$queryRaw">,
  f: BalanceFiltros & { aQuien: AQuienFiltro },
): Promise<GrupoSql[]> {
  return prisma.$queryRaw<GrupoSql[]>(Prisma.sql`
    SELECT w."categoria"::text AS "categoria", w."tipo"::text AS "tipo", SUM(w."monto") AS "total"
    FROM "wallet_movimiento" w
    WHERE ${whereLibroCajaSql(f)}
    GROUP BY w."categoria", w."tipo"`);
}

/**
 * Revision M1 (458-E): `SUM(monto)` por CATEGORIA con el WHERE de «A quién» — la suma la hace el motor,
 * como el `groupBy(categoria)` del camino sin «A quién». En este repositorio ningun importe se suma en
 * JavaScript (guardia `caja-173-alcance`).
 */
async function categoriasConAQuien(
  prisma: Pick<PrismaClient, "$queryRaw">,
  f: BalanceFiltros & { aQuien: AQuienFiltro },
): Promise<Omit<GrupoSql, "tipo">[]> {
  return prisma.$queryRaw<Omit<GrupoSql, "tipo">[]>(Prisma.sql`
    SELECT w."categoria"::text AS "categoria", SUM(w."monto") AS "total"
    FROM "wallet_movimiento" w
    WHERE ${whereLibroCajaSql(f)}
    GROUP BY w."categoria"`);
}

/**
 * Feature 42 — repositorio del LIBRO de movimientos de la wallet. SOLO queries Prisma.
 * Inserta idempotentemente (skipDuplicates -> ON CONFLICT DO NOTHING, R6/R13), lista
 * paginado por fecha desc con filtros en el WHERE (R20/R24) y agrega por (categoria, tipo)
 * con esos mismos filtros (feature 173/R8).
 *
 * INMUTABLE (R3/R47): no expone `update` ni `delete`, y con la 173 sigue sin exponerlos —
 * una correccion es un movimiento compensatorio, no una edicion.
 */
export class WalletMovimientoRepository implements IWalletMovimientoRepository, ISaldoCorridoCajaRepository {
  constructor(private readonly prisma: WalletPrismaClient) {}

  /** R6/R13: inserta en la tx `tx` con skipDuplicates (no TOCTOU); devuelve filas insertadas. */
  async crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number> {
    if (movs.length === 0) return 0;
    const data = movs.map((m) => ({
      // Ficha 334 (design §5, R28): la clave SOLO viaja si el llamador la trae, exactamente
      // como `fechaMovimiento` aqui abajo. Omitirla —en vez de mandar `undefined`— es lo que
      // deja a los cinco escritores existentes cayendo en el `@default(uuid())` de la columna.
      ...(m.id !== undefined ? { id: m.id } : {}),
      tipo: m.tipo,
      categoria: m.categoria,
      monto: new Prisma.Decimal(m.monto), // STRING -> Decimal (money-safe)
      origenTipo: m.origenTipo,
      origenId: m.origenId,
      descripcion: m.descripcion ?? null,
      registradoPor: m.registradoPor ?? null,
      // Feature 173 (design §2.3, R20/R25): la clave SOLO viaja si el llamador la trae. Se
      // omite —en vez de mandar `undefined`— para que quien no la pasa siga cayendo en el
      // `DEFAULT CURRENT_TIMESTAMP` de la columna, exactamente como hasta hoy.
      ...(m.fechaMovimiento !== undefined ? { fechaMovimiento: m.fechaMovimiento } : {}),
      // Ficha 461 (R66/R67): la clave de idempotencia del cliente, SOLO si el llamador la trae. Con
      // `skipDuplicates`, un choque en su indice UNIQUE deja la fila fuera y `count` en 0.
      ...(m.claveIdempotencia !== undefined ? { claveIdempotencia: m.claveIdempotencia } : {}),
    }));
    const res = await tx.walletMovimiento.createMany({ data, skipDuplicates: true });
    return res.count;
  }

  /**
   * FICHA 362 (R6/R9/R11) — el escritor de los TRES movimientos que nacen de una DECISION
   * HUMANA: el ajuste manual de caja y los dos del egreso administrativo (registro y reverso).
   *
   * POR QUE UN METODO APARTE Y NO INSTRUMENTAR `crearMovimientos`. Ese metodo lo comparten los
   * feeds de la aprobacion de un cierre: instrumentarlo escribiria una fila de auditoria por CADA
   * uno de los ~34 asientos que emite aprobar un cierre, y el design §0 lo descarta con nombre
   * —«se registra la DECISION, no sus asientos»—. Los asientos automaticos ya son inmutables y
   * consultables en `/wallet`.
   *
   * Abre su PROPIA `$transaction` (forma 2 del design §2.3) porque estos tres caminos no tenian
   * ninguna: eran un `createMany` suelto contra el cliente de escritura. El registro va DESPUES
   * de comprobar el `count`: un reverso que el indice unico parcial deduplica (`count === 0`,
   * `already_reversed`) NO deja fila de auditoria de algo que no ocurrio (R11).
   */
  async crearMovimientoRegistrado(
    mov: CrearMovimientoInput & { id: string },
    registro: { accion: HistorialAccionTipo; actorUsuarioId: string | null },
    laterales: LateralesDelRegistro = {},
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const count = await this.crearMovimientos(tx, [mov]);
      if (count === 0) return 0;

      // FICHA 458-B (R42/R74): lo lateral, en ESTA transaccion y solo si el asiento se escribio.
      if (laterales.anotacion !== undefined) {
        await tx.walletAnotacion.create({
          data: {
            movimientoId: mov.id,
            contraparteNombre: laterales.anotacion.contraparteNombre,
            referencia: laterales.anotacion.referencia,
          },
        });
      }
      if (laterales.comprobante !== undefined) {
        await tx.walletComprobante.create({
          data: {
            cajaMovimientoId: mov.id,
            storagePath: laterales.comprobante.storagePath,
            contentType: laterales.comprobante.contentType,
            subidoPor: laterales.comprobante.subidoPor,
          },
        });
      }

      const actor = await resolverActorCongelado(tx, registro.actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: registro.accion,
          entidadTipo: "wallet_movimiento",
          entidadId: mov.id,
          // La CATEGORIA del movimiento (un enum), no su `descripcion`: esa columna es texto
          // libre tecleado por una persona y R5 la deja fuera.
          entidadEtiqueta: etiquetaDeEntidad("wallet_movimiento", { categoria: mov.categoria }),
          // `monto` llega como STRING money-safe y se convierte a `Decimal` aqui, igual que en
          // la propia columna del libro. Ni un `Number()` en el camino (R6).
          monto: new Prisma.Decimal(mov.monto),
          ...actor,
        },
      ]);
      return count;
    });
  }

  /**
   * R20/R24: pagina el libro, mas reciente primero salvo `sortDir: "asc"` (ficha 463), filtros en el WHERE.
   *
   * Ficha 334 (R26, design §4) — el orden es TOTAL, no solo por fecha. Ordenar por UNA columna
   * y paginar con `skip`/`take` deja las filas que empatan en orden indefinido, y eso significa
   * una fila que sale DOS veces o NINGUNA al pasar de pagina. Ya podia pasar (dos pagos a
   * tienda del mismo dia reciben el mismo instante); con la fecha elegida por el usuario, dos
   * movimientos del mismo dia pasado reciben EXACTAMENTE el mismo `06:00Z` y el empate deja de
   * ser raro. `createdAt` desempata por creacion real —que es la semantica de esa columna— e
   * `id` cierra el orden aunque dos filas compartieran tambien `created_at`.
   *
   * Sin indice nuevo a proposito: el desempate solo actua DENTRO de un `fecha_movimiento`
   * identico, y `@@index([fechaMovimiento])` sigue sirviendo al filtro de rango.
   */
  async listar(filtros: ListarMovimientosFiltros): Promise<ListarMovimientosPage> {
    const skip = (filtros.page - 1) * filtros.pageSize;
    // FICHA 463 (R33/R36): el sentido lo elige quien lee; ausente, lo mas nuevo primero (el de siempre).
    // Las TRES columnas van en el MISMO sentido: el desempate invertido respecto de la fecha seguiria
    // siendo total, pero el «Mas antiguas» de dos filas del mismo instante no seria el reverso exacto
    // del «Mas recientes».
    const sentido: DireccionOrden = filtros.sortDir ?? "desc";
    if (filtros.aQuien !== undefined || filtros.termino !== undefined || filtros.porGuia !== undefined) {
      // Ficha 458-E (R59) y 463 (R24/R25): el MISMO orden total de abajo, en SQL, sobre el WHERE con
      // «A quién» y/o el termino. El conteo usa el MISMO WHERE: la pagina y el total no discrepan.
      // FICHA 469 (R16/R19/R20): la busqueda por guia va por este mismo camino (mismo WHERE en la pagina
      // y en el conteo, mismo orden total).
      const where = whereLibroCajaConTerminoSql(filtros);
      const dir = sentido === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const orden = Prisma.join(
        ordenTotal(
          [Prisma.sql`w."fecha_movimiento" ${dir}`, Prisma.sql`w."created_at" ${dir}`],
          Prisma.sql`w."id" ${dir}`,
        ),
        ", ",
      );
      const [rows, cuenta] = await Promise.all([
        this.prisma.$queryRaw<MovimientoRow[]>(Prisma.sql`
          SELECT w."id", w."tipo"::text AS "tipo", w."categoria"::text AS "categoria", w."monto",
                 w."origen_tipo"::text AS "origenTipo", w."origen_id" AS "origenId", w."descripcion",
                 w."registrado_por" AS "registradoPor", w."fecha_movimiento" AS "fechaMovimiento",
                 w."created_at" AS "createdAt", w."clave_idempotencia" AS "claveIdempotencia"
          FROM "wallet_movimiento" w
          WHERE ${where}
          ORDER BY ${orden}
          OFFSET ${skip} LIMIT ${filtros.pageSize}`),
        this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
          SELECT COUNT(*)::int AS "total" FROM "wallet_movimiento" w WHERE ${where}`),
      ]);
      return { movimientos: rows.map(toDTO), total: cuenta[0]?.total ?? 0 };
    }
    const where = buildWhere(filtros);
    const [rows, total] = await Promise.all([
      this.prisma.walletMovimiento.findMany({
        where,
        orderBy: ordenTotal<Prisma.WalletMovimientoOrderByWithRelationInput>(
          [{ fechaMovimiento: sentido }, { createdAt: sentido }],
          { id: sentido },
        ),
        skip,
        take: filtros.pageSize,
      }),
      this.prisma.walletMovimiento.count({ where }),
    ]);
    return { movimientos: rows.map(toDTO), total };
  }

  /**
   * Feature 173 (T D.1, R8/R47): `groupBy(categoria, tipo)` + `SUM(monto)` con los MISMOS
   * filtros del listado. Salida STRING escala 2 (money-safe: `Prisma.Decimal` dentro, `number`
   * en ninguna parte).
   *
   * Solo agrega. Ni particiona por naturaleza ni resta: eso es de `derivarCaja`, que es pura.
   */
  async agregarPorCategoriaYTipo(filtros: BalanceFiltros): Promise<readonly AgregadoCajaRow[]> {
    const f = conAQuien(filtros);
    if (f !== null) {
      // Ficha 458-E (R59): la misma agrupacion sobre el MISMO WHERE que `listar` con «A quién».
      const grupos = await gruposConAQuien(this.prisma, f);
      return grupos.map((g) => ({
        categoria: g.categoria,
        tipo: g.tipo,
        total: (g.total ?? new Prisma.Decimal(0)).toFixed(2),
      }));
    }
    const where = buildWhere(filtros);
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where,
      _sum: { monto: true },
    });
    return grupos.map((g) => ({
      categoria: g.categoria,
      tipo: g.tipo,
      total: (g._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
    }));
  }

  /**
   * Ficha 468 (design §3.4, R12/R15) — el saldo de la caja ENTERA tras cada movimiento de la descarga.
   *
   * Molde de `EstadoCuentaRepository.paginaDeTienda`: la ventana corre sobre TODO el libro (hasta el
   * corte), con el MISMO orden total que `listar` en ascendente (fecha, `created_at`, `id`), y la consulta
   * exterior se queda con los ids pedidos (≤ tope de descarga). La suma la hace el motor: aqui no se suma
   * ningun importe en JavaScript.
   *
   * El signo lo da el TIPO y la cubeta la lista `efectivo` que manda el servicio (derivada de
   * `LIQUIDEZ_POR_CATEGORIA`, igual que `acumular` de `derivarCaja`): un cargo a tienda no mueve el saldo.
   * El servicio AFIRMA que el saldo de la ultima fila es el `enCaja` de la tarjeta.
   */
  async saldosTrasMovimientos(
    ids: readonly string[],
    efectivo: readonly WalletMovimientoCategoria[],
    hasta?: Date,
  ): Promise<Map<string, string>> {
    const saldos = new Map<string, string>();
    if (ids.length === 0) return saldos;
    const corte = hasta === undefined ? Prisma.sql`TRUE` : Prisma.sql`w."fecha_movimiento" < ${hasta}`;
    // Las dos sumas son de `w."monto"` (guardia `caja-173-alcance`): lo que entro de verdad menos lo que
    // salio de verdad, cada una con su FILTER. Mismo orden total en las dos ventanas.
    const ventana = Prisma.sql`OVER (
                 ORDER BY w."fecha_movimiento" ASC, w."created_at" ASC, w."id" ASC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               )`;
    const filas = await this.prisma.$queryRaw<{ id: string; entro: Prisma.Decimal | null; salio: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT t."id", t."entro", t."salio"
      FROM (
        SELECT w."id",
               SUM(w."monto") FILTER (WHERE w."categoria"::text = ANY(${[...efectivo]}::text[]) AND w."tipo" = 'ingreso') ${ventana} AS "entro",
               SUM(w."monto") FILTER (WHERE w."categoria"::text = ANY(${[...efectivo]}::text[]) AND w."tipo" = 'egreso') ${ventana} AS "salio"
        FROM "wallet_movimiento" w
        WHERE ${corte}
      ) t
      WHERE t."id" = ANY(${[...ids]}::text[])`);
    // La resta la hace `derivarBalance` (la misma de la tarjeta), no este repositorio.
    for (const f of filas) saldos.set(f.id, derivarBalance(f.entro ?? new Prisma.Decimal(0), f.salio ?? new Prisma.Decimal(0)).balance);
    return saldos;
  }

  /** Feature 45 (R13): lee un movimiento por id (para la reversa). null si no existe. */
  async obtenerPorId(id: string): Promise<WalletMovimientoDTO | null> {
    const row = await this.prisma.walletMovimiento.findUnique({ where: { id } });
    return row === null ? null : toDTO(row);
  }

  /** Ficha 461 (R68): la fila que lleva ESA clave de idempotencia (columna UNIQUE), o null. */
  async obtenerPorClave(claveIdempotencia: string): Promise<WalletMovimientoDTO | null> {
    const row = await this.prisma.walletMovimiento.findUnique({ where: { claveIdempotencia } });
    return row === null ? null : toDTO(row);
  }

  /**
   * Ficha 333 (C2, design §2/§6.3) — el movimiento que ocupa la clave `(origen_tipo, origen_id,
   * categoria)`, o `null`. Es la terna de `wallet_movimiento_origen_categoria_uq`, así que hay
   * como mucho una fila; `findFirst` y no `findUnique` porque ese índice es PARCIAL
   * (`WHERE origen_id IS NOT NULL`) y Prisma no lo expresa como clave única del cliente.
   *
   * Lee DENTRO del `tx` que le pasan: quien la llama acaba de intentar la escritura en esa misma
   * transacción y necesita ver lo que esa transacción ve.
   *
   * NO añade ninguna mutación: el libro sigue siendo append-only e inmutable (R3 de la 42) y
   * esta clase sigue sin exponer `update` ni `delete`.
   */
  async obtenerPorOrigen(
    tx: WalletTxClient,
    origenTipo: WalletOrigenTipo,
    origenId: string,
    categoria: WalletMovimientoCategoria,
  ): Promise<WalletMovimientoDTO | null> {
    const row = await tx.walletMovimiento.findFirst({
      where: { origenTipo, origenId, categoria },
    });
    return row === null || row === undefined ? null : toDTO(row);
  }

  /**
   * Ficha 459 (design §2.5, R15/R71) — el dia CR del primer movimiento de la caja, o `null`.
   *
   * `MIN(fecha_movimiento)` sobre el indice `wallet_movimiento_fecha_movimiento_idx`, y el dia se
   * resuelve con `fechaCalendarioCR` (la convencion CR del repo, UTC−6). Con `excluirCapital`, el
   * `WHERE` deja fuera las categorias que `NATURALEZA_POR_CATEGORIA` declara `capital`.
   */
  async primerDiaDeLaCaja(opciones: { excluirCapital?: boolean } = {}): Promise<string | null> {
    const where: Prisma.WalletMovimientoWhereInput =
      opciones.excluirCapital === true ? { categoria: { notIn: [...CATEGORIAS_DE_CAPITAL] } } : {};
    const agregado = await this.prisma.walletMovimiento.aggregate({
      where,
      _min: { fechaMovimiento: true },
    });
    const primero = agregado._min.fechaMovimiento;
    return primero === null ? null : fechaCalendarioCR(primero);
  }

  /** Feature 45 (R11): SUM(monto) por categoria administrativa, con los mismos filtros. STRING. */
  async agregarPorCategoria(filtros: BalanceFiltros): Promise<DesgloseEgresosAgregado> {
    const f = conAQuien(filtros);
    if (f !== null) {
      // Ficha 458-E (R59): con «A quién», la suma por categoria la hace el motor sobre el MISMO WHERE
      // que el libro (revision M1: ninguna suma de importes en JavaScript).
      const grupos = await categoriasConAQuien(this.prisma, f);
      const sumaConAQuien = (categoria: string): string =>
        (grupos.find((g) => g.categoria === categoria)?.total ?? new Prisma.Decimal(0)).toFixed(2);
      return {
        gastoFijo: sumaConAQuien("egreso_gasto_fijo"),
        gastoVariable: sumaConAQuien("egreso_gasto_variable"),
        sueldo: sumaConAQuien("egreso_sueldo"),
        indemnizacion: sumaConAQuien("egreso_indemnizacion"),
      };
    }
    const where = buildWhere(filtros);
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria"],
      where,
      _sum: { monto: true },
    });
    const sumaDe = (categoria: string): string => {
      const g = grupos.find((x) => x.categoria === categoria);
      return (g?._sum.monto ?? new Prisma.Decimal(0)).toFixed(2);
    };
    return {
      gastoFijo: sumaDe("egreso_gasto_fijo"),
      gastoVariable: sumaDe("egreso_gasto_variable"),
      sueldo: sumaDe("egreso_sueldo"),
      indemnizacion: sumaDe("egreso_indemnizacion"), // feature 158/R32
    };
  }
}
