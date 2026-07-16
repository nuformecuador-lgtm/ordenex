import { describe, it, expect, vi } from "vitest";

// revalidatePath necesita contexto de request; se mockea (patron de aislamiento de Server
// Actions). El test verifica que se invoca tras un guardado exitoso (R10).
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { obtenerRankingAction, editarPremioAction } from "@/lib/actions/ranking";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IRankingService } from "@/lib/interfaces/services/IRankingService";
import type { RankingData } from "@/lib/types/ranking";

// Feature 76 (R10/R11/R12/R19) — tests unit de las Server Actions del ranking. Sin sesion ->
// unauthenticated (R18); zod en el borde rechaza monto invalido/descripcion larga -> invalid
// (R11); el forbidden del mensajero editando lo decide el service (R19). Datos ya STRING (R12).

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const MENSAJERO: Actor = { usuarioId: "u-msj", rol: "mensajero" };

function fakeData(): RankingData {
  return {
    ranking: [
      {
        posicion: 1,
        mensajeroId: "m1",
        nombre: "Ana",
        entregadasHoy: 5,
        asignadasHoy: 5,
        pct: "100.0",
        premio: "100.00",
      },
    ],
    premios: [
      { posicion: 1, monto: "100.00", descripcion: "Oro" },
      { posicion: 2, monto: null, descripcion: null },
      { posicion: 3, monto: null, descripcion: null },
    ],
    esEditable: true,
  };
}

function fakeService(overrides: Partial<IRankingService> = {}): IRankingService {
  return {
    obtenerRanking: vi.fn(async () => ({ status: "ok" as const, data: fakeData() })),
    editarPremio: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

describe("obtenerRankingAction (R12/R18)", () => {
  it("sin sesion -> unauthenticated sin tocar el service (R18)", async () => {
    const service = fakeService();
    const r = await obtenerRankingAction({ service, getActor: async () => null });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.obtenerRanking).not.toHaveBeenCalled();
  });

  it("con sesion -> devuelve el resultado serializado (montos/pct STRING, R12)", async () => {
    const service = fakeService();
    const r = await obtenerRankingAction({ service, getActor: async () => MAESTRO });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.data.premios[0]).toEqual({ posicion: 1, monto: "100.00", descripcion: "Oro" });
    expect(r.data.ranking[0].pct).toBe("100.0");
  });
});

describe("editarPremioAction — validacion en el borde (R11)", () => {
  it.each([["-5"], ["12.345"], ["abc"], ["1,5"]])(
    "monto invalido %s -> invalid, sin llamar al service ni revalidar",
    async (monto) => {
      const service = fakeService();
      const r = await editarPremioAction(
        { posicion: 1, monto, descripcion: null },
        { service, getActor: async () => MAESTRO },
      );
      expect(r.status).toBe("invalid");
      expect(service.editarPremio).not.toHaveBeenCalled();
    },
  );

  it("posicion fuera de 1|3 -> invalid", async () => {
    const service = fakeService();
    const r = await editarPremioAction(
      { posicion: 9, monto: "10", descripcion: null },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("invalid");
  });

  it("descripcion demasiado larga -> invalid", async () => {
    const service = fakeService();
    const r = await editarPremioAction(
      { posicion: 1, monto: "10", descripcion: "x".repeat(201) },
      { service, getActor: async () => MAESTRO },
    );
    expect(r.status).toBe("invalid");
  });
});

describe("editarPremioAction — guardar y vaciar (R10) + autz (R18/R19)", () => {
  it("sin sesion -> unauthenticated (R18)", async () => {
    const service = fakeService();
    const r = await editarPremioAction(
      { posicion: 1, monto: "10", descripcion: null },
      { service, getActor: async () => null },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.editarPremio).not.toHaveBeenCalled();
  });

  it("mensajero editando -> forbidden (lo decide el service, R19), sin revalidar", async () => {
    revalidatePath.mockClear();
    const service = fakeService({ editarPremio: vi.fn(async () => ({ status: "forbidden" as const })) });
    const r = await editarPremioAction(
      { posicion: 1, monto: "10", descripcion: null },
      { service, getActor: async () => MENSAJERO },
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maestro guarda monto+descripcion -> ok, normaliza y revalida /ranking (R10)", async () => {
    revalidatePath.mockClear();
    const editarPremio = vi.fn(async () => ({ status: "ok" as const }));
    const service = fakeService({ editarPremio });
    const r = await editarPremioAction(
      { posicion: 2, monto: "  1500.50  ", descripcion: "  Plata  " },
      { service, getActor: async () => MAESTRO },
    );
    expect(r).toEqual({ status: "ok" });
    // zod normaliza (trim); el service recibe los valores limpios.
    expect(editarPremio).toHaveBeenCalledWith(MAESTRO, {
      posicion: 2,
      monto: "1500.50",
      descripcion: "Plata",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/ranking");
  });

  it("maestro vacia monto y descripcion -> null,null (R10 vaciar = sin premio/sin descripcion)", async () => {
    const editarPremio = vi.fn(async () => ({ status: "ok" as const }));
    const service = fakeService({ editarPremio });
    await editarPremioAction(
      { posicion: 3, monto: "", descripcion: "   " },
      { service, getActor: async () => MAESTRO },
    );
    expect(editarPremio).toHaveBeenCalledWith(MAESTRO, {
      posicion: 3,
      monto: null,
      descripcion: null,
    });
  });
});
