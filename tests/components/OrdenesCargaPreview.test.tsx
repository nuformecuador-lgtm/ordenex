// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaPreview } from "@/app/(app)/ordenes/_components/OrdenesCargaPreview";
import type { ClasificacionCarga } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";
import type { FilaParseada } from "@/app/(app)/ordenes/_components/carga-masiva-parser";
import { formatMonto, monedaConfig } from "@/lib/config/moneda";

// --- Feature 143: dobles para la descarga de filas con error -----------------

const { errorMock } = vi.hoisted(() => ({ errorMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// `buildXlsxRows` se espía (la generación real del binario ya la cubren
// `tests/unit/utils/xlsx-rows.test.ts` y el round-trip de integración).
const { buildXlsxRowsMock } = vi.hoisted(() => ({ buildXlsxRowsMock: vi.fn() }));
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: buildXlsxRowsMock };
});

const BOTON_DESCARGA = /descargar filas con error/i;

/** Anchors creados por el handler de descarga (se auto-eliminan del DOM). */
let anchorsCreados: HTMLAnchorElement[] = [];
let clicksEnAnchor = 0;
let createObjectURLMock: ReturnType<typeof vi.fn>;
let revokeObjectURLMock: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
  anchorsCreados = [];
  clicksEnAnchor = 0;

  createObjectURLMock = vi.fn(() => "blob:mock-url");
  revokeObjectURLMock = vi.fn();
  URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL;

  // R9: ninguna petición de red durante la descarga.
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);

  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = createElement(tag);
    if (tag === "a") {
      const anchor = el as HTMLAnchorElement;
      anchor.click = () => {
        clicksEnAnchor += 1;
      };
      anchorsCreados.push(anchor);
    }
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

function clasif(overrides: Partial<ClasificacionCarga> = {}): ClasificacionCarga {
  return {
    numRemisionesNuevas: [],
    existentes: [],
    errores: [],
    // Feature 304: sin ajustes por defecto — el caso de casi todas las cargas.
    ajustadas: [],
    ...overrides,
  };
}

/** Números de remisión de la tabla de errores, en orden de aparición. */
function filasErrorEnOrden(): string[] {
  const tabla = screen.getByRole("table", { name: /órdenes con error/i });
  const celdas = within(tabla).getAllByRole("cell");
  // Columnas: Fila | Nº Remisión | Motivo → tomamos la 2ª de cada terna.
  const remisiones: string[] = [];
  for (let i = 1; i < celdas.length; i += 3) {
    remisiones.push(celdas[i].textContent ?? "");
  }
  return remisiones;
}

describe("OrdenesCargaPreview — confirmación", () => {
  it("con nuevas > 0 habilita 'Confirmar y cargar' y lo dispara", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();

    render(
      <OrdenesCargaPreview
        clasificacion={clasif({ numRemisionesNuevas: ["REM-A", "REM-B"] })}
        confirmando={false}
        onConfirmar={onConfirmar}
      />,
    );

    const boton = screen.getByRole("button", { name: /confirmar y cargar 2 nuevas/i });
    expect(boton).toBeEnabled();
    await user.click(boton);
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it("sin nuevas (todo duplicado/error) → el botón queda deshabilitado", () => {
    render(
      <OrdenesCargaPreview
        clasificacion={clasif({
          existentes: [{ numRemision: "REM-X", estatus: "en_bodega_central" }],
        })}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /confirmar y cargar/i }),
    ).toBeDisabled();
  });

  it("confirmando=true → botón deshabilitado con estado de carga", () => {
    render(
      <OrdenesCargaPreview
        clasificacion={clasif({ numRemisionesNuevas: ["REM-A"] })}
        confirmando
        onConfirmar={vi.fn()}
      />,
    );
    const boton = screen.getByRole("button", { name: /cargando/i });
    expect(boton).toBeDisabled();
  });
});

describe("OrdenesCargaPreview — chips de error", () => {
  const clasificacion = clasif({
    numRemisionesNuevas: ["REM-OK"],
    errores: [
      { fila: 1, numRemision: "A", errores: { provincia: ["provincia no encontrada"] } },
      { fila: 2, numRemision: "B", errores: { canton: ["canton no encontrado en la provincia"] } },
      { fila: 3, numRemision: "C", errores: { provincia: ["provincia no encontrada"] } },
    ],
  });

  it("muestra un chip por tipo de error con su conteo", () => {
    render(
      <OrdenesCargaPreview
        clasificacion={clasificacion}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );
    const grupo = screen.getByRole("group", { name: /filtrar errores/i });
    const chips = within(grupo).getAllByRole("button");
    expect(chips).toHaveLength(2);
    // El de mayor conteo (provincia, 2) va primero.
    expect(chips[0]).toHaveTextContent(/provincia no encontrada/i);
    expect(chips[0]).toHaveTextContent("2");
  });

  it("al pulsar un chip, lleva al inicio las filas con ese error", async () => {
    const user = userEvent.setup();
    render(
      <OrdenesCargaPreview
        clasificacion={clasificacion}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );

    // Orden inicial: A, B, C.
    expect(filasErrorEnOrden()).toEqual(["A", "B", "C"]);

    const grupo = screen.getByRole("group", { name: /filtrar errores/i });
    const chipProvincia = within(grupo).getAllByRole("button")[0];
    await user.click(chipProvincia);

    // Las de "provincia no encontrada" (A, C) suben; B queda al final.
    expect(filasErrorEnOrden()).toEqual(["A", "C", "B"]);
    expect(chipProvincia).toHaveAttribute("aria-pressed", "true");

    // Pulsar de nuevo desactiva y restaura el orden original.
    await user.click(chipProvincia);
    expect(filasErrorEnOrden()).toEqual(["A", "B", "C"]);
    expect(chipProvincia).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------
// Feature 143 — descarga de las filas con error
// ---------------------------------------------------------------------------
describe("OrdenesCargaPreview — descargar filas con error (feature 143)", () => {
  const filas: FilaParseada[] = [
    { linea: 7, row: { num_remision: "REM-7", destinatario: "Ana", telefono: "8888" } },
  ];

  const conErrores = clasif({
    numRemisionesNuevas: ["REM-OK"],
    errores: [
      { fila: 7, numRemision: "REM-7", errores: { telefono: ["debe tener 8 dígitos"] } },
    ],
  });

  function renderPreview(clasificacion: ClasificacionCarga = conErrores) {
    render(
      <OrdenesCargaPreview
        clasificacion={clasificacion}
        filas={filas}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );
  }

  it("R11: sin filas con error, el botón de descarga NO está en el DOM", () => {
    renderPreview(clasif({ numRemisionesNuevas: ["REM-OK"] }));
    expect(screen.queryByRole("button", { name: BOTON_DESCARGA })).toBeNull();
  });

  it("R11: con filas con error, el botón de descarga está disponible", () => {
    renderPreview();
    expect(screen.getByRole("button", { name: BOTON_DESCARGA })).toBeEnabled();
  });

  it("R9/R10: al pulsar genera el Blob xlsx en el navegador y dispara la descarga", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole("button", { name: BOTON_DESCARGA }));

    await waitFor(() => expect(createObjectURLMock).toHaveBeenCalledTimes(1));
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    // R10: nombre con fecha y hora LOCALES del momento de la descarga (el formato
    // exacto lo fija `nombreArchivoErrores`, con test determinista propio).
    const ahora = new Date();
    const yyyymmdd = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, "0")}${String(ahora.getDate()).padStart(2, "0")}`;
    expect(anchorsCreados[0]?.download).toMatch(
      new RegExp(`^ordenes-con-error-${yyyymmdd}-\\d{4}\\.xlsx$`),
    );
    expect(clicksEnAnchor).toBe(1);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);

    // R9: ninguna petición de red (ni al endpoint de chunks ni a ruta nueva).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("R9: las filas exportadas se componen con los valores CRUDOS y el motivo", async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole("button", { name: BOTON_DESCARGA }));

    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));
    const [fields, rows] = buildXlsxRowsMock.mock.calls[0];
    expect((fields as { key: string }[]).at(-1)?.key).toBe("motivo_error");
    // Feature 148 (unificación del generador): el primer argumento pasó a ser
    // COLUMNAS y la cabecera se fija en el call-site. R2/R14 exige que sea la
    // clave máquina, así que se comprueba aquí, donde se decide.
    for (const columna of fields as { key: string; header: string }[]) {
      expect(columna.header).toBe(columna.key);
    }
    expect((rows as Record<string, string>[])[0]).toMatchObject({
      destinatario: "Ana",
      telefono: "8888",
      num_remision: "REM-7",
      motivo_error: "Fila 7 — telefono: debe tener 8 dígitos",
    });
  });

  it("R12: doble click con una generación en curso → una sola generación", async () => {
    const user = userEvent.setup();
    let resolver: (value: ArrayBuffer) => void = () => {};
    buildXlsxRowsMock.mockImplementation(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolver = resolve;
        }),
    );
    renderPreview();

    const boton = screen.getByRole("button", { name: BOTON_DESCARGA });
    await user.click(boton);
    // Estado ocupado mientras genera.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /generando archivo/i })).toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: /generando archivo/i }));

    expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1);

    resolver(new ArrayBuffer(8));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: BOTON_DESCARGA })).toBeEnabled(),
    );
  });

  it("R13: si la generación falla → toast de error, botón re-habilitado y paso operativo", async () => {
    const user = userEvent.setup();
    buildXlsxRowsMock.mockRejectedValue(new Error("boom"));
    renderPreview();

    await user.click(screen.getByRole("button", { name: BOTON_DESCARGA }));

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(errorMock).toHaveBeenCalledWith("No se pudo generar el archivo de errores.");
    expect(screen.getByRole("button", { name: BOTON_DESCARGA })).toBeEnabled();
    // El resto del paso sigue vivo: tabla de errores y confirmación.
    expect(screen.getByRole("table", { name: /órdenes con error/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirmar y cargar/i })).toBeEnabled();
  });

  it("R21: hay UNA sola acción de descarga y es .xlsx (sin variante CSV)", () => {
    renderPreview();
    const descargas = screen
      .getAllByRole("button")
      .filter((b) => /descargar/i.test(b.textContent ?? ""));
    expect(descargas).toHaveLength(1);
    expect(descargas[0]).toHaveTextContent(/\.xlsx/i);
    expect(screen.queryByText(/csv/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Feature 304 — las filas que se cargan con el monto REDONDEADO
// ---------------------------------------------------------------------------

/** El caso real de la captura del 2026-08-27 (fichas 299/300). */
const ORIGINAL = 11898.81;
const APLICADO = 11899;

/**
 * Lo que debe leerse en cada columna, compuesto con el formateador GENERAL (`formatMonto`) y
 * el separador de CONFIGURACIÓN, nunca con un `₡` escrito a mano ni llamando al mismo
 * `montoExacto` que pinta la celda: una aserción contra su propia fuente estaría verde pasara
 * lo que pasara.
 */
const COMA = monedaConfig.separadorDecimal;
const ORIGINAL_EN_PANTALLA = `${formatMonto(11898)}${COMA}81`;
const APLICADO_EN_PANTALLA = formatMonto(APLICADO);

const TABLA_AJUSTES = /órdenes con el monto redondeado/i;

describe("OrdenesCargaPreview — monto redondeado (feature 304)", () => {
  const conAjuste = clasif({
    numRemisionesNuevas: ["REM-7", "REM-8"],
    ajustadas: [
      { fila: 7, numRemision: "REM-7", original: ORIGINAL, aplicado: APLICADO },
    ],
  });

  function render304(clasificacion = conAjuste) {
    render(
      <OrdenesCargaPreview
        clasificacion={clasificacion}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );
  }

  it("los dos montos NO se pintan igual: el del archivo conserva sus céntimos", () => {
    // El punto entero de la ficha: si los dos importes salieran con la MISMA cadena, la tabla
    // diría «de ₡11.899 a ₡11.899» y sería una pantalla que se contradice sola. Si esta
    // aserción cae, el aviso dejó de informar de nada.
    expect(ORIGINAL_EN_PANTALLA).not.toBe(APLICADO_EN_PANTALLA);

    // ✅ FICHA 359 — LO QUE CAMBIÓ AQUÍ, y es la razón por la que `montoExacto` dejó de tener
    // cuerpo propio. Esta línea afirmaba lo CONTRARIO —`formatMonto(ORIGINAL)` era
    // `APLICADO_EN_PANTALLA`—, o sea que el formateador GENERAL fundía los dos importes en
    // `₡11.899` y por eso esta tabla necesitaba uno aparte. Con la regla nueva el general ya
    // los distingue. Se reescribe en vez de borrarse para que quede escrito que la excepción
    // de la feature 300 se cerró por arriba y no se abandonó.
    expect(formatMonto(ORIGINAL)).not.toBe(APLICADO_EN_PANTALLA);
    expect(formatMonto(ORIGINAL)).toBe(ORIGINAL_EN_PANTALLA);
  });

  it("dice cuántas se ajustaron y muestra la fila con LOS DOS montos", () => {
    render304();

    expect(
      screen.getByText(/1 traía céntimos y se cargará con el monto redondeado/i),
    ).toBeInTheDocument();

    const tabla = screen.getByRole("table", { name: TABLA_AJUSTES });
    const celdas = within(tabla)
      .getAllByRole("cell")
      .map((td) => td.textContent ?? "");
    expect(celdas).toEqual([
      "7",
      "REM-7",
      ORIGINAL_EN_PANTALLA,
      APLICADO_EN_PANTALLA,
    ]);
  });

  it("NO es un error ni una duplicada: no toca esos grupos ni sus tablas", () => {
    render304();

    // La fila ajustada sigue contada entre las nuevas (2, no 1).
    expect(
      screen.getByRole("button", { name: /confirmar y cargar 2 nuevas/i }),
    ).toBeEnabled();
    // Y no aparece ninguna de las dos superficies de "esto no entró".
    expect(screen.queryByRole("table", { name: /órdenes con error/i })).toBeNull();
    expect(screen.queryByRole("table", { name: /órdenes ya existentes/i })).toBeNull();
    expect(screen.queryByText(/con error/i)).toBeNull();
  });

  it("sin ajustes, el paso se ve EXACTAMENTE como antes: ni tabla ni línea", () => {
    render304(clasif({ numRemisionesNuevas: ["REM-7"] }));

    expect(screen.queryByRole("table", { name: TABLA_AJUSTES })).toBeNull();
    expect(screen.queryByText(/redondead/i)).toBeNull();
    expect(screen.queryByText(/céntimos/i)).toBeNull();
  });

  it("con varias ajustadas lo dice en plural y lista todas", () => {
    render304(
      clasif({
        numRemisionesNuevas: ["REM-7", "REM-8"],
        ajustadas: [
          { fila: 7, numRemision: "REM-7", original: ORIGINAL, aplicado: APLICADO },
          { fila: 8, numRemision: "REM-8", original: 0.5, aplicado: 1 },
        ],
      }),
    );

    expect(
      screen.getByText(/2 traían céntimos y se cargarán con el monto redondeado/i),
    ).toBeInTheDocument();
    const tabla = screen.getByRole("table", { name: TABLA_AJUSTES });
    expect(within(tabla).getAllByRole("row")).toHaveLength(3); // cabecera + 2 filas
    expect(within(tabla).getByText(`${formatMonto(0)}${COMA}50`)).toBeInTheDocument();
  });
});
