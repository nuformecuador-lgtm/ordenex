// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsignarSateliteModal } from "@/app/(app)/recepcion-satelite/_components/AsignarSateliteModal";
import { asignarDesdeSatelite } from "@/lib/actions/recepcion-satelite";
import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";

// Feature 34 (T9) — Modal "Asignar mensajero" desde `en_bodega_satelite` (R7): un
// único mensajero de la zona para todo el lote seleccionado.
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  asignarDesdeSatelite: vi.fn(),
}));

const asignarDesdeSateliteMock = vi.mocked(asignarDesdeSatelite);

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

const MENSAJEROS = [
  { id: "m1", nombre: "Ana Mensajera" },
  { id: "m2", nombre: "Beto Mensajero" },
];

function makeOrden(
  overrides: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-000",
    estatusValue: "en_bodega_satelite",
    destinatario: "Destino",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...overrides,
  };
}

function renderModal(
  ordenes: RecepcionSateliteDTO[],
  mensajeros = MENSAJEROS,
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
) {
  render(
    <AsignarSateliteModal
      open
      ordenes={ordenes}
      mensajeros={mensajeros}
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

describe("AsignarSateliteModal", () => {
  it("R7: éxito → asignarDesdeSatelite({ ordenIds, mensajeroId }), toast + onSuccess", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "por_recoger" },
        { ordenId: "o2", estado: "por_recoger" },
      ],
    });

    const ordenes = [
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ];
    const { onSuccess } = renderModal(ordenes);

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeSateliteMock).toHaveBeenCalledTimes(1);
    expect(asignarDesdeSateliteMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      mensajeroId: "m1",
    });

    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalledWith("Mensajero asignado a 2 orden(es).");
  });

  it("R9: confirmar sin mensajero no llama a la acción y muestra error de validación", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await user.click(screen.getByRole("button", { name: "Asignar" }));

    expect(asignarDesdeSateliteMock).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Datos inválidos: revisa la selección de mensajero.",
      ),
    );
  });

  it("R22 (41): resultado 'bodega_bloqueada' por mensajeros → toast con la causa (i)", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "bodega_bloqueada",
      causa: { porMensajeros: true, porCierreBodega: false },
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/resuelve los cierres pendientes de tus mensajeros/i),
      ),
    );
  });

  it("R22 (41): resultado 'bodega_bloqueada' por cierre de bodega → toast con la causa (ii)", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "bodega_bloqueada",
      causa: { porMensajeros: false, porCierreBodega: true },
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar" }));

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        expect.stringMatching(/cierre de bodega hacia la central está pendiente de aprobación/i),
      ),
    );
  });

  // ── Feature 92/R9 ───────────────────────────────────────────────────────────
  // Este modal NO usa el mapper compartido de `ordenes/`: tiene el suyo propio
  // (`asignacion-satelite-error-messages.ts`). Antes ramificaba SOLO por `status`
  // e ignoraba `detalle`, así que el `motivo` del gate de coordenadas (92) se
  // descartaba y el toast caía en el genérico de `conflict`. Estos tests fijan
  // que el SEGUNDO mapper también respeta R9.
  async function asignarConMensajero(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      screen.getByRole("combobox", { name: "Mensajero para el lote" }),
    );
    const listbox = await screen.findByRole("listbox");
    await user.click(
      within(listbox).getByRole("option", { name: "Ana Mensajera" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar" }));
  }

  it.each(["direccion_no_geocodificable", "geocodificacion_agotada"])(
    "92/R9: conflict con motivo %s → toast 'Dirección no encontrada'",
    async (motivo) => {
      const user = userEvent.setup();
      asignarDesdeSateliteMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await asignarConMensajero(user);

      await vi.waitFor(() =>
        expect(errorMock).toHaveBeenCalledWith("Dirección no encontrada"),
      );
    },
  );

  it.each([
    "geocodificacion_en_curso",
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
  ])(
    "92/R9: conflict con motivo %s → mensaje DISTINTO (la dirección aún se valida)",
    async (motivo) => {
      const user = userEvent.setup();
      asignarDesdeSateliteMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await asignarConMensajero(user);

      await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
      const msg = errorMock.mock.calls.at(-1)?.[0] as string;
      expect(msg).not.toBe("Dirección no encontrada");
      expect(msg).toMatch(/valid/i);
    },
  );

  // `estado_invalido` dejo de caer en el generico: ahora tiene su propia frase, que dice que
  // paso y que hacer. Para seguir cubriendo el generico se usa un motivo que el mapper NO
  // conoce, que es cuando de verdad toca.
  it("92/R9: un conflict con un motivo DESCONOCIDO conserva el mensaje genérico del mapper", async () => {
    const user = userEvent.setup();
    asignarDesdeSateliteMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "motivo_que_nadie_mapea" }],
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await asignarConMensajero(user);

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Alguna orden de la selección ya no se puede asignar. Actualiza la lista y vuelve a intentarlo.",
      ),
    );
  });

  it("admin_satelite: un mensajero con cierre abierto aparece deshabilitado; los demás siguen asignables", async () => {
    const user = userEvent.setup();
    render(
      <AsignarSateliteModal
        open
        ordenes={[makeOrden({ id: "o1", numRemision: "REM-001" })]}
        mensajeros={MENSAJEROS}
        mensajerosBloqueadosIds={["m2"]}
        onOpenChange={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", {
      name: "Mensajero para el lote",
    });
    await user.click(select);
    const listbox = await screen.findByRole("listbox");

    const bloqueado = within(listbox).getByRole("option", {
      name: /Beto Mensajero \(cierre abierto\)/i,
    });
    expect(bloqueado).toHaveAttribute("aria-disabled", "true");

    const libre = within(listbox).getByRole("option", { name: "Ana Mensajera" });
    expect(libre).not.toHaveAttribute("aria-disabled", "true");
  });

  it("R6: zona sin mensajeros → estado vacío accionable y 'Asignar' deshabilitado", async () => {
    const user = userEvent.setup();
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })], []);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /no hay mensajeros en tu zona/i,
    );
    // Sin mensajeros no hay Select y el confirmar está deshabilitado.
    expect(
      screen.queryByRole("combobox", { name: "Mensajero para el lote" }),
    ).toBeNull();
    const asignar = screen.getByRole("button", { name: "Asignar" });
    expect(asignar).toBeDisabled();

    await user.click(asignar);
    expect(asignarDesdeSateliteMock).not.toHaveBeenCalled();
  });
});
