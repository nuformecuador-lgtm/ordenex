// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { FieldError } from "@/components/shared/FieldError";
import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// FieldError — el bloque de error accesible unificado (DESIGN.md)
// ---------------------------------------------------------------------------
describe("FieldError", () => {
  it("renderiza el mensaje con role='alert' y el id recibido", () => {
    render(<FieldError id="campo-error">Algo salió mal</FieldError>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Algo salió mal");
    expect(alert).toHaveAttribute("id", "campo-error");
    // Color destructivo del sistema de diseño (variante destructive de shadcn).
    expect(alert.className).toContain("text-destructive");
  });

  it("no renderiza nada cuando no hay mensaje (children vacío o ausente)", () => {
    const { rerender } = render(<FieldError id="x" />);
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<FieldError id="x">{""}</FieldError>);
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<FieldError id="x">{false}</FieldError>);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("con `messages` muestra cada mensaje en su propia línea dentro de un solo alert", () => {
    render(
      <FieldError id="pass-error" messages={["Falta mayúscula", "Falta dígito"]} />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("id", "pass-error");
    expect(screen.getByText("Falta mayúscula")).toBeInTheDocument();
    expect(screen.getByText("Falta dígito")).toBeInTheDocument();
  });

  it("con `messages` vacío no renderiza nada", () => {
    render(<FieldError id="x" messages={[]} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FormField — patrón único de campo con accesibilidad cableada
// ---------------------------------------------------------------------------
describe("FormField — asociación label/control", () => {
  it("asocia el label con el control por htmlFor/id (getByLabelText)", () => {
    render(
      <FormField id="nombre" label="Nombre">
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Nombre");
    expect(input).toHaveAttribute("id", "nombre");
  });
});

describe("FormField — estado sin error", () => {
  it("no muestra alert ni marca aria-invalid/aria-describedby", () => {
    render(
      <FormField id="nombre" label="Nombre">
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Nombre");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("FormField — estado con error", () => {
  it("marca aria-invalid, enlaza aria-describedby al error y muestra el alert", () => {
    render(
      <FormField id="email" label="Correo" error="Correo inválido">
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Correo");
    const alert = screen.getByRole("alert");

    expect(alert).toHaveTextContent("Correo inválido");
    expect(alert).toHaveAttribute("id", "email-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
  });

  it("acepta un arreglo de mensajes de error (varias reglas de validación)", () => {
    render(
      <FormField
        id="password"
        label="Contraseña"
        error={["Falta mayúscula", "Falta símbolo"]}
      >
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Contraseña");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "password-error");
    expect(screen.getByText("Falta mayúscula")).toBeInTheDocument();
    expect(screen.getByText("Falta símbolo")).toBeInTheDocument();
  });
});

describe("FormField — hint (descripción)", () => {
  it("enlaza la ayuda por aria-describedby", () => {
    render(
      <FormField id="alias" label="Alias" hint="Se mostrará en público">
        <Input defaultValue="" />
      </FormField>,
    );

    const input = screen.getByLabelText("Alias");
    expect(screen.getByText("Se mostrará en público")).toHaveAttribute(
      "id",
      "alias-hint",
    );
    expect(input).toHaveAttribute("aria-describedby", "alias-hint");
  });

  it("con hint Y error, aria-describedby apunta a ambos", () => {
    render(
      <FormField
        id="alias"
        label="Alias"
        hint="Se mostrará en público"
        error="Alias en uso"
      >
        <Input defaultValue="" />
      </FormField>,
    );

    expect(screen.getByLabelText("Alias")).toHaveAttribute(
      "aria-describedby",
      "alias-hint alias-error",
    );
  });
});

describe("FormField — required", () => {
  it("marca aria-required en el control y muestra el indicador visual", () => {
    render(
      <FormField id="obligatorio" label="Obligatorio" required>
        <Input defaultValue="" />
      </FormField>,
    );

    expect(screen.getByRole("textbox")).toHaveAttribute("aria-required", "true");
    // El asterisco es decorativo (aria-hidden) pero visible.
    const star = screen.getByText("*");
    expect(star).toHaveAttribute("aria-hidden", "true");
  });
});

describe("FormField — render-prop", () => {
  it("pasa { id, aria-invalid, aria-describedby } al control", () => {
    render(
      <FormField id="rp" label="Render prop" error="malo">
        {(control) => <input {...control} data-testid="ctrl" />}
      </FormField>,
    );

    const ctrl = screen.getByTestId("ctrl");
    expect(ctrl).toHaveAttribute("id", "rp");
    expect(ctrl).toHaveAttribute("aria-invalid", "true");
    expect(ctrl).toHaveAttribute("aria-describedby", "rp-error");
  });
});

describe("FormField — funciona con los controles del repo", () => {
  it("Select: recibe aria-invalid y aria-describedby en el combobox", () => {
    render(
      <FormField id="rol" label="Rol" error="Elige un rol">
        {({
          "aria-invalid": ariaInvalid,
          "aria-describedby": ariaDescribedBy,
        }) => (
          <Select
            aria-label="Rol"
            value=""
            onValueChange={() => {}}
            options={[{ value: "a", label: "Admin" }]}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
          />
        )}
      </FormField>,
    );

    const combo = screen.getByRole("combobox", { name: "Rol" });
    expect(combo).toHaveAttribute("aria-invalid", "true");
    expect(combo).toHaveAttribute("aria-describedby", "rol-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Elige un rol");
  });

  it("textarea: hereda id, aria-invalid y aria-describedby por clonación", () => {
    render(
      <FormField id="notas" label="Notas" error="Requerido">
        <textarea defaultValue="" />
      </FormField>,
    );

    const textarea = screen.getByLabelText("Notas");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAttribute("aria-describedby", "notas-error");
  });

  it("Checkbox: el control interactivo hereda aria-invalid y aria-describedby por clonación", () => {
    render(
      <FormField id="acepto" label="Acepto" error="Debes aceptar">
        <Checkbox />
      </FormField>,
    );

    // base-ui Checkbox reenvía la accesibilidad al elemento role="checkbox".
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox).toHaveAttribute("aria-describedby", "acepto-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Debes aceptar");
  });
});
