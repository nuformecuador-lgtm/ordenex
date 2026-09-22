// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// GUARDIA — FICHA 453 (T6.1, R34 + R31). LAS VISTAS, SOLO DONDE SE DECLARAN. EN LAS DOS
// DIRECCIONES.
//
// **Dirección A (R34) — una superficie declarada y no montada pone el árbol en rojo.** Es la
// lección de `superficie-de-uso`, aplicada antes de que duela: un mecanismo que nadie puede
// disparar no rompe ningún test, y aquí la lista de superficies vive en un `as const` al que
// añadir una cadena cuesta un segundo. Sin esta mitad, alguien enciende «cierres» en el tipo,
// nadie monta el control, y la única señal sería que un día un humano lo eche de menos.
//
// **Dirección B (R31) — un control montado en una superficie que NADIE declaró, también.** Esta
// mitad es la que este repo ya se comió: cuando la ficha 428 añadió una prop opt-in a un
// componente compartido, resultó que encender su default dejaba VERDES los tests de las otras
// once pantallas, porque todas localizan por nombre accesible y ese no cambia. La barra la montan
// dieciséis consumidores: si las vistas se encienden en global sin querer, once pantallas se
// llenan de un control que no les toca y de una consulta que nadie pidió, y no se entera nadie.
//
// Por eso hay DOS redes, y las dos tienen que ser capaces de ponerse rojas solas:
//   1. un CENSO ESTÁTICO con la lista de archivos escrita a mano: montar el control en otra
//      pantalla es una decisión, y una decisión se escribe;
//   2. una red DE COMPORTAMIENTO: la barra SIN la prop, y una barra REAL de otra pantalla
//      (`/novedades`), no pintan ningún control de vistas. Esa es la que se pone roja si el
//      default se enciende, que es justo lo que en la 428 no pasó.
//
// El detector se AUTO-COMPRUEBA en los dos sentidos: reconoce «ordenes» como montada y NO
// reconoce una superficie inventada. Una guardia estática rota no falla: calla.

import { SUPERFICIES_VISTA } from "@/lib/types/vista-filtro";

const RAIZ = path.resolve(__dirname, "../../..");

/** Los árboles de PRODUCCIÓN donde puede vivir un control montado. */
const ARBOLES = ["app", "components"] as const;

/** El único archivo que hoy enciende las vistas. Lista literal: añadir uno es decidirlo. */
const MONTAJES_ESPERADOS = ["app/(app)/ordenes/_components/OrdenesListado.tsx"];

function listarFuentes(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarFuentes(completo, acc);
    else if (/\.tsx$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/**
 * Los montajes del control: archivo -> superficies que declara.
 *
 * Se detecta por la PROP (`vistas={{`) y no por el nombre del componente, porque quien enciende
 * las vistas en una pantalla es la prop de la barra, no un import: `VistasFiltro` lo importa un
 * solo archivo —la propia barra— y mirarlo a él no diría nada de quién lo enciende.
 */
function montajes(fuentes: string[]): Map<string, string[]> {
  const encontrados = new Map<string, string[]>();
  for (const archivo of fuentes) {
    const texto = readFileSync(archivo, "utf8");
    if (!texto.includes("vistas={{")) continue;
    const superficies = [...texto.matchAll(/superficie:\s*"([^"]+)"/g)].map((m) => m[1]);
    encontrados.set(rutaRelativa(archivo), superficies);
  }
  return encontrados;
}

const FUENTES = ARBOLES.flatMap((arbol) => listarFuentes(path.join(RAIZ, arbol)));
const MONTAJES = montajes(FUENTES);
const SUPERFICIES_MONTADAS = new Set([...MONTAJES.values()].flat());

describe("GUARDIA · el detector se prueba a sí mismo antes de afirmar nada", () => {
  it("lee un árbol de verdad: hay fuentes y ninguna está vacía", () => {
    expect(FUENTES.length).toBeGreaterThan(200);
    for (const archivo of FUENTES.slice(0, 50)) {
      expect(readFileSync(archivo, "utf8").length).toBeGreaterThan(0);
    }
  });

  it("CONTROL POSITIVO — encuentra «ordenes» montada en el árbol real", () => {
    expect(SUPERFICIES_MONTADAS.has("ordenes")).toBe(true);
  });

  it("CONTROL NEGATIVO — una superficie inventada NO aparece montada", () => {
    // Si el detector devolviera «todo montado» —o no encontrara nada y la comparación quedara
    // vacía— este caso lo delata.
    expect(SUPERFICIES_MONTADAS.has("cierres-bodega-inventada")).toBe(false);
  });
});

describe("GUARDIA · A — toda superficie DECLARADA tiene su control montado (R34)", () => {
  it("ninguna superficie de `SUPERFICIES_VISTA` se queda sin pantalla que la dispare", () => {
    const sinMontar = SUPERFICIES_VISTA.filter((s) => !SUPERFICIES_MONTADAS.has(s));
    expect(sinMontar).toEqual([]);
  });
});

describe("GUARDIA · B — nadie monta el control donde no se ha declarado (R31)", () => {
  it("el censo de archivos que encienden las vistas es EXACTAMENTE el escrito", () => {
    expect([...MONTAJES.keys()].sort()).toEqual([...MONTAJES_ESPERADOS].sort());
  });

  it("toda superficie montada está declarada en `SUPERFICIES_VISTA`", () => {
    const declaradas = new Set<string>(SUPERFICIES_VISTA);
    const intrusas = [...SUPERFICIES_MONTADAS].filter((s) => !declaradas.has(s));
    expect(intrusas).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// La red de COMPORTAMIENTO. El censo de arriba no ve un default encendido dentro de la barra: eso
// no añade ninguna línea a ninguna pantalla.
// ─────────────────────────────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/novedades",
  useSearchParams: () => new URLSearchParams(),
}));

const listarVistasMock = vi.fn();
vi.mock("@/lib/actions/vistas-filtro", () => ({
  listarVistasFiltro: (...a: unknown[]) => listarVistasMock(...a),
  guardarVistaFiltro: vi.fn(),
  renombrarVistaFiltro: vi.fn(),
  actualizarVistaFiltro: vi.fn(),
  eliminarVistaFiltro: vi.fn(),
}));

import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { NovedadesFiltrosBarra } from "@/app/(app)/novedades/_components/NovedadesFiltrosBarra";
import type { NovedadesFiltro } from "@/app/(app)/novedades/_components/useNovedadesFiltro";

/** Un `NovedadesFiltro` de juguete: esta barra es SOLO presentación, así que basta con la forma. */
function filtroDeNovedades(): NovedadesFiltro {
  return {
    ofrecidos: [{ key: "zona_id", label: "Zona" }],
    montados: [],
    activos: [],
    onActivosChange: vi.fn(),
    onTerminoChange: vi.fn(),
    onSeleccionChange: vi.fn(),
    reset: 0,
    hayFiltrosAplicados: false,
    limpiar: vi.fn(),
    filtrando: false,
    barraEnUso: false,
    estado: "listo",
    resultados: [],
    pagina: 1,
    irAPagina: vi.fn(),
    quitar: vi.fn(),
    recargar: async () => {},
    reintentar: vi.fn(),
    limite: null,
  };
}

afterEach(() => cleanup());

describe("GUARDIA · B (comportamiento) — encender las vistas en GLOBAL pone esto rojo", () => {
  it("la barra SIN la prop no pinta ningún control de vistas ni pide ninguna lista", () => {
    render(
      <BuscadorFiltros
        onChange={vi.fn()}
        debounceMs={0}
        filtros={[{ key: "zona_id", label: "Zona" }]}
        activos={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: /Vistas/i })).toBeNull();
    expect(listarVistasMock).not.toHaveBeenCalled();
  });

  it("y la barra REAL de otra pantalla (`/novedades`) tampoco", () => {
    // Una pantalla de verdad, con su propio montaje, la que en la 428 se habría quedado verde.
    render(
      <NovedadesFiltrosBarra
        filtro={filtroDeNovedades()}
        label="Buscar en novedades"
        regionLabel="Filtros de novedades"
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Buscar en novedades" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vistas/i })).toBeNull();
    expect(listarVistasMock).not.toHaveBeenCalled();
  });
});
