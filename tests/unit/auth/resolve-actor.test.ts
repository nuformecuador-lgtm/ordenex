import { describe, it, expect, vi, beforeEach } from "vitest";

// Feature 146 — A3. `resolveActorFromSession` gana `zonaId` (usuario.zona_id), insumo del
// predicado de visibilidad de las notificaciones acotadas por zona (R16, design §1.5).
// El cambio es ADITIVO: la resolucion de usuario/rol no cambia.

const cookiesMock = vi.fn();
const findUniqueMock = vi.fn();
const findValidByIdMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => ({ usuario: { findUnique: findUniqueMock } }),
}));

vi.mock("@/lib/repositories/SessionRepository", () => ({
  SessionRepository: class {
    findValidById = findValidByIdMock;
  },
}));

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

function conCookieDeSesion(valor: string | undefined) {
  cookiesMock.mockResolvedValue({
    get: () => (valor === undefined ? undefined : { value: valor }),
  });
}

describe("resolveActorFromSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve la zona del usuario en el actor cuando la sesion es valida", async () => {
    conCookieDeSesion("sess-1");
    findValidByIdMock.mockResolvedValue({ userId: "u-1" });
    findUniqueMock.mockResolvedValue({
      id: "u-1",
      zonaId: "zona-9",
      rol: { value: "adminSatelite" },
    });

    const actor = await resolveActorFromSession();

    expect(actor).toEqual({ usuarioId: "u-1", rol: "adminSatelite", zonaId: "zona-9" });
  });

  it("devuelve zonaId null cuando el usuario no tiene zona asignada", async () => {
    conCookieDeSesion("sess-1");
    findValidByIdMock.mockResolvedValue({ userId: "u-2" });
    findUniqueMock.mockResolvedValue({ id: "u-2", zonaId: null, rol: { value: "admin" } });

    const actor = await resolveActorFromSession();

    expect(actor).toEqual({ usuarioId: "u-2", rol: "admin", zonaId: null });
  });

  it("devuelve null cuando no hay cookie de sesion", async () => {
    conCookieDeSesion(undefined);

    expect(await resolveActorFromSession()).toBeNull();
    expect(findValidByIdMock).not.toHaveBeenCalled();
  });
});
