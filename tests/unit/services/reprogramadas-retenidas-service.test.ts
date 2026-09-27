import { describe, it, expect, vi } from "vitest";

import type { OrdenLiberableRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type {
  CierreParaRetenidas,
  IReprogramadaRetenidaRepository,
  RetenidaEnRepartoRow,
} from "@/lib/interfaces/repositories/IReprogramadaRetenidaRepository";
import {
  recortarPorAmbito,
  type ResumenRetenidas,
} from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { ReprogramadasRetenidasService } from "@/lib/services/ReprogramadasRetenidasService";

// FICHA 462 (T1.4, design §2.3) — EL PUNTO UNICO DEL CONTEO, con dobles. Lo que aqui se mide es
// MEMORIA PURA: agrupacion por cierre, ambito por destino persistido / zona de la orden, el grupo
// «sin cierre», el orden de la lista, la derivacion de la jornada en lote y que `contar` y
// `contarPorCierre` derivan del MISMO `resumen` (R5, R6, R7). El `WHERE` de cada forma se prueba
// contra Postgres en `tests/integration/db/462/reprogramadas-retenidas-sql-real.test.ts`, porque los
// dobles no ven el SQL (memoria «probar el WHERE donde vive»).

const HOY = new Date("2026-09-25T00:00:00.000Z"); // convencion `@db.Date`: medianoche UTC del 25/09 CR
const CENTRAL = "zona-central";
const ZONA_SAT = "zona-satelite";
const OTRA_ZONA = "zona-otra";

/** Una fila del reloj: por defecto RETENIDA (visita real + cierre solicitado). */
function filaA(over: Partial<OrdenLiberableRow> = {}): OrdenLiberableRow {
  return {
    id: "o-a",
    zonaId: CENTRAL,
    fechaReprogramacion: HOY,
    gestionCierreId: "c-sol",
    gestionCierreEstado: "solicitado",
    gestionEsVisitaReal: true,
    mensajeroAsignadoId: "m-1",
    ...over,
  };
}

function filaB(over: Partial<RetenidaEnRepartoRow> = {}): RetenidaEnRepartoRow {
  return {
    ordenId: "o-b",
    zonaId: CENTRAL,
    mensajeroAsignadoId: "m-2",
    gestionId: "g-b",
    cierreId: "c-sol",
    ...over,
  };
}

/** 09:00 CR del 24/09 = 15:00Z. */
const G_24 = new Date("2026-09-24T15:00:00.000Z");
/** 10:00 CR del 23/09. */
const G_23 = new Date("2026-09-23T16:00:00.000Z");

function cierre(over: Partial<CierreParaRetenidas> = {}): CierreParaRetenidas {
  return {
    cierreId: "c-sol",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: CENTRAL,
    mensajeroId: "m-1",
    mensajeroNombre: "Ana",
    createdAt: new Date("2026-09-24T22:00:00.000Z"),
    gestionesCreatedAt: [G_24, G_24],
    ...over,
  };
}

function montar(opts: {
  a?: OrdenLiberableRow[];
  b?: RetenidaEnRepartoRow[];
  cierres?: CierreParaRetenidas[];
  mensajeros?: Array<{ id: string; nombre: string }>;
  central?: string | null;
}) {
  const liberacion = { findOrdenesLiberables: vi.fn(async () => opts.a ?? []) };
  const retenidas: IReprogramadaRetenidaRepository & {
    findRetenidasEnReparto: ReturnType<typeof vi.fn>;
    findCierresQueRetienen: ReturnType<typeof vi.fn>;
    findDestinoDeCierres: ReturnType<typeof vi.fn>;
    findMensajeros: ReturnType<typeof vi.fn>;
  } = {
    findRetenidasEnReparto: vi.fn(async () => opts.b ?? []),
    findCierresQueRetienen: vi.fn(async (ids: readonly string[]) =>
      (opts.cierres ?? []).filter((c) => ids.includes(c.cierreId)),
    ),
    // El camino ligero (462/H2): los MISMOS cierres, solo estado y destino.
    findDestinoDeCierres: vi.fn(async (ids: readonly string[]) =>
      (opts.cierres ?? [])
        .filter((c) => ids.includes(c.cierreId))
        .map(({ cierreId, estado, destinoTipo, destinoZonaId }) => ({ cierreId, estado, destinoTipo, destinoZonaId })),
    ),
    findMensajeros: vi.fn(async (ids: readonly string[]) =>
      (opts.mensajeros ?? []).filter((m) => ids.includes(m.id)),
    ),
  };
  const zona = { findCentralZonaId: vi.fn(async () => (opts.central === undefined ? CENTRAL : opts.central)) };
  const service = new ReprogramadasRetenidasService(liberacion, retenidas, zona);
  return { service, liberacion, retenidas, zona };
}

describe("462/R1-R3 — la Forma A es `!puedeLiberarse` sobre las candidatas del reloj", () => {
  it("cuenta la que tiene visita real y cierre sin aprobar; NO la del cierre aprobado ni la de escritorio", async () => {
    const { service } = montar({
      a: [
        filaA({ id: "o-1" }),
        filaA({ id: "o-2", gestionCierreId: "c-apr", gestionCierreEstado: "aprobado" }), // R40: liberable, no retenida
        filaA({ id: "o-3", gestionEsVisitaReal: false }), // reprogramacion de escritorio (100): nunca espera
      ],
      cierres: [cierre()],
    });

    const r = await service.resumen(HOY);

    expect(r.total).toBe(1);
    expect(r.porForma).toEqual({ reprogramado: 1, enReparto: 0 });
    expect(r.cierres).toHaveLength(1);
    expect(r.cierres[0]).toMatchObject({ cierreId: "c-sol", cuantas: 1, estado: "solicitado" });
  });

  it("cierre `vencido` y `rechazado` retienen igual que `solicitado` (R41/R42)", async () => {
    const { service } = montar({
      a: [
        filaA({ id: "o-1", gestionCierreId: "c-ven", gestionCierreEstado: "vencido" }),
        filaA({ id: "o-2", gestionCierreId: "c-rec", gestionCierreEstado: "rechazado" }),
      ],
      cierres: [
        cierre({ cierreId: "c-ven", estado: "vencido" }),
        cierre({ cierreId: "c-rec", estado: "rechazado" }),
      ],
    });

    const r = await service.resumen(HOY);

    expect(r.total).toBe(2);
    expect(r.cierres.map((c) => [c.cierreId, c.estado])).toEqual(
      expect.arrayContaining([
        ["c-ven", "vencido"],
        ["c-rec", "rechazado"],
      ]),
    );
  });
});

describe("462/R5 — atribucion: al cierre de la gestion vigente, o al grupo «sin cierre» de su mensajero", () => {
  it("dos formas sobre el mismo cierre se suman en UNA entrada; las sin cierre se agrupan por mensajero", async () => {
    const { service, retenidas, zona } = montar({
      a: [filaA({ id: "o-1" }), filaA({ id: "o-2", gestionCierreId: null, gestionCierreEstado: null, mensajeroAsignadoId: "m-9" })],
      b: [filaB({ ordenId: "o-3" }), filaB({ ordenId: "o-4", cierreId: null, mensajeroAsignadoId: "m-9" })],
      cierres: [cierre()],
      mensajeros: [{ id: "m-9", nombre: "Beto" }],
    });

    const r = await service.resumen(HOY);

    expect(r.total).toBe(4);
    expect(r.porForma).toEqual({ reprogramado: 2, enReparto: 2 });
    expect(r.cierres).toEqual([
      expect.objectContaining({ cierreId: "c-sol", cuantas: 2, mensajeroNombre: "Ana" }),
    ]);
    expect(r.sinCierre).toEqual([
      { mensajeroId: "m-9", mensajeroNombre: "Beto", ambito: { tipo: "central" }, cuantas: 2 },
    ]);
    // EN LOTE: una consulta de cierres con los ids DISTINTOS, una de mensajeros, una de zona central.
    expect(retenidas.findCierresQueRetienen).toHaveBeenCalledTimes(1);
    expect(retenidas.findCierresQueRetienen).toHaveBeenCalledWith(["c-sol"]);
    expect(retenidas.findMensajeros).toHaveBeenCalledTimes(1);
    expect(retenidas.findMensajeros).toHaveBeenCalledWith(["m-9"]);
    expect(zona.findCentralZonaId).toHaveBeenCalledTimes(1);
  });

  it("sin retenidas «sin cierre» NO se consulta ni la zona central ni los mensajeros (cero consultas de mas)", async () => {
    const { service, retenidas, zona } = montar({ a: [filaA()], cierres: [cierre()] });

    await service.resumen(HOY);

    expect(zona.findCentralZonaId).not.toHaveBeenCalled();
    expect(retenidas.findMensajeros).not.toHaveBeenCalled();
  });

  it("un cierre que se APROBO entre las dos lecturas (carrera) deja de retener en el acto (R28/R40), en `resumen` Y en `contar`", async () => {
    const { service } = montar({
      a: [filaA({ id: "o-1" })],
      cierres: [cierre({ estado: "aprobado" })],
    });

    const r = await service.resumen(HOY);

    expect(r.total).toBe(0);
    expect(r.cierres).toEqual([]);
    expect(r.porForma).toEqual({ reprogramado: 0, enReparto: 0 });
    // 462/H2: el camino ligero aplica LA MISMA puerta (mutacion: contar el aprobado en `contar` => ROJO).
    expect(await service.contar(HOY, { tipo: "central" })).toBe(0);
  });

  it("una gestion que apunta a un cierre inexistente (dato imposible) FALLA con causa, sin contar a ojo (los dos caminos)", async () => {
    const { service } = montar({ a: [filaA({ gestionCierreId: "c-fantasma" })], cierres: [] });

    await expect(service.resumen(HOY)).rejects.toThrow(/cierre que la base no devuelve/);
    await expect(service.contar(HOY, { tipo: "central" })).rejects.toThrow(/cierre que la base no devuelve/);
  });
});

describe("462/R6/R44 — el ambito: por el destino PERSISTIDO del cierre; sin cierre, por la zona de la orden", () => {
  function montarDosAmbitos() {
    return montar({
      a: [
        filaA({ id: "o-c1" }),
        filaA({ id: "o-s1", gestionCierreId: "c-sat", gestionCierreEstado: "vencido", zonaId: ZONA_SAT }),
        // Sin cierre, orden de la zona satelite -> ambito ZONA aunque el mensajero sea de central.
        filaA({ id: "o-s2", gestionCierreId: null, gestionCierreEstado: null, zonaId: ZONA_SAT, mensajeroAsignadoId: "m-9" }),
        // Sin cierre, orden de la zona central -> ambito CENTRAL.
        filaA({ id: "o-c2", gestionCierreId: null, gestionCierreEstado: null, zonaId: CENTRAL, mensajeroAsignadoId: "m-9" }),
      ],
      b: [filaB({ ordenId: "o-c3" })],
      cierres: [
        cierre(),
        cierre({ cierreId: "c-sat", estado: "vencido", destinoTipo: "bodega_satelite", destinoZonaId: ZONA_SAT, mensajeroNombre: "Sat" }),
      ],
      mensajeros: [{ id: "m-9", nombre: "Beto" }],
    });
  }

  it("`contar` para el ambito CENTRAL no incluye lo del satelite, y al reves (mutacion 6: incluirlo => ROJO)", async () => {
    const { service } = montarDosAmbitos();

    expect(await service.contar(HOY, { tipo: "central" })).toBe(3); // o-c1, o-c3 (cierre central) + o-c2 (sin cierre, zona central)
    expect(await service.contar(HOY, { tipo: "zona", zonaId: ZONA_SAT })).toBe(2); // o-s1 (cierre satelite) + o-s2 (sin cierre, zona sat)
    expect(await service.contar(HOY, { tipo: "zona", zonaId: OTRA_ZONA })).toBe(0);
    // Y el total del sistema es la suma de los ambitos, ni mas ni menos.
    expect((await service.resumen(HOY)).total).toBe(5);
  });

  it("⭑ R7 (462/H2): `contar(a)` ES `recortarPorAmbito(resumen, a).total` para los tres ambitos", async () => {
    const { service } = montarDosAmbitos();
    const resumen = await service.resumen(HOY);

    for (const ambito of [{ tipo: "central" }, { tipo: "zona", zonaId: ZONA_SAT }, { tipo: "zona", zonaId: OTRA_ZONA }] as const) {
      expect(await service.contar(HOY, ambito), JSON.stringify(ambito)).toBe(recortarPorAmbito(resumen, ambito).total);
    }
  });

  it("462/H2: `contar` va por el camino LIGERO — destinos de cierre sin relaciones, sin nombres de mensajero; la zona central solo si hay «sin cierre»", async () => {
    const conSinCierre = montarDosAmbitos();
    await conSinCierre.service.contar(HOY, { tipo: "central" });

    expect(conSinCierre.retenidas.findDestinoDeCierres).toHaveBeenCalledTimes(1);
    expect(conSinCierre.retenidas.findDestinoDeCierres).toHaveBeenCalledWith(["c-sol", "c-sat"]);
    expect(conSinCierre.retenidas.findCierresQueRetienen).not.toHaveBeenCalled();
    expect(conSinCierre.retenidas.findMensajeros).not.toHaveBeenCalled();
    expect(conSinCierre.zona.findCentralZonaId).toHaveBeenCalledTimes(1);

    // Sin retenidas «sin cierre», tampoco la zona central: A (1 llamada al repo) + B (1) + destinos (1).
    const soloCierres = montar({ a: [filaA()], b: [filaB()], cierres: [cierre()] });
    await soloCierres.service.contar(HOY, { tipo: "central" });

    expect(soloCierres.zona.findCentralZonaId).not.toHaveBeenCalled();
    expect(soloCierres.retenidas.findMensajeros).not.toHaveBeenCalled();
    expect(soloCierres.retenidas.findCierresQueRetienen).not.toHaveBeenCalled();
    expect(soloCierres.liberacion.findOrdenesLiberables).toHaveBeenCalledTimes(1);
    expect(soloCierres.retenidas.findRetenidasEnReparto).toHaveBeenCalledTimes(1);
    expect(soloCierres.retenidas.findDestinoDeCierres).toHaveBeenCalledTimes(1);
  });

  it("`recortarPorAmbito` es puro y su `total` es la suma de lo que queda, nunca el global", () => {
    const resumen: ResumenRetenidas = {
      diaCR: "2026-09-25",
      total: 7,
      porForma: { reprogramado: 4, enReparto: 3 },
      cierres: [
        { cierreId: "a", mensajeroId: "m", mensajeroNombre: "A", estado: "solicitado", jornadaCR: null, ambito: { tipo: "central" }, cuantas: 3 },
        { cierreId: "b", mensajeroId: "m", mensajeroNombre: "B", estado: "vencido", jornadaCR: null, ambito: { tipo: "zona", zonaId: ZONA_SAT }, cuantas: 2 },
      ],
      sinCierre: [
        { mensajeroId: "m", mensajeroNombre: "M", ambito: { tipo: "central" }, cuantas: 1 },
        { mensajeroId: "n", mensajeroNombre: "N", ambito: { tipo: "zona", zonaId: ZONA_SAT }, cuantas: 1 },
      ],
    };

    const central = recortarPorAmbito(resumen, { tipo: "central" });
    const sat = recortarPorAmbito(resumen, { tipo: "zona", zonaId: ZONA_SAT });
    const otra = recortarPorAmbito(resumen, { tipo: "zona", zonaId: OTRA_ZONA });

    expect(central.total).toBe(4);
    expect(central.cierres.map((c) => c.cierreId)).toEqual(["a"]);
    expect(central.sinCierre.map((m) => m.mensajeroId)).toEqual(["m"]);
    expect(sat.total).toBe(3);
    expect(sat.cierres.map((c) => c.cierreId)).toEqual(["b"]);
    expect(otra.total).toBe(0);
    expect(otra.cierres).toEqual([]);
    // Y no toco el original.
    expect(resumen.total).toBe(7);
    expect(resumen.cierres).toHaveLength(2);
    // 462/H4 — `porForma` es GLOBAL por contrato tambien en el recorte: es el insumo de R3 (contra el
    // `esperandoCierre` del reloj, que no tiene ambito) y ninguna superficie lo muestra.
    expect(central.porForma).toEqual({ reprogramado: 4, enReparto: 3 });
    expect(sat.porForma).toEqual(resumen.porForma);
    expect(otra.porForma).toEqual(resumen.porForma);
  });

  it("con la zona central desconocida (`null`), las sin cierre caen a su propia zona (fallback seguro de `resolverDestinoCierre`)", async () => {
    const { service } = montar({
      a: [filaA({ gestionCierreId: null, gestionCierreEstado: null, zonaId: CENTRAL })],
      central: null,
      mensajeros: [{ id: "m-1", nombre: "Ana" }],
    });

    const r = await service.resumen(HOY);

    expect(r.sinCierre).toEqual([
      { mensajeroId: "m-1", mensajeroNombre: "Ana", ambito: { tipo: "zona", zonaId: CENTRAL }, cuantas: 1 },
    ]);
  });
});

describe("462/R7 — `contarPorCierre` y `contar` derivan del MISMO resumen", () => {
  it("devuelve SOLO los ids pedidos que retienen; los que no retienen no aparecen; una lectura por llamada", async () => {
    const { service, liberacion, retenidas } = montar({
      a: [filaA({ id: "o-1" }), filaA({ id: "o-2" })],
      b: [filaB({ ordenId: "o-3", cierreId: "c-ven" })],
      cierres: [cierre(), cierre({ cierreId: "c-ven", estado: "vencido" })],
    });

    const marca = await service.contarPorCierre(HOY, ["c-sol", "c-ven", "c-apr", "c-ajeno"]);

    expect([...marca.entries()].sort()).toEqual([
      ["c-sol", 2],
      ["c-ven", 1],
    ]);
    expect(marca.has("c-apr")).toBe(false);
    expect(marca.has("c-ajeno")).toBe(false);
    // UNA lectura de cada fuente para toda la pagina, sea de 1 o de 100 ids (R26/R51).
    expect(liberacion.findOrdenesLiberables).toHaveBeenCalledTimes(1);
    expect(retenidas.findRetenidasEnReparto).toHaveBeenCalledTimes(1);
    expect(retenidas.findCierresQueRetienen).toHaveBeenCalledTimes(1);
  });

  it("con una lista vacia de ids no consulta nada y devuelve un mapa vacio", async () => {
    const { service, liberacion, retenidas } = montar({ a: [filaA()], cierres: [cierre()] });

    const marca = await service.contarPorCierre(HOY, []);

    expect(marca.size).toBe(0);
    expect(liberacion.findOrdenesLiberables).not.toHaveBeenCalled();
    expect(retenidas.findRetenidasEnReparto).not.toHaveBeenCalled();
  });

  it("la cifra de `contar` coincide con la suma de `contarPorCierre` + «sin cierre» del mismo ambito", async () => {
    const { service } = montar({
      a: [filaA({ id: "o-1" }), filaA({ id: "o-2", gestionCierreId: null, gestionCierreEstado: null })],
      b: [filaB({ ordenId: "o-3" })],
      cierres: [cierre()],
      mensajeros: [{ id: "m-1", nombre: "Ana" }],
    });

    const r = await service.resumen(HOY);
    const marca = await service.contarPorCierre(HOY, ["c-sol"]);
    const cifra = await service.contar(HOY, { tipo: "central" });

    expect(cifra).toBe(3);
    expect(marca.get("c-sol")).toBe(2);
    expect(r.sinCierre.reduce((acc, m) => acc + m.cuantas, 0)).toBe(1);
    expect(cifra).toBe((marca.get("c-sol") ?? 0) + r.sinCierre.reduce((acc, m) => acc + m.cuantas, 0));
    expect(r.porForma.reprogramado + r.porForma.enReparto).toBe(r.total);
  });
});

describe("462 — orden de la lista y jornada derivada (271/R61)", () => {
  it("mas retenidas primero; a igual cifra, jornada ascendente con las sin jornada al final; luego mensajero", async () => {
    const { service } = montar({
      a: [
        filaA({ id: "o-1", gestionCierreId: "c-uno" }),
        filaA({ id: "o-2", gestionCierreId: "c-dos" }),
        filaA({ id: "o-3", gestionCierreId: "c-dos" }),
        filaA({ id: "o-4", gestionCierreId: "c-tres" }),
        filaA({ id: "o-5", gestionCierreId: "c-cuatro" }),
      ],
      cierres: [
        // Un dia CR: 24/09.
        cierre({ cierreId: "c-uno", mensajeroNombre: "Zoe", gestionesCreatedAt: [G_24] }),
        cierre({ cierreId: "c-dos", mensajeroNombre: "Ana", gestionesCreatedAt: [G_24] }),
        // Gestiones en DOS dias CR -> sin jornada fiable (`null`, R60): va al final de su cifra.
        cierre({ cierreId: "c-tres", mensajeroNombre: "Ana", gestionesCreatedAt: [G_23, G_24] }),
        // Jornada anterior (23/09): va antes que la del 24.
        cierre({ cierreId: "c-cuatro", mensajeroNombre: "Ana", gestionesCreatedAt: [G_23] }),
      ],
    });

    const r = await service.resumen(HOY);

    expect(r.cierres.map((c) => [c.cierreId, c.cuantas, c.jornadaCR])).toEqual([
      ["c-dos", 2, "2026-09-24"],
      ["c-cuatro", 1, "2026-09-23"],
      ["c-uno", 1, "2026-09-24"],
      ["c-tres", 1, null],
    ]);
  });

  it("un cierre SIN gestiones (creado por el corte) fecha su jornada como `created_at` CR menos un dia (fuente B)", async () => {
    const { service } = montar({
      a: [filaA()],
      // 00:30 CR del 25/09 (= 06:30Z): el corte que cierra la jornada del 24.
      cierres: [cierre({ gestionesCreatedAt: [], createdAt: new Date("2026-09-25T06:30:00.000Z") })],
    });

    const r = await service.resumen(HOY);

    expect(r.cierres[0]?.jornadaCR).toBe("2026-09-24");
  });

  it("`diaCR` del resumen es la fecha calendario CR del `hoyCR` recibido", async () => {
    const { service } = montar({});
    expect((await service.resumen(HOY)).diaCR).toBe("2026-09-25");
  });
});
