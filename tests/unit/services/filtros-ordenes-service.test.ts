import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { FiltrosOrdenesService } from "@/lib/services/FiltrosOrdenesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 144/B2 (R47/R52/R53) — catalogo de filtros de `/ordenes`, sin DB.

const ZONAS = [{ id: "z1", nombre: "GAM" }];
const TIENDAS = [{ id: "t1", nombre: "Tienda", esApiKey: false, activa: true }];
const PROVINCIAS = [{ id: "p1", nombre: "San Jose" }];
const CANTONES = [{ id: "c1", nombre: "Central", padreId: "p1" }];
const DISTRITOS = [{ id: "d1", nombre: "Carmen", padreId: "c1" }];

function actor(rol: string): Actor {
  return { usuarioId: "u1", rol: rol as RolValue };
}

function buildService(demoras: Partial<Record<string, number>> = {}) {
  const orden: string[] = [];
  /** Cada doble registra CUANDO se invoca y resuelve tras `demora` ticks. */
  function lectura<T>(nombre: string, valor: T) {
    return vi.fn(async () => {
      orden.push(nombre);
      const ticks = demoras[nombre] ?? 0;
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      return valor;
    });
  }
  const zonaRepo = { listLite: lectura("zonas", ZONAS) };
  const userRepo = { listCuentasTienda: lectura("tiendas", TIENDAS) };
  const geoRepo = {
    listProvinciasLite: lectura("provincias", PROVINCIAS),
    listCantonesLite: lectura("cantones", CANTONES),
    listDistritosLite: lectura("distritos", DISTRITOS),
  };
  return {
    service: new FiltrosOrdenesService(zonaRepo, userRepo, geoRepo),
    zonaRepo,
    userRepo,
    geoRepo,
    orden,
  };
}

describe("autorizacion (R52/R53)", () => {
  it("R52: sin sesion -> `unauthenticated` y NINGUNA lectura se dispara", async () => {
    const { service, zonaRepo, userRepo, geoRepo } = buildService();
    const r = await service.obtenerCatalogo(null);
    expect(r).toEqual({ status: "unauthenticated" });
    expect(zonaRepo.listLite).not.toHaveBeenCalled();
    expect(userRepo.listCuentasTienda).not.toHaveBeenCalled();
    expect(geoRepo.listProvinciasLite).not.toHaveBeenCalled();
    expect(geoRepo.listCantonesLite).not.toHaveBeenCalled();
    expect(geoRepo.listDistritosLite).not.toHaveBeenCalled();
  });

  for (const rol of ["mensajero", "adminSatelite", "apiKey", "invitado"]) {
    it(`R53: rol \`${rol}\` -> \`forbidden\` sin datos`, async () => {
      const { service, zonaRepo, geoRepo } = buildService();
      const r = await service.obtenerCatalogo(actor(rol));
      expect(r).toEqual({ status: "forbidden" });
      expect(zonaRepo.listLite).not.toHaveBeenCalled();
      expect(geoRepo.listDistritosLite).not.toHaveBeenCalled();
    });
  }

  for (const rol of ["maestro", "admin", "adminTienda"]) {
    it(`R53: rol \`${rol}\` (opera el listado) -> \`ok\` con el catalogo`, async () => {
      const { service } = buildService();
      const r = await service.obtenerCatalogo(actor(rol));
      expect(r.status).toBe("ok");
    });
  }
});

describe("resolucion del catalogo (R47/R48)", () => {
  it("R47: las CINCO lecturas se disparan EN PARALELO (todas invocadas antes de resolver la primera)", async () => {
    // La primera lectura resuelve tras 5 ticks; si el service fuese secuencial, las
    // cuatro restantes no estarian invocadas todavia al terminar ese microtask.
    const { service, orden, zonaRepo, userRepo, geoRepo } = buildService({ zonas: 5 });
    const promesa = service.obtenerCatalogo(actor("admin"));
    // Un solo tick: suficiente para que `Promise.all` haya invocado las cinco.
    await Promise.resolve();
    expect(orden).toEqual(["zonas", "tiendas", "provincias", "cantones", "distritos"]);
    expect(zonaRepo.listLite).toHaveBeenCalledTimes(1);
    expect(userRepo.listCuentasTienda).toHaveBeenCalledTimes(1);
    expect(geoRepo.listProvinciasLite).toHaveBeenCalledTimes(1);
    expect(geoRepo.listCantonesLite).toHaveBeenCalledTimes(1);
    expect(geoRepo.listDistritosLite).toHaveBeenCalledTimes(1);
    await promesa;
  });

  it("R47/R48: entrega las cinco colecciones en una sola respuesta", async () => {
    const { service } = buildService();
    const r = await service.obtenerCatalogo(actor("maestro"));
    expect(r).toEqual({
      status: "ok",
      catalogo: {
        zonas: ZONAS,
        tiendas: TIENDAS,
        provincias: PROVINCIAS,
        cantones: CANTONES,
        distritos: DISTRITOS,
      },
    });
  });

  it("R48: cantones y distritos llegan con su padre resoluble sin mas datos", async () => {
    const { service } = buildService();
    const r = await service.obtenerCatalogo(actor("admin"));
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.catalogo.cantones.every((c) => typeof c.padreId === "string")).toBe(true);
    expect(r.catalogo.distritos.every((d) => typeof d.padreId === "string")).toBe(true);
    // El padre de cada canton existe entre las provincias entregadas.
    const provIds = new Set(r.catalogo.provincias.map((p) => p.id));
    expect(r.catalogo.cantones.every((c) => provIds.has(c.padreId))).toBe(true);
  });

  it("R54: las cuentas tienda no arrastran PII (solo id, nombre y dos banderas)", async () => {
    const { service } = buildService();
    const r = await service.obtenerCatalogo(actor("admin"));
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(Object.keys(r.catalogo.tiendas[0]).sort()).toEqual([
      "activa",
      "esApiKey",
      "id",
      "nombre",
    ]);
  });

  it("R64: si una lectura falla, el service PROPAGA el error (la page decide el fallback)", async () => {
    const { service, geoRepo } = buildService();
    geoRepo.listDistritosLite.mockRejectedValue(new Error("db caida"));
    await expect(service.obtenerCatalogo(actor("admin"))).rejects.toThrow("db caida");
  });
});
