// @vitest-environment jsdom
// Feature 196 (T5.3) — descarga del RANKING CONGELADO. Cubre R32, R33 y R35.
//
// Patrón de `RankingDescarga.test.tsx`, y el riesgo es el mismo de toda Familia B: que el
// archivo ADORNE lo que la tabla pinta. Aquí hay tres celdas formateadas —`100.0%`, `₡5000.00`
// y el `—` de las filas sin podio— y ninguna de las tres puede viajar así a una hoja: el `%`
// y el `₡` convierten una celda numérica en texto, y un guion se lee como un valor.
//
// El riesgo PROPIO de esta pantalla es el orden: el archivo tiene que salir en el orden
// CONGELADO (`puesto`), no en uno recalculado. Por eso el caso compara contra lo que la
// pantalla está pintando, no contra el array de entrada.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider } from "@/providers/ToastProvider";
import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows } from "@/lib/utils/xlsx-template";
import { descargaConfig } from "@/lib/config/descarga";
import { RankingHistoricoModule } from "@/app/(app)/ranking/historico/_components/RankingHistoricoModule";
import { COLUMNAS_DESCARGA_RANKING_HISTORICO } from "@/app/(app)/ranking/historico/_components/ranking-historico-descarga-columnas";
import type { RankingSnapshotData, RankingSnapshotFilaDTO } from "@/lib/types/ranking-snapshot";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

// El generador común se aísla de exceljs: aquí se juzga QUÉ filas y QUÉ columnas se le
// entregan. Que el binario sea un xlsx releíble lo demuestra el round-trip de integración.
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

const FECHA = "2026-08-09";
const TITULO = `Ranking del día ${FECHA}`;

const FILAS: RankingSnapshotFilaDTO[] = [
  {
    puesto: 1,
    posicion: 1,
    mensajeroId: "m1",
    nombre: "Ana Mensajera",
    entregadas: 5,
    asignadas: 5,
    pct: "100.0",
    premioMonto: "5000.00",
    premioDescripcion: "Bono oro",
  },
  {
    puesto: 2,
    posicion: 2,
    mensajeroId: "m2",
    nombre: "Beto Repartidor",
    entregadas: 4,
    asignadas: 5,
    pct: "80.0",
    premioMonto: null,
    premioDescripcion: null,
  },
  {
    puesto: 3,
    posicion: null,
    mensajeroId: "m3",
    nombre: "Caro Sin Ruta",
    entregadas: 0,
    asignadas: 0,
    pct: null,
    premioMonto: null,
    premioDescripcion: null,
  },
];

function snapshot(filas: RankingSnapshotFilaDTO[] = FILAS): RankingSnapshotData {
  return {
    fecha: FECHA,
    generadoAt: "2026-08-10T08:00:00.000Z",
    minAsignadasPodio: 3,
    filas,
  };
}

function montar(filas: RankingSnapshotFilaDTO[] = FILAS) {
  return render(
    <ToastProvider>
      <RankingHistoricoModule fecha={FECHA} snapshot={snapshot(filas)} />
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

describe("Ranking histórico · descarga", () => {
  it("R35: el control lleva la FECHA CONSULTADA en su nombre, su hoja y su archivo", async () => {
    // Sin la fecha dentro del título, dos descargas de dos días distintos se llamarían igual
    // y la segunda pisaría a la primera en la carpeta de descargas.
    const user = userEvent.setup();
    montar();

    const boton = screen.getByRole("button", { name: `Descargar ${TITULO}` });
    expect(boton).toBeInTheDocument();

    await user.click(boton);
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [columnas, filas, hoja] = buildXlsxRowsMock.mock.calls[0];
    expect(hoja).toBe(TITULO);
    expect(hoja).toContain(FECHA);
    expect(filas).toHaveLength(FILAS.length);
    expect(columnas.map((c) => c.key)).toEqual(
      COLUMNAS_DESCARGA_RANKING_HISTORICO.map((c) => c.clave),
    );
    expect(descargarBlobMock).toHaveBeenCalledTimes(1);
    // Y el nombre del archivo que se entregó lleva la fecha consultada (R35).
    expect(String(descargarBlobMock.mock.calls[0][2])).toContain(FECHA);
  });

  it("R32: el archivo lleva EXACTAMENTE las filas de la tabla y en su orden", async () => {
    const user = userEvent.setup();
    montar();

    const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
    const nombresEnPantalla = within(tabla)
      .getAllByRole("row")
      .slice(1)
      .map((f) => within(f).getAllByRole("cell")[2].textContent);

    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.mensajero)).toEqual(nombresEnPantalla);
    expect(filas.map((f) => f.puesto)).toEqual([1, 2, 3]);
  });

  it("R32: los valores viajan CRUDOS, sin el «%», sin el «₡» y sin el «—» de la pantalla", async () => {
    const user = userEvent.setup();
    montar();

    // Lo que la PANTALLA muestra, para que el contraste sea explícito y no de memoria.
    const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
    const filaAna = within(tabla).getByText("Ana Mensajera").closest("tr") as HTMLElement;
    expect(within(filaAna).getByText("100.0%")).toBeInTheDocument();
    expect(within(filaAna).getByText("₡5000.00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `Descargar ${TITULO}` }));
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas[0].porcentaje).toBe("100.0"); // un Number lo dejaría en "100"
    expect(filas[0].premio).toBe("5000.00");
    expect(filas[1].porcentaje).toBe("80.0");
    for (const celda of Object.values(filas[0])) {
      expect(String(celda ?? "")).not.toContain("%");
      expect(String(celda ?? "")).not.toContain("₡");
    }

    // La fila fuera del podio deja las celdas VACÍAS, no con el «—» de la pantalla ni con un
    // 0 que afirmaría un porcentaje que nadie calculó.
    expect(filas[2].posicion).toBeNull();
    expect(filas[2].porcentaje).toBeNull();
    expect(filas[2].premio).toBeNull();
    expect(filas[2].asignadas).toBe(0);
    for (const fila of filas) {
      expect(Object.values(fila)).not.toContain("—");
      expect(Object.values(fila)).not.toContain("m1"); // R34: ni un id interno
    }
  });

  it("R33: por encima del tope NO hay archivo y el mensaje dice total y tope", async () => {
    // El histórico está acotado por el nº de mensajeros con actividad de un día, así que el
    // tope no debería alcanzarse nunca — y por eso mismo conviene demostrar que rige: una
    // tabla «pequeña» es donde es tentador saltárselo.
    const user = userEvent.setup();
    const total = descargaConfig.MAX_FILAS + 1;
    const muchas: RankingSnapshotFilaDTO[] = Array.from({ length: total }, (_, i) => ({
      puesto: i + 1,
      posicion: null,
      mensajeroId: `m-${i}`,
      nombre: `Mensajero ${i}`,
      entregadas: 1,
      asignadas: 1,
      pct: "100.0",
      premioMonto: null,
      premioDescripcion: null,
    }));

    montar(muchas);
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
