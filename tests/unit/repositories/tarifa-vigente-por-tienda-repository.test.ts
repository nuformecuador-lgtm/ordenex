import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import type { TarifaTxClient } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";

// Feature 69 (R20/R22/R23/R30, decisiones (d) y (g)) — tests de la CLASE REAL del resolver
// contra un doble de `Pick<PrismaClient,"tarifa">` (patron cierre-dia-repository.test.ts:38-58).
// Decision (d): NO se mockea la interfaz. Hoy TODOS los tests de la 42/43 mockean
// `ITarifaVigente...` -> cuando el PR #64 dropeo `tarifas.zona_id`, la suite siguio VERDE y solo
// `pnpm typecheck` lo vio (esa fue la 68). Estos tests afirman los ARGUMENTOS EXACTOS que el
// resolver le pasa a Prisma: si el modelo de `tarifas` cambia de columna, la suite falla.

const FUENTE_RESOLVER = join(
  process.cwd(),
  "lib/repositories/TarifaVigentePorTiendaRepository.ts",
);

function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tar1",
    tiendaId: "t1",
    valorFlete: new Prisma.Decimal("1000"),
    valorFleteGam: new Prisma.Decimal("1500"),
    valorFleteDevuelto: new Prisma.Decimal("400"),
    valorFleteDevueltoGam: new Prisma.Decimal("600"),
    comisionCod: new Prisma.Decimal("5"),
    ivaFlete: new Prisma.Decimal("13"),
    ivaComisionCod: new Prisma.Decimal("13"),
    ...overrides,
  };
}

function buildPrisma() {
  return { tarifa: { findFirst: vi.fn(), findMany: vi.fn() } };
}

function buildRepo(prisma: ReturnType<typeof buildPrisma>) {
  return new TarifaVigentePorTiendaRepository(prisma as unknown as PrismaClient);
}

describe("TarifaVigentePorTiendaRepository.resolveTarifaPorTienda (R20/R22/R23)", () => {
  it("R20: resuelve por `tiendaId` (NO por zona: el PR #64 dropeo tarifas.zona_id)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());

    await buildRepo(prisma).resolveTarifaPorTienda("t1");

    const args = prisma.tarifa.findFirst.mock.calls[0]![0];
    // El argumento EXACTO: si alguien vuelve a `zonaId` (la 68) este test cae, no solo el typecheck.
    expect(args.where).toEqual({ tiendaId: "t1", deletedAt: null });
    expect(Object.keys(args.where)).toContain("tiendaId");
    expect(Object.keys(args.where)).not.toContain("zonaId");
  });

  it("R22: excluye las borradas logicamente (`deletedAt: null`) y elige la MAS RECIENTE", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());

    await buildRepo(prisma).resolveTarifaPorTienda("t1");

    const args = prisma.tarifa.findFirst.mock.calls[0]![0];
    expect(args.where.deletedAt).toBeNull();
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("R22/(g): el `where` NO filtra por `status` — override consciente del humano", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());

    await buildRepo(prisma).resolveTarifaPorTienda("t1");

    // Testear una AUSENCIA es deliberado (design §6.1): `tarifas.status` existe desde el PR #64
    // y la decision (g) de la feature 69 es NO filtrarlo (no mezclar dos cambios de dinero en un
    // PR). Si alguien "arregla" el filtro sin pasar por una gate, un cambio de dinero entraria de
    // contrabando: este test lo delata. Para cambiarlo hace falta una gate, no un commit.
    const args = prisma.tarifa.findFirst.mock.calls[0]![0];
    expect(Object.keys(args.where)).not.toContain("status");
    expect(JSON.stringify(args.where)).not.toContain("status");
  });

  it("R8: proyecta los 7 campos de la tarifa como STRING escala 2 (money-safe)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());

    const t = await buildRepo(prisma).resolveTarifaPorTienda("t1");

    expect(t).toEqual({
      valorFlete: "1000.00",
      valorFleteGam: "1500.00",
      valorFleteDevuelto: "400.00",
      valorFleteDevueltoGam: "600.00",
      comisionCod: "5.00",
      ivaFlete: "13.00",
      ivaComisionCod: "13.00",
    });
    // El `select` pide EXACTAMENTE las 7 columnas de la formula (ni de mas ni de menos).
    expect(prisma.tarifa.findFirst.mock.calls[0]![0].select).toEqual({
      valorFlete: true,
      valorFleteGam: true,
      valorFleteDevuelto: true,
      valorFleteDevueltoGam: true,
      comisionCod: true,
      ivaFlete: true,
      ivaComisionCod: true,
    });
  });

  it("R9: tienda sin tarifa vigente -> null (gap de datos, no lanza)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(null);

    await expect(buildRepo(prisma).resolveTarifaPorTienda("t1")).resolves.toBeNull();
  });
});

describe("TarifaVigentePorTiendaRepository.resolveTarifasPorTiendas (R20/R22/R23, batch)", () => {
  it("resuelve N tiendas con UNA sola query (`tienda_id IN (...)`), sin N+1", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "tarA", tiendaId: "t1" }),
      tarifaRow({ id: "tarB", tiendaId: "t2" }),
    ]);

    const out = await buildRepo(prisma).resolveTarifasPorTiendas(
      prisma as unknown as TarifaTxClient,
      ["t1", "t2", "t1"],
    );

    expect(prisma.tarifa.findMany).toHaveBeenCalledTimes(1); // sin N+1
    const args = prisma.tarifa.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ tiendaId: { in: ["t1", "t2"] }, deletedAt: null }); // dedupe
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(out.get("t1")?.tarifaId).toBe("tarA");
    expect(out.get("t2")?.tarifaId).toBe("tarB");
  });

  it("R22/(g): el `where` del batch tampoco filtra por `status` (misma regla que el singular)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([]);

    await buildRepo(prisma).resolveTarifasPorTiendas(prisma as unknown as TarifaTxClient, ["t1"]);

    const args = prisma.tarifa.findMany.mock.calls[0]![0];
    expect(Object.keys(args.where)).not.toContain("status");
    expect(JSON.stringify(args.where)).not.toContain("status");
  });

  it("R22: con varias tarifas de la misma tienda elige la MAS RECIENTE (la primera del orderBy)", async () => {
    const prisma = buildPrisma();
    // `orderBy createdAt desc` => la primera fila de cada tienda es la mas reciente.
    prisma.tarifa.findMany.mockResolvedValue([
      tarifaRow({ id: "reciente", tiendaId: "t1", valorFlete: new Prisma.Decimal("999") }),
      tarifaRow({ id: "vieja", tiendaId: "t1", valorFlete: new Prisma.Decimal("111") }),
    ]);

    const out = await buildRepo(prisma).resolveTarifasPorTiendas(
      prisma as unknown as TarifaTxClient,
      ["t1"],
    );

    expect(out.get("t1")?.tarifaId).toBe("reciente");
    expect(out.get("t1")?.valorFlete).toBe("999.00");
  });

  it("R9: la tienda sin tarifa aparece en el Map con `null` (gap explicito, no ausencia)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([tarifaRow({ tiendaId: "t1" })]);

    const out = await buildRepo(prisma).resolveTarifasPorTiendas(
      prisma as unknown as TarifaTxClient,
      ["t1", "sin-tarifa"],
    );

    expect(out.has("sin-tarifa")).toBe(true);
    expect(out.get("sin-tarifa")).toBeNull();
  });

  it("R8: el batch congela tambien `tarifaId` (auditoria: QUE fila se uso) + los 7 STRING", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([tarifaRow({ id: "tar1", tiendaId: "t1" })]);

    const out = await buildRepo(prisma).resolveTarifasPorTiendas(
      prisma as unknown as TarifaTxClient,
      ["t1"],
    );

    expect(out.get("t1")).toEqual({
      tarifaId: "tar1",
      valorFlete: "1000.00",
      valorFleteGam: "1500.00",
      valorFleteDevuelto: "400.00",
      valorFleteDevueltoGam: "600.00",
      comisionCod: "5.00",
      ivaFlete: "13.00",
      ivaComisionCod: "13.00",
    });
  });

  it("lista vacia -> Map vacio sin consultar la DB", async () => {
    const prisma = buildPrisma();

    const out = await buildRepo(prisma).resolveTarifasPorTiendas(
      prisma as unknown as TarifaTxClient,
      [],
    );

    expect(out.size).toBe(0);
    expect(prisma.tarifa.findMany).not.toHaveBeenCalled();
  });
});

describe("R30 — marcador TODO: de la deuda (g) en el resolver", () => {
  // Test ESTRUCTURAL sobre el fuente: si un refactor borra el TODO, la deuda dejaria de estar
  // declarada donde vive el codigo que la causa. Falla entonces (esa es la red).
  const fuente = readFileSync(FUENTE_RESOLVER, "utf8");
  // El marcador REAL empieza literalmente por `TODO:` al inicio de su linea de comentario. Se
  // ancla asi a proposito: una mencion suelta ("ver el TODO: ...") NO debe dar por cumplido R30.
  const MARCADOR = /^\s*(?:\/\/|\*)\s*TODO:/m;

  it("el fuente contiene un `TODO:` localizable por grep", () => {
    expect(fuente).toMatch(/TODO:/);
    expect(fuente).toMatch(MARCADOR); // y es un marcador, no una referencia de pasada
  });

  it("el TODO declara que `status` NO se filtra y que puede liquidar dinero una tarifa inactiva", () => {
    const todo = fuente.slice(fuente.search(MARCADOR));
    expect(todo).toMatch(/status/);
    expect(todo).toMatch(/PR #64/);
    expect(todo).toMatch(/inactivo/i);
    expect(todo).toMatch(/deleted_at IS NULL/);
  });

  it("el TODO referencia la feature 69 y la decision (g)", () => {
    const todo = fuente.slice(fuente.search(MARCADOR));
    expect(todo).toMatch(/feature 69/i);
    expect(todo).toMatch(/\(g\)/);
  });

  it("el TODO enmarca lo pendiente como la SELECCION de la fila, no como 'migrar a snapshot'", () => {
    // design §6.1: "migrarlo a snapshot" queda SIN OBJETO — R8 ya congela la tarifa en esta
    // misma feature. Congelar no corrige la seleccion: la vuelve permanente.
    const todo = fuente.slice(fuente.search(MARCADOR));
    expect(todo).toMatch(/SELECCION/i);
    expect(todo).toMatch(/WHERE/);
  });
});
