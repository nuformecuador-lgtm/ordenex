// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import type { EntradaOperativa } from "@/lib/actions/analitica-operativa";
import { PENUMBRA, type SerieOperativa } from "@/lib/types/analitica-operativa";

import type { PanelTablero } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import { filasDelPanel } from "@/app/(app)/analitica/_components/operativo/ExportarOperativoPanel";
import {
  aRaw,
  type FiltroTablero,
} from "@/app/(app)/analitica/_components/operativo/filtro-tablero";

// Feature 134 — R1 y R2. LA PUERTA ES UNA.
//
// El aviso de la 122 §7, traducido: un CSV no es una pantalla. Si el export tuviera su propio
// camino a los datos, tendria su propio gating, su propio parseo y su propia forma de
// olvidarse de auditar — que es exactamente el agujero que la 176 evito al REUSAR `denegar()`
// y `sondeaIdentidadDeMensajero` en vez de duplicarlos.
//
// Aqui la accion se ESPIA (no se ejecuta): lo que se juzga es que el export pida sus datos
// por esa puerta, cuantas veces y CON QUE. El que la accion haga bien su trabajo lo prueban
// los tests de la 126; el que este consumidor no se invente otro camino, este.

vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(),
}));

const accionMock = vi.mocked(consultarAnaliticaOperativa);

const RANGO = {
  preset: "semana" as const,
  desde: new Date("2026-08-01T06:00:00.000Z"),
  hasta: new Date("2026-08-04T06:00:00.000Z"),
  desdeFecha: "2026-08-01",
  hastaFecha: "2026-08-03",
};

/** El 4242 es un CENTINELA: solo existe en lo que devuelve la accion espiada. */
function serieCon(metricaId: string, valor: number): SerieOperativa {
  return {
    metricaId,
    unidad: "conteo",
    unidadDeConteo: "gestion",
    rango: RANGO,
    puntos: [{ fecha: "2026-08-01", dimension: "entregada", valor }],
    cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
  };
}

/** Panel de DOS metricas y CON desagregacion: los dos rasgos que R1/R2 vigilan. */
const PANEL: PanelTablero = {
  id: "resultado-gestiones",
  titulo: "Resultado de las gestiones",
  grafica: "barras",
  metricas: [
    { metricaId: "entregas", etiqueta: "Entregas" },
    { metricaId: "devoluciones", etiqueta: "Devoluciones" },
  ],
  desagregacion: "estatus",
};

/**
 * Filtro NO trivial a proposito: con listas y con un preset. Un filtro por defecto haria
 * pasar cualquier traduccion escrita a mano, que es justo la mutacion de R2.
 */
const FILTRO: FiltroTablero = {
  rango: "mes",
  desde: "",
  hasta: "",
  zonaIds: ["z1", "z2"],
  tiendaIds: ["t7"],
  mensajeroIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  accionMock.mockImplementation(async (entrada: EntradaOperativa) => ({
    status: "ok" as const,
    datos: serieCon(entrada.metricaId, entrada.metricaId === "entregas" ? 4242 : 7),
  }));
});

describe("Feature 134 (R1) — las filas salen de la Server Action y de ninguna otra fuente", () => {
  it("las filas del CSV salen de consultarAnaliticaOperativa y de ninguna otra fuente", async () => {
    const resultado = await filasDelPanel(PANEL, FILTRO);

    // Exactamente UNA invocacion por metrica del panel: ni una consulta de mas (que seria un
    // segundo camino), ni una de menos (que seria una metrica servida desde otro sitio).
    expect(accionMock).toHaveBeenCalledTimes(PANEL.metricas.length);
    expect(accionMock.mock.calls.map((c) => c[0].metricaId)).toEqual([
      "entregas",
      "devoluciones",
    ]);

    // Y las filas llevan el CENTINELA que solo existe en la respuesta de la accion: si
    // saliera de cualquier otro sitio, el valor no estaria ahi.
    expect(resultado.status).toBe("ok");
    if (resultado.status !== "ok") throw new Error("no es ok");
    expect(resultado.filas).toHaveLength(PANEL.metricas.length);
    expect(resultado.filas.map((f) => f.valor)).toEqual([4242, 7]);
    expect(resultado.filas.map((f) => f.metrica)).toEqual(["Entregas", "Devoluciones"]);
    expect(resultado.filas.map((f) => f.dimension)).toEqual(["entregada", "entregada"]);
  });

  it("y no hay una segunda lectura por metrica: el archivo no consulta dos veces", async () => {
    await filasDelPanel(PANEL, FILTRO);
    const porMetrica = accionMock.mock.calls.map((c) => c[0].metricaId);
    expect(new Set(porMetrica).size).toBe(porMetrica.length);
  });
});

describe("Feature 134 (R2) — el export manda el MISMO filtro que el panel", () => {
  it("el raw que envia el export es identico al que envia el panel para el mismo filtro", async () => {
    await filasDelPanel(PANEL, FILTRO);

    // `aRaw` es la UNICA traduccion filtro→raw de la app, y es la que usa `PanelOperativo`
    // para pintar (`serializarFiltro` es `JSON.stringify(aRaw(...))`). Si el export
    // escribiera la suya, el dia que las dos divergieran el archivo diria una cosa y la
    // pantalla otra, y nada fallaria.
    const esperado = aRaw(FILTRO);
    for (const [entrada] of accionMock.mock.calls) {
      expect(entrada.raw).toEqual(esperado);
      // La desagregacion viaja TAMBIEN: omitirla produciria un archivo sin el desglose que
      // el panel si esta pintando.
      expect(entrada.desagregacion).toBe(PANEL.desagregacion);
    }

    // Y el raw es el de un filtro de verdad, no uno vacio que pasaria con cualquier cosa.
    expect(esperado).toEqual({ rango: "mes", zona_id: ["z1", "z2"], tienda_id: ["t7"] });
  });

  it("un panel sin desagregacion no la inventa", async () => {
    // La otra cara de R2: mandar `desagregacion` donde el panel no la pide cambiaria el
    // grano del archivo respecto de la grafica.
    const simple: PanelTablero = {
      id: "ordenes-creadas",
      titulo: "Ordenes creadas",
      grafica: "lineas",
      metricas: [{ metricaId: "ordenes_creadas", etiqueta: "Ordenes creadas" }],
    };
    await filasDelPanel(simple, FILTRO);
    expect(accionMock).toHaveBeenCalledTimes(1);
    expect(accionMock.mock.calls[0][0].desagregacion).toBeUndefined();
    expect("desagregacion" in accionMock.mock.calls[0][0]).toBe(false);
  });
});
