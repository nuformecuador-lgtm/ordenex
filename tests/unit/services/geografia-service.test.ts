import { describe, it, expect, vi } from "vitest";

import { GeografiaService } from "@/lib/services/GeografiaService";
import type { IGeoRepository } from "@/lib/interfaces/repositories/IGeoRepository";
import type { Actor } from "@/lib/interfaces/services/IVehiculoService";
import type { ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

// FICHA 374 (R14/R17/R21/R22/R24) — la regla del servicio, con dobles.
//
// ⚠️ LO QUE ESTE ARCHIVO NO PUEDE AFIRMAR, y por eso vive en otro sitio: nada que dependa de un
// `WHERE`. En este repo esta medido cuatro veces que una mutacion del `WHERE` pasa en verde con
// dobles. Todo eso va a `tests/integration/db/**`. Aqui se mide la puerta de rol, el orden de las
// llamadas y la comparacion por forma normalizada, que son logica pura del servicio.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const OTROS_ROLES: Actor[] = [
  { usuarioId: "u-1", rol: "admin" },
  { usuarioId: "u-2", rol: "adminTienda" },
  { usuarioId: "u-3", rol: "adminSatelite" },
  { usuarioId: "u-4", rol: "mensajero" },
];

const ARBOL: ProvinciaArbolDTO[] = [
  {
    id: "p1",
    nombre: "Puntarenas",
    activo: true,
    cantones: [
      {
        id: "c1",
        nombre: "Buenos Aires",
        activo: false,
        distritos: [
          {
            id: "d1",
            nombre: "Cabagra",
            zonaId: null,
            zonaNombre: null,
            zonaEspecial: false,
            activo: true,
          },
        ],
      },
    ],
  },
];

function repoDoble(overrides: Partial<IGeoRepository> = {}) {
  const repo = {
    listProvinciasLite: vi.fn(async () => []),
    listCantonesLite: vi.fn(async () => []),
    listDistritosLite: vi.fn(async () => []),
    listGeografiaLitePorZona: vi.fn(async () => ({
      provincias: [],
      cantones: [],
      distritos: [],
    })),
    listArbol: vi.fn(async () => ARBOL),
    findHermanos: vi.fn(async () => [] as { id: string; nombre: string }[] | null),
    crear: vi.fn(async () => "id-nuevo"),
    cambiarActivacion: vi.fn(async () => "cambiado" as const),
    // FICHA 375
    findHermanosDeNodo: vi.fn(async () => [] as { id: string; nombre: string }[] | null),
    renombrar: vi.fn(async () => "renombrado" as const),
    ...overrides,
  };
  return repo as unknown as IGeoRepository & typeof repo;
}

function ordenesDoble(n = 0) {
  return { contarSinEntregarPorNodoGeografico: vi.fn(async () => n) };
}

function build(overrides: Partial<IGeoRepository> = {}, n = 0) {
  const repo = repoDoble(overrides);
  const ordenes = ordenesDoble(n);
  return { service: new GeografiaService(repo, ordenes), repo, ordenes };
}

// =================================================================================================
// R24 — la puerta de rol, ANTES de tocar la base
// =================================================================================================

describe("374/R24 — rol distinto de `maestro` -> forbidden SIN llamar al repositorio", () => {
  it.each(OTROS_ROLES)("listarArbol con rol $rol", async (actor) => {
    const { service, repo } = build();
    expect(await service.listarArbol(actor)).toEqual({ status: "forbidden" });
    expect(repo.listArbol).not.toHaveBeenCalled();
  });

  it.each(OTROS_ROLES)("crear con rol $rol", async (actor) => {
    const { service, repo } = build();
    const r = await service.crear({ nivel: "provincia", nombre: "Nueva" }, actor);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findHermanos).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it.each(OTROS_ROLES)("cambiarActivacion con rol $rol", async (actor) => {
    const { service, repo } = build();
    const r = await service.cambiarActivacion(
      { nivel: "distrito", id: "d1", activo: false },
      actor,
    );
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.cambiarActivacion).not.toHaveBeenCalled();
  });

  // FICHA 375 — la quinta operacion pasa por la MISMA puerta. Cinco cuerpos con la comprobacion
  // repetida serian cuatro sitios donde olvidarla; este caso es lo que lo impide.
  it.each(OTROS_ROLES)("renombrar con rol $rol", async (actor) => {
    const { service, repo } = build();
    const r = await service.renombrar({ nivel: "distrito", id: "d1", nombre: "Otro" }, actor);
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.findHermanosDeNodo).not.toHaveBeenCalled();
    expect(repo.renombrar).not.toHaveBeenCalled();
  });

  it.each(OTROS_ROLES)("contarOrdenesSinEntregar con rol $rol", async (actor) => {
    const { service, ordenes } = build();
    const r = await service.contarOrdenesSinEntregar({ nivel: "distrito", id: "d1" }, actor);
    expect(r).toEqual({ status: "forbidden" });
    expect(ordenes.contarSinEntregarPorNodoGeografico).not.toHaveBeenCalled();
  });

  it("CONTRAPRUEBA: `maestro` SI llega al repositorio en las cuatro", async () => {
    // Sin esto, los casos de arriba podrian estar verdes porque el doble nunca se llama.
    const { service, repo, ordenes } = build();
    await service.listarArbol(MAESTRO);
    await service.crear({ nivel: "provincia", nombre: "Nueva" }, MAESTRO);
    await service.cambiarActivacion({ nivel: "distrito", id: "d1", activo: false }, MAESTRO);
    await service.contarOrdenesSinEntregar({ nivel: "distrito", id: "d1" }, MAESTRO);
    expect(repo.listArbol).toHaveBeenCalledTimes(1);
    expect(repo.findHermanos).toHaveBeenCalledTimes(1);
    expect(repo.crear).toHaveBeenCalledTimes(1);
    expect(repo.cambiarActivacion).toHaveBeenCalledTimes(1);
    expect(ordenes.contarSinEntregarPorNodoGeografico).toHaveBeenCalledTimes(1);
  });
});

// =================================================================================================
// R14 — el padre que no existe
// =================================================================================================

describe("374/R14 — padre inexistente -> not_found y CERO filas creadas", () => {
  it("alta de canton con `provinciaId` inexistente", async () => {
    const { service, repo } = build({ findHermanos: vi.fn(async () => null) });
    const r = await service.crear(
      { nivel: "canton", nombre: "Buenos Aires", provinciaId: "no-existe" },
      MAESTRO,
    );
    expect(r).toEqual({ status: "not_found" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("alta de distrito con `cantonId` inexistente", async () => {
    const { service, repo } = build({ findHermanos: vi.fn(async () => null) });
    const r = await service.crear(
      { nivel: "distrito", nombre: "Cabagra", cantonId: "no-existe" },
      MAESTRO,
    );
    expect(r).toEqual({ status: "not_found" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("UNA sola consulta resuelve las DOS preguntas (padre y hermanos)", async () => {
    const { service, repo } = build();
    await service.crear({ nivel: "distrito", nombre: "Cabagra", cantonId: "c1" }, MAESTRO);
    expect(repo.findHermanos).toHaveBeenCalledTimes(1);
    expect(repo.findHermanos).toHaveBeenCalledWith("distrito", "c1");
  });
});

// =================================================================================================
// R17 — el duplicado se compara por la forma NORMALIZADA
// =================================================================================================

describe("374/R17 — `conflict` por forma normalizada, no por literal", () => {
  const HERMANOS = [{ id: "d-viejo", nombre: "San José" }];

  it.each(["san jose", "SAN JOSE", "San  José", "  san josé  ", "SaN jOsE"])(
    "«%s» choca con «San José» y NO crea fila",
    async (nombre) => {
      const { service, repo } = build({ findHermanos: vi.fn(async () => HERMANOS) });
      const r = await service.crear({ nivel: "distrito", nombre, cantonId: "c1" }, MAESTRO);
      expect(r).toEqual({ status: "conflict" });
      expect(repo.crear).not.toHaveBeenCalled();
    },
  );

  it("un hermano INACTIVO tambien ocupa el nombre", async () => {
    // `findHermanos` trae activos e inactivos a proposito: el UNIQUE de la base no distingue
    // estados, y reactivar el viejo despues chocaria con el nuevo.
    const { service, repo } = build({
      findHermanos: vi.fn(async () => [{ id: "d-retirado", nombre: "Cabagra" }]),
    });
    const r = await service.crear({ nivel: "distrito", nombre: "cabagra", cantonId: "c1" }, MAESTRO);
    expect(r).toEqual({ status: "conflict" });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("CONTRAPRUEBA: un nombre que NO choca entra, con su forma de guardar", async () => {
    const { service, repo } = build({ findHermanos: vi.fn(async () => HERMANOS) });
    const r = await service.crear(
      { nivel: "distrito", nombre: "Cabagra", cantonId: "c1" },
      MAESTRO,
    );
    expect(r).toEqual({ status: "ok", id: "id-nuevo", nivel: "distrito" });
    expect(repo.crear).toHaveBeenCalledWith("distrito", "Cabagra", "c1");
  });

  it("el nombre que se pasa al repositorio conserva mayusculas y acentos", async () => {
    const { service, repo } = build();
    await service.crear({ nivel: "provincia", nombre: "San José" }, MAESTRO);
    expect(repo.crear).toHaveBeenCalledWith("provincia", "San José", null);
  });
});

// =================================================================================================
// R21 / R22 — idempotencia y nodo inexistente
// =================================================================================================

describe("374/R21 — pedir el estado en el que ya esta devuelve ok", () => {
  it("el repositorio dice `sin_cambio` y el servicio responde `ok` con ese mismo estado", async () => {
    const { service } = build({ cambiarActivacion: vi.fn(async () => "sin_cambio" as const) });
    expect(
      await service.cambiarActivacion({ nivel: "distrito", id: "d1", activo: false }, MAESTRO),
    ).toEqual({ status: "ok", nivel: "distrito", id: "d1", activo: false });
    expect(
      await service.cambiarActivacion({ nivel: "canton", id: "c1", activo: true }, MAESTRO),
    ).toEqual({ status: "ok", nivel: "canton", id: "c1", activo: true });
  });

  it("`activo` viaja como estado DESEADO al repositorio, junto al actor", async () => {
    const { service, repo } = build();
    await service.cambiarActivacion({ nivel: "provincia", id: "p1", activo: false }, MAESTRO);
    expect(repo.cambiarActivacion).toHaveBeenCalledWith("provincia", "p1", false, "u-maestro");
  });
});

describe("374/R22 — nodo inexistente -> not_found", () => {
  it("el repositorio dice `no_existe` y el servicio traduce", async () => {
    const { service } = build({ cambiarActivacion: vi.fn(async () => "no_existe" as const) });
    expect(
      await service.cambiarActivacion({ nivel: "distrito", id: "fantasma", activo: true }, MAESTRO),
    ).toEqual({ status: "not_found" });
  });
});

// =================================================================================================
// R26 / R60 — lo que devuelve la lectura y el conteo
// =================================================================================================

describe("374/R26 — el arbol sale entero, sin recortar", () => {
  it("`maestro` recibe el arbol tal cual lo da el repositorio", async () => {
    const { service } = build();
    const r = await service.listarArbol(MAESTRO);
    expect(r).toEqual({ status: "ok", provincias: ARBOL });
    // El distrito ACTIVO bajo un canton INACTIVO viaja: si el servicio lo escondiera, no habria
    // forma de reactivarlo (R10).
    if (r.status !== "ok") throw new Error("el maestro no recibio el arbol");
    expect(r.provincias[0].cantones[0].activo).toBe(false);
    expect(r.provincias[0].cantones[0].distritos[0].activo).toBe(true);
  });
});

describe("374/R60 — el conteo pasa el nivel y el id, y devuelve el numero", () => {
  it("devuelve lo que dice el repositorio de ordenes", async () => {
    const { service, ordenes } = build({}, 40);
    expect(await service.contarOrdenesSinEntregar({ nivel: "distrito", id: "d1" }, MAESTRO)).toEqual(
      { status: "ok", ordenes: 40 },
    );
    expect(ordenes.contarSinEntregarPorNodoGeografico).toHaveBeenCalledWith("distrito", "d1");
  });

  it("cero es un resultado, no un fallo", async () => {
    const { service } = build({}, 0);
    expect(await service.contarOrdenesSinEntregar({ nivel: "canton", id: "c1" }, MAESTRO)).toEqual({
      status: "ok",
      ordenes: 0,
    });
  });
});

// =================================================================================================
// FICHA 375 — el renombrado: la regla de unicidad y el caso «guardar sin cambios»
// =================================================================================================
//
// ⚠️ LO QUE ESTE BLOQUE NO AFIRMA: que el `update` toque solo `nombre`, que el UNIQUE de la base
// rechace el homonimo literal ni que el registro vaya en la misma transaccion. Todo eso depende de
// un `WHERE` o del motor y vive en `tests/integration/db/geografia-renombrado.test.ts`. Aqui se
// mide la comparacion por forma NORMALIZADA y la exclusion del propio nodo, que son logica pura.

describe("375 — renombrar: el conflicto se decide por la clave NORMALIZADA", () => {
  const HERMANOS = [
    { id: "d1", nombre: "Cabagra" },
    { id: "d2", nombre: "Pérez Zeledón" },
  ];

  it.each([
    ["perez zeledon", "sin acentos ni mayusculas"],
    ["PÉREZ ZELEDÓN", "en mayusculas"],
    ["Pérez   Zeledón", "con espacios de sobra"],
    ["Perez Zeledon", "sin acentos"],
  ])("«%s» (%s) choca con el hermano y devuelve conflict", async (nombre) => {
    const { service, repo } = build({
      findHermanosDeNodo: vi.fn(async () => HERMANOS),
    });
    expect(await service.renombrar({ nivel: "distrito", id: "d1", nombre }, MAESTRO)).toEqual({
      status: "conflict",
    });
    // Y NO se intenta escribir: el UNIQUE de la base es la ultima palabra, no la primera. Ademas
    // ese UNIQUE compara LITERALES, asi que «Perez Zeledon» le pasaria por delante.
    expect(repo.renombrar).not.toHaveBeenCalled();
  });

  it("⭑ renombrarlo a SU PROPIO nombre NO es conflicto: guardar sin cambios funciona", async () => {
    const { service, repo } = build({ findHermanosDeNodo: vi.fn(async () => HERMANOS) });
    const r = await service.renombrar({ nivel: "distrito", id: "d1", nombre: "Cabagra" }, MAESTRO);
    expect(r).toEqual({ status: "ok", nivel: "distrito", id: "d1", nombre: "Cabagra" });
    expect(repo.renombrar).toHaveBeenCalledWith("distrito", "d1", "Cabagra", "u-maestro");
  });

  it("⭑ ni una variante que se normaliza IGUAL que el suyo: «cabagra» -> `ok`", async () => {
    // Es un cambio REAL de la etiqueta (cambian las mayusculas) y no choca con nadie mas.
    const { service, repo } = build({ findHermanosDeNodo: vi.fn(async () => HERMANOS) });
    const r = await service.renombrar({ nivel: "distrito", id: "d1", nombre: "cabagra" }, MAESTRO);
    expect(r).toEqual({ status: "ok", nivel: "distrito", id: "d1", nombre: "cabagra" });
    expect(repo.renombrar).toHaveBeenCalledWith("distrito", "d1", "cabagra", "u-maestro");
  });

  it("un nombre libre entre los hermanos pasa", async () => {
    const { service, repo } = build({ findHermanosDeNodo: vi.fn(async () => HERMANOS) });
    expect(
      await service.renombrar({ nivel: "distrito", id: "d1", nombre: "Cabagrita" }, MAESTRO),
    ).toEqual({ status: "ok", nivel: "distrito", id: "d1", nombre: "Cabagrita" });
    expect(repo.renombrar).toHaveBeenCalledTimes(1);
  });

  it("un hermano INACTIVO tambien produce conflicto: el nombre sigue ocupado", async () => {
    // El repositorio devuelve activos e inactivos; el servicio no distingue, y no debe: el UNIQUE
    // de la base tampoco lo hace, y reactivar el viejo despues chocaria con el nuevo.
    const { service } = build({
      findHermanosDeNodo: vi.fn(async () => [
        { id: "d1", nombre: "Cabagra" },
        { id: "d9", nombre: "Boruca" }, // retirado, pero sigue en la lista
      ]),
    });
    expect(
      await service.renombrar({ nivel: "distrito", id: "d1", nombre: "boruca" }, MAESTRO),
    ).toEqual({ status: "conflict" });
  });
});

describe("375 — renombrar: el nodo que no existe", () => {
  it("`null` del repositorio -> not_found, y NO se escribe nada", async () => {
    const { service, repo } = build({ findHermanosDeNodo: vi.fn(async () => null) });
    expect(
      await service.renombrar({ nivel: "distrito", id: "fantasma", nombre: "Otro" }, MAESTRO),
    ).toEqual({ status: "not_found" });
    expect(repo.renombrar).not.toHaveBeenCalled();
  });

  it("una carrera (existia al leer, ya no al escribir) tambien acaba en not_found", async () => {
    const { service } = build({
      findHermanosDeNodo: vi.fn(async () => [{ id: "d1", nombre: "Cabagra" }]),
      renombrar: vi.fn(async () => "no_existe" as const),
    });
    expect(
      await service.renombrar({ nivel: "distrito", id: "d1", nombre: "Cabagrita" }, MAESTRO),
    ).toEqual({ status: "not_found" });
  });

  it("`sin_cambio` del repositorio se cuenta como ok: pedir lo que ya esta es exito", async () => {
    const { service } = build({
      findHermanosDeNodo: vi.fn(async () => [{ id: "d1", nombre: "Cabagra" }]),
      renombrar: vi.fn(async () => "sin_cambio" as const),
    });
    expect(
      await service.renombrar({ nivel: "distrito", id: "d1", nombre: "Cabagra" }, MAESTRO),
    ).toEqual({ status: "ok", nivel: "distrito", id: "d1", nombre: "Cabagra" });
  });
});
