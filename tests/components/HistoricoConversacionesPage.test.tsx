import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";

import HistoricoConversacionesPage from "@/app/(app)/historico/conversaciones/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_HISTORICO_CONVERSACIONES } from "@/lib/auth/menu-visibility";
import type { ObtenerCatalogoFiltrosOrdenesResult } from "@/lib/types/filtros-ordenes";

/**
 * Feature 321 (T1.4, R7) — EL GATE DE LA RUTA.
 *
 * El ítem de menú sólo decide qué se MUESTRA; la defensa real es este `notFound()`. Y no
 * basta con que responda 404: R7 exige que responda **antes de consultar dato alguno**,
 * así que cada caso denegado afirma además que el doble del cargador
 * **no fue invocado ni una vez**.
 */

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// El único cargador de datos que la página importa. Se mockea el MÓDULO para que un
// descuido futuro (llamarlo por la vía directa en vez de por `deps`) tampoco arrastre
// Prisma ni `next/headers` a este test — y para que el doble por `deps` no sea la única
// red: si alguien saltara la inyección, el espía del módulo lo cazaría igual.
const catalogoModulo = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: catalogoModulo.fn,
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}

const notFoundSpy = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  notFound: () => {
    notFoundSpy();
    throw new NotFoundError();
  },
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);

const CATALOGO_OK: ObtenerCatalogoFiltrosOrdenesResult = {
  status: "ok",
  catalogo: {
    zonas: [],
    tiendas: [],
    mensajeros: [{ id: "m1", nombre: "Ana Mora", zonaId: null, estado: "activo" }],
    provincias: [],
    cantones: [],
    distritos: [],
  },
};

const TODOS_LOS_ROLES: readonly RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];

const PERMITIDOS: readonly string[] = ROLES_HISTORICO_CONVERSACIONES;
const DENEGADOS = TODOS_LOS_ROLES.filter((rol) => !PERMITIDOS.includes(rol));

beforeEach(() => {
  vi.clearAllMocks();
  catalogoModulo.fn.mockResolvedValue(CATALOGO_OK);
});

describe("R7 — la ruta del histórico responde notFound() a quien no está en la whitelist", () => {
  for (const rol of DENEGADOS) {
    it(`${rol}: lanza notFound() y NO consulta dato alguno`, async () => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const serviceSpy = vi.fn<() => Promise<ObtenerCatalogoFiltrosOrdenesResult>>();

      await expect(
        HistoricoConversacionesPage(undefined, { obtenerCatalogo: serviceSpy }),
      ).rejects.toThrow();

      expect(notFoundSpy).toHaveBeenCalled();
      expect(serviceSpy).not.toHaveBeenCalled();
      expect(catalogoModulo.fn).not.toHaveBeenCalled();
    });
  }

  it("sesión ausente: lanza notFound() y NO consulta dato alguno", async () => {
    resolveActorMock.mockResolvedValue(null);
    const serviceSpy = vi.fn<() => Promise<ObtenerCatalogoFiltrosOrdenesResult>>();

    await expect(
      HistoricoConversacionesPage(undefined, { obtenerCatalogo: serviceSpy }),
    ).rejects.toThrow();

    expect(notFoundSpy).toHaveBeenCalled();
    expect(serviceSpy).not.toHaveBeenCalled();
    expect(catalogoModulo.fn).not.toHaveBeenCalled();
  });
});

describe("R7 — los roles de la whitelist SÍ entran", () => {
  for (const rol of PERMITIDOS as readonly RolValue[]) {
    it(`${rol}: no lanza y sí carga el catálogo de la barra de filtros`, async () => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const serviceSpy = vi
        .fn<() => Promise<ObtenerCatalogoFiltrosOrdenesResult>>()
        .mockResolvedValue(CATALOGO_OK);

      await expect(
        HistoricoConversacionesPage(undefined, { obtenerCatalogo: serviceSpy }),
      ).resolves.toBeDefined();

      expect(notFoundSpy).not.toHaveBeenCalled();
      expect(serviceSpy).toHaveBeenCalledTimes(1);
    });
  }

  it("los DOS roles permitidos son exactamente los de la constante (nada de una lista aparte)", () => {
    expect([...PERMITIDOS].sort()).toEqual(["admin", "maestro"]);
  });
});
