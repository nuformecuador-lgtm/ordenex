import { describe, it, expect, vi } from "vitest";
import { generarApiKey } from "@/lib/actions/api-keys";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import type { GenerarApiKeyResult } from "@/lib/types/api-key";

// Feature 81 — Server Action. `deps` inyectados: no toca cookies reales ni Prisma.

function okService(): IApiKeyService {
  return {
    generar: vi.fn(
      async (): Promise<GenerarApiKeyResult> => ({
        status: "ok",
        apiKey: {
          id: "key-1",
          identificador: "Tienda Uno",
          keyPrefix: "ordx_abc1234",
          usuarioId: "u-dedicado",
          createdAt: new Date("2026-07-16T12:00:00Z"),
        },
        plainKey: "ordx_secreto",
      }),
    ),
  };
}

describe("generarApiKey (action) — autenticacion (R1)", () => {
  it("R1: devuelve unauthenticated cuando no hay cookie de sesion, sin tocar el service", async () => {
    const service = okService();
    const r = await generarApiKey(
      { identificador: "Tienda Uno" },
      { getActor: async () => null, apiKeyService: service },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    // R1: no debe crear ninguna fila -> el service ni se invoca.
    expect(service.generar).not.toHaveBeenCalled();
  });
});

describe("generarApiKey (action) — validacion en el borde (R3/R4)", () => {
  const actor = async (): Promise<Actor> => ({ usuarioId: "u-maestro", rol: "maestro" });

  it.each([
    ["menos de 3 chars", { identificador: "ab" }],
    ["vacio", { identificador: "" }],
    ["solo espacios (trim antes de medir)", { identificador: "   " }],
    ["mas de 60 chars", { identificador: "x".repeat(61) }],
    ["falta el campo", {}],
    ["tipo incorrecto", { identificador: 42 }],
  ])("R4: %s -> validation_error en `identificador`, sin tocar el service", async (_n, input) => {
    const service = okService();
    const r = await generarApiKey(input, { getActor: actor, apiKeyService: service });
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(r.fieldErrors.identificador).toBeDefined();
    }
    expect(service.generar).not.toHaveBeenCalled();
  });

  // Caso distinto a los de arriba: cuando el input NO es siquiera un objeto, zod
  // reporta el fallo en la RAIZ, no bajo `identificador` (no hay tal campo que
  // señalar). Sigue siendo validation_error y sigue sin crear filas, que es lo que
  // R4 protege; solo cambia donde vive el detalle.
  it.each([
    ["input null", null],
    ["input string suelto", "Tienda Uno"],
    ["input undefined", undefined],
  ])("R4: %s -> validation_error (detalle en la raiz), sin tocar el service", async (_n, input) => {
    const service = okService();
    const r = await generarApiKey(input, { getActor: actor, apiKeyService: service });
    expect(r.status).toBe("validation_error");
    expect(service.generar).not.toHaveBeenCalled();
  });

  it("R3: acepta el limite inferior (3) y el superior (60)", async () => {
    for (const identificador of ["abc", "x".repeat(60)]) {
      const service = okService();
      const r = await generarApiKey({ identificador }, { getActor: actor, apiKeyService: service });
      expect(r.status).toBe("ok");
    }
  });

  it("R3: recorta los espacios antes de validar y de pasar al service", async () => {
    const service = okService();
    await generarApiKey({ identificador: "  Tienda Uno  " }, { getActor: actor, apiKeyService: service });
    expect(service.generar).toHaveBeenCalledWith(
      { identificador: "Tienda Uno" },
      { usuarioId: "u-maestro", rol: "maestro" },
    );
  });
});

describe("generarApiKey (action) — propagacion del service (R2/R11/R18)", () => {
  const actor = async (): Promise<Actor> => ({ usuarioId: "u-maestro", rol: "maestro" });

  it("R18: propaga el secreto en claro del service tal cual, una sola vez", async () => {
    const service = okService();
    const r = await generarApiKey({ identificador: "Tienda Uno" }, { getActor: actor, apiKeyService: service });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.plainKey).toBe("ordx_secreto");
      expect(r.apiKey).not.toHaveProperty("keyHash");
    }
  });

  it("R2: propaga el forbidden del service", async () => {
    const service: IApiKeyService = {
      generar: vi.fn(async (): Promise<GenerarApiKeyResult> => ({ status: "forbidden" })),
    };
    const r = await generarApiKey(
      { identificador: "Tienda Uno" },
      { getActor: async () => ({ usuarioId: "u1", rol: "admin" }), apiKeyService: service },
    );
    expect(r).toEqual({ status: "forbidden" });
  });

  it("R11: propaga el conflict del service con su campo", async () => {
    const service: IApiKeyService = {
      generar: vi.fn(
        async (): Promise<GenerarApiKeyResult> => ({ status: "conflict", campo: "email" }),
      ),
    };
    const r = await generarApiKey({ identificador: "Tienda Uno" }, { getActor: actor, apiKeyService: service });
    expect(r).toEqual({ status: "conflict", campo: "email" });
  });
});
