import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida } from "./_postgres-real";
import { UN_DIA, crearOrden, crearTienda, estatusId, repoDeTest, sembrarEscenario } from "./_picking-476";
import { INFORMES_WHATSAPP } from "@/lib/whatsapp-envios/informes/catalogo";
import type { ParametrosPicking } from "@/lib/whatsapp-envios/informes/picking/parametros";

// Ficha 476 (T3.2/T4.2, design §7) — la SELECCION del picking contra Postgres: R6, R9, R14, R26, R30.
//
// Conjuntos EXACTOS de ids (no `> 0`). Las cuatro mutaciones del `WHERE` de
// `lib/repositories/PickingRepository.ts` (`seleccionEnPreparacion`) ponen ROJO un test de aqui:
//   M1 quitar `AND s."value" = 'en_preparacion'`  → «R6: exactamente las 3…» (sale la de en_bodega_central)
//   M2 quitar `AND t."fulfillment" = true`        → «R6: tienda sin fulfillment…» y «entradas…» (sale c1)
//   M3 quitar `o."deleted_at" IS NULL` (dejar `WHERE true`) → «R6: exactamente las 3…» (sale la borrada)
//   M4 quitar `AND o."tienda_id" = ${tiendaId}` (en `ordenesEnPreparacion`) → «R6: exactamente las 3…»
//   M5 (R30) registrar el informe con un lector vacio → «R30/R9…»
//   M8b quitar `!tienda.activo` del `if` de `generar` (informe.ts) → «R7 (decision del leader)…»
//
// «R7/R8 por el catalogo» corre DESPUES de «R30/R9» con otra transaccion: si `depsDeProduccion`
// memoizara el repo, quedaria atado a la tx ya revertida (P2028). Ese orden es el que lo muerde.
//
// Correr: `pnpm exec vitest run tests/integration/db/picking-ordenes-en-preparacion.test.ts` con
// DATABASE_URL (sin base, se SALTA: mira los `skipped`).

const cliente = vi.hoisted(() => ({ actual: null as unknown }));

vi.mock("@/lib/db/prisma-client", async (original) => {
  const real = await original<typeof import("@/lib/db/prisma-client")>();
  return {
    ...real,
    getPrismaClient: () => {
      if (cliente.actual === null) throw new Error("476: cliente de test no fijado");
      return cliente.actual;
    },
  };
});

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Un instante fijo «de hoy»: las siembras se escriben relativas a el. */
const AHORA = new Date();

describeSiHayBase("476 — seleccion del picking contra Postgres", () => {
  let prisma: PrismaClient;
  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("⭑ R6/R26: exactamente las 3 en preparacion, vivas, de la tienda A, en orden natural de remision", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      const filas = await repoDeTest(tx).ordenesEnPreparacion(e.tiendas.A);
      return { e, filas };
    });
    expect(r.filas.map((f) => f.ordenId)).toEqual([r.e.ordenes.a3, r.e.ordenes.a2, r.e.ordenes.a1]);
    expect(r.filas.map((f) => f.numRemision)).toEqual(["BS-3", "NA-107", "NA-1069"]);
  });

  it("⭑ R6: tienda sin fulfillment → ninguna orden, aunque tenga en preparacion", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      return repoDeTest(tx).ordenesEnPreparacion(e.tiendas.C);
    });
    expect(r).toEqual([]);
  });

  it("⭑ R6/R3: entradasEnPreparacion (todas las tiendas) solo trae tiendas con fulfillment, sin borradas ni otros estados", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      const todas = await repoDeTest(tx).entradasEnPreparacion();
      const mias = new Set(Object.values(e.tiendas));
      const porTienda: Record<string, number> = {};
      for (const x of todas.filter((t) => mias.has(t.tiendaId))) porTienda[x.tiendaId] = (porTienda[x.tiendaId] ?? 0) + 1;
      return { e, porTienda };
    });
    expect(r.porTienda).toEqual({ [r.e.tiendas.A]: 3, [r.e.tiendas.B]: 1, [r.e.tiendas.E]: 1 });
  });

  it("⭑ R14: entrada = la ULTIMA transicion hacia en_preparacion; sin historial, la creacion", async () => {
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      const e = await sembrarEscenario(tx, AHORA);
      const filas = await repoDeTest(tx).ordenesEnPreparacion(e.tiendas.A);
      return { e, filas };
    });
    const por = new Map(r.filas.map((f) => [f.ordenId, f.entrada.getTime()]));
    expect(por.get(r.e.ordenes.a2)).toBe(r.e.hace(1).getTime());
    expect(por.get(r.e.ordenes.a1)).toBe(r.e.hace(3).getTime());
    expect(por.get(r.e.ordenes.a3)).toBe(r.e.hace(6).getTime());
  });

  it("⭑ R30/R9: el informe REGISTRADO lee de Postgres, no escribe nada y repite lo que sigue en preparacion", async () => {
    const informe = INFORMES_WHATSAPP.get("picking");
    if (informe === undefined) throw new Error("476: el catalogo no registra picking");
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      cliente.actual = tx;
      const e = await sembrarEscenario(tx, AHORA);
      const ids = [e.ordenes.a1, e.ordenes.a2, e.ordenes.a3];
      const parametros: ParametrosPicking = { tiendaId: e.tiendas.A, diasAtraso: 2 };
      const foto = async () =>
        tx.orden.findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true, estatusId: true }, orderBy: { id: "asc" } });
      const historial = () => tx.ordenHistorialEstado.count({ where: { ordenId: { in: ids } } });

      const antes = { orden: await foto(), historial: await historial() };
      const primera = await informe.generar({ parametros, ahora: AHORA, conDocumento: true });
      const despues = { orden: await foto(), historial: await historial() };
      const manana = await informe.generar({ parametros, ahora: new Date(AHORA.getTime() + UN_DIA), conDocumento: false });

      // a1 avanza de estado: ya no sale.
      await tx.orden.update({ where: { id: e.ordenes.a1 }, data: { estatusId: estatusId(e.base, "en_bodega_central") } });
      const trasMover = await informe.generar({ parametros, ahora: AHORA, conDocumento: false });
      return { antes, despues, primera, manana, trasMover };
    });
    cliente.actual = null;

    if (r.primera.tipo !== "contenido") throw new Error(`476: esperaba contenido, llego ${r.primera.tipo}`);
    expect(r.primera.valores).toMatchObject({ ordenes: "3", unidades: "4", productos: "2", remision_desde: "BS-3", remision_hasta: "NA-1069" });
    // a3 lleva 6 dias y a1 3 (> 2): dos atrasadas; a2 entro hace 1 dia segun su historial.
    expect(r.primera.valores.atrasadas).toBe("2");
    expect(r.primera.documento?.nombreArchivo).toMatch(/^picking-476-[0-9a-f]{8}-alfa-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(Buffer.from(r.primera.documento!.bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    // R9: nada escrito.
    expect(r.despues).toEqual(r.antes);
    // R9: la foto siguiente vuelve a sacar lo que sigue en preparacion…
    expect(r.manana.tipo === "contenido" ? r.manana.valores.ordenes : r.manana.tipo).toBe("3");
    // …y lo que avanzo de estado ya no.
    if (r.trasMover.tipo !== "contenido") throw new Error("476: esperaba contenido tras mover a1");
    expect(r.trasMover.valores).toMatchObject({ ordenes: "2", remision_desde: "BS-3", remision_hasta: "NA-107" });
  });

  it("⭑ R7/R8 por el catalogo: sin fulfillment o no-tienda → error; tienda sin ordenes → vacio", async () => {
    const informe = INFORMES_WHATSAPP.get("picking")!;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      cliente.actual = tx;
      const e = await sembrarEscenario(tx, AHORA);
      const gen = (tiendaId: string) => informe.generar({ parametros: { tiendaId, diasAtraso: 2 }, ahora: AHORA, conDocumento: true });
      return { e, sinFulfillment: await gen(e.tiendas.C), noTienda: await gen(e.tiendas.E), vacia: await gen(e.tiendas.D), noExiste: await gen("no-existe") };
    });
    cliente.actual = null;
    expect(r.sinFulfillment).toEqual({ tipo: "error", motivo: `La tienda «${r.e.base.sufijo} Gamma sin fulfillment» ya no tiene fulfillment: revisa el envío.` });
    expect(r.noTienda.tipo).toBe("error");
    expect(r.noExiste.tipo).toBe("error");
    expect(r.vacia).toEqual({ tipo: "vacio", motivo: `La tienda ${r.e.base.sufijo} Delta vacia no tiene órdenes en preparación.` });
  });

  it("⭑ R7 (decision del leader): tienda con fulfillment y ordenes pero estado ≠ activo → error «no está activa», nunca contenido", async () => {
    const informe = INFORMES_WHATSAPP.get("picking")!;
    const r = await enTransaccionRevertida(prisma, async (tx) => {
      cliente.actual = tx;
      const e = await sembrarEscenario(tx, AHORA);
      const res: Record<string, unknown> = {};
      for (const estado of ["inactivo", "bloqueado", "pendiente"] as const) {
        const F = await crearTienda(tx, e.base, `Zeta ${estado}`, { fulfillment: true, estado });
        await crearOrden(tx, e.base, { tiendaId: F, remision: `ZZ-${estado}`, estado: "en_preparacion", createdAt: e.hace(1) });
        res[estado] = await informe.generar({ parametros: { tiendaId: F, diasAtraso: 2 }, ahora: AHORA, conDocumento: true });
      }
      return { e, res };
    });
    cliente.actual = null;
    for (const estado of ["inactivo", "bloqueado", "pendiente"]) {
      expect(r.res[estado], estado).toEqual({
        tipo: "error",
        motivo: `La tienda «${r.e.base.sufijo} Zeta ${estado}» no está activa: revisa el envío.`,
      });
    }
  });
});
