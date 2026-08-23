import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 41/D1 (R12/R16/R17) — consultas del bloqueo derivado. Mockea Prisma (sin DB real).
//
// ⚠️ REESCRITO DOS VECES, Y LAS DOS POR UN CAMBIO DE REGLA FIRMADO. Conviene leer la historia
// entera, porque explica por que el instrumento es como es:
//
//   · 2026-08-18: los tres estados no-`aprobado` bloqueaban y se toleraba UNO. Ese tope era
//     INALCANZABLE (109/R30: un mensajero nunca tenia 2 cierres abiertos), asi que no era un
//     umbral: era el predicado APAGADO.
//   · FEATURE 241 (2026-08-20): la regla pasa a ser una LISTA DE ESTADOS —`vencido` y `rechazado`
//     bloquean; `solicitado` no— y el bloqueo alcanza SOLO a gestionar y cobrar.
//   · FEATURE 271 (2026-08-23): la regla DEJA DE SER UNA LISTA Y PASA A SER UN CONTEO. Con
//     N = cierres sin aprobar y V = cuantos son re-solicitables:
//
//         LIBRE si N <= 1 Y V = 0. En cualquier otro caso, BLOQUEADO.
//
//     Y el bloqueo alcanza TODO: gestionar, cobrar y RECIBIR TRABAJO NUEVO —reparto Y recoleccion—.
//     El invariante 109/R30 queda DEROGADO (R9), asi que «dos cierres abiertos» deja de ser un
//     estado imposible y pasa a ser EL caso que hay que medir.
//
// QUE SOBREVIVE DE LA 241, y se afirma aqui para que nadie lo «complete» por simetria: un cierre
// `solicitado` A SECAS (N=1, V=0) NO bloquea. Es espera del ADMIN —el mensajero ya hizo lo suyo— y
// bloquearlo ahi lo castiga por una demora ajena de 8,2 h de mediana y 22,1 h en p90.
//
// EL DOBLE DE PRISMA AGRUPA DE VERDAD: `cierreDia.groupBy` respeta el `where.estado.in` y el
// `where.mensajeroId.in` que el repositorio le pasa y devuelve un conteo por `(mensajero, estado)`,
// en vez de una lista fija. Sin eso, «con `solicitado` no bloquea» pasaria en verde tambien si el
// repositorio preguntara mal y el doble devolviera vacio por casualidad: se estaria midiendo el
// doble, no la regla.
//
// ⚠️ Y AUN ASI ESTE ARCHIVO NO ES LA PRUEBA DEL `WHERE`. Un doble en memoria no es Postgres: la
// prueba de que la consulta selecciona las filas correctas vive en
// `tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts`, sembrada y con contraprueba por
// mutacion. Aqui se mide la FORMA de la consulta y la aritmetica que el repositorio hace encima.

/** Un cierre_dia, reducido a lo que estas consultas miran. */
type CierreFila = { mensajeroId: string; estado: string };

/**
 * Doble de Prisma que AGRUPA como la base: aplica `where.estado.in` y `where.mensajeroId.in` sobre
 * `cierres` y devuelve un `_count._all` por `(mensajeroId, estado)`. Es el instrumento de todo el
 * archivo.
 */
function buildPrisma(cierres: CierreFila[] = [], overrides: Record<string, unknown> = {}) {
  const groupBy = vi.fn(
    async (args: {
      by: string[];
      where: { mensajeroId?: { in: string[] }; estado: { in: string[] } };
    }) => {
      const ids = args.where.mensajeroId?.in;
      const filas = cierres.filter(
        (c) =>
          args.where.estado.in.includes(c.estado) &&
          (ids === undefined || ids.includes(c.mensajeroId)),
      );
      const porClave = new Map<string, { mensajeroId: string; estado: string; n: number }>();
      for (const c of filas) {
        const clave = `${c.mensajeroId}|${c.estado}`;
        const previo = porClave.get(clave);
        if (previo) previo.n += 1;
        else porClave.set(clave, { mensajeroId: c.mensajeroId, estado: c.estado, n: 1 });
      }
      return [...porClave.values()].map((g) => ({
        mensajeroId: g.mensajeroId,
        estado: g.estado,
        _count: { _all: g.n },
      }));
    },
  );
  /** El cierre mas viejo que `findBloqueoDetalle` relee. Tipado a mano: los casos lo overridean. */
  type CierreMasViejo = { id: string; estado: string; solicitadoAt: Date; createdAt: Date } | null;
  return {
    usuario: { findMany: vi.fn() },
    cierreDia: {
      groupBy,
      findFirst: vi.fn(async (): Promise<CierreMasViejo> => null),
      count: vi.fn(),
    },
    gestionOrden: { findMany: vi.fn(async (): Promise<{ createdAt: Date }[]> => []) },
    cierreBodega: { count: vi.fn() },
    ...overrides,
  };
}

function repoCon(prisma: ReturnType<typeof buildPrisma>) {
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

// =================================================================================================
// EL CONTADOR (T1.2, R1) — de donde salen N y V.
// =================================================================================================

describe("OrdenRepository.contarCierresAbiertosPorMensajero (feature 271/R1)", () => {
  it("cuenta N y V por mensajero, y V es SUBCONJUNTO de N", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "solicitado" },
      { mensajeroId: "m1", estado: "vencido" },
      { mensajeroId: "m2", estado: "rechazado" },
      { mensajeroId: "m2", estado: "rechazado" },
      { mensajeroId: "m3", estado: "solicitado" },
    ]);

    const conteo = await repoCon(prisma).contarCierresAbiertosPorMensajero(["m1", "m2", "m3"]);

    expect(conteo.get("m1")).toEqual({ n: 2, v: 1 });
    expect(conteo.get("m2")).toEqual({ n: 2, v: 2 });
    expect(conteo.get("m3")).toEqual({ n: 1, v: 0 });
  });

  it("`aprobado` NO cuenta para N: es el UNICO terminal (dinero conciliado)", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "aprobado" },
      { mensajeroId: "m1", estado: "aprobado" },
    ]);

    const conteo = await repoCon(prisma).contarCierresAbiertosPorMensajero(["m1"]);

    expect(conteo.get("m1")).toBeUndefined(); // no aparece = `{ n: 0, v: 0 }` para el llamador
  });

  it("UNA sola consulta para un lote de N mensajeros (sin N+1)", async () => {
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "vencido" }]);

    await repoCon(prisma).contarCierresAbiertosPorMensajero(["m1", "m2", "m3", "m4", "m5"]);

    expect(prisma.cierreDia.groupBy).toHaveBeenCalledTimes(1);
  });

  it("la consulta agrupa por (mensajero, estado) y pide los TRES abiertos", async () => {
    // El WHERE, medido donde vive. Un test de servicio con dobles nunca ve esta lista.
    const prisma = buildPrisma();

    await repoCon(prisma).contarCierresAbiertosPorMensajero(["m1", "m2"]);

    const arg = prisma.cierreDia.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["mensajeroId", "estado"]);
    expect(arg.where).toMatchObject({
      mensajeroId: { in: ["m1", "m2"] },
      estado: { in: ["solicitado", "vencido", "rechazado"] },
    });
  });

  it("ids vacio -> mapa vacio SIN consultar", async () => {
    const prisma = buildPrisma();

    expect(await repoCon(prisma).contarCierresAbiertosPorMensajero([])).toEqual(new Map());
    expect(prisma.cierreDia.groupBy).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// EL PREDICADO (T1.3, R2-R8/R10) — las siete filas de la tabla de verdad, contra el repositorio.
// =================================================================================================

describe("OrdenRepository.findMensajerosBloqueadosPorCierres (feature 271/R2-R8)", () => {
  const CASOS: { nombre: string; cierres: string[]; bloqueado: boolean }[] = [
    { nombre: "1 · sin cierres (N=0,V=0)", cierres: [], bloqueado: false },
    { nombre: "2/3 · un `solicitado` (N=1,V=0)", cierres: ["solicitado"], bloqueado: false },
    { nombre: "4 · dos `solicitado` (N=2,V=0)", cierres: ["solicitado", "solicitado"], bloqueado: true },
    { nombre: "5 · un `vencido` (N=1,V=1)", cierres: ["vencido"], bloqueado: true },
    { nombre: "5-bis · un `rechazado` (N=1,V=1)", cierres: ["rechazado"], bloqueado: true },
    { nombre: "6 · `solicitado`+`vencido` (N=2,V=1)", cierres: ["solicitado", "vencido"], bloqueado: true },
    { nombre: "7 · dos `rechazado` (N=2,V=2)", cierres: ["rechazado", "rechazado"], bloqueado: true },
  ];

  it.each(CASOS.map((c) => [c.nombre, c.cierres, c.bloqueado] as const))(
    "%s -> bloqueado=%o",
    async (_nombre, cierres, esperado) => {
      const prisma = buildPrisma(cierres.map((estado) => ({ mensajeroId: "m1", estado })));

      const r = await repoCon(prisma).findMensajerosBloqueadosPorCierres(["m1"]);

      expect(r.has("m1")).toBe(esperado);
    },
  );

  it("`aprobado` no bloquea, ni siquiera tres de ellos", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "aprobado" },
      { mensajeroId: "m1", estado: "aprobado" },
      { mensajeroId: "m1", estado: "aprobado" },
    ]);

    expect(await repoCon(prisma).findMensajerosBloqueadosPorCierres(["m1"])).toEqual(new Set());
  });

  it("separa, en la MISMA consulta, a quien bloquea de quien no (R34)", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "vencido" }, // N=1 V=1 -> bloqueado
      { mensajeroId: "m2", estado: "solicitado" }, // N=1 V=0 -> libre (espera al admin)
      { mensajeroId: "m3", estado: "solicitado" },
      { mensajeroId: "m3", estado: "solicitado" }, // N=2 V=0 -> bloqueado por ACUMULAR
      { mensajeroId: "m4", estado: "aprobado" }, // terminal -> libre
    ]);

    expect(
      await repoCon(prisma).findMensajerosBloqueadosPorCierres(["m1", "m2", "m3", "m4"]),
    ).toEqual(new Set(["m1", "m3"]));
  });

  it("ids vacio -> set vacio sin consultar", async () => {
    const prisma = buildPrisma();

    expect(await repoCon(prisma).findMensajerosBloqueadosPorCierres([])).toEqual(new Set());
    expect(prisma.cierreDia.groupBy).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// EL DETALLE (T1.4, R11/R43/R57) — cual toca resolver primero, y con que fecha se nombra.
// =================================================================================================

describe("OrdenRepository.findBloqueoDetalle (feature 271/R11/R57)", () => {
  it("N=0 -> LIBRE y `aResolverPrimero` nulo, sin releer nada", async () => {
    const prisma = buildPrisma([]);

    const d = await repoCon(prisma).findBloqueoDetalle("m1");

    expect(d).toEqual({
      bloqueado: false,
      cierresAbiertos: 0,
      cierresPorReenviar: 0,
      aResolverPrimero: null,
      aReenviarPrimero: null,
    });
    expect(prisma.cierreDia.findFirst).not.toHaveBeenCalled();
  });

  it("R11: pide EL MAS VIEJO por `solicitado_at` ASC con desempate ESTABLE por `id` ASC", async () => {
    // El desempate no es paranoia: el corte crea cierres en bucle dentro del mismo segundo y
    // `solicitado_at` puede repetirse. Un orden inestable haria que «el que toca resolver»
    // cambiara entre dos cargas de la misma pantalla.
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "solicitado" },
      { mensajeroId: "m1", estado: "solicitado" },
    ]);
    prisma.cierreDia.findFirst.mockResolvedValue({
      id: "c-viejo",
      estado: "solicitado",
      solicitadoAt: new Date("2026-08-21T18:00:00.000Z"),
      createdAt: new Date("2026-08-21T18:00:00.000Z"),
    });

    const d = await repoCon(prisma).findBloqueoDetalle("m1");

    const arg = (prisma.cierreDia.findFirst.mock.calls as unknown as Record<string, unknown>[][])[0][0];
    expect(arg.orderBy).toEqual([{ solicitadoAt: "asc" }, { id: "asc" }]);
    expect(arg.where).toMatchObject({
      mensajeroId: "m1",
      estado: { in: ["solicitado", "vencido", "rechazado"] },
    });
    expect(d.bloqueado).toBe(true);
    expect(d.cierresAbiertos).toBe(2);
    expect(d.cierresPorReenviar).toBe(0);
    // Todos `solicitado` -> la pelota la tiene la ADMINISTRACION: el mensajero no puede hacer nada.
    expect(d.aResolverPrimero?.resuelve).toBe("administracion");
    expect(d.aResolverPrimero?.cierreId).toBe("c-viejo");
  });

  it("R57: la JORNADA sale de las gestiones vinculadas, NO del `created_at` del cierre", async () => {
    // ⚠️ EL CASO MEDIDO EN PRODUCCION (`79cb2c0f`): el cierre nacio el 22 a las 00:0x y sus
    // gestiones son del 21. Decirle «tu cierre del 22» a quien trabajo el 21 es el aviso confuso
    // que esta ficha viene a evitar.
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "vencido" }]);
    prisma.cierreDia.findFirst.mockResolvedValue({
      id: "c-79cb",
      estado: "vencido",
      solicitadoAt: new Date("2026-08-22T06:03:15.000Z"),
      createdAt: new Date("2026-08-22T06:03:15.000Z"), // 00:03 CR del 22
    });
    prisma.gestionOrden.findMany.mockResolvedValue([
      { createdAt: new Date("2026-08-21T22:56:00.000Z") }, // 16:56 CR del 21
      { createdAt: new Date("2026-08-21T23:10:00.000Z") },
    ]);

    const d = await repoCon(prisma).findBloqueoDetalle("m1");

    expect(d.aResolverPrimero?.jornadaCR).toBe("2026-08-21");
    expect(d.aResolverPrimero?.jornadaCR).not.toBe("2026-08-22");
    // Una gestion ANULADA no es jornada trabajada que nombrar.
    const argGestiones = (
      prisma.gestionOrden.findMany.mock.calls as unknown as { where: unknown }[][]
    )[0][0];
    expect(argGestiones.where).toMatchObject({
      cierreId: "c-79cb",
      anuladaAt: null,
    });
    // Y con un `vencido` la pelota la tiene EL MENSAJERO: puede reenviarlo por su cuenta.
    expect(d.aResolverPrimero?.resuelve).toBe("mensajero");
  });

  it("R58: cierre SIN gestiones (money-neutral del corte) -> `created_at` CR MENOS UN DIA", async () => {
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "vencido" }]);
    prisma.cierreDia.findFirst.mockResolvedValue({
      id: "c-neutral",
      estado: "vencido",
      solicitadoAt: new Date("2026-08-22T06:03:15.000Z"),
      createdAt: new Date("2026-08-22T06:03:15.000Z"),
    });
    prisma.gestionOrden.findMany.mockResolvedValue([]);

    const d = await repoCon(prisma).findBloqueoDetalle("m1");

    expect(d.aResolverPrimero?.jornadaCR).toBe("2026-08-21");
  });

  it("R60: gestiones en DOS dias CR -> jornada `null`, y el texto omitira la fecha", async () => {
    const prisma = buildPrisma([{ mensajeroId: "m1", estado: "vencido" }]);
    prisma.cierreDia.findFirst.mockResolvedValue({
      id: "c-mixto",
      estado: "vencido",
      solicitadoAt: new Date("2026-08-22T06:03:15.000Z"),
      createdAt: new Date("2026-08-22T06:03:15.000Z"),
    });
    prisma.gestionOrden.findMany.mockResolvedValue([
      { createdAt: new Date("2026-08-20T22:00:00.000Z") },
      { createdAt: new Date("2026-08-21T22:00:00.000Z") },
    ]);

    const d = await repoCon(prisma).findBloqueoDetalle("m1");

    expect(d.aResolverPrimero?.jornadaCR).toBeNull();
  });
});

// Zonas con >=1 mensajero bloqueado. ⚠️ FEATURE 271: deja de ser UNA consulta — `some` no sabe
// contar, y la regla nueva es un conteo. ⚠️ Sin consumidor de produccion desde el 2026-08-18
// (§2.6 de la investigacion 241): hoy solo lo tocan estos tests.
describe("OrdenRepository.findZonasConMensajeroBloqueado", () => {
  it("devuelve las zonas de los mensajeros que la REGLA N/V declara bloqueados", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "vencido" }, // bloqueado
      { mensajeroId: "m2", estado: "solicitado" }, // libre: su zona NO entra
      { mensajeroId: "m3", estado: "solicitado" },
      { mensajeroId: "m3", estado: "solicitado" }, // bloqueado por acumular
    ]);
    prisma.usuario.findMany.mockResolvedValue([
      { id: "m1", zonaId: "z-gam" },
      { id: "m2", zonaId: "z-limon" },
      { id: "m3", zonaId: "z-sur" },
    ]);

    expect(await repoCon(prisma).findZonasConMensajeroBloqueado()).toEqual(
      new Set(["z-gam", "z-sur"]),
    );
    expect(prisma.usuario.findMany).toHaveBeenCalledTimes(1); // sin N+1 por zona
  });

  it("el pre-filtro usa los TRES abiertos: quien no tiene NINGUNO no puede estar bloqueado", async () => {
    const prisma = buildPrisma([]);
    prisma.usuario.findMany.mockResolvedValue([]);

    await repoCon(prisma).findZonasConMensajeroBloqueado();

    expect(prisma.usuario.findMany.mock.calls[0][0].where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: { not: null },
      cierresRealizados: { some: { estado: { in: ["solicitado", "vencido", "rechazado"] } } },
    });
  });

  it("nadie con cierres -> set vacio, sin segunda consulta", async () => {
    const prisma = buildPrisma([]);
    prisma.usuario.findMany.mockResolvedValue([]);

    expect(await repoCon(prisma).findZonasConMensajeroBloqueado()).toEqual(new Set());
    expect(prisma.cierreDia.groupBy).not.toHaveBeenCalled();
  });

  it("descarta zonaId null (defensivo) sin romper el set", async () => {
    const prisma = buildPrisma([
      { mensajeroId: "m1", estado: "vencido" },
      { mensajeroId: "m2", estado: "vencido" },
    ]);
    prisma.usuario.findMany.mockResolvedValue([
      { id: "m1", zonaId: "z1" },
      { id: "m2", zonaId: null },
    ]);

    expect(await repoCon(prisma).findZonasConMensajeroBloqueado()).toEqual(new Set(["z1"]));
  });
});

describe("OrdenRepository.existeBodegaSateliteBloqueada (feature 241 -> 271/R34)", () => {
  /**
   * `mensajeros` = ids de la zona; `cierres` = sus cierre_dia; `countBodega` = CierreBodega
   * pendiente (causa ii).
   */
  async function run(mensajeros: string[], cierres: CierreFila[], countBodega: number) {
    const prisma = buildPrisma(cierres);
    prisma.usuario.findMany.mockResolvedValue(mensajeros.map((id) => ({ id })));
    prisma.cierreBodega.count.mockResolvedValue(countBodega);
    const res = await repoCon(prisma).existeBodegaSateliteBloqueada("z1");
    return { res, prisma };
  }

  // R34: la bodega NO se congela por sus mensajeros, ni siquiera con TODOS bloqueados. Esta ficha
  // bloquea AL MENSAJERO; sus companeros sin cierres siguen recibiendo asignaciones.
  it.each([["solicitado"], ["vencido"], ["rechazado"]])(
    "con TODOS sus mensajeros en cierre `%s` la bodega NO se bloquea: sigue recibiendo ordenes",
    async (estado) => {
      const { res } = await run(
        ["m1", "m2"],
        [
          { mensajeroId: "m1", estado },
          { mensajeroId: "m2", estado },
        ],
        0,
      );

      expect(res).toMatchObject({
        bloqueada: false, // <- la causa (i) NO bloquea (R34)
        porMensajeros: true, // informativo: es cierto, y el aviso de la pantalla lo dice
        porCierreBodega: false,
        cierresAbiertos: 2, // nombre heredado: cuenta MENSAJEROS con cierre, no cierres
        totalMensajeros: 2,
      });
      expect(new Set(res.mensajerosConCierreIds)).toEqual(new Set(["m1", "m2"]));
    },
  );

  // ⚠️ EL CASO QUE SEPARA EL AVISO DE LA LISTA DE BLOQUEADOS (R32/R34). Un `solicitado` a secas
  // CUENTA como cierre abierto —el adminSatelite que cuadra caja tiene que verlo— y NO entra en
  // `mensajerosBloqueadosIds`, porque el servidor SI le va a dejar asignar a ese mensajero. Si las
  // dos listas se calcularan con el mismo criterio, el selector deshabilitaria a quien el servidor
  // acepta, que es la incoherencia del 2026-08-18 con el signo cambiado.
  it("un `solicitado` cuenta en el AVISO pero NO en la lista de bloqueados (R32)", async () => {
    const { res } = await run(
      ["m1", "m2", "m3"],
      [{ mensajeroId: "m2", estado: "solicitado" }],
      0,
    );

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: true,
      cierresAbiertos: 1,
      totalMensajeros: 3,
      mensajerosConCierreIds: ["m2"],
      mensajerosBloqueadosIds: [], // <- el punto
    });
  });

  it("DOS `solicitado` del mismo mensajero SI entran en la lista de bloqueados (R32)", async () => {
    const { res } = await run(
      ["m1", "m2"],
      [
        { mensajeroId: "m2", estado: "solicitado" },
        { mensajeroId: "m2", estado: "solicitado" },
      ],
      0,
    );

    expect(res).toMatchObject({
      bloqueada: false, // la bodega sigue sin congelarse (R34)
      cierresAbiertos: 1, // UN mensajero con cierres (el nombre heredado engaña)
      mensajerosBloqueadosIds: ["m2"],
    });
  });

  it("`aprobado` no cuenta ni para el aviso: el dinero ya esta conciliado", async () => {
    const { res } = await run(["m1"], [{ mensajeroId: "m1", estado: "aprobado" }], 0);

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 1,
      mensajerosConCierreIds: [],
      mensajerosBloqueadosIds: [],
    });
  });

  // La causa (ii), que NO se toco en NINGUNA de las tres fichas: es el cierre de la PROPIA bodega
  // hacia la central, no el de un mensajero.
  it("causa (ii): CierreBodega pendiente -> bloqueo duro aunque nadie tenga cierre", async () => {
    const { res } = await run(["m1", "m2"], [], 1);

    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: false,
      porCierreBodega: true,
      cierresAbiertos: 0,
      totalMensajeros: 2,
    });
  });

  it("con mensajeros en cierre Y CierreBodega pendiente, bloquea SOLO por la causa (ii)", async () => {
    const { res } = await run(["m1"], [{ mensajeroId: "m1", estado: "vencido" }], 1);

    expect(res).toMatchObject({ bloqueada: true, porMensajeros: true, porCierreBodega: true });
  });

  it("ningun mensajero con cierre y sin CierreBodega -> no bloqueada, cierresAbiertos 0", async () => {
    const { res } = await run(["m1", "m2"], [], 0);

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
      cierresAbiertos: 0,
      totalMensajeros: 2,
      mensajerosConCierreIds: [],
    });
  });

  it("zona SIN mensajeros -> no bloquea por (i) (vacuo), cierresAbiertos 0", async () => {
    const { res, prisma } = await run([], [], 0);

    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 0,
      mensajerosConCierreIds: [],
    });
    // Sin mensajeros se corta antes de consultar cierre_dia.
    expect(prisma.cierreDia.groupBy).not.toHaveBeenCalled();
  });

  it("filtros: mensajeros por rol+zona; cierre_dia por los TRES abiertos; cierre_bodega solicitado", async () => {
    const { prisma } = await run(["m1"], [{ mensajeroId: "m1", estado: "solicitado" }], 1);

    expect(prisma.usuario.findMany.mock.calls[0][0].where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: "z1",
    });
    // Los TRES: de este mismo `groupBy` salen el AVISO (mensajeros con N>=1) y la lista de
    // BLOQUEADOS (regla N/V). Una sola consulta, dos preguntas.
    expect(prisma.cierreDia.groupBy.mock.calls[0][0].where).toMatchObject({
      mensajeroId: { in: ["m1"] },
      estado: { in: ["solicitado", "vencido", "rechazado"] },
    });
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toMatchObject({
      zonaId: "z1",
      estado: "solicitado",
    });
  });
});
