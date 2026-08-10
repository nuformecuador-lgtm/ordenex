// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { descargaConfig } from "@/lib/config/descarga";
import { buildCsvRows } from "@/lib/utils/csv-template";
import { consultarAnaliticaOperativa } from "@/lib/actions/analitica-operativa";
import { PENUMBRA, type PuntoSerie, type SerieOperativa } from "@/lib/types/analitica-operativa";

import type { PanelTablero } from "@/app/(app)/analitica/_components/operativo/catalogo-paneles";
import {
  COLUMNAS_DESCARGA_ANALITICA_OPERATIVA,
} from "@/app/(app)/analitica/_components/operativo/analitica-operativa-descarga-columnas";
import {
  ExportarOperativoPanel,
  FORMATOS_EXPORT_OPERATIVO,
} from "@/app/(app)/analitica/_components/operativo/ExportarOperativoPanel";
import { FILTRO_INICIAL } from "@/app/(app)/analitica/_components/operativo/filtro-tablero";

// Feature 134 — R16, R17, R21 y la accesibilidad del control (T4.3/T4.4), CON EL CONTROL
// MONTADO. Los tres casos que viven aqui son de UI: lo que se juzga es que en las dos
// situaciones que NO producen archivo no se produzca archivo, y que el usuario pueda elegir
// el formato que su Excel abre.
//
// (Los nombres `export-csv-tope.test.ts` / `export-csv-vacio.test.ts` de `requirements.md` se
// consolidan en este archivo, junto al resto de tests de descarga del repo. Anotado en el
// mapa R→test de `progress/impl_134.md`.)

vi.mock("@/lib/actions/analitica-operativa", () => ({
  consultarAnaliticaOperativa: vi.fn(),
}));
const accionMock = vi.mocked(consultarAnaliticaOperativa);

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador CSV se espia SIN sustituirlo: el archivo real se sigue produciendo, y asi el
// caso de R21 puede comprobar que el texto sale del dialecto comun y no de uno propio.
vi.mock("@/lib/utils/csv-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv-template")>();
  return { ...actual, buildCsvRows: vi.fn(actual.buildCsvRows) };
});
const buildCsvRowsMock = vi.mocked(buildCsvRows);

const toastErrorMock = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: (...a: unknown[]) => toastErrorMock(...a),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const PANEL: PanelTablero = {
  id: "tasa-entrega",
  titulo: "Tasa de entrega",
  grafica: "lineas",
  metricas: [{ metricaId: "tasa_entrega", etiqueta: "Tasa de entrega", unidad: "porcentaje" }],
};

function serie(puntos: readonly PuntoSerie[]): SerieOperativa {
  return {
    metricaId: "tasa_entrega",
    unidad: "porcentaje",
    unidadDeConteo: "gestion",
    rango: {
      preset: "semana",
      desde: new Date("2026-08-01T06:00:00.000Z"),
      hasta: new Date("2026-08-04T06:00:00.000Z"),
      desdeFecha: "2026-08-01",
      hastaFecha: "2026-08-03",
    },
    puntos,
    cobertura: { fechasNoComparables: [], penumbra: PENUMBRA },
  };
}

function montar() {
  return render(
    <ToastProvider>
      <ExportarOperativoPanel panel={PANEL} filtro={FILTRO_INICIAL} />
    </ToastProvider>,
  );
}

/** Abre el menu de formato y pulsa la opcion pedida. */
async function descargar(user: ReturnType<typeof userEvent.setup>, formato: RegExp) {
  await user.click(screen.getByRole("button", { name: `Descargar ${PANEL.titulo}` }));
  await user.click(screen.getByRole("menuitem", { name: formato }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Feature 134 (R21/D5) — el control ofrece los dos formatos del patron", () => {
  it("el control ofrece CSV y XLSX y no declara un dialecto propio", async () => {
    // D5, con el dato concreto que motiva la decision: `buildCsvRows` emite coma como
    // separador, decimales con punto y UTF-8 SIN BOM, y eso en Windows con locale es-EC abre
    // en UNA SOLA COLUMNA y rompe las tildes. La salida NO es cambiar el dialecto —25 tablas
    // de la app dependen de el— sino ofrecer XLSX en el mismo control.
    const user = userEvent.setup();
    accionMock.mockResolvedValue({
      status: "ok",
      datos: serie([{ fecha: "2026-08-01", valor: 0.842 }]),
    });
    montar();

    // Los DOS formatos, ofrecidos al usuario. Con uno solo no habria menu que abrir.
    await user.click(screen.getByRole("button", { name: `Descargar ${PANEL.titulo}` }));
    const opciones = screen.getAllByRole("menuitem");
    expect(opciones.map((o) => o.textContent)).toEqual(["CSV (.csv)", "Excel (.xlsx)"]);
    expect(FORMATOS_EXPORT_OPERATIVO).toEqual(["csv", "xlsx"]);

    await user.click(screen.getByRole("menuitem", { name: /CSV/ }));
    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));

    // Y el texto lo produce el generador COMUN, con sus columnas declaradas y su dialecto.
    expect(buildCsvRowsMock).toHaveBeenCalledTimes(1);
    const [columnas] = buildCsvRowsMock.mock.calls[0];
    expect(columnas.map((c) => c.key)).toEqual(COLUMNAS_DESCARGA_ANALITICA_OPERATIVA.map((c) => c.clave));

    const [contenido, mime, nombre] = descargarBlobMock.mock.calls[0];
    const texto = String(contenido);
    expect(texto.startsWith("﻿")).toBe(false); // sin BOM
    expect(texto).toContain("0.842"); // decimal con PUNTO
    expect(texto).not.toContain("0,842");
    expect(texto.split("\r\n")[0]).not.toContain(";"); // separador coma, no punto y coma
    expect(mime).toBe("text/csv;charset=utf-8");
    expect(nombre).toMatch(/^tasa-de-entrega-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe("Feature 134 (R16) — superar el tope no produce un archivo truncado", () => {
  it("superar el tope no produce archivo truncado sino el mensaje accionable", async () => {
    // Un archivo truncado es la peor salida posible: parece completo. Se reenvia, se suma y
    // nadie vuelve a preguntar por las filas que faltan.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;
    const puntos: PuntoSerie[] = Array.from({ length: total }, (_, i) => ({
      fecha: "2026-08-01",
      dimension: `Mensajero ${i}`,
      valor: i,
    }));
    accionMock.mockResolvedValue({ status: "ok", datos: serie(puntos) });
    montar();

    await descargar(user, /CSV/);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);

    // NINGUN archivo: ni truncado, ni completo.
    expect(buildCsvRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });
});

describe("Feature 134 (R17) — sin puntos no hay archivo", () => {
  it("sin puntos no se genera archivo y se avisa sin datos", async () => {
    // Un CSV de cabecera sola se reenvia y se lee como «no hubo actividad», que es una
    // afirmacion distinta de «la consulta no devolvio nada».
    const user = userEvent.setup();
    accionMock.mockResolvedValue({ status: "ok", datos: serie([]) });
    montar();

    await descargar(user, /CSV/);

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toMatch(/no hay datos que descargar/i);
    expect(buildCsvRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });
});

describe("Feature 134 (T4.4) — el control dice QUE panel descarga", () => {
  it("el control declara un nombre accesible propio por panel", async () => {
    // Con seis paneles a la vista, seis botones «Descargar» a secas serian seis controles
    // indistinguibles para un lector de pantalla.
    accionMock.mockResolvedValue({ status: "ok", datos: serie([]) });
    montar();
    expect(
      screen.getByRole("button", { name: /Descargar Tasa de entrega/ }),
    ).toBeInTheDocument();
  });
});
