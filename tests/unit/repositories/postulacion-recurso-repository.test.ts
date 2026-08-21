import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PostulacionRecursoRepository } from "@/lib/repositories/PostulacionRecursoRepository";

// Feature 253 (T3.2) — el repositorio contra un DOBLE de Prisma: comprueba QUE ARGUMENTOS emite
// (el `where`, el `orderBy`, el `skip`/`take`, el `select`) y que no hace nada mas.
//
// ⚠️ ESTE ARCHIVO NO SUSTITUYE AL TEST CONTRA POSTGRES REAL, y decirlo aqui es parte del trabajo:
// un doble NO VE EL SQL. Comprobar que el repositorio PASA `{ atendidaAt: null }` no demuestra que
// Postgres excluya las filas atendidas, ni que `{ lt: corte }` sobre una columna nullable descarte
// los NULL. Eso vive en `tests/integration/db/postulacion-recurso-migration.test.ts`, contra la
// base de verdad. Lo de aqui es lo complementario: que la forma de la consulta no cambie sin que
// nadie se entere.

interface Doble {
  create: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}

function dobleDePrisma(overrides: Partial<Doble> = {}): {
  prisma: Pick<PrismaClient, "postulacionRecurso">;
  postulacionRecurso: Doble;
} {
  const postulacionRecurso: Doble = {
    create: vi.fn().mockResolvedValue({ id: "pr-1", createdAt: new Date("2026-08-20T10:00:00Z") }),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    count: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return {
    prisma: { postulacionRecurso } as unknown as Pick<PrismaClient, "postulacionRecurso">,
    postulacionRecurso,
  };
}

describe("253 / R21 — `crear` inserta los cinco campos y devuelve el id", () => {
  it("emite un `create` con exactamente los datos recibidos", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    const repo = new PostulacionRecursoRepository(prisma);

    const r = await repo.crear({
      tipo: "bodega",
      nombre: "Ana Solis",
      telefono: "88888888",
      correo: "ana@ejemplo.com",
      mensaje: "200 m2 en Alajuela",
    });

    expect(r.id).toBe("pr-1");
    expect(postulacionRecurso.create).toHaveBeenCalledTimes(1);
    expect(postulacionRecurso.create.mock.calls[0][0].data).toEqual({
      tipo: "bodega",
      nombre: "Ana Solis",
      telefono: "88888888",
      correo: "ana@ejemplo.com",
      mensaje: "200 m2 en Alajuela",
    });
  });

  it("R24: el repositorio NO conoce `usuario` — su cliente solo expone `postulacionRecurso`", () => {
    const { prisma } = dobleDePrisma();
    // Si alguien anadiera aqui una escritura sobre `usuario`, el doble no la tendria y reventaria.
    expect(Object.keys(prisma)).toEqual(["postulacionRecurso"]);
  });
});

describe("253 / R26 + R33 — `listar` filtra por la pestana y ordena por fecha descendente", () => {
  it("pendientes: `atendidaAt: null`, `createdAt desc`, con skip/take", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    const repo = new PostulacionRecursoRepository(prisma);

    await repo.listar({ atendidas: false, skip: 20, take: 10 });

    const args = postulacionRecurso.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ atendidaAt: null });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it("atendidas: `atendidaAt: { not: null }`", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    await new PostulacionRecursoRepository(prisma).listar({ atendidas: true, skip: 0, take: 5 });
    expect(postulacionRecurso.findMany.mock.calls[0][0].where).toEqual({
      atendidaAt: { not: null },
    });
  });

  it("el `count` usa el MISMO `where` que la pagina (no pueden divergir)", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    await new PostulacionRecursoRepository(prisma).listar({ atendidas: true, skip: 0, take: 5 });
    expect(postulacionRecurso.count.mock.calls[0][0].where).toEqual(
      postulacionRecurso.findMany.mock.calls[0][0].where,
    );
  });

  it("proyecta `atendidaPor.nombre` a `atendidaPorNombre`, y `null` cuando no hay", async () => {
    const { prisma } = dobleDePrisma({
      findMany: vi.fn().mockResolvedValue([
        {
          id: "pr-1",
          tipo: "vehiculo",
          nombre: "Ana",
          telefono: "88888888",
          correo: "ana@ejemplo.com",
          mensaje: "camion",
          createdAt: new Date("2026-08-19T10:00:00Z"),
          atendidaAt: new Date("2026-08-20T10:00:00Z"),
          atendidaPor: { nombre: "Marta" },
        },
        {
          id: "pr-2",
          tipo: "bodega",
          nombre: "Beto",
          telefono: "77777777",
          correo: "beto@ejemplo.com",
          mensaje: "bodega",
          createdAt: new Date("2026-08-18T10:00:00Z"),
          atendidaAt: null,
          atendidaPor: null,
        },
      ]),
      count: vi.fn().mockResolvedValue(2),
    });

    const r = await new PostulacionRecursoRepository(prisma).listar({
      atendidas: false,
      skip: 0,
      take: 10,
    });

    expect(r.total).toBe(2);
    expect(r.items[0].atendidaPorNombre).toBe("Marta");
    expect(r.items[1].atendidaPorNombre).toBeNull();
  });
});

describe("253 / R32 — `marcarAtendida` es una actualizacion CONDICIONAL", () => {
  it("el `where` lleva el id Y `atendidaAt: null`, y devuelve el `count`", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    const ahora = new Date("2026-08-20T12:00:00Z");

    const count = await new PostulacionRecursoRepository(prisma).marcarAtendida(
      "pr-1",
      "usr-9",
      ahora,
    );

    expect(count).toBe(1);
    const args = postulacionRecurso.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: "pr-1", atendidaAt: null });
    expect(args.data).toEqual({ atendidaAt: ahora, atendidaPorId: "usr-9" });
  });

  it("devuelve 0 cuando el update no aplica (la fila ya estaba atendida o no existe)", async () => {
    const { prisma } = dobleDePrisma({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) });
    expect(
      await new PostulacionRecursoRepository(prisma).marcarAtendida("pr-1", "usr-9", new Date()),
    ).toBe(0);
  });
});

describe("253 / P2 — `purgarAtendidasAnterioresA` mira `atendida_at` y NUNCA `created_at`", () => {
  const CORTE = new Date("2026-02-20T00:00:00Z");

  it("el `where` de la seleccion es EXACTAMENTE `{ atendidaAt: { lt: corte } }`", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    await new PostulacionRecursoRepository(prisma).purgarAtendidasAnterioresA(CORTE, 500);

    const args = postulacionRecurso.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ atendidaAt: { lt: CORTE } });
    // La asercion que importa: `createdAt` NO aparece en el predicado, ni suelto ni dentro de un
    // OR/AND. Se serializa el `where` entero para que no se pueda colar anidado.
    expect(JSON.stringify(args.where)).not.toContain("createdAt");
  });

  it("acota la corrida con `take` y ordena por `atendidaAt` ASC (lo mas viejo primero)", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma();
    await new PostulacionRecursoRepository(prisma).purgarAtendidasAnterioresA(CORTE, 42);
    const args = postulacionRecurso.findMany.mock.calls[0][0];
    expect(args.take).toBe(42);
    expect(args.orderBy).toEqual({ atendidaAt: "asc" });
  });

  it("sin candidatas NO se emite ningun `deleteMany` (cero riesgo de borrado vacio mal formado)", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma({ findMany: vi.fn().mockResolvedValue([]) });
    const borradas = await new PostulacionRecursoRepository(prisma).purgarAtendidasAnterioresA(
      CORTE,
      500,
    );
    expect(borradas).toBe(0);
    expect(postulacionRecurso.deleteMany).not.toHaveBeenCalled();
  });

  it("con candidatas, borra POR ID y devuelve cuantas borro", async () => {
    const { prisma, postulacionRecurso } = dobleDePrisma({
      findMany: vi.fn().mockResolvedValue([{ id: "pr-1" }, { id: "pr-2" }]),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    });

    const borradas = await new PostulacionRecursoRepository(prisma).purgarAtendidasAnterioresA(
      CORTE,
      500,
    );

    expect(borradas).toBe(2);
    expect(postulacionRecurso.deleteMany.mock.calls[0][0].where).toEqual({
      id: { in: ["pr-1", "pr-2"] },
    });
  });
});
