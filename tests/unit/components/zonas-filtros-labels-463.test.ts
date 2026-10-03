import { describe, it, expect } from "vitest";

import * as ZONAS from "@/components/shared/wallet/zonas-filtros-labels";
import { ORDEN_LIBRO, ORDEN_LIBRO_POR_DEFECTO, ZONA_LIBRO_TEXTO } from "@/components/shared/wallet/zonas-filtros-labels";
import { BUSCADOR_LIBRO_CAJA_PLACEHOLDER } from "@/app/(app)/wallet/_components/libro-caja-labels";
import { CASILLAS_ESTADO_CUENTA_TEXTO, ESTADO_CUENTA_TEXTO } from "@/components/shared/estado-cuenta/estado-cuenta-labels";
import { LIBRO_CAJA_FILTROS_TEXTO } from "@/app/(app)/wallet/_components/libro-caja-labels";
import { BUSCADOR_SALDOS_TIENDAS } from "@/app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-labels";

// FICHA 463 (T6, design §5.5) — los textos de las dos zonas de filtros. Los de CONTRATO (R2, el alcance
// de cada zona; R33, las dos opciones de orden) se afirman como LITERAL escrito a mano: compararlos con
// su propia constante siempre estaría en verde. Y ningún texto nuevo usa la sigla «SLA» ni jerga (R48).

// FICHA 467 (T7; R1, R3) — las DOS ZONAS se retiraron: una sola barra encima del libro, sin textos de
// alcance ni nombres de zona. Queda el nombre accesible del buscador.
describe("467 R1/R3 — ya no hay textos de zona", () => {
  it("fuera `ZONA_WALLET_TEXTO`; `ZONA_LIBRO_TEXTO` solo nombra el buscador", () => {
    expect(Object.keys(ZONAS)).not.toContain("ZONA_WALLET_TEXTO");
    expect(ZONA_LIBRO_TEXTO).toEqual({ buscar: "Buscar en el libro" });
  });
});

describe("463 R33/R34 — el orden: «Más recientes» y «Más antiguas», y se entra en «Más recientes»", () => {
  it("dos opciones (467: con icono; la etiqueta es su nombre), en este orden, y la de por defecto es la descendente", () => {
    expect(ORDEN_LIBRO.opciones.map((o) => [o.valor, o.etiqueta])).toEqual([
      ["desc", "Más recientes"],
      ["asc", "Más antiguas"],
    ]);
    expect(ORDEN_LIBRO.nombre).toBe("Ordenar el libro");
    expect(ORDEN_LIBRO_POR_DEFECTO).toBe("desc");
  });
});

describe("463 R23/R25–R27 — los placeholders dicen qué se puede buscar", () => {
  // FICHA 469 (R24): las superficies con búsqueda por guía nombran también la guía y la remisión.
  it("caja (469 R24): guía, remisión, descripción, nombre o referencia anotada y quién registró", () => {
    expect(BUSCADOR_LIBRO_CAJA_PLACEHOLDER).toBe(
      "Buscar por guía, remisión, descripción, nombre o referencia anotada, o quién registró",
    );
  });

  it("oficina (469 R24): guía, remisión, descripción o quién registró; `/mi-wallet`: sin quién registró (R27)", () => {
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.oficina).toBe("Buscar por guía, remisión, descripción o quién registró");
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda).toBe("Buscar por guía, remisión o descripción");
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda).not.toMatch(/registr/i);
  });

  it("469 R36: la bodega satélite NO nombra la guía (su buscador sigue siendo solo de texto)", () => {
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.bodega).toBe("Buscar por descripción o quién registró");
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.bodega).not.toMatch(/guía|remisión/i);
  });
});

describe("463 R48 — sin la sigla «SLA» ni jerga técnica en los textos nuevos", () => {
  const TEXTOS_NUEVOS: string[] = [
    // FICHA 467 (R36) — los textos de la barra única: casillas y lo que dicen sus controles.
    ...Object.values(LIBRO_CAJA_FILTROS_TEXTO),
    ...Object.values(CASILLAS_ESTADO_CUENTA_TEXTO),
    ...Object.values(ZONA_LIBRO_TEXTO),
    ORDEN_LIBRO.nombre,
    ...ORDEN_LIBRO.opciones.map((o) => o.etiqueta),
    BUSCADOR_LIBRO_CAJA_PLACEHOLDER,
    ESTADO_CUENTA_TEXTO.buscarPlaceholder.oficina,
    ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda,
    ESTADO_CUENTA_TEXTO.buscarPlaceholder.bodega,
    BUSCADOR_SALDOS_TIENDAS.label,
    BUSCADOR_SALDOS_TIENDAS.placeholder,
  ];

  it("no-vacuidad: hay textos que revisar", () => {
    expect(TEXTOS_NUEVOS.length).toBeGreaterThan(10);
  });

  it.each(TEXTOS_NUEVOS)("«%s»", (texto) => {
    expect(texto).not.toMatch(/\bSLA\b|acuerdo de nivel|\bsort\b|\bquery\b|\bfilter\b|\bdesc\b|\basc\b/i);
  });
});
