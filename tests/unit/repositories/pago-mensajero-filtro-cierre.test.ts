import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";

// Feature 172 / T C.3 (R52, design §5) — «filtrar el desglose de un mensajero por un cierre»
// incluye los PAGOS registrados contra ese cierre y sus ANULACIONES.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// POR QUE ESTE ARCHIVO ESTA EN `tests/unit/repositories/` Y NO EN LOS TESTS DEL SERVICIO
// ─────────────────────────────────────────────────────────────────────────────────────────────
// Los tests del servicio (`wallet-mensajero-service.test.ts`) usan un DOBLE del repositorio:
// afirman que el servicio le pasa `cierreId`, y no pueden ver en que se traduce. Una mutacion
// del `WHERE` los deja a todos en verde. Es la cicatriz medida siete veces en las tandas I, J,
// K y L de la feature 170, y la regla que dejo escrita: **el WHERE se prueba donde vive**.
//
// Por eso el doble de aqui no es un `vi.fn()` que devuelve filas fijas: es un mini-motor que
// EVALUA el `where` que emite el repositorio contra filas sembradas. Y por eso el motor LANZA
// ante cualquier operador que no conozca —en vez de ignorarlo—, para que una mutacion que use
// otra construccion no pase por «no casa nada» sino que reviente.
//
// Las DOS mitades, las dos obligatorias:
//   1. filtrando por SU cierre, el pago y su contraasiento SALEN;
//   2. filtrando por OTRO cierre, NO salen.
// Con solo la primera, un `OR` que se lo trae todo pasaria en verde.

// ── Filas sembradas ─────────────────────────────────────────────────────────────────────────

const M1 = "m1"; // el mensajero del desglose
const M2 = "m2"; // otro mensajero: sirve para comprobar que el acotado por mensajero manda
const C1 = "c1"; // el cierre que se filtra
const C2 = "c2"; // otro cierre aprobado del mismo mensajero
const C3 = "c3"; // un cierre sin pagos y sin movimientos
const PAGO_1 = "pago-de-c1";
const PAGO_2 = "pago-de-c2";

interface MovimientoFila {
  id: string;
  mensajeroId: string;
  tipo: "devengo" | "pago";
  categoria: string;
  monto: Prisma.Decimal;
  origenTipo: string;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento: Date;
  createdAt: Date;
}

function mov(
  id: string,
  over: Omit<Partial<MovimientoFila>, "monto"> & { monto: string; tipo: "devengo" | "pago" },
): MovimientoFila {
  const { monto, ...resto } = over;
  return {
    id,
    mensajeroId: M1,
    categoria: "pago_devengado",
    origenTipo: "cierre_dia",
    origenId: C1,
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: new Date("2026-07-30T14:32:00.000Z"),
    createdAt: new Date("2026-07-30T14:32:00.000Z"),
    ...resto,
    monto: new Prisma.Decimal(monto), // money-safe: STRING -> Decimal, nunca number
  };
}

/**
 * El libro tal y como queda tras: aprobar `c1`, pagar 30 000 contra `c1`, ANULAR ese pago,
 * aprobar `c2` y pagar 5 000 contra `c2`.
 */
function libro(): MovimientoFila[] {
  return [
    // — cierre c1, escrito por el feed al aprobar (feature 44) —
    mov("f-devengo-c1", { tipo: "devengo", categoria: "pago_devengado", monto: "50000.00" }),
    mov("f-efectivo-c1", { tipo: "pago", categoria: "pago_efectivo", monto: "20000.00" }),
    // — cierre c1, escrito por la LIQUIDACION: su origen es el PAGO, no el cierre (172) —
    mov("liquidacion-c1", {
      tipo: "pago",
      categoria: "liquidacion",
      monto: "30000.00",
      origenTipo: "pago_mensajero",
      origenId: PAGO_1,
      fechaMovimiento: new Date("2026-07-31T00:00:00.000Z"),
    }),
    // — el CONTRAASIENTO de anular ese pago: mismo `origen_id`, categoria de ajuste (§6.2) —
    mov("contraasiento-c1", {
      tipo: "devengo",
      categoria: "ajuste_devengo",
      monto: "30000.00",
      origenTipo: "pago_mensajero",
      origenId: PAGO_1,
      fechaMovimiento: new Date("2026-08-02T00:00:00.000Z"),
    }),
    // — cierre c2: otro cierre del MISMO mensajero, con su propio pago —
    mov("f-devengo-c2", {
      tipo: "devengo",
      categoria: "pago_devengado",
      monto: "10000.00",
      origenId: C2,
    }),
    mov("liquidacion-c2", {
      tipo: "pago",
      categoria: "liquidacion",
      monto: "5000.00",
      origenTipo: "pago_mensajero",
      origenId: PAGO_2,
    }),
    // — una fila de OTRO mensajero colgando del MISMO pago. No puede pasar en produccion; esta
    //   para que el test note si el `OR` se comiera el acotado por `mensajero_id` (R20).
    mov("de-otro-mensajero", {
      tipo: "pago",
      categoria: "liquidacion",
      monto: "999.00",
      mensajeroId: M2,
      origenTipo: "pago_mensajero",
      origenId: PAGO_1,
    }),
  ];
}

/** `liquidacion_pago`: que pago pertenece a que cierre. */
const PAGOS = [
  { id: PAGO_1, cierreId: C1 },
  { id: PAGO_2, cierreId: C2 },
];

// ── Mini-motor del WHERE ────────────────────────────────────────────────────────────────────

/**
 * Evalua un `where` de Prisma (el subconjunto que este repositorio emite) sobre UNA fila.
 *
 * LANZA ante cualquier clave u operador que no conozca. Es deliberado y es la mitad del valor
 * de este archivo: si una mutacion introdujera `NOT`, `some`, `notIn`… un motor permisivo lo
 * ignoraria y el test podria pasar por casualidad. Aqui revienta y se ve.
 */
function casaWhere(fila: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([clave, cond]) => {
    if (clave === "OR") {
      if (!Array.isArray(cond)) throw new Error("OR debe ser un array de condiciones");
      return cond.some((sub) => casaWhere(fila, sub as Record<string, unknown>));
    }
    if (clave === "AND") {
      if (!Array.isArray(cond)) throw new Error("AND debe ser un array de condiciones");
      return cond.every((sub) => casaWhere(fila, sub as Record<string, unknown>));
    }
    if (!(clave in fila)) throw new Error(`el doble no conoce la columna "${clave}"`);
    const valor = fila[clave];
    if (cond === null) return valor === null;
    if (typeof cond === "string") return valor === cond;
    if (cond instanceof Date) return valor instanceof Date && valor.getTime() === cond.getTime();
    if (typeof cond === "object") {
      return Object.entries(cond as Record<string, unknown>).every(([op, arg]) => {
        switch (op) {
          case "equals":
            return valor === arg;
          case "in":
            if (!Array.isArray(arg)) throw new Error("`in` debe recibir un array");
            return arg.includes(valor);
          case "gte":
            return (valor as Date).getTime() >= (arg as Date).getTime();
          case "lte":
            return (valor as Date).getTime() <= (arg as Date).getTime();
          default:
            throw new Error(`el doble no implementa el operador "${op}" (mutacion?)`);
        }
      });
    }
    throw new Error(`condicion no soportada para "${clave}"`);
  });
}

interface ConsultaFindMany {
  where?: Record<string, unknown>;
  orderBy?: { fechaMovimiento?: "asc" | "desc" };
  skip?: number;
  take?: number;
}

/**
 * Doble de Prisma que RESUELVE las consultas contra las filas sembradas. Registra los `where`
 * recibidos para poder afirmar que la pagina y el conteo miran el MISMO conjunto.
 */
/** Una fila tipada, vista como el objeto plano que el motor recorre. */
function comoFila(x: object): Record<string, unknown> {
  return x as Record<string, unknown>;
}

function buildPrisma(movs: MovimientoFila[] = libro(), pagos = PAGOS) {
  const wheresVistos: { findMany: unknown[]; count: unknown[] } = { findMany: [], count: [] };
  const filtrar = (where: Record<string, unknown> = {}) =>
    movs.filter((m) => casaWhere(comoFila(m), where));

  return {
    wheresVistos,
    pagoMensajeroMovimiento: {
      createMany: vi.fn(),
      findMany: vi.fn(async (args: ConsultaFindMany = {}) => {
        wheresVistos.findMany.push(args.where);
        const filas = filtrar(args.where).sort(
          (a, b) => b.fechaMovimiento.getTime() - a.fechaMovimiento.getTime(), // orderBy desc
        );
        const desde = args.skip ?? 0;
        return filas.slice(desde, desde + (args.take ?? filas.length));
      }),
      count: vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
        wheresVistos.count.push(args.where);
        return filtrar(args.where).length;
      }),
      groupBy: vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
        const acc = new Map<string, Prisma.Decimal>();
        for (const m of filtrar(args.where)) {
          acc.set(m.tipo, (acc.get(m.tipo) ?? new Prisma.Decimal(0)).add(m.monto));
        }
        return [...acc.entries()].map(([tipo, monto]) => ({ tipo, _sum: { monto } }));
      }),
    },
    liquidacionPago: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown> } = {}) =>
        pagos.filter((p) => casaWhere(comoFila(p), args.where ?? {})).map((p) => ({ id: p.id })),
      ),
    },
    usuario: { findMany: vi.fn(), findUnique: vi.fn() },
  };
}

function nuevoRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);
}

/** Los ids que devolvio el listado, en el orden en que salieron. */
async function idsFiltrandoPor(
  prisma: ReturnType<typeof buildPrisma>,
  filtros: { mensajeroId?: string; cierreId?: string; desde?: Date; hasta?: Date } = {},
): Promise<string[]> {
  const r = await nuevoRepo(prisma).listarPorMensajero({
    mensajeroId: filtros.mensajeroId ?? M1,
    page: 1,
    pageSize: 50,
    ...(filtros.cierreId !== undefined ? { cierreId: filtros.cierreId } : {}),
    ...(filtros.desde !== undefined ? { desde: filtros.desde } : {}),
    ...(filtros.hasta !== undefined ? { hasta: filtros.hasta } : {}),
  });
  return r.movimientos.map((m) => m.id);
}

// ── Las dos mitades de R52 ──────────────────────────────────────────────────────────────────

describe("R52 — filtrar por un cierre incluye sus pagos y sus anulaciones", () => {
  it("MITAD 1: con el pago y su contraasiento sembrados, filtrar por SU cierre devuelve los dos", async () => {
    const prisma = buildPrisma();

    const ids = await idsFiltrandoPor(prisma, { cierreId: C1 });

    // El pago (origen `pago_mensajero`) y su contraasiento (mismo `origen_id`) pertenecen al
    // cierre aunque su `origen_id` NO sea el cierre: es exactamente lo que el `OR` resuelve.
    expect(ids).toContain("liquidacion-c1");
    expect(ids).toContain("contraasiento-c1");
    // Y lo que el feed escribio al aprobar sigue saliendo (no se cambio un filtro por otro).
    expect(ids).toContain("f-devengo-c1");
    expect(ids).toContain("f-efectivo-c1");
  });

  it("MITAD 2: filtrar por OTRO cierre NO devuelve ninguno de los dos", async () => {
    const prisma = buildPrisma();

    const ids = await idsFiltrandoPor(prisma, { cierreId: C2 });

    // Sin esta mitad, un `OR` que se lo trajera todo pasaria el test de arriba en verde.
    expect(ids).not.toContain("liquidacion-c1");
    expect(ids).not.toContain("contraasiento-c1");
    // Lo de c2 si esta, y solo lo de c2.
    expect(ids.sort()).toEqual(["f-devengo-c2", "liquidacion-c2"]);
  });

  it("un cierre SIN pagos no ensancha nada: la rama del pago no casa ninguna fila", async () => {
    const prisma = buildPrisma();

    // `c3` no tiene movimientos propios NI pagos: `in: []` no puede traer nada.
    expect(await idsFiltrandoPor(prisma, { cierreId: C3 })).toEqual([]);
    expect(prisma.liquidacionPago.findMany).toHaveBeenCalledTimes(1);
  });

  it("el acotado por MENSAJERO sigue mandando: el `OR` no lo desborda (R20)", async () => {
    const prisma = buildPrisma();

    // `de-otro-mensajero` cuelga del MISMO pago que `liquidacion-c1`, asi que casa la rama del
    // `OR`; lo que lo deja fuera es el `mensajeroId` de la raiz, que compone por AND.
    expect(await idsFiltrandoPor(prisma, { cierreId: C1 })).not.toContain("de-otro-mensajero");
    expect(await idsFiltrandoPor(prisma, { mensajeroId: M2, cierreId: C1 })).toEqual([
      "de-otro-mensajero",
    ]);
  });

  it("el rango de fechas tambien compone por AND con el `OR` del cierre", async () => {
    const prisma = buildPrisma();

    // Hasta el 31 de julio: entra el pago (fechado el 31) y no su contraasiento (2 de agosto,
    // el dia de la anulacion, R77).
    const ids = await idsFiltrandoPor(prisma, {
      cierreId: C1,
      hasta: new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(ids).toContain("liquidacion-c1");
    expect(ids).not.toContain("contraasiento-c1");
    expect(ids).toContain("f-devengo-c1");
  });
});

describe("R52 — como se leen los pagos del cierre", () => {
  it("los ids de pago se leen ACOTADOS por el cierre, y solo el id", async () => {
    const prisma = buildPrisma();

    await idsFiltrandoPor(prisma, { cierreId: C1 });

    expect(prisma.liquidacionPago.findMany.mock.calls[0]![0]).toEqual({
      where: { cierreId: C1 },
      select: { id: true }, // ni una columna mas de una tabla de otra feature
    });
  });

  it("sin `cierreId` NO se consulta `liquidacion_pago` (el desglose sin filtro no paga peaje)", async () => {
    const prisma = buildPrisma();

    const ids = await idsFiltrandoPor(prisma);

    expect(prisma.liquidacionPago.findMany).not.toHaveBeenCalled();
    expect(ids).toHaveLength(6); // los 6 del mensajero m1 (el septimo es de m2)
  });

  it("la pagina y el conteo miran el MISMO conjunto (el total no cuenta otra cosa)", async () => {
    const prisma = buildPrisma();

    const r = await nuevoRepo(prisma).listarPorMensajero({
      mensajeroId: M1,
      page: 1,
      pageSize: 2,
      cierreId: C1,
    });

    expect(prisma.wheresVistos.findMany[0]).toEqual(prisma.wheresVistos.count[0]);
    expect(r.movimientos).toHaveLength(2); // recortado por `pageSize`…
    expect(r.total).toBe(4); // …pero el total es el del CONJUNTO: 2 del feed + pago + contraasiento
  });
});

describe("R52 — la CABECERA del desglose cuenta lo mismo que la tabla", () => {
  it("la cuenta por pagar filtrada por el cierre incluye el pago y su contraasiento", async () => {
    const prisma = buildPrisma();

    const agg = await nuevoRepo(prisma).agregarCuentaPorPagar(M1, { cierreId: C1 });

    // devengo: 50 000 (feed) + 30 000 (contraasiento de la anulacion) = 80 000
    // pago:    20 000 (feed) + 30 000 (la liquidacion)                = 50 000
    // Con el filtro ANTERIOR —solo `origen_tipo = cierre_dia`— habrian salido 50 000 / 20 000:
    // la cabecera diria una deuda y la tabla de debajo mostraria otra cosa.
    expect(agg).toEqual({ devengado: "80000.00", pagado: "50000.00" });
    // Money-safe: STRING de escala 2 en la frontera del repositorio.
    expect(agg.devengado).toMatch(/^\d+\.\d{2}$/);
    expect(agg.pagado).toMatch(/^\d+\.\d{2}$/);
  });

  it("con el pago VIGENTE (sin anular), la cuenta por pagar del cierre baja en su monto", async () => {
    // Mismo libro sin el contraasiento: es el estado normal, un pago que sigue en pie.
    const sinAnular = libro().filter((m) => m.id !== "contraasiento-c1");
    const prisma = buildPrisma(sinAnular);

    const agg = await nuevoRepo(prisma).agregarCuentaPorPagar(M1, { cierreId: C1 });

    // 50 000 devengado − (20 000 efectivo + 30 000 liquidacion) = 0 pendiente de ESE cierre.
    expect(agg).toEqual({ devengado: "50000.00", pagado: "50000.00" });
  });
});

describe("el mini-motor del WHERE no es permisivo (si lo fuera, este archivo no probaria nada)", () => {
  it("una columna que no existe en la fila hace fallar la consulta", () => {
    expect(() => casaWhere({ id: "x" }, { columnaInventada: "y" })).toThrow(/no conoce la columna/);
  });

  it("un operador no implementado hace fallar la consulta en vez de ignorarse", () => {
    expect(() => casaWhere({ origenId: "x" }, { origenId: { notIn: ["x"] } })).toThrow(
      /no implementa el operador/,
    );
  });
});
