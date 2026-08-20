import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RankingRepository } from "@/lib/repositories/RankingRepository";

// Feature 76 (R1) — repo de agregacion del ranking DIARIO con Prisma mockeado (sin DB). El
// rango del dia (CR) llega ya calculado por el service (desde/hasta); el repo no usa Date.now.
//
// FEATURE 246 (T6.2/T6.4, D7 firmada el 2026-08-20) — EL DENOMINADOR CUENTA POR DIA DE REPARTO.
// Aqui es donde vive el `WHERE` y por tanto donde se prueba: los tests de servicio usan dobles y
// NO VEN el `where` — medido cuatro veces en este repo. El doble de abajo lo HONRA de verdad.

const DESDE = new Date("2026-07-16T06:00:00.000Z"); // 00:00 de pared CR del 16 (timestamp)
const HASTA = new Date("2026-07-17T06:00:00.000Z"); // +24h
const DIA_REPARTO = new Date("2026-07-16T00:00:00.000Z"); // el MISMO dia, convencion `@db.Date`

describe("RankingRepository.contarEntregadasPorMensajero (R1 numerador)", () => {
  it("agrupa por mensajeroId con resultado=entregada, VIGENTES y en el rango HOY(CR)", async () => {
    const groupBy = vi.fn(async () => [
      { mensajeroId: "m1", _count: { _all: 4 } },
      { mensajeroId: "m2", _count: { _all: 1 } },
    ]);
    const repo = new RankingRepository({ gestionOrden: { groupBy } } as unknown as PrismaClient);

    const rows = await repo.contarEntregadasPorMensajero(DESDE, HASTA);

    expect(rows).toEqual([
      { mensajeroId: "m1", total: 4 },
      { mensajeroId: "m2", total: 1 },
    ]);
    const arg = (groupBy.mock.calls[0] as unknown[])[0] as {
      by: string[];
      where: Record<string, unknown>;
    };
    expect(arg.by).toEqual(["mensajeroId"]);
    expect(arg.where.resultado).toBe("entregada"); // solo entregas exitosas
    expect(arg.where.anuladaAt).toBeNull(); // feature 67: solo VIGENTES (excluye anuladas)
    expect(arg.where.createdAt).toEqual({ gte: DESDE, lt: HASTA }); // HOY(CR) half-open
  });

  // Feature 246 (R39): el numerador NO cambia, y eso es una afirmacion, no una omision.
  it("246/R39: el numerador sigue anclado a `gestion_orden.created_at`, no al dia de reparto", async () => {
    const groupBy = vi.fn(async () => []);
    const repo = new RankingRepository({ gestionOrden: { groupBy } } as unknown as PrismaClient);

    await repo.contarEntregadasPorMensajero(DESDE, HASTA);

    const arg = (groupBy.mock.calls[0] as unknown[])[0] as { where: Record<string, unknown> };
    expect(arg.where).not.toHaveProperty("fechaReparto");
    expect(arg.where).not.toHaveProperty("OR");
    // Tiene que seguir asi: el snapshot del dia se congela a las 02:00 CR del dia siguiente y es
    // inmutable, asi que el numerador tiene que estar anclado a algo que no reciba escrituras
    // tardias. `created_at` lo esta; un dia de reparto no (design §10-F).
  });
});

// =================================================================================================
// FEATURE 246 (T6.2/T6.4, R36/R37/R38/R43) — EL DENOMINADOR, MEDIDO SOBRE FILAS DE VERDAD.
// =================================================================================================

interface FilaOrden {
  mensajeroAsignadoId: string | null;
  fechaReparto: Date | null;
  asignadoAt: Date | null;
}

interface RamaOr {
  fechaReparto?: Date | null;
  asignadoAt?: { gte: Date; lt: Date };
}

interface WhereDenominador {
  mensajeroAsignadoId: { not: null };
  OR?: RamaOr[];
  asignadoAt?: { gte: Date; lt: Date };
  fechaReparto?: Date | null;
}

/** ¿Casa la fila una rama concreta del `OR`? Se evalua TODA la rama, no solo su primer campo. */
function casaRama(f: FilaOrden, rama: RamaOr): boolean {
  if ("fechaReparto" in rama) {
    const esperada = rama.fechaReparto;
    if (esperada === null) {
      if (f.fechaReparto !== null) return false;
    } else if (esperada === undefined) {
      return false;
    } else if (f.fechaReparto === null || f.fechaReparto.getTime() !== esperada.getTime()) {
      return false;
    }
  }
  if (rama.asignadoAt !== undefined) {
    if (f.asignadoAt === null) return false;
    const t = f.asignadoAt.getTime();
    if (t < rama.asignadoAt.gte.getTime() || t >= rama.asignadoAt.lt.getTime()) return false;
  }
  return true;
}

/**
 * Doble de `orden.groupBy` CON SEMANTICA: aplica de verdad el `where` sobre `filas` y agrega por
 * mensajero. Es lo que convierte estos casos en una medida del predicado y no en una copia de su
 * forma. Sin esto, quitar una rama del `OR` pasaria en verde.
 */
function prismaDenominador(filas: FilaOrden[]) {
  const groupBy = vi.fn(async (args: { where: WhereDenominador }) => {
    const { where } = args;
    const casa = (f: FilaOrden) => {
      if (f.mensajeroAsignadoId === null) return false;
      if (where.OR !== undefined) return where.OR.some((rama) => casaRama(f, rama));
      // `where` SIN el `OR` (la forma anterior a esta ficha, o una mutacion): se evalua lo que
      // haya suelto. Si no hay nada, pasa todo — y eso es lo que un test roto no distinguiria.
      return casaRama(f, { fechaReparto: where.fechaReparto, asignadoAt: where.asignadoAt });
    };
    const porMensajero = new Map<string, number>();
    for (const f of filas.filter(casa)) {
      const id = f.mensajeroAsignadoId as string;
      porMensajero.set(id, (porMensajero.get(id) ?? 0) + 1);
    }
    return [...porMensajero].map(([mensajeroAsignadoId, n]) => ({
      mensajeroAsignadoId,
      _count: { _all: n },
    }));
  });
  return { prisma: { orden: { groupBy } } as unknown as PrismaClient, groupBy };
}

const ASIGNADA_EL_16 = new Date("2026-07-16T20:00:00.000Z"); // 14:00 CR del 16
const ASIGNADA_EL_15_TARDE = new Date("2026-07-16T04:00:00.000Z"); // 22:00 CR del 15
const DIA_16 = new Date("2026-07-16T00:00:00.000Z");
const DIA_17 = new Date("2026-07-17T00:00:00.000Z");

describe("246/R36-R43 — el denominador cuenta por DIA DE REPARTO", () => {
  it("R36: una orden RESERVADA para ese dia cuenta en su denominador", async () => {
    const { prisma } = prismaDenominador([
      { mensajeroAsignadoId: "m1", fechaReparto: DIA_16, asignadoAt: ASIGNADA_EL_15_TARDE },
    ]);
    const repo = new RankingRepository(prisma);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA, DIA_REPARTO);

    // Se asigno a las 22:00 CR del 15 —FUERA de la ventana `[desde, hasta)` del 16— y aun asi
    // cuenta el 16, porque es el dia PARA EL QUE se asigno. Ese es todo el cambio de D7.
    expect(rows).toEqual([{ mensajeroId: "m1", total: 1 }]);
  });

  it("R37/R43: una orden SIN dia de reparto cuenta por `asignado_at` — el respaldo", async () => {
    // EL CASO DE DINERO. Las ordenes anteriores al despliegue tienen `fecha_reparto = NULL` para
    // siempre. Sin esta rama desaparecerian del denominador, TODOS los porcentajes subirian de
    // golpe y el podio del dia del despliegue seria falso para todos a la vez.
    const { prisma } = prismaDenominador([
      { mensajeroAsignadoId: "m1", fechaReparto: null, asignadoAt: ASIGNADA_EL_16 },
    ]);
    const repo = new RankingRepository(prisma);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA, DIA_REPARTO);

    expect(rows).toEqual([{ mensajeroId: "m1", total: 1 }]);
  });

  it("R38: asignada HOY para MAÑANA — no cuenta hoy", async () => {
    const { prisma } = prismaDenominador([
      { mensajeroAsignadoId: "m1", fechaReparto: DIA_17, asignadoAt: ASIGNADA_EL_16 },
    ]);
    const repo = new RankingRepository(prisma);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA, DIA_16);

    // Se asigno DENTRO de la ventana del 16, pero su dia de reparto es el 17: no engorda el
    // denominador del dia que acaba. Es el defecto que D7 corrige.
    expect(rows).toEqual([]);
  });

  it("R38: ...y SI cuenta mañana", async () => {
    const { prisma } = prismaDenominador([
      { mensajeroAsignadoId: "m1", fechaReparto: DIA_17, asignadoAt: ASIGNADA_EL_16 },
    ]);
    const repo = new RankingRepository(prisma);

    const rows = await repo.contarAsignadasPorMensajero(
      new Date("2026-07-17T06:00:00.000Z"),
      new Date("2026-07-18T06:00:00.000Z"),
      DIA_17,
    );

    expect(rows).toEqual([{ mensajeroId: "m1", total: 1 }]);
  });

  it("RAMAS DISJUNTAS: ninguna orden se cuenta DOS veces en dos dias distintos", async () => {
    // El caso testigo de la clausula `fechaReparto: null` de la segunda rama. Sin ella, esta
    // misma orden entraria por `asignado_at` en el denominador del 16 Y por `fecha_reparto` en el
    // del 17: contada dos veces, en dias distintos, sin que nada lo delate.
    const fila: FilaOrden = {
      mensajeroAsignadoId: "m1",
      fechaReparto: DIA_17,
      asignadoAt: ASIGNADA_EL_16,
    };
    const el16 = prismaDenominador([fila]);
    const el17 = prismaDenominador([fila]);

    const dia16 = await new RankingRepository(el16.prisma).contarAsignadasPorMensajero(
      DESDE,
      HASTA,
      DIA_16,
    );
    const dia17 = await new RankingRepository(el17.prisma).contarAsignadasPorMensajero(
      new Date("2026-07-17T06:00:00.000Z"),
      new Date("2026-07-18T06:00:00.000Z"),
      DIA_17,
    );

    const total = (dia16[0]?.total ?? 0) + (dia17[0]?.total ?? 0);
    expect(total).toBe(1); // exactamente 1 aporte, a exactamente un dia
    expect(dia16).toEqual([]);
    expect(dia17).toEqual([{ mensajeroId: "m1", total: 1 }]);
  });

  it("R43: MEZCLA del dia del despliegue — sin salto artificial en el denominador", async () => {
    // Tres ordenes viejas (sin fecha, asignadas hoy) + dos nuevas reservadas para hoy. El
    // denominador tiene que ser 5: el de siempre para las viejas y el nuevo para las nuevas.
    const { prisma } = prismaDenominador([
      { mensajeroAsignadoId: "m1", fechaReparto: null, asignadoAt: ASIGNADA_EL_16 },
      { mensajeroAsignadoId: "m1", fechaReparto: null, asignadoAt: ASIGNADA_EL_16 },
      { mensajeroAsignadoId: "m1", fechaReparto: null, asignadoAt: ASIGNADA_EL_16 },
      { mensajeroAsignadoId: "m1", fechaReparto: DIA_16, asignadoAt: ASIGNADA_EL_16 },
      { mensajeroAsignadoId: "m1", fechaReparto: DIA_16, asignadoAt: ASIGNADA_EL_15_TARDE },
    ]);
    const repo = new RankingRepository(prisma);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA, DIA_16);

    expect(rows).toEqual([{ mensajeroId: "m1", total: 5 }]);
  });

  it("una orden VIEJA asignada OTRO dia no entra por la puerta de atras", async () => {
    // El caso negativo del respaldo: `fecha_reparto IS NULL` no basta, tiene que estar TAMBIEN
    // dentro de la ventana. Sin esta comprobacion, la rama de respaldo traeria la tabla entera.
    const { prisma } = prismaDenominador([
      {
        mensajeroAsignadoId: "m1",
        fechaReparto: null,
        asignadoAt: new Date("2026-07-10T20:00:00.000Z"),
      },
    ]);
    const repo = new RankingRepository(prisma);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA, DIA_16);

    expect(rows).toEqual([]);
  });

  it("el `where` tiene la forma de DOS ramas y ninguna condicion de fecha suelta", async () => {
    // La forma, ademas del comportamiento. Una condicion suelta fuera del `OR` se aplicaria a las
    // DOS ramas y colaria a la reservada por la ventana de `asignado_at`.
    const { prisma, groupBy } = prismaDenominador([]);
    await new RankingRepository(prisma).contarAsignadasPorMensajero(DESDE, HASTA, DIA_REPARTO);

    const arg = groupBy.mock.calls[0]![0] as { by: string[]; where: WhereDenominador };
    expect(arg.by).toEqual(["mensajeroAsignadoId"]);
    expect(arg.where.mensajeroAsignadoId).toEqual({ not: null });
    expect(arg.where.OR).toEqual([
      { fechaReparto: DIA_REPARTO },
      { fechaReparto: null, asignadoAt: { gte: DESDE, lt: HASTA } },
    ]);
    expect(arg.where).not.toHaveProperty("asignadoAt");
    expect(arg.where).not.toHaveProperty("fechaReparto");
  });

  it("descarta filas residuales con mensajeroAsignadoId null sin afectar el conteo", async () => {
    const groupBy = vi.fn(async () => [
      { mensajeroAsignadoId: "m1", _count: { _all: 3 } },
      { mensajeroAsignadoId: null, _count: { _all: 9 } },
    ]);
    const repo = new RankingRepository({ orden: { groupBy } } as unknown as PrismaClient);

    const rows = await repo.contarAsignadasPorMensajero(DESDE, HASTA, DIA_REPARTO);

    expect(rows).toEqual([{ mensajeroId: "m1", total: 3 }]);
  });

  it("el doble detecta lo que dice detectar (autocomprobacion de las dos ramas)", async () => {
    // Si `casaRama` dejara de evaluar la clausula `fechaReparto: null` de la segunda rama, el
    // caso de doble conteo pasaria en verde con el predicado roto. Esto lo demuestra.
    const reservadaManana: FilaOrden = {
      mensajeroAsignadoId: "m1",
      fechaReparto: DIA_17,
      asignadoAt: ASIGNADA_EL_16,
    };
    // Rama de respaldo COMPLETA: no casa (tiene fecha).
    expect(
      casaRama(reservadaManana, { fechaReparto: null, asignadoAt: { gte: DESDE, lt: HASTA } }),
    ).toBe(false);
    // Rama de respaldo SIN la clausula `null` (la mutacion de T7.5): SI casa -> doble conteo.
    expect(casaRama(reservadaManana, { asignadoAt: { gte: DESDE, lt: HASTA } })).toBe(true);
  });
});
