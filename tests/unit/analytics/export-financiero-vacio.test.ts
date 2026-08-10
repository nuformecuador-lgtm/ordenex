// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { descargaConfig } from "@/lib/config/descarga";
import { buildCsvRows } from "@/lib/utils/csv-template";
import { consultarMetricaFinanciera } from "@/lib/actions/analitica-financiera";
import type { FilaFinanciera, RespuestaFinanciera } from "@/lib/types/analitica-financiera";
import { importeConNeto } from "@/tests/fixtures/importe-analitico";

import { ExportarVistaFinanciera } from "@/app/(app)/analitica/_components/export-financiero/ExportarVistaFinanciera";

import {
  dtoTemporalConNeto,
  idDeLaUnicaVista,
  MONEDA_DE_FIXTURE,
} from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T4.4). R21 y R22.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// LOS DOS ESTADOS QUE NO PRODUCEN ARCHIVO, con el control MONTADO — que es el unico sitio donde
// «no se produce archivo» se puede afirmar de verdad: se espia el generador comun y la entrega
// del binario, y se comprueba que NINGUNO se invoco.
//
// R21 — un archivo de cabecera sola se reenvia y se lee como «no hubo movimiento», que es una
//       afirmacion distinta de «la consulta no devolvio nada».
// R22 — un archivo TRUNCADO es la peor salida posible, porque parece completo: se reenvia, se
//       suma y nadie vuelve a preguntar por las filas que faltan. El tope es el UNICO de la app
//       (`descargaConfig.MAX_FILAS`, aplicado por `filasLocales` de la 170) y aqui no se declara
//       ninguno propio.

vi.mock("@/lib/actions/analitica-financiera", () => ({
  consultarMetricaFinanciera: vi.fn(),
}));
const accionMock = vi.mocked(consultarMetricaFinanciera);

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador CSV se espia SIN sustituirlo: el archivo real se seguiria produciendo, asi que si
// alguien truncara la lista en vez de negarse, este espia lo veria.
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

const DATOS = dtoTemporalConNeto();
const VISTA_ID = idDeLaUnicaVista(DATOS);
const TITULO = "Egresos";

/** El DTO de la fixture con OTRAS filas: la vista sigue siendo la misma, temporal y con neto. */
function respuestaCon(filas: readonly FilaFinanciera[]): RespuestaFinanciera {
  return {
    status: "ok",
    datos: { ...DATOS, vistas: [{ ...DATOS.vistas[0]!, filas }] },
  };
}

function montar() {
  return render(
    React.createElement(ExportarVistaFinanciera, {
      metricaId: DATOS.metricaId,
      vistaId: VISTA_ID,
      titulo: TITULO,
    }),
  );
}

/** Abre el menu de formato y pulsa la opcion pedida. */
async function descargar(user: ReturnType<typeof userEvent.setup>, formato: RegExp) {
  await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
  await user.click(screen.getByRole("menuitem", { name: formato }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Feature 184 — analitica financiera: export de la serie (R21) · sin filas no hay archivo", () => {
  it("sin filas no se genera archivo y se avisa sin datos", async () => {
    const user = userEvent.setup();
    accionMock.mockResolvedValue(respuestaCon([]));
    montar();

    await descargar(user, /CSV/);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(String(toastErrorMock.mock.calls[0]![0])).toMatch(/no hay datos que descargar/i);

    // NINGUN archivo: ni siquiera uno con solo la cabecera.
    expect(buildCsvRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R22) · el tope no trunca", () => {
  it("superar el tope no produce archivo truncado sino el mensaje accionable", async () => {
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;
    const filas: FilaFinanciera[] = Array.from({ length: total }, (_, indice) => ({
      cubo: `cubo-${indice}`,
      importe: importeConNeto(`${indice}.00`, `${indice}.00`, MONEDA_DE_FIXTURE),
    }));
    accionMock.mockResolvedValue(respuestaCon(filas));
    montar();

    await descargar(user, /CSV/);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0]![0]);
    // ACCIONABLE: dice el total encontrado, el tope vigente y que hacer.
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);

    // NINGUN archivo: ni truncado, ni completo.
    expect(buildCsvRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });

  it("y con una fila menos que el tope SI se produce archivo: el tope no es una pared cualquiera", async () => {
    // Contrapeso del caso anterior: sin esto, un export que nunca produjera archivo pasaria igual.
    const user = userEvent.setup();
    const filas: FilaFinanciera[] = Array.from(
      { length: descargaConfig.MAX_FILAS },
      (_, indice) => ({
        cubo: `cubo-${indice}`,
        importe: importeConNeto(`${indice}.00`, `${indice}.00`, MONEDA_DE_FIXTURE),
      }),
    );
    accionMock.mockResolvedValue(respuestaCon(filas));
    montar();

    await descargar(user, /CSV/);

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    expect(buildCsvRowsMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
