// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { GestionarOrdenPanel } from "@/app/(app)/mis-asignaciones/_components/GestionarOrdenPanel";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 119 (R14-R17) — evidencias MULTIPLES en el panel del mensajero. Se prueba el panel
// AISLADO (con el puntero ya fijado, `yaActiva`), que arranca directo en los 4 botones de
// resultado. La Server Action `gestionar` (`"use server"` con Prisma detras) y el toast se
// mockean para afirmar la UI y el FormData sin DB ni sesion. `comprimirImagen` no se mockea:
// los File de prueba son pequeños (<1 MB) y el compresor los devuelve tal cual, sin tocar canvas.
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  gestionar: vi.fn(),
}));

// Feature 116: el panel monta `NotaPrivadaMensajero`, que usa `useRouter` e importa estas
// Server Actions (`"use server"` con Prisma detrás). Se mockean el router y las actions para no
// cargar Prisma en jsdom; el comportamiento del editor se prueba en `NotaPrivadaMensajero.test.tsx`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/notas-privadas-mensajero", () => ({
  guardarNotaPrivada: vi.fn(),
  limpiarNotaPrivada: vi.fn(),
}));

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

const gestionarMock = vi.mocked(gestionar);

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "g1",
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1, casa 2",
    producto: "Caja mediana",
    peso: 1.5,
    montoCobrar: 150,
    latitud: 9.9281244,
    longitud: -84.0907246,
    notas: "Dejar en portería",
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: 1,
    ...over,
  };
}

/** File-imagen pequeño (bypass del compresor por tamaño). */
function foto(nombre: string): File {
  return new File(["x"], nombre, { type: "image/jpeg" });
}

/** Monta el panel con el puntero ya fijado y abre la rama del resultado indicado. */
async function abrirRama(
  user: ReturnType<typeof userEvent.setup>,
  rama: string,
  over: Partial<MiAsignacionDTO> = {},
) {
  render(
    <GestionarOrdenPanel
      orden={makeOrden(over)}
      yaActiva
      onGestionarPedido={vi.fn().mockResolvedValue(true)}
      onCancelarGestion={vi.fn()}
      onSuccess={vi.fn()}
      onAbrirChat={vi.fn()}
      // Total de órdenes en reparto, para el "N de total" de la cabecera: aquí se
      // monta el panel con una sola orden.
      count={1}
    />,
  );
  await user.click(await screen.findByRole("button", { name: rama }));
}

/** La lista de previsualizaciones de fotos (nombre accesible propio). */
function listaEvidencias() {
  return screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" });
}

const LABEL_RECHAZO = "Foto de evidencia del rechazo";
const LABEL_ENTREGA = "Foto de evidencia de entrega";

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({ status: "ok", ordenId: "g1", estado: "rechazada" });
});

afterEach(() => {
  cleanup();
});

describe("GestionarOrdenPanel · evidencias múltiples (feature 119)", () => {
  it("R14: el input de evidencia permite selección MÚLTIPLE en las 3 ramas con foto", async () => {
    const user = userEvent.setup();
    for (const [rama, label] of [
      ["Entregar", LABEL_ENTREGA],
      ["Rechazar", LABEL_RECHAZO],
      ["Devolver", "Foto de evidencia de la devolución"],
    ] as const) {
      await abrirRama(user, rama);
      expect(screen.getByLabelText(label)).toHaveAttribute("multiple");
      cleanup();
    }
  });

  it("R14/R15: seleccionar varias fotos muestra una previsualización por cada una", async () => {
    const user = userEvent.setup();
    await abrirRama(user, "Rechazar");

    await user.upload(screen.getByLabelText(LABEL_RECHAZO), [foto("a.jpg"), foto("b.jpg")]);

    const previews = await within(await screen.findByRole("list", {
      name: "Fotos de evidencia seleccionadas",
    })).findAllByRole("img");
    expect(previews).toHaveLength(2);
  });

  it("R14: la selección se CONCATENA (se pueden ir sumando fotos en varias tandas)", async () => {
    const user = userEvent.setup();
    await abrirRama(user, "Rechazar");

    await user.upload(screen.getByLabelText(LABEL_RECHAZO), foto("a.jpg"));
    await within(listaEvidencias()).findByRole("img");

    await user.upload(screen.getByLabelText(LABEL_RECHAZO), foto("b.jpg"));

    await vi.waitFor(() =>
      expect(within(listaEvidencias()).getAllByRole("img")).toHaveLength(2),
    );
  });

  it("R15: 'Quitar' elimina esa foto de la lista y revoca su object URL", async () => {
    const user = userEvent.setup();
    const revokeSpy = vi.fn();
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeSpy, configurable: true });

    await abrirRama(user, "Rechazar");
    await user.upload(screen.getByLabelText(LABEL_RECHAZO), [foto("a.jpg"), foto("b.jpg")]);
    await vi.waitFor(() =>
      expect(within(listaEvidencias()).getAllByRole("img")).toHaveLength(2),
    );

    await user.click(screen.getByRole("button", { name: "Quitar evidencia 1" }));

    await vi.waitFor(() =>
      expect(within(listaEvidencias()).getAllByRole("img")).toHaveLength(1),
    );
    // Al recrear las previews (la lista cambió) se revocan las URLs anteriores (R15, sin fugas).
    expect(revokeSpy).toHaveBeenCalled();
  });

  it("R16: seleccionar MÁS del tope (3) recorta a 3 y marca el error, sin llamar la action", async () => {
    const user = userEvent.setup();
    await abrirRama(user, "Rechazar");

    await user.upload(screen.getByLabelText(LABEL_RECHAZO), [
      foto("a.jpg"),
      foto("b.jpg"),
      foto("c.jpg"),
      foto("d.jpg"),
    ]);

    await vi.waitFor(() =>
      expect(within(listaEvidencias()).getAllByRole("img")).toHaveLength(3),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Solo puedes adjuntar hasta 3 fotos.");
    expect(gestionarMock).not.toHaveBeenCalled();
  });

  it("R17: sin ninguna foto, 'Guardar gestión' NO llama la action y muestra el error de campo", async () => {
    const user = userEvent.setup();
    await abrirRama(user, "Rechazar");

    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Dirección inexistente" },
    });
    // Sin fotos: la validación de borde (min 1) bloquea el envío.
    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    expect(gestionarMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("R14: al enviar, cada foto viaja como un valor de la clave `evidencia` (getAll → N)", async () => {
    const user = userEvent.setup();
    await abrirRama(user, "Rechazar");

    await user.upload(screen.getByLabelText(LABEL_RECHAZO), [foto("a.jpg"), foto("b.jpg")]);
    await vi.waitFor(() =>
      expect(within(listaEvidencias()).getAllByRole("img")).toHaveLength(2),
    );
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Cliente rechazó" },
    });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    const fotos = fd.getAll("evidencia");
    expect(fotos).toHaveLength(2);
    expect(fotos[0]).toBeInstanceOf(File);
    expect(fotos[1]).toBeInstanceOf(File);
    expect(fd.get("resultado")).toBe("rechazada");
  });

  it("R16: tras recortar y quitar una foto, se puede enviar con las 3 permitidas", async () => {
    const user = userEvent.setup();
    gestionarMock.mockResolvedValue({ status: "ok", ordenId: "g1", estado: "rechazada" });
    await abrirRama(user, "Rechazar");

    await user.upload(screen.getByLabelText(LABEL_RECHAZO), [
      foto("a.jpg"),
      foto("b.jpg"),
      foto("c.jpg"),
      foto("d.jpg"),
    ]);
    await vi.waitFor(() =>
      expect(within(listaEvidencias()).getAllByRole("img")).toHaveLength(3),
    );
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "Cliente rechazó" },
    });

    await user.click(screen.getByRole("button", { name: "Guardar gestión" }));

    await vi.waitFor(() => expect(gestionarMock).toHaveBeenCalledTimes(1));
    const fd = gestionarMock.mock.calls[0][0] as FormData;
    // Se enviaron solo las 3 del tope (la 4ª se recortó, R16).
    expect(fd.getAll("evidencia")).toHaveLength(3);
  });
});
