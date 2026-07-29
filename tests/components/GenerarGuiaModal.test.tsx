// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GenerarGuiaModal } from "@/app/(app)/ordenes/_components/GenerarGuiaModal";
import { generarGuia } from "@/lib/actions/ordenes-guia";
import { obtenerManifiesto } from "@/lib/actions/manifiesto";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { GenerarGuiaResult } from "@/lib/types/orden-guia";

// Feature 156 (T B.3.1) — "Generar guía" pasa a ser CONFIRMACIÓN DE LOTE: numerar y
// mover a la bodega central. El modal pierde el selector de mensajero (R20) y las
// agrupaciones GAM / satélite (R21); confirma con UNA sola llamada
// `generarGuia({ ordenIds })` sin ningún dato de mensajero (R22) y anuncia el destino
// ÚNICO (R23). La fase "resultado" del manifiesto (R24/R25) y su cierre diferido
// (del que cuelga el encadenado a etiquetas, R27) NO cambian.
vi.mock("@/lib/actions/ordenes-guia", () => ({
  generarGuia: vi.fn(),
}));
vi.mock("@/lib/actions/manifiesto", () => ({ obtenerManifiesto: vi.fn() }));
// El generador de xlsx se aísla de exceljs (el binario real lo cubre
// `manifiesto-xlsx.test.ts`); aquí solo interesa CON QUÉ lote se pide el manifiesto.
const { buildManifiestoXlsxMock } = vi.hoisted(() => ({
  buildManifiestoXlsxMock: vi.fn<() => Promise<ArrayBuffer>>(),
}));
vi.mock("@/lib/utils/manifiesto-xlsx", () => ({
  buildManifiestoXlsx: buildManifiestoXlsxMock,
  manifiestoFileName: (flujo: string, fecha: string) =>
    `manifiesto-${flujo}-${fecha}.xlsx`,
}));

const generarGuiaMock = vi.mocked(generarGuia);
const obtenerManifiestoMock = vi.mocked(obtenerManifiesto);

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

/** Nombre accesible de la ÚNICA tabla de la fase de edición. */
const TABLA = "Órdenes por numerar";

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: null,
    numRemision: "REM-000",
    estatusId: "id-preparacion",
    // Feature 156: el único origen legal de "Generar guía" es `en_preparacion`.
    estatusValue: "en_preparacion",
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
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

/** Lote heterogéneo: GAM, NO-GAM con zona nombrada y una con mensajero sugerido. */
function loteHeterogeneo(): OrdenListItemDTO[] {
  return [
    makeOrden({
      id: "o1",
      numRemision: "REM-001",
      destinatario: "Ana Pérez",
      zonaEsGam: true,
      zonaNombre: "GAM",
    }),
    makeOrden({
      id: "o2",
      numRemision: "REM-002",
      destinatario: "Beto Solano",
      zonaEsGam: false,
      zonaNombre: "Limón",
    }),
    makeOrden({
      id: "o3",
      numRemision: "REM-003",
      destinatario: "Carla Mora",
      zonaEsGam: false,
      zonaNombre: "Guanacaste",
    }),
  ];
}

/**
 * R26 — los tres resultados no-"ok" que la acción puede devolver a esta UI, con el
 * mensaje que `guia-decision-error-messages` les asigna. (`validation_error` queda
 * fuera: su texto sigue hablando de "selección de mensajero" porque el mapper lo
 * comparte con la asignación desde bodega; ver bitácora.)
 */
const CASOS_NO_OK: {
  nombre: string;
  resultado: GenerarGuiaResult;
  mensaje: string;
}[] = [
  {
    nombre: "conflict",
    resultado: {
      status: "conflict",
      detalle: [
        {
          ordenId: "o1",
          motivo: "estado de origen no permitido: en_bodega_central",
        },
      ],
    },
    mensaje: "Alguna orden ya no está en un estado válido para esta acción.",
  },
  {
    nombre: "forbidden",
    resultado: { status: "forbidden" },
    mensaje: "No tienes permiso para esta acción.",
  },
  {
    nombre: "unauthenticated",
    resultado: { status: "unauthenticated" },
    mensaje: "Tu sesión expiró. Inicia sesión de nuevo.",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  buildManifiestoXlsxMock.mockResolvedValue(new ArrayBuffer(8));
  obtenerManifiestoMock.mockResolvedValue({
    status: "ok",
    filas: [],
    omitidas: [],
  });
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-url"),
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GenerarGuiaModal — feature 156: confirmación de lote", () => {
  it("R20: lista cada orden por Nº de remisión y destinatario, y NO ofrece ningún control de mensajero", () => {
    renderModal(loteHeterogeneo());

    const tabla = screen.getByRole("table", { name: TABLA });
    for (const [rem, dest] of [
      ["REM-001", "Ana Pérez"],
      ["REM-002", "Beto Solano"],
      ["REM-003", "Carla Mora"],
    ]) {
      expect(within(tabla).getByText(rem)).toBeInTheDocument();
      expect(within(tabla).getByText(dest)).toBeInTheDocument();
    }

    // Ni columna "Mensajero" ni selector alguno, para ninguna orden.
    expect(
      within(tabla).queryByRole("columnheader", { name: "Mensajero" }),
    ).toBeNull();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    for (const rem of ["REM-001", "REM-002", "REM-003"]) {
      expect(
        screen.queryByRole("combobox", {
          name: `Mensajero para la orden ${rem}`,
        }),
      ).toBeNull();
    }
  });

  it("R21: no agrupa por mensajero sugerido ni por bodega satélite; el texto anuncia numeradas y en bodega central", () => {
    renderModal(loteHeterogeneo());

    // UNA sola tabla: sin subgrupos (ni por sugerido ni por zona satélite destino).
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByText("Con mensajero sugerido")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin mensajero sugerido")).not.toBeInTheDocument();
    expect(screen.queryByText("Asignar mensajero")).not.toBeInTheDocument();
    // Las órdenes NO-GAM ya no se titulan por su bodega satélite destino.
    expect(screen.queryByText(/bodega satélite/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("table", {
        name: "Se enviarán a la bodega satélite de Limón",
      }),
    ).toBeNull();

    // El texto del modal anuncia el efecto real: numerar + bodega central.
    const dialog = screen.getByRole("dialog", { name: "Generar guía" });
    expect(
      within(dialog).getByText(
        /Se numerarán 3 orden\(es\) y pasarán a la bodega central/i,
      ),
    ).toBeInTheDocument();
  });

  it("R22: confirmar hace UNA sola llamada con el lote COMPLETO y sin ningún dato de mensajero", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "en_bodega_central" },
        { ordenId: "o2", numGuia: 2, estado: "en_bodega_central" },
        { ordenId: "o3", numGuia: 3, estado: "en_bodega_central" },
      ],
    });

    renderModal(loteHeterogeneo());
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    // Contrato exacto (feature 156): `{ ordenIds }` y NADA más. La igualdad profunda
    // de `toHaveBeenCalledWith` falla si vuelve a colarse `decisiones`/`mensajeroId`.
    expect(generarGuiaMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2", "o3"],
    });
    const input = generarGuiaMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(input)).toEqual(["ordenIds"]);
    expect(JSON.stringify(input)).not.toMatch(/mensajero|decision/i);
  });

  it("R23: el aviso de éxito informa la cantidad y el destino ÚNICO (bodega central)", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", numGuia: 1, estado: "en_bodega_central" },
        { ordenId: "o2", numGuia: 2, estado: "en_bodega_central" },
        { ordenId: "o3", numGuia: 3, estado: "en_bodega_central" },
      ],
    });

    renderModal(loteHeterogeneo());
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith(
      "Guía generada para 3 orden(es): quedan en bodega central.",
    );
    // Ni espera de aceptación ni bodega satélite: esta operación ya no los produce.
    const mensaje = successMock.mock.calls[0]![0] as string;
    expect(mensaje).not.toMatch(/espera de aceptación/i);
    expect(mensaje).not.toMatch(/satélite/i);
  });

  it("R24: tras el éxito pasa a la fase resultado con el manifiesto del lote DEL RESULTADO y difiere onSuccess al cierre", async () => {
    const user = userEvent.setup();
    // El resultado de negocio manda: llega en otro orden que las props del modal.
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o3", numGuia: 3, estado: "en_bodega_central" },
        { ordenId: "o1", numGuia: 1, estado: "en_bodega_central" },
        { ordenId: "o2", numGuia: 2, estado: "en_bodega_central" },
      ],
    });

    const { onSuccess, onOpenChange } = renderModal(loteHeterogeneo());
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    // Fase "resultado": desaparece la tabla de edición y el confirmar; aparece la
    // descarga del manifiesto.
    const descargar = await screen.findByRole("button", {
      name: /descargar manifiesto/i,
    });
    expect(screen.queryByRole("table", { name: TABLA })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Generar guía" }),
    ).not.toBeInTheDocument();
    // …y el padre TODAVÍA no fue avisado (R24: `onSuccess` diferido).
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(descargar);
    expect(obtenerManifiestoMock).toHaveBeenCalledWith({
      flujo: "generacion_guia",
      ordenIds: ["o3", "o1", "o2"],
    });
    // La descarga NO cierra la fase ni avisa al padre.
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("R25: si la descarga del manifiesto falla, la generación sigue cometida y la fase resultado se cierra con normalidad", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({
      status: "ok",
      resultados: [{ ordenId: "o1", numGuia: 7, estado: "en_bodega_central" }],
    });
    obtenerManifiestoMock.mockRejectedValue(new Error("red caída"));

    const { onSuccess } = renderModal([makeOrden({ id: "o1" })]);
    await user.click(screen.getByRole("button", { name: "Generar guía" }));
    await user.click(
      await screen.findByRole("button", { name: /descargar manifiesto/i }),
    );

    await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
    // La operación de negocio no se repite ni se deshace…
    expect(generarGuiaMock).toHaveBeenCalledTimes(1);
    // …su aviso de éxito sigue intacto…
    expect(successMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/guía generada para 1 orden\(es\)/i),
    ).toBeInTheDocument();
    // …y la fase resultado sigue cerrable, avisando al padre.
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it.each(CASOS_NO_OK)(
    "R26: $nombre deja el modal en edición, sin fase resultado ni onSuccess, con el mensaje mapeado",
    async ({ resultado, mensaje }) => {
      const user = userEvent.setup();
      generarGuiaMock.mockResolvedValue(resultado);

      const { onSuccess } = renderModal([
        makeOrden({ id: "o1", numRemision: "REM-001" }),
      ]);
      await user.click(screen.getByRole("button", { name: "Generar guía" }));

      await waitFor(() => expect(errorMock).toHaveBeenCalledTimes(1));
      expect(errorMock).toHaveBeenCalledWith(mensaje);
      expect(onSuccess).not.toHaveBeenCalled();
      expect(successMock).not.toHaveBeenCalled();
      // Sigue abierto y en la fase de EDICIÓN: ni manifiesto ni cierre.
      expect(
        screen.getByRole("dialog", { name: "Generar guía" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("table", { name: TABLA })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /descargar manifiesto/i }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Generar guía" }),
      ).toBeInTheDocument();
    },
  );

  it("R22/R26: un lote vacío se confirma igual con `ordenIds: []` (el borde decide, no la UI)", async () => {
    const user = userEvent.setup();
    generarGuiaMock.mockResolvedValue({ status: "ok", resultados: [] });

    renderModal([]);
    await user.click(screen.getByRole("button", { name: "Generar guía" }));

    expect(generarGuiaMock).toHaveBeenCalledWith({ ordenIds: [] });
  });
});
