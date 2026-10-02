import { Prisma } from "@prisma/client";

import type { AQuienCuentaTipo, AQuienFiltro } from "@/lib/types/libro-caja-a-quien";
import type { WalletMovimientoCategoria, WalletMovimientoTipo, WalletOrigenTipo } from "@/lib/types/wallet";
import { CATEGORIAS_CONTRA_ASIENTO_ANOTADO } from "@/lib/utils/anotacion-de-fila";
import { escaparComodinesLike } from "@/lib/utils/escapar-like";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-E (TE.2, R59; design §3.4 y §6) — «A quién» del libro de la caja, EN SQL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// UNA sola definicion del cruce «fila de la caja → a quien», compartida por:
//   · el FILTRO del libro (`WalletMovimientoRepository`: libro, tarjetas, composicion, desglose y
//     descarga) y el conteo de conceptos (`FiltrosWalletRepository.contarConceptosCaja`);
//   · las OPCIONES del selector (`FiltrosWalletRepository.quienesDelLibroCaja`).
// Asi el selector no puede ofrecer una cuenta que el filtro no encuentre, ni al reves.
//
// Es la tabla de `LibroCajaAutoriaService.aQuien` (la columna «A quién» del libro), traducida:
//
//   origen                                       a quien                        documento (alias `d`)
//   cierre_dia                                   el mensajero del cierre        cierre_dia
//   pago_tienda / pago_mensajero                 la tienda del pago, y si no    liquidacion_pago
//                                                tiene tienda, su mensajero
//   gestion_orden                                la tienda del cobro por        rechazo_tienda_cobro
//                                                rechazo (por su gestion)       (gestion_id)
//   ranking_snapshot_fila                        el mensajero del podio         ranking_snapshot_fila
//   orden_incidente                              la tienda de la orden          orden_incidente + orden
//   pago_por_cuenta_tienda                       la tienda del documento        pago_por_cuenta_tienda
//   cobro_tienda(_completado),                   la tienda del debito           wallet_tienda_movimiento
//   cobro_manual_reclasificado
//   abono_tienda                                 la tienda que pago             abono_tienda
//   gasto / manual                               el nombre libre anotado        wallet_anotacion
//   aporte_capital                               «Ordenex»: no es una cuenta ni un nombre (no se filtra)
//
// POR QUE SQL Y NO UN `IN` DE IDS. `origen_id` es polimorfico (no hay relacion de Prisma que cruzar),
// y resolver antes los ids de la cuenta para mandarlos en un `IN` crece con la historia de esa cuenta
// hasta el tope de parametros de Postgres (32.767) — el fallo que la revision de la 458-A (m4) ya
// retiro de `cierresDeTienda`. Aqui cada condicion es un `EXISTS` correlacionado: la consulta lleva
// SIEMPRE los mismos parametros, tenga la cuenta 3 filas o 300.000.

/** Una forma de llegar de una fila de la caja (`w`) a la cuenta de su documento (`d`). */
interface RamaDeCuenta {
  cuenta: AQuienCuentaTipo;
  /** Las tablas del documento, con alias `d` (y las que haga falta unir). */
  tablas: Prisma.Sql;
  /** Lo que une el documento con la fila `w` (y lo que decide la rama). */
  union: Prisma.Sql;
  /** La columna con el id de la cuenta. */
  columna: Prisma.Sql;
}

const CIERRE: RamaDeCuenta = {
  cuenta: "mensajero",
  tablas: Prisma.sql`"cierre_dia" d`,
  union: Prisma.sql`d."id" = w."origen_id"`,
  columna: Prisma.sql`d."mensajero_id"`,
};
// El pago de la 172: a una tienda si tiene tienda; si no, al mensajero (el orden de
// `LibroCajaAutoriaRepository.pagos`: la tienda primero).
const PAGO_A_TIENDA: RamaDeCuenta = {
  cuenta: "tienda",
  tablas: Prisma.sql`"liquidacion_pago" d`,
  union: Prisma.sql`d."id" = w."origen_id" AND d."tienda_id" IS NOT NULL`,
  columna: Prisma.sql`d."tienda_id"`,
};
const PAGO_A_MENSAJERO: RamaDeCuenta = {
  cuenta: "mensajero",
  tablas: Prisma.sql`"liquidacion_pago" d`,
  union: Prisma.sql`d."id" = w."origen_id" AND d."tienda_id" IS NULL`,
  columna: Prisma.sql`d."mensajero_id"`,
};
const RECHAZO: RamaDeCuenta = {
  cuenta: "tienda",
  tablas: Prisma.sql`"rechazo_tienda_cobro" d`,
  union: Prisma.sql`d."gestion_id" = w."origen_id"`,
  columna: Prisma.sql`d."tienda_id"`,
};
const PODIO: RamaDeCuenta = {
  cuenta: "mensajero",
  tablas: Prisma.sql`"ranking_snapshot_fila" d`,
  union: Prisma.sql`d."id" = w."origen_id"`,
  columna: Prisma.sql`d."mensajero_id"`,
};
const INCIDENTE: RamaDeCuenta = {
  cuenta: "tienda",
  tablas: Prisma.sql`"orden_incidente" d JOIN "orden" o ON o."id" = d."orden_id"`,
  union: Prisma.sql`d."id" = w."origen_id"`,
  columna: Prisma.sql`o."tienda_id"`,
};
const PAGO_POR_CUENTA: RamaDeCuenta = {
  cuenta: "tienda",
  tablas: Prisma.sql`"pago_por_cuenta_tienda" d`,
  union: Prisma.sql`d."id" = w."origen_id"`,
  columna: Prisma.sql`d."tienda_id"`,
};
const DEBITO_DE_TIENDA: RamaDeCuenta = {
  cuenta: "tienda",
  tablas: Prisma.sql`"wallet_tienda_movimiento" d`,
  union: Prisma.sql`d."id" = w."origen_id"`,
  columna: Prisma.sql`d."tienda_id"`,
};
const ABONO: RamaDeCuenta = {
  cuenta: "tienda",
  tablas: Prisma.sql`"abono_tienda" d`,
  union: Prisma.sql`d."id" = w."origen_id"`,
  columna: Prisma.sql`d."tienda_id"`,
};

/**
 * `Record` TOTAL sobre los origenes: el dia que la caja gane un origen, esto deja de compilar hasta
 * que alguien decida a quien se le paga ese dinero (y lo mismo tendra que decidir «A quién»).
 */
const A_QUIEN_POR_ORIGEN: Record<WalletOrigenTipo, readonly RamaDeCuenta[] | "anotacion" | "ordenex"> = {
  cierre_dia: [CIERRE],
  gestion_orden: [RECHAZO],
  manual: "anotacion",
  pago_tienda: [PAGO_A_TIENDA, PAGO_A_MENSAJERO],
  pago_mensajero: [PAGO_A_TIENDA, PAGO_A_MENSAJERO],
  gasto: "anotacion",
  orden_incidente: [INCIDENTE],
  ranking_snapshot_fila: [PODIO],
  pago_por_cuenta_tienda: [PAGO_POR_CUENTA],
  aporte_capital: "ordenex",
  cobro_manual_reclasificado: [DEBITO_DE_TIENDA],
  cobro_tienda: [DEBITO_DE_TIENDA],
  cobro_tienda_completado: [DEBITO_DE_TIENDA],
  abono_tienda: [ABONO],
};

const ORIGENES = Object.keys(A_QUIEN_POR_ORIGEN) as WalletOrigenTipo[];

/** Los origenes cuyo «a quien» es el nombre libre anotado (`wallet_anotacion`). */
const ORIGENES_CON_ANOTACION = ORIGENES.filter((o) => A_QUIEN_POR_ORIGEN[o] === "anotacion");

/** Cada rama con los origenes que la usan, UNA vez por rama (el pago de la 172 tiene dos origenes). */
const RAMAS: readonly { rama: RamaDeCuenta; origenes: readonly WalletOrigenTipo[] }[] = (() => {
  const porRama = new Map<RamaDeCuenta, WalletOrigenTipo[]>();
  for (const origen of ORIGENES) {
    const ramas = A_QUIEN_POR_ORIGEN[origen];
    if (typeof ramas === "string") continue;
    for (const rama of ramas) porRama.set(rama, [...(porRama.get(rama) ?? []), origen]);
  }
  return [...porRama].map(([rama, origenes]) => ({ rama, origenes }));
})();

function origenDe(origenes: readonly WalletOrigenTipo[]): Prisma.Sql {
  return Prisma.sql`w."origen_tipo"::text IN (${Prisma.join(origenes)})`;
}

/** El nombre libre, sin mayusculas ni espacios de los bordes (el indice de la 458-B es `lower`). */
function nombreNormalizado(columna: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lower(btrim(${columna}))`;
}

/**
 * Revision M2 (458-E): el id de la fila cuya anotacion vale para `w` — la ORIGINAL si `w` es el
 * contra-asiento de un egreso o de una correccion anulados, `w` si no. El gemelo SQL de
 * `movimientoDeLaAnotacion` (`lib/utils/anotacion-de-fila.ts`), que usa la columna «A quién».
 */
const MOVIMIENTO_DE_LA_ANOTACION = Prisma.sql`(CASE WHEN w."origen_id" IS NOT NULL AND w."categoria"::text IN (${Prisma.join([
  ...CATEGORIAS_CONTRA_ASIENTO_ANOTADO,
])}) THEN w."origen_id" ELSE w."id" END)`;

/**
 * La condicion «A quién» sobre la fila `w` de `wallet_movimiento`. Una cuenta: alguna de sus ramas
 * encuentra un documento de ESA cuenta. Un nombre: la anotacion de la fila (o, si es un contra-asiento,
 * la de su original: revision M2) lleva ese nombre.
 */
export function condicionAQuienSql(aQuien: AQuienFiltro): Prisma.Sql {
  if ("nombre" in aQuien) {
    return Prisma.sql`(${origenDe(ORIGENES_CON_ANOTACION)} AND EXISTS (
      SELECT 1 FROM "wallet_anotacion" a
      WHERE a."movimiento_id" = ${MOVIMIENTO_DE_LA_ANOTACION}
        AND ${nombreNormalizado(Prisma.sql`a."contraparte_nombre"`)} = ${nombreNormalizado(Prisma.sql`${aQuien.nombre}`)}
    ))`;
  }
  const ramas = RAMAS.filter((r) => r.rama.cuenta === aQuien.tipo);
  return Prisma.sql`(${Prisma.join(
    ramas.map(
      ({ rama, origenes }) => Prisma.sql`(${origenDe(origenes)} AND EXISTS (
        SELECT 1 FROM ${rama.tablas} WHERE ${rama.union} AND ${rama.columna} = ${aQuien.id}
      ))`,
    ),
    " OR ",
  )})`;
}

/** Los filtros del libro que no son «A quién», en SQL: los de `buildWhere`, uno a uno. */
export interface FiltrosComunesSql {
  tipo?: WalletMovimientoTipo;
  categoria?: WalletMovimientoCategoria;
  categorias?: readonly WalletMovimientoCategoria[];
  desde?: Date;
  hasta?: Date;
}

/**
 * El gemelo en SQL de `buildWhere` (`WalletMovimientoRepository`) — misma semantica, condicion a
 * condicion: `desde` inclusivo y `hasta` EXCLUSIVO (461/R72); `categorias` en `AND` con `categoria`
 * y el conjunto vacio = ninguna fila (339/R33). Solo se usa cuando hay «A quién»; sin el, manda
 * `buildWhere`. `tests/integration/db/libro-caja-filtro-a-quien.test.ts` afirma que los dos
 * devuelven las mismas filas con los mismos filtros.
 */
export function condicionesComunesSql(f: FiltrosComunesSql): Prisma.Sql[] {
  const partes: Prisma.Sql[] = [];
  if (f.tipo !== undefined) partes.push(Prisma.sql`w."tipo"::text = ${f.tipo}`);
  if (f.categoria !== undefined) partes.push(Prisma.sql`w."categoria"::text = ${f.categoria}`);
  if (f.categorias !== undefined) {
    partes.push(
      f.categorias.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`w."categoria"::text IN (${Prisma.join([...f.categorias])})`,
    );
  }
  if (f.desde !== undefined) partes.push(Prisma.sql`w."fecha_movimiento" >= ${f.desde}`);
  if (f.hasta !== undefined) partes.push(Prisma.sql`w."fecha_movimiento" < ${f.hasta}`);
  return partes;
}

/** El WHERE entero del libro con «A quién»: la condicion de la cuenta y los demas filtros. */
export function whereLibroCajaSql(f: FiltrosComunesSql & { aQuien: AQuienFiltro }): Prisma.Sql {
  return Prisma.join([condicionAQuienSql(f.aQuien), ...condicionesComunesSql(f)], " AND ");
}

function whereOVerdadero(partes: readonly Prisma.Sql[]): Prisma.Sql {
  return partes.length === 0 ? Prisma.sql`TRUE` : Prisma.join([...partes], " AND ");
}

/**
 * Las CUENTAS con filas en la caja bajo esos filtros, con cuantas filas y las tres columnas del
 * nombre de la persona. Una fila por cuenta (el agrupado lo hace el motor; la salida crece con el
 * numero de tiendas y mensajeros, nunca con el de movimientos, y no lleva ningun `IN`).
 */
export function cuentasConMovimientosSql(f: FiltrosComunesSql): Prisma.Sql {
  const filtro = whereOVerdadero(condicionesComunesSql(f));
  const porRama = RAMAS.map(
    ({ rama, origenes }) => Prisma.sql`
      SELECT ${rama.cuenta}::text AS "tipo", ${rama.columna} AS "cuentaId", COUNT(*) AS "n"
      FROM "wallet_movimiento" w, ${rama.tablas}
      WHERE ${rama.union} AND ${origenDe(origenes)} AND ${rama.columna} IS NOT NULL AND ${filtro}
      GROUP BY ${rama.columna}`,
  );
  return Prisma.sql`
    SELECT q."tipo", q."cuentaId", u."nombre", u."primer_apellido" AS "primerApellido",
           u."segundo_apellido" AS "segundoApellido", SUM(q."n")::int AS "movimientos"
    FROM (${Prisma.join(porRama, " UNION ALL ")}) q
    JOIN "usuario" u ON u."id" = q."cuentaId"
    GROUP BY q."tipo", q."cuentaId", u."nombre", u."primer_apellido", u."segundo_apellido"`;
}

/**
 * Los NOMBRES LIBRES anotados en filas de la caja bajo esos filtros, agrupados sin mayusculas ni
 * espacios de los bordes (la misma normalizacion del filtro), con cuantas filas. El nombre que se
 * muestra es uno de los escritos (el menor en orden de la base), siempre recortado. El contra-asiento
 * de una fila anotada cuenta con el nombre de su original (revision M2), como en el filtro.
 */
export function nombresConMovimientosSql(f: FiltrosComunesSql): Prisma.Sql {
  const filtro = whereOVerdadero(condicionesComunesSql(f));
  const clave = nombreNormalizado(Prisma.sql`a."contraparte_nombre"`);
  return Prisma.sql`
    SELECT MIN(btrim(a."contraparte_nombre")) AS "nombre", COUNT(*)::int AS "movimientos"
    FROM "wallet_movimiento" w
    JOIN "wallet_anotacion" a ON a."movimiento_id" = ${MOVIMIENTO_DE_LA_ANOTACION}
    WHERE ${origenDe(ORIGENES_CON_ANOTACION)} AND a."contraparte_nombre" IS NOT NULL
      AND btrim(a."contraparte_nombre") <> '' AND ${filtro}
    GROUP BY ${clave}`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 463 (design §3.1, R24/R25/R28) — el BUSCADOR del libro de la caja, EN SQL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El texto buscable de una fila (R25) es: su descripcion, el nombre y la referencia ANOTADOS y el
// nombre de quien la registro. La anotacion se lee con la MISMA regla que la columna «A quién» y el
// filtro de arriba (revision M2 de la 458-E): el contra-asiento de un egreso o de una correccion
// anulados lleva la anotacion de su ORIGINAL, asi que buscar «Pedro» trae la salida y su vuelta, como
// las enseña la columna. Las dos relaciones son 0..1 y entran como `EXISTS`: no multiplican filas.
//
// `%` y `_` del termino se buscan como TEXTO (R28): `escaparComodinesLike` les antepone `\`, que es el
// escape por defecto de `LIKE` en Postgres. Sin el, buscar «%» devolveria el libro entero.

/**
 * El nombre COMPLETO de quien registro (alias `ur`): el gemelo SQL de `nombreCompletoUsuario`, escrito
 * con `Prisma.sql` y no con `Prisma.raw(nombreCompletoUsuarioSql(…))`: este modulo no lleva SQL crudo
 * (guardia `caja-173-alcance`, M1 de la 458-E). Misma expresion que `NOMBRE_SQL` del estado de cuenta.
 */
const NOMBRE_REGISTRADOR = Prisma.sql`trim(concat_ws(' ', ur."nombre", ur."primer_apellido", ur."segundo_apellido"))`;

/** El patron `ILIKE` de un termino: subcadena en cualquier posicion, comodines escapados (R28). */
export function patronDeTermino(termino: string): string {
  return `%${escaparComodinesLike(termino)}%`;
}

/**
 * La condicion del termino sobre la fila `w` de `wallet_movimiento` (R24/R25/R28). `ILIKE`: sin
 * distinguir mayusculas de minusculas. Cuatro campos en `OR`; quitar cualquiera de ellos pone rojo
 * `tests/integration/db/libro-caja-busqueda-orden-463.test.ts` (mutaciones en `progress/impl_463.md`).
 */
export function condicionTerminoCajaSql(termino: string): Prisma.Sql {
  const patron = patronDeTermino(termino);
  return Prisma.sql`(
    w."descripcion" ILIKE ${patron}
    OR (${origenDe(ORIGENES_CON_ANOTACION)} AND EXISTS (
      SELECT 1 FROM "wallet_anotacion" a
      WHERE a."movimiento_id" = ${MOVIMIENTO_DE_LA_ANOTACION}
        AND (a."contraparte_nombre" ILIKE ${patron} OR a."referencia" ILIKE ${patron})
    ))
    OR EXISTS (
      SELECT 1 FROM "usuario" ur
      WHERE ur."id" = w."registrado_por" AND ${NOMBRE_REGISTRADOR} ILIKE ${patron}
    )
  )`;
}

/**
 * El WHERE del libro de la caja con lo que el `where` de Prisma no expresa: «A quién» (458-E) y/o el
 * termino (463). Los dos son opcionales; los demas filtros son los de `buildWhere`, uno a uno
 * (`condicionesComunesSql`). Con «A quién» y sin termino es, condicion a condicion, `whereLibroCajaSql`.
 */
export function whereLibroCajaConTerminoSql(
  f: FiltrosComunesSql & { aQuien?: AQuienFiltro; termino?: string },
): Prisma.Sql {
  const partes: Prisma.Sql[] = [];
  if (f.aQuien !== undefined) partes.push(condicionAQuienSql(f.aQuien));
  partes.push(...condicionesComunesSql(f));
  if (f.termino !== undefined) partes.push(condicionTerminoCajaSql(f.termino));
  return whereOVerdadero(partes);
}
