// @vitest-environment jsdom
// Feature 170 (T A.2) — descarga del listado de la bodega satélite. Cubre R1, R10, R14 y R20.
//
// Era la primera tabla de FAMILIA B del rollout: el dataset entero llegaba por props y el
// archivo se proyectaba del array que la tabla pintaba, sin releer nada.
//
// Feature 170 — FASE 2 (T K.3): esa pantalla PAGINA, así que «lo que la tabla pinta» es una
// página y proyectarla degradaría la descarga a «descargá lo que se ve» (R52). El módulo
// relee el conjunto completo al pulsar y le aplica los filtros vigentes; lo que este archivo
// sigue fijando es lo de siempre —qué columnas salen, con qué valores crudos y respetando
// los tres filtros—, ahora sobre el CONJUNTO. La no-degradación a la página la mide
// `tests/components/paginacion/SatelitePaginacion.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import {
  PAGE_SIZE_SATELITE,
  catalogoSatelite,
  paginaBodega,
} from "@/tests/fixtures/satelite-bodega";

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

// La cámara nunca se abre en estos tests; el mock evita cargar el módulo real.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

// Feature 170 — FASE 2 (T K.3): las DOS lecturas del listado. `paginado` es lo que la tabla
// pinta (una página, ya filtrada por el servidor); `conjunto` es de donde sale el archivo.
const { paginadoMock, conjuntoMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  conjuntoMock: vi.fn(),
}));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  recibirPorQr: vi.fn(),
  recibirLote: vi.fn(),
  asignarDesdeSatelite: vi.fn(),
  listarRecepcionSatelite: (...a: unknown[]) => conjuntoMock(...a),
  listarOrdenesBodegaPaginado: (...a: unknown[]) => paginadoMock(...a),
}));
vi.mock("@/lib/actions/envio-devolucion-central", () => ({ enviarACentral: vi.fn() }));
vi.mock("@/lib/actions/resolver-novedad", () => ({ recuperarABodega: vi.fn() }));

import { RecepcionSateliteModule } from "@/app/(app)/recepcion-satelite/_components/RecepcionSateliteModule";

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
 * El CONJUNTO del actor: SOLO órdenes de su zona (el service las acota con
 * `findRecepcionSateliteByZona`), en dos cantones y dos estados. En el orden del flujo de la
 * bodega, que es el que impone el `ORDER BY` del listado (R51): primero las recibidas, luego
 * las que están por devolver.
 */
const ORDENES: RecepcionSateliteDTO[] = [
  makeOrden({ id: "o1", numRemision: "REM-001", cantonNombre: "Central", distritoNombre: "Limón" }),
  makeOrden({
    id: "o2",
    numRemision: "REM-002",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
  }),
  makeOrden({
    id: "o3",
    numRemision: "REM-003",
    estatusValue: "por_devolver",
    cantonNombre: "Pococí",
    distritoNombre: "Guápiles",
    numGuia: null,
    direccion: null,
    montoCobrar: null,
    intentosEntrega: 2,
  }),
];

/**
 * El filtro que resuelve el SERVIDOR (T K.1), reimplementado aquí a propósito: comparación
 * por igualdad EXACTA del nombre, como el SQL, para que el doble no sea el mismo código que
 * se está midiendo.
 */
function filtrarComoElServidor(
  ordenes: RecepcionSateliteDTO[],
  input: { estados?: string[]; cantones?: string[]; distritos?: string[] } = {},
): RecepcionSateliteDTO[] {
  return ordenes.filter((orden) => {
    if (input.estados?.length && !input.estados.includes(orden.estatusValue)) return false;
    if (input.cantones?.length && !input.cantones.includes(orden.cantonNombre)) return false;
    if (input.distritos?.length) {
      if (orden.distritoNombre === null) return false;
      if (!input.distritos.includes(orden.distritoNombre)) return false;
    }
    return true;
  });
}

function renderModulo(ordenes: RecepcionSateliteDTO[] = ORDENES) {
  paginadoMock.mockImplementation(async (input = {}) => {
    const filtradas = filtrarComoElServidor(ordenes, input);
    return {
      status: "ok",
      items: filtradas,
      page: 1,
      pageSize: PAGE_SIZE_SATELITE,
      total: filtradas.length,
    };
  });
  // El conjunto tal como lo devuelve `listarRecepcionSatelite`: los cinco grupos por estado.
  conjuntoMock.mockResolvedValue({
    status: "ok",
    porRecibir: [],
    recibidas: ordenes.filter((o) => o.estatusValue === "en_bodega_satelite"),
    asignadas: [],
    porDevolver: ordenes.filter((o) => o.estatusValue === "por_devolver"),
    enTransitoACentral: [],
    devueltas: [],
    zonaNombre: ZONA_ACTOR,
    sinZona: false,
  });
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <RecepcionSateliteModule
        porRecibir={[]}
        ordenesBodega={paginaBodega(ordenes)}
        catalogoFiltros={catalogoSatelite(ordenes)}
        zonaNombre={ZONA_ACTOR}
        sinZona={false}
        mensajeros={[]}
        bloqueoBodega={{
          bloqueada: false,
          porMensajeros: false,
          porCierreBodega: false,
        }}
      />
    </SWRConfig>,
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
    renderModulo();

    // R1: control presente, con nombre accesible que identifica el listado.
    expect(botonDescarga()).toBeInTheDocument();
    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^ordenes-de-la-bodega-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Una fila por orden del CONJUNTO, en el orden del flujo de la bodega (R51).
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
    renderModulo();

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
    expect(filasEstado.map((f) => f.numRemision)).toEqual(["REM-002"]);
  });

  it("descargar relee el CONJUNTO, no otra página del listado", async () => {
    // Feature 170 — FASE 2 (T K.3, R52): esta tabla era de FAMILIA B —el dataset entero
    // llegaba por props y el archivo no releía nada (R30/R32 de la FASE 1)—. Al paginar, esa
    // vía deja de existir: lo que la pantalla tiene es UNA página. La descarga pasa a releer
    // el listado COMPLETO, que es el que la pantalla llamaba antes de paginar y que el
    // servidor acota igual por zona (R14/R44). Lo que NO puede hacer es pedir páginas: eso
    // sería descargar por partes lo que ya se decidió entregar entero.
    const user = userEvent.setup();
    renderModulo();

    await waitFor(() => expect(paginadoMock).toHaveBeenCalled());
    const paginasAntes = paginadoMock.mock.calls.length;
    expect(conjuntoMock).not.toHaveBeenCalled();

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    expect(conjuntoMock).toHaveBeenCalledTimes(1);
    expect(paginadoMock.mock.calls.length).toBe(paginasAntes);
  });

  it("solo contiene órdenes de la zona del actor", async () => {
    const user = userEvent.setup();
    // El servicio ya acotó por zona (R14/R20): la pantalla NUNCA recibe una orden ajena.
    // Lo que este test fija es que la descarga no amplía ese alcance por su cuenta: el
    // archivo es exactamente el conjunto que devuelve el listado, fila a fila.
    renderModulo();

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
