import { describe, it, expect } from "vitest";

import {
  CIERRE_TODOS_OPTION,
  opcionesDeCierre,
} from "@/app/(app)/mi-wallet/_components/mi-wallet-cierres";
import { fechaDiaISO } from "@/lib/utils/fecha-dia-iso";
import type { CierreTiendaOpcionDTO } from "@/lib/types/wallet-tienda";

/**
 * FICHA 335 (C4, R23/R24) — el ETIQUETADO de las opciones del selector de cierre.
 *
 * Lo que esta ficha arregla es concreto: el filtro pedía escribir un identificador interno que
 * nadie conoce. Así que lo que se afirma aquí es, sobre todo, lo que la etiqueta NO dice —el
 * uuid— y que el día que dice es el MISMO que la persona está viendo en la columna «Fecha» de
 * la tabla de al lado. Dos formatos de fecha en la misma pantalla serían un defecto nuevo.
 */

/** Un cierre del libro de la tienda, con los tres únicos datos que trae el DTO. */
function cierre(over: Partial<CierreTiendaOpcionDTO> = {}): CierreTiendaOpcionDTO {
  return {
    cierreId: "3f6a1b2c-9d4e-4a7b-8c1d-2e5f6a7b8c9d",
    fecha: "2026-07-12T14:30:00.000Z",
    movimientos: 4,
    ...over,
  };
}

/** La forma de un uuid, que es justo lo que ninguna etiqueta puede enseñar. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Las etiquetas SIN la de «todos»: las que describen un cierre concreto. */
function etiquetasDeCierre(cierres: CierreTiendaOpcionDTO[]): string[] {
  return opcionesDeCierre(cierres)
    .slice(1)
    .map((o) => o.label);
}

describe("335 / R25 — la opción de partida es «todos los cierres»", () => {
  it("va la primera y su valor es la cadena vacía (no filtrar)", () => {
    const opciones = opcionesDeCierre([cierre()]);
    expect(opciones[0]).toBe(CIERRE_TODOS_OPTION);
    expect(opciones[0].label).toBe("Todos los cierres");
    // La cadena vacía es lo que el módulo omite del input de la action, igual que las otras
    // tres claves del filtro. Un `"todos"` literal viajaría como un `cierreId` inexistente.
    expect(opciones[0].value).toBe("");
  });

  it("con la lista vacía queda solo esa opción: no se inventa ninguna", () => {
    expect(opcionesDeCierre([])).toEqual([CIERRE_TODOS_OPTION]);
  });
});

describe("335 / R23 — la etiqueta dice el día y el número de movimientos, nunca el identificador", () => {
  it("la etiqueta lleva el día y el número de movimientos, y NO lleva el identificador", () => {
    const [etiqueta] = etiquetasDeCierre([cierre()]);

    expect(etiqueta).toBe("Cierre del 2026-07-12 · 4 movimientos");
    expect(etiqueta).not.toMatch(UUID);
    expect(etiqueta).not.toContain("3f6a1b2c");
  });

  it("CONTROL: el identificador SÍ viaja, pero en el `value`, que es lo que el filtro usa", () => {
    // Sin esto, una implementación que perdiera el `cierreId` pasaría el caso de arriba: no
    // enseñar el uuid es fácil si además no lo mandas.
    const [, opcion] = opcionesDeCierre([cierre()]);
    expect(opcion.value).toBe("3f6a1b2c-9d4e-4a7b-8c1d-2e5f6a7b8c9d");
    expect(opcion.value).toMatch(UUID);
  });

  it("ninguna etiqueta enseña el identificador, sea cual sea el conjunto", () => {
    const etiquetas = etiquetasDeCierre([
      cierre({ cierreId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }),
      cierre({ cierreId: "11111111-2222-4333-8444-555555555555", fecha: "2026-08-01T09:00:00.000Z" }),
    ]);
    expect(etiquetas.filter((e) => UUID.test(e))).toEqual([]);
    expect(etiquetas).toHaveLength(2); // control de no-vacuidad del filtro de arriba
  });

  it("el día es el MISMO que pinta la columna «Fecha» de la tabla", () => {
    // No se compara contra un literal escrito a mano: se compara contra `fechaDiaISO`, la MISMA
    // función que usa la descarga y que produce el mismo día que el `slice(0, 10)` de la
    // columna. ⚠️ Los dos son el día UTC: un formateador de calendario local haría que la
    // opción dijera un día y las filas de al lado otro.
    const instante = "2026-07-12T23:45:00.000Z";
    const [etiqueta] = etiquetasDeCierre([cierre({ fecha: instante })]);

    expect(etiqueta).toContain(fechaDiaISO(instante));
    // Y la tabla, con el mismo instante, pinta exactamente eso.
    expect(fechaDiaISO(instante)).toBe(instante.slice(0, 10));
  });
});

describe("335 / R24 — dos cierres del mismo día se distinguen entre ellos", () => {
  it("dos cierres del MISMO día con el MISMO número de movimientos producen etiquetas distintas", () => {
    // El caso real: un `cierre_dia` es POR MENSAJERO, así que varios caen el mismo día y pueden
    // traer el mismo número de movimientos para la misma tienda. Sin desempate, la persona vería
    // dos opciones idénticas y no sabría cuál está eligiendo.
    const etiquetas = etiquetasDeCierre([
      cierre({ cierreId: "c1", fecha: "2026-07-12T14:30:00.000Z", movimientos: 4 }),
      cierre({ cierreId: "c2", fecha: "2026-07-12T18:05:00.000Z", movimientos: 4 }),
    ]);

    expect(etiquetas[0]).not.toBe(etiquetas[1]);
    expect(new Set(etiquetas).size).toBe(2);
    // La hora entra en LAS DOS, no solo en la segunda: marcar únicamente a la repetida haría
    // creer que la primera es «la del día» y la otra una excepción.
    expect(etiquetas[0]).toBe("Cierre del 2026-07-12 14:30 · 4 movimientos");
    expect(etiquetas[1]).toBe("Cierre del 2026-07-12 18:05 · 4 movimientos");
  });

  it("mismo día pero distinto número de movimientos: NO hace falta la hora", () => {
    // El conteo ya los distingue, que es exactamente para lo que el DTO lo trae.
    const etiquetas = etiquetasDeCierre([
      cierre({ cierreId: "c1", fecha: "2026-07-12T14:30:00.000Z", movimientos: 4 }),
      cierre({ cierreId: "c2", fecha: "2026-07-12T18:05:00.000Z", movimientos: 7 }),
    ]);

    expect(etiquetas).toEqual([
      "Cierre del 2026-07-12 · 4 movimientos",
      "Cierre del 2026-07-12 · 7 movimientos",
    ]);
  });

  it("CONTRAPRUEBA: cuando no hay colisión, la etiqueta NO lleva hora", () => {
    // La hora se añade SOLO donde hace falta. Ponerla siempre sería ruido en el caso común (un
    // cierre por día) y este caso es el que impide esa deriva.
    const etiquetas = etiquetasDeCierre([
      cierre({ cierreId: "c1", fecha: "2026-07-12T14:30:00.000Z", movimientos: 4 }),
      cierre({ cierreId: "c2", fecha: "2026-08-01T09:15:00.000Z", movimientos: 4 }),
    ]);

    for (const etiqueta of etiquetas) {
      expect(etiqueta).not.toMatch(/\d{2}:\d{2}/);
    }
    expect(etiquetas).toEqual([
      "Cierre del 2026-07-12 · 4 movimientos",
      "Cierre del 2026-08-01 · 4 movimientos",
    ]);
  });

  it("LÍMITE DECLARADO: dos cierres del mismo MINUTO siguen con la misma etiqueta, pero no el mismo valor", () => {
    // La hora colapsa al minuto. Lo que se pierde es poder distinguirlos de un vistazo; el
    // filtro sigue funcionando porque los `value` son distintos. Se afirma para que el día que
    // alguien decida bajar al segundo, sepa que aquí estaba escrito y por qué.
    const opciones = opcionesDeCierre([
      cierre({ cierreId: "c1", fecha: "2026-07-12T14:30:10.000Z", movimientos: 4 }),
      cierre({ cierreId: "c2", fecha: "2026-07-12T14:30:55.000Z", movimientos: 4 }),
    ]).slice(1);

    expect(opciones[0].label).toBe(opciones[1].label);
    expect(opciones[0].value).not.toBe(opciones[1].value);
  });
});

describe("335 / R20 — el cardinal se escribe en palabras", () => {
  it("singular/plural: 1 movimiento / 4 movimientos", () => {
    expect(etiquetasDeCierre([cierre({ movimientos: 1 })])[0]).toBe(
      "Cierre del 2026-07-12 · 1 movimiento",
    );
    expect(etiquetasDeCierre([cierre({ movimientos: 4 })])[0]).toBe(
      "Cierre del 2026-07-12 · 4 movimientos",
    );
    // Cero es plural en español, y es un estado alcanzable solo en teoría (la lectura sale del
    // propio libro, así que todo cierre ofrecido rinde al menos una fila). Se fija igual.
    expect(etiquetasDeCierre([cierre({ movimientos: 0 })])[0]).toBe(
      "Cierre del 2026-07-12 · 0 movimientos",
    );
  });

  it("ninguna etiqueta usa jerga interna ni nombres de campo", () => {
    const etiquetas = etiquetasDeCierre([cierre(), cierre({ fecha: "2026-08-01T09:00:00.000Z" })]);
    for (const etiqueta of etiquetas) {
      for (const jerga of ["cierre_dia", "origen_id", "origen_tipo", "UUID", "ID", "SLA"]) {
        expect(etiqueta, `la etiqueta nombra «${jerga}»`).not.toContain(jerga);
      }
    }
  });
});

describe("335 — el orden de las opciones es el que llega, sin reordenar", () => {
  it("respeta el orden del servidor (más reciente primero) en vez de reordenar por su cuenta", () => {
    // La lista viene YA ordenada y recortada del servicio. Reordenar aquí sería una segunda
    // opinión sobre el mismo criterio, y la del cliente no ve lo que quedó fuera del tope.
    const opciones = opcionesDeCierre([
      cierre({ cierreId: "c-nuevo", fecha: "2026-08-01T09:00:00.000Z" }),
      cierre({ cierreId: "c-viejo", fecha: "2026-07-12T14:30:00.000Z" }),
    ]);
    expect(opciones.map((o) => o.value)).toEqual(["", "c-nuevo", "c-viejo"]);
  });
});
