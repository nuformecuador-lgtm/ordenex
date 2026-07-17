// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Modal, type ModalProps } from "@/components/shared/Modal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Renderiza el Modal con props por defecto sobreescribibles. */
function renderModal(props: Partial<ModalProps> = {}) {
  const merged: ModalProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Título de prueba",
    ...props,
  };
  return { ...render(<Modal {...merged} />), props: merged };
}

/** Promesa diferida controlada por el test (resolución/rechazo bajo demanda). */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const confirmBtn = () => screen.getByRole("button", { name: /Confirmar/ });
const cancelBtn = () => screen.getByRole("button", { name: /Cancelar/ });

// ---------------------------------------------------------------------------
// T2 — Visibilidad controlada (R1, R2, R3, R4)
// ---------------------------------------------------------------------------
describe("Modal — visibilidad controlada (R1, R2, R3, R4)", () => {
  it("R1: no renderiza el diálogo cuando open es false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Título de prueba")).not.toBeInTheDocument();
  });

  it("R2: renderiza un contenedor rol dialog cuando open es true", async () => {
    renderModal();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("R3/R4: al cerrar invoca onOpenChange(false) y no muta open por sí mismo", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange });

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    // El componente no muta `open`: el diálogo sigue montado (padre no cambió la prop).
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T3 — Título, descripción, children y acciones (R5, R6, R7, R8, R8b, R9, R10)
// ---------------------------------------------------------------------------
describe("Modal — contenido y acciones (R5, R6, R7, R8, R8b, R9, R10)", () => {
  it("R5: asocia el título con aria-labelledby", async () => {
    renderModal({ title: "Confirmar borrado" });
    const dialog = await screen.findByRole("dialog");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe(
      "Confirmar borrado",
    );
  });

  it("R6: asocia la descripción con aria-describedby solo si se provee", async () => {
    renderModal({ description: "Esta acción es irreversible" });
    const dialog = await screen.findByRole("dialog");
    const descId = dialog.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBe(
      "Esta acción es irreversible",
    );
  });

  it("R6: sin description no expone aria-describedby", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveAttribute("aria-describedby");
  });

  it("R7: renderiza children arbitrarios en el cuerpo", async () => {
    renderModal({ children: <button type="button">Hijo</button> });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Hijo" })).toBeInTheDocument();
  });

  it("R8: muestra confirmar y cancelar con labels por defecto", async () => {
    renderModal();
    await screen.findByRole("dialog");
    expect(
      screen.getByRole("button", { name: "Confirmar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("R8: muestra confirmar y cancelar con labels personalizados", async () => {
    renderModal({ confirmLabel: "Eliminar", cancelLabel: "Volver" });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("R8b: el botón de confirmar recibe la variante default por defecto", async () => {
    renderModal();
    await screen.findByRole("dialog");
    expect(confirmBtn()).toHaveClass("bg-primary");
  });

  it("R8b: el botón de confirmar recibe la variante destructive cuando confirmVariant='destructive'", async () => {
    renderModal({ confirmVariant: "destructive" });
    await screen.findByRole("dialog");
    const btn = confirmBtn();
    expect(btn).toHaveClass("text-destructive");
    expect(btn).not.toHaveClass("bg-primary");
  });

  it("R9: confirmar sin onConfirm no lanza (no-op) y cierra por defecto", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onConfirm: undefined, onOpenChange });
    await screen.findByRole("dialog");

    await expect(user.click(confirmBtn())).resolves.toBeUndefined();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("R10: no renderiza cancelar cuando hideCancel es true", async () => {
    renderModal({ hideCancel: true });
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: "Cancelar" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// T4 — Confirmar/cancelar síncrono (R11, R12, R13)
// ---------------------------------------------------------------------------
describe("Modal — confirmar/cancelar síncrono (R11, R12, R13)", () => {
  it("R11: invoca onConfirm una sola vez al confirmar (síncrono)", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderModal({ onConfirm });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("R12: cierra tras confirmar síncrono cuando closeOnConfirm no es false", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onConfirm: vi.fn(), onOpenChange });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("R12/R21: no cierra tras confirmar síncrono cuando closeOnConfirm es false", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onConfirm: vi.fn(), onOpenChange, closeOnConfirm: false });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("R13: cancelar invoca onCancel y onOpenChange(false)", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ onCancel, onOpenChange });
    await screen.findByRole("dialog");

    await user.click(cancelBtn());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// T5 — Flujo async: spinner, bloqueo y anti-doble-submit (R14–R18)
// ---------------------------------------------------------------------------
describe("Modal — confirmar async pending (R14, R15, R16, R17, R18)", () => {
  it("R14/R15/R16/R18: entra en pending con spinner (role=status), botón disabled y aria-busy", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onConfirm = vi.fn(() => d.promise);
    renderModal({ onConfirm });
    const dialog = await screen.findByRole("dialog");

    await user.click(confirmBtn());

    // R14: sigue pendiente hasta resolver; R18: anuncio de carga.
    expect(await screen.findByRole("status")).toBeInTheDocument();
    // R15: spinner presente (icono con animate-spin dentro del status).
    expect(
      screen.getByRole("status").querySelector(".animate-spin"),
    ).toBeInTheDocument();
    // R16: botón de confirmación deshabilitado.
    expect(confirmBtn()).toBeDisabled();
    // R18: aria-busy en el diálogo.
    expect(dialog).toHaveAttribute("aria-busy", "true");

    d.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("R17: no invoca onConfirm una segunda vez si se acciona de nuevo durante pending", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onConfirm = vi.fn(() => d.promise);
    renderModal({ onConfirm });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    expect(await screen.findByRole("status")).toBeInTheDocument();

    // Segundo intento durante pending (el botón está disabled): fireEvent no dispara,
    // y la guarda síncrona pendingRef también lo bloquearía.
    fireEvent.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    d.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// T6 — Bloqueo de cierre durante pending (R19)
// ---------------------------------------------------------------------------
describe("Modal — bloqueo de cierre durante pending (R19)", () => {
  it("R19: no cierra por Escape mientras está pending", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onOpenChange = vi.fn();
    renderModal({ onConfirm: () => d.promise, onOpenChange });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");
    onOpenChange.mockClear();

    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();

    d.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("R19: no cierra por overlay mientras está pending", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onOpenChange = vi.fn();
    renderModal({ onConfirm: () => d.promise, onOpenChange });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");
    onOpenChange.mockClear();

    await user.click(screen.getByTestId("modal-backdrop"));
    expect(onOpenChange).not.toHaveBeenCalled();

    d.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("R19: el botón cancelar está deshabilitado y no cierra mientras está pending", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onOpenChange = vi.fn();
    const onCancel = vi.fn();
    renderModal({ onConfirm: () => d.promise, onOpenChange, onCancel });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");
    onOpenChange.mockClear();

    expect(cancelBtn()).toBeDisabled();
    fireEvent.click(cancelBtn());
    expect(onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    d.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// T7 — Resolución del confirmar async (R20, R21)
// ---------------------------------------------------------------------------
describe("Modal — resolución del confirmar async (R20, R21)", () => {
  it("R20: cierra al resolver la promesa cuando closeOnConfirm no es false", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onOpenChange = vi.fn();
    renderModal({ onConfirm: () => d.promise, onOpenChange });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");
    // Aún no ha cerrado mientras está pendiente.
    expect(onOpenChange).not.toHaveBeenCalled();

    d.resolve();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("R21: permanece abierto al resolver cuando closeOnConfirm es false y sale de pending", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onOpenChange = vi.fn();
    renderModal({
      onConfirm: () => d.promise,
      onOpenChange,
      closeOnConfirm: false,
    });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");

    d.resolve();
    // Sale de pending (spinner desaparece) pero NO cierra.
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(confirmBtn()).not.toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// T8 — Rechazo, onError y reintento (R22, R23, R24)
// ---------------------------------------------------------------------------
describe("Modal — rechazo, onError y reintento (R22, R23, R24)", () => {
  it("R22: no cierra el modal al rechazar la promesa y reactiva los botones", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const onOpenChange = vi.fn();
    renderModal({
      onConfirm: () => d.promise,
      onOpenChange,
      onError: vi.fn(),
    });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");

    d.reject(new Error("fallo"));

    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // R22: reactiva confirmar y cancelar.
    expect(confirmBtn()).not.toBeDisabled();
    expect(cancelBtn()).not.toBeDisabled();
  });

  it("R23: invoca onError con el error capturado y no renderiza error propio", async () => {
    const user = userEvent.setup();
    const d = deferred();
    const error = new Error("boom");
    const onError = vi.fn();
    renderModal({ onConfirm: () => d.promise, onError });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");

    d.reject(error);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    // No hay presentación de error propia dentro del diálogo.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R24: reintenta onConfirm al confirmar de nuevo tras un rechazo", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    const onConfirm = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderModal({ onConfirm, onError: vi.fn() });
    await screen.findByRole("dialog");

    await user.click(confirmBtn());
    await screen.findByRole("status");
    first.reject(new Error("primero"));
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    // Reintento.
    await user.click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledTimes(2);

    second.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// T9 — Cierre por Escape y overlay + dismissible (R25, R26, R27)
// ---------------------------------------------------------------------------
describe("Modal — Escape, overlay y dismissible (R25, R26, R27)", () => {
  it("R25: cierra con Escape cuando no está pending y dismissible no es false", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange });
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("R26: cierra al hacer clic en el overlay en las mismas condiciones", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange });
    await screen.findByRole("dialog");

    await user.click(screen.getByTestId("modal-backdrop"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("R27: no cierra por Escape ni overlay cuando dismissible es false", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange, dismissible: false });
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("modal-backdrop"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("R27: con dismissible false, los botones sí cierran", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderModal({ onOpenChange, dismissible: false, onCancel: vi.fn() });
    await screen.findByRole("dialog");

    await user.click(cancelBtn());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// T10 — Accesibilidad de foco y aria-modal (R28, R29, R30)
// R31 (restauración de foco) se delega a Base UI: sin test propio (decisión humana).
// ---------------------------------------------------------------------------
describe("Modal — accesibilidad de foco (R28, R29, R30)", () => {
  it("R28: el diálogo expone aria-modal='true' cuando está abierto", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("R29: mueve el foco al interior del diálogo al abrir", async () => {
    renderModal({ children: <input aria-label="campo" /> });
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
  });

  it("R30: atrapa el foco con Tab dentro del diálogo (envuelve al primer enfocable)", async () => {
    const user = userEvent.setup();
    renderModal({ children: <input aria-label="campo" /> });
    const dialog = await screen.findByRole("dialog");

    // Desde el último enfocable (Confirmar), Tab envuelve de vuelta al interior
    // del diálogo mediante las guardas de foco de Base UI (no escapa al body).
    confirmBtn().focus();
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});

// ---------------------------------------------------------------------------
// Tamaño del popup (prop `size`) — aditiva, con default de compatibilidad
// ---------------------------------------------------------------------------
describe("Modal — tamaño del popup (prop size)", () => {
  it("por defecto conserva max-w-md: los consumidores existentes no cambian de ancho", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("max-w-md");
  });

  it("size='md' explícito equivale al default", async () => {
    renderModal({ size: "md" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("max-w-md");
  });

  it("size='xl' fija el ancho máximo en 1000px y deja de aplicar max-w-md", async () => {
    renderModal({ size: "xl" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("max-w-[1000px]");
    expect(dialog).not.toHaveClass("max-w-md");
  });

  it("size='sm' y size='lg' aplican sus anchos respectivos", async () => {
    const { rerender } = renderModal({ size: "sm" });
    expect(await screen.findByRole("dialog")).toHaveClass("max-w-sm");

    rerender(
      <Modal open onOpenChange={vi.fn()} title="Título de prueba" size="lg" />,
    );
    expect(await screen.findByRole("dialog")).toHaveClass("max-w-2xl");
  });

  it("en cualquier tamaño el popup sigue limitado al viewport (responsive)", async () => {
    renderModal({ size: "xl" });
    const dialog = await screen.findByRole("dialog");
    // Se encoge en pantallas chicas en lugar de desbordar.
    expect(dialog).toHaveClass("w-[calc(100%-2rem)]");
  });

  it("size no rompe el scroll del cuerpo ni el header/footer fijos (feature 58)", async () => {
    renderModal({ size: "xl", children: <p>contenido</p> });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("max-h-[calc(100dvh-2rem)]");
    // El cuerpo conserva su contenedor scrollable.
    const body = screen.getByText("contenido").parentElement;
    expect(body).toHaveClass("overflow-auto");
    expect(body).toHaveClass("min-h-0");
  });

  it("className del consumidor sigue pudiendo sobreescribir el ancho del tamaño", async () => {
    renderModal({ size: "xl", className: "max-w-none" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("max-w-none");
    expect(dialog).not.toHaveClass("max-w-[1000px]");
  });
});

describe("Modal — confirmVariant brand-outline (aditiva)", () => {
  it("aplica la variante de marca al botón confirmar", async () => {
    renderModal({ confirmVariant: "brand-outline", confirmLabel: "Cerrar" });
    const boton = await screen.findByRole("button", { name: "Cerrar" });
    expect(boton).toHaveClass("text-brand");
  });

  it("el confirmar por defecto sigue siendo la variante sólida", async () => {
    renderModal();
    expect(confirmBtn()).toHaveClass("bg-primary");
  });
});
