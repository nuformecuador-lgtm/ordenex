// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

import { EditarPlantillaForm } from "@/app/(app)/configuracion/plantillas/_components/EditarPlantillaForm";
import { PREVIEW_DEBOUNCE_MS } from "@/app/(app)/configuracion/plantillas/_components/VariablesInsert";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

vi.mock("@/lib/actions/plantillas", () => ({
  actualizarPlantilla: vi.fn(),
  previewPlantilla: vi.fn(async () => ({ status: "ok" as const, texto: "Hola " })),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Fixture mínimo y completo de `PlantillaListItem` (T21). */
function plantillaFixture(
  variablesNombres: Record<string, string>,
): PlantillaListItemDTO {
  return {
    id: "plantilla-1",
    nombre: "Recogida",
    cuerpo: "Hola {{sucursal}}",
    estado: "activo",
    variables: ["sucursal"],
    variablesNombres,
    welcomeMessage: false,
    templateId: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

/** Avanza el debounce del panel de vista previa bajo temporizadores falsos. */
async function avanzarDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 1);
  });
}

describe("EditarPlantillaForm", () => {
  it("R16/T21: el aviso usa el nombre persistido que llega desde EditarPlantillaForm", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<EditarPlantillaForm plantilla={plantillaFixture({ sucursal: "Sucursal" })} />);

    await avanzarDebounce();

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("ya no existe");
    expect(alerta.textContent).toContain("Sucursal");
  });

  it("R16/T21: sin nombre persistido el aviso dice que nunca fue un campo válido", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<EditarPlantillaForm plantilla={plantillaFixture({})} />);

    await avanzarDebounce();

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("no es un campo válido");
    expect(alerta.textContent).toContain("sucursal");
  });
});
