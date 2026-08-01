// @vitest-environment jsdom
// Feature 170 (Tanda F, T F.1) — descarga del RANKING DEL DÍA. Cubre R1, R2, R7 y R11.
//
// La pantalla `/ranking` monta DOS tablas y solo UNA entra en el rollout, así que el riesgo
// propio de esta tanda no es cablear: es cablear la equivocada. La tabla del RANKING
// (`<DataTable>` de mensajeros) descarga; la de PREMIOS del podio —`<table>` HTML cruda de
// tres filas de configuración con montos editables— queda FUERA por decisión ratificada del
// humano (P1) y no puede acabar con un control «de paso». Hay un test para cada mitad.
//
// El otro riesgo es el de siempre en Familia B: que el archivo adorne lo que la tabla pinta.
// El ranking tiene dos celdas formateadas —`100.0%` y `5/5`— y ninguna de las dos puede
// viajar así a una hoja de cálculo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { descargaConfig } from "@/lib/config/descarga";
import { RankingModule } from "@/app/(app)/ranking/_components/RankingModule";
import { COLUMNAS_DESCARGA_RANKING } from "@/app/(app)/ranking/_components/ranking-descarga-columnas";
import type { PremioRankingDTO, RankingRowDTO } from "@/lib/types/ranking";

vi.mock("@/lib/actions/ranking", () => ({
  editarPremioAction: vi.fn(),
  obtenerRankingAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador común se aísla de exceljs: aquí se juzga QUÉ filas y QUÉ columnas se le
// entregan. Que el binario resultante sea un xlsx releíble lo demuestra el round-trip de
// integración (`tests/integration/descarga-170-volumen.test.ts`).
vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

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

// --- Datos ---------------------------------------------------------------

/**
 * Ranking en el orden que YA resolvió el servidor, con los dos casos borde de la pantalla:
 * un ocupante del podio con porcentaje exacto y una fila FUERA del podio (posición y `pct`
 * nulos, cero asignadas). `pct: "80.0"` existe para que se note un `Number` intermedio: lo
 * devolvería como `"80"`.
 */
const RANKING: RankingRowDTO[] = [
  {
    posicion: 1,
    mensajeroId: "m1",
    nombre: "Ana Mensajera",
    entregadasHoy: 5,
    asignadasHoy: 5,
    pct: "100.0",
    premio: "5000",
  },
  {
    posicion: 2,
    mensajeroId: "m2",
    nombre: "Beto Repartidor",
    entregadasHoy: 4,
    asignadasHoy: 5,
    pct: "80.0",
    premio: null,
  },
  {
    posicion: null,
    mensajeroId: "m3",
    nombre: "Caro Sin Ruta",
    entregadasHoy: 0,
    asignadasHoy: 0,
    pct: null,
    premio: null,
  },
];

const PREMIOS: PremioRankingDTO[] = [
  { posicion: 1, monto: "5000", descripcion: "Bono oro" },
  { posicion: 2, monto: null, descripcion: null },
  { posicion: 3, monto: "1000", descripcion: "Consuelo" },
];

const TITULO = "Ranking del día";

function montar(ranking: RankingRowDTO[] = RANKING, esEditable = false) {
  return render(
    <ToastProvider>
      <RankingModule ranking={ranking} premios={PREMIOS} esEditable={esEditable} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Ranking del día · descarga", () => {
  it("el ranking ofrece su control y el archivo trae una fila por mensajero", async () => {
    // R1 + R13: el control existe y su nombre accesible identifica ESTE listado (y no un
    // «Descargar» suelto que en esta pantalla sería ambiguo, con dos tablas a la vista).
    const user = userEvent.setup();
    montar();

    const boton = screen.getByRole("button", { name: `Descargar ${TITULO}` });
    expect(boton).toBeInTheDocument();

    await user.click(boton);
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(RANKING.length);
    expect(hoja).toBe(TITULO);
    // R5: las columnas del archivo son las DECLARADAS, en su orden, no las de la tabla.
    expect(columnas.map((c) => c.key)).toEqual(
      COLUMNAS_DESCARGA_RANKING.map((c) => c.clave),
    );
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
  });

  it("porcentaje y conteo viajan TAL CUAL, sin el «%» ni el «/» de la pantalla", async () => {
    // R7. La tabla pinta `100.0%` y `5/5`; ninguna de las dos formas sirve en una hoja: el
    // símbolo convierte una celda numérica en texto y `5/5` no se puede sumar (y algún
    // Excel lo leería como fecha). El archivo lleva el STRING del servidor y los DOS
    // números crudos que la tabla ya enseña.
    const user = userEvent.setup();
    montar();

    // Lo que la PANTALLA muestra, para que el contraste sea explícito y no de memoria.
    const tabla = screen.getByRole("table", { name: "Ranking diario de mensajeros" });
    const filaAna = within(tabla).getByText("Ana Mensajera").closest("tr") as HTMLElement;
    expect(within(filaAna).getByText("100.0%")).toBeInTheDocument();
    expect(within(filaAna).getByText("5/5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas[0].porcentaje).toBe("100.0"); // sin «%»; un Number daría 100
    expect(filas[0].entregadas).toBe(5);
    expect(filas[0].asignadas).toBe(5);
    expect(filas[1].porcentaje).toBe("80.0"); // un Number lo dejaría en "80": el decimal
    expect(String(filas[0].porcentaje)).not.toContain("%");
    for (const celda of Object.values(filas[0])) {
      expect(String(celda ?? "")).not.toContain("/");
    }

    // R7 en su otra cara: la fila fuera del podio deja las celdas VACÍAS, no el «—» de la
    // pantalla (un guion en una hoja se lee como un valor) y no un 0 que afirmaría un
    // porcentaje que nadie calculó.
    expect(within(tabla).getByText("Caro Sin Ruta").closest("tr")).toBeInTheDocument();
    expect(filas[2].posicion).toBeNull();
    expect(filas[2].porcentaje).toBeNull();
    expect(filas[2].asignadas).toBe(0);
  });

  it("respeta el orden del ranking y no exporta ni el id ni el premio", async () => {
    // R11: el ORDEN lo resolvió el servidor y ni la tabla ni el archivo lo tocan; el
    // archivo sale en el mismo orden en que la pantalla presenta las filas.
    //
    // Y R23/R24: `mensajeroId` es un uuid interno, y el `premio` —que el DTO SÍ trae— lo
    // muestra la OTRA tarjeta, la del podio, que está fuera de alcance. Exportarlo aquí
    // colaría por el archivo un dato que esta tabla no enseña.
    const user = userEvent.setup();
    montar();

    const tabla = screen.getByRole("table", { name: "Ranking diario de mensajeros" });
    const nombresEnPantalla = within(tabla)
      .getAllByRole("row")
      .slice(1)
      .map((fila) => within(fila).getAllByRole("cell")[1].textContent);

    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.mensajero)).toEqual(nombresEnPantalla);
    expect(filas.map((f) => f.mensajero)).toEqual(RANKING.map((r) => r.nombre));

    const claves = COLUMNAS_DESCARGA_RANKING.map((c) => c.clave);
    expect(claves).not.toContain("mensajeroId");
    expect(claves).not.toContain("premio");
    for (const fila of filas) {
      expect(Object.values(fila)).not.toContain("m1");
      expect(Object.values(fila)).not.toContain("5000"); // el premio de Ana
    }
  });

  it("la tabla de premios del podio NO ofrece control de descarga", async () => {
    // R2 (P1 ratificada). Las dos tablas viven en la misma pantalla, así que la garantía
    // que importa es de CANTIDAD: hay UN control, no dos, y el que hay pertenece al
    // ranking. Un segundo botón «Descargar …» aquí significaría que alguien cableó la
    // configuración de premios creyendo que era un listado.
    montar(RANKING, true); // con `esEditable`, que es cuando el podio pinta más controles

    const descargas = screen.getAllByRole("button", { name: /^Descargar / });
    expect(descargas).toHaveLength(1);
    expect(descargas[0]).toHaveAccessibleName(`Descargar ${TITULO}`);

    // Y el control no está DENTRO de la tarjeta de premios ni de su tabla.
    const premios = screen.getByRole("table", { name: "Premios del podio" });
    expect(
      within(premios).queryByRole("button", { name: /^Descargar / }),
    ).not.toBeInTheDocument();
    // El podio sigue con lo suyo intacto: sus 3 botones de guardar (R3).
    expect(screen.getAllByRole("button", { name: "Guardar" })).toHaveLength(3);
  });

  it("por encima del tope rechaza con un error accionable y NO produce archivo", async () => {
    // R26/R27/R28. El ranking está acotado por el nº de mensajeros activos, así que el tope
    // no debería alcanzarse nunca — y precisamente por eso conviene demostrar que rige
    // también aquí: una tabla «pequeña» es donde es tentador saltárselo.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;
    const muchos: RankingRowDTO[] = Array.from({ length: total }, (_, i) => ({
      posicion: null,
      mensajeroId: `m-${i}`,
      nombre: `Mensajero ${i}`,
      entregadasHoy: 1,
      asignadasHoy: 1,
      pct: "100.0",
      premio: null,
    }));

    montar(muchos);
    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const mensaje = String(toastErrorMock.mock.calls[0][0]);
    expect(mensaje).toContain(String(total));
    expect(mensaje).toContain(String(descargaConfig.MAX_FILAS));
    expect(mensaje).toMatch(/acota los filtros/i);
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
  });
});
