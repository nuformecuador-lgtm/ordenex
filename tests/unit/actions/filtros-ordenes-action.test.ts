import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { obtenerCatalogoFiltrosOrdenes } from "@/lib/actions/filtros-ordenes";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IFiltrosOrdenesService } from "@/lib/interfaces/services/IFiltrosOrdenesService";
import type { CatalogoFiltrosOrdenesDTO } from "@/lib/types/filtros-ordenes";

// Feature 144/B2 (R47/R52/R53) — punto de entrada que consume el Server Component de
// `/ordenes`. Resuelve el actor server-side y delega en el service; no decide nada mas.

const CATALOGO: CatalogoFiltrosOrdenesDTO = {
  zonas: [{ id: "z1", nombre: "GAM" }],
  tiendas: [{ id: "t1", nombre: "Tienda", esApiKey: false, activa: true }],
  provincias: [{ id: "p1", nombre: "San Jose" }],
  cantones: [{ id: "c1", nombre: "Central", padreId: "p1" }],
  distritos: [{ id: "d1", nombre: "Carmen", padreId: "c1" }],
};

function fakeService(resultado: unknown): IFiltrosOrdenesService {
  return { obtenerCatalogo: vi.fn().mockResolvedValue(resultado) };
}

const ADMIN: Actor = { usuarioId: "a1", rol: "admin" as RolValue };

describe("obtenerCatalogoFiltrosOrdenes (R47/R52/R53)", () => {
  it("R47: devuelve el catalogo del service tal cual, en UNA sola llamada", async () => {
    const filtrosOrdenesService = fakeService({ status: "ok", catalogo: CATALOGO });
    const r = await obtenerCatalogoFiltrosOrdenes({
      filtrosOrdenesService,
      getActor: async () => ADMIN,
    });
    expect(r).toEqual({ status: "ok", catalogo: CATALOGO });
    expect(filtrosOrdenesService.obtenerCatalogo).toHaveBeenCalledTimes(1);
    expect(filtrosOrdenesService.obtenerCatalogo).toHaveBeenCalledWith(ADMIN);
  });

  it("R52: sin sesion, el actor `null` llega al service y devuelve `unauthenticated`", async () => {
    const filtrosOrdenesService = fakeService({ status: "unauthenticated" });
    const r = await obtenerCatalogoFiltrosOrdenes({
      filtrosOrdenesService,
      getActor: async () => null,
    });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(filtrosOrdenesService.obtenerCatalogo).toHaveBeenCalledWith(null);
  });

  it("R53: un rol ajeno al listado obtiene `forbidden` sin datos", async () => {
    const filtrosOrdenesService = fakeService({ status: "forbidden" });
    const r = await obtenerCatalogoFiltrosOrdenes({
      filtrosOrdenesService,
      getActor: async () => ({ usuarioId: "m1", rol: "mensajero" as RolValue }),
    });
    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("catalogo");
  });
});
