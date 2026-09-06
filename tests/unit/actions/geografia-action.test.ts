import { describe, it, expect, vi } from "vitest";

import {
  cambiarActivacionGeografica,
  contarOrdenesSinEntregarDeNodo,
  crearNodoGeografico,
  listarArbolGeografico,
  renombrarNodoGeografico,
} from "@/lib/actions/geografia";
import type { IGeografiaService } from "@/lib/interfaces/services/IGeografiaService";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";

// FICHA 374 (R18/R23/R25) — EL BORDE: sesion, validacion y traduccion del UNIQUE.
//
// LO QUE ESTE ARCHIVO EXISTE PARA FIJAR, y que ningun test de servicio puede: que sin sesion NO SE
// INSTANCIA EL SERVICIO —o sea, que no se toca la base— y que una entrada invalida muere ANTES de
// llegar al servicio. Las dos son propiedades del ORDEN de las sentencias, y se miden con espias.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

function serviceDoble(overrides: Partial<IGeografiaService> = {}) {
  return {
    listarArbol: vi.fn(async () => ({ status: "ok" as const, provincias: [] })),
    crear: vi.fn(async () => ({ status: "ok" as const, id: "n1", nivel: "provincia" as const })),
    cambiarActivacion: vi.fn(async () => ({
      status: "ok" as const,
      nivel: "distrito" as const,
      id: "d1",
      activo: false,
    })),
    contarOrdenesSinEntregar: vi.fn(async () => ({ status: "ok" as const, ordenes: 3 })),
    // FICHA 375
    renombrar: vi.fn(async () => ({
      status: "ok" as const,
      nivel: "distrito" as const,
      id: "d1",
      nombre: "Cabagrita",
    })),
    ...overrides,
  } as unknown as IGeografiaService & {
    listarArbol: ReturnType<typeof vi.fn>;
    crear: ReturnType<typeof vi.fn>;
    cambiarActivacion: ReturnType<typeof vi.fn>;
    contarOrdenesSinEntregar: ReturnType<typeof vi.fn>;
    renombrar: ReturnType<typeof vi.fn>;
  };
}

const sinSesion = async () => null;
const conSesion = async () => MAESTRO;

// =================================================================================================
// R23 — sin sesion, las CUATRO acciones responden `unauthenticated` sin tocar el servicio
// =================================================================================================

describe("374/R23 — sin sesion -> unauthenticated, sin instanciar el service", () => {
  it("listarArbolGeografico", async () => {
    const service = serviceDoble();
    const r = await listarArbolGeografico({ getActor: sinSesion, geografiaService: service });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.listarArbol).not.toHaveBeenCalled();
  });

  it("crearNodoGeografico", async () => {
    const service = serviceDoble();
    const r = await crearNodoGeografico(
      { nivel: "provincia", nombre: "Puntarenas" },
      { getActor: sinSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("cambiarActivacionGeografica", async () => {
    const service = serviceDoble();
    const r = await cambiarActivacionGeografica(
      { nivel: "distrito", id: "d1", activo: false },
      { getActor: sinSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.cambiarActivacion).not.toHaveBeenCalled();
  });

  it("renombrarNodoGeografico (ficha 375)", async () => {
    const service = serviceDoble();
    const r = await renombrarNodoGeografico(
      { nivel: "distrito", id: "d1", nombre: "Cabagrita" },
      { getActor: sinSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.renombrar).not.toHaveBeenCalled();
  });

  it("contarOrdenesSinEntregarDeNodo", async () => {
    const service = serviceDoble();
    const r = await contarOrdenesSinEntregarDeNodo(
      { nivel: "distrito", id: "d1" },
      { getActor: sinSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.contarOrdenesSinEntregar).not.toHaveBeenCalled();
  });

  it("⚠️ la comprobacion de sesion va ANTES de la validacion: entrada BASURA sin sesion sigue siendo `unauthenticated`", () => {
    // Si el orden se invirtiera, una peticion sin sesion recibiria un `validation_error` que le
    // cuenta al anonimo como esta hecho el borde.
    return expect(
      crearNodoGeografico({ basura: true }, { getActor: sinSesion, geografiaService: serviceDoble() }),
    ).resolves.toEqual({ status: "unauthenticated" });
  });
});

// =================================================================================================
// R25 — la validacion muere en el borde, sin llamar al servicio
// =================================================================================================

describe("374/R25 — entrada invalida -> validation_error sin llamar al service", () => {
  it("nivel desconocido", async () => {
    const service = serviceDoble();
    const r = await crearNodoGeografico(
      { nivel: "region", nombre: "Chorotega" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("padre ausente en un alta de canton", async () => {
    const service = serviceDoble();
    const r = await crearNodoGeografico(
      { nivel: "canton", nombre: "Buenos Aires" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("nombre demasiado corto", async () => {
    const service = serviceDoble();
    const r = await crearNodoGeografico(
      { nivel: "provincia", nombre: "a" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("clave desconocida", async () => {
    const service = serviceDoble();
    const r = await crearNodoGeografico(
      { nivel: "provincia", nombre: "Puntarenas", cantonId: "c1" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r.status).toBe("validation_error");
    expect(service.crear).not.toHaveBeenCalled();
  });

  it("activacion: falta `activo`", async () => {
    const service = serviceDoble();
    const r = await cambiarActivacionGeografica(
      { nivel: "distrito", id: "d1" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r.status).toBe("validation_error");
    expect(service.cambiarActivacion).not.toHaveBeenCalled();
  });

  it("conteo: id vacio", async () => {
    const service = serviceDoble();
    const r = await contarOrdenesSinEntregarDeNodo(
      { nivel: "canton", id: "" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r.status).toBe("validation_error");
    expect(service.contarOrdenesSinEntregar).not.toHaveBeenCalled();
  });

  it("el `validation_error` trae los errores POR CAMPO, no una cadena suelta", async () => {
    const r = await crearNodoGeografico(
      { nivel: "provincia", nombre: "a" },
      { getActor: conSesion, geografiaService: serviceDoble() },
    );
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("no fue validation_error");
    expect(Object.keys(r.fieldErrors)).toContain("nombre");
  });
});

// =================================================================================================
// Delegacion en el caso feliz
// =================================================================================================

describe("374 — el borde delega en el service con la entrada ya normalizada", () => {
  it("crear: pasa el nombre RECORTADO y el actor", async () => {
    const service = serviceDoble();
    const r = await crearNodoGeografico(
      { nivel: "distrito", nombre: "  Cabagra  ", cantonId: "c1" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "ok", id: "n1", nivel: "provincia" });
    expect(service.crear).toHaveBeenCalledWith(
      { nivel: "distrito", nombre: "Cabagra", cantonId: "c1" },
      MAESTRO,
    );
  });

  it("activacion y conteo delegan tal cual", async () => {
    const service = serviceDoble();
    await cambiarActivacionGeografica(
      { nivel: "canton", id: "c1", activo: true },
      { getActor: conSesion, geografiaService: service },
    );
    expect(service.cambiarActivacion).toHaveBeenCalledWith(
      { nivel: "canton", id: "c1", activo: true },
      MAESTRO,
    );

    const r = await contarOrdenesSinEntregarDeNodo(
      { nivel: "canton", id: "c1" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "ok", ordenes: 3 });
  });

  it("listarArbolGeografico CONSERVA su firma: se puede llamar sin argumentos", () => {
    // Lo llaman `configuracion/tarifas/page.tsx` y `ZonasTarifasModule.tsx` sin argumentos. Que
    // siga compilando y ejecutandose asi es la mitad que un refactor rompe en silencio.
    expect(listarArbolGeografico.length).toBe(0);
  });
});

// =================================================================================================
// R18 — el UNIQUE de la base es la ultima palabra
// =================================================================================================

describe("374/R18 — el borde traduce la violacion de UNIQUE a `conflict`", () => {
  it("si el service LANZA, la accion devuelve conflict y no propaga el error crudo", async () => {
    // Es la carrera: dos altas simultaneas que pasan la comprobacion del service y la base rechaza
    // la segunda. Sin este `catch`, el usuario recibiria un error de Postgres.
    const service = serviceDoble({
      crear: vi.fn(async () => {
        throw new Error(
          'Unique constraint failed on the fields: (`canton_id`,`nombre`)',
        );
      }),
    });
    const r = await crearNodoGeografico(
      { nivel: "distrito", nombre: "Cabagra", cantonId: "c1" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "conflict" });
  });

  it("el `catch` NO envuelve a la activacion: ahi un fallo no es un conflicto", async () => {
    // Deliberado: `cambiarActivacion` no tiene UNIQUE que violar, asi que tragarse un error ahi
    // convertiria un fallo real en un «ok» silencioso.
    const service = serviceDoble({
      cambiarActivacion: vi.fn(async () => {
        throw new Error("la base se cayo");
      }),
    });
    await expect(
      cambiarActivacionGeografica(
        { nivel: "distrito", id: "d1", activo: false },
        { getActor: conSesion, geografiaService: service },
      ),
    ).rejects.toThrow("la base se cayo");
  });
});

// =================================================================================================
// FICHA 375 — el borde del renombrado
// =================================================================================================

describe("375 — el borde del renombrado: validacion y traduccion del UNIQUE", () => {
  it.each([
    ["nivel desconocido", { nivel: "region", id: "d1", nombre: "Cabagrita" }],
    ["sin id", { nivel: "distrito", nombre: "Cabagrita" }],
    ["id vacio", { nivel: "distrito", id: "", nombre: "Cabagrita" }],
    ["sin nombre", { nivel: "distrito", id: "d1" }],
    ["nombre vacio", { nivel: "distrito", id: "d1", nombre: "" }],
    ["nombre de un caracter", { nivel: "distrito", id: "d1", nombre: "A" }],
    ["nombre de solo espacios", { nivel: "distrito", id: "d1", nombre: "   " }],
    ["clave desconocida", { nivel: "distrito", id: "d1", nombre: "Cabagrita", codigoDta: "1" }],
  ])("%s -> validation_error SIN llegar al service", async (_caso, entrada) => {
    const service = serviceDoble();
    const r = await renombrarNodoGeografico(entrada, {
      getActor: conSesion,
      geografiaService: service,
    });
    expect(r.status).toBe("validation_error");
    expect(service.renombrar).not.toHaveBeenCalled();
  });

  it("⭑ el nombre llega al service RECORTADO y con los espacios colapsados", async () => {
    // Mismo contrato que el alta: se persiste «San José», no «  San   José  ».
    const service = serviceDoble();
    await renombrarNodoGeografico(
      { nivel: "distrito", id: "d1", nombre: "  San   José  " },
      { getActor: conSesion, geografiaService: service },
    );
    expect(service.renombrar).toHaveBeenCalledWith(
      { nivel: "distrito", id: "d1", nombre: "San José" },
      MAESTRO,
    );
  });

  it("una violacion de UNIQUE que escape del service se traduce a `conflict`", async () => {
    const service = serviceDoble({
      renombrar: vi.fn(async () => {
        throw new Error("Unique constraint failed on the fields: (`canton_id`,`nombre`)");
      }),
    });
    const r = await renombrarNodoGeografico(
      { nivel: "distrito", id: "d1", nombre: "Boruca" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "conflict" });
  });

  it("una entrada valida devuelve lo que devuelve el service", async () => {
    const service = serviceDoble();
    const r = await renombrarNodoGeografico(
      { nivel: "distrito", id: "d1", nombre: "Cabagrita" },
      { getActor: conSesion, geografiaService: service },
    );
    expect(r).toEqual({ status: "ok", nivel: "distrito", id: "d1", nombre: "Cabagrita" });
  });
});
