import { describe, it, expect } from "vitest";

import { agruparCola } from "@/app/(app)/analitica/_components/financiero/adaptar";
import { filasDeVistaFinanciera } from "@/app/(app)/analitica/_components/export-financiero/export-financiero";
import type { FilaFinanciera, VistaFinanciera } from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";

import { cubosDe, dtoTemporalConNeto, MONEDA_DE_FIXTURE } from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T3.2). R19 y R20.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// EQUIVALENCIA PANTALLA-ARCHIVO: ni una fila de mas ni una de menos que las que el DTO trae, en
// el orden recibido. La tentacion RAZONABLE que esto impide es «limpiar» el archivo: quitar los
// cubos en cero produce un fichero mas bonito y una mentira por omision. La serie de la 180 es
// DENSA A PROPOSITO (⟨D3⟩ de aquella feature): una fila por cubo del rango, incluidos los cubos
// sin movimiento, y ese cero ES UN DATO.
//
// Y `agruparCola` NO se aplica (⟨D7⟩ de la 186): «Otros» no significa nada en un eje de tiempo,
// se comeria el FINAL de la serie —que es justo lo que se mira— y esconderia el dia en que la
// garantia del servidor sobre el numero de puntos se rompa.

/** Una vista con un cero de verdad en medio: es la fila que un «limpiador» borraria. */
function vistaConCeroEnMedio(): { datos: ReturnType<typeof dtoTemporalConNeto>; vista: VistaFinanciera } {
  const datos = dtoTemporalConNeto();
  const original = datos.vistas[0]!;
  const filas: FilaFinanciera[] = original.filas.map((fila, indice) =>
    indice === 3 ? { cubo: fila.cubo, importe: importeConNeto("0.00", "0.00", MONEDA_DE_FIXTURE) } : fila,
  );
  return { datos, vista: { ...original, filas } };
}

describe("Feature 184 — analitica financiera: export de la serie (R19) · fila por fila", () => {
  it("las filas del archivo son fila por fila las del DTO que pinta la pantalla", () => {
    const datos = dtoTemporalConNeto();
    const vista = datos.vistas[0]!;
    const filas = filasDeVistaFinanciera(datos, vista);

    // Misma CARDINALIDAD y mismo ORDEN que la serie densa del rango, derivada del mismo troceo
    // que usa el servicio.
    expect(filas).toHaveLength(vista.filas.length);
    expect(filas.map((fila) => fila.periodo)).toEqual([...cubosDe()]);
    expect(filas.map((fila) => fila.bruto)).toEqual(
      vista.filas.map((fila) => fila.importe.bruto),
    );
  });

  it("un cubo en cero sigue siendo una fila del archivo: la serie es densa a proposito", () => {
    const { datos, vista } = vistaConCeroEnMedio();
    const filas = filasDeVistaFinanciera(datos, vista);

    expect(filas).toHaveLength(vista.filas.length);
    expect(filas[3]!.bruto).toBe("0.00");
    // Y sigue estando EN SU SITIO: filtrarlo desplazaria todo lo que viene detras.
    expect(filas[3]!.periodo).toBe(vista.filas[3]!.cubo);
    expect(filas.filter((fila) => fila.bruto === "0.00")).toHaveLength(1);
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R20) · ni orden, ni cola, ni relleno", () => {
  it("el export no reordena, no agrupa la cola ni rellena cubos", () => {
    const datos = dtoTemporalConNeto();
    const vista = datos.vistas[0]!;
    const filas = filasDeVistaFinanciera(datos, vista);

    // (1) NO se reordena: el orden es el del DTO, no el de la cifra.
    const periodos = filas.map((fila) => fila.periodo);
    expect(periodos).toEqual(vista.filas.map((fila) => fila.cubo));
    expect(periodos).not.toEqual([...periodos].sort((a, b) => String(b).localeCompare(String(a))));

    // (2) NO se agrupa la cola. Se compara contra lo que `agruparCola` HARIA con el mismo techo
    // que el tablero aplica a sus graficas: si alguien lo aplicara aqui, las ultimas fechas
    // desaparecerian detras de una categoria «Otros» que en un eje de tiempo no significa nada.
    const conCola = agruparCola(
      vista.filas.map((fila) => ({ categoria: fila.cubo, valor: 1 })),
      6,
      "Otros",
    );
    expect(conCola.length).toBeLessThan(vista.filas.length); // sanidad: el techo recorta de verdad
    expect(periodos).not.toContain("Otros");
    expect(filas.length).toBeGreaterThan(conCola.length);

    // (3) NO se rellena ni se fusiona: no hay claves repetidas ni claves que el DTO no trajera.
    expect(new Set(periodos).size).toBe(periodos.length);
    const delDto = new Set(vista.filas.map((fila) => fila.cubo));
    for (const periodo of periodos) expect(delDto.has(String(periodo))).toBe(true);
  });

  it("ninguna celda sustituye un valor por 0 ni por un texto de relleno", () => {
    const datos = dtoTemporalConNeto();
    const filas = filasDeVistaFinanciera(datos, datos.vistas[0]!);
    for (const fila of filas) {
      expect(fila.bruto).not.toBe(0);
      expect(fila.bruto).not.toBeNull();
      expect(fila.periodo).not.toBe("");
    }
  });
});
