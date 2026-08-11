// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildCsvRows } from "@/lib/utils/csv-template";
import { nombreArchivoDescarga } from "@/lib/utils/descarga-dataset";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { RespuestaFinanciera } from "@/lib/types/analitica-financiera";

import { TableroFinanciero } from "@/app/(app)/analitica/_components/financiero/TableroFinanciero";
import type { PanelFinanciero } from "@/app/(app)/analitica/_components/financiero/cargar";
import {
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA,
  COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO,
} from "@/app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas";
import {
  ExportarVistaFinanciera,
  FORMATOS_EXPORT_FINANCIERO,
} from "@/app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera";

import {
  CUBOS_CON_FORMA_DE_UUID,
  dtoNoTemporalConUuids,
  dtoTemporalAcumulado,
  dtoTemporalConNeto,
  dtoTemporalSoloBruto,
  idDeLaUnicaVista,
} from "@/tests/unit/analytics/_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T4.4, T5.2). R24, R25 y R27.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// Los casos de UI: el nombre del archivo lo produce el patron existente, el usuario puede elegir
// el formato que su Excel abre, y el control cuelga de la seccion de SU vista y solo de ella.
//
// EL ULTIMO BLOQUE ES LA COMPROBACION DE FRONTERA RSC (T5.2) y no es ceremonial: una prop cuyo
// VALOR sea una funcion, pasada de un Server Component a un Client Component, falla en RENDER y
// no en compilacion. Ningun test que no monte ESE arbol exacto la ve. Aqui se monta el tablero
// entero con las cuatro fixtures del DTO.

vi.mock("@/lib/actions/analitica-financiera", () => ({
  consultarMetricaFinanciera: vi.fn(),
}));
const accionMock = vi.mocked(consultarMetricaFinanciera);

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador CSV se espia SIN sustituirlo: el archivo real se sigue produciendo, y asi R25
// puede comprobar que el texto sale del dialecto comun y no de uno propio.
vi.mock("@/lib/utils/csv-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv-template")>();
  return { ...actual, buildCsvRows: vi.fn(actual.buildCsvRows) };
});
const buildCsvRowsMock = vi.mocked(buildCsvRows);

const toastErrorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: (...args: unknown[]) => toastErrorMock(...args),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// En jsdom `ResponsiveContainer` renderiza vacio: los lienzos se doblan igual que en
// `tests/components/TableroFinanciero.test.tsx`, y por el mismo motivo.
vi.mock("@/components/private/analytics/lienzo/BarrasLienzo", () => ({
  default: () => <div data-testid="lienzo-barras" />,
}));
vi.mock("@/components/private/analytics/lienzo/DonutLienzo", () => ({
  default: () => <div data-testid="lienzo-donut" />,
}));
vi.mock("@/components/private/analytics/lienzo/LineasLienzo", () => ({
  default: () => <div data-testid="lienzo-lineas" />,
}));

const CON_NETO = dtoTemporalConNeto();
const SOLO_BRUTO = dtoTemporalSoloBruto();
const ACUMULADO = dtoTemporalAcumulado();
const NO_TEMPORAL = dtoNoTemporalConUuids();

const TITULO = CON_NETO.etiqueta;

function respuestaOk(datos = CON_NETO): RespuestaFinanciera {
  return { status: "ok", datos };
}

function montarControl(datos = CON_NETO) {
  return render(
    <ExportarVistaFinanciera
      metricaId={datos.metricaId}
      vistaId={idDeLaUnicaVista(datos)}
      titulo={datos.etiqueta}
    />,
  );
}

async function descargar(user: ReturnType<typeof userEvent.setup>, formato: RegExp) {
  await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
  await user.click(screen.getByRole("menuitem", { name: formato }));
}

beforeEach(() => {
  vi.clearAllMocks();
  accionMock.mockResolvedValue(respuestaOk());
});

afterEach(() => {
  cleanup();
});

describe("Feature 184 — analitica financiera: export de la serie (R24) · el nombre lo pone el patron", () => {
  it("el nombre del archivo lo produce nombreArchivoDescarga a partir del titulo de la seccion", async () => {
    const user = userEvent.setup();
    montarControl();

    await descargar(user, /CSV/);
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [, , nombre] = descargarBlobMock.mock.calls[0]!;
    // No se compara contra un literal: se compara contra lo que produce la MISMA funcion del
    // patron 151. Un nombre compuesto a mano aqui divergiria de las ~25 tablas de la app.
    expect(nombre).toBe(nombreArchivoDescarga(TITULO, "csv", new Date()));
    expect(nombre).toMatch(/^egresos-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R25) · los dos formatos del patron", () => {
  it("el control ofrece CSV y XLSX y no declara un dialecto propio", async () => {
    // D5 de la 134, con el dato concreto que motiva la decision: `buildCsvRows` emite coma como
    // separador, decimales con punto y UTF-8 SIN BOM, y eso en Windows con locale es-EC abre en
    // UNA SOLA COLUMNA y rompe las tildes. La salida NO es cambiar el dialecto —unas 25 tablas
    // dependen de el— sino ofrecer tambien la hoja de calculo en el mismo control.
    const user = userEvent.setup();
    montarControl();

    // Los DOS formatos, ofrecidos al usuario. Con uno solo no habria menu que abrir.
    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
    const opciones = screen.getAllByRole("menuitem");
    expect(opciones.map((opcion) => opcion.textContent)).toEqual(["CSV (.csv)", "Excel (.xlsx)"]);
    expect(FORMATOS_EXPORT_FINANCIERO).toEqual(["csv", "xlsx"]);

    await user.click(screen.getByRole("menuitem", { name: /CSV/ }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    // El texto lo produce el generador COMUN, con las columnas declaradas y su dialecto.
    expect(buildCsvRowsMock).toHaveBeenCalledTimes(1);
    const [columnas] = buildCsvRowsMock.mock.calls[0]!;
    expect(columnas.map((columna) => columna.key)).toEqual(
      COLUMNAS_DESCARGA_ANALITICA_FINANCIERA.map((columna) => columna.clave),
    );

    const [contenido, mime] = descargarBlobMock.mock.calls[0]!;
    const texto = String(contenido);
    expect(texto.startsWith("﻿")).toBe(false); // sin BOM
    expect(texto.split("\r\n")[0]).not.toContain(";"); // separador coma, no punto y coma
    expect(mime).toBe("text/csv;charset=utf-8");
    // R18/D2 — el importe llega LITERAL al texto, con su punto decimal y sin separador de miles.
    expect(texto).toContain("1000.10");
    expect(texto).not.toContain("1.000,10");
  });

  it("una vista solo_bruto descarga con SU juego de columnas, sin una columna de neto vacia (R13)", async () => {
    // El juego de columnas se elige por ARCHIVO y a partir de la FORMA del DTO, que solo se
    // conoce al consultar. Si el control fijara las columnas al renderizar, aqui saldria una
    // columna «Neto» vacia — y una celda vacia significa «no se sabe» donde la verdad es «no
    // aplica».
    const user = userEvent.setup();
    accionMock.mockResolvedValue(respuestaOk(SOLO_BRUTO));
    render(
      <ExportarVistaFinanciera
        metricaId={SOLO_BRUTO.metricaId}
        vistaId={idDeLaUnicaVista(SOLO_BRUTO)}
        titulo={SOLO_BRUTO.etiqueta}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: `Descargar ${SOLO_BRUTO.etiqueta}` }),
    );
    await user.click(screen.getByRole("menuitem", { name: /CSV/ }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    const [columnas] = buildCsvRowsMock.mock.calls[0]!;
    expect(columnas.map((columna) => columna.key)).toEqual(
      COLUMNAS_DESCARGA_ANALITICA_FINANCIERA_SOLO_BRUTO.map((columna) => columna.clave),
    );
    const cabecera = String(descargarBlobMock.mock.calls[0]![0]).split("\r\n")[0]!;
    expect(cabecera).not.toMatch(/neto/i);
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R27) · donde se monta el control", () => {
  it("el control cuelga de la seccion de la vista y no se monta fuera de ella", () => {
    // T5.2 — LA COMPROBACION DE FRONTERA RSC: el tablero es un arbol de SERVIDOR y monta aqui un
    // componente de CLIENTE. Se renderiza con las CUATRO fixtures del DTO: si la insercion pasara
    // una prop-funcion, esto explotaria en render.
    const paneles: PanelFinanciero[] = [
      { estado: "ok", id: CON_NETO.metricaId, datos: CON_NETO },
      { estado: "ok", id: SOLO_BRUTO.metricaId, datos: SOLO_BRUTO },
      { estado: "ok", id: ACUMULADO.metricaId, datos: ACUMULADO },
      { estado: "ok", id: NO_TEMPORAL.metricaId, datos: NO_TEMPORAL },
    ];
    render(<TableroFinanciero paneles={paneles} />);

    // Un control POR VISTA TEMPORAL (D5), dentro de la seccion que lleva su nombre accesible.
    for (const datos of [CON_NETO, SOLO_BRUTO, ACUMULADO]) {
      const seccion = screen.getByRole("region", { name: datos.etiqueta });
      expect(
        within(seccion).getByRole("button", { name: `Descargar ${datos.etiqueta}` }),
      ).toBeInTheDocument();
    }

    // Y NINGUNO en la vista NO temporal (R12/D1): sus cubos son identificadores crudos, y un
    // archivo que circula con ellos no se puede retirar despues.
    const noTemporal = screen.getByRole("region", { name: NO_TEMPORAL.etiqueta });
    expect(within(noTemporal).queryByRole("button", { name: /Descargar/ })).toBeNull();

    // SANIDAD de la fixture: la vista excluida trae uuids DE VERDAD. Con cubos ya inocuos este
    // caso seria un verde gratuito.
    expect(noTemporal.textContent ?? "").toContain(CUBOS_CON_FORMA_DE_UUID[0]);

    // Exactamente tres controles en todo el tablero: uno por vista temporal.
    expect(screen.getAllByRole("button", { name: /^Descargar / })).toHaveLength(3);
  });

  it("cada control dice QUE descarga: con siete a la vista, «Descargar» a secas seria indistinguible", () => {
    montarControl();
    expect(screen.getByRole("button", { name: `Descargar ${TITULO}` })).toBeInTheDocument();
  });
});
