import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { crearOrden, crearZona, mas, repoDeTest, sembrarBase475 } from "./_informe-transito-475";
import { cortesPorZona } from "@/lib/whatsapp-envios/informes/transito/calculo";
import { diasNaturalesCRDesde } from "@/lib/utils/fecha-cr";

// Ficha 475 (T2.4) — R8, R9, R17: el corte es POR ZONA, la frontera es estricta y la zona sale de
// `orden.zona_id`. Mata M4 (un solo corte) y M5 (`<=`).
//
// Correr: `pnpm exec vitest run tests/integration/db/informe-transito-zonas.test.ts` con
// DATABASE_URL (sin base, se SALTA).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("475/R8-R9-R17 — cortes por zona", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ dos zonas con cortes distintos: mismos dias, una entra y la otra no", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const a = await crearZona(tx, base, "A");
      const b = await crearZona(tx, base, "B");
      const ahora = new Date("2001-06-15T15:00:00.000Z");
      // A: plazo 10 aviso 2 (umbral 8). B: plazo 20 aviso 5 (umbral 15).
      const cortes = cortesPorZona(
        [
          { id: a, nombre: "A", esCentral: false },
          { id: b, nombre: "B", esCentral: false },
        ],
        { zonas: [{ zonaId: a, plazoDias: 10, avisoDias: 2 }] },
        ahora,
      );
      const hito = mas(ahora, -9); // 9 dias: entra en A (>=8), no en B (<15)
      const enA = await crearOrden(tx, base, { clave: "a", zonaId: a, estado: "en_reparto", createdAt: hito });
      const enB = await crearOrden(tx, base, { clave: "b", zonaId: b, estado: "en_reparto", createdAt: hito });
      const filas = await repoDeTest(tx).filasEnAlerta({ hito: "creacion", estados: ["en_reparto"], cortes });
      return { ids: filas.map((f) => f.ordenId), enA: enA.id, enB: enB.id, dias: diasNaturalesCRDesde(hito, ahora) };
    });
    expect(r.dias).toBe(9);
    expect(r.ids).toEqual([r.enA]);
    expect(r.ids).not.toContain(r.enB);
  });

  it("frontera exacta: hito = corte − 1 ms entra; hito = corte no (estricto)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "F");
      const corte = new Date("2001-06-07T06:00:00.000Z"); // 00:00 CR
      const justo = await crearOrden(tx, base, { clave: "justo", zonaId: z, estado: "en_reparto", createdAt: mas(corte, 0, -1) });
      const enCorte = await crearOrden(tx, base, { clave: "corte", zonaId: z, estado: "en_reparto", createdAt: corte });
      const filas = await repoDeTest(tx).filasEnAlerta({
        hito: "creacion",
        estados: ["en_reparto"],
        cortes: [{ zonaId: z, corte }],
      });
      return { ids: filas.map((f) => f.ordenId), justo: justo.id, enCorte: enCorte.id };
    });
    expect(r.ids).toEqual([r.justo]);
  });

  it("R8: la zona sale de orden.zona_id aunque el distrito/canton sean de otra; zona sin corte no aporta filas", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const a = await crearZona(tx, base, "A");
      const otra = await crearZona(tx, base, "otra");
      // El distrito sembrado pertenece a OTRA zona en la relacion N:M: no debe importar.
      await tx.zonaDistrito.create({ data: { zonaId: otra, distritoId: base.distritoId } });
      const corte = new Date("2001-06-07T06:00:00.000Z");
      const o = await crearOrden(tx, base, { clave: "a", zonaId: a, estado: "en_reparto", createdAt: mas(corte, -1) });
      const sinCorte = await crearOrden(tx, base, { clave: "x", zonaId: otra, estado: "en_reparto", createdAt: mas(corte, -1) });
      const filas = await repoDeTest(tx).filasEnAlerta({
        hito: "creacion",
        estados: ["en_reparto"],
        cortes: [{ zonaId: a, corte }],
      });
      return { filas: filas.map((f) => [f.ordenId, f.zonaId]), o: o.id, a, sinCorte: sinCorte.id };
    });
    expect(r.filas).toEqual([[r.o, r.a]]);
  });
});
