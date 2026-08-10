// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { RespuestaFinanciera } from "@/lib/types/analitica-financiera";

import { prepararExportFinanciero } from "@/app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera";
import { FILTRO_FINANCIERO_POR_DEFECTO } from "@/app/(app)/analitica/_components/financiero/rango";

import { dtoTemporalConNeto, idDeLaUnicaVista } from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T4.2). R1 y R2. LA PUERTA ES UNA.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// El aviso de la 122 §7, traducido: un archivo no es una pantalla. Si el export tuviera su propio
// camino a los datos, tendria su propio control de permisos, su propio parseo y su propia forma
// de olvidarse de registrar el denegado — el agujero que la 176 evito REUSANDO `denegar()` en vez
// de duplicarlo.
//
// Aqui la accion se ESPIA (no se ejecuta): lo que se juzga es que el export pida sus datos por esa
// puerta, cuantas veces y CON QUE. Que la accion haga bien su trabajo lo prueban los tests de la
// 127; que este consumidor no se invente otro camino, este.
//
// LA ASERCION DE R2 ES DE IDENTIDAD REFERENCIAL (`toBe`), no de igualdad estructural. Es mas
// fuerte que la de la 134 —que comparaba la traduccion del filtro— y la hace posible que el filtro
// de esta region sea una CONSTANTE CONGELADA y unica (`rango.ts`). Sustituirlo por un literal
// equivalente pasaria hoy y divergiria el dia que la 131 traiga la barra de filtros.

vi.mock("@/lib/actions/analitica-financiera", () => ({
  consultarMetricaFinanciera: vi.fn(),
}));

const accionMock = vi.mocked(consultarMetricaFinanciera);

/** El 424242 es un CENTINELA: solo existe en lo que devuelve la accion espiada. */
const BRUTO_CENTINELA = "424242.42";

const DATOS = dtoTemporalConNeto();
const VISTA_ID = idDeLaUnicaVista(DATOS);

function respuestaConCentinela(): RespuestaFinanciera {
  const vista = DATOS.vistas[0]!;
  return {
    status: "ok",
    datos: {
      ...DATOS,
      vistas: [
        {
          ...vista,
          filas: vista.filas.map((fila, indice) =>
            indice === 0
              ? { cubo: fila.cubo, importe: { ...fila.importe, bruto: BRUTO_CENTINELA } }
              : fila,
          ),
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  accionMock.mockResolvedValue(respuestaConCentinela());
});

describe("Feature 184 — analitica financiera: export de la serie (R1) · una sola puerta", () => {
  it("las filas del archivo salen de consultarMetricaFinanciera y de ninguna otra fuente", async () => {
    const preparado = await prepararExportFinanciero(DATOS.metricaId, VISTA_ID);

    // EXACTAMENTE UNA invocacion: ni una de mas (un segundo camino), ni una de menos (filas
    // servidas desde otro sitio). Y con el `metricaId` que rotula la seccion.
    expect(accionMock).toHaveBeenCalledTimes(1);
    expect(accionMock.mock.calls[0]![0]).toBe(DATOS.metricaId);

    // Y las filas llevan el CENTINELA, que solo existe en la respuesta de la accion espiada: si
    // salieran de cualquier otro sitio, ese valor no estaria ahi.
    expect(preparado.resultado.status).toBe("ok");
    if (preparado.resultado.status !== "ok") throw new Error("no es ok");
    expect(preparado.resultado.filas[0]!.bruto).toBe(BRUTO_CENTINELA);
    expect(preparado.resultado.filas).toHaveLength(DATOS.vistas[0]!.filas.length);
  });

  it("y no hay una segunda lectura: el archivo no consulta dos veces", async () => {
    await prepararExportFinanciero(DATOS.metricaId, VISTA_ID);
    expect(accionMock).toHaveBeenCalledTimes(1);
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R2) · el MISMO objeto de filtro", () => {
  it("el filtro que envia el export es el MISMO objeto que usa la pantalla, no uno equivalente", async () => {
    await prepararExportFinanciero(DATOS.metricaId, VISTA_ID);

    const [, filtro] = accionMock.mock.calls[0]!;
    // IDENTIDAD REFERENCIAL. `toEqual` pasaria con un `{ rango: "mes" }` escrito a mano, que es
    // exactamente la mutacion que este caso existe para matar.
    expect(filtro).toBe(FILTRO_FINANCIERO_POR_DEFECTO);

    // Y es la constante CONGELADA de la region: nadie la muta por el camino.
    expect(Object.isFrozen(FILTRO_FINANCIERO_POR_DEFECTO)).toBe(true);
  });

  it("el borde se invoca con DOS argumentos: la inyeccion de deps es solo de tests (R5)", async () => {
    await prepararExportFinanciero(DATOS.metricaId, VISTA_ID);
    // Un tercer argumento desde produccion seria una SEGUNDA autoridad sobre «quien eres», que
    // es justo lo que el borde de la 127 prohibe — y ademas una funcion no cruza la frontera RSC.
    expect(accionMock.mock.calls[0]!).toHaveLength(2);
  });
});
