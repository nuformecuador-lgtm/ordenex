import { describe, it, expect } from "vitest";

import { montoValido } from "@/app/(app)/wallet/_components/wallet-labels";
import { INDEMNIZACION_MONTO_MAX } from "@/lib/types/cierres-admin";

// Feature 158 (m5 del review) — el TOPE de `montoValido` en el cliente, con su frontera EXACTA.
//
// Por qué existe este archivo y no basta con el test de componente: la comparación es por
// TEXTO (money-safe, sin `parseFloat`: un monto de 11 dígitos no cabe exacto en un `number`,
// y comparar así podría aceptar justo el valor que se quiere rechazar). Una comparación de
// texto tiene casos de borde propios —ceros a la izquierda, decimales ausentes, ceros a la
// derecha— que el sub-modal no puede ejercitar uno a uno sin volverse ilegible.
//
// Descubierto por MUTACIÓN, y por eso está escrito: quitar el rellenado de decimales a 2
// dígitos NO ponía rojo ningún test, porque con un máximo terminado en `.99` la comparación
// truncada da el mismo resultado por casualidad. El caso «5.10 vs 5.1» de abajo es el que la
// caza: con un máximo terminado en 0, la comparación sin rellenar rechaza un monto IGUAL al
// máximo. El tope de hoy no lo sufre; el de mañana, si cambia la precisión de la columna,
// podría — y este test lo impediría.

describe("m5 — la frontera del tope es EXACTA", () => {
  it("el máximo sale de la columna `DECIMAL(12,2)` y vale 9999999999.99", () => {
    expect(INDEMNIZACION_MONTO_MAX).toBe("9999999999.99");
  });

  it("el máximo EXACTO se acepta", () => {
    expect(montoValido(INDEMNIZACION_MONTO_MAX, INDEMNIZACION_MONTO_MAX)).toBe(true);
  });

  it("un céntimo por encima se rechaza", () => {
    expect(montoValido("10000000000.00", INDEMNIZACION_MONTO_MAX)).toBe(false);
  });

  it.each([
    ["justo por debajo", "9999999999.98"],
    ["sin decimales", "9999999999"],
    ["un decimal", "9999999999.9"],
    ["con ceros a la izquierda (no fingen desbordar)", "00009999999999.99"],
    ["un monto normal", "12500.00"],
  ])("acepta %s (`%s`)", (_caso, valor) => {
    expect(montoValido(valor, INDEMNIZACION_MONTO_MAX)).toBe(true);
  });

  it.each([
    ["un dígito de más", "99999999999.99"],
    ["muchísimo de más", "123456789012345.67"],
    ["11 dígitos justos", "10000000000"],
  ])("rechaza %s (`%s`)", (_caso, valor) => {
    expect(montoValido(valor, INDEMNIZACION_MONTO_MAX)).toBe(false);
  });
});

describe("m5 — la comparación por TEXTO es correcta en sus bordes", () => {
  it("dos montos numéricamente IGUALES con distintos ceros a la derecha se aceptan", () => {
    // 5.10 <= 5.1 es CIERTO (son el mismo número). Sin rellenar los decimales a 2 dígitos,
    // "10" > "1" lexicográficamente y se rechazaría un monto igual al máximo.
    expect(montoValido("5.10", "5.1")).toBe(true);
    expect(montoValido("5.1", "5.10")).toBe(true);
    expect(montoValido("5", "5.00")).toBe(true);
    expect(montoValido("5.00", "5")).toBe(true);
  });

  it("manda la cantidad de dígitos enteros, no el orden alfabético", () => {
    // "10" < "9" alfabéticamente, pero 10 > 9. Comparar sin mirar la longitud aceptaría un
    // monto mayor que el máximo.
    expect(montoValido("10", "9.99")).toBe(false);
    expect(montoValido("9.99", "10")).toBe(true);
    expect(montoValido("100", "99")).toBe(false);
  });

  it("los ceros a la izquierda no cuentan como dígitos", () => {
    expect(montoValido("0009", "10")).toBe(true);
    expect(montoValido("0010", "9")).toBe(false);
  });

  it("el formato sigue mandando: el tope no relaja ninguna regla previa", () => {
    for (const invalido of ["", "0", "0.00", "-5.00", "10.005", "10,50", "mucho", "1e3"]) {
      expect(montoValido(invalido, INDEMNIZACION_MONTO_MAX), `aceptó "${invalido}"`).toBe(false);
    }
  });
});

describe("m5 — sin `max`, el comportamiento de la wallet (42/45) NO cambia", () => {
  it("un monto enorme sigue siendo válido para quien no pasa tope", () => {
    // `montoValido` la comparten los formularios de egreso/plantilla de la wallet, cuyo
    // schema de servidor (`montoPositivoSchema`) NO tiene tope. Aplicárselo sin pedirlo
    // dejaría al cliente más estricto que su propio servidor: bloquearía montos que el
    // backend acepta. Por eso el tope es un parámetro OPCIONAL y no una regla nueva.
    expect(montoValido("10000000000.00")).toBe(true);
    expect(montoValido("123456789012345.67")).toBe(true);
  });

  it("y sus reglas de siempre siguen intactas", () => {
    expect(montoValido("125.50")).toBe(true);
    expect(montoValido("0.00")).toBe(false);
    expect(montoValido("10,50")).toBe(false);
  });
});
