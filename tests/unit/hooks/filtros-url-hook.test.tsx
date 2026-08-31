// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { useFiltrosUrl } from "@/hooks/useFiltrosUrl";

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
    result.current.borrarParams(["q"]);
    expect(replace).toHaveBeenCalledWith("/ordenes", { scroll: false });
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
