// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RutearSateliteModal } from "@/app/(app)/ordenes/_components/RutearSateliteModal";
import { rutearABodegaSatelite } from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 92/R9 — decisión del humano en la gate (Q10): `RutearSateliteModal`
// ENTRA EN ALCANCE CON SU TEST.
//
// Por qué existe este archivo: el modal NO tiene mapper propio, HEREDA
// `guiaDecisionErrorMessage` (`RutearSateliteModal.tsx:64`), igual que
// `GenerarGuiaModal` y `AsignarBodegaModal`. La spec (§ tabla de trazabilidad de
// R9) solo nombra esos dos, así que este tercer consumidor del mapper compartido
// quedaba SIN cobertura: una regresión en el mapper que solo rompiera esta ruta
// no habría puesto roja la suite.
vi.mock("@/lib/actions/ordenes-guia", () => ({
  rutearABodegaSatelite: vi.fn(),
}));

const rutearMock = vi.mocked(rutearABodegaSatelite);

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

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 100,
    numRemision: "REM-000",
    estatusId: "id-bodega",
    estatusValue: "en_bodega_central",
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
    <RutearSateliteModal
      open
      ordenes={ordenes}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

async function confirmar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Rutear a bodega satélite" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("RutearSateliteModal", () => {
  it("30/R13: éxito → rutearABodegaSatelite({ ordenIds }), toast y onSuccess", async () => {
    const user = userEvent.setup();
    rutearMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "en_ruta_bodega_satelite" },
        { ordenId: "o2", estado: "en_ruta_bodega_satelite" },
      ],
    });
    const { onSuccess } = renderModal([
      makeOrden({ id: "o1", numRemision: "REM-001" }),
      makeOrden({ id: "o2", numRemision: "REM-002" }),
    ]);

    await confirmar(user);

    expect(rutearMock).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] });
    // Feature 148 (§9.7): tras el éxito el modal pasa a la fase "resultado" (con el
    // manifiesto del lote) y `onSuccess` se difiere al cierre de esa fase. La llamada
    // de negocio, su input y su toast NO cambian (R27).
    await user.click(await screen.findByRole("button", { name: "Cerrar" }));
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(successMock).toHaveBeenCalled();
  });

  // ── Feature 92/R9 ───────────────────────────────────────────────────────────
  // El gate de coordenadas (92, R1-R8) devuelve `conflict` con un `motivo` por
  // orden. El mapper debe inspeccionar `detalle[].motivo` ANTES del switch por
  // `status`; si no, el motivo se descarta y el toast cae en el genérico.
  it.each(["direccion_no_geocodificable", "geocodificacion_agotada"])(
    "92/R9: conflict con motivo %s → toast 'Dirección no encontrada'",
    async (motivo) => {
      const user = userEvent.setup();
      rutearMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await confirmar(user);

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
      rutearMock.mockResolvedValue({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo }],
      });
      renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

      await confirmar(user);

      await vi.waitFor(() => expect(errorMock).toHaveBeenCalled());
      const msg = errorMock.mock.calls.at(-1)?.[0] as string;
      expect(msg).not.toBe("Dirección no encontrada");
      expect(msg).toMatch(/valid/i);
    },
  );

  it("92/R9: un conflict SIN motivos del gate conserva el mensaje genérico del mapper", async () => {
    const user = userEvent.setup();
    rutearMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: "estado_invalido" }],
    });
    renderModal([makeOrden({ id: "o1", numRemision: "REM-001" })]);

    await confirmar(user);

    await vi.waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(
        "Alguna orden de la selección ya no admite esta acción. Actualiza la lista y vuelve a intentarlo.",
      ),
    );
  });
});

// Feature 160 (T17, R18/R19/R23) — el diálogo lista las órdenes en un `<ul>`: el
// conteo va como DATO ETIQUETADO en la misma línea, con el markup del resto del `<li>`.
describe("RutearSateliteModal — intentos de entrega (feature 160)", () => {
  it("R18: cada orden listada muestra el dato etiquetado junto a su remisión", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-I1", intentosEntrega: 2 })]);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-I1");
    expect(within(item).getByText("Intentos: 2")).toBeInTheDocument();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual (no se omite)", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-I0", intentosEntrega: 0 })]);
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) el dato se muestra como 0", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-IX" })]);
    expect(
      within(screen.getByRole("listitem")).getByText("Intentos: 0"),
    ).toBeInTheDocument();
  });

  it("R19: cada orden lleva SU número, no el de la primera", () => {
    renderModal([
      makeOrden({ id: "o1", numRemision: "REM-M1", intentosEntrega: 3 }),
      makeOrden({ id: "o2", numRemision: "REM-M2", intentosEntrega: 0 }),
    ]);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R32: el dato no desplaza al resto de la línea (remisión y zona siguen)", () => {
    renderModal([
      makeOrden({
        id: "o1",
        numRemision: "REM-Z1",
        zonaNombre: "Limón",
        intentosEntrega: 1,
      }),
    ]);
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("REM-Z1");
    expect(item).toHaveTextContent("Limón");
    expect(within(item).getByText("Intentos: 1")).toBeInTheDocument();
  });

  it("R20: el dato no incluye el umbral ('de N')", () => {
    renderModal([makeOrden({ id: "o1", numRemision: "REM-U", intentosEntrega: 2 })]);
    const dato = within(screen.getByRole("listitem")).getByText("Intentos: 2");
    expect(dato.textContent).toBe("Intentos: 2");
  });
});
