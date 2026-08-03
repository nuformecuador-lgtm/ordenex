import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AnaliticaOperativaRollupRepository } from "@/lib/repositories/AnaliticaOperativaRollupRepository";
import { MENSAJERO, SATELITE, TIENDA, consultaDe, prismaEspia } from "./_fake-operativa";

// Feature 126 / T10 — R22 y R23. FRONTERA MULTI-TENANT, no presentacion.
//
// Sin policies RLS debajo (Prisma se conecta con credenciales de servicio), el `where` de esta
// consulta es la UNICA separacion entre inquilinos en analitica. Un fallo aqui no da una cifra
// equivocada: filtra las ordenes de una tienda a otra.
//
// POR ESO SE ASIERTA EL `where` QUE LLEGA A LA BASE Y NO EL RESULTADO. Un test que mirase las
// filas devueltas aprobaria un repositorio que consulta TODO y recorta en memoria, que es
// justo lo que R18 de la 122 existe para impedir: el `where` es la frontera, y filtrar despues
// es una capa mas de la que fiarse.

/**
 * Ejecuta `agregarCubos` con un cliente espia y devuelve las condiciones del `where` que se
 * envio, aplanadas. El repositorio compone con `AND` (y no con un spread) para que el filtro
 * del cliente no pueda PISAR el recorte del alcance si algun dia nombraran la misma columna.
 */
async function whereDe(
  actor: Parameters<typeof consultaDe>[1],
  granos: Parameters<AnaliticaOperativaRollupRepository["agregarCubos"]>[1] = ["mensajero"],
  raw: unknown = { rango: "dia" },
): Promise<readonly Record<string, unknown>[]> {
  const espia = prismaEspia();
  const repo = new AnaliticaOperativaRollupRepository(
    espia.cliente as unknown as Pick<PrismaClient, "analyticsDaily" | "orderStatus">,
  );
  await repo.agregarCubos(consultaDe("entregas", actor, raw), granos);
  const args = espia.groupBy[0] as { where: { AND: Record<string, unknown>[] } };
  return args.where.AND;
}

/** `true` si ALGUNA condicion del `AND` es exactamente la esperada. */
function contiene(condiciones: readonly Record<string, unknown>[], esperada: unknown): boolean {
  return condiciones.some((c) => JSON.stringify(c) === JSON.stringify(esperada));
}

describe("R22 · un mensajero solo ve lo suyo", () => {
  it("un mensajero no ve el cubo sin asignar", async () => {
    const where = await whereDe(MENSAJERO);
    // Un id ESCALAR. La mutacion de R22 es `{ in: [id, null] }` o un `OR mensajeroId IS NULL`
    // «para que le cuadre el total»: una orden sin mensajero asignado NO es propia de nadie
    // (R28 de la 122), y anadirla es una fuga de filas ajenas.
    // El fragmento del ALCANCE es un id escalar; el del filtro, la lista de un solo id con la
    // que la 122 lo interseco. Los dos viajan y los dos acotan al mismo mensajero.
    expect(contiene(where, { mensajeroId: MENSAJERO.usuarioId })).toBe(true);
    expect(contiene(where, { mensajeroId: { in: [MENSAJERO.usuarioId] } })).toBe(true);
    const serializado = JSON.stringify(where);
    expect(serializado).not.toContain("null");
    expect(serializado).not.toContain('"OR"');
  });

  it("y el recorte usa la columna del ROLLUP, no la de orden", async () => {
    const where = await whereDe(MENSAJERO);
    const claves = where.flatMap((c) => Object.keys(c));
    expect(claves).toContain("mensajeroId");
    expect(claves).not.toContain("mensajeroAsignadoId");
  });

  it("un mensajero que PIDE otro mensajero ni llega a consultar: la 122 lo deniega antes", () => {
    // Cinturon y tirantes: `recortarFiltro` de la 122 interseca y falla CERRADO. Aqui se
    // comprueba que la 126 hereda ese cierre en vez de reabrirlo con su propio `where`.
    expect(() =>
      consultaDe("entregas", MENSAJERO, { rango: "dia", mensajero_id: ["otro-mensajero"] }),
    ).toThrow(/forbidden/);
  });
});

describe("R23 · la zona del recorte es la de la ORDEN", () => {
  it("la zona del recorte es la de la orden, no la del mensajero que la gestiono", async () => {
    const where = await whereDe(SATELITE, ["zona"]);
    // `analytics_daily.zona_id` lo puebla la 124 desde `orden.zona_id` CONGELADA. La mutacion
    // de R23 es unir con `usuario` y recortar por `usuario.zona_id`: la zona del mensajero
    // PUEDE diferir de la de la orden, y un `adminSatelite` veria ordenes de otras zonas
    // gestionadas por gente de la suya.
    expect(contiene(where, { zonaId: SATELITE.zonaId })).toBe(true);
    const serializado = JSON.stringify(where);
    expect(serializado).not.toContain("usuario");
    expect(serializado).not.toContain("mensajero:");
  });

  it("el `where` no tiene NINGUNA union con otra tabla: el recorte es por columna propia", async () => {
    const where = await whereDe(SATELITE, ["zona"]);
    for (const clave of where.flatMap((c) => Object.keys(c))) {
      expect(["zonaId", "tiendaId", "mensajeroId", "fecha"], clave).toContain(clave);
    }
  });
});

describe("R22/R23 · el recorte viaja SIEMPRE, tambien cuando el cliente no nombra la dimension", () => {
  it("un adminTienda queda acotado a su tienda aunque no la pida", async () => {
    const where = await whereDe(TIENDA, ["tienda"]);
    expect(contiene(where, { tiendaId: TIENDA.usuarioId })).toBe(true);
  });

  it("y el rango por fechas calendario acompana siempre al recorte", async () => {
    const where = await whereDe(TIENDA, ["tienda"]);
    expect(where.some((c) => "fecha" in c)).toBe(true);
  });
});
