// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  clavesVisiblesEnOrden,
  columnasEnOrden,
  guardar,
  leerCrudo,
  sanearPreferencia,
} from "@/lib/columnas/preferencia-columnas";
import { etiquetaColumna } from "@/lib/manifiesto/etiquetas-columnas";
import {
  claveColumnas,
  claveDeColumnaManifiesto,
} from "@/lib/manifiesto/preferencia-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";
import type { XlsxColumn } from "@/lib/utils/xlsx-template";

// Feature 194 (T4) — modulo puro de preferencia de columnas del manifiesto (R14, R16, R17,
// R19, R20, R21, R22).
//
// FICHA 314 — RE-CABLEADO, no reescrito. La maquinaria se mudó a
// `lib/columnas/preferencia-columnas.ts` (generalizada por ámbito) y aquí lo único propio del
// manifiesto que queda es su CLAVE: donde antes se pasaba `flujo`, ahora se pasa
// `claveColumnas(flujo)`, que devuelve exactamente el mismo string de siempre. Los OCHO casos
// de abajo y el bloque de etiquetas se conservan intactos en lo que afirman: son la evidencia
// de que la mudanza no cambió una sola conducta observable (314/R30).
//
// REGLA R23 (conjunto ABIERTO, heredada de 160/R28): estos tests usan una lista `publicadas` de
// PRUEBA, inventada aqui, y NUNCA la constante real `COLUMNAS_MANIFIESTO`. Ningun aserto afirma
// un numero total de columnas publicadas: se verifica presencia, ausencia y orden RELATIVO por
// clave. Si manana el manifiesto gana una columna, este archivo no se entera y sigue verde.

/** Lista publicada de prueba. Su contenido lo define este archivo, no el dominio. */
const PUBLICADAS: readonly XlsxColumn[] = [
  { key: "alfa", header: "col_alfa" },
  { key: "beta", header: "col_beta" },
  { key: "gama", header: "col_gama" },
];

function claves(columnas: readonly XlsxColumn[]): string[] {
  return columnas.map((columna) => columna.key);
}

/** Las columnas que salen en el archivo, con el catálogo de prueba de este archivo. */
function columnasVisibles(
  crudo: string | null,
  publicadas: readonly XlsxColumn[],
): XlsxColumn[] {
  return columnasEnOrden(
    publicadas,
    clavesVisiblesEnOrden(crudo, claves(publicadas)),
    claveDeColumnaManifiesto,
  );
}

/** Lectura por FLUJO, tal y como la hace el binding del ámbito manifiesto. */
function leerCrudoColumnas(flujo: ManifiestoFlujo): string | null {
  return leerCrudo(claveColumnas(flujo));
}

/** Escritura por FLUJO, con el `orden` vacío: el formato de la 194, byte por byte. */
function guardarOcultas(flujo: ManifiestoFlujo, ocultas: readonly string[]): void {
  guardar(claveColumnas(flujo), { ocultas, orden: [] });
}

/** Las ocultas ya saneadas contra el catálogo de prueba. */
function sanearOcultas(
  crudo: string | null,
  publicadas: readonly XlsxColumn[],
): string[] {
  return [...sanearPreferencia(crudo, claves(publicadas)).ocultas];
}

const descriptorOriginal = Object.getOwnPropertyDescriptor(
  window,
  "localStorage",
);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  if (descriptorOriginal) {
    Object.defineProperty(window, "localStorage", descriptorOriginal);
  }
  window.localStorage.clear();
});

describe("preferencia de columnas del manifiesto", () => {
  it("sin valor guardado deja visibles todas las columnas publicadas (R17)", () => {
    const visibles = columnasVisibles(
      leerCrudoColumnas("carga_masiva"),
      PUBLICADAS,
    );

    expect(claves(visibles)).toEqual(claves(PUBLICADAS));
  });

  it("guarda las ocultas bajo la clave del flujo y las recupera (R14)", () => {
    guardarOcultas("carga_masiva", ["beta"]);

    expect(window.localStorage.getItem("ordenex:manifiesto-columnas:carga_masiva")).toBe(
      JSON.stringify({ ocultas: ["beta"] }),
    );
    expect(claveColumnas("carga_masiva")).toBe(
      "ordenex:manifiesto-columnas:carga_masiva",
    );

    const visibles = columnasVisibles(
      leerCrudoColumnas("carga_masiva"),
      PUBLICADAS,
    );

    expect(claves(visibles)).toEqual(["alfa", "gama"]);
    expect(claves(visibles)).not.toContain("beta");
  });

  it("guardar en carga_masiva no altera la preferencia de asignacion_satelite (R16)", () => {
    guardarOcultas("asignacion_satelite", ["gama"]);
    guardarOcultas("carga_masiva", ["alfa"]);

    expect(
      claves(columnasVisibles(leerCrudoColumnas("asignacion_satelite"), PUBLICADAS)),
    ).toEqual(["alfa", "beta"]);
    expect(
      claves(columnasVisibles(leerCrudoColumnas("carga_masiva"), PUBLICADAS)),
    ).toEqual(["beta", "gama"]);
  });

  it("descarta una clave guardada que ya no esta entre las publicadas (R19)", () => {
    const crudo = JSON.stringify({ ocultas: ["beta", "columna_retirada"] });

    expect(sanearOcultas(crudo, PUBLICADAS)).toEqual(["beta"]);
    expect(claves(columnasVisibles(crudo, PUBLICADAS))).toEqual(["alfa", "gama"]);
  });

  it("si lo guardado ocultaria todas las publicadas, quedan todas visibles (R20)", () => {
    const crudo = JSON.stringify({ ocultas: claves(PUBLICADAS) });

    expect(sanearOcultas(crudo, PUBLICADAS)).toEqual([]);
    expect(claves(columnasVisibles(crudo, PUBLICADAS))).toEqual(claves(PUBLICADAS));
  });

  it.each([
    ["JSON invalido", "{no-es-json"],
    ["ocultas no es un array", '{"ocultas":"x"}'],
    ["el valor no es un objeto", "[1,2]"],
    ["ocultas ausente", '{"otra":["alfa"]}'],
    ["elementos no string", '{"ocultas":[1,2]}'],
  ])(
    "con contenido ilegible (%s) deja todas visibles y no lanza (R21)",
    (_caso, crudo) => {
      expect(() => sanearOcultas(crudo, PUBLICADAS)).not.toThrow();
      expect(sanearOcultas(crudo, PUBLICADAS)).toEqual([]);
      expect(claves(columnasVisibles(crudo, PUBLICADAS))).toEqual(
        claves(PUBLICADAS),
      );
    },
  );

  it("con un almacenamiento que lanza, lee null, guarda sin romper y deja todas visibles (R21)", () => {
    const almacenamientoRoto = {
      getItem: () => {
        throw new Error("SecurityError: acceso denegado al almacenamiento");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    Object.defineProperty(window, "localStorage", {
      value: almacenamientoRoto,
      configurable: true,
    });

    expect(leerCrudoColumnas("carga_masiva")).toBeNull();
    expect(() => guardarOcultas("carga_masiva", ["alfa"])).not.toThrow();
    expect(
      claves(columnasVisibles(leerCrudoColumnas("carga_masiva"), PUBLICADAS)),
    ).toEqual(claves(PUBLICADAS));
  });

  it("una columna publicada que no figura en la lista guardada sale visible (R22)", () => {
    // La preferencia se escribio cuando "delta" aun no existia: no esta en las ocultas.
    guardarOcultas("envio_tienda", ["beta"]);
    const publicadasConNueva: readonly XlsxColumn[] = [
      ...PUBLICADAS,
      { key: "delta", header: "col_delta" },
    ];

    const visibles = claves(
      columnasVisibles(leerCrudoColumnas("envio_tienda"), publicadasConNueva),
    );

    expect(visibles).toContain("delta");
    expect(visibles).not.toContain("beta");
    // Orden RELATIVO conservado respecto a `publicadas` (R8), sin afirmar cuantas hay (R23).
    expect(visibles.indexOf("alfa")).toBeLessThan(visibles.indexOf("gama"));
    expect(visibles.indexOf("gama")).toBeLessThan(visibles.indexOf("delta"));
  });
});

describe("etiquetas legibles de las columnas", () => {
  it("traduce una cabecera conocida a su etiqueta legible (D-A)", () => {
    expect(etiquetaColumna("num_remision")).toBe("Número de remisión");
    expect(etiquetaColumna("num_guia")).toBe("Número de guía");
    expect(etiquetaColumna("monto")).toBe("Monto a cobrar");
  });

  it("cae a la propia cabecera cuando no hay etiqueta declarada (R5)", () => {
    expect(etiquetaColumna("columna_publicada_manana")).toBe(
      "columna_publicada_manana",
    );
  });
});
