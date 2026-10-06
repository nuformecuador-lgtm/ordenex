// @vitest-environment jsdom
//
// Ficha 474 (T10.1) — PLANTILLAS DE INFORME en la pantalla de Plantillas: tipo, documento adjunto,
// selector y vista previa por catálogo del informe, y los desenlaces nuevos del servidor. Cada caso
// nombra el requisito.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { createRef, type ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { PlantillaListItemDTO } from "@/lib/types/plantilla-mensaje";

const m = {
  listarPlantillas: vi.fn(),
  eliminarPlantilla: vi.fn(),
  cambiarEstadoPlantilla: vi.fn(),
  crearPlantilla: vi.fn(),
  actualizarPlantilla: vi.fn(),
  previewPlantilla: vi.fn(),
  marcarPlantillaBienvenida: vi.fn(),
  enviarPlantillaAprobacion: vi.fn(),
  estadoAppMeta: vi.fn(),
};
vi.mock("@/lib/actions/plantillas", () => ({
  listarPlantillas: (...a: unknown[]) => m.listarPlantillas(...a),
  eliminarPlantilla: (...a: unknown[]) => m.eliminarPlantilla(...a),
  cambiarEstadoPlantilla: (...a: unknown[]) => m.cambiarEstadoPlantilla(...a),
  crearPlantilla: (...a: unknown[]) => m.crearPlantilla(...a),
  actualizarPlantilla: (...a: unknown[]) => m.actualizarPlantilla(...a),
  previewPlantilla: (...a: unknown[]) => m.previewPlantilla(...a),
  marcarPlantillaBienvenida: (...a: unknown[]) => m.marcarPlantillaBienvenida(...a),
  enviarPlantillaAprobacion: (...a: unknown[]) => m.enviarPlantillaAprobacion(...a),
  estadoAppMeta: (...a: unknown[]) => m.estadoAppMeta(...a),
}));

import { PlantillasModule } from "@/app/(app)/configuracion/plantillas/_components/PlantillasModule";
import {
  CrearPlantillaForm,
  type CrearPlantillaFormHandle,
} from "@/app/(app)/configuracion/plantillas/_components/CrearPlantillaForm";
import {
  EditarPlantillaForm,
  type EditarPlantillaFormHandle,
} from "@/app/(app)/configuracion/plantillas/_components/EditarPlantillaForm";
import type { InformeParaPlantilla } from "@/app/(app)/configuracion/plantillas/_components/PlantillaInformeFields";

const DEST = { clave: "destinatario_nombre", nombre: "Nombre del destinatario", descripcion: "Quien lo recibe", ejemplo: "Daniel" };
const INFORMES: InformeParaPlantilla[] = [
  {
    clave: "prueba_envio",
    nombre: "Prueba de envío",
    generaDocumento: true,
    variables: [
      { clave: "fecha", nombre: "Fecha", descripcion: "Día de la ejecución", ejemplo: "05/10/2026" },
      { clave: "hora", nombre: "Hora", descripcion: "Hora de la ejecución", ejemplo: "05:00" },
      DEST,
    ],
  },
  {
    clave: "aviso_interno",
    nombre: "Aviso de la app",
    generaDocumento: false,
    variables: [{ clave: "titulo", nombre: "Qué pasó", descripcion: "Nombre del aviso", ejemplo: "Cierre del día por aprobar" }, DEST],
  },
];

function fila(o: Partial<PlantillaListItemDTO> = {}): PlantillaListItemDTO {
  return {
    id: "p1",
    nombre: "informe_diario",
    cuerpo: "Hola {{destinatario_nombre}}",
    estado: "activo",
    variables: ["destinatario_nombre"],
    variablesNombres: {},
    welcomeMessage: false,
    plantillaTienda: false,
    templateId: "t1",
    informeClave: "prueba_envio",
    llevaDocumento: true,
    createdAt: new Date("2026-10-05T12:00:00Z"),
    ...o,
  };
}

function conProveedores(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

function modulo(item: PlantillaListItemDTO) {
  m.listarPlantillas.mockResolvedValue({ status: "ok", items: [item], page: 1, pageSize: 25, total: 1 });
  return conProveedores(<PlantillasModule initialData={{ items: [item], total: 1, pageSize: 25 }} informes={INFORMES} />);
}

async function tablaLista(): Promise<HTMLElement> {
  const t = screen.getByRole("table", { name: "Plantillas de mensaje" });
  await within(t).findByText("informe_diario");
  return t;
}

/** El listbox del `Select` (el selector de campos es OTRO listbox, siempre visible). */
async function listboxDelSelect(): Promise<HTMLElement> {
  return waitFor(() => {
    const l = screen.getAllByRole("listbox").find((x) => x.getAttribute("aria-label") !== "Campos del catálogo");
    if (!l) throw new Error("sin listbox del Select");
    return l;
  }, { timeout: 3000 }); // el popup del Select tarda bajo la carga del gate
}

async function elegirTipo(user: ReturnType<typeof userEvent.setup>, opcion: string) {
  await user.click(screen.getByRole("combobox", { name: "Tipo de plantilla" }));
  await user.click(within(await listboxDelSelect()).getByRole("option", { name: opcion }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.previewPlantilla.mockResolvedValue({ status: "ok", texto: "TEXTO DE ORDEN" });
  m.crearPlantilla.mockResolvedValue({ status: "ok", plantilla: {} });
  m.actualizarPlantilla.mockResolvedValue({ status: "ok", plantilla: {} });
  m.estadoAppMeta.mockResolvedValue({ status: "ok", estado: "identificada" });
});
afterEach(() => cleanup());

describe("R3/R4/R53 — crear una plantilla DE INFORME", () => {
  it("el selector ofrece SOLO las variables del informe (con la común «Nombre del destinatario») y la vista previa usa sus ejemplos", async () => {
    const user = userEvent.setup();
    render(<CrearPlantillaForm informes={INFORMES} />);
    await elegirTipo(user, "De informe: Prueba de envío");

    const opciones = within(screen.getByRole("listbox", { name: "Campos del catálogo" }))
      .getAllByRole("option")
      .map((o) => o.querySelector("span span")?.textContent);
    expect(opciones).toEqual(["Fecha", "Hora", "Nombre del destinatario"]);

    await user.type(screen.getByLabelText("Cuerpo"), "Buenos días ");
    await user.click(screen.getByRole("option", { name: /Nombre del destinatario/ }));
    await waitFor(() => expect(screen.getByTestId("plantilla-preview")).toHaveValue("Buenos días Daniel"));
    // No pregunta al servidor por el cuerpo de informe: `previewPlantilla` rellena con datos de
    // ORDEN. (Sí puede haberse llamado con el cuerpo VACÍO del arranque, cuando aún era de orden.)
    expect(m.previewPlantilla).not.toHaveBeenCalledWith(expect.stringContaining("Buenos"));
  });

  it("R4: una clave que no es del informe se marca como desconocida", async () => {
    const user = userEvent.setup();
    render(<CrearPlantillaForm informes={INFORMES} />);
    await elegirTipo(user, "De informe: Prueba de envío");
    await user.type(screen.getByLabelText("Cuerpo"), "Guía {{{{guia}}");
    expect(screen.getByRole("alert")).toHaveTextContent("{{guia}} no es un dato de este informe: no se podrá rellenar");
  });

  it("R3/R8: manda el informe y el documento, sin «plantilla de tienda»", async () => {
    const user = userEvent.setup();
    const ref = createRef<CrearPlantillaFormHandle>();
    render(<CrearPlantillaForm ref={ref} informes={INFORMES} />);
    expect(screen.getByRole("switch", { name: "Plantilla para envío de la tienda" })).toBeInTheDocument();
    await elegirTipo(user, "De informe: Prueba de envío");
    expect(screen.queryByRole("switch", { name: "Plantilla para envío de la tienda" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Lleva documento adjunto" }));
    await user.type(screen.getByLabelText("Nombre"), "prueba_doc");
    await user.type(screen.getByLabelText("Cuerpo"), "Hola");
    await ref.current?.submit();
    expect(m.crearPlantilla).toHaveBeenCalledWith({
      nombre: "prueba_doc",
      cuerpo: "Hola",
      plantillaTienda: false,
      informeClave: "prueba_envio",
      llevaDocumento: true,
    });
  });

  it("R6: con un informe que NO genera documento el interruptor está bloqueado y se dice por qué", async () => {
    const user = userEvent.setup();
    render(<CrearPlantillaForm informes={INFORMES} />);
    await elegirTipo(user, "De informe: Aviso de la app");
    const sw = screen.getByRole("switch", { name: "Lleva documento adjunto" });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Este informe no genera documento: sus plantillas van sin PDF.")).toBeInTheDocument();
  });

  it("R6: el error del servidor en `llevaDocumento` se pinta en su campo", async () => {
    const user = userEvent.setup();
    m.crearPlantilla.mockResolvedValue({ status: "validation_error", fieldErrors: { llevaDocumento: ["Este informe no genera documento"] } });
    const ref = createRef<CrearPlantillaFormHandle>();
    render(<CrearPlantillaForm ref={ref} informes={INFORMES} />);
    await elegirTipo(user, "De informe: Prueba de envío");
    await user.type(screen.getByLabelText("Nombre"), "x");
    await user.type(screen.getByLabelText("Cuerpo"), "Hola");
    await ref.current?.submit();
    expect(await screen.findByText("Este informe no genera documento")).toBeInTheDocument();
  });

  it("una plantilla de ORDEN sigue igual: vista previa del servidor y el payload de siempre", async () => {
    const user = userEvent.setup();
    const ref = createRef<CrearPlantillaFormHandle>();
    render(<CrearPlantillaForm ref={ref} informes={INFORMES} />);
    await user.type(screen.getByLabelText("Nombre"), "aviso");
    await user.type(screen.getByLabelText("Cuerpo"), "Hola");
    await waitFor(() => expect(screen.getByTestId("plantilla-preview")).toHaveValue("TEXTO DE ORDEN"));
    await ref.current?.submit();
    // Sin campos de informe en el payload: el contrato de la 107 intacto.
    expect(m.crearPlantilla).toHaveBeenCalledWith({ nombre: "aviso", cuerpo: "Hola", plantillaTienda: false });
  });
});

describe("R7 — editar una plantilla que ya salió hacia Meta", () => {
  it("bloquea el tipo y el documento y NO los manda al guardar", async () => {
    const ref = createRef<EditarPlantillaFormHandle>();
    render(<EditarPlantillaForm ref={ref} plantilla={fila()} informes={INFORMES} />);
    expect(screen.getByRole("combobox", { name: "Tipo de plantilla" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("switch", { name: "Lleva documento adjunto" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/ya se envió a WhatsApp: el tipo y el documento adjunto no se pueden cambiar/)).toBeInTheDocument();
    await ref.current?.submit();
    expect(m.actualizarPlantilla).toHaveBeenCalledWith("p1", {
      nombre: "informe_diario",
      cuerpo: "Hola {{destinatario_nombre}}",
      plantillaTienda: false,
    });
  });

  it("un borrador nunca enviado SÍ puede cambiar de tipo, y lo manda", async () => {
    const user = userEvent.setup();
    const ref = createRef<EditarPlantillaFormHandle>();
    render(
      <EditarPlantillaForm
        ref={ref}
        plantilla={fila({ estado: "saved_not_aprobation", templateId: null, llevaDocumento: false })}
        informes={INFORMES}
      />,
    );
    await elegirTipo(user, "De informe: Aviso de la app");
    await ref.current?.submit();
    expect(m.actualizarPlantilla).toHaveBeenCalledWith("p1", expect.objectContaining({ informeClave: "aviso_interno", llevaDocumento: false }));
  });
});

describe("R8/R9/R10 — el listado", () => {
  it("R8: una plantilla de informe activa NO ofrece «Mensaje de bienvenida» y lleva su insignia", async () => {
    modulo(fila());
    const tabla = await tablaLista();
    expect(within(tabla).queryByRole("button", { name: /Mensaje de bienvenida/ })).not.toBeInTheDocument();
    expect(within(tabla).getByText("Informe · con PDF")).toBeInTheDocument();
  });

  it("R9: enviar a aprobación sin app de Meta identificada dice por qué", async () => {
    const user = userEvent.setup();
    m.enviarPlantillaAprobacion.mockResolvedValue({
      status: "documento_no_disponible",
      mensaje: "Falta configurar WhatsApp (falta WHATSAPP_CLOUD_TOKEN)",
    });
    modulo(fila({ estado: "saved_not_aprobation", templateId: null }));
    await user.click(within(await tablaLista()).getByRole("button", { name: "Enviar para aprobación" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Continuar" }));
    expect(await screen.findAllByText("Falta configurar WhatsApp (falta WHATSAPP_CLOUD_TOKEN)")).not.toHaveLength(0);
  });

  it("R10: desactivar una plantilla en uso nombra los envíos encendidos", async () => {
    const user = userEvent.setup();
    m.cambiarEstadoPlantilla.mockResolvedValue({ status: "en_uso", envios: ["Paquetes por vencer", "Picking"] });
    modulo(fila());
    await user.click(within(await tablaLista()).getByRole("button", { name: "Desactivar" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Desactivar" }));
    expect(
      await screen.findAllByText(
        "No se puede desactivar: la usan envíos automáticos encendidos («Paquetes por vencer», «Picking»). Apágalos antes.",
      ),
    ).not.toHaveLength(0);
  });

  it("R10: eliminar una plantilla en uso, igual", async () => {
    const user = userEvent.setup();
    m.eliminarPlantilla.mockResolvedValue({ status: "en_uso", envios: ["Paquetes por vencer"] });
    modulo(fila());
    await user.click(within(await tablaLista()).getByRole("button", { name: "Eliminar" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Eliminar" }));
    expect(
      await screen.findAllByText("No se puede eliminar: la usan envíos automáticos encendidos («Paquetes por vencer»). Apágalos antes."),
    ).not.toHaveLength(0);
  });
});
