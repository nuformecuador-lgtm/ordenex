import { describe, it, expect } from "vitest";

import { ORDEN_LIBRO, ORDEN_LIBRO_POR_DEFECTO, ZONA_LIBRO_TEXTO, ZONA_WALLET_TEXTO } from "@/components/shared/wallet/zonas-filtros-labels";
import { BUSCADOR_LIBRO_CAJA_PLACEHOLDER } from "@/app/(app)/wallet/_components/libro-caja-labels";
import { ESTADO_CUENTA_TEXTO } from "@/components/shared/estado-cuenta/estado-cuenta-labels";
import { BUSCADOR_SALDOS_TIENDAS } from "@/app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-labels";

// FICHA 463 (T6, design §5.5) — los textos de las dos zonas de filtros. Los de CONTRATO (R2, el alcance
// de cada zona; R33, las dos opciones de orden) se afirman como LITERAL escrito a mano: compararlos con
// su propia constante siempre estaría en verde. Y ningún texto nuevo usa la sigla «SLA» ni jerga (R48).

describe("463 R2 — cada zona dice su alcance, en palabras", () => {
  it("la zona de la wallet cambia toda la wallet; la del libro, solo el libro", () => {
    expect(ZONA_WALLET_TEXTO.alcance).toBe("Estos filtros cambian toda la wallet");
    expect(ZONA_LIBRO_TEXTO.alcance).toBe("Estos filtros solo afectan al libro de movimientos");
  });

  it("R1: cada zona tiene su nombre accesible propio, y son distintos", () => {
    expect(ZONA_WALLET_TEXTO.nombre).toBe("Filtros de toda la wallet");
    expect(ZONA_LIBRO_TEXTO.nombre).toBe("Filtros del libro de movimientos");
  });
});

describe("463 R33/R34 — el orden: «Más recientes» y «Más antiguas», y se entra en «Más recientes»", () => {
  it("dos opciones con texto, en este orden, y la de por defecto es la descendente", () => {
    expect(ORDEN_LIBRO.opciones.map((o) => [o.valor, o.etiqueta])).toEqual([
      ["desc", "Más recientes"],
      ["asc", "Más antiguas"],
    ]);
    expect(ORDEN_LIBRO.nombre).toBe("Ordenar el libro");
    expect(ORDEN_LIBRO_POR_DEFECTO).toBe("desc");
  });
});

describe("463 R23/R25–R27 — los placeholders dicen qué se puede buscar", () => {
  it("caja: descripción, nombre o referencia anotada y quién registró", () => {
    expect(BUSCADOR_LIBRO_CAJA_PLACEHOLDER).toBe("Buscar por descripción, nombre o referencia anotada, o quién registró");
  });

  it("oficina: descripción o quién registró; `/mi-wallet`: SOLO descripción (R27, no nombra a nadie de Ordenex)", () => {
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.oficina).toBe("Buscar por descripción o quién registró");
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda).toBe("Buscar por descripción");
    expect(ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda).not.toMatch(/registr/i);
  });
});

describe("463 R48 — sin la sigla «SLA» ni jerga técnica en los textos nuevos", () => {
  const TEXTOS_NUEVOS: string[] = [
    ...Object.values(ZONA_WALLET_TEXTO),
    ...Object.values(ZONA_LIBRO_TEXTO),
    ORDEN_LIBRO.nombre,
    ...ORDEN_LIBRO.opciones.map((o) => o.etiqueta),
    BUSCADOR_LIBRO_CAJA_PLACEHOLDER,
    ESTADO_CUENTA_TEXTO.buscarPlaceholder.oficina,
    ESTADO_CUENTA_TEXTO.buscarPlaceholder.tienda,
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
