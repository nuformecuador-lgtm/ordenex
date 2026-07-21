import { describe, it, expect, vi } from "vitest";
import { RankingService } from "@/lib/services/RankingService";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { IPremioRankingRepository } from "@/lib/interfaces/repositories/IPremioRankingRepository";
import type { IUserRepository } from "@/lib/interfaces/repositories/IUserRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ConteoPorMensajero, PremioRankingDTO } from "@/lib/types/ranking";

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

describe("RankingService.obtenerRanking — rango del dia por helper CR (R22)", () => {
  it("pasa desde=startOfDayCR(now) y hasta=+24h a ambos conteos", async () => {
    const { service, contarAsignadasPorMensajero, contarEntregadasPorMensajero } = buildDeps({
      mensajeros: [],
    });
    await service.obtenerRanking(MAESTRO, new Date("2026-07-16T12:00:00.000Z"));
    // startOfDayCR devuelve la medianoche UTC de la fecha CALENDARIO de CR (feature 46):
    // 12:00Z (06:00 CR del 16) -> 2026-07-16T00:00:00Z; hasta = +24h.
    const desde = new Date("2026-07-16T00:00:00.000Z");
    const hasta = new Date("2026-07-17T00:00:00.000Z");
    expect(contarAsignadasPorMensajero).toHaveBeenCalledWith(desde, hasta);
    expect(contarEntregadasPorMensajero).toHaveBeenCalledWith(desde, hasta);
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
