// @vitest-environment jsdom
// Feature 211 — el interruptor de tema del encabezado.
//
// Las tres cosas que este test existe para que no se rompan en silencio, porque las tres
// se ven bien en una captura y fallan en uso: que el ciclo VUELVA a «sistema», que la
// eleccion se ESCRIBA en la cookie (si no, la proxima carga vuelve al tema anterior y
// aparece el parpadeo que todo esto evita) y que el estado se ANUNCIE (con tres estados,
// un icono mudo no dice ni en cual estas ni a cual vas).

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TemaToggle } from "@/components/shared/TemaToggle";
import { TemaProvider } from "@/providers/TemaProvider";
import { COOKIE_TEMA, type Tema } from "@/lib/tema/tema";

function montar(temaInicial: Tema = "sistema") {
  return render(
    <TemaProvider temaInicial={temaInicial}>
      <TemaToggle />
    </TemaProvider>,
  );
}

/** La clase del tema que el proveedor estampa en su envoltorio. */
function claseDelEnvoltorio(): string {
  return document.querySelector("[data-tema]")?.className ?? "";
}

function temaDelEnvoltorio(): string | null {
  return document.querySelector("[data-tema]")?.getAttribute("data-tema") ?? null;
}

function cookieTema(): string | undefined {
  return document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_TEMA}=`))
    ?.slice(COOKIE_TEMA.length + 1);
}

beforeEach(() => {
  // jsdom conserva las cookies entre tests: se caducan una a una.
  for (const par of document.cookie.split(";")) {
    const nombre = par.split("=")[0]?.trim();
    if (nombre) document.cookie = `${nombre}=; path=/; max-age=0`;
  }
});

describe("TemaToggle — el ciclo de tres estados", () => {
  it("cicla sistema -> claro -> oscuro y VUELVE a sistema", async () => {
    const user = userEvent.setup();
    montar("sistema");
    const boton = screen.getByRole("button");

    const recorrido = [temaDelEnvoltorio()];
    for (let i = 0; i < 3; i += 1) {
      await user.click(boton);
      recorrido.push(temaDelEnvoltorio());
    }

    expect(recorrido).toEqual(["sistema", "claro", "oscuro", "sistema"]);
  });

  it("estampa la clase que enciende cada tema en el envoltorio", async () => {
    const user = userEvent.setup();
    montar("sistema");
    const boton = screen.getByRole("button");

    expect(claseDelEnvoltorio()).toContain("tema-sistema");
    await user.click(boton);
    expect(claseDelEnvoltorio()).toContain("tema-claro");
    await user.click(boton);
    // `dark` es la clase contra la que se define el variant `dark:` de Tailwind.
    expect(claseDelEnvoltorio().split(" ")).toContain("dark");
  });

  it("el envoltorio no crea caja (`contents`): estampar el tema no cambia el layout", () => {
    montar("oscuro");
    expect(claseDelEnvoltorio().split(" ")).toContain("contents");
  });

  it("arranca en el tema que resolvio el SERVIDOR, no siempre en el por defecto", () => {
    montar("oscuro");
    expect(temaDelEnvoltorio()).toBe("oscuro");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Oscuro");
  });
});

describe("TemaToggle — la eleccion se recuerda", () => {
  it("escribe la eleccion en la cookie en CADA pulsacion", async () => {
    const user = userEvent.setup();
    montar("sistema");
    const boton = screen.getByRole("button");

    expect(cookieTema()).toBeUndefined();
    await user.click(boton);
    expect(cookieTema()).toBe("claro");
    await user.click(boton);
    expect(cookieTema()).toBe("oscuro");
    await user.click(boton);
    expect(cookieTema()).toBe("sistema");
  });

  it("la cookie vale para todo el portal y sobrevive a cerrar la pestana", async () => {
    const user = userEvent.setup();
    montar("sistema");
    await user.click(screen.getByRole("button"));

    // jsdom no expone los atributos al leer `document.cookie`, asi que se espia la
    // escritura: sin `path=/` la preferencia solo valdria en la ruta actual, y sin
    // `max-age` moriria al cerrar la pestana (y volveria el parpadeo al dia siguiente).
    const escrituras: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => descriptor?.get?.call(document) ?? "",
      set: (v: string) => {
        escrituras.push(v);
        descriptor?.set?.call(document, v);
      },
    });
    await user.click(screen.getByRole("button"));
    Object.defineProperty(document, "cookie", descriptor!);

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toContain(`${COOKIE_TEMA}=oscuro`);
    expect(escrituras[0]).toContain("path=/");
    expect(escrituras[0]).toMatch(/max-age=\d{6,}/);
  });
});

describe("TemaToggle — accesibilidad", () => {
  it("el nombre accesible dice en cual estas y a cual vas, en los tres estados", async () => {
    const user = userEvent.setup();
    montar("sistema");
    const boton = screen.getByRole("button");

    const nombres: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      nombres.push(boton.getAttribute("aria-label") ?? "");
      await user.click(boton);
    }

    expect(nombres[0]).toBe("Tema: Sistema. Cambiar a Claro.");
    expect(nombres[1]).toBe("Tema: Claro. Cambiar a Oscuro.");
    expect(nombres[2]).toBe("Tema: Oscuro. Cambiar a Sistema.");
    // No basta con que cambie el icono: el estado tiene que estar en el NOMBRE.
    expect(new Set(nombres).size).toBe(3);
  });

  it("anuncia el estado aplicado por una region viva, y el anuncio CAMBIA al cambiar el tema", async () => {
    const user = userEvent.setup();
    montar("sistema");

    const region = document.querySelector("[data-tema-anuncio]");
    expect(region, "no hay region viva que anuncie el tema").not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    // Sin `role="status"` a proposito: este control esta en toda pagina autenticada y ese
    // rol lo usan los indicadores de carga. Lo que anuncia es `aria-live`.
    expect(region).not.toHaveAttribute("role");
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    const antes = region!.textContent;

    await user.click(screen.getByRole("button"));

    expect(region!.textContent).not.toBe(antes);
    expect(region!.textContent?.toLowerCase()).toContain("claro");
  });

  it("es un <button> nativo: enfocable y operable con teclado (Enter y Espacio)", async () => {
    const user = userEvent.setup();
    montar("sistema");
    const boton = screen.getByRole("button");

    expect(boton.tagName).toBe("BUTTON");
    // `type="button"` explicito: dentro de un formulario, un boton sin tipo envia.
    expect(boton).toHaveAttribute("type", "button");

    await user.tab();
    expect(document.activeElement).toBe(boton);

    await user.keyboard("{Enter}");
    expect(temaDelEnvoltorio()).toBe("claro");
    await user.keyboard(" ");
    expect(temaDelEnvoltorio()).toBe("oscuro");
  });

  it("muestra el estado tambien en texto visible, no solo en un icono", () => {
    montar("oscuro");
    expect(screen.getByText("Oscuro")).toBeInTheDocument();
    // WCAG 2.5.3: la etiqueta visible forma parte del nombre accesible.
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Oscuro");
  });
});
