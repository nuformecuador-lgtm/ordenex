// @vitest-environment jsdom
// Ficha 464 (T2) — el control común de descarga con una HOJA DE DETALLE opcional.
//
// El generador corre REAL y el archivo se relee con exceljs: lo que se afirma es lo que se baja, no lo
// que el control dice que va a bajar. Los textos se escriben a mano (contrato visible, R6/R44).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExcelJS from "exceljs";

import type { DataTableDescargaDetalle, DescargaFilasResult } from "@/components/shared/DataTable";
import type { DescargaColumna } from "@/lib/types/descarga";
import { claveDeAmbitoDescarga } from "@/lib/columnas/preferencia-columnas";
import {
  DISPARADOR_DETALLE,
  GRUPO_COLUMNAS_DE_LA_HOJA,
  GRUPO_HOJAS,
  OPCION_CON_DETALLE,
  OPCION_SOLO_MOVIMIENTOS,
  abrirSelectorDetalle,
  cerrarSelectorDetalle,
} from "@/tests/fixtures/descarga-detalle-por-orden";

const H = vi.hoisted(() => ({ blob: vi.fn(), toastError: vi.fn() }));
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: (...a: unknown[]) => H.blob(...a) }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: H.toastError, info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";

const COLUMNAS: DescargaColumna[] = [
  { clave: "fecha", encabezado: "Fecha" },
  { clave: "monto", encabezado: "Monto" },
];
const DETALLE: DataTableDescargaDetalle = {
  titulo: "Detalle por orden",
  columnas: [
    { clave: "guia", encabezado: "Guía" },
    { clave: "aporte", encabezado: "Aporte" },
  ],
  ambitoColumnas: "prueba-detalle",
  etiquetaOpcion: "Movimientos y detalle por orden · dos hojas",
  etiquetaSinDetalle: "Solo los movimientos · una hoja",
  columnaEnlace: { clave: "numero", encabezado: "N.º" },
  columnaEstado: { clave: "estado", encabezado: "Detalle por orden" },
};

const FILAS = [
  { numero: 1, fecha: "2026-09-20", monto: "10.00", estado: "2 órdenes" },
  { numero: 2, fecha: "2026-09-21", monto: "5.00", estado: "Sin reparto" },
];
const FILAS_DETALLE = [
  { numero: 1, guia: "1001", aporte: "4.00" },
  { numero: 1, guia: "1002", aporte: "6.00" },
];

const obtener = vi.fn<(o?: { conDetalle: boolean }) => Promise<DescargaFilasResult>>();

function montar(props: Partial<Parameters<typeof DescargarDatasetButton>[0]> = {}) {
  return render(
    <DescargarDatasetButton
      titulo="Libro de prueba"
      columnas={COLUMNAS}
      obtenerFilas={obtener}
      ambitoColumnas="prueba-principal"
      detalle={DETALLE}
      {...props}
    />,
  );
}

/** El último archivo bajado, releído con exceljs: nombre de cada hoja y sus filas como texto. */
async function archivo(): Promise<Array<{ nombre: string; filas: unknown[][] }>> {
  await waitFor(() => expect(H.blob).toHaveBeenCalled());
  const [contenido] = H.blob.mock.calls.at(-1)!;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  return libro.worksheets.map((h) => {
    const filas: unknown[][] = [];
    h.eachRow((r) => filas.push((r.values as unknown[]).slice(1)));
    return { nombre: h.name, filas };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  obtener.mockImplementation(async (o) =>
    o?.conDetalle ? { status: "ok", filas: FILAS, filasDetalle: FILAS_DETALLE } : { status: "ok", filas: FILAS },
  );
});
afterEach(() => cleanup());

describe("464 R41 — sin `detalle` el control es el de siempre", () => {
  it("llama a `obtenerFilas` SIN argumentos, no ofrece opciones nuevas y baja UNA hoja con las columnas de siempre", async () => {
    const user = userEvent.setup();
    montar({ detalle: undefined });
    expect(screen.queryByRole("button", { name: DISPARADOR_DETALLE })).toBeNull();
    expect(screen.getByRole("button", { name: "Elegir columnas de la descarga" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith();
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de prueba"]);
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Monto"]);
  });

  it("y sin el ámbito de la principal, `detalle` no se ofrece (las dos hojas se eligen en el mismo selector)", async () => {
    const user = userEvent.setup();
    montar({ ambitoColumnas: undefined });
    expect(screen.queryByRole("button", { name: DISPARADOR_DETALLE })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith();
    expect(hojas).toHaveLength(1);
  });
});

describe("464 R6/R8 — qué se descarga", () => {
  it("R6: dos opciones excluyentes, cada una dice cuántas hojas lleva; R8: arranca con el detalle", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    const grupo = screen.getByRole("radiogroup", { name: GRUPO_HOJAS });
    expect(grupo).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: OPCION_CON_DETALLE })).toBeChecked();
  });

  it("R8: la opción NO se recuerda: elegir «Solo los movimientos», desmontar y volver arranca otra vez con el detalle", async () => {
    const user = userEvent.setup();
    const { unmount } = montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
    expect(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS })).toBeChecked();
    await cerrarSelectorDetalle(user);
    unmount();
    montar();
    await abrirSelectorDetalle(user);
    expect(screen.getByRole("radio", { name: OPCION_CON_DETALLE })).toBeChecked();
  });
});

describe("464 R9/R10/R13/R17 — lo que se baja", () => {
  it("R10/R15/R16/R17: con detalle, DOS hojas —la principal primero— con «N.º» delante y «Detalle por orden» al final", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith({ conDetalle: true });
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de prueba", "Detalle por orden"]);
    expect(hojas[0].filas).toEqual([
      ["N.º", "Fecha", "Monto", "Detalle por orden"],
      [1, "2026-09-20", "10.00", "2 órdenes"],
      [2, "2026-09-21", "5.00", "Sin reparto"],
    ]);
    expect(hojas[1].filas).toEqual([
      ["N.º", "Guía", "Aporte"],
      [1, "1001", "4.00"],
      [1, "1002", "6.00"],
    ]);
  });

  it("R9/R13: «Solo los movimientos» pide SIN detalle y baja una hoja, sin las columnas fijas", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
    await cerrarSelectorDetalle(user);
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith({ conDetalle: false });
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de prueba"]);
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Monto"]);
  });

  it("R24: sin órdenes en el detalle, la hoja sale igual con su fila de encabezados", async () => {
    const user = userEvent.setup();
    obtener.mockResolvedValue({ status: "ok", filas: FILAS, filasDetalle: [] });
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[1].filas).toEqual([["N.º", "Guía", "Aporte"]]);
  });

  it("R36: si la respuesta con detalle no trae las filas del detalle, no hay archivo y se avisa", async () => {
    const user = userEvent.setup();
    obtener.mockResolvedValue({ status: "ok", filas: FILAS });
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("No se pudo generar el archivo. Vuelve a intentarlo; el listado no cambió."));
    expect(H.blob).not.toHaveBeenCalled();
  });

  it("R43: un error de lectura es un aviso y ningún archivo", async () => {
    const user = userEvent.setup();
    obtener.mockResolvedValue({ status: "error", mensaje: "No se pudo leer." });
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("No se pudo leer."));
    expect(H.blob).not.toHaveBeenCalled();
  });
});

describe("464 R11/R17 — el selector elige las columnas de cada hoja por separado", () => {
  it("R17: las columnas fijas no están en ninguna lista; R11: «Columnas de la hoja» cambia de catálogo", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    const grupoHoja = screen.getByRole("radiogroup", { name: GRUPO_COLUMNAS_DE_LA_HOJA });
    expect(grupoHoja).toBeInTheDocument();
    // La principal se nombra con SU nombre en el archivo.
    expect(screen.getByRole("radio", { name: "Libro de prueba" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Fecha" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "N.º" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Detalle por orden" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Detalle por orden" }));
    expect(screen.getByRole("checkbox", { name: "Guía" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Fecha" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "N.º" })).toBeNull();

    // Con «Solo los movimientos» no hay segunda hoja que elegir.
    await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
    expect(screen.queryByRole("radiogroup", { name: GRUPO_COLUMNAS_DE_LA_HOJA })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Fecha" })).toBeInTheDocument();
  });

  it("R2/R3/R11: desmarcar en la hoja de detalle guarda en SU ámbito y solo cambia esa hoja; las fijas siguen saliendo", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("radio", { name: "Detalle por orden" }));
    await user.click(screen.getByRole("checkbox", { name: "Guía" }));
    await cerrarSelectorDetalle(user);

    expect(window.localStorage.getItem(claveDeAmbitoDescarga("prueba-detalle"))).not.toBeNull();
    expect(window.localStorage.getItem(claveDeAmbitoDescarga("prueba-principal"))).toBeNull();

    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[0].filas[0]).toEqual(["N.º", "Fecha", "Monto", "Detalle por orden"]);
    expect(hojas[1].filas[0]).toEqual(["N.º", "Aporte"]);
  });

  it("R3: reordenar en la hoja de movimientos se refleja entre las fijas", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("button", { name: "Bajar Fecha" }));
    await cerrarSelectorDetalle(user);
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[0].filas[0]).toEqual(["N.º", "Monto", "Fecha", "Detalle por orden"]);
    expect(hojas[1].filas[0]).toEqual(["N.º", "Guía", "Aporte"]);
  });
});

describe("464 R12 — con detalle, solo Excel", () => {
  it("con csv declarado, el detalle baja directo en Excel; el menú de formato vuelve con «Solo los movimientos»", async () => {
    const user = userEvent.setup();
    montar({ formatos: ["xlsx", "csv"] });
    const boton = screen.getByRole("button", { name: "Descargar Libro de prueba" });
    expect(boton).not.toHaveAttribute("aria-haspopup");
    await user.click(boton);
    const hojas = await archivo();
    expect(hojas).toHaveLength(2);
    const [, mime, nombre] = H.blob.mock.calls.at(-1)!;
    expect(String(mime)).toContain("spreadsheetml");
    expect(String(nombre)).toMatch(/\.xlsx$/);

    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
    await cerrarSelectorDetalle(user);
    expect(screen.getByRole("button", { name: "Descargar Libro de prueba" })).toHaveAttribute("aria-haspopup", "menu");
  });
});
