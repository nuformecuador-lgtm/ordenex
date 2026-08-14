// Feature 211 — el tema como dato puro: interruptor, clases y textos.
// Sin DOM y sin React: lo que estas funciones digan es lo que hace el control.

import { describe, expect, it, afterEach, vi } from "vitest";

import {
  claseDeTema,
  ETIQUETAS_TEMA,
  TEMAS,
  anuncioTema,
  esTema,
  etiquetaAccesibleTema,
  normalizarTema,
  resolverTemaDelSistema,
  siguienteTema,
  suscribirTemaDelSistema,
  type Tema,
} from "@/lib/tema/tema";

describe("tema — DOS elegibles, no tres", () => {
  it("son exactamente «claro» y «oscuro»; «sistema» ya no es un tema", () => {
    expect([...TEMAS]).toEqual(["claro", "oscuro"]);
    expect(esTema("sistema")).toBe(false);
  });

  it("el control es un INTERRUPTOR: cada tema lleva al otro y volver son dos pulsaciones", () => {
    expect(siguienteTema("claro")).toBe("oscuro");
    expect(siguienteTema("oscuro")).toBe("claro");
    for (const inicio of TEMAS) {
      expect(siguienteTema(siguienteTema(inicio)), `desde ${inicio}`).toBe(inicio);
    }
  });

  it("cada estado tiene su clase en globals.css, incluida la de «sin elegir»", () => {
    expect(claseDeTema("oscuro")).toBe("dark");
    expect(claseDeTema("claro")).toBe("tema-claro");
    // `null` NO es un tercer tema: es el HTML de quien nunca eligió. La clase existe para
    // que `prefers-color-scheme` lo resuelva en CSS, sin JS y sin parpadeo.
    expect(claseDeTema(null)).toBe("tema-sistema");
    expect(new Set(TEMAS.map(claseDeTema)).size).toBe(2);
  });
});

describe("tema — sin elección manda el SISTEMA", () => {
  it("un valor ausente o manipulado a mano cae en «sin elegir», no en un tema concreto", () => {
    // Lo que se protege: si esto devolviera «claro», quien tiene el SO en oscuro y una
    // cookie corrupta se quedaría en claro hasta pulsar el control. Devolviendo `null`, el
    // CSS le sigue dando el tema de su sistema.
    expect(normalizarTema(undefined)).toBeNull();
    expect(normalizarTema("")).toBeNull();
    expect(normalizarTema("Oscuro")).toBeNull();
    expect(normalizarTema("<script>")).toBeNull();
    expect(normalizarTema("oscuro")).toBe("oscuro");
    expect(normalizarTema("claro")).toBe("claro");
  });

  it("la cookie «sistema» de la version anterior caduca sola hacia el comportamiento nuevo", () => {
    // Sin migración: el valor viejo deja de ser válido y se lee como «sin elegir», que es
    // justo lo que significaba.
    expect(normalizarTema("sistema")).toBeNull();
  });
});

describe("resolverTemaDelSistema", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
  });

  function conPreferencia(oscuro: boolean) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: vi.fn(() => ({ matches: oscuro })) },
    });
  }

  it("SO en oscuro -> «oscuro»; en cualquier otro caso -> «claro»", () => {
    conPreferencia(true);
    expect(resolverTemaDelSistema()).toBe("oscuro");
    conPreferencia(false);
    expect(resolverTemaDelSistema()).toBe("claro");
  });

  it("consulta EXACTAMENTE `prefers-color-scheme: dark`", () => {
    conPreferencia(true);
    resolverTemaDelSistema();
    const mm = (globalThis.window as unknown as { matchMedia: ReturnType<typeof vi.fn> })
      .matchMedia;
    expect(mm).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
  });

  it("sin `matchMedia` no lanza: cae en «claro»", () => {
    // Navegadores viejos y el propio servidor. Reventar aquí tumbaría el encabezado entero
    // por no poder decidir un color.
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    expect(resolverTemaDelSistema()).toBe("claro");
  });
});

describe("suscribirTemaDelSistema", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis as Record<string, unknown>, "window");
  });

  it("escucha `change` y la baja lo retira: sin eso la suscripcion se acumula por montaje", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: () => ({ matches: false, addEventListener, removeEventListener }) },
    });

    const alCambiar = () => {};
    const baja = suscribirTemaDelSistema(alCambiar);

    expect(addEventListener).toHaveBeenCalledWith("change", alCambiar);
    baja();
    expect(removeEventListener).toHaveBeenCalledWith("change", alCambiar);
  });

  it("sin `matchMedia` devuelve una baja inocua en vez de lanzar", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    expect(() => suscribirTemaDelSistema(() => {})()).not.toThrow();
  });

  it("con un `matchMedia` viejo (sin addEventListener) tampoco lanza", () => {
    // Existieron navegadores con solo `addListener`. Reventar aqui dejaria el portal sin
    // encabezado por no poder escuchar un cambio de color.
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: () => ({ matches: false }) },
    });
    expect(() => suscribirTemaDelSistema(() => {})()).not.toThrow();
  });
});

describe("tema — lo que se anuncia", () => {
  it("el nombre accesible dice en cual estas Y a cual vas", () => {
    for (const tema of TEMAS) {
      const nombre = etiquetaAccesibleTema(tema);
      expect(nombre, `${tema}: no nombra el estado actual`).toContain(ETIQUETAS_TEMA[tema]);
      expect(nombre, `${tema}: no nombra el estado siguiente`).toContain(
        ETIQUETAS_TEMA[siguienteTema(tema)],
      );
      // WCAG 2.5.3: el nombre accesible empieza por la etiqueta VISIBLE del control.
      expect(nombre.indexOf(ETIQUETAS_TEMA[tema])).toBeLessThan(
        nombre.indexOf(ETIQUETAS_TEMA[siguienteTema(tema)]),
      );
    }
  });

  it("el anuncio nombra el estado YA aplicado y es distinto para cada uno", () => {
    const anuncios = TEMAS.map(anuncioTema);
    expect(new Set(anuncios).size).toBe(2);
    for (const tema of TEMAS) {
      expect(anuncioTema(tema).toLowerCase()).toContain(ETIQUETAS_TEMA[tema].toLowerCase());
    }
  });

  it("los dos temas tienen etiqueta y no hay etiqueta huerfana", () => {
    const conEtiqueta = Object.keys(ETIQUETAS_TEMA) as Tema[];
    expect(new Set(conEtiqueta)).toEqual(new Set(TEMAS));
  });
});
