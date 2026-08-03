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

/* -------------------------------------------------------------------------- */
/* Filas de las cuatro tablas que la TANDA C consulta                          */
/* -------------------------------------------------------------------------- */

export interface FilaCaja {
  readonly categoria: string;
  readonly tipo: string;
  readonly monto: string;
  readonly fechaMovimiento: Date;
}

export interface FilaLedgerTienda {
  readonly tiendaId: string;
  readonly categoria: string;
  readonly tipo: string;
  readonly monto: string;
  readonly fechaMovimiento: Date;
}

export interface FilaLedgerMensajero {
  readonly mensajeroId: string;
  readonly categoria: string;
  readonly tipo: string;
  readonly monto: string;
  readonly fechaMovimiento: Date;
}

export interface FilaCierreDia {
  readonly id: string;
  readonly estado: string;
  readonly totalEfectivo: string;
  readonly totalSimpe: string;
  readonly totalTransferencia: string;
  readonly totalGeneral: string;
  readonly solicitadoAt: Date;
  readonly resueltoAt: Date | null;
}

export interface DatosDinero {
  readonly caja?: readonly FilaCaja[];
  readonly ledgerTienda?: readonly FilaLedgerTienda[];
  readonly ledgerMensajero?: readonly FilaLedgerMensajero[];
  readonly cierresDia?: readonly FilaCierreDia[];
}

export interface LlamadaFake {
  readonly modelo: string;
  readonly operacion: "groupBy" | "aggregate";
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

function ordenar(grupos: Grupo[], orderBy: unknown): Grupo[] {
  if (orderBy === undefined) return grupos;
  const criterios = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Registro[];
  return [...grupos].sort((a, b) => {
    for (const criterio of criterios) {
      for (const [campo, direccion] of Object.entries(criterio)) {
        const signo = comparar(a.clave[campo], b.clave[campo]);
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
    for (const campo of by) clave[campo] = fila[campo];
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
      : ordenar([...grupos.values()], args.orderBy);

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

/* -------------------------------------------------------------------------- */
/* El cliente falso                                                            */
/* -------------------------------------------------------------------------- */

export type ClienteDinero = Pick<
  PrismaClient,
  "walletMovimiento" | "walletTiendaMovimiento" | "pagoMensajeroMovimiento" | "cierreDia"
>;

export interface FakeDinero {
  readonly cliente: ClienteDinero;
  /** Toda llamada que el repositorio hizo, en orden. */
  readonly llamadas: readonly LlamadaFake[];
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
  });

  const filas = (xs: readonly object[] | undefined): readonly Registro[] =>
    (xs ?? []) as unknown as readonly Registro[];

  const cliente = {
    walletMovimiento: modelo("walletMovimiento", filas(datos.caja)),
    walletTiendaMovimiento: modelo("walletTiendaMovimiento", filas(datos.ledgerTienda)),
    pagoMensajeroMovimiento: modelo("pagoMensajeroMovimiento", filas(datos.ledgerMensajero)),
    cierreDia: modelo("cierreDia", filas(datos.cierresDia)),
  } as unknown as ClienteDinero;

  return { cliente, llamadas };
}

/** Un cliente cuya base SIEMPRE falla: para comprobar que el error se propaga (R32). */
export function fakePrismaQueFalla(error: Error): ClienteDinero {
  const revienta = () => Promise.reject(error);
  const modelo = { groupBy: revienta, aggregate: revienta };
  return {
    walletMovimiento: modelo,
    walletTiendaMovimiento: modelo,
    pagoMensajeroMovimiento: modelo,
    cierreDia: modelo,
  } as unknown as ClienteDinero;
}
