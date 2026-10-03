// @vitest-environment jsdom
// Ficha 464 (T2) → 468 (T10) — el control común de descarga con una HOJA DE DETALLE opcional.
//
// 468: las dos columnas fijas de la 464 («N.º» y «Detalle por orden», fuera del catálogo) desaparecen.
// En su lugar cada hoja declara `columnasFijas` —claves de SU catálogo, marcadas y sin poder desmarcar,
// pero sí reordenar (R51)— y la respuesta trae `filasDestacadas` por hoja (negritas, R23/R47). Lo que de
// la 464 sigue valiendo (R41 sin detalle, R6/R8 qué se descarga, R11 columnas por hoja, R12 solo Excel,
// R24/R36/R43) se conserva aquí.
//
// El generador corre REAL y el archivo se relee con exceljs: lo que se afirma es lo que se baja, no lo
// que el control dice que va a bajar. Los textos se escriben a mano (contrato visible).
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
  { clave: "concepto", encabezado: "Concepto" },
  { clave: "monto", encabezado: "Monto", formato: "monto" },
];
const FIJAS_PRINCIPAL = ["concepto", "monto"];
const DETALLE: DataTableDescargaDetalle = {
  titulo: "Detalle por guía",
  columnas: [
    { clave: "guia", encabezado: "Guía" },
    { clave: "destinatario", encabezado: "Destinatario" },
    { clave: "aporte", encabezado: "Aporte", formato: "monto" },
  ],
  columnasFijas: ["guia"],
  ambitoColumnas: "prueba-detalle",
  etiquetaOpcion: "Movimientos y detalle por guía · dos hojas",
  etiquetaSinDetalle: "Solo los movimientos · una hoja",
};

const FILAS = [
  { fecha: "2026-09-01", concepto: "Saldo al inicio del periodo", monto: null },
  { fecha: "2026-09-20", concepto: "Flete", monto: "1234567.89" },
  { fecha: null, concepto: "Total del periodo", monto: "1234567.89" },
];
const FILAS_DETALLE = [
  { guia: "1001", destinatario: "Ana", aporte: null },
  { guia: "1001", destinatario: null, aporte: "4.00" },
  { guia: null, destinatario: null, aporte: "4.00" },
];

const obtener = vi.fn<(o?: { conDetalle: boolean }) => Promise<DescargaFilasResult>>();

function montar(props: Partial<Parameters<typeof DescargarDatasetButton>[0]> = {}) {
  return render(
    <DescargarDatasetButton
      titulo="Libro de prueba"
      columnas={COLUMNAS}
      obtenerFilas={obtener}
      ambitoColumnas="prueba-principal"
      columnasFijas={FIJAS_PRINCIPAL}
      detalle={DETALLE}
      {...props}
    />,
  );
}

/** El último archivo bajado, releído con exceljs: nombre de cada hoja, sus filas y sus negritas. */
async function archivo(): Promise<Array<{ nombre: string; filas: unknown[][]; negritas: number[] }>> {
  await waitFor(() => expect(H.blob).toHaveBeenCalled());
  const [contenido] = H.blob.mock.calls.at(-1)!;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  return libro.worksheets.map((h) => {
    const filas: unknown[][] = [];
    const negritas: number[] = [];
    h.eachRow((r, n) => {
      filas.push((r.values as unknown[]).slice(1));
      // Índice de fila de DATOS (la 1 es la de encabezados).
      if (n > 1 && r.getCell(1).font?.bold === true) negritas.push(n - 2);
    });
    return { nombre: h.name, filas, negritas };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  obtener.mockImplementation(async (o) =>
    o?.conDetalle
      ? { status: "ok", filas: FILAS, filasDestacadas: [0, 2], filasDetalle: FILAS_DETALLE, filasDestacadasDetalle: [0, 2] }
      : { status: "ok", filas: FILAS, filasDestacadas: [0, 2] },
  );
});
afterEach(() => cleanup());

describe("464 R41 — sin `detalle` el control es el de siempre", () => {
  it("llama a `obtenerFilas` SIN argumentos, no ofrece opciones nuevas y baja UNA hoja con las columnas de siempre", async () => {
    const user = userEvent.setup();
    montar({ detalle: undefined, columnasFijas: undefined });
    expect(screen.queryByRole("button", { name: DISPARADOR_DETALLE })).toBeNull();
    expect(screen.getByRole("button", { name: "Elegir columnas de la descarga" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith();
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de prueba"]);
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Concepto", "Monto"]);
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

describe("468 R24 / 464 R8 — qué se descarga", () => {
  it("R24: dos opciones excluyentes, cada una dice cuántas hojas lleva; arranca con el detalle", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    expect(screen.getByRole("radiogroup", { name: GRUPO_HOJAS })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Movimientos y detalle por guía · dos hojas" })).toBeChecked();
    expect(OPCION_CON_DETALLE).toBe("Movimientos y detalle por guía · dos hojas");
  });

  it("464 R8: la opción NO se recuerda: elegir «Solo los movimientos», desmontar y volver arranca otra vez con el detalle", async () => {
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

describe("468 R22/R23/R26/R47 — lo que se baja", () => {
  it("R26: con detalle, DOS hojas —la principal primero—, cada una con SUS columnas y nada más (sin «N.º»)", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith({ conDetalle: true });
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de prueba", "Detalle por guía"]);
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Concepto", "Monto"]);
    expect(hojas[1].filas[0]).toEqual(["Guía", "Destinatario", "Aporte"]);
  });

  it("R22: las columnas `monto` salen como NÚMERO de Excel exacto; R23/R47: las filas destacadas, en negrita", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    const monto = hojas[0].filas[2][2];
    expect(typeof monto).toBe("number");
    expect((monto as number).toFixed(2)).toBe("1234567.89");
    expect(typeof hojas[1].filas[2][2]).toBe("number");
    expect(hojas[0].negritas).toEqual([0, 2]);
    expect(hojas[1].negritas).toEqual([0, 2]);
  });

  it("R57: «Solo los movimientos» pide SIN detalle y baja UNA hoja con las mismas columnas y negritas", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
    await cerrarSelectorDetalle(user);
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(obtener).toHaveBeenCalledWith({ conDetalle: false });
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de prueba"]);
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Concepto", "Monto"]);
    expect(hojas[0].negritas).toEqual([0, 2]);
  });

  it("464 R24: sin filas en el detalle, la hoja sale igual con su fila de encabezados", async () => {
    const user = userEvent.setup();
    obtener.mockResolvedValue({ status: "ok", filas: FILAS, filasDetalle: [] });
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[1].filas).toEqual([["Guía", "Destinatario", "Aporte"]]);
  });

  it("464 R36: si la respuesta con detalle no trae las filas del detalle, no hay archivo y se avisa", async () => {
    const user = userEvent.setup();
    obtener.mockResolvedValue({ status: "ok", filas: FILAS });
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("No se pudo generar el archivo. Vuelve a intentarlo; el listado no cambió."));
    expect(H.blob).not.toHaveBeenCalled();
  });

  it("464 R43: un error de lectura es un aviso y ningún archivo", async () => {
    const user = userEvent.setup();
    obtener.mockResolvedValue({ status: "error", mensaje: "No se pudo leer." });
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("No se pudo leer."));
    expect(H.blob).not.toHaveBeenCalled();
  });
});

describe("468 R50/R51/R52 — columnas fijas y columnas de cada hoja por separado", () => {
  it("R51: las fijas se listan MARCADAS y deshabilitadas; las demás se pueden desmarcar; «Columnas de la hoja» cambia de catálogo", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    expect(screen.getByRole("radiogroup", { name: GRUPO_COLUMNAS_DE_LA_HOJA })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Libro de prueba" })).toBeChecked();
    // La casilla de base-ui es un `role="checkbox"` con `aria-disabled` (no un <input disabled>).
    const deshabilitada = (nombre: string) =>
      screen.getByRole("checkbox", { name: nombre }).getAttribute("aria-disabled") === "true";
    expect(screen.getByRole("checkbox", { name: "Concepto" })).toBeChecked();
    expect(deshabilitada("Concepto")).toBe(true);
    expect(deshabilitada("Monto")).toBe(true);
    expect(deshabilitada("Fecha")).toBe(false);
    // Pulsar una fija no la desmarca.
    await user.click(screen.getByRole("checkbox", { name: "Concepto" }));
    expect(screen.getByRole("checkbox", { name: "Concepto" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Detalle por guía" }));
    expect(screen.getByRole("checkbox", { name: "Guía" })).toBeChecked();
    expect(deshabilitada("Guía")).toBe(true);
    expect(deshabilitada("Destinatario")).toBe(false);
    expect(screen.queryByRole("checkbox", { name: "Fecha" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
    expect(screen.queryByRole("radiogroup", { name: GRUPO_COLUMNAS_DE_LA_HOJA })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Fecha" })).toBeInTheDocument();
  });

  it("R51: una columna fija SÍ se puede reordenar, y el archivo sale en ese orden", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("button", { name: "Subir Monto" }));
    await cerrarSelectorDetalle(user);
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Monto", "Concepto"]);
  });

  it("464 R2/R11: desmarcar en la hoja de detalle guarda en SU ámbito y solo cambia esa hoja", async () => {
    const user = userEvent.setup();
    montar();
    await abrirSelectorDetalle(user);
    await user.click(screen.getByRole("radio", { name: "Detalle por guía" }));
    await user.click(screen.getByRole("checkbox", { name: "Destinatario" }));
    await cerrarSelectorDetalle(user);

    expect(window.localStorage.getItem(claveDeAmbitoDescarga("prueba-detalle"))).not.toBeNull();
    expect(window.localStorage.getItem(claveDeAmbitoDescarga("prueba-principal"))).toBeNull();

    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[0].filas[0]).toEqual(["Fecha", "Concepto", "Monto"]);
    expect(hojas[1].filas[0]).toEqual(["Guía", "Aporte"]);
  });

  it("R52: una preferencia guardada ANTES (con claves de la 464 y una fija oculta) produce archivo; lo nuevo sale marcado y la fija sale igual", async () => {
    const user = userEvent.setup();
    // La elección de la 464: «numero» y «detallePorOrden» ya no existen; «monto» (hoy fija) estaba oculta.
    window.localStorage.setItem(
      claveDeAmbitoDescarga("prueba-principal"),
      JSON.stringify({ ocultas: ["numero", "monto"], orden: ["numero", "monto", "fecha", "detallePorOrden"] }),
    );
    window.localStorage.setItem(claveDeAmbitoDescarga("prueba-detalle"), JSON.stringify({ ocultas: ["guia", "cierre"] }));
    montar();
    await user.click(screen.getByRole("button", { name: "Descargar Libro de prueba" }));
    const hojas = await archivo();
    expect(hojas[0].filas[0]).toEqual(["Monto", "Fecha", "Concepto"]);
    expect(hojas[1].filas[0]).toEqual(["Guía", "Destinatario", "Aporte"]);
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
