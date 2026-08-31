// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { useFiltrosUrl, olvidarParamsBorrados } from "@/hooks/useFiltrosUrl";

// Feature 335 / T2.2 — el hook frente a los entornos donde `next/navigation` NO esta
// entero (R24) y el `router.replace` de «Limpiar todo» (R21, R22, R23).
//
// El mock se declara con GETTERS para poder simular el caso mas incomodo y a la vez el
// mas real: que el modulo simulado NI SIQUIERA EXPORTE `useSearchParams`/`usePathname`,
// que es como lo mockean los tests ya existentes del repo
// (`tests/unit/components/ordenes-listado-buscador.test.tsx:18` y los tres satelites de
// descarga/paginacion). Ahi esos hooks valen `undefined` y llamarlos revienta.

type LectorSimulado = (() => URLSearchParams | null) | undefined;
type RutaSimulada = (() => string | null) | undefined;
type EnrutadorSimulado = (() => { replace: (...args: unknown[]) => void }) | undefined;

let leerParams: LectorSimulado;
let leerRuta: RutaSimulada;
let leerEnrutador: EnrutadorSimulado;

vi.mock("next/navigation", () => ({
  get useSearchParams() {
    return leerParams;
  },
  get usePathname() {
    return leerRuta;
  },
  get useRouter() {
    return leerEnrutador;
  },
}));

const replace = vi.fn();

beforeEach(() => {
  replace.mockClear();
  leerParams = undefined;
  leerRuta = undefined;
  leerEnrutador = undefined;
  // La memoria de lo recien borrado es de MODULO y sobrevive a los remontes —esa es toda
  // su gracia—, asi que tambien sobrevive de un caso al siguiente dentro de este archivo.
  // En el navegador cada carga de pagina estrena modulo; aqui hay que estrenarlo a mano.
  olvidarParamsBorrados();
});

function conRouter(): void {
  leerEnrutador = () => ({ replace });
}

describe("useFiltrosUrl — sin fuente de params (R24)", () => {
  it("R24 — mock PARCIAL sin useSearchParams ni usePathname: no lanza y la URL se ve vacia", () => {
    conRouter();
    const { result } = renderHook(() => useFiltrosUrl(true));

    expect(result.current.params.toString()).toBe("");
    expect(result.current.params.get("q")).toBeNull();
    expect(result.current.params.getAll("zona_id")).toEqual([]);
    // Sin ruta a la que navegar, borrar es un no-op silencioso.
    expect(() => result.current.borrarParams(["q"])).not.toThrow();
    expect(replace).not.toHaveBeenCalled();
  });

  it("R24 — useSearchParams devuelve null (fuera del App Router): se comporta como URL vacia", () => {
    leerParams = () => null;
    leerRuta = () => "/ordenes";
    conRouter();
    const { result } = renderHook(() => useFiltrosUrl(true));

    expect(result.current.params.toString()).toBe("");
    // Y «se comporta como URL vacia» incluye NO navegar: sin un solo param que borrar, la
    // query resultante es identica a la actual y un `replace` a la misma URL solo costaria
    // un refetch del payload RSC. (Este assert afirmaba lo contrario hasta que se anadio la
    // guarda de «no navegar si la URL no cambia»; el comportamiento correcto es este.)
    expect(() => result.current.borrarParams(["q"])).not.toThrow();
    expect(replace).not.toHaveBeenCalled();
  });

  it("R24 — useRouter LANZA (invariant expected app router to be mounted): no propaga", () => {
    leerParams = () => new URLSearchParams("q=abc");
    leerRuta = () => "/ordenes";
    leerEnrutador = () => {
      throw new Error("invariant expected app router to be mounted");
    };

    const { result } = renderHook(() => useFiltrosUrl(true));

    // Lo leido ANTES del hook que lanza sigue disponible: la lectura no se pierde.
    expect(result.current.params.get("q")).toBe("abc");
    expect(() => result.current.borrarParams(["q"])).not.toThrow();
  });

  it("R24 — el objeto params es estable entre renders", () => {
    conRouter();
    const { result, rerender } = renderHook(() => useFiltrosUrl(true));
    const primero = result.current.params;
    rerender();
    expect(result.current.params).toBe(primero);
  });
});

describe("useFiltrosUrl — borrarParams (R19, R20, R21, R22)", () => {
  beforeEach(() => {
    leerRuta = () => "/cierres-admin";
    conRouter();
  });

  it("R19/R20/R22 — replace recibe la ruta con SOLO los params ajenos y { scroll: false }", () => {
    leerParams = () => new URLSearchParams("cierre=abc&q=guia&zona_id=A");
    const { result } = renderHook(() => useFiltrosUrl(true));

    result.current.borrarParams(["q", "zona_id"]);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/cierres-admin?cierre=abc", {
      scroll: false,
    });
  });

  it("R21 — sin params restantes, la ruta va sin `?`", () => {
    leerParams = () => new URLSearchParams("q=guia&zona_id=A");
    const { result } = renderHook(() => useFiltrosUrl(true));

    result.current.borrarParams(["q", "zona_id"]);

    expect(replace).toHaveBeenCalledWith("/cierres-admin", { scroll: false });
  });
});

describe("useFiltrosUrl — opt-out del consumidor (R23)", () => {
  it("R23 — con activo=false los params se ven vacios y la URL no se toca", () => {
    leerParams = () => new URLSearchParams("q=guia&cierre=abc");
    leerRuta = () => "/ordenes";
    conRouter();

    const { result } = renderHook(() => useFiltrosUrl(false));

    expect(result.current.params.toString()).toBe("");
    expect(result.current.params.get("q")).toBeNull();

    result.current.borrarParams(["q"]);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("useFiltrosUrl — guarda: no se navega si la query no cambia", () => {
  beforeEach(() => {
    leerRuta = () => "/novedades";
    conRouter();
  });

  it("R18/R22 — «Limpiar todo» sin un solo param propio que borrar NO llama a replace", () => {
    // El caso NORMAL de las ocho pantallas que montan la barra: se entra sin query. Un
    // `router.replace` a la MISMA URL no es gratis en el App Router (vuelve a pedir el
    // payload RSC), asi que una navegacion que no cambia nada no debe existir.
    leerParams = () => new URLSearchParams();
    const { result } = renderHook(() => useFiltrosUrl(true));

    result.current.borrarParams(["q", "zona_id"]);

    expect(replace).not.toHaveBeenCalled();
  });

  it("R18/R22 — con SOLO params ajenos tampoco se navega", () => {
    leerParams = () => new URLSearchParams("cierre=abc&mensajero=m1");
    const { result } = renderHook(() => useFiltrosUrl(true));

    result.current.borrarParams(["q", "zona_id"]);

    expect(replace).not.toHaveBeenCalled();
  });

  it("R19 — pero si hay algo propio que borrar, si se navega", () => {
    leerParams = () => new URLSearchParams("cierre=abc&q=guia");
    const { result } = renderHook(() => useFiltrosUrl(true));

    result.current.borrarParams(["q", "zona_id"]);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/novedades?cierre=abc", { scroll: false });
  });
});

describe("useFiltrosUrl — guarda: se olvida lo que se acaba de borrar", () => {
  beforeEach(() => {
    conRouter();
  });

  it("R19 — un montaje POSTERIOR con los params viejos ya no ve los pares borrados", () => {
    // Reproduce el remonte de `NovedadesFiltrosBarra` (`key={filtro.reset}`): el consumidor
    // remonta la barra en el mismo manejador y `useSearchParams` todavia devuelve la query
    // vieja. Sin esta memoria, la barra recien montada resucita lo que se acaba de borrar.
    leerRuta = () => "/novedades";
    leerParams = () => new URLSearchParams("q=guia&zona_id=A&cierre=abc");

    const primero = renderHook(() => useFiltrosUrl(true));
    expect(primero.result.current.params.get("q")).toBe("guia");
    primero.result.current.borrarParams(["q", "zona_id"]);
    primero.unmount();

    const segundo = renderHook(() => useFiltrosUrl(true));

    expect(segundo.result.current.params.get("q")).toBeNull();
    expect(segundo.result.current.params.getAll("zona_id")).toEqual([]);
    // Lo AJENO no se toca nunca: sigue ahi.
    expect(segundo.result.current.params.get("cierre")).toBe("abc");
    expect([...segundo.result.current.params.entries()]).toEqual([["cierre", "abc"]]);
  });

  it("R15 — se compara por nombre Y valor: un valor NUEVO de la misma clave si se honra", () => {
    leerRuta = () => "/novedades";
    leerParams = () => new URLSearchParams("zona_id=A");
    const primero = renderHook(() => useFiltrosUrl(true));
    primero.result.current.borrarParams(["zona_id"]);
    primero.unmount();

    // El usuario llega por un enlace NUEVO a la misma ruta con otra zona.
    leerParams = () => new URLSearchParams("zona_id=B");
    const segundo = renderHook(() => useFiltrosUrl(true));

    expect(segundo.result.current.params.get("zona_id")).toBe("B");
  });

  it("R15 — la memoria esta scopeada por ruta: borrar en /novedades no ciega /ordenes", () => {
    leerRuta = () => "/novedades";
    leerParams = () => new URLSearchParams("zona_id=A");
    const primero = renderHook(() => useFiltrosUrl(true));
    primero.result.current.borrarParams(["zona_id"]);
    primero.unmount();

    leerRuta = () => "/ordenes";
    const segundo = renderHook(() => useFiltrosUrl(true));

    expect(segundo.result.current.params.get("zona_id")).toBe("A");
  });
});
