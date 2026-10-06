import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import {
  CORTE_FUTURO,
  crearOrden,
  crearZona,
  mas,
  repoDeTest,
  sembrarBase475,
  transicion,
} from "./_informe-transito-475";

// Ficha 475 (T2.6) — R16: la ultima transicion (para «parado») es la MAS RECIENTE del historial; sin
// historial, `null`. Mata M9 (`ORDER BY ... ASC`).
//
// Correr: `pnpm exec vitest run tests/integration/db/informe-transito-parados.test.ts` con
// DATABASE_URL (sin base, se SALTA).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const T0 = new Date("2001-04-01T15:00:00.000Z");

describeSiHayBase("475/R16 — ultima transicion", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ la mas reciente (con empate de created_at, una sola fila); sin historial -> null", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "parados");
      const o = await crearOrden(tx, base, { clave: "o", zonaId: z, estado: "en_bodega_central", createdAt: T0 });
      await transicion(tx, base, o.id, { at: T0, origen: null, destino: "en_preparacion" });
      await transicion(tx, base, o.id, { at: mas(T0, 2), origen: "en_preparacion", destino: "en_bodega_central", origenTipo: "generacion_guia" });
      // Empate en el instante mas reciente: desempate por id, y sigue saliendo UNA fila.
      await transicion(tx, base, o.id, {
        id: "00000000-0000-4000-8000-000000000475",
        at: mas(T0, 5),
        origen: "en_bodega_central",
        destino: "en_reparto",
        origenTipo: "recoleccion",
      });
      await transicion(tx, base, o.id, {
        id: "ffffffff-ffff-4fff-8fff-fffffffff475",
        at: mas(T0, 5),
        origen: "en_reparto",
        destino: "en_bodega_central",
        origenTipo: "liberacion_reprogramada",
      });
      const sin = await crearOrden(tx, base, { clave: "sin", zonaId: z, estado: "en_bodega_central", createdAt: T0 });
      const filas = await repoDeTest(tx).filasEnAlerta({
        hito: "creacion",
        estados: ["en_bodega_central"],
        cortes: [{ zonaId: z, corte: CORTE_FUTURO }],
      });
      return {
        ultima: filas.filter((f) => f.ordenId === o.id).map((f) => f.ultimaTransicionAt?.toISOString() ?? null),
        sin: filas.filter((f) => f.ordenId === sin.id).map((f) => f.ultimaTransicionAt),
        total: filas.length,
      };
    });
    expect(r.ultima).toEqual([mas(T0, 5).toISOString()]);
    expect(r.sin).toEqual([null]);
    expect(r.total).toBe(2);
  });
});
