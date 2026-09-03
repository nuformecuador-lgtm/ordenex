import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RolValue } from "@prisma/client";

import HistorialAccionesPage from "@/app/(app)/historico/acciones/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { ROLES_HISTORIAL_ACCIONES } from "@/lib/auth/menu-visibility";
import type { CatalogoActoresHistorialResult } from "@/lib/types/historial-accion";

/**
 * FICHA 362 / T5.1 (R18/R19) — EL GATE DE LA RUTA.
 *
 * El subítem de menú sólo decide qué se MUESTRA; la defensa real es este `notFound()`. Y no
 * basta con que responda 404: R18 exige que responda **antes de la primera lectura**, así que
 * cada caso denegado afirma además que el doble del cargador **no fue invocado ni una vez**.
 *
 * ⚠️ EL CASO QUE PIDIÓ EL HUMANO: el `admin` NO puede abrir esta ruta. Está aquí dentro por
 * construcción —`DENEGADOS` se deriva de la constante, así que si alguien le devolviera el
 * acceso al `admin` el rol saldría de esta lista y el caso desaparecería—, y por eso hay
 * además un caso NOMINAL para él más abajo, que no depende de ninguna derivación.
 */

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// El único cargador de datos que la página importa. Se mockea el MÓDULO para que un descuido
// futuro (llamarlo por la vía directa en vez de por `deps`) tampoco arrastre Prisma ni
// `next/headers` a este test — y para que el doble por `deps` no sea la única red.
const catalogoModulo = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/actions/historial-acciones", () => ({
  obtenerCatalogoActoresHistorial: catalogoModulo.fn,
  listarHistorialAccionesPaginado: vi.fn(),
  listarHistorialAccionesCompleto: vi.fn(),
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

const CATALOGO_OK: CatalogoActoresHistorialResult = {
  status: "ok",
  actores: [{ id: "u1", nombre: "Ana Mora" }],
};

const TODOS_LOS_ROLES: readonly RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];

const PERMITIDOS: readonly string[] = ROLES_HISTORIAL_ACCIONES;
const DENEGADOS = TODOS_LOS_ROLES.filter((rol) => !PERMITIDOS.includes(rol));

beforeEach(() => {
  vi.clearAllMocks();
  catalogoModulo.fn.mockResolvedValue(CATALOGO_OK);
});

describe("R18 — la ruta del historial responde notFound() a quien no está en la whitelist", () => {
  it("los denegados son cinco de los seis roles: sólo el maestro entra", () => {
    // Anti-vacuidad: si `DENEGADOS` quedara vacío por un error de derivación, los casos de
    // abajo pasarían sin ejercitar nada.
    expect(DENEGADOS).toHaveLength(5);
    expect(PERMITIDOS).toEqual(["maestro"]);
  });

  for (const rol of DENEGADOS) {
    it(`${rol}: lanza notFound() y NO consulta dato alguno`, async () => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      const catalogoDoble = vi.fn();

      await expect(
        HistorialAccionesPage({}, { obtenerCatalogo: catalogoDoble }),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(notFoundSpy).toHaveBeenCalledTimes(1);
      // R18: el gate va ANTES de la primera lectura. Mover el `notFound()` por debajo de la
      // carga del catálogo pone rojas estas dos líneas.
      expect(catalogoDoble).not.toHaveBeenCalled();
      expect(catalogoModulo.fn).not.toHaveBeenCalled();
    });
  }

  it("⭑ el ADMIN no puede abrir la ruta (caso nominal, sin derivar de la constante)", async () => {
    // Escrito a mano A PROPÓSITO. El bucle de arriba deriva de `ROLES_HISTORIAL_ACCIONES`:
    // si alguien añadiera "admin" a esa constante, el bucle dejaría de probarlo en silencio y
    // el módulo quedaría abierto a quien toma las decisiones que este registro audita. Este
    // caso no se puede desactivar sin borrarlo.
    resolveActorMock.mockResolvedValue({ usuarioId: "u9", rol: "admin" });
    const catalogoDoble = vi.fn();

    await expect(
      HistorialAccionesPage({}, { obtenerCatalogo: catalogoDoble }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(catalogoDoble).not.toHaveBeenCalled();
  });

  it("sin sesión: lanza notFound() y NO consulta dato alguno", async () => {
    resolveActorMock.mockResolvedValue(null);
    const catalogoDoble = vi.fn();

    await expect(
      HistorialAccionesPage({}, { obtenerCatalogo: catalogoDoble }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFoundSpy).toHaveBeenCalledTimes(1);
    expect(catalogoDoble).not.toHaveBeenCalled();
  });
});

describe("el maestro sí entra, y la página pre-carga sólo el catálogo del filtro", () => {
  it("no lanza, y pide el catálogo exactamente una vez", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    const catalogoDoble = vi.fn().mockResolvedValue(CATALOGO_OK);

    const salida = await HistorialAccionesPage({}, { obtenerCatalogo: catalogoDoble });

    expect(notFoundSpy).not.toHaveBeenCalled();
    expect(catalogoDoble).toHaveBeenCalledTimes(1);
    expect(salida).toBeTruthy();
  });

  it("un catálogo que no llega deja el filtro sin opciones, no la pantalla sin barra", async () => {
    // R64 de la 144: una barra montada y vacía se lee como «no hay a quién filtrar»; una
    // barra que desaparece se lee como «esta pantalla no filtra».
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    const catalogoDoble = vi.fn().mockResolvedValue({ status: "forbidden" });

    await expect(
      HistorialAccionesPage({}, { obtenerCatalogo: catalogoDoble }),
    ).resolves.toBeTruthy();
  });

  it("`deps` NO cambia la aridad declarada: Next sigue viendo la firma de una página", async () => {
    // El doble viaja por el SEGUNDO parámetro, y ese parámetro tiene VALOR POR DEFECTO: en
    // JavaScript la aridad declarada se corta en el primer parámetro con default, así que
    // `deps` no cuenta. La página sigue anunciando UN parámetro —el objeto de props de ruta—,
    // que es lo único que Next le pasa. Quitarle el default a `deps` subiría esto a 2 y
    // cambiaría la firma que ve el framework.
    expect(HistorialAccionesPage.length).toBe(1);
  });
});
