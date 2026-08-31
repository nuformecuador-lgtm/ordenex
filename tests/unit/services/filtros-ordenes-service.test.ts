import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { FiltrosOrdenesService } from "@/lib/services/FiltrosOrdenesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MensajeroFiltroDTO } from "@/lib/types/filtros-ordenes";

// Feature 144/B2 (R47/R52/R53) — catalogo de filtros de `/ordenes`, sin DB.

const ZONAS = [{ id: "z1", nombre: "GAM" }];
const TIENDAS = [{ id: "t1", nombre: "Tienda", esApiKey: false, activa: true }];
const MENSAJEROS: MensajeroFiltroDTO[] = [
  { id: "m1", nombre: "Ana Mora", zonaId: "z1", estado: "activo" },
];
/** Los mensajeros de UNA zona: otro conjunto, no un subconjunto del de arriba. */
const MENSAJEROS_ZONA: MensajeroFiltroDTO[] = [
  { id: "m9", nombre: "Beto Ruiz", zonaId: "z-satelite", estado: "activo" },
];
const PROVINCIAS = [{ id: "p1", nombre: "San Jose" }];
const CANTONES = [{ id: "c1", nombre: "Central", padreId: "p1" }];
const DISTRITOS = [{ id: "d1", nombre: "Carmen", padreId: "c1" }];

/** La cadena geografica de UNA zona: otro conjunto, no un subconjunto del de arriba. */
const GEO_ZONA = {
  provincias: [{ id: "p9", nombre: "Limon" }],
  cantones: [{ id: "c9", nombre: "Pococi", padreId: "p9" }],
  distritos: [{ id: "d9", nombre: "Guapiles", padreId: "c9" }],
};

function actor(rol: string, zonaId?: string | null): Actor {
  return { usuarioId: "u1", rol: rol as RolValue, zonaId };
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
  const userRepo = {
    listCuentasTienda: lectura("tiendas", TIENDAS),
    // El doble devuelve un conjunto DISTINTO segun se pida acotado o no, para que el test
    // pueda distinguir "acotado a la zona" de "todos" sin mirar el argumento a mano.
    listMensajerosParaFiltro: vi.fn(async (zonaId?: string) => {
      orden.push("mensajeros");
      return zonaId === undefined ? MENSAJEROS : MENSAJEROS_ZONA;
    }),
  };
  const geoRepo = {
    listProvinciasLite: lectura("provincias", PROVINCIAS),
    listCantonesLite: lectura("cantones", CANTONES),
    listDistritosLite: lectura("distritos", DISTRITOS),
    listGeografiaLitePorZona: lectura("geo-zona", GEO_ZONA),
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
    expect(userRepo.listMensajerosParaFiltro).not.toHaveBeenCalled();
    expect(geoRepo.listProvinciasLite).not.toHaveBeenCalled();
    expect(geoRepo.listCantonesLite).not.toHaveBeenCalled();
    expect(geoRepo.listDistritosLite).not.toHaveBeenCalled();
  });

  for (const rol of ["mensajero", "apiKey", "invitado"]) {
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

describe("acotamiento por rol del propio catalogo", () => {
  it("adminTienda: la lista de cuentas tienda va VACIA y su lectura ni se dispara", async () => {
    const { service, userRepo } = buildService();
    const r = await service.obtenerCatalogo(actor("adminTienda"));
    if (r.status !== "ok") throw new Error("esperaba ok");
    // No es que el control no se declare (eso lo hace la barra): es que el dato no viaja.
    expect(r.catalogo.tiendas).toEqual([]);
    expect(userRepo.listCuentasTienda).not.toHaveBeenCalled();
    // El directorio de MENSAJEROS cae con el mismo criterio: es personal interno, no un
    // dato que se le entregue a la cuenta tienda.
    expect(r.catalogo.mensajeros).toEqual([]);
    expect(userRepo.listMensajerosParaFiltro).not.toHaveBeenCalled();
    // Lo demas lo sigue recibiendo entero: su alcance es su tienda, no una zona.
    expect(r.catalogo.zonas).toEqual(ZONAS);
    expect(r.catalogo.cantones).toEqual(CANTONES);
  });

  it("adminSatelite: sin zonas, sin tiendas y con la geografia de SU zona", async () => {
    const { service, zonaRepo, userRepo, geoRepo } = buildService();
    const r = await service.obtenerCatalogo(actor("adminSatelite", "z-satelite"));
    expect(r).toEqual({
      status: "ok",
      catalogo: {
        zonas: [],
        tiendas: [],
        mensajeros: MENSAJEROS_ZONA,
        ...GEO_ZONA,
      },
    });
    // La zona sale del actor, y el catalogo del pais no se lee siquiera.
    expect(geoRepo.listGeografiaLitePorZona).toHaveBeenCalledWith("z-satelite");
    // Los mensajeros van acotados a ESA zona, no a todos.
    expect(userRepo.listMensajerosParaFiltro).toHaveBeenCalledWith("z-satelite");
    expect(geoRepo.listProvinciasLite).not.toHaveBeenCalled();
    expect(geoRepo.listCantonesLite).not.toHaveBeenCalled();
    expect(geoRepo.listDistritosLite).not.toHaveBeenCalled();
    expect(zonaRepo.listLite).not.toHaveBeenCalled();
    expect(userRepo.listCuentasTienda).not.toHaveBeenCalled();
  });

  it("adminSatelite SIN zona: catalogo vacio y ninguna lectura", async () => {
    const { service, geoRepo } = buildService();
    const r = await service.obtenerCatalogo(actor("adminSatelite", null));
    expect(r).toEqual({
      status: "ok",
      catalogo: {
        zonas: [],
        tiendas: [],
        mensajeros: [],
        provincias: [],
        cantones: [],
        distritos: [],
      },
    });
    expect(geoRepo.listGeografiaLitePorZona).not.toHaveBeenCalled();
  });
});

describe("resolucion del catalogo (R47/R48)", () => {
  it("R47: las lecturas se disparan EN PARALELO (todas invocadas antes de resolver la primera)", async () => {
    // La primera lectura resuelve tras 5 ticks; si el service fuese secuencial, las
    // restantes no estarian invocadas todavia al terminar ese microtask.
    const { service, orden, zonaRepo, userRepo, geoRepo } = buildService({ zonas: 5 });
    const promesa = service.obtenerCatalogo(actor("admin"));
    // Un solo tick: suficiente para que `Promise.all` las haya invocado todas.
    await Promise.resolve();
    expect(orden).toEqual([
      "zonas",
      "tiendas",
      "mensajeros",
      "provincias",
      "cantones",
      "distritos",
    ]);
    expect(zonaRepo.listLite).toHaveBeenCalledTimes(1);
    expect(userRepo.listCuentasTienda).toHaveBeenCalledTimes(1);
    expect(userRepo.listMensajerosParaFiltro).toHaveBeenCalledTimes(1);
    expect(geoRepo.listProvinciasLite).toHaveBeenCalledTimes(1);
    expect(geoRepo.listCantonesLite).toHaveBeenCalledTimes(1);
    expect(geoRepo.listDistritosLite).toHaveBeenCalledTimes(1);
    await promesa;
  });

  it("R47/R48: entrega todas las colecciones en una sola respuesta", async () => {
    const { service } = buildService();
    const r = await service.obtenerCatalogo(actor("maestro"));
    expect(r).toEqual({
      status: "ok",
      catalogo: {
        zonas: ZONAS,
        tiendas: TIENDAS,
        mensajeros: MENSAJEROS,
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

  it("maestro/admin reciben TODOS los mensajeros, sin acotar por zona", async () => {
    const { service, userRepo } = buildService();
    const r = await service.obtenerCatalogo(actor("maestro"));
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.catalogo.mensajeros).toEqual(MENSAJEROS);
    // Sin argumento = sin acotamiento: es lo que distingue "todos" de "los de su zona".
    expect(userRepo.listMensajerosParaFiltro).toHaveBeenCalledWith();
  });

  it("R64: si una lectura falla, el service PROPAGA el error (la page decide el fallback)", async () => {
    const { service, geoRepo } = buildService();
    geoRepo.listDistritosLite.mockRejectedValue(new Error("db caida"));
    await expect(service.obtenerCatalogo(actor("admin"))).rejects.toThrow("db caida");
  });
});
