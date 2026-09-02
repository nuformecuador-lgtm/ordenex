// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaResumen } from "@/app/(app)/ordenes/_components/OrdenesCargaResumen";
import { formatMonto, monedaConfig, SIN_MONTO } from "@/lib/config/moneda";
import type { ResumenCargaOrdenDTO } from "@/lib/types/carga-masiva-resumen";

// Feature 16 / 159 R12, R13, R14, R22(d) — el resumen del lote recien cargado, en
// SOLO LECTURA.
//
// Procedencia: `tests/components/OrdenesCargaResumen.test.tsx` (375 lineas) se borro
// entero con la feature 159. Se recuperan las columnas de datos, el `numRemisiones`
// que viaja a la Server Action y la ausencia de descarga de errores; se descartan los
// `describe` del select por fila, la preseleccion al azar, el submit y sus toasts,
// porque probaban el flujo retirado (design.md §7).

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { resumenCargaMasivaMock } = vi.hoisted(() => ({ resumenCargaMasivaMock: vi.fn() }));

// Feature 157 (bloque E): el paso 3 gano el boton de manifiesto, que avisa por toast. Se
// mockea el hook —en vez de envolver cada render en el provider— porque estos casos miran la
// TABLA del resumen; el manifiesto tiene su propia suite (`ManifiestoFlujos`).
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// El paso 3 monta el modal de etiquetas; su action se mockea para no arrastrar la
// generacion de PDF/QR en jsdom. Cada caso decide que devuelve.
vi.mock("@/lib/actions/etiquetas-guia", () => ({
  generarEtiquetas: vi.fn(async () => ({ status: "ok", etiquetas: [], omitidas: [] })),
}));
vi.mock("qrcode.react", () => ({ QRCodeCanvas: () => null }));
vi.mock("react-barcode", () => ({ default: () => null }));

vi.mock("@/lib/actions/carga-masiva-resumen", () => ({
  resumenCargaMasiva: resumenCargaMasivaMock,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORDENES: ResumenCargaOrdenDTO[] = [
  {
    id: "o1",
    numGuia: 1,
    numRemision: "REM-0001",
    destinatario: "Juan Pérez",
    telefonoDest: "0999999999",
    producto: "Camiseta",
    montoCobrar: 25.9,
    direccion: "Av. Amazonas",
    estatusValue: "en_preparacion",
    zonaId: "z1",
    zonaNombre: "Norte",
  },
  {
    id: "o2",
    numGuia: 2,
    numRemision: "REM-0002",
    destinatario: "María Ruiz",
    telefonoDest: "0988888888",
    producto: "Pantalón",
    montoCobrar: null,
    direccion: null,
    estatusValue: "en_preparacion",
    zonaId: "z1",
    zonaNombre: "Norte",
  },
];

/** Promesa diferida controlada por el test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: ORDENES });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// R12 / R22(d) — DataTable del resumen: qué se cargó, columna por columna
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — DataTable del resumen (R12, R22)", () => {
  it("renderiza una fila por orden con num_remision visible", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);

    expect(await screen.findByText("REM-0001")).toBeInTheDocument();
    expect(screen.getByText("REM-0002")).toBeInTheDocument();
    expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
    expect(screen.getByText("María Ruiz")).toBeInTheDocument();
  });

  it("muestra el resto de columnas de datos de cada orden", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(screen.getByText("0999999999")).toBeInTheDocument();
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
    // Feature 230/R13: el monto pasa por el formateador compartido. Antes esta
    // celda pintaba `25.90` crudo —sin simbolo y sin agrupar—; la 230 lo dejo en
    // `₡26` y la ficha 359 le devuelve su cola, que es la que el monto tiene.
    expect(screen.getByText("₡25,90")).toBeInTheDocument();
    expect(screen.getByText("Av. Amazonas")).toBeInTheDocument();
    // Sin monto ni dirección se muestra el marcador de dato ausente, no vacío.
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(2);
    // La zona de la orden es columna del resumen.
    expect(screen.getAllByText("Norte")).toHaveLength(2);
  });

  it("invoca resumenCargaMasiva UNA vez con los numRemisiones recibidos por props", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(resumenCargaMasivaMock).toHaveBeenCalledTimes(1);
    expect(resumenCargaMasivaMock).toHaveBeenCalledWith({
      numRemisiones: ["REM-0001", "REM-0002"],
    });
  });

  it("R20 (feature 143): el paso posterior a la carga real NO ofrece descargar filas con error", async () => {
    // Decisión de gate G-1: la descarga vive SOLO en la vista previa (antes de
    // crear nada). Este paso no lista filas con error ni ofrece exportarlas.
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(
      screen.queryByRole("button", { name: /descargar filas con error/i }),
    ).toBeNull();
    // La red era "ninguna descarga en absoluto"; se acota a lo que R20 protege —las FILAS
    // CON ERROR, que solo se exportan desde la vista previa—, porque desde la 157 este paso
    // sí ofrece una descarga legítima y distinta: el manifiesto del lote recién creado.
    const descargasDeErrores = screen
      .queryAllByRole("button")
      .filter((b) => /error/i.test(b.textContent ?? ""));
    expect(descargasDeErrores).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// El estatus se lee igual que en el listado de órdenes
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — el estatus usa el chip del listado", () => {
  it("traduce el value de la DB en vez de pintarlo crudo", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    // La confirmación de un lote de cientos de filas mostraba `en_preparacion`.
    expect(screen.getAllByText("En preparación")).toHaveLength(2);
    expect(screen.queryByText("en_preparacion")).not.toBeInTheDocument();
  });

  it("es el mismo chip de /ordenes, con su color, no texto suelto", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("REM-0001");
    const [chip] = screen.getAllByText("En preparación");

    // `en_preparacion` -> variante `secondary` de la primitiva `Badge`. Se afirma la
    // clase de la variante, no un hex: si alguien reimplementa la celda con un `<span>`
    // suelto o con otro color, esto cae.
    expect(chip.className).toMatch(/\bbg-secondary\b/);
  });

  it("una orden sin estatus no pinta un chip vacío", async () => {
    resumenCargaMasivaMock.mockResolvedValue({
      status: "ok",
      ordenes: [{ ...ORDENES[0], estatusValue: undefined }],
    });

    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("REM-0001");

    // Mismo marcador de dato ausente que la dirección y el monto de esta tabla.
    expect(screen.queryByText("En preparación")).not.toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Feature 230 / R13 — la celda del monto pasa por el formateador compartido
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — el monto lo formatea el módulo de moneda (230/R13)", () => {
  /** Una sola fila, con el monto que pide el criterio de Hecho de T4.1. */
  function unaOrdenCon(montoCobrar: number | null): ResumenCargaOrdenDTO[] {
    return [{ ...ORDENES[0], montoCobrar }];
  }

  it("con 1234.56 la celda muestra ₡1.234,56: símbolo, miles y la cola del dato", async () => {
    // Era la única fuga del árbol: `row.montoCobrar.toFixed(2)` pintaba `1234.56`
    // pelado. Este caso mide las tres cosas que gana a la vez —el símbolo, el
    // separador de miles y el separador decimal de configuración— y que el
    // formato ya no es el crudo del servidor.
    resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: unaOrdenCon(1234.56) });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("REM-0001");

    expect(screen.getByText("₡1.234,56")).toBeInTheDocument();
    expect(screen.queryByText("1234.56")).not.toBeInTheDocument();
  });

  it("un monto REDONDO no arrastra cola: eso lo quitó la 230 y sigue quitado", async () => {
    // La dirección «solo si» de la regla de la ficha 359, medida en la celda.
    // Antes este caso afirmaba lo contrario para un `1234.5` (`₡1.235`); ahora
    // afirma que el que NO tiene cola sigue pelado.
    resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: unaOrdenCon(1234) });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("REM-0001");

    expect(screen.getByText("₡1.234")).toBeInTheDocument();
    const celdas = screen.getAllByRole("cell").map((td) => td.textContent ?? "");
    expect(celdas.some((texto) => new RegExp(`${monedaConfig.separadorDecimal}\\d`).test(texto))).toBe(
      false,
    );
  });

  it("sin monto sigue mostrando el mismo marcador que pintaba a mano", async () => {
    // El `-` no es una elección nueva del formateador: es `SIN_MONTO`, el mismo
    // carácter que esta celda ponía a mano cuando `montoCobrar` era `null`.
    resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: unaOrdenCon(null) });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("REM-0001");

    const celdas = screen.getAllByRole("cell").map((td) => td.textContent ?? "");
    expect(celdas).toContain(SIN_MONTO);
  });
});

// ---------------------------------------------------------------------------
// R12, R13, R14 (159) — solo lectura: ni selector, ni acción, ni azar
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — solo lectura (R12, R13, R14)", () => {
  it("no ofrece ningún selector de mensajero ni acción de sugerir asignación", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sugerir asignación/i }),
    ).not.toBeInTheDocument();
    // Lo que la 159 retiró es la ASIGNACIÓN de mensajero desde este paso, no cualquier
    // control: desde la 157 hay un botón de manifiesto, que no decide nada sobre la orden.
    // Sigue sin haber acciones que muten las órdenes recién creadas.
    expect(
      screen.queryByRole("button", { name: /asignar|mensajero/i }),
    ).not.toBeInTheDocument();
  });

  it("la tabla no tiene columna de mensajero", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("REM-0001");

    const cabeceras = screen.getAllByRole("columnheader").map((th) => th.textContent ?? "");
    expect(cabeceras).toEqual([
      "Nº Remisión",
      "Destinatario",
      "Teléfono",
      "Producto",
      "Estatus",
      "Monto",
      "Dirección",
      "Zona",
    ]);
    expect(cabeceras.some((c) => /mensajero/i.test(c))).toBe(false);
  });

  it("R14: renderizar el resumen no consulta el azar en ningún punto", async () => {
    const random = vi.spyOn(Math, "random");

    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(random).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Estados de la carga: cargando / error / lote vacío
// ---------------------------------------------------------------------------
describe("OrdenesCargaResumen — estados de carga", () => {
  it("mientras resuelve muestra el estado de carga, no el vacío", async () => {
    const pendiente = deferred<{ status: "ok"; ordenes: ResumenCargaOrdenDTO[] }>();
    resumenCargaMasivaMock.mockReturnValue(pendiente.promise);

    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);

    expect(screen.getByRole("status")).toHaveTextContent("Cargando");
    expect(screen.queryByText("No hay órdenes en este lote")).not.toBeInTheDocument();

    pendiente.resolve({ status: "ok", ordenes: ORDENES });
    expect(await screen.findByText("REM-0001")).toBeInTheDocument();
  });

  it("si la acción responde forbidden, avisa del fallo y no pinta filas", async () => {
    resumenCargaMasivaMock.mockResolvedValue({ status: "forbidden" });

    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar el resumen de la carga masiva.",
    );
    expect(screen.queryByText("REM-0001")).not.toBeInTheDocument();
  });

  it("si la acción rechaza (red caída), avisa del fallo en vez de romper", async () => {
    resumenCargaMasivaMock.mockRejectedValue(new Error("network"));

    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo cargar el resumen de la carga masiva.",
    );
  });

  it("lote sin órdenes -> mensaje de vacío, sin filas", async () => {
    resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: [] });

    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);

    expect(await screen.findByText("No hay órdenes en este lote")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------
// Las órdenes de una tienda SIN fulfillment nacen ya CON `num_guia` (feature 155), así que
// su etiqueta existe desde la carga misma y el mensajero puede llevárselas impresas. Antes
// había que salir a buscarlas al listado orden por orden.
// ---------------------------------------------------------------------------------------
describe("OrdenesCargaResumen — etiquetas del lote recién cargado", () => {
  it("ofrece descargar las etiquetas de las órdenes creadas", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(
      screen.getByRole("button", { name: "Descargar etiquetas" }),
    ).toBeInTheDocument();
  });

  it("al pulsarlo pide las etiquetas de ESAS órdenes, por su id", async () => {
    const user = userEvent.setup();
    const { generarEtiquetas } = await import("@/lib/actions/etiquetas-guia");
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    await user.click(screen.getByRole("button", { name: "Descargar etiquetas" }));

    await waitFor(() =>
      expect(vi.mocked(generarEtiquetas)).toHaveBeenCalledWith({
        ordenIds: ["o1", "o2"],
      }),
    );
  });

  it("sin filas resueltas no se ofrece (no tendría ids que imprimir)", async () => {
    resumenCargaMasivaMock.mockResolvedValue({ status: "ok", ordenes: [] });
    render(<OrdenesCargaResumen numRemisiones={["REM-0001"]} />);
    await screen.findByText("No hay órdenes en este lote");

    expect(
      screen.queryByRole("button", { name: "Descargar etiquetas" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// FEATURE 304 — por qué el «Monto» de esta tabla no es el del archivo
//
// La columna «Monto» de arriba es la única que puede NO coincidir con lo que la tienda
// mandó: la 299 redondea al colón más cercano un monto con céntimos, porque con céntimos la
// orden no se puede entregar nunca. Hasta esta ficha, quien cargaba por pantalla veía el
// número cambiado y ningún motivo.
//
// OJO AL CONVIVIR CON LA 230: el caso de arriba exige que NINGUNA celda del resumen lleve
// cola decimal, y aquí se exige justo lo contrario para el monto DEL ARCHIVO. No es una
// contradicción: sin la cola, los dos importes se pintarían con la misma cadena y el aviso
// no diría nada. Es la misma excepción declarada que la 300 abrió con `montoExacto`.
// ---------------------------------------------------------------------------------------
describe("OrdenesCargaResumen — el monto redondeado se explica (feature 304)", () => {
  const AJUSTADAS = [
    { fila: 7, numRemision: "REM-0001", original: 11898.81, aplicado: 11899 },
  ];
  const TABLA_AJUSTES = /órdenes con el monto redondeado/i;

  it("lista la fila ajustada con el monto del archivo y el que se guardó", async () => {
    render(
      <OrdenesCargaResumen numRemisiones={["REM-0001"]} ajustadas={AJUSTADAS} />,
    );
    await screen.findByText("REM-0001");

    const tabla = screen.getByRole("table", { name: TABLA_AJUSTES });
    const celdas = within(tabla)
      .getAllByRole("cell")
      .map((td) => td.textContent ?? "");
    // El separador sale de configuración, nunca escrito a mano; y el importe esperado se
    // compone con el formateador GENERAL, no con el mismo que pinta la celda.
    expect(celdas).toEqual([
      "7",
      "REM-0001",
      `${formatMonto(11898)}${monedaConfig.separadorDecimal}81`,
      formatMonto(11899),
    ]);
    // Y se dice POR QUÉ, no solo qué.
    expect(screen.getByText(/se guardaron con el monto del archivo redondeado/i))
      .toBeInTheDocument();
  });

  it("sin ajustes el paso se ve EXACTAMENTE como antes: ni tabla ni explicación", async () => {
    render(<OrdenesCargaResumen numRemisiones={["REM-0001", "REM-0002"]} />);
    await screen.findByText("REM-0001");

    expect(screen.queryByRole("table", { name: TABLA_AJUSTES })).toBeNull();
    expect(screen.queryByText(/redondead/i)).toBeNull();
    // La única tabla del paso sigue siendo el resumen del lote.
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });
});
