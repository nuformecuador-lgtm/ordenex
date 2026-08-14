// @vitest-environment jsdom
// Feature 211 — el interruptor de tema del encabezado.
//
// Las cosas que este test existe para que no se rompan en silencio, porque todas se ven
// bien en una captura y fallan en uso: que «sistema» NO vuelva a colarse como opcion, que
// sin eleccion previa mande la preferencia del SO, que la eleccion se ESCRIBA en la cookie
// (si no, la proxima carga vuelve al tema anterior y aparece el parpadeo que todo esto
// evita) y que el estado se ANUNCIE.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TemaToggle } from "@/components/shared/TemaToggle";
import { TemaProvider } from "@/providers/TemaProvider";
import { COOKIE_TEMA, type TemaElegido } from "@/lib/tema/tema";

/** Oyentes vivos del `change` de la media query, para poder disparar un cambio de SO. */
let oyentesSO: (() => void)[] = [];
let soEnOscuro = false;

/** jsdom no trae `matchMedia`: sin esto el proveedor no puede resolver «sin elegir». */
function preferenciaDelSO(oscuro: boolean) {
  soEnOscuro = oscuro;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      get matches() {
        return soEnOscuro && query.includes("dark");
      },
      media: query,
      addEventListener: (_evento: string, cb: () => void) => oyentesSO.push(cb),
      removeEventListener: (_evento: string, cb: () => void) => {
        oyentesSO = oyentesSO.filter((o) => o !== cb);
      },
    })),
  });
}

/** Simula que el SO gira su tema con la pestaña abierta (macOS/Windows lo hacen solos). */
function elSOCambiaA(oscuro: boolean) {
  soEnOscuro = oscuro;
  for (const oyente of [...oyentesSO]) oyente();
}

function montar(temaInicial: TemaElegido = null) {
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
  oyentesSO = [];
  preferenciaDelSO(false);
});

describe("TemaToggle — SOLO dos estados", () => {
  it("alterna claro <-> oscuro y vuelve al primero en DOS pulsaciones", async () => {
    const user = userEvent.setup();
    montar("claro");
    const boton = screen.getByRole("button");

    const recorrido = [temaDelEnvoltorio()];
    for (let i = 0; i < 2; i += 1) {
      await user.click(boton);
      recorrido.push(temaDelEnvoltorio());
    }

    expect(recorrido).toEqual(["claro", "oscuro", "claro"]);
  });

  it("«sistema» NO aparece nunca como estado del control", async () => {
    // La regresion que se protege: si alguien repone el tercer estado, el ciclo vuelve a
    // tener dos posiciones que pintan lo mismo y el boton parece roto.
    const user = userEvent.setup();
    montar("claro");
    const boton = screen.getByRole("button");

    const vistos = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      vistos.add(boton.getAttribute("data-tema-actual") ?? "");
      await user.click(boton);
    }

    expect([...vistos].sort()).toEqual(["claro", "oscuro"]);
  });

  it("estampa la clase que enciende cada tema en el envoltorio", async () => {
    const user = userEvent.setup();
    montar("claro");
    const boton = screen.getByRole("button");

    expect(claseDelEnvoltorio()).toContain("tema-claro");
    await user.click(boton);
    // `dark` es la clase contra la que se define el variant `dark:` de Tailwind.
    expect(claseDelEnvoltorio().split(" ")).toContain("dark");
  });

  it("el envoltorio no crea caja (`contents`): estampar el tema no cambia el layout", () => {
    montar("oscuro");
    expect(claseDelEnvoltorio().split(" ")).toContain("contents");
  });

  it("arranca en el tema que resolvio el SERVIDOR, no siempre en el mismo", () => {
    montar("oscuro");
    expect(temaDelEnvoltorio()).toBe("oscuro");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Oscuro");
  });
});

describe("TemaToggle — sin eleccion previa manda el SISTEMA", () => {
  it("con el SO en oscuro, quien nunca eligio acaba en «oscuro»", async () => {
    preferenciaDelSO(true);
    montar(null);

    await waitFor(() => expect(temaDelEnvoltorio()).toBe("oscuro"));
    expect(claseDelEnvoltorio().split(" ")).toContain("dark");
  });

  it("con el SO en claro, acaba en «claro»", async () => {
    preferenciaDelSO(false);
    montar(null);

    await waitFor(() => expect(temaDelEnvoltorio()).toBe("claro"));
  });

  it("resolver la preferencia del SO NO escribe cookie: manana el SO puede cambiar", async () => {
    // Si se guardara, quien nunca eligio quedaria congelado en el tema que tenia el dia que
    // entro por primera vez — exactamente lo que «sin elegir» debe evitar.
    preferenciaDelSO(true);
    montar(null);

    await waitFor(() => expect(temaDelEnvoltorio()).toBe("oscuro"));
    expect(cookieTema()).toBeUndefined();
  });

  it("si el SO gira con la pestana abierta, la app le SIGUE mientras no haya eleccion", async () => {
    // macOS y Windows cambian a oscuro al anochecer. Con una lectura unica al montar, quien
    // no ha elegido se quedaria con el tema que hubiera al abrir la pestana.
    preferenciaDelSO(false);
    montar(null);
    await waitFor(() => expect(temaDelEnvoltorio()).toBe("claro"));

    act(() => elSOCambiaA(true));

    expect(temaDelEnvoltorio()).toBe("oscuro");
  });

  it("una vez ELEGIDO, el SO deja de mandar: la eleccion es la eleccion", async () => {
    const user = userEvent.setup();
    preferenciaDelSO(false);
    montar(null);
    await waitFor(() => expect(temaDelEnvoltorio()).toBe("claro"));

    await user.click(screen.getByRole("button")); // elige oscuro a mano
    expect(temaDelEnvoltorio()).toBe("oscuro");

    act(() => elSOCambiaA(false)); // el SO insiste en claro

    expect(temaDelEnvoltorio()).toBe("oscuro");
  });

  it("la PRIMERA pulsacion va al contrario de lo que se esta VIENDO", async () => {
    // Con el SO en oscuro se ve oscuro, asi que pulsar tiene que llevar a claro. Si el
    // control supusiera «claro» como punto de partida, la primera pulsacion no cambiaria
    // nada visible y pareceria que el boton no responde.
    preferenciaDelSO(true);
    const user = userEvent.setup();
    montar(null);

    await waitFor(() => expect(temaDelEnvoltorio()).toBe("oscuro"));
    await user.click(screen.getByRole("button"));

    expect(temaDelEnvoltorio()).toBe("claro");
    expect(cookieTema()).toBe("claro");
  });
});

describe("TemaToggle — la eleccion se recuerda", () => {
  it("escribe la eleccion en la cookie en CADA pulsacion", async () => {
    const user = userEvent.setup();
    montar("claro");
    const boton = screen.getByRole("button");

    expect(cookieTema()).toBeUndefined();
    await user.click(boton);
    expect(cookieTema()).toBe("oscuro");
    await user.click(boton);
    expect(cookieTema()).toBe("claro");
  });

  it("la cookie vale para todo el portal y sobrevive a cerrar la pestana", async () => {
    const user = userEvent.setup();
    montar("claro");

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
  it("el nombre accesible dice en cual estas y a cual vas, en los DOS estados", async () => {
    const user = userEvent.setup();
    montar("claro");
    const boton = screen.getByRole("button");

    const nombres: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      nombres.push(boton.getAttribute("aria-label") ?? "");
      await user.click(boton);
    }

    expect(nombres[0]).toBe("Tema: Claro. Cambiar a Oscuro.");
    expect(nombres[1]).toBe("Tema: Oscuro. Cambiar a Claro.");
    // No basta con que cambie el icono: el estado tiene que estar en el NOMBRE.
    expect(new Set(nombres).size).toBe(2);
  });

  it("anuncia el estado aplicado por una region viva, y el anuncio CAMBIA al cambiar el tema", async () => {
    const user = userEvent.setup();
    montar("claro");

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
    expect(region!.textContent?.toLowerCase()).toContain("oscuro");
  });

  it("es un <button> nativo: enfocable y operable con teclado (Enter y Espacio)", async () => {
    const user = userEvent.setup();
    montar("claro");
    const boton = screen.getByRole("button");

    expect(boton.tagName).toBe("BUTTON");
    // `type="button"` explicito: dentro de un formulario, un boton sin tipo envia.
    expect(boton).toHaveAttribute("type", "button");

    await user.tab();
    expect(document.activeElement).toBe(boton);

    await user.keyboard("{Enter}");
    expect(temaDelEnvoltorio()).toBe("oscuro");
    await user.keyboard(" ");
    expect(temaDelEnvoltorio()).toBe("claro");
  });

  it("muestra el estado tambien en texto visible, no solo en un icono", () => {
    montar("oscuro");
    expect(screen.getByText("Oscuro")).toBeInTheDocument();
    // WCAG 2.5.3: la etiqueta visible forma parte del nombre accesible.
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Oscuro");
  });
});
