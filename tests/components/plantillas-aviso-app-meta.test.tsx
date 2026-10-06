// @vitest-environment jsdom
//
// Ficha 474 (R48) — al ENCENDER «Lleva documento adjunto», la pantalla pregunta al servidor si
// identificó la app de Meta con el token configurado. Si no, el motivo se pinta BAJO el interruptor
// y el resto del formulario sigue funcionando. Nunca se enseña el ID ni el token.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const estadoAppMetaMock = vi.fn();
const crearPlantillaMock = vi.fn();
const previewPlantillaMock = vi.fn();
vi.mock("@/lib/actions/plantillas", () => ({
  estadoAppMeta: (...a: unknown[]) => estadoAppMetaMock(...a),
  crearPlantilla: (...a: unknown[]) => crearPlantillaMock(...a),
  previewPlantilla: (...a: unknown[]) => previewPlantillaMock(...a),
}));

import { createRef } from "react";
import {
  CrearPlantillaForm,
  type CrearPlantillaFormHandle,
} from "@/app/(app)/configuracion/plantillas/_components/CrearPlantillaForm";
import type { InformeParaPlantilla } from "@/app/(app)/configuracion/plantillas/_components/PlantillaInformeFields";

const INFORMES: InformeParaPlantilla[] = [
  {
    clave: "prueba_envio",
    nombre: "Prueba de envío",
    generaDocumento: true,
    variables: [
      { clave: "fecha", nombre: "Fecha", descripcion: "Día de la ejecución", ejemplo: "05/10/2026" },
      { clave: "destinatario_nombre", nombre: "Nombre del destinatario", descripcion: "", ejemplo: "Daniel" },
    ],
  },
];

const MENSAJE =
  "No se pudo identificar la app de Meta con el token de WhatsApp configurado (código 190). Las plantillas con documento no se pueden enviar a aprobación hasta resolverlo; el resto sigue funcionando.";

async function elegirInforme(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Tipo de plantilla" }));
  // El selector de campos es OTRO listbox, siempre visible: se busca el del `Select`.
  const lista = await waitFor(() => {
    const l = screen.getAllByRole("listbox").find((x) => x.getAttribute("aria-label") !== "Campos del catálogo");
    if (!l) throw new Error("sin listbox del Select");
    return l;
  }, { timeout: 3000 }); // el popup del Select tarda bajo la carga del gate
  await user.click(within(lista).getByRole("option", { name: "De informe: Prueba de envío" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  previewPlantillaMock.mockResolvedValue({ status: "ok", texto: "" });
  crearPlantillaMock.mockResolvedValue({ status: "ok", plantilla: {} });
});
afterEach(() => cleanup());

describe("R48 — aviso de app de Meta no identificada", () => {
  it("con `no_identificada`, el texto aparece bajo el interruptor y el formulario sigue operable", async () => {
    const user = userEvent.setup();
    estadoAppMetaMock.mockResolvedValue({ status: "ok", estado: "no_identificada", mensaje: MENSAJE });
    const ref = createRef<CrearPlantillaFormHandle>();
    render(<CrearPlantillaForm ref={ref} informes={INFORMES} />);

    await elegirInforme(user);
    const sw = screen.getByRole("switch", { name: "Lleva documento adjunto" });
    await user.click(sw);

    const aviso = await screen.findByText(MENSAJE);
    expect(aviso).toHaveAttribute("role", "alert");
    expect(estadoAppMetaMock).toHaveBeenCalledTimes(1);
    // Va BAJO el interruptor y lo describe.
    expect(sw.getAttribute("aria-describedby")).toContain(aviso.id);
    expect(screen.getByRole("switch", { name: "Lleva documento adjunto" })).toBeChecked();

    // El resto sigue funcionando: se escribe y se guarda.
    await user.type(screen.getByLabelText("Nombre"), "prueba_doc");
    await user.type(screen.getByLabelText("Cuerpo"), "Hola");
    await ref.current?.submit();
    await waitFor(() =>
      expect(crearPlantillaMock).toHaveBeenCalledWith({
        nombre: "prueba_doc",
        cuerpo: "Hola",
        plantillaTienda: false,
        informeClave: "prueba_envio",
        llevaDocumento: true,
      }),
    );
  });

  it("con `identificada`, no hay aviso", async () => {
    const user = userEvent.setup();
    estadoAppMetaMock.mockResolvedValue({ status: "ok", estado: "identificada" });
    render(<CrearPlantillaForm informes={INFORMES} />);
    await elegirInforme(user);
    await user.click(screen.getByRole("switch", { name: "Lleva documento adjunto" }));
    await waitFor(() => expect(estadoAppMetaMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("solo se pregunta al ENCENDER, no al apagar", async () => {
    const user = userEvent.setup();
    estadoAppMetaMock.mockResolvedValue({ status: "ok", estado: "no_identificada", mensaje: MENSAJE });
    render(<CrearPlantillaForm informes={INFORMES} />);
    await elegirInforme(user);
    const sw = screen.getByRole("switch", { name: "Lleva documento adjunto" });
    await user.click(sw);
    await screen.findByText(MENSAJE);
    await user.click(sw);
    expect(estadoAppMetaMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(MENSAJE)).not.toBeInTheDocument();
  });
});
