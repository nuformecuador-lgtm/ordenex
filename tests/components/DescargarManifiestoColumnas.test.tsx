// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DescargarManifiestoButton } from "@/components/shared/DescargarManifiestoButton";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import { COLUMNAS_MANIFIESTO } from "@/lib/manifiesto/columnas-publicadas";
import { claveColumnas } from "@/lib/manifiesto/preferencia-columnas";
import type { ManifiestoFilaDTO, ManifiestoFlujo } from "@/lib/types/manifiesto";

// ---------------------------------------------------------------------------
// Feature 194 — T10. Integración botón + preferencia de columnas:
// R10 (un solo click, sin paso intermedio), R11 (el nombre del archivo no cambia),
// R14/R15 (persiste y sigue vigente tras remontar), R16 (aislamiento entre flujos),
// R18 (dos superficies vivas se sincronizan) y R25 (el servidor no se entera).
//
// R23 GOBIERNA ESTE ARCHIVO: el conjunto de columnas del manifiesto es ABIERTO
// (feature 160/R28). NINGÚN aserto afirma "exactamente N columnas": todo se expresa
// como presencia, ausencia u orden RELATIVO por clave, y lo que necesita "todas" se
// DERIVA de `COLUMNAS_MANIFIESTO`, nunca de un literal.
// ---------------------------------------------------------------------------

vi.mock("@/lib/actions/manifiesto", () => ({ obtenerManifiesto: vi.fn() }));
const obtenerManifiestoMock = vi.mocked(obtenerManifiesto);

// El generador se aísla con la MISMA factoría TOTAL que usan los tests vigentes del botón
// (`DescargarManifiestoButton.test.tsx`, `ManifiestoFlujos.test.tsx`): aquí interesa CON QUÉ
// claves se le llama, no el binario, que cubre `tests/unit/utils/manifiesto-xlsx-columnas.test.ts`.
//
// Que este test pase con una factoría TOTAL —sin `importOriginal`— es justamente la prueba del
// desacoplamiento: la UI de columnas lee el catálogo de `@/lib/manifiesto/columnas-publicadas`
// y NO depende del módulo del generador. Si volviera a hacer falta conservar exports reales de
// `manifiesto-xlsx` para que la UI monte, el acoplamiento habría regresado.
const { buildManifiestoXlsxMock } = vi.hoisted(() => ({
  buildManifiestoXlsxMock:
    vi.fn<
      (
        filas: ManifiestoFilaDTO[],
        clavesVisibles?: readonly string[],
      ) => Promise<ArrayBuffer>
    >(),
}));
vi.mock("@/lib/utils/manifiesto-xlsx", () => ({
  buildManifiestoXlsx: buildManifiestoXlsxMock,
  manifiestoFileName: (flujo: string, fecha: string) =>
    `manifiesto-${flujo}-${fecha}.xlsx`,
}));

const { errorMock, warningMock } = vi.hoisted(() => ({
  errorMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: errorMock,
    warning: warningMock,
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

/** Columna que se ocultará en las pruebas. Derivada, jamás escrita a mano (R23). */
const OCULTA = COLUMNAS_MANIFIESTO[3]!;
/** Otra columna publicada, que debe seguir presente. */
const PRESENTE = COLUMNAS_MANIFIESTO[0]!;

function makeFila(over: Partial<ManifiestoFilaDTO> = {}): ManifiestoFilaDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    telefono: "88880000",
    direccion: "Calle 1",
    zona: "Limón",
    producto: "Camiseta talla M",
    monto: 15000,
    intentos: 0,
    origen: "Bodega central",
    destino: "Limón",
    responsable: "Beto Mensajero",
    fecha: "2026-03-04",
    ...over,
  };
}

function guardarOcultasEnDisco(flujo: ManifiestoFlujo, ocultas: string[]): void {
  window.localStorage.setItem(
    claveColumnas(flujo),
    JSON.stringify({ ocultas }),
  );
}

/** Claves que recibió el generador en su ÚLTIMA llamada (2.º argumento). */
function clavesDeLaUltimaLlamada(): readonly string[] {
  const llamada = buildManifiestoXlsxMock.mock.calls.at(-1);
  expect(llamada).toBeDefined();
  return llamada![1] ?? [];
}

let createObjectURL: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.spyOn>;
let nombreDescargado = "";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  nombreDescargado = "";
  createObjectURL = vi.fn(() => "blob:mock-url");
  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectURL,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  anchorClick = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      nombreDescargado = this.download;
    });
  buildManifiestoXlsxMock.mockResolvedValue(new ArrayBuffer(8));
  obtenerManifiestoMock.mockResolvedValue({
    status: "ok",
    filas: [makeFila()],
    omitidas: [],
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function botonesDescarga() {
  return screen.getAllByRole("button", { name: /descargar manifiesto/i });
}

function disparadoresSelector() {
  return screen.getAllByRole("button", {
    name: "Elegir columnas del manifiesto",
  });
}

function casilla(header: string) {
  return screen.getByRole("checkbox", { name: new RegExp(`\\(${header}\\)`) });
}

describe("DescargarManifiestoButton + preferencia de columnas (feature 194)", () => {
  it("R10 — un SOLO click en el botón descarga con la preferencia guardada, sin abrir el selector", async () => {
    guardarOcultasEnDisco("carga_masiva", [OCULTA.key]);
    const user = userEvent.setup();

    render(
      <DescargarManifiestoButton
        flujo="carga_masiva"
        seleccion={{ numRemisiones: ["REM-001"] }}
      />,
    );

    // El selector NI SIQUIERA se monta: no hay paso intermedio de confirmación.
    expect(screen.queryByText("Columnas del manifiesto")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();

    await user.click(botonesDescarga()[0]!);

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    // Un click, una generación, una descarga.
    expect(buildManifiestoXlsxMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    // Y el archivo salió con la preferencia ya guardada, sin haber abierto nada.
    const claves = clavesDeLaUltimaLlamada();
    expect(claves).toContain(PRESENTE.key);
    expect(claves).not.toContain(OCULTA.key);
    expect(screen.queryByText("Columnas del manifiesto")).toBeNull();
  });

  it("R11 — el nombre del archivo NO cambia al exportar un subconjunto de columnas", async () => {
    guardarOcultasEnDisco("carga_masiva", [OCULTA.key]);
    const user = userEvent.setup();

    render(
      <DescargarManifiestoButton
        flujo="carga_masiva"
        seleccion={{ numRemisiones: ["REM-001"] }}
      />,
    );
    await user.click(botonesDescarga()[0]!);

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    // Mismo patrón `manifiesto-<flujo>-<fecha>.xlsx` de la feature 148, intacto.
    expect(nombreDescargado).toBe("manifiesto-carga_masiva-2026-03-04.xlsx");
    expect(clavesDeLaUltimaLlamada()).not.toContain(OCULTA.key);
  });

  it("R14, R15 — desmarcar una columna persiste bajo la clave del flujo y sigue vigente tras remontar", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <DescargarManifiestoButton
        flujo="carga_masiva"
        seleccion={{ numRemisiones: ["REM-001"] }}
      />,
    );

    await user.click(disparadoresSelector()[0]!);
    await screen.findByText("Columnas del manifiesto");
    await user.click(casilla(OCULTA.header));

    // R14: queda escrito en `ordenex:manifiesto-columnas:<flujo>` y en ninguna otra clave.
    await waitFor(() => {
      const crudo = window.localStorage.getItem(claveColumnas("carga_masiva"));
      expect(crudo).not.toBeNull();
      expect(JSON.parse(crudo!).ocultas).toContain(OCULTA.key);
    });

    // R15: se remonta el componente (equivale a volver a entrar) y la preferencia manda,
    // sin volver a abrir el selector.
    unmount();
    render(
      <DescargarManifiestoButton
        flujo="carga_masiva"
        seleccion={{ numRemisiones: ["REM-001"] }}
      />,
    );
    await user.click(botonesDescarga()[0]!);

    await waitFor(() => expect(buildManifiestoXlsxMock).toHaveBeenCalledTimes(1));
    const claves = clavesDeLaUltimaLlamada();
    expect(claves).not.toContain(OCULTA.key);
    expect(claves).toContain(PRESENTE.key);
  });

  it("R16 — cambiar `carga_masiva` NO altera lo que ofrece `asignacion_satelite`", async () => {
    guardarOcultasEnDisco("carga_masiva", [OCULTA.key]);
    const user = userEvent.setup();

    render(
      <DescargarManifiestoButton
        flujo="asignacion_satelite"
        seleccion={{ ordenIds: ["o1"] }}
      />,
    );

    // El otro flujo ni siquiera tiene preferencia escrita: nadie tocó su clave.
    expect(
      window.localStorage.getItem(claveColumnas("asignacion_satelite")),
    ).toBeNull();

    // Y lo que ofrece son TODAS las publicadas (derivado, nunca un número literal).
    await user.click(disparadoresSelector()[0]!);
    await screen.findByText("Columnas del manifiesto");
    for (const columna of COLUMNAS_MANIFIESTO) {
      expect(casilla(columna.header)).toHaveAttribute("aria-checked", "true");
    }

    await user.keyboard("{Escape}");
    await user.click(botonesDescarga()[0]!);

    await waitFor(() => expect(buildManifiestoXlsxMock).toHaveBeenCalledTimes(1));
    const claves = clavesDeLaUltimaLlamada();
    // La columna oculta en `carga_masiva` sigue saliendo aquí.
    expect(claves).toContain(OCULTA.key);
    for (const columna of COLUMNAS_MANIFIESTO) {
      expect(claves).toContain(columna.key);
    }
    // Y la preferencia del otro flujo no se ha movido.
    expect(
      JSON.parse(window.localStorage.getItem(claveColumnas("carga_masiva"))!)
        .ocultas,
    ).toEqual([OCULTA.key]);
  });

  it("R18 — dos botones del MISMO flujo montados a la vez se sincronizan sin recargar la página", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DescargarManifiestoButton
          flujo="envio_tienda"
          seleccion={{ ordenIds: ["o1"] }}
        />
        <DescargarManifiestoButton
          flujo="envio_tienda"
          seleccion={{ ordenIds: ["o1"] }}
          label="Descargar manifiesto de la tienda"
        />
      </>,
    );

    // Se edita la preferencia desde el PRIMER selector…
    await user.click(disparadoresSelector()[0]!);
    await screen.findByText("Columnas del manifiesto");
    await user.click(casilla(OCULTA.header));
    await user.keyboard("{Escape}");

    // …y descarga el SEGUNDO botón, que nunca se abrió: ya está al día.
    const segundo = screen.getByRole("button", {
      name: "Descargar manifiesto de la tienda",
    });
    await user.click(segundo);

    await waitFor(() => expect(buildManifiestoXlsxMock).toHaveBeenCalledTimes(1));
    const claves = clavesDeLaUltimaLlamada();
    expect(claves).not.toContain(OCULTA.key);
    expect(claves).toContain(PRESENTE.key);
  });

  it("R25 — `obtenerManifiesto` se llama con el MISMO input de hoy, sin información de columnas", async () => {
    guardarOcultasEnDisco("generacion_guia", [OCULTA.key]);
    const user = userEvent.setup();

    render(
      <DescargarManifiestoButton
        flujo="generacion_guia"
        seleccion={{ ordenIds: ["o1", "o2"] }}
      />,
    );
    await user.click(botonesDescarga()[0]!);

    await waitFor(() => expect(obtenerManifiestoMock).toHaveBeenCalledTimes(1));
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "generacion_guia",
      ordenIds: ["o1", "o2"],
    });
    // La petición no lleva NADA de columnas: el filtrado es de presentación.
    const input = obtenerManifiestoMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(input).sort()).toEqual(["flujo", "ordenIds"]);
    expect(JSON.stringify(input)).not.toMatch(/columna|oculta|visible/i);
  });

  it("el generador recibe las claves visibles, en el orden RELATIVO de las columnas publicadas", async () => {
    // Se ocultan dos columnas no contiguas; las que quedan deben conservar su orden
    // relativo publicado, comprobado por índice y nunca por longitud total (R23).
    const segundaOculta = COLUMNAS_MANIFIESTO[1]!;
    guardarOcultasEnDisco("ruteo_satelite", [OCULTA.key, segundaOculta.key]);
    const user = userEvent.setup();

    render(
      <DescargarManifiestoButton
        flujo="ruteo_satelite"
        seleccion={{ ordenIds: ["o1"] }}
      />,
    );
    await user.click(botonesDescarga()[0]!);

    await waitFor(() => expect(buildManifiestoXlsxMock).toHaveBeenCalledTimes(1));
    const claves = clavesDeLaUltimaLlamada();

    // Ausencia de las ocultadas.
    expect(claves).not.toContain(OCULTA.key);
    expect(claves).not.toContain(segundaOculta.key);
    // Presencia de todas las demás publicadas, derivando "todas" de la fuente de verdad.
    const esperadas = COLUMNAS_MANIFIESTO.filter(
      (columna) =>
        columna.key !== OCULTA.key && columna.key !== segundaOculta.key,
    ).map((columna) => columna.key);
    for (const clave of esperadas) expect(claves).toContain(clave);
    // Orden relativo: la secuencia recibida es la de `COLUMNAS_MANIFIESTO` filtrada.
    expect([...claves]).toEqual(esperadas);
    // Y las filas viajan enteras: el filtro va en las columnas, no en los datos.
    expect(buildManifiestoXlsxMock.mock.calls[0]![0]).toHaveLength(1);
  });
});
