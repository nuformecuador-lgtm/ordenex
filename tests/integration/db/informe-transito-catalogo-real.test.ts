import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { crearOrden, crearZona, mas, sembrarBase475 } from "./_informe-transito-475";
import { INFORMES_WHATSAPP } from "@/lib/whatsapp-envios/informes/catalogo";
import { PARAMETROS_POR_DEFECTO, type ParametrosTransito } from "@/lib/whatsapp-envios/informes/transito/parametros";

// Ficha 475 (T5.3, design §9) — el informe REGISTRADO EN EL CATALOGO (no uno construido aqui) lee
// de Postgres a traves del repositorio real. Mata M13 (catalogo con un repo que no es el real).
//
// El cliente compartido (`getPrismaClient`) se redirige a la transaccion del test para que la
// siembra se vea y se revierta: lo que se prueba es la COMPOSICION del catalogo + el SQL real.
// Se mide por DIFERENCIA (antes/despues de sembrar) porque la base compartida tiene sus propias
// ordenes en alerta.
//
// Correr: `pnpm exec vitest run tests/integration/db/informe-transito-catalogo-real.test.ts` con
// DATABASE_URL (sin base, se SALTA).

const cliente = vi.hoisted(() => ({ actual: null as unknown }));

vi.mock("@/lib/db/prisma-client", async (original) => {
  const real = await original<typeof import("@/lib/db/prisma-client")>();
  return {
    ...real,
    getPrismaClient: () => {
      if (cliente.actual === null) throw new Error("475: cliente de test no fijado");
      return cliente.actual;
    },
  };
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("475/M13 — composition root del catalogo contra Postgres", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ una orden sembrada en alerta suma 1 a total_en_alerta del informe del catalogo", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      cliente.actual = tx;
      const informe = INFORMES_WHATSAPP.get("transito");
      if (informe === undefined) throw new Error("475: el catalogo no registra transito");
      const ahora = new Date("2026-10-05T11:00:00.000Z");
      const parametros: ParametrosTransito = { ...PARAMETROS_POR_DEFECTO, hito: "creacion", enviarSiVacio: true };
      const contar = async () => {
        const res = await informe.generar({ parametros, ahora, conDocumento: false });
        if (res.tipo !== "contenido") throw new Error("475: con enviarSiVacio debe haber contenido");
        return Number.parseInt(res.valores.total_en_alerta, 10);
      };
      const antes = await contar();
      const base = await sembrarBase475(tx);
      const z = await crearZona(tx, base, "catalogo");
      // Zona fuera de la GAM sin entrada: 20/5 -> entra a partir de 15 dias. 30 dias: entra.
      await crearOrden(tx, base, { clave: "cat", zonaId: z, estado: "en_reparto", createdAt: mas(ahora, -30) });
      const despues = await contar();
      return { antes, despues };
    });
    cliente.actual = null;
    expect(r.despues - r.antes).toBe(1);
  });
});
