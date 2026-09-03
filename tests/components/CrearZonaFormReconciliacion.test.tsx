// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProvinciaArbolDTO } from "@/lib/actions/geografia";

/**
 * Ficha 366 (T7) — al guardar una zona editada, la respuesta del servidor
 * (T4/T6) puede traer `ordenesReconciliadas`: cuántas órdenes cambiaron de
 * `zonaId` porque su distrito ahora resuelve otra zona (§5.4/§6 de
 * design.md). El toast lo dice sólo cuando el conteo es > 0, sólo al editar
 * (`CrearZonaResult` no lleva ese campo — R13: crear nunca reconcilia).
 *
 * Se mockea `useToast` con un spy (patrón de `AsignarBodegaModal.test.tsx`)
 * para comparar el TEXTO exacto que recibe `toast.success`, no un fragmento
 * ni un `data-*`.
 */

const crearZonaMock = vi.fn();
const actualizarZonaMock = vi.fn();
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: (...a: unknown[]) => crearZonaMock(...a),
  actualizarZona: (...a: unknown[]) => actualizarZonaMock(...a),
}));

vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));

vi.mock("@/lib/actions/geografia", () => ({
  actualizarDistritosEspeciales: vi.fn(),
  listarArbolGeografico: vi.fn(),
}));

const { successMock } = vi.hoisted(() => ({ successMock: vi.fn() }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const { CrearZonaForm, cobroVacio } = await import(
  "@/app/(app)/configuracion/tarifas/_components/CrearZonaForm"
);

function zonaDTO(id: string, nombre: string) {
  return {
    id,
    nombre,
    cobroVehiculo: false,
    distritosCount: 1,
    esCentral: false,
  };
}

/** Árbol mínimo con un solo distrito, suficiente para montar el selector. */
function arbol(): ProvinciaArbolDTO[] {
  return [
    {
      id: "p1",
      nombre: "San José",
      cantones: [
        {
          id: "c1",
          nombre: "Central",
          distritos: [
            {
              id: "d1",
              nombre: "Carmen",
              zonaId: null,
              zonaNombre: null,
              zonaEspecial: false,
            },
          ],
        },
      ],
    },
  ];
}

/**
 * Renderiza el formulario ya con nombre y distrito precargados (`initial`),
 * así "Guardar" no necesita abrir el árbol ni escribir el nombre: lo que se
 * mide aquí es el mensaje del toast, no el resto del formulario (ya cubierto
 * por `ZonaDistritoEspecial.test.tsx`). `zonaId` presente ⇒ modo "editar"
 * llama `actualizarZona`; ausente ⇒ modo "crear" llama `crearZona`.
 */
function renderForm(mode: "crear" | "editar", zonaId?: string) {
  return render(
    <CrearZonaForm
      mode={mode}
      provincias={arbol()}
      vehiculos={[]}
      zonas={[]}
      initial={{
        zonaId,
        nombre: "Zona X",
        distritoIds: ["d1"],
        cobro: cobroVacio(),
      }}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("Toast de guardar zona — conteo de órdenes reubicadas (366/T7)", () => {
  it("editar con ordenesReconciliadas > 0 pinta el conteo en plural", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 3,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (3 órdenes reubicadas)",
      ),
    );
  });

  it("editar con ordenesReconciliadas = 1 usa el singular (no «1 órdenes»)", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 1,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith(
        "Zona actualizada (1 orden reubicada)",
      ),
    );
  });

  it("editar con ordenesReconciliadas = 0 deja el mensaje igual que antes de esta ficha", async () => {
    actualizarZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z1", "Zona X"),
      ordenesReconciliadas: 0,
    });
    const user = userEvent.setup();
    renderForm("editar", "z1");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Zona actualizada"),
    );
  });

  it("crear zona nunca pinta un conteo: el campo no existe en CrearZonaResult", async () => {
    crearZonaMock.mockResolvedValue({
      status: "ok",
      zona: zonaDTO("z2", "Zona nueva"),
    });
    const user = userEvent.setup();
    renderForm("crear");

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Zona creada"),
    );
    expect(actualizarZonaMock).not.toHaveBeenCalled();
  });
});
