// FICHA 403/T14 — el formateador de fecha compartido de `Configuración › API`
// (`app/(app)/configuracion/api/_components/fecha-legible.ts`).
//
// Existe porque el formato lo usan DOS sitios: la columna «Fecha de creación» de la tabla de API
// keys y el aviso de envíos espaciados de `WebhookAccionCell`. Lo que se vigila aquí es el
// CONTRATO del módulo, no el literal que produce `Intl` (que depende del ICU y de la zona de la
// máquina, y afirmarlo a mano sería un test que miente en otra máquina):
//
//   1. que una fecha interpretable devuelva algo legible por una persona y NO el ISO crudo;
//   2. que dé lo mismo recibir un `Date` que su string ISO (el borde Server Action → cliente
//      manda una cosa u otra según el caso, y por eso el módulo coacciona);
//   3. que una fecha NO interpretable devuelva `null` — el caso vacío, que es el que decide si
//      la tabla puede pintar su `—` en vez de un «Invalid Date».
import { describe, it, expect } from "vitest";

import { formatFechaHoraLegible } from "@/app/(app)/configuracion/api/_components/fecha-legible";

const ISO = "2026-09-09T13:05:00.000Z";

describe("formatFechaHoraLegible (403/T14)", () => {
  it("una fecha válida se lee como fecha, no como el ISO que entró", () => {
    const salida = formatFechaHoraLegible(new Date(ISO));

    expect(salida).not.toBeNull();
    expect(salida).not.toContain(ISO);
    expect(salida).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    // Fecha corta + hora corta: los dos trozos, no solo el día. El año va con los dígitos que
    // le dé el `dateStyle: "short"` de es-EC (hoy dos: «9/9/26, 8:05 a. m.»), así que se afirma
    // la FORMA día/mes/año + hora, no el ancho del año, que es cosa del ICU y no del contrato.
    expect(salida).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/);
    expect(salida).toMatch(/\d{1,2}:\d{2}/);
  });

  it("da lo mismo un `Date` que su string ISO (el borde manda las dos formas)", () => {
    expect(formatFechaHoraLegible(ISO)).toBe(
      formatFechaHoraLegible(new Date(ISO)),
    );
  });

  it("EL CASO VACÍO: una fecha no interpretable devuelve `null`, nunca «Invalid Date»", () => {
    for (const basura of ["", "no-es-una-fecha", "2026-13-45T99:99:99Z"]) {
      expect(formatFechaHoraLegible(basura)).toBeNull();
    }
    expect(formatFechaHoraLegible(new Date(Number.NaN))).toBeNull();
  });
});
