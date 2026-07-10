// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import { ToastProvider, type ToastVariant } from "@/providers/ToastProvider";
import { useToast } from "@/hooks/useToast";

afterEach(() => {
  cleanup();
});

// Consumidor que dispara un toast por variante. Se renderiza dentro del
// ToastProvider real (que monta el componente presentacional `Toast`).
function VariantHarness() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("ok")}>b-success</button>
      <button onClick={() => toast.error("err")}>b-error</button>
      <button onClick={() => toast.info("nfo")}>b-info</button>
      <button onClick={() => toast.warning("wrn")}>b-warning</button>
    </div>
  );
}

function rootOf(variant: ToastVariant): HTMLElement {
  return document.querySelector(`[data-variant="${variant}"]`) as HTMLElement;
}

function renderVariants() {
  return render(
    <ToastProvider defaultDuration={0}>
      <VariantHarness />
    </ToastProvider>,
  );
}

const click = (name: string) => fireEvent.click(screen.getByText(name));

describe("Toast presentacional — variantes (R7)", () => {
  it.each<[ToastVariant, string]>([
    ["success", "b-success"],
    ["error", "b-error"],
    ["info", "b-info"],
    ["warning", "b-warning"],
  ])("R7: la variante %s expone data-variant y su icono", (variant, boton) => {
    renderVariants();
    click(boton);
    const root = rootOf(variant);
    expect(root).toBeTruthy();
    expect(root.getAttribute("data-variant")).toBe(variant);
    // Icono lucide presente (svg con aria-hidden dentro del root).
    const icon = root.querySelector("svg");
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Toast presentacional — role accesible (R8)", () => {
  it("R8: error y warning usan role=alert", () => {
    renderVariants();
    click("b-error");
    click("b-warning");
    // El role se aplica en el Toast.Root (identificado por data-variant); Base UI
    // puede marcar el root con aria-hidden en el stack colapsado, por eso se lee
    // el atributo `role` directamente en vez de `getByRole`.
    expect(rootOf("error").getAttribute("role")).toBe("alert");
    expect(rootOf("warning").getAttribute("role")).toBe("alert");
  });

  it("R8: success e info usan role=status", () => {
    renderVariants();
    click("b-success");
    click("b-info");
    expect(rootOf("success").getAttribute("role")).toBe("status");
    expect(rootOf("info").getAttribute("role")).toBe("status");
  });
});
