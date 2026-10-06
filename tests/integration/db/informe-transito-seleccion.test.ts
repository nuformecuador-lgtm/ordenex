import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { crearOrden, crearZona, mas, repoDeTest, sembrarBase475 } from "./_informe-transito-475";

// Ficha 475 (T2.3) — R9, R10, R30, R40: el WHERE de la seleccion contra Postgres (memoria «probar
// el WHERE donde vive»). Hito `creacion` para no depender del historial. Mata M1, M2, M3.
//
// Correr: `pnpm exec vitest run tests/integration/db/informe-transito-seleccion.test.ts` con
// DATABASE_URL apuntando a una base con las migraciones aplicadas (sin base, se SALTA).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const T = new Date("2001-03-10T06:00:00.000Z");

describeSiHayBase("475/R9-R10 — seleccion de ordenes en alerta", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ incluida dentro; borrada, estado no incluido, cierre logistico y bajo el umbral fuera", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const zona = await crearZona(tx, base, "sel");
      const antes = mas(T, -3);
      const dentro = await crearOrden(tx, base, { clave: "dentro", zonaId: zona, estado: "en_reparto", createdAt: antes });
      const borrada = await crearOrden(tx, base, {
        clave: "borrada",
        zonaId: zona,
        estado: "en_reparto",
        createdAt: antes,
        deletedAt: mas(T, -1),
      });
      const noIncluida = await crearOrden(tx, base, { clave: "noinc", zonaId: zona, estado: "en_preparacion", createdAt: antes });
      const cierreEntrega = await crearOrden(tx, base, { clave: "cierreEntrega", zonaId: zona, estado: "entregado", createdAt: antes });
      const cierreTienda = await crearOrden(tx, base, { clave: "cierreTienda", zonaId: zona, estado: "devuelta_a_tienda", createdAt: antes });
      const bajo = await crearOrden(tx, base, { clave: "bajo", zonaId: zona, estado: "en_reparto", createdAt: mas(T, 1) });

      // La consulta PIDE los dos de cierre logistico (R10: se excluyen igual).
      const filas = await repoDeTest(tx).filasEnAlerta({
        hito: "creacion",
        estados: ["en_reparto", "entregado", "devuelta_a_tienda"],
        cortes: [{ zonaId: zona, corte: T }],
      });
      const ids = filas.map((f) => f.ordenId);
      return {
        ids,
        dentro: dentro.id,
        fuera: { borrada: borrada.id, noIncluida: noIncluida.id, cierreEntrega: cierreEntrega.id, cierreTienda: cierreTienda.id, bajo: bajo.id },
        fila: filas.find((f) => f.ordenId === dentro.id),
        numGuia: dentro.numGuia,
        base,
        zona,
        antes,
      };
    });

    expect(r.ids).toEqual([r.dentro]); // solo vuelven las ordenes en alerta
    for (const [, id] of Object.entries(r.fuera)) expect(r.ids).not.toContain(id);

    // R26/R30: lo que vuelve es exactamente lo necesario, sin telefono, direccion, tienda ni producto.
    expect(r.fila).toEqual({
      ordenId: r.dentro,
      numRemision: `${r.base.sufijo}-dentro`,
      numGuia: r.numGuia,
      estado: "en_reparto",
      zonaId: r.zona,
      destinatario: "Cliente dentro",
      canton: r.base.cantonNombre,
      distrito: r.base.distritoNombre,
      montoCobrar: "18500.00",
      hitoAt: r.antes,
      ultimaTransicionAt: null,
    });
  });

  it("cada exclusion por separado (cada una sola en su zona, para que la mutacion se vea)", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const base = await sembrarBase475(tx);
      const antes = mas(T, -3);
      const casos = {
        borrada: { estado: "en_reparto", deletedAt: mas(T, -1) },
        noIncluida: { estado: "novedad" },
        cierreEntrega: { estado: "entregado" },
        cierreTienda: { estado: "devuelta_a_tienda" },
      } as const;
      const out: Record<string, number> = {};
      for (const [clave, c] of Object.entries(casos)) {
        const zona = await crearZona(tx, base, clave);
        await crearOrden(tx, base, { clave, zonaId: zona, createdAt: antes, ...c });
        const filas = await repoDeTest(tx).filasEnAlerta({
          hito: "creacion",
          estados: ["en_reparto", "entregado", "devuelta_a_tienda"],
          cortes: [{ zonaId: zona, corte: T }],
        });
        out[clave] = filas.length;
      }
      return out;
    });
    expect(r).toEqual({ borrada: 0, noIncluida: 0, cierreEntrega: 0, cierreTienda: 0 });
  });
});
