import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";

// Feature 49 — tests unit del OrdenHistorialRepository (mockea Prisma, sin DB real, patron
// wallet-movimiento-repository.test.ts). Cubre R6 (choke point centralizado), R7 (escribe
// en el `tx` recibido), R24 (conteo por destino con el indice del destino), R27
// (existeActuacionDe filtra por actor), y el mapeo a DTO legible (R26).

function buildPrisma() {
  return {
    ordenHistorialEstado: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  };
}

describe("registrarCambioEstado (R6/R7)", () => {
  it("R7: hace createMany en el `tx` recibido (no en el prisma del constructor)", async () => {
    const prisma = buildPrisma(); // cliente de lectura del constructor
    const tx = buildPrisma(); // transaccion en curso
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 1 });
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.registrarCambioEstado(tx as never, [
      {
        ordenId: "o1",
        estatusOrigenId: "s-origen",
        estatusDestinoId: "s-destino",
        actorUsuarioId: "u1",
        origenTipo: "gestion",
        motivo: "cliente ausente",
        gestionOrdenId: "g1",
      },
    ]);

    // El append va al `tx`, nunca al prisma del constructor (atomicidad R7).
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("creacion (origen null) y sistema (actor null) se persisten como null; motivo/tipo/gestion correctos", async () => {
    const tx = buildPrisma();
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 2 });
    const repo = new OrdenHistorialRepository(buildPrisma() as unknown as PrismaClient);

    const entradas: CambioEstadoEntrada[] = [
      {
        ordenId: "o1",
        estatusOrigenId: null, // R1/R20: creacion
        estatusDestinoId: "s-inicial",
        actorUsuarioId: "u-tienda",
        origenTipo: "carga_masiva",
        // sin motivo ni gestionOrdenId
      },
      {
        ordenId: "o2",
        estatusOrigenId: "s-reprogramada",
        estatusDestinoId: "s-bodega",
        actorUsuarioId: null, // R21: sistema/cron
        origenTipo: "liberacion_reprogramada",
      },
    ];
    await repo.registrarCambioEstado(tx as never, entradas);

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data[0]).toEqual({
      ordenId: "o1",
      estatusOrigenId: null,
      estatusDestinoId: "s-inicial",
      actorUsuarioId: "u-tienda",
      origenTipo: "carga_masiva",
      motivo: null, // defaulteado a null cuando no viene
      gestionOrdenId: null,
    });
    expect(arg.data[1]).toEqual({
      ordenId: "o2",
      estatusOrigenId: "s-reprogramada",
      estatusDestinoId: "s-bodega",
      actorUsuarioId: null,
      origenTipo: "liberacion_reprogramada",
      motivo: null,
      gestionOrdenId: null,
    });
  });

  it("lista vacia -> no llama createMany (no-op)", async () => {
    const tx = buildPrisma();
    const repo = new OrdenHistorialRepository(buildPrisma() as unknown as PrismaClient);
    await repo.registrarCambioEstado(tx as never, []);
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("findHistorialByOrden (R26/R5)", () => {
  it("ordena cronologicamente (created_at asc), incluye value/nombre y mapea a DTO legible", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      {
        id: "h1",
        ordenId: "o1",
        estatusOrigenId: null,
        estatusDestinoId: "s-inicial",
        actorUsuarioId: "u-tienda",
        origenTipo: "carga_masiva",
        motivo: null,
        gestionOrdenId: null,
        createdAt: new Date("2026-07-13T10:00:00.000Z"),
        estatusOrigen: null, // creacion
        estatusDestino: { value: "en_preparacion" },
        actor: { nombre: "Tienda X" },
      },
      {
        id: "h2",
        ordenId: "o1",
        estatusOrigenId: "s-reparto",
        estatusDestinoId: "s-devuelta",
        actorUsuarioId: null, // sistema
        origenTipo: "gestion",
        motivo: "cliente ausente",
        gestionOrdenId: "g1",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
        estatusOrigen: { value: "en_reparto" },
        estatusDestino: { value: "devuelta" },
        actor: null,
      },
    ]);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const r = await repo.findHistorialByOrden("o1");

    const arg = prisma.ordenHistorialEstado.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ ordenId: "o1" });
    expect(arg.orderBy).toEqual({ createdAt: "asc" }); // R26 cronologico
    expect(arg.include).toEqual({
      estatusOrigen: { select: { value: true } },
      estatusDestino: { select: { value: true } },
      actor: { select: { nombre: true } },
    });

    expect(r).toEqual([
      {
        estatusOrigenValue: null, // creacion (R1/R20)
        estatusDestinoValue: "en_preparacion",
        origenTipo: "carga_masiva",
        actorNombre: "Tienda X",
        motivo: null,
        createdAt: new Date("2026-07-13T10:00:00.000Z"),
      },
      {
        estatusOrigenValue: "en_reparto",
        estatusDestinoValue: "devuelta",
        origenTipo: "gestion",
        actorNombre: null, // sistema (R21)
        motivo: "cliente ausente",
        createdAt: new Date("2026-07-13T12:00:00.000Z"),
      },
    ]);
  });
});

describe("contarPorDestinoVigentes (49/R24 + 64/R24-R26)", () => {
  it("cuenta filtrando por ordenId + estatusDestinoId (usa el indice del destino)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(3);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarPorDestinoVigentes("o1", "s-devuelta");

    expect(n).toBe(3);
    const arg = prisma.ordenHistorialEstado.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({ ordenId: "o1", estatusDestinoId: "s-devuelta" });
  });

  // Feature 64 (F1.4-a, design §4.2): el predicado discrimina por `origen_tipo`, NO por la
  // nulidad del enlace. Este test FIJA la forma exacta del OR: si alguien lo relaja al
  // predicado ingenuo (`{ gestionOrdenId: null }` a secas), rompe.
  it("64/R24-R26: el WHERE es el OR de (sin-gestion FUERA de la familia gestion) | (gestion vigente)", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    await repo.contarPorDestinoVigentes("o1", "s-devuelta");

    const arg = prisma.ordenHistorialEstado.count.mock.calls[0][0];
    expect(arg.where.OR).toEqual([
      // R25: nunca vino de una gestion -> cuenta. R26: la exclusion de la familia gestion es
      // lo que impide que una HUERFANA (origen `gestion` + enlace vacio) entre por esta rama.
      { gestionOrdenId: null, origenTipo: { notIn: ["gestion", "deshacer_gestion"] } },
      // R24: vino de una gestion -> cuenta solo si esa gestion NO esta anulada.
      { gestion: { anuladaAt: null } },
    ]);
    // El predicado ingenuo (nulidad del enlace a secas) NO debe aparecer: `gestion_orden_id
    // IS NULL` es AMBIGUO (design §4.1) y devolveria al conteo el intento de una gestion
    // borrada -> escalado a `rechazada` antes de tiempo -> cobroRechazado (56) mal.
    expect(arg.where.OR).not.toContainEqual({ gestionOrdenId: null });
  });
});

// Feature 64 (F1.4-a) — verificacion SEMANTICA del predicado: se evalua el WHERE que produce
// el repo contra filas de ejemplo (sin DB), para probar que cada caso de la tabla de design
// §4.1 cae del lado correcto. Complementa al test de forma de arriba: ese fija la QUERY, este
// fija el SIGNIFICADO.
describe("contarPorDestinoVigentes — semantica del predicado (64/R24-R26)", () => {
  type Fila = {
    gestionOrdenId: string | null;
    origenTipo: string;
    gestion: { anuladaAt: Date | null } | null;
  };

  // Mini-evaluador del `where` de Prisma que produce el repo (solo las ramas que usa).
  function cuentaSegunWhere(where: Record<string, unknown>, filas: Fila[]): number {
    const or = where.OR as Array<Record<string, never>>;
    return filas.filter((f) =>
      or.some((rama) => {
        const r = rama as unknown as {
          gestionOrdenId?: null;
          origenTipo?: { notIn: string[] };
          gestion?: { anuladaAt: null };
        };
        if (r.gestion !== undefined) {
          // { gestion: { anuladaAt: null } }: exige gestion ENLAZADA y no anulada. Una fila con
          // el enlace vacio NO tiene gestion relacionada -> no casa.
          return f.gestion !== null && f.gestion.anuladaAt === null;
        }
        return (
          f.gestionOrdenId === null &&
          !(r.origenTipo as { notIn: string[] }).notIn.includes(f.origenTipo)
        );
      }),
    ).length;
  }

  async function whereDelRepo(): Promise<Record<string, unknown>> {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.count.mockResolvedValue(0);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    await repo.contarPorDestinoVigentes("o1", "s-devuelta");
    return prisma.ordenHistorialEstado.count.mock.calls[0][0].where;
  }

  it("R25: la transicion SIN gestion de un ajuste administrativo SI cuenta (no es anulable)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [{ gestionOrdenId: null, origenTipo: "ajuste_estado", gestion: null }];
    expect(cuentaSegunWhere(where, filas)).toBe(1);
  });

  it("cuenta la transicion de una gestion VIGENTE (no anulada)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [{ gestionOrdenId: "g1", origenTipo: "gestion", gestion: { anuladaAt: null } }];
    expect(cuentaSegunWhere(where, filas)).toBe(1);
  });

  it("R24: NO cuenta la transicion de una gestion ANULADA (deshecha)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      { gestionOrdenId: "g1", origenTipo: "gestion", gestion: { anuladaAt: new Date("2026-07-14T10:00:00Z") } },
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("R26: NO cuenta la HUERFANA (origen `gestion` + enlace vacio: la gestion se borro)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [{ gestionOrdenId: null, origenTipo: "gestion", gestion: null }];
    // Ante la duda, la huerfana NO cuenta: contar de menos = mas intentos que el minimo legal
    // (inofensivo); contar de mas = escalar antes de tiempo y cobrar cobroRechazado mal.
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("R26: tampoco cuenta la huerfana de un `deshacer_gestion` (misma familia)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [{ gestionOrdenId: null, origenTipo: "deshacer_gestion", gestion: null }];
    expect(cuentaSegunWhere(where, filas)).toBe(0);
  });

  it("caso mixto: de 4 filas a `devuelta` solo cuentan la vigente y la del ajuste (R24/R25/R26)", async () => {
    const where = await whereDelRepo();
    const filas: Fila[] = [
      { gestionOrdenId: "g1", origenTipo: "gestion", gestion: { anuladaAt: null } }, // vigente -> cuenta
      { gestionOrdenId: "g2", origenTipo: "gestion", gestion: { anuladaAt: new Date() } }, // anulada -> no
      { gestionOrdenId: null, origenTipo: "gestion", gestion: null }, // huerfana -> no
      { gestionOrdenId: null, origenTipo: "ajuste_estado", gestion: null }, // admin -> cuenta
    ];
    expect(cuentaSegunWhere(where, filas)).toBe(2);
  });
});

describe("existeActuacionDe (R27)", () => {
  it("true si hay una transicion actuada por el usuario", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findFirst.mockResolvedValue({ id: "h1" });
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);

    const r = await repo.existeActuacionDe("o1", "m1");

    expect(r).toBe(true);
    expect(prisma.ordenHistorialEstado.findFirst).toHaveBeenCalledWith({
      where: { ordenId: "o1", actorUsuarioId: "m1" },
      select: { id: true },
    });
  });

  it("false si el usuario nunca actuo la orden", async () => {
    const prisma = buildPrisma();
    prisma.ordenHistorialEstado.findFirst.mockResolvedValue(null);
    const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
    expect(await repo.existeActuacionDe("o1", "m2")).toBe(false);
  });
});
