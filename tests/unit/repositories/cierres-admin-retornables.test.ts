import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

// Feature 238 (T1.3, R2/R3/R4/R6) — EL CONJUNTO ESPERADO, medido donde vive.
//
// EL DOBLE APLICA EL `where`, no lo inspecciona. Es la diferencia que este repo ya pago cuatro
// veces: un doble que devuelve siempre la misma lista deja el filtro sin nadie que lo mire, y una
// mutacion del `where` pasa en verde. Aqui las filas se filtran con la MISMA semantica que
// Postgres —`in`, `null`, y la relacion `cierre`—, asi que quitar una condicion del WHERE cambia
// lo que sale y el test cae.
//
// Ademas se afirma la FORMA del `where` (el alcance viaja por la relacion, no en memoria): las
// dos cosas juntas, porque la forma sola no prueba el comportamiento y el comportamiento solo no
// prueba que el alcance no acabe filtrandose despues en JavaScript.
//
// El mismo filtro se ejercita ADEMAS contra un Postgres real en
// `tests/integration/db/cierres-admin-retornables-sql-real.test.ts`.

const MAESTRO: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const SATELITE: Alcance = { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" };

interface FilaGestion {
  id: string;
  cierreId: string;
  resultado: string;
  anuladaAt: Date | null;
  cierre: { destinoTipo: string; destinoZonaId: string };
  orden: { numGuia: number | null; estatusId: string };
}

/** El cierre `c1`: central, zona `z-central`. `c2` es de OTRO cierre y `c-sat` del satelite. */
function filas(): FilaGestion[] {
  const central = { destinoTipo: "bodega_central", destinoZonaId: "z-central" };
  const satelite = { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" };
  return [
    // Los tres que VUELVEN.
    { id: "g-dev", cierreId: "c1", resultado: "devuelta", anuladaAt: null, cierre: central, orden: { numGuia: 1001, estatusId: "os-devolucion_por_confirmar" } },
    { id: "g-rec", cierreId: "c1", resultado: "rechazada", anuladaAt: null, cierre: central, orden: { numGuia: 1002, estatusId: "os-rechazada" } },
    // R4: esta orden YA se movio despues de la gestion (esta en bodega, no en `reprogramada`).
    // Sigue siendo confirmable: el conjunto sale de la GESTION, no del estatus vivo.
    { id: "g-rep", cierreId: "c1", resultado: "reprogramada", anuladaAt: null, cierre: central, orden: { numGuia: 1003, estatusId: "os-en_bodega_central" } },
    // R13: la orden de esta gestion NO tiene numero de guia. NO se omite: sale con `null` para
    // que el servicio pueda bloquear diciendolo.
    { id: "g-sin-guia", cierreId: "c1", resultado: "devuelta", anuladaAt: null, cierre: central, orden: { numGuia: null, estatusId: "os-devolucion_por_confirmar" } },
    // Los dos que NO vuelven, en el MISMO cierre.
    { id: "g-ent", cierreId: "c1", resultado: "entregada", anuladaAt: null, cierre: central, orden: { numGuia: 1004, estatusId: "os-entregada" } },
    { id: "g-inc", cierreId: "c1", resultado: "incidente", anuladaAt: null, cierre: central, orden: { numGuia: 1005, estatusId: "os-incidente" } },
    // Una gestion ANULADA del mismo cierre (defensa explicita del WHERE).
    { id: "g-anulada", cierreId: "c1", resultado: "devuelta", anuladaAt: new Date("2026-08-19T10:00:00Z"), cierre: central, orden: { numGuia: 1006, estatusId: "os-en_reparto" } },
    // La testigo del `cierreId`: mismo resultado, misma bodega, OTRO cierre.
    { id: "g-otro-cierre", cierreId: "c2", resultado: "devuelta", anuladaAt: null, cierre: central, orden: { numGuia: 2001, estatusId: "os-devolucion_por_confirmar" } },
    // La testigo del ALCANCE: un cierre de la bodega satelite.
    { id: "g-sat", cierreId: "c-sat", resultado: "devuelta", anuladaAt: null, cierre: satelite, orden: { numGuia: 3001, estatusId: "os-devolucion_por_confirmar" } },
  ];
}

interface WhereGestion {
  cierreId?: string;
  resultado?: { in?: string[] };
  anuladaAt?: Date | null;
  cierre?: { destinoTipo?: string; destinoZonaId?: string };
}

/**
 * Doble de Prisma que HONRA el `where` como lo haria Postgres: filtra las filas en vez de
 * devolverlas siempre. Es lo que hace que una mutacion del WHERE del repositorio (quitar el
 * `cierreId`, quitar el `in`, quitar el alcance) cambie el resultado y ponga rojo el caso.
 */
function buildRepo(datos: FilaGestion[] = filas()) {
  const findMany = vi.fn(async ({ where }: { where: WhereGestion; select: unknown }) =>
    datos
      .filter(
        (g) =>
          (where.cierreId === undefined || g.cierreId === where.cierreId) &&
          (where.resultado?.in === undefined || where.resultado.in.includes(g.resultado)) &&
          (where.anuladaAt === undefined || g.anuladaAt === where.anuladaAt) &&
          (where.cierre?.destinoTipo === undefined ||
            g.cierre.destinoTipo === where.cierre.destinoTipo) &&
          (where.cierre?.destinoZonaId === undefined ||
            g.cierre.destinoZonaId === where.cierre.destinoZonaId),
      )
      // La proyeccion real: Prisma devuelve SOLO lo que el `select` pide. Se emula para que el
      // test no pueda apoyarse en columnas que la consulta no trae.
      .map((g) => ({ id: g.id, resultado: g.resultado, orden: { numGuia: g.orden.numGuia } })),
  );
  const prisma = { gestionOrden: { findMany } } as unknown as PrismaClient;
  // Los siete colaboradores de escritura no intervienen en una lectura pura.
  const repo = new CierresAdminRepository(
    prisma,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { repo, findMany };
}

describe("238/R2 — el conjunto son las gestiones VIGENTES del cierre que vuelven", () => {
  it("devuelve `devuelta`, `rechazada` y `reprogramada` del cierre, con su guia y su resultado", async () => {
    const { repo } = buildRepo();

    const filas = await repo.findGestionesRetornablesDelCierre("c1", MAESTRO);

    expect(filas).toEqual([
      { gestionId: "g-dev", numGuia: 1001, resultado: "devuelta" },
      { gestionId: "g-rec", numGuia: 1002, resultado: "rechazada" },
      { gestionId: "g-rep", numGuia: 1003, resultado: "reprogramada" },
      { gestionId: "g-sin-guia", numGuia: null, resultado: "devuelta" },
    ]);
  });

  it("R3: los `incidente` y las `entregada` del MISMO cierre NO salen", async () => {
    const { repo } = buildRepo();
    const ids = (await repo.findGestionesRetornablesDelCierre("c1", MAESTRO)).map(
      (g) => g.gestionId,
    );
    // El incidente es la decision firmada: su paquete no vuelve, se indemniza. Si apareciera,
    // el cierre exigiria escanear un paquete perdido y no se podria aprobar nunca.
    expect(ids).not.toContain("g-inc");
    expect(ids).not.toContain("g-ent");
  });

  it("una gestion ANULADA del cierre no entra (defensa explicita `anuladaAt: null`)", async () => {
    const { repo } = buildRepo();
    const ids = (await repo.findGestionesRetornablesDelCierre("c1", MAESTRO)).map(
      (g) => g.gestionId,
    );
    expect(ids).not.toContain("g-anulada");
  });

  it("una gestion de OTRO cierre no entra (el `cierreId` es GUARDIA, no adorno)", async () => {
    const { repo } = buildRepo();
    const ids = (await repo.findGestionesRetornablesDelCierre("c1", MAESTRO)).map(
      (g) => g.gestionId,
    );
    // Sin esta guarda, aprobar un cierre exigiria confirmar los paquetes de otro.
    expect(ids).not.toContain("g-otro-cierre");
  });

  it("R13: una gestion cuya orden NO tiene guia viaja con `numGuia: null` y NO se omite", async () => {
    const { repo } = buildRepo();
    const filas = await repo.findGestionesRetornablesDelCierre("c1", MAESTRO);
    const sinGuia = filas.find((g) => g.gestionId === "g-sin-guia");
    expect(sinGuia).toBeDefined();
    expect(sinGuia?.numGuia).toBeNull();
  });
});

describe("238/R4 — el conjunto sale de la GESTION, no del estatus vivo de la orden", () => {
  it("una gestion cuya orden YA cambio de estatus sigue en el conjunto", async () => {
    const { repo, findMany } = buildRepo();

    const ids = (await repo.findGestionesRetornablesDelCierre("c1", MAESTRO)).map(
      (g) => g.gestionId,
    );

    // `g-rep` tiene su orden en `en_bodega_central`, no en `reprogramada`: se movio DESPUES.
    expect(ids).toContain("g-rep");
    // Y la consulta ni siquiera pregunta por el estatus de la orden: no puede depender de el.
    const arg = findMany.mock.calls[0][0] as { where: unknown; select: unknown };
    expect(JSON.stringify(arg.where)).not.toContain("estatus");
    expect(JSON.stringify(arg.select)).not.toContain("estatus");
  });
});

describe("238/R6 — el ALCANCE va en el WHERE, nunca en memoria", () => {
  it("el WHERE lleva cierre, resultados que vuelven, vigencia y alcance por la relacion", async () => {
    const { repo, findMany } = buildRepo();

    await repo.findGestionesRetornablesDelCierre("c1", SATELITE);

    const arg = findMany.mock.calls[0][0] as { where: unknown; select: unknown };
    expect(arg.where).toEqual({
      cierreId: "c1",
      resultado: { in: ["reprogramada", "devuelta", "rechazada"] },
      anuladaAt: null,
      // El alcance viaja por la RELACION al cierre. Si viviera fuera del WHERE, un satelite
      // podria leer —y por tanto revelar— las gestiones del cierre de la bodega vecina.
      cierre: { destinoTipo: "bodega_satelite", destinoZonaId: "z-sat" },
    });
    expect(arg.select).toEqual({
      id: true,
      resultado: true,
      orden: { select: { numGuia: true } },
    });
  });

  it("el alcance del maestro NO acota por zona (ve todos los `bodega_central`)", async () => {
    const { repo, findMany } = buildRepo();
    await repo.findGestionesRetornablesDelCierre("c1", MAESTRO);
    const arg = findMany.mock.calls[0][0] as { where: { cierre: Record<string, unknown> } };
    expect(arg.where.cierre).toEqual({ destinoTipo: "bodega_central" });
    expect(arg.where.cierre).not.toHaveProperty("destinoZonaId");
  });

  it("un cierre FUERA de alcance devuelve `[]`, indistinguible de uno INEXISTENTE", async () => {
    const { repo } = buildRepo();

    // `c1` existe y tiene cuatro retornables, pero es de la bodega central: para el satelite es
    // exactamente lo mismo que un cierre que no existe. Es la propiedad, no una casualidad.
    const fueraDeAlcance = await repo.findGestionesRetornablesDelCierre("c1", SATELITE);
    const inexistente = await repo.findGestionesRetornablesDelCierre("c-no-existe", SATELITE);

    expect(fueraDeAlcance).toEqual([]);
    expect(fueraDeAlcance).toEqual(inexistente);
  });

  it("el satelite SI ve el conjunto de SU propio cierre", async () => {
    // El contrapunto del caso anterior: sin el, un `where` que devolviera siempre vacio pasaria
    // las dos aserciones de arriba en verde.
    const { repo } = buildRepo();
    const filas = await repo.findGestionesRetornablesDelCierre("c-sat", SATELITE);
    expect(filas).toEqual([{ gestionId: "g-sat", numGuia: 3001, resultado: "devuelta" }]);
  });
});

describe("238 — UNA consulta, no N+1 (el techo medido son 14 gestiones por cierre)", () => {
  it("pintar el conjunto entero cuesta UNA sola consulta", async () => {
    const { repo, findMany } = buildRepo();
    const filas = await repo.findGestionesRetornablesDelCierre("c1", MAESTRO);
    expect(filas.length).toBeGreaterThan(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
