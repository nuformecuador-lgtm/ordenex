import { describe, it, expect, vi } from "vitest";

import { obtenerRankingHistoricoAction } from "@/lib/actions/ranking-historico";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRankingSnapshotService } from "@/lib/interfaces/services/IRankingSnapshotService";
import type { RankingSnapshotData } from "@/lib/types/ranking-snapshot";

// Feature 196 (T4.2) — tests unit de la Server Action del historico.
//
// R30: la fecha se valida en el BORDE; una fecha que no existe no debe llegar al service (y
// por tanto no toca el almacenamiento). R31: lo que sale hacia el cliente lleva `pct` y
// `premioMonto` como STRING —o `null`—, nunca `number` ni `Prisma.Decimal`.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };
const ROL_AJENO: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };

function fakeData(): RankingSnapshotData {
  return {
    fecha: "2026-08-09",
    generadoAt: "2026-08-10T08:00:00.000Z",
    minAsignadasPodio: 5,
    filas: [
      {
        puesto: 1,
        posicion: 1,
        mensajeroId: "m1",
        nombre: "Ana",
        entregadas: 24,
        asignadas: 25,
        pct: "96.0",
        premioMonto: "15000.00",
        premioDescripcion: "Oro",
      },
      {
        puesto: 2,
        posicion: null,
        mensajeroId: "m2",
        nombre: "Beto",
        entregadas: 1,
        asignadas: 0,
        pct: null,
        premioMonto: null,
        premioDescripcion: null,
      },
    ],
  };
}

function fakeService(overrides: Partial<IRankingSnapshotService> = {}): IRankingSnapshotService {
  return {
    congelar: vi.fn(async () => ({
      status: "creado" as const,
      fecha: "2026-08-09",
      filas: 0,
    })),
    obtenerPorFecha: vi.fn(async () => ({ status: "ok" as const, data: fakeData() })),
    ...overrides,
  };
}

describe("obtenerRankingHistoricoAction — validacion en el borde (R30)", () => {
  // "2026-02-31" es el caso duro: cumple la FORMA y `new Date` lo rueda al 3 de marzo.
  // "" y "ayer" no llegan ni a fecha. Los no-string entran por props/formularios reales.
  it.each([
    ["dia inexistente", "2026-02-31"],
    ["texto libre", "ayer"],
    ["cadena vacia", ""],
    ["mes fuera de rango", "2026-13-01"],
    ["formato con barras", "09/08/2026"],
    ["fecha con hora", "2026-08-09T00:00:00.000Z"],
  ])("fecha invalida (%s) -> invalid sin llamar al service", async (_caso, fecha) => {
    const service = fakeService();
    const r = await obtenerRankingHistoricoAction(
      { fecha },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("invalid");
    // El almacenamiento no se toca: el service ni siquiera se invoca.
    expect(service.obtenerPorFecha).not.toHaveBeenCalled();
  });

  it.each([
    ["numero", 20260809],
    ["null", null],
    ["undefined", undefined],
    ["objeto Date", new Date("2026-08-09T00:00:00.000Z")],
  ])("fecha no-string (%s) -> invalid sin llamar al service", async (_caso, fecha) => {
    const service = fakeService();
    const r = await obtenerRankingHistoricoAction(
      { fecha },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("invalid");
    expect(service.obtenerPorFecha).not.toHaveBeenCalled();
  });

  it("input sin la clave `fecha` -> invalid sin llamar al service", async () => {
    const service = fakeService();
    const r = await obtenerRankingHistoricoAction({}, { service, getActor: async () => MAESTRO });
    expect(r.status).toBe("invalid");
    expect(service.obtenerPorFecha).not.toHaveBeenCalled();
  });

  it("fecha valida -> se delega al service con la fecha tal cual (R30)", async () => {
    const service = fakeService();
    const r = await obtenerRankingHistoricoAction(
      { fecha: "2026-08-09" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    expect(service.obtenerPorFecha).toHaveBeenCalledWith(MAESTRO, "2026-08-09");
  });

  it("sin sesion -> unauthenticated sin tocar el service", async () => {
    const service = fakeService();
    const r = await obtenerRankingHistoricoAction(
      { fecha: "2026-08-09" },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.obtenerPorFecha).not.toHaveBeenCalled();
  });
});

describe("obtenerRankingHistoricoAction — serializacion money-safe (R31)", () => {
  it("en el resultado ok, pct y premioMonto son string|null, nunca number ni Decimal", async () => {
    const service = fakeService();
    const r = await obtenerRankingHistoricoAction(
      { fecha: "2026-08-09" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    for (const fila of r.data.filas) {
      // `typeof null` es "object", asi que el `null` se aparta ANTES de mirar el tipo: si no,
      // el assert pasaria por `number` y por `Prisma.Decimal` disfrazados de nulo.
      if (fila.pct === null) expect(fila.pct).toBeNull();
      else expect(typeof fila.pct).toBe("string"); // ni number ni Decimal
      if (fila.premioMonto === null) expect(fila.premioMonto).toBeNull();
      else expect(typeof fila.premioMonto).toBe("string");
    }

    // Cruzar la frontera servidor->cliente no cambia nada: si `premioMonto` fuese un
    // `Prisma.Decimal`, este round-trip lo delataria (se convertiria en objeto u otra cadena).
    expect(JSON.parse(JSON.stringify(r.data))).toEqual(r.data);

    // Valores concretos: la accion NO reformatea ni recalcula nada de lo que le da el service.
    expect(r.data.filas[0].pct).toBe("96.0");
    expect(r.data.filas[0].premioMonto).toBe("15000.00");
    expect(r.data.filas[1].pct).toBeNull();
    expect(r.data.filas[1].premioMonto).toBeNull();
  });

  it("devuelve el resultado del service TAL CUAL (misma referencia de datos, R31)", async () => {
    const data = fakeData();
    const service = fakeService({
      obtenerPorFecha: vi.fn(async () => ({ status: "ok" as const, data })),
    });
    const r = await obtenerRankingHistoricoAction(
      { fecha: "2026-08-09" },
      { service, getActor: async () => MENSAJERO },
    );
    expect(r).toEqual({ status: "ok", data });
    if (r.status !== "ok") return;
    expect(r.data.generadoAt).toBe("2026-08-10T08:00:00.000Z");
    expect(r.data.minAsignadasPodio).toBe(5);
    // El orden congelado se respeta: la accion no ordena.
    expect(r.data.filas.map((f) => f.puesto)).toEqual([1, 2]);
  });

  it("propaga sin_snapshot tal cual (no lo confunde con un dia sin actividad)", async () => {
    const service = fakeService({
      obtenerPorFecha: vi.fn(async () => ({
        status: "sin_snapshot" as const,
        fecha: "2026-08-09",
      })),
    });
    const r = await obtenerRankingHistoricoAction(
      { fecha: "2026-08-09" },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "sin_snapshot", fecha: "2026-08-09" });
  });

  it("propaga forbidden del service (la autorizacion por rol no vive en la accion)", async () => {
    const service = fakeService({
      obtenerPorFecha: vi.fn(async () => ({ status: "forbidden" as const })),
    });
    const r = await obtenerRankingHistoricoAction(
      { fecha: "2026-08-09" },
      { service, getActor: async () => ROL_AJENO },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(service.obtenerPorFecha).toHaveBeenCalledWith(ROL_AJENO, "2026-08-09");
  });
});
