// @vitest-environment jsdom
// Feature 286 — el campo de contraseña con su ojito.
//
// Lo que este archivo existe para que no se rompa en silencio, porque TODO se ve bien en
// una captura y falla en uso:
//
//   - Que el ojito CAMBIE EL `type` DEL INPUT. Un test que sólo comprueba «existe un
//     botón» no prueba nada: pasa igual con un botón muerto. Aquí se afirma la SECUENCIA
//     del atributo, y muere con MUT-1 (el `onClick` deja de cambiar el estado).
//   - Que NO envíe el formulario. Un `<button>` sin `type="button"` dentro de un `<form>`
//     envía: pulsar el ojito dispararía la Server Action. Muere con MUT-2.
//   - Que el `id` y la accesibilidad lleguen al `<input>` y no al envoltorio. Si caen en
//     el `<div>`, `getByLabelText` devuelve otra cosa y el `ref` deja de enfocar el campo.
//     Muere con MUT-6.
//   - Que la región viva NO tenga `role`. Muere con MUT-5.
//
// Los literales de los textos se escriben A MANO, nunca se importan del componente:
// comparar un texto contra la función que lo genera sale verde siempre —lección ya pagada
// en este repo—.

import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PasswordInput } from "@/components/shared/PasswordInput";
import { FormField } from "@/components/shared/FormField";
import { contraste, token } from "../fixtures/contraste";

/** El input del campo, buscado por su etiqueta visible (que es como lo busca todo el repo). */
function inputDe(etiqueta: string): HTMLInputElement {
  return screen.getByLabelText(etiqueta) as HTMLInputElement;
}

// ─────────────────────────────────────────────────────────────────────────────────────
// R5, R6, R7, R8 — arranca oculta y alterna en los DOS sentidos (T5 / M1)
// ─────────────────────────────────────────────────────────────────────────────────────

describe("PasswordInput — arranca oculta y alterna (R5, R6, R7, R8)", () => {
  it("R5/R6/R7: la secuencia del atributo `type` es password -> text -> password", async () => {
    const user = userEvent.setup();
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" defaultValue="" />
      </FormField>,
    );

    const input = inputDe("Contraseña");
    const boton = screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." });

    const secuencia: (string | null)[] = [input.getAttribute("type")];
    await user.click(boton);
    secuencia.push(input.getAttribute("type"));
    await user.click(screen.getByRole("button", { name: "Contraseña: visible. Ocultar." }));
    secuencia.push(input.getAttribute("type"));

    expect(secuencia).toEqual(["password", "text", "password"]);
  });

  it("R6/R7/R8: el valor tecleado sobrevive a las dos pulsaciones y el input NO se reconstruye", async () => {
    const user = userEvent.setup();
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const input = inputDe("Contraseña");
    await user.type(input, "clave-secreta-123");
    expect(input).toHaveValue("clave-secreta-123");

    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("clave-secreta-123");
    // El MISMO nodo: si el componente remontase el input, el valor y el foco se perderían.
    expect(inputDe("Contraseña")).toBe(input);

    await user.click(screen.getByRole("button", { name: "Contraseña: visible. Ocultar." }));
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("clave-secreta-123");
    expect(inputDe("Contraseña")).toBe(input);
  });

  it("R8: tras pulsar, el foco queda en el propio botón (no lo roba nadie)", async () => {
    const user = userEvent.setup();
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const boton = screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." });
    await user.click(boton);

    expect(document.activeElement).toBe(boton);
  });

  it("R5: al volver a montar, vuelve a estar oculta y no se escribió el estado en ningún almacén", async () => {
    const user = userEvent.setup();
    const escrituras: string[] = [];
    const espiaLocal = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((k: string) => {
        escrituras.push(k);
      });

    const { unmount } = render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );
    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(inputDe("Contraseña")).toHaveAttribute("type", "text");
    unmount();

    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );
    expect(inputDe("Contraseña")).toHaveAttribute("type", "password");
    expect(escrituras).toEqual([]);
    expect(document.cookie).not.toMatch(/contrasena|password|visible/i);

    espiaLocal.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// R10, R11, R12 — no envía, se opera con teclado, se deshabilita con su campo (T6 / M2)
// ─────────────────────────────────────────────────────────────────────────────────────

describe("PasswordInput — no envía y se opera con teclado (R10, R11, R12)", () => {
  it("R10: ni el ratón, ni Enter, ni Espacio envían el formulario que lo contiene", async () => {
    const user = userEvent.setup();
    const espiaEnvio = vi.fn((e: React.FormEvent) => e.preventDefault());

    render(
      <form onSubmit={espiaEnvio}>
        <FormField id="password" label="Contraseña">
          <PasswordInput etiqueta="Contraseña" />
        </FormField>
        <button type="submit">Enviar</button>
      </form>,
    );

    const input = inputDe("Contraseña");

    // Ratón.
    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(input).toHaveAttribute("type", "text");

    // Enter, con el botón enfocado.
    screen.getByRole("button", { name: "Contraseña: visible. Ocultar." }).focus();
    await user.keyboard("{Enter}");
    expect(input).toHaveAttribute("type", "password");

    // Espacio, con el botón enfocado.
    screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }).focus();
    await user.keyboard(" ");
    expect(input).toHaveAttribute("type", "text");

    expect(espiaEnvio).not.toHaveBeenCalled();
  });

  it("R11: es un `<button>` nativo con `type=\"button\"` y sin `tabindex`", () => {
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const boton = screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." });
    expect(boton.tagName).toBe("BUTTON");
    expect(boton).toHaveAttribute("type", "button");
    // Ni positivo (rompe el recorrido natural) ni negativo (lo saca del teclado, que es
    // justo lo que esta feature viene a evitar). La primitiva `Button` emite un
    // `tabindex="0"` explícito, y 0 ES el orden natural: la aserción va contra la
    // propiedad del DOM, que vale 0 tanto sin atributo como con `tabindex="0"`, y -1 con
    // la alternativa descartada.
    expect(boton.tabIndex).toBe(0);
  });

  it("R11: Tab desde el campo llega al ojito, y el siguiente Tab al elemento posterior", async () => {
    const user = userEvent.setup();
    render(
      <form>
        <FormField id="password" label="Contraseña">
          <PasswordInput etiqueta="Contraseña" />
        </FormField>
        <button type="submit">Enviar</button>
      </form>,
    );

    const input = inputDe("Contraseña");
    const ojito = screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." });
    const enviar = screen.getByRole("button", { name: "Enviar" });

    input.focus();
    await user.tab();
    expect(ojito).toHaveFocus();
    await user.tab();
    expect(enviar).toHaveFocus();
  });

  it("R12: con el campo deshabilitado el ojito sale deshabilitado y pulsarlo no revela nada", async () => {
    const user = userEvent.setup();
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" disabled />
      </FormField>,
    );

    const input = inputDe("Contraseña");
    const boton = screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." });

    expect(input).toBeDisabled();
    expect(boton).toBeDisabled();

    await user.click(boton);
    expect(input).toHaveAttribute("type", "password");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// R14, R15, R15.1 — nombre accesible y anuncio (T8 / M3)
// ─────────────────────────────────────────────────────────────────────────────────────

describe("PasswordInput — nombre accesible y anuncio (R14, R15, R15.1)", () => {
  it("R14: el nombre accesible dice etiqueta + estado + acción, y CAMBIA al alternar", async () => {
    const user = userEvent.setup();
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const boton = screen.getByRole("button");
    const nombres: string[] = [boton.getAttribute("aria-label") ?? ""];
    await user.click(boton);
    nombres.push(boton.getAttribute("aria-label") ?? "");

    expect(nombres).toEqual([
      "Contraseña: oculta. Mostrar.",
      "Contraseña: visible. Ocultar.",
    ]);
    expect(new Set(nombres).size).toBe(2);
  });

  it("R14: el nombre lleva la etiqueta DE SU campo, así que dos ojitos no se llaman igual", () => {
    render(
      <>
        <FormField id="password" label="Contraseña">
          <PasswordInput etiqueta="Contraseña" />
        </FormField>
        <FormField id="confirmacion" label="Confirmar contraseña">
          <PasswordInput etiqueta="Confirmar contraseña" />
        </FormField>
      </>,
    );

    expect(
      screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmar contraseña: oculta. Mostrar." }),
    ).toBeInTheDocument();
  });

  it("R14: «Nueva contraseña» visible produce su literal exacto", async () => {
    const user = userEvent.setup();
    render(
      <FormField id="reset-password" label="Nueva contraseña">
        <PasswordInput etiqueta="Nueva contraseña" />
      </FormField>,
    );

    await user.click(
      screen.getByRole("button", { name: "Nueva contraseña: oculta. Mostrar." }),
    );
    expect(
      screen.getByRole("button", { name: "Nueva contraseña: visible. Ocultar." }),
    ).toBeInTheDocument();
  });

  it("R14: el icono es `aria-hidden` y no aporta nombre", () => {
    const { container } = render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const icono = container.querySelector("button svg");
    expect(icono).not.toBeNull();
    expect(icono).toHaveAttribute("aria-hidden", "true");
  });

  it("R15: la región viva arranca VACÍA y anuncia el estado ya aplicado", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const region = container.querySelector("[data-contrasena-anuncio]");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toHaveClass("sr-only");
    // Nada que anunciar antes de que la persona actúe.
    expect(region?.textContent).toBe("");

    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(region?.textContent).toBe("Contraseña visible");

    await user.click(screen.getByRole("button", { name: "Contraseña: visible. Ocultar." }));
    expect(region?.textContent).toBe("Contraseña oculta");
  });

  it("R15.1: la región NO lleva `role`; ni `status` ni `alert` aparecen por su culpa", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const region = container.querySelector("[data-contrasena-anuncio]");
    expect(region?.getAttribute("role")).toBeNull();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    // Y tampoco los estrena al cambiar de estado.
    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// R13 — el campo sigue siendo el campo (T9 / M4)
// ─────────────────────────────────────────────────────────────────────────────────────

describe("PasswordInput — el campo sigue siendo el campo (R13)", () => {
  it("R13: como hijo-elemento de `FormField`, la accesibilidad cae en el <input>, no en el envoltorio", () => {
    const { container } = render(
      <FormField id="password" label="Contraseña" error="La contraseña es requerida">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const campo = inputDe("Contraseña");
    expect(campo.tagName).toBe("INPUT");
    expect(campo).toHaveAttribute("id", "password");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAttribute("aria-describedby", "password-error");

    // Y el `aria-describedby` apunta al `FieldError` de verdad.
    const error = container.querySelector("#password-error");
    expect(error?.textContent).toContain("La contraseña es requerida");

    // El envoltorio NO se queda con nada de eso (si se lo quedara, lo de arriba fallaría,
    // pero se afirma explícito porque es EXACTAMENTE la mutación MUT-6).
    const envoltorio = campo.parentElement;
    expect(envoltorio?.getAttribute("id")).toBeNull();
    expect(envoltorio?.getAttribute("aria-describedby")).toBeNull();
  });

  it("R13: como render-prop de `FormField`, misma historia", () => {
    render(
      <FormField id="reset-password" label="Nueva contraseña" error="Muy corta">
        {(control) => <PasswordInput {...control} etiqueta="Nueva contraseña" />}
      </FormField>,
    );

    const campo = inputDe("Nueva contraseña");
    expect(campo.tagName).toBe("INPUT");
    expect(campo).toHaveAttribute("id", "reset-password");
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveAttribute("aria-describedby", "reset-password-error");
  });

  it("R13: el `aria-required` también cae en el <input>", () => {
    // Va aparte porque `required` mete un `*` en el `<label>` y la etiqueta accesible deja
    // de ser exactamente «Contraseña»; el repo ya resuelve este caso por rol
    // (`FormField.test.tsx:167`). Ninguno de los 6 campos del censo lo usa hoy, pero R13
    // exige que la prop llegue igual.
    const { container } = render(
      <FormField id="password" label="Contraseña" required>
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    const campo = container.querySelector("input");
    expect(campo).not.toBeNull();
    expect(campo).toHaveAttribute("id", "password");
    expect(campo).toHaveAttribute("aria-required", "true");
    expect(campo?.parentElement?.getAttribute("aria-required")).toBeNull();
  });

  it("R13: el `ref` llega al <input> y lo enfoca (es como los formularios mueven el foco al error)", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <FormField id="password" label="Contraseña">
        {(control) => <PasswordInput {...control} ref={ref} etiqueta="Contraseña" />}
      </FormField>,
    );

    expect(ref.current).toBe(inputDe("Contraseña"));
    ref.current?.focus();
    expect(inputDe("Contraseña")).toHaveFocus();
  });

  it("R13: `value`, `onChange`, `placeholder` y `name` viajan al <input>", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput
          etiqueta="Contraseña"
          name="password"
          placeholder="Tu contraseña"
          value="abc"
          onChange={onChange}
        />
      </FormField>,
    );

    const campo = inputDe("Contraseña");
    expect(campo).toHaveAttribute("name", "password");
    expect(campo).toHaveAttribute("placeholder", "Tu contraseña");
    expect(campo).toHaveValue("abc");

    await user.type(campo, "d");
    expect(onChange).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// R9 — un ojito por campo, con su propio estado
// ─────────────────────────────────────────────────────────────────────────────────────

describe("PasswordInput — el estado es POR CAMPO (R9)", () => {
  it("R9: revelar uno NO revela el otro, en ninguno de los dos sentidos", async () => {
    const user = userEvent.setup();
    render(
      <>
        <FormField id="password" label="Contraseña">
          <PasswordInput etiqueta="Contraseña" />
        </FormField>
        <FormField id="confirmacion_password" label="Confirmar contraseña">
          <PasswordInput etiqueta="Confirmar contraseña" />
        </FormField>
      </>,
    );

    const primero = inputDe("Contraseña");
    const segundo = inputDe("Confirmar contraseña");

    await user.click(screen.getByRole("button", { name: "Contraseña: oculta. Mostrar." }));
    expect(primero).toHaveAttribute("type", "text");
    expect(segundo).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: "Confirmar contraseña: oculta. Mostrar." }),
    );
    expect(primero).toHaveAttribute("type", "text");
    expect(segundo).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Contraseña: visible. Ocultar." }));
    expect(primero).toHaveAttribute("type", "password");
    expect(segundo).toHaveAttribute("type", "text");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// R16 — contraste del icono, MEDIDO (T7)
// ─────────────────────────────────────────────────────────────────────────────────────

describe("PasswordInput — contraste del icono (R16)", () => {
  // El icono es un indicador NO textual: WCAG 1.4.11 pide 3:1 contra su fondo. El campo
  // es transparente, así que el fondo real es la superficie donde vive: `--background`
  // (login, postulación, recuperación) o `--card` (el modal de alta de usuario).
  const UMBRAL = 3;
  const TINTA = "muted-foreground"; // el token que pinta el icono: `text-muted-foreground`

  it("R16: `text-muted-foreground` pasa de 3:1 en los DOS temas y sobre las DOS superficies", () => {
    const medidas: Array<{ par: string; razon: number }> = [];
    for (const tema of ["claro", "oscuro"] as const) {
      for (const superficie of ["background", "card"] as const) {
        medidas.push({
          par: `${tema}/${superficie}`,
          razon: contraste(token(tema, TINTA), token(tema, superficie)),
        });
      }
    }

    expect(medidas).toHaveLength(4);
    const flojas = medidas.filter((m) => m.razon < UMBRAL);
    expect(
      flojas.map((m) => `${m.par}: ${m.razon.toFixed(2)} < ${UMBRAL}`),
    ).toEqual([]);
  });

  it("R16: el componente pinta el icono con ESE token y no con otro", () => {
    render(
      <FormField id="password" label="Contraseña">
        <PasswordInput etiqueta="Contraseña" />
      </FormField>,
    );

    // Si alguien cambia la clase por un color sin medir, la medición de arriba seguiría
    // verde y no significaría nada: este caso es el que la ata al árbol.
    expect(screen.getByRole("button").className).toContain(`text-${TINTA}`);
  });
});
