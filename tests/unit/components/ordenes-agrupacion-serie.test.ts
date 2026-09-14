import { describe, it, expect } from "vitest";

import {
  notaAgrupacionPorSerie,
  serieDeRemision,
} from "@/app/(app)/ordenes/_components/ordenamiento-ordenes";

// FICHA 423 (T4.6, R20) — EL AVISO DE AGRUPACIÓN POR SERIE, SOBRE LAS FUNCIONES PURAS.
//
// R20 tiene DOS mitades, y la segunda es la que se olvida: el aviso aparece cuando hay más de
// una serie en la página, y NO aparece ni con una sola serie ni con el orden por fecha. Un
// aviso permanente cumpliría la primera mitad y ninguna de las otras dos, y no rompería nada
// — pasaría verde y lo descubriría quien tuviera que preguntar «¿qué es una serie?».
//
// EL TEXTO ESPERADO ESTÁ ESCRITO A MANO. Compararlo contra la constante que lo genera dejaría
// este archivo verde por construcción, incapaz de ponerse rojo nunca (memoria del repo:
// «aserción contra su propia fuente»).

/** El aviso, palabra por palabra. Si el módulo lo cambia, este literal tiene que cambiar. */
const AVISO =
  "Las remisiones se agrupan por serie: las que comparten prefijo van juntas, y dentro de cada serie manda el número, no el texto.";

/** Las cuatro series reales de producción (2.136 órdenes vivas, medidas el 2026-09-14). */
const PAGINA_VARIAS_SERIES = ["NA-107", "72912", "BS-00001"];
/** Una página entera de la misma serie: no hay agrupación que observar. */
const PAGINA_UNA_SERIE = ["NA-107", "NA-1069", "NA-1863"];

describe("serieDeRemision — el prefijo, derivado del `numRemision` que el DTO ya trae", () => {
  it("sobre los valores REALES de producción", () => {
    expect(serieDeRemision("NA-107")).toBe("NA-");
    expect(serieDeRemision("NA-1069")).toBe("NA-");
    expect(serieDeRemision("NA-1863")).toBe("NA-");
    expect(serieDeRemision("72912")).toBe("");
    expect(serieDeRemision("73636")).toBe("");
    expect(serieDeRemision("BS-00001")).toBe("BS-");
    expect(serieDeRemision("SC-050")).toBe("SC-");
  });

  it("las remisiones puramente numéricas comparten una sola serie (la vacía)", () => {
    // Es lo que hace que los 437 números sueltos de producción salgan en un solo bloque, que
    // es justo el bloque que sorprende y por el que existe el aviso.
    expect(serieDeRemision("72912")).toBe(serieDeRemision("73636"));
  });

  it("sobre los valores RAROS no lanza, y degrada a una serie propia", () => {
    // Los mismos que la base aceptó sin error (R5): si aquí lanzara, la tabla entera caería
    // por una remisión mal escrita — el aviso es decoración, no puede tumbar la pantalla.
    expect(() => serieDeRemision("SIN NUMERO")).not.toThrow();
    expect(serieDeRemision("SIN NUMERO")).toBe("SIN NUMERO");
    expect(serieDeRemision("---")).toBe("---");
    expect(serieDeRemision("NA-")).toBe("NA-");
    expect(serieDeRemision("📦-5")).toBe("📦-");
    expect(serieDeRemision("0")).toBe("");
    expect(serieDeRemision("1234567890123456789012345")).toBe("");
    expect(serieDeRemision("  42  ")).toBe("  42  ");
    expect(serieDeRemision("")).toBe("");
  });

  it("una remisión sin número y su serie coinciden: no se pierde el prefijo", () => {
    expect(serieDeRemision("NA-")).toBe(serieDeRemision("NA-1863"));
  });
});

describe("notaAgrupacionPorSerie — las TRES situaciones de R20", () => {
  it("1) orden por remisión + varias series → APARECE", () => {
    expect(notaAgrupacionPorSerie("num_remision", PAGINA_VARIAS_SERIES)).toBe(
      AVISO,
    );
  });

  it("2) orden por remisión + UNA sola serie → no aparece", () => {
    // La mitad del requisito que un aviso permanente pasaría sin cumplir: con una sola serie
    // en pantalla no hay agrupación que explicar, y anunciarla obliga a preguntar qué es.
    expect(
      notaAgrupacionPorSerie("num_remision", PAGINA_UNA_SERIE),
    ).toBeUndefined();
  });

  it("3) orden por FECHA de creación + varias series → no aparece", () => {
    // Con el orden por fecha las series no se agrupan: el aviso describiría otro listado.
    expect(
      notaAgrupacionPorSerie("created_at", PAGINA_VARIAS_SERIES),
    ).toBeUndefined();
  });

  it("tampoco con `num_guia`, que el control no ofrece pero el contrato admite", () => {
    expect(
      notaAgrupacionPorSerie("num_guia", PAGINA_VARIAS_SERIES),
    ).toBeUndefined();
  });
});

describe("notaAgrupacionPorSerie — los bordes de «más de una serie»", () => {
  it("una página vacía no anuncia nada", () => {
    expect(notaAgrupacionPorSerie("num_remision", [])).toBeUndefined();
  });

  it("una sola fila no anuncia nada", () => {
    expect(notaAgrupacionPorSerie("num_remision", ["NA-107"])).toBeUndefined();
  });

  it("dos series bastan: no hace falta que estén las cuatro", () => {
    expect(notaAgrupacionPorSerie("num_remision", ["NA-107", "SC-050"])).toBe(
      AVISO,
    );
  });

  it("las remisiones numéricas cuentan como serie frente a las que llevan prefijo", () => {
    expect(notaAgrupacionPorSerie("num_remision", ["72912", "73636"])).toBeUndefined();
    expect(notaAgrupacionPorSerie("num_remision", ["72912", "BS-00001"])).toBe(
      AVISO,
    );
  });

  it("una remisión rara entre las normales cuenta como su propia serie, sin lanzar", () => {
    expect(
      notaAgrupacionPorSerie("num_remision", ["NA-107", "SIN NUMERO"]),
    ).toBe(AVISO);
  });
});

describe("el texto del aviso dice el CRITERIO, no el censo", () => {
  it("no enumera ninguna serie concreta", () => {
    // Cuáles hay depende de qué haya cargado cada tienda; una lista escrita en el texto
    // caducaría sola y nadie se enteraría hasta que sobrara o faltara una.
    const aviso = notaAgrupacionPorSerie("num_remision", PAGINA_VARIAS_SERIES);
    expect(aviso).toBeDefined();
    expect(aviso).not.toContain("NA-");
    expect(aviso).not.toContain("SC-");
    expect(aviso).not.toContain("BS-");
    expect(aviso).not.toContain("72912");
  });

  it("no depende de la dirección puesta: es la misma nota en los dos sentidos", () => {
    // Decir «primero las numéricas» sería falso en cuanto se pulsara «Más altas».
    const aviso = notaAgrupacionPorSerie("num_remision", PAGINA_VARIAS_SERIES);
    expect(aviso).not.toMatch(/primero|último|ultima|arriba|abajo/i);
  });
});
