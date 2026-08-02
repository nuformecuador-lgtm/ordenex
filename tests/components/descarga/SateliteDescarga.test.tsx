// @vitest-environment jsdom
// Feature 170 (T A.2) — descarga del listado de la bodega satélite. Cubre R1, R10, R14,
// R20, R30 y R32.
//
// Es la primera tabla de FAMILIA B del rollout, y por eso importa más de lo que parece:
// fija que la descarga NO relee del servidor y que parte del array YA FILTRADO. Si esto
// sale torcido, las otras 15 tablas de familia B lo copian.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SateliteOrdenesListado } from "@/app/(app)/recepcion-satelite/_components/SateliteOrdenesListado";

const ZONA_ACTOR = "Limón";

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_bodega_satelite",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: ZONA_ACTOR,
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    intentosEntrega: 0,
    ...over,
  };
}

/**
 * Lo que el servicio entrega por props: SOLO órdenes de la zona del actor (el service
 * las acota con `findRecepcionSateliteByZona`), en tres cantones/estados distintos.
 */
const ORDENES: RecepcionSateliteDTO[] = [
  makeOrden({ id: "o1", numRemision: "REM-001", cantonNombre: "Central", distritoNombre: "Limón" }),
  makeOrden({
    id: "o2",
    numRemision: "REM-002",
    estatusValue: "por_devolver",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
  }),
  makeOrden({
    id: "o3",
    numRemision: "REM-003",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
    numGuia: null,
    direccion: null,
    montoCobrar: null,
    intentosEntrega: 2,
  }),
];

function renderListado(ordenes: RecepcionSateliteDTO[] = ORDENES) {
  return render(
    <SateliteOrdenesListado
      ordenes={ordenes}
      zonaNombre={ZONA_ACTOR}
      puedeAsignar
      onAsignar={vi.fn()}
      onEnviarACentral={vi.fn()}
      onRecuperar={vi.fn()}
      onDeshacerAsignacion={vi.fn()}
    />,
  );
}

function botonDescarga() {
  return screen.getByRole("button", { name: "Descargar Órdenes de la bodega" });
}

/**
 * Elige una opción del filtro multi de la barra (estado / cantón / distrito). Mismo
 * recorrido que `tests/unit/components/filter-component.test.tsx`: el panel no se cierra
 * al marcar, así que se reusa el `listbox` si ya está abierto.
 */
async function filtrarPor(
  user: ReturnType<typeof userEvent.setup>,
  filtro: string,
  opcion: string,
) {
  const abierto = screen.queryByRole("listbox", { name: filtro });
  const lista =
    abierto ??
    (await (async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${filtro}:`) }));
      return screen.getByRole("listbox", { name: filtro });
    })());
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
});

afterEach(() => {
  cleanup();
});

describe("Órdenes de la bodega satélite · descarga", () => {
  it("ofrece la descarga de las órdenes de la bodega", async () => {
    const user = userEvent.setup();
    renderListado();

    // R1: control presente, con nombre accesible que identifica el listado.
    expect(botonDescarga()).toBeInTheDocument();
    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^ordenes-de-la-bodega-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Una fila por orden a la vista, en el mismo orden que la tabla.
    const [columnas, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.numRemision)).toEqual(["REM-001", "REM-002", "REM-003"]);
    expect(columnas.map((c) => c.header)).toContain("Nº Remisión");
    expect(titulo).toBe("Órdenes de la bodega");
    // Valores CRUDOS: sin "—" ni "Pendiente" de presentación (R7).
    expect(filas[2].numGuia).toBeNull();
    expect(filas[2].direccion).toBeNull();
    expect(filas[2].intentos).toBe(2);
    // Y nada que la tabla no muestre: el teléfono del destinatario no es columna (R24).
    expect(Object.values(filas[0])).not.toContain("88880000");
  });

  it("respeta los filtros de estado, cantón y distrito aplicados", async () => {
    const user = userEvent.setup();
    renderListado();

    // Se filtra por cantón: la tabla se queda con dos filas…
    // La etiqueta del cantón desambigua con la provincia (feature 117).
    await filtrarPor(user, "Cantón", "Pococí (Limón)");
    const tabla = screen.getByRole("table", { name: "Órdenes de la bodega" });
    await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(2 + 1));

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    // R10: …y el archivo trae EXACTAMENTE esas dos, no las tres del conjunto.
    const [, filasCanton] = buildXlsxRowsMock.mock.calls[0];
    expect(filasCanton.map((f) => f.numRemision)).toEqual(["REM-002", "REM-003"]);

    // Se añade el filtro de estado (AND con el de cantón): queda una sola.
    await filtrarPor(user, "Estado", "Recibidas");
    await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1));

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(2));
    const [, filasEstado] = buildXlsxRowsMock.mock.calls[1];
    expect(filasEstado.map((f) => f.numRemision)).toEqual(["REM-003"]);
  });

  it("no ejecuta ninguna lectura adicional al servidor", () => {
    // R30/R32: la descarga de Familia B se construye sobre el dataset que la pantalla YA
    // tiene. Se comprueba de forma ESTÁTICA, que es donde la propiedad vive: el módulo no
    // importa ninguna Server Action, así que no hay ninguna que pueda llamar —ni al
    // pintar, ni al descargar—.
    const raiz = path.resolve(__dirname, "../../..");
    const fuente = readFileSync(
      path.join(raiz, "app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx"),
      "utf8",
    );
    const importes = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);

    expect(importes.length).toBeGreaterThan(0);
    for (const especificador of importes) {
      expect(especificador).not.toMatch(/^@\/lib\/(actions|services|repositories)\b/);
    }
    expect(fuente).not.toMatch(/\bfetch\s*\(/);
    expect(fuente).not.toMatch(/\buseSWR\b/);
    // El cableado de la descarga es el adaptador LOCAL, no el de Server Action.
    expect(fuente).toMatch(/filasLocales\(/);
    expect(fuente).not.toMatch(/filasDesdeResultado\(/);
  });

  it("solo contiene órdenes de la zona del actor", async () => {
    const user = userEvent.setup();
    // El servicio ya acotó por zona (R14/R20): la pantalla NUNCA recibe una orden ajena.
    // Lo que este test fija es que la descarga no amplía ese alcance por su cuenta: el
    // archivo es exactamente el conjunto recibido, fila a fila.
    renderListado();

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas).toHaveLength(ORDENES.length);
    for (const fila of filas) {
      expect(fila.zona).toBe(ZONA_ACTOR);
    }
    expect(new Set(filas.map((f) => f.numRemision))).toEqual(
      new Set(ORDENES.map((o) => o.numRemision)),
    );
  });
});
