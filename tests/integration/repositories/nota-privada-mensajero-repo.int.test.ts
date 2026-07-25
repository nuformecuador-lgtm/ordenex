import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenMensajeroMetaRepository } from "@/lib/repositories/OrdenMensajeroMetaRepository";

// Feature 116 — B1: los metodos `nota` del meta-repo (upsertNota / limpiarNota /
// findNotasByMensajero) sobre `orden_mensajero_meta`. Prisma mockeado con SEMANTICA (patron del
// resto de tests/integration/repositories: la suite NO levanta Postgres). El fake ejecuta el
// comportamiento que importa: upsert por (usuario_id, orden_id) que actualiza SOLO `nota`
// (preserva `marcar_luego`), `updateMany SET nota = NULL` idempotente y `findMany` filtrado por
// mensajero + `nota IS NOT NULL`. La preservacion de `marcar_luego` y la reversibilidad de la
// COLUMNA/RLS pertenecen a la migracion de la 115 (esta feature NO crea migracion, R15).

interface Fila {
  id: string;
  usuarioId: string;
  ordenId: string;
  marcarLuego: boolean;
  nota: string | null;
}

// Fake semantico de `prisma.ordenMensajeroMeta` para los tres accesos de la 116.
function buildPrisma(filas: Fila[] = []) {
  let seq = 0;
  const ordenMensajeroMeta = {
    upsert: vi.fn(
      async (args: {
        where: { usuarioId_ordenId: { usuarioId: string; ordenId: string } };
        create: { usuarioId: string; ordenId: string; nota?: string | null; marcarLuego?: boolean };
        update: { nota?: string | null };
      }) => {
        const { usuarioId, ordenId } = args.where.usuarioId_ordenId;
        const existente = filas.find((f) => f.usuarioId === usuarioId && f.ordenId === ordenId);
        if (existente) {
          // `update` toca SOLO las claves presentes (aqui `nota`): marcar_luego queda intacto (R3).
          Object.assign(existente, args.update);
          return existente;
        }
        const nueva: Fila = {
          id: `meta-${++seq}`,
          usuarioId: args.create.usuarioId,
          ordenId: args.create.ordenId,
          marcarLuego: args.create.marcarLuego ?? false, // default del esquema (115)
          nota: args.create.nota ?? null,
        };
        filas.push(nueva);
        return nueva;
      },
    ),
    updateMany: vi.fn(
      async (args: { where: { usuarioId: string; ordenId: string }; data: { nota: string | null } }) => {
        const objetivo = filas.filter(
          (f) => f.usuarioId === args.where.usuarioId && f.ordenId === args.where.ordenId,
        );
        for (const f of objetivo) f.nota = args.data.nota;
        return { count: objetivo.length };
      },
    ),
    findMany: vi.fn(
      async (args: {
        where: { usuarioId: string; nota: { not: null } };
        select: { ordenId: true; nota: true };
      }) => {
        return filas
          .filter((f) => f.usuarioId === args.where.usuarioId && f.nota !== null)
          .map((f) => ({ ordenId: f.ordenId, nota: f.nota }));
      },
    ),
  };
  return { prisma: { ordenMensajeroMeta } as unknown as PrismaClient, filas };
}

function build(filas: Fila[] = []) {
  const { prisma, filas: store } = buildPrisma(filas);
  return { repo: new OrdenMensajeroMetaRepository(prisma), store };
}

describe("R1 — upsertNota crea la fila si no existia", () => {
  it("sin fila previa -> crea (usuarioId, ordenId) con la nota (marcar_luego default false)", async () => {
    const { repo, store } = build();
    await repo.upsertNota("m1", "o1", "recoger en porton azul");
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ usuarioId: "m1", ordenId: "o1", nota: "recoger en porton azul", marcarLuego: false });
  });
});

describe("R2 — upsertNota edita sin duplicar la fila", () => {
  it("con nota 'a', guardar 'b' deja UNA fila con 'b'", async () => {
    const { repo, store } = build([{ id: "seed", usuarioId: "m1", ordenId: "o1", marcarLuego: false, nota: "a" }]);
    await repo.upsertNota("m1", "o1", "b");
    expect(store).toHaveLength(1);
    expect(store[0].nota).toBe("b");
  });
});

describe("R3 — upsertNota PRESERVA marcar_luego de la fila (115)", () => {
  it("con marcar_luego=true, guardar nota deja nota set y marcar_luego intacto", async () => {
    const { repo, store } = build([{ id: "seed", usuarioId: "m1", ordenId: "o1", marcarLuego: true, nota: null }]);
    await repo.upsertNota("m1", "o1", "x");
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ nota: "x", marcarLuego: true });
  });
});

describe("R4 — limpiarNota deja nota=NULL sin borrar la fila; idempotente", () => {
  it("con nota y marcar_luego=true -> nota NULL, marcar_luego intacto, fila conservada", async () => {
    const { repo, store } = build([{ id: "seed", usuarioId: "m1", ordenId: "o1", marcarLuego: true, nota: "algo" }]);
    await repo.limpiarNota("m1", "o1");
    expect(store).toHaveLength(1); // NO borra la fila
    expect(store[0]).toMatchObject({ nota: null, marcarLuego: true });
  });

  it("sin fila previa -> no-op idempotente (no crea fila)", async () => {
    const { repo, store } = build();
    await repo.limpiarNota("m1", "o1");
    expect(store).toHaveLength(0);
  });
});

describe("R9 — la escritura de un mensajero no toca la fila de otro", () => {
  it("upsertNota de m1 no altera la fila (usuario_id, orden) de m2", async () => {
    const { repo, store } = build([{ id: "seedB", usuarioId: "m2", ordenId: "o1", marcarLuego: true, nota: "de m2" }]);
    await repo.upsertNota("m1", "o1", "de m1");
    const deM2 = store.find((f) => f.usuarioId === "m2" && f.ordenId === "o1");
    const deM1 = store.find((f) => f.usuarioId === "m1" && f.ordenId === "o1");
    expect(deM2).toMatchObject({ nota: "de m2", marcarLuego: true }); // intacta
    expect(deM1).toMatchObject({ nota: "de m1" }); // fila PROPIA nueva
    expect(store).toHaveLength(2);
  });

  it("limpiarNota de m1 no toca la nota de m2 para la misma orden", async () => {
    const { repo, store } = build([
      { id: "a", usuarioId: "m1", ordenId: "o1", marcarLuego: false, nota: "de m1" },
      { id: "b", usuarioId: "m2", ordenId: "o1", marcarLuego: false, nota: "de m2" },
    ]);
    await repo.limpiarNota("m1", "o1");
    expect(store.find((f) => f.usuarioId === "m1")!.nota).toBeNull();
    expect(store.find((f) => f.usuarioId === "m2")!.nota).toBe("de m2");
  });
});

describe("R6/R8 — findNotasByMensajero: solo las notas del propio actor", () => {
  it("devuelve el mapa ordenId->nota del mensajero y NUNCA la nota de otro para la misma orden", async () => {
    const { repo } = build([
      { id: "a", usuarioId: "m1", ordenId: "o1", marcarLuego: false, nota: "nota de m1 sobre o1" },
      { id: "b", usuarioId: "m2", ordenId: "o1", marcarLuego: false, nota: "nota de m2 sobre o1" },
      { id: "c", usuarioId: "m1", ordenId: "o2", marcarLuego: false, nota: null }, // sin nota -> no aparece
    ]);
    const notasM1 = await repo.findNotasByMensajero("m1");
    expect(notasM1.get("o1")).toBe("nota de m1 sobre o1");
    expect(notasM1.has("o2")).toBe(false); // nota null no entra
    expect(notasM1.size).toBe(1);

    const notasM2 = await repo.findNotasByMensajero("m2");
    expect(notasM2.get("o1")).toBe("nota de m2 sobre o1"); // cada uno ve SOLO la suya
  });
});
