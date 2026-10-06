import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { crearOrden, crearTienda, repoDeTest, sembrarEscenario } from "./_picking-476";
import { listarTiendasPicking } from "@/lib/actions/informe-picking";
import { crearInformePicking } from "@/lib/whatsapp-envios/informes/picking/informe";

// Ficha 476 (T3.3, design §7) — R3 contra Postgres: el selector de tienda ofrece SOLO las tiendas
// `adminTienda` con fulfillment, por nombre, con sus ordenes en preparacion y atrasadas para dos N; y
// el conteo del selector coincide con lo que `generar` manda para esa tienda (una sola definicion de
// «atrasada»).
//
// Mutacion obligatoria: quitar `fulfillment: true` del `where` de `tiendasFulfillment`
// (`lib/repositories/PickingRepository.ts`) → ROJO (aparece la tienda C). Quitar `rol: { value:
// "adminTienda" }` → ROJO (aparece el usuario admin E). Quitar `estado: "activo"` → ROJO (M8a: aparecen
// las tiendas Zeta inactiva/bloqueada/pendiente del ultimo test).
//
// Correr: `pnpm exec vitest run tests/integration/db/picking-resumen-tiendas.test.ts` con DATABASE_URL.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;
const AHORA = new Date();
const MAESTRO = async () => ({ usuarioId: "maestro-test", rol: "maestro" as const });

describeSiHayBase("476/R3 — tiendas del selector contra Postgres", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ solo adminTienda con fulfillment, por nombre, con conteos para N=2 y N=5", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      const deps = { getActor: MAESTRO, repo: () => repoDeTest(tx), now: () => AHORA };
      const mias = (res: Awaited<ReturnType<typeof listarTiendasPicking>>) => {
        if (res.status !== "ok") throw new Error(`476: ${res.status}`);
        return res.tiendas.filter((t) => t.nombre.startsWith(e.base.sufijo));
      };
      return {
        e,
        n2: mias(await listarTiendasPicking({ diasAtraso: 2 }, deps)),
        n5: mias(await listarTiendasPicking({ diasAtraso: 5 }, deps)),
      };
    });
    const { A, B, D } = r.e.tiendas;
    const s = r.e.base.sufijo;
    expect(r.n2).toEqual([
      { tiendaId: A, nombre: `${s} Alfa`, ordenes: 3, atrasadas: 2 },
      { tiendaId: B, nombre: `${s} Beta`, ordenes: 1, atrasadas: 0 },
      { tiendaId: D, nombre: `${s} Delta vacia`, ordenes: 0, atrasadas: 0 },
    ]);
    expect(r.n5.map((t) => [t.tiendaId, t.ordenes, t.atrasadas])).toEqual([
      [A, 3, 1],
      [B, 1, 0],
      [D, 0, 0],
    ]);
  });

  it("⭑ el conteo del selector = las cifras que manda generar para esa tienda (mismo N)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      const repo = repoDeTest(tx);
      const lista = await listarTiendasPicking({ diasAtraso: 2 }, { getActor: MAESTRO, repo: () => repo, now: () => AHORA });
      const gen = await crearInformePicking({ repo }).generar({
        parametros: { tiendaId: e.tiendas.A, diasAtraso: 2 },
        ahora: AHORA,
        conDocumento: false,
      });
      return { e, lista, gen };
    });
    if (r.lista.status !== "ok" || r.gen.tipo !== "contenido") throw new Error("476: esperaba lista y contenido");
    const a = r.lista.tiendas.find((t) => t.tiendaId === r.e.tiendas.A);
    expect(a).toBeDefined();
    expect([String(a!.ordenes), String(a!.atrasadas)]).toEqual([r.gen.valores.ordenes, r.gen.valores.atrasadas]);
  });

  it("⭑ decision del leader: una tienda con fulfillment y ordenes pero estado ≠ activo NO sale en el selector", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      const zetas: string[] = [];
      for (const estado of ["inactivo", "bloqueado", "pendiente"] as const) {
        const F = await crearTienda(tx, e.base, `Zeta ${estado}`, { fulfillment: true, estado });
        await crearOrden(tx, e.base, { tiendaId: F, remision: `ZZ-${estado}`, estado: "en_preparacion", createdAt: e.hace(4) });
        zetas.push(F);
      }
      const res = await listarTiendasPicking({ diasAtraso: 2 }, { getActor: MAESTRO, repo: () => repoDeTest(tx), now: () => AHORA });
      if (res.status !== "ok") throw new Error(`476: ${res.status}`);
      return { e, zetas, ids: res.tiendas.filter((t) => t.nombre.startsWith(e.base.sufijo)).map((t) => t.tiendaId) };
    });
    expect(r.zetas).toHaveLength(3);
    // Exacto: las tres activas de siempre, ninguna Zeta.
    expect(r.ids).toEqual([r.e.tiendas.A, r.e.tiendas.B, r.e.tiendas.D]);
  });
});
