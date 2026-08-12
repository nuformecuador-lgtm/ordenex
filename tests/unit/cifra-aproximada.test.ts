import { describe, it, expect } from "vitest";

import { aproximarADecenas } from "@/lib/utils/cifra-aproximada";

// Feature 198 — la regla de redondeo de las cifras publicas de la landing.
//
// Es una funcion de cuatro lineas con MAS casos borde que ramas, y a proposito: alimenta la
// portada publica, donde un numero mal aproximado no lo ve un operador que sepa interpretarlo
// sino cualquiera que llegue de fuera.

describe("aproximarADecenas", () => {
  it("baja al multiplo de 10 anterior y marca el recorte con `+`", () => {
    // Decision humana del 2026-08-11: decenas SIEMPRE, no la potencia de 10 anterior.
    // Si esto se pusiera en {valor: 100} alguien cambio el criterio: 128 anuncia «+120».
    expect(aproximarADecenas(128)).toEqual({ valor: 120, prefijo: "+" });
    expect(aproximarADecenas(123)).toEqual({ valor: 120, prefijo: "+" });
    expect(aproximarADecenas(1450)).toEqual({ valor: 1450, prefijo: "+" });
  });

  it("un multiplo exacto conserva el `+`, porque sigue siendo cierto", () => {
    // «+120» con 120 reales no miente: hay 120 O MAS. Quitar el `+` solo en este caso haria
    // que la landing cambiara de formato al azar segun el ultimo distrito dado de alta.
    expect(aproximarADecenas(120)).toEqual({ valor: 120, prefijo: "+" });
  });

  it("por debajo de 10 NO aproxima ni pone `+`", () => {
    // EL CASO QUE JUSTIFICA EL UMBRAL: con 7 distritos, redondear daria 0 y la portada
    // anunciaria «+0 con cobertura». Se pinta el 7 exacto, y sin `+` porque no esconde nada.
    expect(aproximarADecenas(7)).toEqual({ valor: 7, prefijo: "" });
    expect(aproximarADecenas(9)).toEqual({ valor: 9, prefijo: "" });
    expect(aproximarADecenas(10)).toEqual({ valor: 10, prefijo: "+" });
  });

  it("colapsa a 0 lo que no es un conteo valido", () => {
    // La landing NO puede caerse por un contador: ante basura se pinta un 0 mudo, no un NaN.
    expect(aproximarADecenas(0)).toEqual({ valor: 0, prefijo: "" });
    expect(aproximarADecenas(-5)).toEqual({ valor: 0, prefijo: "" });
    expect(aproximarADecenas(Number.NaN)).toEqual({ valor: 0, prefijo: "" });
    expect(aproximarADecenas(Number.POSITIVE_INFINITY)).toEqual({ valor: 0, prefijo: "" });
  });
});
