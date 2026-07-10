// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";

import { ToastProvider, type ToastApi } from "@/providers/ToastProvider";
import { useToast } from "@/hooks/useToast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers de consulta
//
// El viewport de Base UI se monta por PORTAL, así que se consulta con `screen`
// (todo el documento). Cada toast REAL renderiza un `Toast.Root` con
// `data-variant`; Base UI además clona el texto en una región `aria-live`
// separada (announce). Por eso NO usamos `getByText` (devolvería el clon
// duplicado) sino los elementos `[data-variant]` como fuente de verdad de los
// toasts visibles.
// ---------------------------------------------------------------------------
function toastRoots(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-variant]"));
}
function toastsWithText(text: string): HTMLElement[] {
  return toastRoots().filter((el) => el.textContent?.includes(text));
}
function closeButtonOf(root: HTMLElement): HTMLElement {
  return root.querySelector(
    '[aria-label="Cerrar notificación"]',
  ) as HTMLElement;
}
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

// ---------------------------------------------------------------------------
// Harness: componente cliente con botones que llaman useToast(). Los ids
// devueltos por la API se acumulan en `captured.ids`; las referencias de la API
// en `captured.apis` (para verificar identidad estable).
// ---------------------------------------------------------------------------
interface Captured {
  ids: string[];
  apis: ToastApi[];
}

interface HarnessProps {
  captured?: Captured;
  onDismiss?: () => void;
  shortDuration?: number;
}

function Harness({ captured, onDismiss, shortDuration = 1000 }: HarnessProps) {
  const toast = useToast();
  captured?.apis.push(toast);
  const [, force] = useState(0);
  const push = (id: string) => {
    captured?.ids.push(id);
  };

  return (
    <div>
      <button onClick={() => push(toast.success("Guardado"))}>b-success</button>
      <button onClick={() => push(toast.error("Fallo"))}>b-error</button>
      <button onClick={() => push(toast.info("Informacion"))}>b-info</button>
      <button onClick={() => push(toast.warning("Cuidado"))}>b-warning</button>
      <button onClick={() => push(toast.show({ message: "Generico", variant: "success" }))}>
        b-show
      </button>
      <button
        onClick={() =>
          push(toast.show({ message: "Corto", variant: "info", duration: shortDuration }))
        }
      >
        b-corto
      </button>
      <button onClick={() => push(toast.show({ message: "Largo", variant: "info" }))}>
        b-largo
      </button>
      <button
        onClick={() =>
          push(toast.show({ message: "Persistente", variant: "info", duration: 0 }))
        }
      >
        b-persist
      </button>
      <button
        onClick={() =>
          push(toast.show({ message: "AutoCb", variant: "info", onDismiss }))
        }
      >
        b-cb-auto
      </button>
      <button
        onClick={() =>
          push(
            toast.show({
              message: "ManualCb",
              variant: "info",
              duration: 0,
              onDismiss,
            }),
          )
        }
      >
        b-cb-manual
      </button>
      <button
        onClick={() => {
          const last = captured?.ids.at(-1);
          if (last) toast.dismiss(last);
        }}
      >
        b-dismiss-last
      </button>
      <button onClick={() => toast.dismiss("id-inexistente")}>b-dismiss-missing</button>
      <button onClick={() => force((v) => v + 1)}>b-rerender</button>
    </div>
  );
}

function renderHarness(
  providerProps: Partial<React.ComponentProps<typeof ToastProvider>> = {},
  harnessProps: HarnessProps = {},
) {
  return render(
    <ToastProvider {...providerProps}>
      <Harness {...harnessProps} />
    </ToastProvider>,
  );
}

const click = (name: string) => fireEvent.click(screen.getByText(name));

// ---------------------------------------------------------------------------
// R1, R2 — API estable y guarda de provider
// ---------------------------------------------------------------------------
describe("useToast — API y guarda (R1, R2)", () => {
  it("R1: expone success/error/info/warning/show/dismiss con identidad estable entre renders", () => {
    const captured: Captured = { ids: [], apis: [] };
    renderHarness({ defaultDuration: 0 }, { captured });

    const api = captured.apis.at(-1)!;
    expect(typeof api.success).toBe("function");
    expect(typeof api.error).toBe("function");
    expect(typeof api.info).toBe("function");
    expect(typeof api.warning).toBe("function");
    expect(typeof api.show).toBe("function");
    expect(typeof api.dismiss).toBe("function");

    const before = captured.apis.at(-1)!;
    click("b-rerender");
    const after = captured.apis.at(-1)!;
    // Identidad estable: misma referencia del objeto API tras re-render.
    expect(after).toBe(before);
  });

  it("R2: useToast fuera de ToastProvider lanza un error descriptivo", () => {
    // React registra el error del render en console.error; lo silenciamos.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow(/ToastProvider/i);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// R3, R4, R5, R6 — children, texto, id
// ---------------------------------------------------------------------------
describe("show/variantes — children, texto e ids (R3, R4, R5, R6)", () => {
  it("R3: ToastProvider renderiza sus children sin alterarlos", () => {
    render(
      <ToastProvider>
        <div data-testid="hijo">contenido hijo</div>
      </ToastProvider>,
    );
    expect(screen.getByTestId("hijo")).toBeInTheDocument();
    expect(screen.getByText("contenido hijo")).toBeInTheDocument();
  });

  it("R4: toast.success(message) muestra un toast con ese texto", () => {
    renderHarness({ defaultDuration: 0 });
    click("b-success");
    expect(toastsWithText("Guardado")).toHaveLength(1);
  });

  it("R5: show({variant,message}) devuelve un id y muestra el toast", () => {
    const captured: Captured = { ids: [], apis: [] };
    renderHarness({ defaultDuration: 0 }, { captured });
    click("b-show");
    expect(captured.ids).toHaveLength(1);
    expect(typeof captured.ids[0]).toBe("string");
    expect(captured.ids[0].length).toBeGreaterThan(0);
    expect(toastsWithText("Generico")).toHaveLength(1);
  });

  it("R6: ids de toasts consecutivos no colisionan", () => {
    const captured: Captured = { ids: [], apis: [] };
    renderHarness({ defaultDuration: 0 }, { captured });
    click("b-success");
    click("b-error");
    expect(captured.ids).toHaveLength(2);
    expect(captured.ids[0]).not.toBe(captured.ids[1]);
  });
});

// ---------------------------------------------------------------------------
// R9 — Región accesible por portal
// ---------------------------------------------------------------------------
describe("viewport accesible (R9)", () => {
  it("R9: los toasts se renderizan en una región accesible montada por portal", () => {
    renderHarness({ defaultDuration: 0 });
    click("b-success");
    const region = screen.getByRole("region", { name: /notificaciones/i });
    expect(region).toBeInTheDocument();
    const root = toastsWithText("Guardado")[0];
    expect(region.contains(root)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R10, R11, R12 — Auto-descarte
// ---------------------------------------------------------------------------
describe("auto-descarte por timeout (R10, R11, R12)", () => {
  it("R10: auto-descarta tras la duración por defecto", () => {
    vi.useFakeTimers();
    renderHarness({ defaultDuration: 5000 });
    click("b-success");
    expect(toastsWithText("Guardado")).toHaveLength(1);
    advance(5100);
    expect(toastsWithText("Guardado")).toHaveLength(0);
  });

  it("R11: respeta la duración por-toast (una corta desaparece antes que la default)", () => {
    vi.useFakeTimers();
    renderHarness({ defaultDuration: 5000 }, { shortDuration: 1000 });
    click("b-corto"); // duration 1000
    click("b-largo"); // duration default 5000
    expect(toastsWithText("Corto")).toHaveLength(1);
    expect(toastsWithText("Largo")).toHaveLength(1);

    advance(1500); // supera la corta pero no la default
    expect(toastsWithText("Corto")).toHaveLength(0);
    expect(toastsWithText("Largo")).toHaveLength(1);
  });

  it("R12: duration 0 persiste (no auto-descarta)", () => {
    vi.useFakeTimers();
    renderHarness({ defaultDuration: 5000 });
    click("b-persist"); // duration 0
    expect(toastsWithText("Persistente")).toHaveLength(1);
    advance(60000);
    expect(toastsWithText("Persistente")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// R13, R14, R19 — Cierre manual, programático y aislamiento
// ---------------------------------------------------------------------------
describe("cierre manual y programático (R13, R14, R19)", () => {
  it("R13: el botón de cierre retira ese toast", () => {
    renderHarness({ defaultDuration: 0 });
    click("b-success");
    const root = toastsWithText("Guardado")[0];
    fireEvent.click(closeButtonOf(root));
    expect(toastsWithText("Guardado")).toHaveLength(0);
  });

  it("R14: dismiss(id) retira el toast correspondiente", () => {
    const captured: Captured = { ids: [], apis: [] };
    renderHarness({ defaultDuration: 0 }, { captured });
    click("b-success");
    expect(toastsWithText("Guardado")).toHaveLength(1);
    click("b-dismiss-last"); // dismiss(id del último toast)
    expect(toastsWithText("Guardado")).toHaveLength(0);
  });

  it("R14: dismiss con id inexistente es un no-op (no lanza ni afecta a otros)", () => {
    renderHarness({ defaultDuration: 0 });
    click("b-success");
    expect(() => click("b-dismiss-missing")).not.toThrow();
    expect(toastsWithText("Guardado")).toHaveLength(1);
  });

  it("R19: retirar un toast no afecta a los demás activos", () => {
    const captured: Captured = { ids: [], apis: [] };
    renderHarness({ defaultDuration: 0 }, { captured });
    click("b-success"); // Guardado
    click("b-error"); // Fallo
    // dismiss del último (Fallo)
    click("b-dismiss-last");
    expect(toastsWithText("Fallo")).toHaveLength(0);
    expect(toastsWithText("Guardado")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// R15 — Pausa/reanudación del auto-descarte (nativo Base UI)
// ---------------------------------------------------------------------------
describe("pausa/reanudación del auto-descarte (R15)", () => {
  it("R15: pausa mientras el puntero está sobre el toast y reanuda al salir", () => {
    vi.useFakeTimers();
    renderHarness({ defaultDuration: 5000 });
    click("b-success");
    const region = screen.getByRole("region", { name: /notificaciones/i });

    fireEvent.mouseEnter(region);
    advance(8000); // supera la duración, pero está en hover → pausado
    expect(toastsWithText("Guardado")).toHaveLength(1);

    fireEvent.mouseLeave(region);
    advance(8000); // reanuda → se descarta
    expect(toastsWithText("Guardado")).toHaveLength(0);
  });

  it("R15: pausa también con foco de teclado dentro del toast y reanuda al salir", () => {
    // Nota: jsdom SÍ reproduce la pausa por foco en esta versión de Base UI
    // (verificado). Enfocamos el `Toast.Root` (tabindex=0) y emitimos focusin/
    // focusout sobre la región del viewport.
    vi.useFakeTimers();
    renderHarness({ defaultDuration: 5000 });
    click("b-success");
    const region = screen.getByRole("region", { name: /notificaciones/i });
    const root = toastsWithText("Guardado")[0];

    act(() => {
      root.focus();
      fireEvent.focusIn(region);
    });
    advance(8000);
    expect(toastsWithText("Guardado")).toHaveLength(1);

    act(() => {
      fireEvent.focusOut(region);
      root.blur();
    });
    advance(8000);
    expect(toastsWithText("Guardado")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R16 — onDismiss
// ---------------------------------------------------------------------------
describe("callback onDismiss (R16)", () => {
  it("R16: onDismiss se invoca una vez al auto-descartar", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderHarness({ defaultDuration: 5000 }, { onDismiss });
    click("b-cb-auto");
    expect(onDismiss).not.toHaveBeenCalled();
    advance(5100);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    advance(10000); // no se vuelve a invocar
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("R16: onDismiss se invoca una vez al cerrar manualmente", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    renderHarness({ defaultDuration: 5000 }, { onDismiss });
    click("b-cb-manual"); // duration 0 (no auto-descarte)
    const root = toastsWithText("ManualCb")[0];
    fireEvent.click(closeButtonOf(root));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    advance(10000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// R17, R18 — Apilado y límite
// ---------------------------------------------------------------------------
describe("apilado y límite (R17, R18)", () => {
  it("R17: múltiples toasts se apilan y se renderizan simultáneamente", () => {
    renderHarness({ max: 4, defaultDuration: 0 });
    click("b-success");
    click("b-error");
    click("b-info");
    expect(toastsWithText("Guardado")).toHaveLength(1);
    expect(toastsWithText("Fallo")).toHaveLength(1);
    expect(toastsWithText("Informacion")).toHaveLength(1);
  });

  it("R18: al superar max los más antiguos dejan de mostrarse", () => {
    // Selector documentado: Base UI NO elimina los excedentes, los marca con el
    // atributo `data-limited` en el `Toast.Root`. "Visible" = root SIN
    // `data-limited`. Con max=2 y 3 disparos, a lo sumo 2 quedan visibles y el
    // más antiguo queda marcado `data-limited`.
    renderHarness({ max: 2, defaultDuration: 0 });
    click("b-success"); // más antiguo → quedará limitado
    click("b-error");
    click("b-info");

    const visibles = toastRoots().filter(
      (r) => r.getAttribute("data-limited") === null,
    );
    expect(visibles.length).toBeLessThanOrEqual(2);

    const guardado = toastsWithText("Guardado")[0];
    expect(guardado.getAttribute("data-limited")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// R20 — Consumidor bajo el provider
// ---------------------------------------------------------------------------
describe("integración provider/consumidor (R20)", () => {
  it("R20: un componente cliente montado bajo el ToastProvider dispara y ve un toast vía useToast", () => {
    renderHarness({ defaultDuration: 0 });
    // El harness (consumidor cliente) no monta su propio provider.
    click("b-info");
    expect(toastsWithText("Informacion")).toHaveLength(1);
  });
});
