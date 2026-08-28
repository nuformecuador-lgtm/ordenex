// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRef } from "react";
import { render, screen, cleanup, act } from "@testing-library/react";

import {
  EditarPlantillaForm,
  type EditarPlantillaFormHandle,
} from "@/app/(app)/configuracion/plantillas/_components/EditarPlantillaForm";
import { PREVIEW_DEBOUNCE_MS } from "@/app/(app)/configuracion/plantillas/_components/VariablesInsert";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

vi.mock("@/lib/actions/plantillas", () => ({
  actualizarPlantilla: vi.fn(async () => ({ status: "ok" as const, plantilla: {} })),
  previewPlantilla: vi.fn(async () => ({ status: "ok" as const, texto: "Hola " })),
}));

import { actualizarPlantilla } from "@/lib/actions/plantillas";

const actualizarMock = vi.mocked(actualizarPlantilla);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
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
    plantillaTienda: false,
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

  // M2 (revision): «AVISA, NO BLOQUEA» (design 5.4) verificado como CONDUCTA sobre el
  // formulario real, no como la ausencia de atributos `disabled` en un harness que no monta
  // ningun control deshabilitable —eso pasaba por construccion, no por comportamiento—.
  //
  // El boton «Guardar» vive en el Modal de `PlantillasModule`, no aqui: lo que ESTE
  // componente expone, y lo que ese boton pulsa, es el handle imperativo `submit()`. Que
  // `submit()` alcance la Server Action con el cuerpo intacto es exactamente lo que se
  // romperia si alguien decidiera bloquear el guardado por una clave fuera del catalogo.
  it("R15/T21: el aviso NO bloquea el guardado: submit alcanza la accion con el cuerpo intacto", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ref = createRef<EditarPlantillaFormHandle>();
    render(<EditarPlantillaForm ref={ref} plantilla={plantillaFixture({})} />);

    await avanzarDebounce();

    // El aviso ESTA en pantalla...
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("no es un campo válido");

    // ...y aun asi el guardado sale, con `{{sucursal}}` sin tocar (R18).
    await act(async () => {
      await ref.current?.submit();
    });

    expect(actualizarMock).toHaveBeenCalledTimes(1);
    expect(actualizarMock).toHaveBeenCalledWith(
      "plantilla-1",
      expect.objectContaining({ cuerpo: "Hola {{sucursal}}" }),
    );
  });
});
