import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreDelDiaRepository } from "@/lib/repositories/CierreDelDiaRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { ventanaDelDia } from "@/lib/ranking/snapshot-dia";

// Feature 293 (T2.2, T3.1, T3.2, T3.3) — las CUATRO lecturas nuevas, con Prisma mockeado.
//
// ⚠️ QUE PRUEBA ESTE ARCHIVO Y QUE NO. Fija la FORMA del `where`/`orderBy` que cada metodo emite
// y el contrato de su salida. NO prueba que el WHERE seleccione las filas correctas: eso es un
// hecho del motor y en este repo ya se midio CUATRO veces que una mutacion de un `where` pasa en
// verde por arriba. La medicion de verdad vive en
// `tests/integration/db/premio-ranking-idempotencia.test.ts`, contra Postgres.
//
// Money-safe: los importes se comparan como STRING; ni un `Number(` ni un `parseFloat`.

const DIA = new Date("2026-08-26T00:00:00.000Z"); // medianoche UTC = convencion `@db.Date`

// ── T2.2 — `sumarPremiosVivosPorCierre` ─────────────────────────────────────────────────────

function prismaConGroupBy(grupos: unknown[]) {
  const groupBy = vi.fn(async (_args: Record<string, unknown>) => grupos);
  return {
    prisma: {
      pagoMensajeroMovimiento: { groupBy, findMany: vi.fn() },
      usuario: {},
      liquidacionPago: {},
    },
    groupBy,
  };
}

describe("293/T2.2 — `sumarPremiosVivosPorCierre` (R24)", () => {
  it("el WHERE lleva las TRES piezas: origen_tipo, los ids y las dos categorias del premio", async () => {
    const { prisma, groupBy } = prismaConGroupBy([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.sumarPremiosVivosPorCierre(["c1", "c2"]);

    // `origenTipo` NO es adorno: sin el, un `origen_id` que coincidiera con un cierre —el id de
    // un PAGO, por ejemplo— sumaria dinero a un cierre al que no pertenece.
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0][0]).toEqual({
      by: ["origenId", "categoria"],
      where: {
        origenTipo: "cierre_dia",
        origenId: { in: ["c1", "c2"] },
        OR: [
          { categoria: "premio_ranking" },
          // `premioDia: { not: null }` es lo que separa la compensacion de un premio de un
          // `ajuste_pago` cualquiera: son la misma categoria.
          { categoria: "ajuste_pago", premioDia: { not: null } },
        ],
      },
      _sum: { monto: true },
    });
  });

  it("devuelve una entrada por CADA id pedido, tambien los que no tienen premio", async () => {
    const { prisma } = prismaConGroupBy([
      { origenId: "c1", categoria: "premio_ranking", _sum: { monto: new Prisma.Decimal("5000") } },
    ]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.sumarPremiosVivosPorCierre(["c1", "c2"])).toEqual({
      c1: "5000.00",
      c2: "0.00", // el caller no tiene que distinguir «no hay» de «no lo pedi»
    });
  });

  it("el premio SUMA y su compensacion RESTA: anulado, el cierre queda en 0.00", async () => {
    const { prisma } = prismaConGroupBy([
      { origenId: "c1", categoria: "premio_ranking", _sum: { monto: new Prisma.Decimal("5000") } },
      { origenId: "c1", categoria: "ajuste_pago", _sum: { monto: new Prisma.Decimal("5000") } },
    ]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.sumarPremiosVivosPorCierre(["c1"])).toEqual({ c1: "0.00" });
  });

  it("dos premios de DIAS distintos en el MISMO cierre se suman los dos (R19)", async () => {
    // El `groupBy` es por `(origenId, categoria)`, asi que dos premios del mismo cierre llegan ya
    // agregados. La cifra tiene que ser la suma, no la del ultimo.
    const { prisma } = prismaConGroupBy([
      { origenId: "c1", categoria: "premio_ranking", _sum: { monto: new Prisma.Decimal("7000") } },
    ]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.sumarPremiosVivosPorCierre(["c1"])).toEqual({ c1: "7000.00" });
  });

  it("con la lista vacia no consulta la base y devuelve `{}`", async () => {
    const { prisma, groupBy } = prismaConGroupBy([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.sumarPremiosVivosPorCierre([])).toEqual({});
    expect(groupBy).not.toHaveBeenCalled();
  });

  it("UNA sola consulta para N cierres (no una por cierre)", async () => {
    const { prisma, groupBy } = prismaConGroupBy([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.sumarPremiosVivosPorCierre(["c1", "c2", "c3", "c4", "c5"]);

    expect(groupBy).toHaveBeenCalledTimes(1);
  });
});

// ── T3.3 — `listarPremiosPorDias` ───────────────────────────────────────────────────────────

describe("293/T3.3 — `listarPremiosPorDias` (R9/R32)", () => {
  function prismaConFindMany(filas: unknown[]) {
    const findMany = vi.fn(async (_args: Record<string, unknown>) => filas);
    return {
      prisma: {
        pagoMensajeroMovimiento: { findMany, groupBy: vi.fn() },
        usuario: {},
        liquidacionPago: {},
      },
      findMany,
    };
  }

  it("acota por mensajero, por los dias pedidos y por las dos categorias del premio", async () => {
    const { prisma, findMany } = prismaConFindMany([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.listarPremiosPorDias("m1", [DIA]);

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        mensajeroId: "m1", // R20: el acotado va en el WHERE, nunca en memoria
        premioDia: { in: [DIA] },
        categoria: { in: ["premio_ranking", "ajuste_pago"] },
      },
      orderBy: { fechaMovimiento: "asc" },
    });
  });

  it("deriva el cierre del origen y devuelve el monto como STRING de escala 2", async () => {
    const { prisma } = prismaConFindMany([
      {
        categoria: "premio_ranking",
        premioDia: DIA,
        monto: new Prisma.Decimal("5000"),
        origenTipo: "cierre_dia",
        origenId: "c1",
        fechaMovimiento: new Date("2026-08-27T15:00:00.000Z"),
      },
    ]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.listarPremiosPorDias("m1", [DIA])).toEqual([
      {
        categoria: "premio_ranking",
        premioDia: DIA,
        monto: "5000.00",
        cierreId: "c1",
        fechaMovimiento: new Date("2026-08-27T15:00:00.000Z"),
      },
    ]);
  });

  it("sin dias no consulta y devuelve []", async () => {
    const { prisma, findMany } = prismaConFindMany([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    expect(await repo.listarPremiosPorDias("m1", [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("m4: con `tx`, la consulta sale POR ESA transaccion y NO por el cliente del repositorio", async () => {
    // Los dos clientes existen a la vez y solo uno debe consultar: si el repositorio ignorara el
    // `tx`, la lectura de dentro de la transaccion iria por otra conexion —que no ve lo que la
    // transaccion lleva escrito— y este caso lo dice con el conteo, no con una afirmacion.
    const suyo = prismaConFindMany([]);
    const transaccion = prismaConFindMany([]);
    const repo = new PagoMensajeroMovimientoRepository(suyo.prisma as unknown as PrismaClient);

    await repo.listarPremiosPorDias("m1", [DIA], transaccion.prisma as unknown as PrismaClient);

    expect(transaccion.findMany).toHaveBeenCalledTimes(1);
    expect(suyo.findMany).not.toHaveBeenCalled();
    // Y el WHERE es el MISMO por los dos caminos: el `tx` cambia la conexion, no la consulta.
    expect(transaccion.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        mensajeroId: "m1",
        premioDia: { in: [DIA] },
        categoria: { in: ["premio_ranking", "ajuste_pago"] },
      },
    });
  });

  it("sin `tx` sigue consultando por el cliente del repositorio", async () => {
    const suyo = prismaConFindMany([]);
    const repo = new PagoMensajeroMovimientoRepository(suyo.prisma as unknown as PrismaClient);

    await repo.listarPremiosPorDias("m1", [DIA]);

    expect(suyo.findMany).toHaveBeenCalledTimes(1);
  });
});

// ── T3.1 — el podio congelado ───────────────────────────────────────────────────────────────

describe("293/T3.1 — `listarPodioDeFecha` y `obtenerFilaDelPodio` (R4/R6/R16)", () => {
  function prismaSnapshot(cabecera: unknown, filas: unknown[]) {
    const findUnique = vi.fn(async (_args: Record<string, unknown>) => cabecera);
    const findMany = vi.fn(async (_args: Record<string, unknown>) => filas);
    const findFirst = vi.fn(async (_args: Record<string, unknown>) => filas[0] ?? null);
    return {
      prisma: {
        rankingSnapshotDia: { findUnique, create: vi.fn() },
        rankingSnapshotFila: { findMany, findFirst, createMany: vi.fn() },
        $transaction: vi.fn(),
      },
      findUnique,
      findMany,
      findFirst,
    };
  }

  const FILA = {
    id: "f1",
    posicion: 1,
    mensajeroId: "m1",
    mensajeroNombre: "Kevin Rojas",
    entregadas: 0,
    asignadas: 21,
    premioMonto: new Prisma.Decimal("5000"),
    premioDescripcion: "Bono por buen rendimiento",
  };

  it("R6: sin cabecera devuelve `null` (y NO `[]`): son dos textos distintos en pantalla", async () => {
    const { prisma, findMany } = prismaSnapshot(null, []);
    const repo = new RankingSnapshotRepository(prisma as unknown as PrismaClient);

    expect(await repo.listarPodioDeFecha(DIA)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("R4: filtra por `posicion IS NOT NULL` en el WHERE y ordena por posicion asc", async () => {
    const { prisma, findMany } = prismaSnapshot({ id: "s1" }, [FILA]);
    const repo = new RankingSnapshotRepository(prisma as unknown as PrismaClient);

    await repo.listarPodioDeFecha(DIA);

    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { snapshotId: "s1", posicion: { not: null } },
      orderBy: { posicion: "asc" },
    });
  });

  it("R4/R5: devuelve el nombre CONGELADO, el par entregadas/asignadas y el monto STRING", async () => {
    const { prisma } = prismaSnapshot({ id: "s1" }, [FILA]);
    const repo = new RankingSnapshotRepository(prisma as unknown as PrismaClient);

    expect(await repo.listarPodioDeFecha(DIA)).toEqual([
      {
        filaId: "f1",
        posicion: 1,
        mensajeroId: "m1",
        mensajeroNombre: "Kevin Rojas",
        entregadas: 0, // R5: el cero VIAJA, no se oculta ni se sustituye
        asignadas: 21,
        premioMonto: "5000.00",
        premioDescripcion: "Bono por buen rendimiento",
      },
    ]);
  });

  it("una fila con snapshot pero sin podio devuelve `[]`, que no es `null`", async () => {
    const { prisma } = prismaSnapshot({ id: "s1" }, []);
    const repo = new RankingSnapshotRepository(prisma as unknown as PrismaClient);

    expect(await repo.listarPodioDeFecha(DIA)).toEqual([]);
  });

  it("R16: `obtenerFilaDelPodio` exige `posicion IS NOT NULL` y trae la FECHA del snapshot", async () => {
    const { prisma, findFirst } = prismaSnapshot({ id: "s1" }, [
      { ...FILA, snapshot: { fecha: DIA } },
    ]);
    const repo = new RankingSnapshotRepository(prisma as unknown as PrismaClient);

    const fila = await repo.obtenerFilaDelPodio("f1");

    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: "f1", posicion: { not: null } },
    });
    // La fecha viene de la BASE, no del cliente: es la mitad de R16.
    expect(fila).toMatchObject({ filaId: "f1", mensajeroId: "m1", fecha: DIA, premioMonto: "5000.00" });
  });
});

// ── T3.2 — la resolucion dia -> cierre ──────────────────────────────────────────────────────

describe("293/T3.2 — `resolverCierreDelDia` (design §4)", () => {
  function prismaCierres(fila: unknown) {
    const findFirst = vi.fn(async (_args: Record<string, unknown>) => fila);
    return { prisma: { cierreDia: { findFirst } }, findFirst };
  }

  it("§4.2: el vinculo es la GESTION vigente dentro de la ventana, no `solicitado_at`", async () => {
    const { prisma, findFirst } = prismaCierres(null);
    const repo = new CierreDelDiaRepository(prisma as unknown as PrismaClient);
    const ventana = ventanaDelDia("2026-08-26");

    await repo.resolverCierreDelDia("m1", ventana);

    expect(findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        mensajeroId: "m1",
        gestiones: {
          some: {
            anuladaAt: null, // una gestion deshecha no es trabajo de ese dia
            createdAt: { gte: ventana.desde, lt: ventana.hasta }, // SEMIABIERTA: `lt`, no `lte`
          },
        },
      },
      // §4.4: el mas antiguo por `solicitado_at`, desempate por `id`. Las dos son inmutables, asi
      // que preguntar dos veces da el mismo cierre (Q5).
      orderBy: [{ solicitadoAt: "asc" }, { id: "asc" }],
    });
  });

  it("la ventana es la del CRON: 06:00Z del dia a 06:00Z del siguiente", async () => {
    // Si alguien usara `startOfDayCR` (medianoche UTC) como cota contra un `timestamp`, la
    // ventana seria la 18:00-18:00 hora CR que cerro la ficha 166.
    const ventana = ventanaDelDia("2026-08-26");
    expect(ventana.desde.toISOString()).toBe("2026-08-26T06:00:00.000Z");
    expect(ventana.hasta.toISOString()).toBe("2026-08-27T06:00:00.000Z");
  });

  it("R11: sin cierre devuelve `null`", async () => {
    const { prisma } = prismaCierres(null);
    const repo = new CierreDelDiaRepository(prisma as unknown as PrismaClient);

    expect(await repo.resolverCierreDelDia("m1", ventanaDelDia("2026-08-26"))).toBeNull();
  });

  it("devuelve id Y estado: quien decide si sirve es el servicio, no el repositorio", async () => {
    const { prisma } = prismaCierres({
      id: "c1",
      estado: "solicitado",
      solicitadoAt: new Date("2026-08-27T02:00:00.000Z"),
    });
    const repo = new CierreDelDiaRepository(prisma as unknown as PrismaClient);

    expect(await repo.resolverCierreDelDia("m1", ventanaDelDia("2026-08-26"))).toEqual({
      cierreId: "c1",
      estado: "solicitado",
      solicitadoAt: new Date("2026-08-27T02:00:00.000Z"),
    });
  });
});
