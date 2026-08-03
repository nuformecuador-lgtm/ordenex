import { describe, it, expect } from "vitest";

import {
  MAX_SERIES,
  SeriesExcedidasError,
  aplicarTopeSeries,
  prepararSeries,
} from "@/components/private/analytics/topes";
import type { VistaFinanciera } from "@/lib/types/analitica-financiera";
import {
  COLUMNAS_IMPORTE,
  aNumero,
  agruparCola,
  filasDeVista,
  serieDeVista,
} from "@/app/(app)/analitica/_components/financiero/adaptar";

// Feature 132 (T2.1, T2.2, T2.3) — los adaptadores puros del tablero financiero.
//
// Los tres comportamientos que se verifican aqui son los tres sitios donde esta
// feature podria mentir sobre el dinero sin que nada mas lo note:
//   1. convertir un importe ilegible en `0` (R15),
//   2. pintar una cifra que no esta literalmente en el DTO (R14, R16, R24),
//   3. recortar categorias perdiendo parte del total (R20, R21).

const ETIQUETA_COLA = "Resto";

/** Un id opaco de tienda, tal como lo entrega el servicio: sin nombre legible. */
const CUBO_OPACO = "clx8s7q0000tienda";

function importe(bruto: string, neto: string) {
  // La `moneda` viaja en el DTO pero NINGUN adaptador la lee: el formato lo
  // resuelve el paquete de la 130 a partir de `lib/config/moneda.ts` (R25). Se
  // rellena con un marcador precisamente para que un adaptador que la leyera
  // pintara basura visible en vez de acertar por casualidad.
  return { bruto, neto, moneda: "moneda-que-nadie-lee" } as const;
}

function vistaDeEjemplo(): VistaFinanciera {
  return {
    id: "cod_recaudado__por_tienda",
    grano: "tienda",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    filas: [
      { cubo: CUBO_OPACO, importe: importe("1234567.89", "1200000.00") },
      { cubo: "clx8s7q0001tienda", importe: importe("500.25", "-123.45") },
      { cubo: "clx8s7q0002tienda", importe: importe("0.00", "0.00") },
    ],
    total: importe("1235068.14", "1199876.55"),
  };
}

function vistaConCubos(cantidad: number): VistaFinanciera {
  return {
    id: "cod_recaudado__por_tienda",
    grano: "tienda",
    fuente: "wallet_tienda_movimiento",
    sumableCon: [],
    filas: Array.from({ length: cantidad }, (_, indice) => ({
      cubo: `${CUBO_OPACO}${indice}`,
      importe: importe(`${(indice + 1) * 100}.00`, `${(indice + 1) * 90}.00`),
    })),
    total: importe("0.00", "0.00"),
  };
}

function sumaDe(puntos: readonly { valor: number | null }[]): number {
  return puntos.reduce((total, punto) => total + (punto.valor ?? 0), 0);
}

/* -------------------------------------------------------------------------- */
/* R15 · un importe ilegible es un dato AUSENTE, nunca un cero                 */
/* -------------------------------------------------------------------------- */

describe("R15 · un importe que no se puede leer se pinta como ausente y no como cero", () => {
  it("un importe valido conserva su valor, incluido el cero explicito y el negativo", () => {
    expect(aNumero("0.00")).toBe(0);
    expect(aNumero("-123.45")).toBe(-123.45);
    expect(aNumero("1234567.89")).toBe(1234567.89);
  });

  it("una cadena vacia no vale cero: no hay dato que afirmar", () => {
    // `Number("")` vale 0 en JavaScript. Si el adaptador se apoyara en esa
    // conversion, un importe que el servicio no pudo producir apareceria en
    // pantalla como "no hubo movimiento", que es una afirmacion distinta.
    expect(aNumero("")).toBeNull();
    expect(aNumero("")).not.toBe(0);
  });

  it("una cadena de solo espacios tampoco vale cero", () => {
    expect(aNumero(" ")).toBeNull();
    expect(aNumero(" ")).not.toBe(0);
  });

  it("un texto que no es un numero se marca como ausente", () => {
    expect(aNumero("abc")).toBeNull();
    expect(aNumero("abc")).not.toBe(0);
  });

  it("el literal NaN se marca como ausente y no se cuela como numero", () => {
    const resultado = aNumero("NaN");
    expect(resultado).toBeNull();
    expect(resultado).not.toBe(0);
    expect(Number.isNaN(resultado as unknown as number)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R14, R16, R24 · cada cifra pintada viene literalmente del DTO              */
/* -------------------------------------------------------------------------- */

describe("R14, R16, R24 · la serie de una vista pinta los importes del DTO sin derivar nada", () => {
  it("cada punto lleva el valor del campo pedido de su propia fila", () => {
    const vista = vistaDeEjemplo();
    const serie = serieDeVista(vista, "bruto");

    expect(serie.puntos).toHaveLength(vista.filas.length);
    serie.puntos.forEach((punto, indice) => {
      expect(punto.valor).toBe(Number(vista.filas[indice]!.importe.bruto));
    });
  });

  it("el bruto y el neto producen series distintas e identificables", () => {
    const vista = vistaDeEjemplo();
    const bruto = serieDeVista(vista, "bruto");
    const neto = serieDeVista(vista, "neto");

    expect(bruto.id).not.toBe(neto.id);
    expect(bruto.id).toBe(`${vista.id}__bruto`);
    expect(neto.id).toBe(`${vista.id}__neto`);
    expect(bruto.etiqueta).toBe("bruto");
    expect(neto.etiqueta).toBe("neto");
    expect(neto.puntos[1]?.valor).toBe(-123.45);
    expect(bruto.puntos[1]?.valor).toBe(500.25);
  });

  it("el cubo se copia tal cual, sin traducirlo ni acortarlo", () => {
    const serie = serieDeVista(vistaDeEjemplo(), "neto");
    expect(serie.puntos[0]?.categoria).toBe(CUBO_OPACO);
  });

  it("un importe ilegible en una fila deja esa celda ausente sin tumbar las demas", () => {
    const vista: VistaFinanciera = {
      ...vistaDeEjemplo(),
      filas: [
        { cubo: CUBO_OPACO, importe: importe("10.00", "10.00") },
        { cubo: "roto", importe: importe("", "no-es-un-numero") },
        { cubo: "clx8s7q0002tienda", importe: importe("30.00", "30.00") },
      ],
    };
    const serie = serieDeVista(vista, "bruto");

    expect(serie.puntos.map((punto) => punto.valor)).toEqual([10, null, 30]);
  });
});

describe("R14, R16, R24 · las filas de la tabla llevan bruto y neto de la misma fila del DTO", () => {
  it("hay una fila por fila del DTO y las dos cifras son las del contrato", () => {
    const vista = vistaDeEjemplo();
    const filas = filasDeVista(vista);

    expect(filas).toHaveLength(vista.filas.length);
    filas.forEach((fila, indice) => {
      const origen = vista.filas[indice]!;
      expect(fila.id).toBe(origen.cubo);
      expect(fila.categoria).toBe(origen.cubo);
      expect(fila.valores.bruto).toBe(Number(origen.importe.bruto));
      expect(fila.valores.neto).toBe(Number(origen.importe.neto));
    });
  });

  it("las dos columnas de importe se declaran una sola vez y son distinguibles entre si", () => {
    const ids = COLUMNAS_IMPORTE.map((columna) => columna.id);
    expect(ids).toEqual(["bruto", "neto"]);
    expect(COLUMNAS_IMPORTE[0]?.etiqueta).not.toBe(COLUMNAS_IMPORTE[1]?.etiqueta);
    for (const columna of COLUMNAS_IMPORTE) {
      expect(columna.unidad).toBe("moneda");
    }
  });

  it("una fila con importe ilegible queda ausente en sus dos columnas y no en cero", () => {
    const vista: VistaFinanciera = {
      ...vistaDeEjemplo(),
      filas: [{ cubo: CUBO_OPACO, importe: importe("abc", "") }],
    };
    const [fila] = filasDeVista(vista);

    expect(fila?.valores.bruto).toBeNull();
    expect(fila?.valores.neto).toBeNull();
    expect(fila?.valores.bruto).not.toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* R20, R21 · la cola se agrupa y el total se conserva                        */
/* -------------------------------------------------------------------------- */

describe("R20, R21 · agrupar la cola respeta el techo del paquete sin perder dinero", () => {
  it("doce cubos con techo cinco quedan en cinco categorias, la ultima con la etiqueta del llamador", () => {
    const puntos = serieDeVista(vistaConCubos(12), "bruto").puntos;
    const agrupados = agruparCola(puntos, 5, ETIQUETA_COLA);

    expect(agrupados).toHaveLength(5);
    expect(agrupados[4]?.categoria).toBe(ETIQUETA_COLA);
    expect(agrupados.slice(0, 4).map((punto) => punto.categoria)).toEqual(
      puntos.slice(0, 4).map((punto) => punto.categoria),
    );
  });

  it("la suma de lo que se pinta es la suma de lo que se recibio", () => {
    const puntos = serieDeVista(vistaConCubos(12), "bruto").puntos;
    const agrupados = agruparCola(puntos, 5, ETIQUETA_COLA);

    expect(sumaDe(agrupados)).toBeCloseTo(sumaDe(puntos), 6);
  });

  it("por debajo del techo no se toca nada", () => {
    const puntos = serieDeVista(vistaConCubos(3), "bruto").puntos;
    expect(agruparCola(puntos, 5, ETIQUETA_COLA)).toEqual(puntos);
  });

  it("una cola entera sin dato produce una categoria ausente, no una que vale cero", () => {
    const puntos = [
      { categoria: "a", valor: 10 },
      { categoria: "b", valor: 20 },
      { categoria: "c", valor: null },
      { categoria: "d", valor: null },
    ];
    const agrupados = agruparCola(puntos, 3, ETIQUETA_COLA);

    expect(agrupados).toHaveLength(3);
    expect(agrupados[2]?.categoria).toBe(ETIQUETA_COLA);
    expect(agrupados[2]?.valor).toBeNull();
    expect(agrupados[2]?.valor).not.toBe(0);
  });

  it("sin puntos no se inventa una categoria de cola", () => {
    expect(agruparCola([], 5, ETIQUETA_COLA)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R20 (T2.3) · integracion con los topes REALES del paquete                  */
/* -------------------------------------------------------------------------- */

describe("R20 · con la cola agrupada el paquete acepta la serie; sin agrupar, revienta", () => {
  it("el entorno de este test no es produccion, que es donde los topes lanzan", () => {
    // La politica del paquete depende de `NODE_ENV`: fuera de produccion LANZA y
    // en produccion recorta en silencio. Si esta suite corriera como produccion,
    // los dos casos de abajo pasarian sin medir nada.
    expect(process.env.NODE_ENV).not.toBe("production");
  });

  it("doce cubos agrupados al tope del paquete pasan por prepararSeries sin lanzar", () => {
    const serie = serieDeVista(vistaConCubos(12), "bruto");
    const acotada = {
      ...serie,
      puntos: agruparCola(serie.puntos, MAX_SERIES, ETIQUETA_COLA),
    };

    const preparadas = prepararSeries([acotada]);
    expect(preparadas.series[0]?.puntos).toHaveLength(MAX_SERIES);
    expect(preparadas.recorteSeries.recortado).toBe(false);
    expect(preparadas.recortePuntos.recortado).toBe(false);
  });

  it("los mismos doce cubos SIN agrupar desbordan el techo de segmentos del donut", () => {
    // Contrapeso: `GraficaDonut` aplica `MAX_SERIES` a los SEGMENTOS de la unica
    // serie que pinta (`GraficaDonut.tsx:25-37`), asi que doce cubos crudos
    // lanzan. Sin esta asercion, el caso anterior podria estar pasando porque el
    // tope no se aplica en ningun sitio.
    const serie = serieDeVista(vistaConCubos(12), "bruto");
    expect(() => aplicarTopeSeries(serie.puntos)).toThrow(SeriesExcedidasError);
  });
});
