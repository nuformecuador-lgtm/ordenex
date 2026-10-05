import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { crearPlantilla } from "./_whatsapp-envios-474";

// Ficha 474 (R3/R6) — la mitad ESTRUCTURAL de R6, en la base: documento solo en plantillas de
// informe; y una de tienda no puede ser de informe. Las filas existentes son «de orden».

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("474/R6 — CHECKs de plantilla_mensaje", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("de orden (informe NULL) con documento -> rechazo", async () => {
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        await crearPlantilla(tx, { informeClave: null, llevaDocumento: true });
      }),
    ).rejects.toThrow(/plantilla_mensaje_documento_requiere_informe_check/);
  });

  it("de informe con documento -> aceptada", async () => {
    const n = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await crearPlantilla(tx, { informeClave: "prueba_envio", llevaDocumento: true });
      const f = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "plantilla_mensaje" WHERE "id" = $1`, p.id);
      return Number(f[0].n);
    });
    expect(n).toBe(1);
  });

  it("de tienda y de informe a la vez -> rechazo", async () => {
    await expect(
      enTransaccionRevertida(prisma, async (tx) => {
        await serializarEscriturasReales(tx);
        const p = await crearPlantilla(tx, { informeClave: "prueba_envio" });
        await tx.$executeRawUnsafe(`UPDATE "plantilla_mensaje" SET "plantilla_tienda" = true WHERE "id" = $1`, p.id);
      }),
    ).rejects.toThrow(/plantilla_mensaje_tienda_sin_informe_check/);
  });

  it("R3: las plantillas que ya existian quedan como de orden y sin documento", async () => {
    const deOrden = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "plantilla_mensaje" WHERE "informe_clave" IS NULL AND NOT "lleva_documento"`,
    );
    const total = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "plantilla_mensaje"`);
    // Las columnas nacieron con default: TODA fila preexistente contesta «de orden, sin documento».
    // (Las plantillas de informe de los tests viven en transacciones revertidas, invisibles aqui.)
    expect(Number(deOrden[0].n)).toBe(Number(total[0].n));
  });
});
