import { Prisma, type PrismaClient } from "@prisma/client";

// Feature 127 / TANDA C — BASE DE DATOS FALSA, PERO NO COMPLACIENTE.
//
// Los tests de los repositorios de la 127 no pueden usar un mock que devuelva la respuesta
// esperada: con eso, quitarle el `WHERE` al repositorio no pondria nada rojo. Este fake EJECUTA
// el `where`, el `groupBy`, el `_sum` y el `orderBy` contra filas en memoria, asi que la unica
// forma de que un test pase es que la consulta diga de verdad lo que el test afirma.
//
// Tres decisiones que lo hacen morder:
//
//  1. **Un operador que no entiende NO se ignora: lanza.** Si un repositorio filtrara con `not`,
//     `contains` o cualquier cosa que este fake no implemente, el test explota en vez de pasar
//     por la via del "no aplico el filtro y salio bien".
//  2. **Sin `orderBy`, los grupos salen en orden INVERSO al de insercion.** Postgres no promete
//     orden y una base falsa que lo prometiera dejaria pasar un repositorio sin `orderBy` (R28).
//     Aqui, olvidarlo se ve.
//  3. **Registra cada llamada** (`llamadas`), para que un test pueda afirmar QUE tabla se toco y
//     con que `where` — que es como se comprueba "sin cota inferior" (R21) o "las dos vistas no
//     se funden" (R19) sin depender de que los numeros salgan iguales por casualidad.
//
// El dinero entra como STRING y se guarda como `Prisma.Decimal`: ni un `number` en el camino.
//
// AMPLIADO EN C.4 (2026-08-02), no reemplazado: gana `cierre_bodega` como quinta tabla, el par
// `origen_tipo`/`origen_id` en las tres filas de ledger y la operacion `findMany` con `select`.
// Las tres cosas las pide la conciliacion y ninguna afloja lo de arriba: agrupar por una columna
// que la fila no tiene ahora LANZA, y `findMany` devuelve las columnas de dinero como
// `Prisma.Decimal`, que es lo que Prisma entrega de verdad.

/* -------------------------------------------------------------------------- */
/* Filas de las cuatro tablas que la TANDA C consulta                          */
/* -------------------------------------------------------------------------- */

/**
 * El vinculo cierre ↔ ledger (`origen_tipo` / `origen_id`) es OPCIONAL en las tres filas de
 * ledger: los tests de C.1-C.3 no lo necesitan y sembrarlo ahi solo añadiria ruido. Pero si un
 * repositorio filtra por una columna que la fila no trae, `cumpleWhere` LANZA en vez de
 * ignorarla — asi que el test de C.4 que no la siembre explota, que es lo que se quiere.
 */
interface Origen {
  readonly origenTipo?: string;
  readonly origenId?: string | null;
}

export interface FilaCaja extends Origen {
  readonly categoria: string;
  readonly tipo: string;
  readonly monto: string;
  readonly fechaMovimiento: Date;
}

export interface FilaLedgerTienda extends Origen {
  readonly tiendaId: string;
  readonly categoria: string;
  readonly tipo: string;
  readonly monto: string;
  readonly fechaMovimiento: Date;
}

export interface FilaLedgerMensajero extends Origen {
  readonly mensajeroId: string;
  readonly categoria: string;
  readonly tipo: string;
  readonly monto: string;
  readonly fechaMovimiento: Date;
}

export interface FilaCierreDia {
  readonly id: string;
  /**
   * OPCIONAL y sembrado a proposito en los tests de C.4: un `findMany` sin `select` se lo
   * llevaria en la respuesta, y R14 prohibe que un id de mensajero salga de aqui. Si la columna
   * no estuviera en el fixture, el test que lo vigila pasaria por vacio.
   */
  readonly mensajeroId?: string;
  readonly estado: string;
  readonly totalEfectivo: string;
  readonly totalSimpe: string;
  readonly totalTransferencia: string;
  readonly totalGeneral: string;
  readonly solicitadoAt: Date;
  readonly resueltoAt: Date | null;
}

/** Mismo snapshot que el cierre de dia; el nivel lo distingue la tabla, no la forma. */
export type FilaCierreBodega = FilaCierreDia;

/**
 * AMPLIADO EN LA 180 (T2.5), no reemplazado: el fake gana `$queryRaw`.
 *
 * Un fake NO PUEDE ejecutar `width_bucket` ni el resto del SQL de la particion por cubo, y
 * fingirlo seria peor que no tenerlo: un interprete de SQL escrito a mano en un test es una
 * SEGUNDA implementacion cuyo acuerdo con Postgres nadie comprueba. El reparto es explicito:
 *
 *   - lo que este fake mide es la FORMA de la consulta emitida —el texto con sus `$n` y la lista
 *     de parametros— y el formateo de la respuesta. Con eso muere quien quite la ventana, quien
 *     escriba las categorias a mano, quien olvide el `ORDER BY` o quien pase el dinero por
 *     `number`;
 *   - lo que mide Postgres de verdad, en
 *     `tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`, es la
 *     SEMANTICA: la frontera del dia CR, el cast `::timestamp` y el reparto en cubos.
 *
 * `respuestaCruda` es OBLIGATORIA para quien llame a `$queryRaw`: sin ella el fake LANZA en vez
 * de devolver `[]`. Un `[]` por omision es justo el verde vacio que este archivo existe para
 * evitar (un repositorio con el `WHERE` roto tambien devuelve `[]`).
 */
export interface DatosDinero {
  readonly caja?: readonly FilaCaja[];
  readonly ledgerTienda?: readonly FilaLedgerTienda[];
  readonly ledgerMensajero?: readonly FilaLedgerMensajero[];
  readonly cierresDia?: readonly FilaCierreDia[];
  readonly cierresBodega?: readonly FilaCierreBodega[];
  readonly respuestaCruda?: (consulta: ConsultaCrudaFake) => readonly Registro[];
}

/** El SQL tal y como sale de `Prisma.sql`: texto con `$1..$n` y los parametros, en orden. */
export interface ConsultaCrudaFake {
  readonly texto: string;
  readonly valores: readonly unknown[];
}

export interface LlamadaFake {
  readonly modelo: string;
  readonly operacion: "groupBy" | "aggregate" | "findMany" | "queryRaw";
  readonly args: Record<string, unknown>;
}

type Registro = Record<string, unknown>;

/* -------------------------------------------------------------------------- */
/* Evaluacion del WHERE                                                        */
/* -------------------------------------------------------------------------- */

const OPERADORES = ["in", "notIn", "equals", "gt", "gte", "lt", "lte"] as const;

function comparar(valor: unknown, referencia: unknown): number {
  const a = valor instanceof Date ? valor.getTime() : valor;
  const b = referencia instanceof Date ? referencia.getTime() : referencia;
  if (typeof a !== typeof b) {
    throw new Error(`fake-prisma: comparacion entre tipos distintos (${typeof a} vs ${typeof b})`);
  }
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "string" && typeof b === "string") return a === b ? 0 : a < b ? -1 : 1;
  throw new Error("fake-prisma: solo se comparan fechas, numeros y textos");
}

function cumpleCondicion(valor: unknown, condicion: unknown): boolean {
  if (condicion === null || condicion instanceof Date || typeof condicion !== "object") {
    return valor === condicion || comparableIguales(valor, condicion);
  }
  const cond = condicion as Registro;
  for (const clave of Object.keys(cond)) {
    if (!(OPERADORES as readonly string[]).includes(clave)) {
      throw new Error(
        `fake-prisma: operador "${clave}" no soportado; el fake no se salta filtros en silencio`,
      );
    }
    const esperado = cond[clave];
    if (clave === "in") {
      if (!Array.isArray(esperado) || !esperado.includes(valor)) return false;
      continue;
    }
    if (clave === "notIn") {
      if (Array.isArray(esperado) && esperado.includes(valor)) return false;
      continue;
    }
    if (clave === "equals") {
      if (!(valor === esperado || comparableIguales(valor, esperado))) return false;
      continue;
    }
    // Cotas: un valor NULO nunca entra en un rango (semantica de SQL).
    if (valor === null || valor === undefined) return false;
    const signo = comparar(valor, esperado);
    if (clave === "gt" && !(signo > 0)) return false;
    if (clave === "gte" && !(signo >= 0)) return false;
    if (clave === "lt" && !(signo < 0)) return false;
    if (clave === "lte" && !(signo <= 0)) return false;
  }
  return true;
}

/** Dos `Date` con el mismo instante son el mismo valor aunque no sean el mismo objeto. */
function comparableIguales(a: unknown, b: unknown): boolean {
  return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}

function cumpleWhere(fila: Registro, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  for (const [campo, condicion] of Object.entries(where as Registro)) {
    if (campo.startsWith("$") || campo === "AND" || campo === "OR" || campo === "NOT") {
      throw new Error(`fake-prisma: combinador "${campo}" no soportado`);
    }
    if (!(campo in fila)) {
      throw new Error(`fake-prisma: la tabla no tiene la columna "${campo}"`);
    }
    if (!cumpleCondicion(fila[campo], condicion)) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* groupBy y aggregate                                                         */
/* -------------------------------------------------------------------------- */

interface Grupo {
  readonly clave: Registro;
  readonly sumas: Map<string, Prisma.Decimal>;
  cantidad: number;
}

function camposSumados(args: Registro): readonly string[] {
  const sum = args._sum;
  if (sum === undefined) return [];
  return Object.entries(sum as Registro)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/** Ordena por `orderBy` mirando las claves de cada elemento a traves de `clave`. */
function ordenarPor<T>(items: readonly T[], orderBy: unknown, clave: (x: T) => Registro): T[] {
  if (orderBy === undefined) return [...items];
  const criterios = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Registro[];
  return [...items].sort((a, b) => {
    for (const criterio of criterios) {
      for (const [campo, direccion] of Object.entries(criterio)) {
        const signo = comparar(clave(a)[campo], clave(b)[campo]);
        if (signo !== 0) return direccion === "desc" ? -signo : signo;
      }
    }
    return 0;
  });
}

function ejecutarGroupBy(filas: readonly Registro[], args: Registro): Registro[] {
  const by = args.by as readonly string[];
  const campos = camposSumados(args);
  const seleccionadas = filas.filter((f) => cumpleWhere(f, args.where));

  const grupos = new Map<string, Grupo>();
  for (const fila of seleccionadas) {
    const clave: Registro = {};
    for (const campo of by) {
      // Agrupar por una columna que la fila no tiene daria un grupo `undefined` silencioso.
      if (!(campo in fila)) {
        throw new Error(`fake-prisma: no se puede agrupar por "${campo}": la fila no lo tiene`);
      }
      clave[campo] = fila[campo];
    }
    const id = JSON.stringify(by.map((c) => fila[c]));
    let grupo = grupos.get(id);
    if (grupo === undefined) {
      grupo = { clave, sumas: new Map(), cantidad: 0 };
      grupos.set(id, grupo);
    }
    grupo.cantidad += 1;
    for (const campo of campos) {
      const previo = grupo.sumas.get(campo) ?? new Prisma.Decimal(0);
      grupo.sumas.set(campo, previo.plus(new Prisma.Decimal(String(fila[campo]))));
    }
  }

  // Sin `orderBy`, orden INVERSO al de insercion: la base no promete nada (R28).
  const enOrden =
    args.orderBy === undefined
      ? [...grupos.values()].reverse()
      : ordenarPor([...grupos.values()], args.orderBy, (g) => g.clave);

  return enOrden.map((g) => {
    const salida: Registro = { ...g.clave, _count: { _all: g.cantidad } };
    if (campos.length > 0) {
      const sum: Registro = {};
      for (const campo of campos) sum[campo] = g.sumas.get(campo) ?? new Prisma.Decimal(0);
      salida._sum = sum;
    }
    return salida;
  });
}

function ejecutarAggregate(filas: readonly Registro[], args: Registro): Registro {
  const campos = camposSumados(args);
  const seleccionadas = filas.filter((f) => cumpleWhere(f, args.where));
  const sum: Registro = {};
  for (const campo of campos) {
    // Prisma devuelve `null` cuando el agregado no vio NI UNA fila. Se replica: es el caso
    // que obliga al repositorio a decidir que hace con "no hay nada".
    sum[campo] =
      seleccionadas.length === 0
        ? null
        : seleccionadas.reduce(
            (acc, f) => acc.plus(new Prisma.Decimal(String(f[campo]))),
            new Prisma.Decimal(0),
          );
  }
  return { _sum: sum, _count: seleccionadas.length };
}

/**
 * Columnas que en el esquema son `Decimal(12,2)`. El fake las guarda como STRING (para que el
 * fixture se lea) pero las DEVUELVE como `Prisma.Decimal`, que es lo que Prisma entrega de
 * verdad. Si las devolviera como texto, un repositorio que llamase `.toFixed(2)` reventaria en
 * el test y pasaria en produccion — o al reves, que es peor.
 */
const COLUMNAS_DINERO: ReadonlySet<string> = new Set([
  "monto",
  "totalEfectivo",
  "totalSimpe",
  "totalTransferencia",
  "totalGeneral",
]);

function valorDeColumna(campo: string, valor: unknown): unknown {
  return COLUMNAS_DINERO.has(campo) ? new Prisma.Decimal(String(valor)) : valor;
}

/**
 * `findMany` con `where`, `select` y `orderBy`. Sin `select` devuelve la fila entera, igual que
 * Prisma — y por eso un repositorio que se olvide del `select` se lleva TODAS las columnas
 * sembradas, incluidas las que R14 prohibe publicar: el test lo puede ver.
 */
function ejecutarFindMany(filas: readonly Registro[], args: Registro): Registro[] {
  const seleccionadas = filas.filter((f) => cumpleWhere(f, args.where));
  // Sin `orderBy`, orden INVERSO al de insercion: la base no promete nada (R28).
  const enOrden =
    args.orderBy === undefined
      ? [...seleccionadas].reverse()
      : ordenarPor(seleccionadas, args.orderBy, (f) => f);

  const select = args.select as Registro | undefined;
  const campos =
    select === undefined
      ? null
      : Object.entries(select)
          .filter(([, v]) => v === true)
          .map(([k]) => k);

  return enOrden.map((fila) => {
    const claves = campos ?? Object.keys(fila);
    const salida: Registro = {};
    for (const campo of claves) {
      if (!(campo in fila)) {
        throw new Error(`fake-prisma: la tabla no tiene la columna "${campo}" que se selecciona`);
      }
      salida[campo] = valorDeColumna(campo, fila[campo]);
    }
    return salida;
  });
}

/* -------------------------------------------------------------------------- */
/* El cliente falso                                                            */
/* -------------------------------------------------------------------------- */

export type ClienteDinero = Pick<
  PrismaClient,
  | "walletMovimiento"
  | "walletTiendaMovimiento"
  | "pagoMensajeroMovimiento"
  | "cierreDia"
  | "cierreBodega"
  | "$queryRaw"
>;

export interface FakeDinero {
  readonly cliente: ClienteDinero;
  /** Toda llamada que el repositorio hizo, en orden. */
  readonly llamadas: readonly LlamadaFake[];
}

/**
 * ¿Es esto un `Prisma.sql` ya compuesto?
 *
 * SE COMPRUEBA POR FORMA, NO CON `instanceof`, y no es una laxitud: en esta version del cliente
 * `Prisma.Sql` **no existe en tiempo de ejecucion** (solo estan `Prisma.sql` y `Prisma.raw`; la
 * clase se llama `_Sql` y no se exporta). Un `x instanceof Prisma.Sql` no falla como "esto no es un
 * Sql": revienta con `Right-hand side of 'instanceof' is not an object` para TODA llamada, legitima
 * o no, y deja el fake incapaz de aceptar nada.
 *
 * La forma que se exige es justo la que el test necesita leer: `text` (con sus `$n`) y `values`. La
 * variante de plantilla etiquetada —`$queryRaw` seguido de un literal— llega como
 * `(TemplateStringsArray, ...valores)` y NO la cumple: sigue prohibida, que es lo que se queria.
 */
function esSqlCompuesto(x: unknown): x is { readonly text: string; readonly values: unknown[] } {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const candidato = x as { text?: unknown; values?: unknown };
  return typeof candidato.text === "string" && Array.isArray(candidato.values);
}

export function fakePrismaDinero(datos: DatosDinero): FakeDinero {
  const llamadas: LlamadaFake[] = [];

  const modelo = (nombre: string, filas: readonly Registro[]) => ({
    groupBy: (args: Registro) => {
      llamadas.push({ modelo: nombre, operacion: "groupBy", args });
      return Promise.resolve(ejecutarGroupBy(filas, args));
    },
    aggregate: (args: Registro) => {
      llamadas.push({ modelo: nombre, operacion: "aggregate", args });
      return Promise.resolve(ejecutarAggregate(filas, args));
    },
    findMany: (args: Registro) => {
      llamadas.push({ modelo: nombre, operacion: "findMany", args });
      return Promise.resolve(ejecutarFindMany(filas, args));
    },
  });

  const filas = (xs: readonly object[] | undefined): readonly Registro[] =>
    (xs ?? []) as unknown as readonly Registro[];

  /**
   * `$queryRaw` — solo se acepta con un `Prisma.sql` ya compuesto (que es como lo llaman los
   * repositorios de la 180). Con la forma de plantilla etiquetada el fake LANZA en vez de
   * inventarse el texto: el test tiene que poder leer el SQL exacto que va a la base.
   */
  const queryRaw = (consultaSql: unknown, ...resto: unknown[]) => {
    if (!esSqlCompuesto(consultaSql) || resto.length > 0) {
      throw new Error(
        "fake-prisma: $queryRaw solo se acepta como $queryRaw(Prisma.sql`...`); asi el test lee el texto y los parametros de verdad",
      );
    }
    const consulta: ConsultaCrudaFake = {
      texto: consultaSql.text,
      valores: consultaSql.values as readonly unknown[],
    };
    llamadas.push({
      modelo: "$queryRaw",
      operacion: "queryRaw",
      args: { texto: consulta.texto, valores: consulta.valores },
    });
    if (datos.respuestaCruda === undefined) {
      throw new Error(
        "fake-prisma: el repositorio emitio un $queryRaw y el fixture no declara `respuestaCruda`; devolver [] por omision seria el mismo verde vacio que un WHERE roto",
      );
    }
    return Promise.resolve(datos.respuestaCruda(consulta));
  };

  const cliente = {
    walletMovimiento: modelo("walletMovimiento", filas(datos.caja)),
    walletTiendaMovimiento: modelo("walletTiendaMovimiento", filas(datos.ledgerTienda)),
    pagoMensajeroMovimiento: modelo("pagoMensajeroMovimiento", filas(datos.ledgerMensajero)),
    cierreDia: modelo("cierreDia", filas(datos.cierresDia)),
    cierreBodega: modelo("cierreBodega", filas(datos.cierresBodega)),
    $queryRaw: queryRaw,
  } as unknown as ClienteDinero;

  return { cliente, llamadas };
}

/** Un cliente cuya base SIEMPRE falla: para comprobar que el error se propaga (R32). */
export function fakePrismaQueFalla(error: Error): ClienteDinero {
  const revienta = () => Promise.reject(error);
  const modelo = { groupBy: revienta, aggregate: revienta, findMany: revienta };
  return {
    walletMovimiento: modelo,
    walletTiendaMovimiento: modelo,
    pagoMensajeroMovimiento: modelo,
    cierreDia: modelo,
    cierreBodega: modelo,
    // La 180 anade metodos que consultan con SQL crudo: si el fake no fallara tambien por ahi,
    // el caso de propagacion de esos metodos pasaria por la via del "no consulte y salio bien".
    $queryRaw: revienta,
  } as unknown as ClienteDinero;
}
