import { describe, it, expect, vi } from "vitest";
import { RankingService } from "@/lib/services/RankingService";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { IPremioRankingRepository } from "@/lib/interfaces/repositories/IPremioRankingRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ConteoPorMensajero, PremioRankingDTO } from "@/lib/types/ranking";
import { resolverRango } from "@/lib/analytics/ranges";

// Feature 76 (design §5) — logica del ranking DIARIO con repos fake (sin DB). `now` inyectable.
// Cubre R2 (pct), R3 (asignadas=0 -> indefinido, fuera de podio), R4/R5 (orden/desempate),
// R6 (conteo crudo), R7 (umbral), R9 (null != 0), R12 (STRING), R16/R17/R18/R19 (autz) y LC1.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" }; // feature 94: paridad con maestro
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };
const NOW = new Date("2026-07-16T12:00:00.000Z"); // dentro de HOY(CR)

function buildDeps(opts: {
  mensajeros?: { id: string; nombre: string }[];
  entregadas?: ConteoPorMensajero[];
  asignadas?: ConteoPorMensajero[];
  premios?: PremioRankingDTO[];
  minPodio?: number;
}) {
  const listMensajeros = vi.fn(async () => opts.mensajeros ?? []);
  const contarEntregadasPorMensajero = vi.fn(async () => opts.entregadas ?? []);
  const contarAsignadasPorMensajero = vi.fn(async () => opts.asignadas ?? []);
  const listar = vi.fn(async () => opts.premios ?? sinPremios());
  const upsertPremio = vi.fn(async () => ({ posicion: 1, monto: null, descripcion: null }) as PremioRankingDTO);

  const rankingRepo = { contarEntregadasPorMensajero, contarAsignadasPorMensajero } as IRankingRepository;
  const userRepo = { listMensajeros } as unknown as IUserRepository;
  const premioRepo = { listar, upsertPremio } as IPremioRankingRepository;
  const service = new RankingService(rankingRepo, userRepo, premioRepo, {
    MIN_ASIGNADAS_PODIO: opts.minPodio ?? 1,
  });
  return { service, listMensajeros, upsertPremio, contarAsignadasPorMensajero, contarEntregadasPorMensajero };
}

function sinPremios(): PremioRankingDTO[] {
  return [
    { posicion: 1, monto: null, descripcion: null },
    { posicion: 2, monto: null, descripcion: null },
    { posicion: 3, monto: null, descripcion: null },
  ];
}

describe("RankingService.obtenerRanking — calculo y orden (R2/R3/R4/R6/R12)", () => {
  it("pct = entregadas/asignadas *100 a 1 decimal STRING; ordena desc; 0/0 -> null y al final", async () => {
    const { service } = buildDeps({
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
        { id: "m3", nombre: "Carlos" },
        { id: "m4", nombre: "Dora" },
      ],
      asignadas: [
        { mensajeroId: "m1", total: 10 },
        { mensajeroId: "m2", total: 10 },
        { mensajeroId: "m3", total: 4 },
        // m4 sin asignadas (0)
      ],
      entregadas: [
        { mensajeroId: "m1", total: 9 }, // 90.0
        { mensajeroId: "m2", total: 10 }, // 100.0
        { mensajeroId: "m3", total: 3 }, // 75.0
      ],
    });

    const res = await service.obtenerRanking(MAESTRO, NOW);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const r = res.data.ranking;

    // R4: orden desc por pct; R3: Dora (0/0) al final con pct null.
    expect(r.map((x) => x.mensajeroId)).toEqual(["m2", "m1", "m3", "m4"]);
    // R2/R12: pct STRING a 1 decimal.
    expect(r.map((x) => x.pct)).toEqual(["100.0", "90.0", "75.0", null]);
    // R6: conteo crudo auditable.
    expect(r[1]).toMatchObject({ entregadasHoy: 9, asignadasHoy: 10 });
    // R3: Dora 0/0 -> pct null, sin posicion de podio.
    expect(r[3]).toMatchObject({ mensajeroId: "m4", pct: null, posicion: null, asignadasHoy: 0 });
  });
});

describe("RankingService.obtenerRanking — desempate determinista (R5)", () => {
  it("mismo pct -> desempata por # entregas desc", async () => {
    const { service } = buildDeps({
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Zoe" },
      ],
      asignadas: [
        { mensajeroId: "m1", total: 2 }, // 1/2 = 50.0, entregas 1
        { mensajeroId: "m2", total: 4 }, // 2/4 = 50.0, entregas 2
      ],
      entregadas: [
        { mensajeroId: "m1", total: 1 },
        { mensajeroId: "m2", total: 2 },
      ],
    });
    const res = await service.obtenerRanking(MAESTRO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    // Ambos 50.0; Zoe tiene mas entregas (2 > 1) -> va primero pese al nombre.
    expect(res.data.ranking.map((x) => x.mensajeroId)).toEqual(["m2", "m1"]);
  });

  it("mismo pct y mismas entregas -> desempata por nombre asc (estable)", async () => {
    const { service } = buildDeps({
      mensajeros: [
        { id: "mb", nombre: "Beto" },
        { id: "ma", nombre: "Ana" },
      ],
      asignadas: [
        { mensajeroId: "mb", total: 2 },
        { mensajeroId: "ma", total: 2 },
      ],
      entregadas: [
        { mensajeroId: "mb", total: 1 },
        { mensajeroId: "ma", total: 1 },
      ],
    });
    const res = await service.obtenerRanking(MAESTRO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    // Empate total -> Ana (nombre asc) antes que Beto; posiciones 1 y 2.
    expect(res.data.ranking.map((x) => x.mensajeroId)).toEqual(["ma", "mb"]);
    expect(res.data.ranking.map((x) => x.posicion)).toEqual([1, 2]);
  });
});

describe("RankingService.obtenerRanking — umbral de podio (R7)", () => {
  it("asignadas < umbral -> listado pero fuera del podio (posicion null)", async () => {
    const { service } = buildDeps({
      minPodio: 3,
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
      ],
      asignadas: [
        { mensajeroId: "m1", total: 5 }, // >= 3 -> elegible
        { mensajeroId: "m2", total: 2 }, // < 3 -> NO podio
      ],
      entregadas: [
        { mensajeroId: "m1", total: 5 }, // 100.0
        { mensajeroId: "m2", total: 2 }, // 100.0 pero no elegible
      ],
    });
    const res = await service.obtenerRanking(MAESTRO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    const beto = res.data.ranking.find((x) => x.mensajeroId === "m2")!;
    const ana = res.data.ranking.find((x) => x.mensajeroId === "m1")!;
    expect(ana.posicion).toBe(1); // elegible ocupa podio
    expect(beto.posicion).toBeNull(); // < umbral: listado sin podio
    expect(beto.pct).toBe("100.0"); // pero SI muestra su pct/conteo
  });
});

describe("RankingService.obtenerRanking — asociacion premio<->podio (R9/R14/R15)", () => {
  it("asocia el monto/descripcion al ocupante; null = sin premio; no inventa ocupantes", async () => {
    const { service } = buildDeps({
      mensajeros: [
        { id: "m1", nombre: "Ana" },
        { id: "m2", nombre: "Beto" },
      ],
      asignadas: [
        { mensajeroId: "m1", total: 10 },
        { mensajeroId: "m2", total: 10 },
      ],
      entregadas: [
        { mensajeroId: "m1", total: 10 }, // 100.0 -> pos 1
        { mensajeroId: "m2", total: 8 }, // 80.0 -> pos 2
      ],
      premios: [
        { posicion: 1, monto: "100.00", descripcion: "Oro" },
        { posicion: 2, monto: null, descripcion: null }, // R9: sin premio
        { posicion: 3, monto: "50.00", descripcion: "Bronce" },
      ],
    });
    const res = await service.obtenerRanking(MAESTRO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    const [ana, beto] = res.data.ranking;
    expect(ana).toMatchObject({ posicion: 1, premio: "100.00" }); // R14
    expect(beto).toMatchObject({ posicion: 2, premio: null }); // R9: null, no "0"
    // R15: solo 2 mensajeros elegibles -> la posicion 3 no aparece asignada a nadie.
    expect(res.data.ranking.some((x) => x.posicion === 3)).toBe(false);
    // R12: premios expuestos con monto/descripcion STRING|null.
    expect(res.data.premios).toEqual([
      { posicion: 1, monto: "100.00", descripcion: "Oro" },
      { posicion: 2, monto: null, descripcion: null },
      { posicion: 3, monto: "50.00", descripcion: "Bronce" },
    ]);
  });
});

describe("RankingService.obtenerRanking — autorizacion (R16/R17/R18)", () => {
  it("maestro -> esEditable true", async () => {
    const { service } = buildDeps({ mensajeros: [] });
    const res = await service.obtenerRanking(MAESTRO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.data.esEditable).toBe(true);
  });

  it("feature 94: admin -> ve y esEditable true (paridad con maestro)", async () => {
    const { service } = buildDeps({ mensajeros: [] });
    const res = await service.obtenerRanking(ADMIN, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.data.esEditable).toBe(true);
  });

  it("mensajero -> ve en solo-lectura (esEditable false)", async () => {
    const { service } = buildDeps({ mensajeros: [] });
    const res = await service.obtenerRanking(MENSAJERO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    expect(res.data.esEditable).toBe(false);
  });

  it("otro rol -> forbidden sin datos (R18)", async () => {
    const { service, listMensajeros } = buildDeps({ mensajeros: [] });
    const res = await service.obtenerRanking({ usuarioId: "x", rol: "adminTienda" }, NOW);
    expect(res).toEqual({ status: "forbidden" });
    expect(listMensajeros).not.toHaveBeenCalled(); // no toca datos
  });
});

describe("RankingService.obtenerRanking — LC1 (devolucion intradia)", () => {
  it("orden con asignacion limpiada ese dia NO cuenta en numerador ni denominador", async () => {
    // El repo YA excluye la orden limpiada (asignado_at NULL + mensajero NULL). El service
    // solo consume los conteos: no debe reinflar el denominador ni inventar una entrega.
    const { service } = buildDeps({
      mensajeros: [{ id: "m1", nombre: "Ana" }],
      asignadas: [{ mensajeroId: "m1", total: 2 }], // 3 asignadas - 1 limpiada = 2
      entregadas: [{ mensajeroId: "m1", total: 1 }], // la limpiada no aporta entrega vigente
    });
    const res = await service.obtenerRanking(MAESTRO, NOW);
    if (res.status !== "ok") throw new Error("esperaba ok");
    const ana = res.data.ranking[0];
    expect(ana.asignadasHoy).toBe(2); // consistente: la limpiada esta fuera del denominador
    expect(ana.entregadasHoy).toBe(1); // y fuera del numerador
    expect(ana.pct).toBe("50.0"); // 1/2, no 1/3 ni 2/3
  });
});

// Feature 166 — ventana del DIA NATURAL de Costa Rica. Sustituye al bloque de la 76 que
// codificaba la ventana vieja (`startOfDayCR(now)` + 24 h = `[00:00Z, 24:00Z)` = 18:00-18:00
// hora CR). Ahora ambos bordes caen en `...T06:00:00.000Z` (convencion de la feature 144,
// la misma que usa la analitica). Costa Rica es UTC-6 FIJO, sin horario de verano: por eso
// cada instante se escribe en UTC explicito con su hora CR equivalente al lado.
describe("RankingService.obtenerRanking — ventana del dia natural CR (166)", () => {
  /** Captura la pareja (desde, hasta) que el service pasa a los conteos para `now`. */
  async function ventanaPara(now: Date) {
    const { service, contarAsignadasPorMensajero, contarEntregadasPorMensajero } = buildDeps({
      mensajeros: [],
    });
    await service.obtenerRanking(MAESTRO, now);
    const entregadas = contarEntregadasPorMensajero.mock.calls[0] as unknown as [Date, Date];
    const asignadas = contarAsignadasPorMensajero.mock.calls[0] as unknown as [Date, Date];
    return { desde: entregadas[0], hasta: entregadas[1], entregadas, asignadas };
  }

  it("la ventana de hoy es el dia natural CR: ambos bordes en `T06:00:00.000Z`", async () => {
    // 2026-07-16T12:00:00Z = 06:00 CR del 16 -> dia CR = 2026-07-16.
    const { desde, hasta } = await ventanaPara(new Date("2026-07-16T12:00:00.000Z"));
    expect(desde.toISOString()).toBe("2026-07-16T06:00:00.000Z"); // 00:00 CR del 16
    expect(hasta.toISOString()).toBe("2026-07-17T06:00:00.000Z"); // 00:00 CR del 17
  });

  it("pasa la MISMA pareja (desde, hasta) a entregadas y a asignadas", async () => {
    const { entregadas, asignadas } = await ventanaPara(new Date("2026-07-16T12:00:00.000Z"));
    expect(asignadas[0].getTime()).toBe(entregadas[0].getTime());
    expect(asignadas[1].getTime()).toBe(entregadas[1].getTime());
    expect(entregadas[0].getTime()).toBeLessThan(entregadas[1].getTime()); // [desde, hasta)
  });

  it("la entrega de las 19:00 CR cuenta HOY, no manana", async () => {
    // 19:00 CR del 16 == 2026-07-17T01:00:00.000Z (UTC-6 fijo). Con la ventana vieja
    // (`hasta` = 2026-07-17T00:00:00Z) este instante caia FUERA del dia 16.
    const entregaDeLas19CR = new Date("2026-07-17T01:00:00.000Z");
    const { desde, hasta } = await ventanaPara(entregaDeLas19CR);
    expect(desde.toISOString()).toBe("2026-07-16T06:00:00.000Z");
    expect(entregaDeLas19CR.getTime()).toBeGreaterThanOrEqual(desde.getTime());
    expect(entregaDeLas19CR.getTime()).toBeLessThan(hasta.getTime());
  });

  it("la entrega de las 19:00 CR de AYER queda fuera del ranking de hoy", async () => {
    // 19:00 CR del 15 == 2026-07-16T01:00:00.000Z. La ventana vieja del dia 16
    // (`[2026-07-16T00:00Z, 2026-07-17T00:00Z)`) la ARRASTRABA; la nueva no.
    const entregaDeAyer = new Date("2026-07-16T01:00:00.000Z");
    const { desde, hasta } = await ventanaPara(new Date("2026-07-16T12:00:00.000Z"));
    expect(entregaDeAyer.getTime()).toBeLessThan(desde.getTime());
    expect(entregaDeAyer.getTime()).toBeLessThan(hasta.getTime());
  });

  it("23:59:59.999 CR dentro; 00:00:00.000 CR del dia siguiente fuera (cota exclusiva)", async () => {
    const { desde, hasta } = await ventanaPara(new Date("2026-07-16T12:00:00.000Z"));
    const ultimoInstanteDelDia = new Date("2026-07-17T05:59:59.999Z"); // 23:59:59.999 CR del 16
    const primerInstanteDelSiguiente = new Date("2026-07-17T06:00:00.000Z"); // 00:00 CR del 17
    expect(ultimoInstanteDelDia.getTime()).toBeGreaterThanOrEqual(desde.getTime());
    expect(ultimoInstanteDelDia.getTime()).toBeLessThan(hasta.getTime());
    expect(primerInstanteDelSiguiente.getTime()).toBe(hasta.getTime()); // borde superior EXCLUSIVO
    expect(primerInstanteDelSiguiente.getTime()).not.toBeLessThan(hasta.getTime());
  });

  it("dos llamadas con el mismo `now` producen la misma ventana", async () => {
    const now = new Date("2026-07-16T23:30:00.000Z"); // 17:30 CR del 16
    const a = await ventanaPara(now);
    const b = await ventanaPara(now);
    expect(a.desde.getTime()).toBe(b.desde.getTime());
    expect(a.hasta.getTime()).toBe(b.hasta.getTime());
  });

  it('la ventana coincide al milisegundo con `resolverRango({preset:"dia"}, now)`', async () => {
    // R13: analitica y ranking dejan de reportar cifras distintas para "hoy". Se importa
    // `resolverRango` en el TEST, no en el service (design §7, Alt. 2 descartada).
    const now = new Date("2026-07-16T12:00:00.000Z");
    const { desde, hasta } = await ventanaPara(now);
    const rango = resolverRango({ preset: "dia" }, now);
    expect(desde.getTime()).toBe(rango.desde.getTime());
    expect(hasta.getTime()).toBe(rango.hasta.getTime());
  });

  it("la cota superior son las 24:00 CR, no `now`", async () => {
    const now = new Date("2026-07-16T18:00:00.000Z"); // 12:00 CR del 16, dia en curso
    const { hasta } = await ventanaPara(now);
    expect(hasta.getTime()).toBeGreaterThan(now.getTime()); // cubre el dia COMPLETO (R14)
    expect(hasta.toISOString()).toBe("2026-07-17T06:00:00.000Z"); // 24:00 CR del 16
  });
});

describe("RankingService.editarPremio — autz y validacion (R10/R11/R16/R19)", () => {
  it("mensajero -> forbidden sin persistir (R19)", async () => {
    const { service, upsertPremio } = buildDeps({});
    const res = await service.editarPremio(MENSAJERO, {
      posicion: 1,
      monto: "100",
      descripcion: "Oro",
    });
    expect(res).toEqual({ status: "forbidden" });
    expect(upsertPremio).not.toHaveBeenCalled();
  });

  it("feature 94: admin puede editar premio (paridad con maestro)", async () => {
    const { service, upsertPremio } = buildDeps({});
    const res = await service.editarPremio(ADMIN, {
      posicion: 1,
      monto: "100",
      descripcion: "Oro",
    });
    expect(res).toEqual({ status: "ok" });
    expect(upsertPremio).toHaveBeenCalledWith(1, { monto: "100", descripcion: "Oro" });
  });

  it("maestro con monto valido -> ok y persiste monto + descripcion (R10)", async () => {
    const { service, upsertPremio } = buildDeps({});
    const res = await service.editarPremio(MAESTRO, {
      posicion: 2,
      monto: "1500.50",
      descripcion: "Plata",
    });
    expect(res).toEqual({ status: "ok" });
    expect(upsertPremio).toHaveBeenCalledWith(2, { monto: "1500.50", descripcion: "Plata" });
  });

  it("maestro con monto null -> ok, sin premio (R9)", async () => {
    const { service, upsertPremio } = buildDeps({});
    const res = await service.editarPremio(MAESTRO, { posicion: 3, monto: null, descripcion: null });
    expect(res).toEqual({ status: "ok" });
    expect(upsertPremio).toHaveBeenCalledWith(3, { monto: null, descripcion: null });
  });

  it.each([["-5"], ["12.345"], ["abc"], ["1,5"]])(
    "maestro con monto invalido %s -> invalid sin persistir (R11)",
    async (monto) => {
      const { service, upsertPremio } = buildDeps({});
      const res = await service.editarPremio(MAESTRO, {
        posicion: 1,
        monto,
        descripcion: null,
      });
      expect(res.status).toBe("invalid");
      expect(upsertPremio).not.toHaveBeenCalled();
    },
  );

  it("posicion fuera de 1-3 -> invalid sin persistir (R11)", async () => {
    const { service, upsertPremio } = buildDeps({});
    const res = await service.editarPremio(MAESTRO, {
      posicion: 4 as 1 | 2 | 3,
      monto: "10",
      descripcion: null,
    });
    expect(res.status).toBe("invalid");
    expect(upsertPremio).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// FEATURE 246 (T6.3/T6.4, D7 firmada el 2026-08-20) — EL VIVO PASA EL DIA DE REPARTO, Y CON SU
// CONVENCION.
//
// ⚠️ QUE SE MIDE AQUI Y QUE NO. Aqui NO se mide el `WHERE` —eso vive en
// `ranking-repository.test.ts`, y este repo ya midio cuatro veces que un test de servicio con
// dobles pasa en verde con el `where` mutado—. Aqui se mide el CABLEADO: que valor exacto recibe el
// repositorio, con que convencion, y que el vivo y el congelado usen EL MISMO criterio (R41).
// =================================================================================================
describe("246/R41 — el vivo pasa el dia de reparto con la convencion `@db.Date`", () => {
  /** Captura los TRES argumentos del denominador para un instante dado. */
  async function argsDelDenominador(now: Date) {
    const { service, contarAsignadasPorMensajero } = buildDeps({ mensajeros: [] });
    await service.obtenerRanking(MAESTRO, now);
    return contarAsignadasPorMensajero.mock.calls[0] as unknown as [Date, Date, Date];
  }

  it("el tercer argumento es la MEDIANOCHE UTC de la fecha CR, no las 06:00Z", async () => {
    // 2026-07-16T12:00:00Z = 06:00 CR del 16 -> dia CR = 2026-07-16.
    const [desde, hasta, diaReparto] = await argsDelDenominador(
      new Date("2026-07-16T12:00:00.000Z"),
    );
    // Las cotas del respaldo conservan SU convencion (features 144/166): 06:00Z.
    expect(desde.toISOString()).toBe("2026-07-16T06:00:00.000Z");
    expect(hasta.toISOString()).toBe("2026-07-17T06:00:00.000Z");
    // Y el dia de reparto la SUYA (feature 46, columnas `@db.Date`): 00:00Z del MISMO dia.
    expect(diaReparto.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("las dos convenciones no se confunden: `diaReparto` = `desde` − 6 h, y no al reves", async () => {
    // Si alguien derivara una de la otra al reves, el denominador miraria el dia SIGUIENTE.
    const [desde, , diaReparto] = await argsDelDenominador(new Date("2026-07-16T12:00:00.000Z"));
    expect(desde.getTime() - diaReparto.getTime()).toBe(6 * 60 * 60 * 1000);
  });

  it("a las 19:00 CR sigue siendo el MISMO dia (el off-by-one de la 166, por la otra puerta)", async () => {
    // 2026-07-17T01:00:00Z = 19:00 CR del 16. En UTC ya es dia 17.
    const [, , diaReparto] = await argsDelDenominador(new Date("2026-07-17T01:00:00.000Z"));
    expect(diaReparto.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("a las 23:59 CR y a las 00:01 CR el dia de reparto cambia (la frontera real)", async () => {
    const [, , antes] = await argsDelDenominador(new Date("2026-07-17T05:59:00.000Z"));
    const [, , despues] = await argsDelDenominador(new Date("2026-07-17T06:01:00.000Z"));
    expect(antes.toISOString()).toBe("2026-07-16T00:00:00.000Z");
    expect(despues.toISOString()).toBe("2026-07-17T00:00:00.000Z");
  });

  it("R39: el NUMERADOR sigue recibiendo DOS argumentos — no se le añade el dia de reparto", async () => {
    // R39 dice que el numerador no cambia, y eso hay que afirmarlo, no dejarlo implicito.
    const { service, contarEntregadasPorMensajero } = buildDeps({ mensajeros: [] });
    await service.obtenerRanking(MAESTRO, NOW);
    expect(contarEntregadasPorMensajero.mock.calls[0]).toHaveLength(2);
  });
});

describe("246/R40 — la asimetria declarada: entregar hoy algo reservado para mañana", () => {
  it("el numerador de HOY y el denominador de MAÑANA se piden con dias distintos, a proposito", async () => {
    // R40 es una asimetria CONSCIENTE (limite declarado 4 de requirements.md), no un cabo suelto:
    // el numerador cuenta la entrega el dia en que se hizo y el denominador cuenta la orden el dia
    // para el que se reservo. El sistema YA convive con ella en el otro sentido —una orden
    // asignada ayer y entregada hoy— hasta el punto de que `ranking_snapshot_fila` renuncia a
    // proposito a un `CHECK entregadas <= asignadas`.
    //
    // Lo que se puede afirmar desde el servicio es esto: la entrega se cuenta por la VENTANA de
    // `created_at` y la orden por el DIA de reparto, y son dos criterios distintos sobre la misma
    // orden. Alinearlos esta descartado con motivo en design §10-F.
    const { service, contarEntregadasPorMensajero, contarAsignadasPorMensajero } = buildDeps({
      mensajeros: [{ id: "m1", nombre: "Ana" }],
      entregadas: [{ mensajeroId: "m1", total: 1 }], // entrego hoy
      asignadas: [], // ...pero la orden cuenta en el denominador de MAÑANA
    });

    const res = await service.obtenerRanking(MAESTRO, NOW);

    expect(res.status).toBe("ok");
    const fila = res.status === "ok" ? res.data.ranking[0] : null;
    // 1 entregada / 0 asignadas: el porcentaje queda INDEFINIDO (no explota, no es 100 %).
    expect(fila?.entregadasHoy).toBe(1);
    expect(fila?.asignadasHoy).toBe(0);
    expect(fila?.pct).toBeNull();
    // Y las dos consultas efectivamente miran cosas distintas.
    const numerador = contarEntregadasPorMensajero.mock.calls[0] as unknown as [Date, Date];
    const denominador = contarAsignadasPorMensajero.mock.calls[0] as unknown as [Date, Date, Date];
    expect(numerador).toHaveLength(2);
    expect(denominador).toHaveLength(3);
  });
});
