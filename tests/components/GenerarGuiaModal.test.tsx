// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GenerarGuiaModal } from "@/app/(app)/ordenes/_components/GenerarGuiaModal";
import { generarGuia } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { MensajeroLiteDTO } from "@/lib/types/orden-guia";

// Feature 17 (T18) — Modal async "Generar guía": lista las órdenes GAM sin
// mensajero preseleccionado (R20) y resuelve el lote mixto en UNA sola llamada (R24).
vi.mock("@/lib/actions/ordenes-guia", () => ({
  generarGuia: vi.fn(),
}));

const generarGuiaMock = vi.mocked(generarGuia);

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const MENSAJEROS: MensajeroLiteDTO[] = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: null,
    numRemision: "REM-000",
    estatusId: "id-fulfillment",
    estatusValue: "en_fulfillment",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function renderModal(
  ordenes: OrdenListItemDTO[],
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
) {
  render(
    <GenerarGuiaModal
      open
      ordenes={ordenes}
      mensajeros={MENSAJEROS}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("GenerarGuiaModal", () => {
  it("R20: lista TODAS las órdenes GAM juntas, sin mensajero preseleccionado", () => {
    // Retirado el "mensajero sugerido": ya no hay subgrupos ni preselección; la
    // asignación se decide aquí, orden por orden, partiendo de "sin mensajero".
    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    renderModal(ordenes);

    expect(screen.queryByText("Con mensajero sugerido")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin mensajero sugerido")).not.toBeInTheDocument();

    const tabla = screen.getByRole("table", { name: "Órdenes por asignar" });
    expect(within(tabla).getByText("REM-001")).toBeInTheDocument();
    expect(within(tabla).getByText("REM-002")).toBeInTheDocument();

    // Ambos selectores arrancan en el placeholder "Sin mensajero".
    for (const rem of ["REM-001", "REM-002"]) {
      const select = screen.getByRole("combobox", { name: `Mensajero para la orden ${rem}` });
      expect(select).toHaveTextContent("Sin mensajero");
    }
  });

  it("R24: caso mixto (con mensajero elegido + sin mensajero) resuelve en UNA sola llamada a generarGuia", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "por_recoger" },
        { ordenId: "o2", numGuia: 2, estado: "por_recoger" },
        { ordenId: "o3", numGuia: 3, estado: "en_bodega_central" },
      ],
    });

    const ordenes = [
      // (a) el maestro elige mensajero.
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      // (b) el maestro elige otro mensajero.
      makeOrden({ id: "o2", numRemision: "REM-002" }),
      // (c) el maestro deja "sin mensajero" -> en_bodega_central.
      makeOrden({ id: "o3", numRemision: "REM-003" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    // o1 y o2: eligen mensajero (Select por click + listbox, no <select> nativo).
    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para la orden REM-001" }),
    );
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Ana Mensajera",
      }),
    );

    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para la orden REM-002" }),
    );
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Beto Mensajero",
      }),
    );

    // o3 queda sin mensajero (placeholder "Sin mensajero").
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    expect(generarGuiaMock).toHaveBeenCalledWith({
      decisiones: [
        { ordenId: "o1", mensajeroId: "m1" }, // elegido por el maestro
        { ordenId: "o2", mensajeroId: "m2" }, // elegido por el maestro
        { ordenId: "o3", mensajeroId: null }, // sin mensajero -> en_bodega_central
      ],
    });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("R7/R8: una orden NO-GAM no muestra select de mensajero y aparece en el grupo 'bodega satélite'; al confirmar envía mensajeroId=null para ella", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "por_recoger" },
        { ordenId: "o2", numGuia: 2, estado: "en_ruta_bodega_satelite" },
      ],
    });

    const ordenes = [
      // GAM: conserva el camino de la feature 17 (con select de mensajero).
      makeOrden({
        id: "o1",
        numRemision: "REM-GAM",
        zonaEsGam: true,
        zonaNombre: "GAM",
      }),
      // NO-GAM: se rutea a la bodega satélite de su zona, SIN select.
      makeOrden({
        id: "o2",
        numRemision: "REM-NOGAM",
        zonaEsGam: false,
        zonaNombre: "Limón",
      }),
    ];
    const { onSuccess } = renderModal(ordenes);

    // El grupo de bodega satélite de la zona aparece.
    const grupoSatelite = screen.getByRole("table", {
      name: "Se enviarán a la bodega satélite de Limón",
    });
    expect(within(grupoSatelite).getByText("REM-NOGAM")).toBeInTheDocument();

    // La orden NO-GAM NO ofrece select de mensajero.
    expect(
      screen.queryByRole("combobox", {
        name: "Mensajero para la orden REM-NOGAM",
      }),
    ).toBeNull();
    // La orden GAM sí conserva su select; el maestro elige ahí.
    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para la orden REM-GAM" }),
    );
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Ana Mensajera",
      }),
    );

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    expect(generarGuiaMock).toHaveBeenCalledWith({
      decisiones: [
        { ordenId: "o1", mensajeroId: "m1" }, // GAM: elegido por el maestro
        { ordenId: "o2", mensajeroId: null }, // NO-GAM: siempre null (→ satélite)
      ],
    });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("R25: si generarGuia responde un status no-ok, no se refresca (permanece abierto vía onError del Modal)", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado inválido" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    const { onSuccess } = renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledWith(
      "Alguna orden ya no está en un estado válido para esta acción.",
    );
  });

  // Feature 97/R9: el gate de asignabilidad por coordenadas (#98) devuelve `conflict` con un
  // `motivo` por orden que es LITERALMENTE el `EstadoAsignabilidad`. La UI lo traduce a un
  // mensaje claro según la clase del motivo.
  it("R9: un conflict con motivo 'direccion_no_geocodificable' muestra 'Dirección no encontrada'", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "direccion_no_geocodificable" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    const { onSuccess } = renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("R9: un conflict con motivo 'geocodificacion_agotada' también es 'Dirección no encontrada'", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_agotada" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
    );
  });

  it("R9: un conflict con motivo 'geocodificacion_en_curso' avisa que la dirección aún se valida", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "geocodificacion_en_curso" }],
    });

    const ordenes = [makeOrden({ id: "o1", numRemision: "REM-001" })];
    renderModal(ordenes);

    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "La dirección aún se está validando. Vuelve a intentarlo en unos minutos.",
      ),
    );
  });
});

// Feature 160 (T17, R17/R19/R23) — este diálogo lista las órdenes seleccionadas en un
// `DataTable`, NO en un `<ul>` (design §5.4 lo daba por lista: no lo es). La regla se
// decide por la FORMA de la superficie, así que aquí manda R17: columna propia.
describe("GenerarGuiaModal — intentos de entrega (feature 160)", () => {
  it("R17: la tabla de órdenes GAM monta la columna 'Intentos'", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001", intentosEntrega: 2 })]);
    const tabla = screen.getByRole("table", { name: "Órdenes por asignar" });
    expect(
      within(tabla).getByRole("columnheader", { name: "Intentos" }),
    ).toBeInTheDocument();
  });

  it("R19: muestra el número de cada orden, y `0` cuando no tiene intentos", () => {
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-C2", intentosEntrega: 2 }),
      makeOrden({ id: "o2", numRemision: "REM-C0", intentosEntrega: 0 }),
      makeOrden({ id: "o3", numRemision: "REM-CX" }), // sin el campo
    ]);
    const tabla = screen.getByRole("table", { name: "Órdenes por asignar" });
    const celda = (rem: string) =>
      within(within(tabla).getByRole("row", { name: new RegExp(rem) })).getAllByRole(
        "cell",
      )[2];
    expect(celda("REM-C2")).toHaveTextContent(/^2$/);
    expect(celda("REM-C0")).toHaveTextContent(/^0$/);
    expect(celda("REM-CX")).toHaveTextContent(/^0$/);
  });

  it("R19: el grupo NO-GAM (a bodega satélite) también muestra el dato", () => {
    renderModal([
      makeOrden({
        id: "o1",
        numRemision: "REM-NG",
        zonaEsGam: false,
        zonaNombre: "Limón",
        intentosEntrega: 3,
      }),
    ]);
    const tabla = screen.getByRole("table", {
      name: "Se enviarán a la bodega satélite de Limón",
    });
    expect(
      within(tabla).getByRole("columnheader", { name: "Intentos" }),
    ).toBeInTheDocument();
    const celdas = within(
      within(tabla).getByRole("row", { name: /REM-NG/ }),
    ).getAllByRole("cell");
    expect(celdas[2]).toHaveTextContent(/^3$/);
  });

  it("R20: la celda del conteo no trae el umbral ('2 de 3')", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-U", intentosEntrega: 2 })]);
    const tabla = screen.getByRole("table", { name: "Órdenes por asignar" });
    const celdas = within(
      within(tabla).getByRole("row", { name: /REM-U/ }),
    ).getAllByRole("cell");
    expect(celdas[2].textContent).toBe("2");
  });
});
