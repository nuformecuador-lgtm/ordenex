// @vitest-environment jsdom
//
// `components/shared/KpiValorAnimado` — el test propio que NO tenia (feature 130,
// R37). Hasta hoy su unica red eran los tests de sus dos consumidores
// (`MisAsignacionesPage` y `CierresAdminModule`), es decir cobertura indirecta de
// otras dos pantallas. Este archivo se escribio ANTES de tocar el componente,
// contra su comportamiento de entonces: un test escrito despues del cambio solo
// certifica el cambio, no lo que habia.
//
// `react-countup` esta mockeado globalmente (`tests/setup/jest-dom.ts`) y renderiza
// `formattingFn(end)`: lo que se verifica aqui es la CIFRA que el KPI muestra, no
// que la anime. Desde la feature 230 este archivo instala su PROPIO doble, que
// hace lo mismo y ademas guarda las props (ver abajo): `decimals` es lo que R14
// afirma y el doble del setup no lo deja ver.

import { readFileSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../fixtures/sin-comentarios";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { KpiValorAnimado } from "@/components/shared/KpiValorAnimado";
import { formatMonto, monedaConfig } from "@/lib/config/moneda";

/**
 * El doble de `react-countup` de `tests/setup/jest-dom.ts` se sustituye por otro
 * que hace LO MISMO —renderizar `formattingFn(end)`— y ademas GUARDA las props.
 *
 * Hace falta para la feature 230 (R14): lo que hay que afirmar es el `decimals`
 * que recibe el contador, y el doble del setup lo ignora. Sin esto, el unico modo
 * de medirlo seria mirar el fuente, que no es medir lo que llega al componente.
 */
const { propsDeCountUp } = vi.hoisted(() => ({
  propsDeCountUp: [] as { end: number; decimals?: number; formattingFn?: (n: number) => string }[],
}));

vi.mock("react-countup", () => ({
  default: (props: { end: number; decimals?: number; formattingFn?: (n: number) => string }) => {
    propsDeCountUp.push(props);
    return props.formattingFn ? props.formattingFn(props.end) : String(props.end);
  },
}));

/** `Intl` usa espacio duro (U+00A0); testing-library normaliza el DOM, no el esperado. */
const norm = (texto: string) => texto.replace(/\s/g, " ");

/** El mismo formato de enteros que usa el componente, derivado de la configuracion. */
const miles = (n: number) =>
  new Intl.NumberFormat(monedaConfig.locale, { maximumFractionDigits: 0 }).format(n);

beforeEach(() => {
  propsDeCountUp.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("KpiValorAnimado (R35, R37)", () => {
  it("sin moneda muestra el entero con separadores de miles y sin decimales", () => {
    render(<KpiValorAnimado value={3500} />);

    expect(
      screen.getByText(
        norm(new Intl.NumberFormat(monedaConfig.locale, { maximumFractionDigits: 0 }).format(3500)),
      ),
    ).toBeInTheDocument();
  });

  it("el valor en moneda usa lib/config/moneda y el archivo no tiene simbolo literal", () => {
    render(<KpiValorAnimado value={3500} moneda />);

    // El esperado se DERIVA de la configuracion: si manana cambia la moneda, el
    // test sigue midiendo el requisito y no el colon de hoy.
    expect(screen.getByText(norm(formatMonto(3500)))).toBeInTheDocument();

    const fuente = quitarComentarios(
      readFileSync(path.join(process.cwd(), "components", "shared", "KpiValorAnimado.tsx"), "utf8"),
    );
    expect(fuente).not.toMatch(/["'`][^"'`]*[₡$€£][^"'`]*["'`]/);
    expect(fuente).not.toMatch(/\b(?:CRC|USD|EUR)\b/);
    expect(fuente).not.toMatch(/["']es-[A-Z]{2}["']/);
  });

  it("un valor nulo, indefinido o no numerico se muestra como cero y no rompe", () => {
    const { rerender } = render(<KpiValorAnimado value={null} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<KpiValorAnimado value={undefined} />);
    expect(screen.getByText("0")).toBeInTheDocument();

    rerender(<KpiValorAnimado value="no es un numero" />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("acepta un valor numerico en texto", () => {
    render(<KpiValorAnimado value="1500" />);

    expect(
      screen.getByText(
        norm(new Intl.NumberFormat(monedaConfig.locale, { maximumFractionDigits: 0 }).format(1500)),
      ),
    ).toBeInTheDocument();
  });

  it("conserva su clase base y admite una clase adicional", () => {
    const { container } = render(<KpiValorAnimado value={1} className="text-lg" />);

    const span = container.querySelector("span");
    expect(span?.className).toContain("tabular-nums");
    expect(span?.className).toContain("text-lg");
  });
});

// Feature 198 — las dos puertas que se le añadieron para la landing publica. Ninguna de las
// dos altera el comportamiento por defecto: los KPI del portal y de los cierres no pasan
// `prefijo`, `animarAlSerVisible` ni `arrancarEnCero`, y los casos de arriba lo comprueban.
describe("KpiValorAnimado — prefijo y puerta de visibilidad (feature 198)", () => {
  /** Doble de `IntersectionObserver`: jsdom no lo implementa y hay que poder dispararlo. */
  class ObservadorFalso {
    static avisar: ((entradas: { isIntersecting: boolean }[]) => void) | null = null;
    constructor(cb: (entradas: { isIntersecting: boolean }[]) => void) {
      ObservadorFalso.avisar = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  const conObservador = (fn: () => void) => {
    const previo = globalThis.IntersectionObserver;
    Object.assign(globalThis, { IntersectionObserver: ObservadorFalso });
    try {
      fn();
    } finally {
      Object.assign(globalThis, { IntersectionObserver: previo });
      ObservadorFalso.avisar = null;
    }
  };

  it("el prefijo viaja DENTRO del formateo, pegado al numero", () => {
    render(<KpiValorAnimado value={120} prefijo="+" />);

    expect(screen.getByText("+120")).toBeInTheDocument();
  });

  it("con `animarAlSerVisible` no cuenta hasta que el bloque entra en pantalla", () => {
    // La banda de la landing está por debajo del pliegue: si contara al montar, la animación
    // se gastaría con nadie mirando. Antes esto lo hacía el scroll spy de countup.js, que
    // ademas de no llegar a montar su observador imprimía «[CountUp] target is null».
    conObservador(() => {
      render(<KpiValorAnimado value={3500} prefijo="+" animarAlSerVisible />);

      // Fuera de pantalla: el 0, no la cifra.
      expect(screen.getByText("+0")).toBeInTheDocument();

      act(() => ObservadorFalso.avisar?.([{ isIntersecting: true }]));

      expect(screen.getByText(norm(`+${miles(3500)}`))).toBeInTheDocument();
    });
  });

  it("sin `IntersectionObserver` NO se queda congelado en 0", () => {
    // Degradación deliberada: más vale animar de más que dejar una cifra muerta en 0.
    //
    // El observador se BORRA a mano en vez de confiar en jsdom: `tests/setup/jest-dom.ts` ya
    // instala uno inerte para embla-carousel, así que sin este borrado el caso mediría
    // «observador que nunca avisa» —que es otro escenario— y pasaría por el motivo contrario.
    const previo = globalThis.IntersectionObserver;
    // @ts-expect-error se retira a proposito para simular un navegador que no lo trae
    delete globalThis.IntersectionObserver;
    try {
      render(<KpiValorAnimado value={3500} prefijo="+" animarAlSerVisible />);

      expect(screen.getByText(norm(`+${miles(3500)}`))).toBeInTheDocument();
    } finally {
      Object.assign(globalThis, { IntersectionObserver: previo });
    }
  });
});

// ---------------------------------------------------------------------------
// Feature 230 (R14) — en modo moneda el contador anima con CERO decimales.
// ---------------------------------------------------------------------------
describe("KpiValorAnimado — el dinero se anima sin centimos (230/R14)", () => {
  /**
   * El separador decimal CONFIGURADO seguido de un digito: lo que ningun
   * fotograma puede emitir. Va dentro de una clase de caracteres para no tener
   * que escaparlo, y se lee de `monedaConfig` en vez de escribir la coma a mano.
   */
  const CON_DECIMAL = new RegExp(`[${monedaConfig.separadorDecimal}]\\d`);

  /** Las props con las que se monto el contador en el ultimo render. */
  function ultimasProps() {
    const props = propsDeCountUp.at(-1);
    if (props === undefined) throw new Error("el contador no llego a montarse");
    return props;
  }

  it("en modo moneda el contador recibe 0 decimales, no 2", () => {
    // `decimals` no gobierna el texto —de eso se ocupa `formattingFn`— sino el
    // VALOR de cada fotograma. Con 2 el contador seguiria recalculando centimos
    // durante toda la animacion para una cifra que ya no los muestra.
    render(<KpiValorAnimado value={3500.75} moneda />);

    expect(ultimasProps().decimals).toBe(0);
  });

  it("el modo NO moneda sigue en 0, como siempre", () => {
    render(<KpiValorAnimado value={3500.75} />);

    expect(ultimasProps().decimals).toBe(0);
  });

  // 2026-08-19 — la resolucion de la cuenta (`decimales`). countup.js redondea el valor de
  // CADA FOTOGRAMA a `decimals` antes de formatearlo, asi que una cifra que vive entre 0 y 1
  // —un porcentaje que llega como fraccion— no cuenta con los 0 de siempre: todos sus
  // fotogramas valen 0 y la cifra salta de golpe. Estos dos casos fijan la puerta y su tope.
  it("la resolucion pedida llega al contador tal cual", () => {
    render(<KpiValorAnimado value={0.842} decimales={3} />);

    expect(ultimasProps().decimals).toBe(3);
  });

  it("el dinero IGNORA la resolucion pedida y se queda en 0 (R14)", () => {
    // La puerta no puede servir de rendija para devolver los centimos al contador de dinero:
    // el texto ya no los muestra y recalcularlos en cada fotograma es trabajo invisible.
    render(<KpiValorAnimado value={3500.75} moneda decimales={2} />);

    expect(ultimasProps().decimals).toBe(0);
  });

  it("ningun fotograma —inicial, intermedio o final— lleva parte decimal", () => {
    // Se recorre el formateador REAL que el componente le pasa al contador, con
    // el 0 del arranque, un valor intermedio y el final: es lo que el usuario ve
    // pasar por pantalla, no solo la cifra en la que se detiene.
    render(<KpiValorAnimado value={13331832.72} moneda />);
    const { formattingFn, end } = ultimasProps();
    if (formattingFn === undefined) throw new Error("el contador se monto sin formattingFn");

    for (const fotograma of [0, end / 3, end / 2, end * 0.99, end]) {
      expect(formattingFn(fotograma), `fotograma ${fotograma}`).not.toMatch(CON_DECIMAL);
    }
    expect(formattingFn(end)).toBe(formatMonto(13331832.72));
  });

  it("el texto final en moneda es el del formateador compartido, sin cola", () => {
    render(<KpiValorAnimado value={3500.75} moneda />);

    expect(screen.getByText(norm(formatMonto(3500.75)))).toBeInTheDocument();
    expect(screen.getByText(norm("₡3.501"))).toBeInTheDocument();
  });
});

/* ========================================================================== */
/* Formateador propio y `prefers-reduced-motion` (2026-08-19)                  */
/* ========================================================================== */

describe("KpiValorAnimado — formateo propio y movimiento reducido", () => {
  // El formateador propio es lo que permite montar este contador en los KPI de analítica, cuyo
  // texto no es ni un monto ni un entero pelado: lo decide la UNIDAD de la métrica.
  it("el formateador propio gobierna TODOS los fotogramas, no solo el último", () => {
    const formatear = (n: number) => `${Math.round(n)} %`;
    render(<KpiValorAnimado value={45} formatear={formatear} />);

    const props = propsDeCountUp.at(-1);
    if (props === undefined) throw new Error("el contador no llego a montarse");
    const { formattingFn, end } = props;
    if (formattingFn === undefined) throw new Error("el contador se monto sin formattingFn");
    expect(formattingFn(0)).toBe("0 %");
    expect(formattingFn(end)).toBe("45 %");
    expect(screen.getByText("45 %")).toBeInTheDocument();
  });

  // Gana sobre `moneda`: quien pasa su formateador lo pasa entero, y media mezcla de los dos
  // produciría un texto que no es ninguno de los dos.
  it("el formateador propio gana sobre el modo moneda", () => {
    render(<KpiValorAnimado value={3500} moneda formatear={(n) => `${n} ordenes`} />);

    expect(screen.getByText("3500 ordenes")).toBeInTheDocument();
  });

  // R28 de la 130. Y lo que se ve NO es un cero congelado: es la cifra final puesta de una vez.
  // Perder la animación es lo pedido; perder el dato sería un fallo.
  it("con `prefers-reduced-motion` no monta el contador y pinta la cifra final", () => {
    const original = window.matchMedia;
    window.matchMedia = ((consulta: string) =>
      ({
        matches: consulta.includes("prefers-reduced-motion"),
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    try {
      render(<KpiValorAnimado value={3500} formatear={(n) => `${n} ordenes`} />);

      // Ni un solo montaje del contador: la cuenta la lleva `requestAnimationFrame` y ninguna
      // regla CSS podría detenerla, así que el corte tiene que ser este.
      expect(propsDeCountUp).toHaveLength(0);
      expect(screen.getByText("3500 ordenes")).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
