// @vitest-environment jsdom
// 2026-08-14 (pedido humano) — DESCARGA DEL LISTADO DE NOVEDADES.
//
// `/novedades` no monta un `DataTable` (son cards), así que el control de descarga no le llega
// heredado como a las ~27 tablas de la app: se monta a mano. Eso es justo lo que hace que este
// archivo tenga que existir, porque las dos cosas que la tabla garantiza por construcción aquí
// hay que afirmarlas:
//
//   (a) que el archivo salga del LISTADO ENTERO y no de la página visible —el listado pagina de
//       diez en diez, y proyectar `items` degradaría la descarga a «descargá lo que se ve»—;
//   (b) que montar la pantalla NO ejecute esa lectura: se lee cuando el usuario pulsa.
//
// Molde: `tests/components/descarga/SateliteDescarga.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { descargarBlob } from "@/components/shared/descargar-blob";
import { buildXlsxRows, XLSX_MIME } from "@/lib/utils/xlsx-template";
import type { NovedadDTO } from "@/lib/types/novedad";

vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: vi.fn() }));
const descargarBlobMock = vi.mocked(descargarBlob);

vi.mock("@/lib/utils/xlsx-template", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/xlsx-template")>();
  return { ...actual, buildXlsxRows: vi.fn(async () => new ArrayBuffer(8)) };
});
const buildXlsxRowsMock = vi.mocked(buildXlsxRows);

// El control NO pinta el fallo en la lista: lo dice por toast (`DescargarDatasetButton`). Para
// poder afirmar QUÉ dice, el doble tiene que ser inspeccionable.
const { errorToastMock } = vi.hoisted(() => ({ errorToastMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorToastMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Las DOS lecturas del listado, cada una con su doble, porque lo que se mide es CUÁL alimenta el
// archivo: `paginado` es la que repagina la lista, `completo` la dedicada a la descarga.
const { paginadoMock, completoMock } = vi.hoisted(() => ({
  paginadoMock: vi.fn(),
  completoMock: vi.fn(),
}));
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: (...a: unknown[]) => paginadoMock(...a),
  listarNovedadesCompletoAction: (...a: unknown[]) => completoMock(...a),
}));
vi.mock("@/lib/actions/resolver-novedad", () => ({ reprogramarNovedad: vi.fn() }));

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";

const PAGE_SIZE = 10;

function novedad(over: Partial<NovedadDTO> & { id: string }): NovedadDTO {
  return {
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "devuelta",
    intentosContacto: 0,
    destinatario: "Ana Cliente",
    telefonoDest: "88887777",
    direccion: "Av. Central 120",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 24500,
    latitud: 9.9281,
    longitud: -84.0907,
    notas: null,
    tiendaNombre: "Tienda Demo",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: null,
    causa: "not_found",
    intentosEntrega: 2,
    ...over,
  };
}

/** La PÁGINA visible: una sola de las tres del listado, para que «entero» ≠ «lo que se ve». */
const PAGINA: NovedadDTO[] = [novedad({ id: "o1", numRemision: "REM-001" })];

/** El LISTADO ENTERO, tal como lo devuelve la lectura dedicada. */
const CONJUNTO: NovedadDTO[] = [
  novedad({ id: "o1", numRemision: "REM-001" }),
  novedad({ id: "o2", numRemision: "REM-002", causa: null, numGuia: null, direccion: null }),
  novedad({ id: "o3", numRemision: "REM-003", causa: "wrong_address", intentosEntrega: 0 }),
];

function renderModulo() {
  return render(
    <NovedadesModule items={PAGINA} total={CONJUNTO.length} page={1} pageSize={PAGE_SIZE} />,
  );
}

const botonDescarga = () => screen.getByRole("button", { name: "Descargar Novedades" });

beforeEach(() => {
  vi.clearAllMocks();
  buildXlsxRowsMock.mockResolvedValue(new ArrayBuffer(8));
  completoMock.mockResolvedValue({ status: "ok", items: CONJUNTO, total: CONJUNTO.length });
});

afterEach(() => {
  cleanup();
});

describe("Novedades · descarga", () => {
  it("ofrece la descarga y produce el archivo del listado", async () => {
    const user = userEvent.setup();
    renderModulo();

    expect(botonDescarga()).toBeInTheDocument();
    await user.click(botonDescarga());

    await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
    const [, mime, nombreArchivo] = descargarBlobMock.mock.calls[0];
    expect(mime).toBe(XLSX_MIME);
    expect(nombreArchivo).toMatch(/^novedades-\d{4}-\d{2}-\d{2}\.xlsx$/);

    const [columnas, filas, titulo] = buildXlsxRowsMock.mock.calls[0];
    expect(titulo).toBe("Novedades");
    expect(columnas.map((c) => c.header)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Destinatario",
      "Teléfono",
      "Dirección",
      "Ubicación",
      "Producto",
      "Monto a cobrar",
      "Causa de devolución",
      "Intentos de entrega",
    ]);

    // La CAUSA sale como etiqueta ES, nunca como el slug del enum (R11), y la ubicación como la
    // misma línea que el resto de los archivos.
    expect(filas[0].causa).toBe("Cliente no localizado");
    expect(filas[0].ubicacion).toBe("GAM Oeste · San José · Escazú · San Rafael");
    expect(filas[0].intentos).toBe(2);
    // Valores CRUDOS: sin el placeholder de guía ni el «—» de presentación de la card…
    expect(filas[1].numGuia).toBeNull();
    expect(filas[1].direccion).toBeNull();
    // …salvo la causa ausente, que en el archivo dice lo MISMO que la card dice en pantalla.
    expect(filas[1].causa).toBe("Sin causa registrada");
    // El `0` de intentos es un dato («ningún intento»), no un hueco.
    expect(filas[2].intentos).toBe(0);
  });

  it("el archivo trae el LISTADO ENTERO, no la página visible", async () => {
    const user = userEvent.setup();
    renderModulo();

    // (b) montar la pantalla no lee el conjunto: se lee al pulsar, y ni una vez antes.
    expect(completoMock).not.toHaveBeenCalled();

    await user.click(botonDescarga());
    await waitFor(() => expect(buildXlsxRowsMock).toHaveBeenCalledTimes(1));

    expect(completoMock).toHaveBeenCalledTimes(1);
    // (a) tres filas, las del conjunto, y no la única que la lista pinta. Y sin pedir páginas:
    // descargar por partes lo que se decidió entregar entero es la otra forma de degradarlo.
    const [, filas] = buildXlsxRowsMock.mock.calls[0];
    expect(filas.map((f) => f.numRemision)).toEqual(["REM-001", "REM-002", "REM-003"]);
    expect(paginadoMock).not.toHaveBeenCalled();
  });

  it("superado el tope no hay archivo: avisa con el total y el tope", async () => {
    const user = userEvent.setup();
    completoMock.mockResolvedValue({ status: "limite_excedido", total: 7200, limite: 5000 });
    renderModulo();

    await user.click(botonDescarga());

    // Ni archivo truncado ni archivo a medias: NINGUNO.
    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(buildXlsxRowsMock).not.toHaveBeenCalled();
    expect(descargarBlobMock).not.toHaveBeenCalled();
    const mensaje = errorToastMock.mock.calls[0][0] as string;
    expect(mensaje).toContain("5000");
    expect(mensaje).toContain("7200");
  });

  it("un fallo de la lectura se dice por toast y no produce archivo", async () => {
    const user = userEvent.setup();
    completoMock.mockResolvedValue({ status: "forbidden" });
    renderModulo();

    await user.click(botonDescarga());

    await waitFor(() => expect(errorToastMock).toHaveBeenCalledTimes(1));
    expect(descargarBlobMock).not.toHaveBeenCalled();
    // El mensaje dice qué hacer, no solo que no hubo archivo.
    expect(errorToastMock.mock.calls[0][0]).toContain("Vuelve a intentarlo");
  });
});
