import { describe, it, expect, vi } from "vitest";

import type { Actor } from "@/lib/interfaces/services/IVehiculoService";

// FICHA 465 (T6) — EL COMPOSITION ROOT, EJERCITADO DE VERDAD.
//
// Comprobar que `lib/actions/cobertura.ts` IMPORTA `CoberturaRepository` no basta (memoria «el
// composition root que no inyecta»: 2 de 7 notificadores muertos con la suite verde). Aqui se
// llama a la accion REAL sin `deps.coberturaService`, con `getPrismaClient` devolviendo un cliente
// falso, y se exige que las DOS lecturas del repositorio real lleguen a ese cliente y que su
// resultado salga clasificado por la accion.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

const distritoFindMany = vi.fn(async (..._args: unknown[]) => [
  {
    nombre: "San Rafael",
    activo: true,
    zonaEspecial: null,
    canton: { nombre: "Escazú", activo: true, provincia: { nombre: "San José", activo: true } },
    zonas: [{ zona: { id: "z1", nombre: "GAM", esCentral: true } }],
  },
]);
const tarifaFindMany = vi.fn(async (..._args: { where: Record<string, unknown> }[]) => [{ zonaId: "z1" }]);

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => ({
    distrito: { findMany: distritoFindMany },
    tarifa: { findMany: tarifaFindMany },
  }),
  PRISMA_OMIT: {},
}));

const { listarCoberturaDistritos } = await import("@/lib/actions/cobertura");

describe("465 — el composition root PASA un CoberturaRepository real", () => {
  it("la accion sin deps.coberturaService lee por el repositorio real y clasifica", async () => {
    const r = await listarCoberturaDistritos({ getActor: async () => MAESTRO });

    expect(r).toEqual({
      status: "ok",
      total: 1,
      items: [
        {
          provincia: "San José",
          canton: "Escazú",
          distrito: "San Rafael",
          disponible: true,
          cobertura: true,
          motivo: null,
          zonas: ["GAM"],
          zonaUnica: { nombre: "GAM", esCentral: true, tieneTarifaGeneral: true },
          zonaEspecial: null,
        },
      ],
    });
    // Anti-vacuidad: las dos lecturas se hicieron de verdad contra el cliente inyectado.
    expect(distritoFindMany).toHaveBeenCalledTimes(1);
    expect(tarifaFindMany).toHaveBeenCalledTimes(1);
    expect(tarifaFindMany.mock.calls[0][0].where).toEqual({ tiendaId: null, zonaId: { not: null } });
  });
});
