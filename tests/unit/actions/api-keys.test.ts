import { describe, it, expect, vi } from "vitest";
import {
  activarApiKey,
  desactivarApiKey,
  generarApiKey,
  rotarApiKey,
} from "@/lib/actions/api-keys";
import type { Actor, IApiKeyService } from "@/lib/interfaces/services/IApiKeyService";
import type {
  CambiarEstadoApiKeyResult,
  GenerarApiKeyResult,
  ListarApiKeysResult,
  RotarApiKeyResult,
} from "@/lib/types/api-key";

// Feature 81 — Server Action. `deps` inyectados: no toca cookies reales ni Prisma.

const UUID = "11111111-1111-4111-8111-111111111111";

/**
 * Stubs de los metodos que NO ejercita el test en curso: fallan ruidosamente en vez de
 * devolver un vacio que haria pasar un test por la razon equivocada.
 */
function otrosStubs(): Pick<IApiKeyService, "listar" | "rotar" | "activar" | "desactivar"> {
  return {
    listar: vi.fn(async (): Promise<ListarApiKeysResult> => {
      throw new Error("listar no debe invocarse aqui");
    }),
    rotar: vi.fn(async (): Promise<RotarApiKeyResult> => {
      throw new Error("rotar no debe invocarse aqui");
    }),
    activar: vi.fn(async (): Promise<CambiarEstadoApiKeyResult> => {
      throw new Error("activar no debe invocarse aqui");
    }),
    desactivar: vi.fn(async (): Promise<CambiarEstadoApiKeyResult> => {
      throw new Error("desactivar no debe invocarse aqui");
    }),
  };
}

function apiKeyPublico(estado: "activa" | "inactiva" = "activa") {
  return {
    id: "key-1",
    identificador: "Tienda Uno",
    keyPrefix: "ordx_abc1234",
    estado,
    usuarioId: "u-dedicado",
    createdAt: new Date("2026-07-16T12:00:00Z"),
  };
}

function okService(): IApiKeyService {
  return {
    ...otrosStubs(),
    generar: vi.fn(
      async (): Promise<GenerarApiKeyResult> => ({
        status: "ok",
        apiKey: apiKeyPublico(),
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
      ...otrosStubs(),
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
      ...otrosStubs(),
      generar: vi.fn(
        async (): Promise<GenerarApiKeyResult> => ({ status: "conflict", campo: "email" }),
      ),
    };
    const r = await generarApiKey({ identificador: "Tienda Uno" }, { getActor: actor, apiKeyService: service });
    expect(r).toEqual({ status: "conflict", campo: "email" });
  });
});

// ---------------------------------------------------------------------------
// Ciclo de vida — rotarApiKey / activarApiKey / desactivarApiKey (actions)
// ---------------------------------------------------------------------------

const maestro = async (): Promise<Actor> => ({ usuarioId: "u-maestro", rol: "maestro" });

/** Service con rotar/activar/desactivar sobrescritos; el resto lanza (otrosStubs). */
function lifecycleService(overrides: Partial<IApiKeyService>): IApiKeyService {
  return { ...okService(), ...otrosStubs(), ...overrides };
}

describe("rotarApiKey (action) — autenticacion y validacion (R1)", () => {
  it("R1: sin sesion -> unauthenticated, sin tocar el service", async () => {
    const rotar = vi.fn();
    const r = await rotarApiKey({ id: UUID }, { getActor: async () => null, apiKeyService: lifecycleService({ rotar }) });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(rotar).not.toHaveBeenCalled();
  });

  it("id no-uuid -> validation_error, sin tocar el service", async () => {
    const rotar = vi.fn();
    const r = await rotarApiKey({ id: "no-uuid" }, { getActor: maestro, apiKeyService: lifecycleService({ rotar }) });
    expect(r.status).toBe("validation_error");
    expect(rotar).not.toHaveBeenCalled();
  });
});

describe("rotarApiKey (action) — propagacion del service (R2/R3)", () => {
  it("R2: propaga ok con el nuevo secreto en claro y la key publica (sin keyHash)", async () => {
    const rotar = vi.fn(
      async (): Promise<RotarApiKeyResult> => ({
        status: "ok",
        apiKey: apiKeyPublico(),
        plainKey: "ordx_nuevosecreto",
      }),
    );
    const r = await rotarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: lifecycleService({ rotar }) });
    expect(rotar).toHaveBeenCalledWith({ id: UUID }, { usuarioId: "u-maestro", rol: "maestro" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.plainKey).toBe("ordx_nuevosecreto");
      expect(r.apiKey).not.toHaveProperty("keyHash");
    }
  });

  it("R3: propaga not_found del service", async () => {
    const rotar = vi.fn(async (): Promise<RotarApiKeyResult> => ({ status: "not_found" }));
    const r = await rotarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: lifecycleService({ rotar }) });
    expect(r).toEqual({ status: "not_found" });
  });

  it("R1: propaga forbidden del service (rol != maestro)", async () => {
    const rotar = vi.fn(async (): Promise<RotarApiKeyResult> => ({ status: "forbidden" }));
    const r = await rotarApiKey(
      { id: UUID },
      { getActor: async () => ({ usuarioId: "u1", rol: "admin" }), apiKeyService: lifecycleService({ rotar }) },
    );
    expect(r).toEqual({ status: "forbidden" });
  });
});

describe("activarApiKey / desactivarApiKey (actions) — R1/R3/R4", () => {
  it("R4: activar propaga ok con la key publica actualizada", async () => {
    const activar = vi.fn(
      async (): Promise<CambiarEstadoApiKeyResult> => ({ status: "ok", apiKey: apiKeyPublico("activa") }),
    );
    const r = await activarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: lifecycleService({ activar }) });
    expect(activar).toHaveBeenCalledWith({ id: UUID }, { usuarioId: "u-maestro", rol: "maestro" });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.apiKey.estado).toBe("activa");
  });

  it("R4: desactivar propaga ok con la key publica actualizada", async () => {
    const desactivar = vi.fn(
      async (): Promise<CambiarEstadoApiKeyResult> => ({ status: "ok", apiKey: apiKeyPublico("inactiva") }),
    );
    const r = await desactivarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: lifecycleService({ desactivar }) });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.apiKey.estado).toBe("inactiva");
  });

  it("R3: activar/desactivar propagan not_found", async () => {
    const activar = vi.fn(async (): Promise<CambiarEstadoApiKeyResult> => ({ status: "not_found" }));
    const desactivar = vi.fn(async (): Promise<CambiarEstadoApiKeyResult> => ({ status: "not_found" }));
    expect(
      await activarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: lifecycleService({ activar }) }),
    ).toEqual({ status: "not_found" });
    expect(
      await desactivarApiKey({ id: UUID }, { getActor: maestro, apiKeyService: lifecycleService({ desactivar }) }),
    ).toEqual({ status: "not_found" });
  });

  it("R1: sin sesion -> unauthenticated para ambas, sin tocar el service", async () => {
    const activar = vi.fn();
    const desactivar = vi.fn();
    expect(
      await activarApiKey({ id: UUID }, { getActor: async () => null, apiKeyService: lifecycleService({ activar }) }),
    ).toEqual({ status: "unauthenticated" });
    expect(
      await desactivarApiKey({ id: UUID }, { getActor: async () => null, apiKeyService: lifecycleService({ desactivar }) }),
    ).toEqual({ status: "unauthenticated" });
    expect(activar).not.toHaveBeenCalled();
    expect(desactivar).not.toHaveBeenCalled();
  });
});
