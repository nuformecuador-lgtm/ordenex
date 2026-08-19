// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { BarraComposicionCaja } from "@/app/(app)/wallet/_components/BarraComposicionCaja";
import { CajaResumenCard } from "@/app/(app)/wallet/_components/CajaResumenCard";
import {
  CAJA_COMPOSICION_LABEL,
  CAJA_COMPOSICION_MENSAJE,
  CAJA_RESUMEN_LABEL,
} from "@/app/(app)/wallet/_components/wallet-labels";
import type { CajaResumenDTO } from "@/lib/types/wallet";
import { MODO_COMPOSICION_CAJA_SEED } from "@/lib/types/wallet";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

/**
 * Feature 231 (T4.4) — la barra de composición de la caja y sus CUATRO modos.
 *
 * Lo que esta suite existe para impedir son dos errores concretos:
 *
 *  1. que la pantalla se ponga a DECIDIR cómo se reparte la caja. El modo y el porcentaje los
 *     manda el servidor con aritmética decimal exacta; en cuanto el navegador compare dos
 *     importes o convierta uno a número, el reparto puede discrepar de las cifras que está
 *     pintando al lado (R12/R21).
 *  2. que el caso límite —Ordenex en pérdida, con dinero de las tiendas cubriendo el saldo—
 *     se pinte como si fuera un reparto normal. Ahí no hay dos porciones que enseñar, y una
 *     barra partida sería una mentira sobre dinero ajeno (R16/R20).
 *
 * Los importes del conjunto son DISTINTOS entre sí a propósito: ninguna aserción puede pasar
 * por confundir una cifra con otra.
 */
const RESUMEN: CajaResumenDTO = {
  entradas: "15000.00",
  salidas: "3000.00",
  enCaja: "12000.00",
  signoEnCaja: "positivo",
  ingresosPropios: "5000.00",
  egresosPropios: "3000.00",
  ganancia: "2000.00",
  signoGanancia: "positivo",
  deTerceros: "10000.00",
  periodoFiltrado: false,
  // 10 000 / 12 000 x 100 = 83.333… -> "83.33" (R9/R10, derivado en el servidor).
  porcentajeTiendas: "83.33",
  modoComposicion: "dos_bolsillos",
};

/**
 * Las fuentes de cliente NUEVAS o TOCADAS por esta feature (R12/R39).
 *
 * R12 dice «ninguna fuente de cliente nueva o TOCADA», y el barrido cubría sólo las cuatro
 * nuevas: las otras tres estaban limpias, pero por revisión a mano y no por red (menor 3 de
 * `progress/review_231.md`). Entran las siete. `wallet-labels.ts` no está aquí porque ya la
 * censa el barrido transversal de la 172 (`tests/unit/guards/liquidacion-money-safe.test.ts`),
 * y duplicarlo sería una segunda oportunidad de escribir mal la expresión.
 */
const FUENTES_NUEVAS = [
  // Nuevas
  "app/(app)/wallet/_components/BarraComposicionCaja.tsx",
  "app/(app)/wallet/_components/ComposicionGananciaCard.tsx",
  "app/(app)/wallet/_components/DesgloseEgresosLista.tsx",
  // Tocadas
  "app/(app)/wallet/_components/CajaResumenCard.tsx",
  "app/(app)/wallet/_components/WalletLedger.tsx",
  "app/(app)/wallet/_components/WalletModule.tsx",
  "app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts",
];

function pintarBarra(overrides: Partial<CajaResumenDTO> = {}) {
  return render(<BarraComposicionCaja resumen={{ ...RESUMEN, ...overrides }} />);
}

function pintarTarjeta(overrides: Partial<CajaResumenDTO> = {}) {
  return render(<CajaResumenCard resumen={{ ...RESUMEN, ...overrides }} />);
}

/** Los segmentos PINTADOS de la barra, en orden. */
function segmentos(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-segmento]")];
}

function bolsillo(container: HTMLElement, cual: "tiendas" | "ordenex"): HTMLElement {
  const nodo = container.querySelector<HTMLElement>(`[data-bolsillo="${cual}"]`);
  expect(nodo, `falta el bolsillo de ${cual}`).not.toBeNull();
  return nodo as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("BarraComposicionCaja — el reparto normal (R2/R11/R13)", () => {
  it("R2: la barra pinta los dos segmentos del modo `dos_bolsillos`", () => {
    const { container } = pintarBarra();

    const pintados = segmentos(container);
    expect(pintados).toHaveLength(2);
    expect(pintados.map((s) => s.dataset.segmento)).toEqual(["tiendas", "ordenex"]);
    // Y son la MISMA barra, no dos barras pegadas: los dos cuelgan del elemento con nombre.
    const barra = screen.getByRole("img");
    for (const segmento of pintados) expect(barra.contains(segmento)).toBe(true);
  });

  it("R11: el ancho del segmento es el STRING del DTO y el otro ocupa el resto", () => {
    // Un porcentaje DISTINTO del de la fixture, para que la aserción no pueda pasar por
    // casualidad si alguien fijara un ancho a mano. Con DOS decimales significativos: si
    // alguien lo redondeara o lo pasara por un `Number(`, aquí se vería.
    //
    // (Se elige `41.55` y no `41.50` porque el CSSOM —del navegador y de jsdom— normaliza el
    // valor y se come el cero final: `41.50%` se lee `41.5%`. Eso es del motor de estilos, no
    // del componente, y una aserción sobre el cero final estaría midiendo jsdom.)
    const { container } = pintarBarra({ porcentajeTiendas: "41.55" });
    const [tiendas, ordenex] = segmentos(container);

    // El STRING del servidor entra tal cual dentro de la unidad `%`: sin `Number(`, sin
    // redondeo y sin recomponerlo.
    expect(tiendas.style.width).toBe("41.55%");
    // El segundo NO lleva porcentaje propio (design §6.5): ocupa lo que quede. Con dos
    // porcentajes redondeados por separado, `99.99` abriría un hilo blanco al final de la
    // barra y `100.01` la desbordaría.
    expect(ordenex.style.width).toBe("");
    expect(ordenex.className).toContain("flex-1");
  });

  it("R13: la barra tiene nombre accesible con las dos porciones", () => {
    pintarBarra();

    const barra = screen.getByRole("img");
    const nombre = barra.getAttribute("aria-label") ?? "";
    // Las DOS porciones, cada una con su rótulo y su importe: quien no ve la barra oye lo
    // mismo que enseña.
    expect(nombre).toContain(`${CAJA_COMPOSICION_LABEL.tiendas}: ₡10.000`);
    expect(nombre).toContain(`${CAJA_COMPOSICION_LABEL.ordenex}: ₡2.000`);
    // Se compone con las etiquetas de la pantalla, no con un texto paralelo.
    expect(nombre).toContain(CAJA_COMPOSICION_LABEL.barra);
    // Y el nombre SIGUE a los importes: otro DTO, otro nombre.
    cleanup();
    pintarBarra({ deTerceros: "777.00", ganancia: "111.00" });
    const otro = screen.getByRole("img").getAttribute("aria-label") ?? "";
    expect(otro).toContain("₡777");
    expect(otro).not.toContain("₡10.000");
  });
});

describe("BarraComposicionCaja — los dos bolsillos (R3/R5)", () => {
  it("R3: cada bolsillo muestra su importe y su explicación", () => {
    const { container } = pintarTarjeta();

    const tiendas = bolsillo(container, "tiendas");
    expect(within(tiendas).getByText("₡10.000")).toBeInTheDocument();
    expect(within(tiendas).getByText(CAJA_COMPOSICION_LABEL.tiendas)).toBeInTheDocument();
    // Su explicación es la advertencia de la 173, con su enlace: esa cifra NO es la deuda.
    expect(within(tiendas).getByRole("note").textContent ?? "").toMatch(
      /no es lo que se les debe/i,
    );
    expect(within(tiendas).getByRole("link")).toHaveAttribute("href", "/wallet/tiendas");

    const ordenex = bolsillo(container, "ordenex");
    expect(within(ordenex).getByText("₡2.000")).toBeInTheDocument();
    expect(within(ordenex).getByText(CAJA_COMPOSICION_LABEL.ordenex)).toBeInTheDocument();
    expect(
      within(ordenex).getByText(CAJA_RESUMEN_LABEL.gananciaPista),
    ).toBeInTheDocument();

    // Y ninguno lleva dentro el importe del otro: son hermanos, no uno dentro de otro.
    expect(within(tiendas).queryByText("₡2.000")).toBeNull();
    expect(within(ordenex).queryByText("₡10.000")).toBeNull();
  });

  it("R5: el bloque de Ordenex es neutro salvo en el caso límite", () => {
    const { container } = pintarTarjeta();
    const normal = bolsillo(container, "ordenex");
    expect(normal.dataset.superficie).toBe("neutra");
    // DESIGN.md reserva el acento para acción y estado: una ganancia normal no es ninguna de
    // las dos, y pintarla de color la convertiría en una alarma permanente.
    expect(normal.className).not.toContain("danger");
    expect(normal.className).not.toContain("success");
    cleanup();

    const limite = pintarTarjeta({
      ganancia: "-500.00",
      signoGanancia: "negativo",
      modoComposicion: "solo_tiendas",
      porcentajeTiendas: "100.00",
    });
    const peligro = bolsillo(limite.container, "ordenex");
    expect(peligro.dataset.superficie).toBe("peligro");
    // El color sale de los TOKENS de `danger`, con sus tres roles (R39).
    expect(peligro.className).toContain("bg-danger-soft");
    expect(peligro.className).toContain("dark:bg-danger/15");
  });
});

describe("BarraComposicionCaja — cuando la barra no se puede partir (R16/R18/R20)", () => {
  it("R16: `solo_tiendas`: un solo segmento y el bloque de Ordenex en peligro", () => {
    const { container } = pintarTarjeta({
      ganancia: "-500.00",
      signoGanancia: "negativo",
      modoComposicion: "solo_tiendas",
      porcentajeTiendas: "100.00",
    });

    // UN segmento, el de las tiendas, y la barra entera con el color de aviso.
    const pintados = segmentos(container);
    expect(pintados).toHaveLength(1);
    expect(pintados[0].dataset.segmento).toBe("tiendas");
    expect(pintados[0].className).toContain("bg-warning");
    expect(pintados[0].className).toContain("w-full");
    expect(pintados[0].style.width).toBe("");

    // Y lo dice con todas sus letras, dentro del bloque de Ordenex.
    const ordenex = bolsillo(container, "ordenex");
    const nota = within(ordenex).getByRole("note");
    const mensaje = nota.textContent ?? "";
    expect(mensaje).toMatch(/dinero de las tiendas/i);
    expect(mensaje).toMatch(/cubriendo/i);
    expect(mensaje).toBe(CAJA_COMPOSICION_MENSAJE.solo_tiendas);
    // Éste SÍ es un estado que avisar, y va en el tono de peligro.
    expect(nota.className).toContain("text-danger-strong");
  });

  it("R18: nada que repartir → `sin_reparto`, sin porcentaje", () => {
    const { container } = pintarTarjeta({
      ganancia: "0.00",
      signoGanancia: "cero",
      deTerceros: "0.00",
      enCaja: "0.00",
      signoEnCaja: "cero",
      modoComposicion: "sin_reparto",
      porcentajeTiendas: "0.00",
    });

    // La pista neutra, vacía: ni un segmento que sugiera un reparto que no existe.
    expect(segmentos(container)).toHaveLength(0);
    expect(screen.getByRole("img").className).toContain("bg-muted");

    const nota = within(bolsillo(container, "ordenex")).getByRole("note");
    expect(nota.textContent).toBe(CAJA_COMPOSICION_MENSAJE.sin_reparto);
    // INFORMATIVO, no alarma: `DESIGN.md` reserva el semántico para acción y estado, y un rojo
    // permanente en un estado normal deja de leerse como aviso el día que el aviso existe.
    expect(nota.className).toContain("text-muted-foreground");
    expect(nota.className).not.toContain("danger");
  });

  it("R17 (D4): `solo_ordenex` pinta la barra entera de Ordenex y el bolsillo de las tiendas en negativo", () => {
    // El espejo: se entregó a las tiendas más contra-entrega del que se cobró.
    const { container } = pintarTarjeta({
      deTerceros: "-800.00",
      modoComposicion: "solo_ordenex",
      porcentajeTiendas: "0.00",
    });

    const pintados = segmentos(container);
    expect(pintados).toHaveLength(1);
    expect(pintados[0].dataset.segmento).toBe("ordenex");
    expect(pintados[0].className).toContain("w-full");

    // El bolsillo de las tiendas sigue enseñando SU importe, con su signo y su explicación.
    const tiendas = bolsillo(container, "tiendas");
    expect(within(tiendas).getByText("-₡800")).toBeInTheDocument();
    expect(within(tiendas).getByRole("note").textContent ?? "").toMatch(
      /no es lo que se les debe/i,
    );
    const nota = within(bolsillo(container, "ordenex")).getByRole("note");
    expect(nota.textContent).toBe(CAJA_COMPOSICION_MENSAJE.solo_ordenex);
    // También informativo: explica por qué la barra no se parte, no avisa de nada malo.
    expect(nota.className).toContain("text-muted-foreground");
    expect(nota.className).not.toContain("danger");
  });

  it("R20: fuera de `dos_bolsillos` no hay dos segmentos ni porcentaje", () => {
    const otros = MODO_COMPOSICION_CAJA_SEED.filter((m) => m !== "dos_bolsillos");
    // Control de no-vacuidad: si el SEED se quedara con un solo modo, el bucle no miraría nada.
    expect(otros).toHaveLength(3);

    for (const modo of otros) {
      const { container } = pintarTarjeta({
        modoComposicion: modo,
        // Un porcentaje NO trivial a propósito: si la pantalla lo pintara igualmente fuera de
        // `dos_bolsillos`, esta aserción lo caza.
        porcentajeTiendas: "64.20",
      });

      expect(segmentos(container).length, `${modo} pinta más de un segmento`).toBeLessThan(2);
      // Ni un porcentaje enunciado en ninguna parte de lo que se lee…
      expect(container.textContent ?? "", `${modo} enuncia un porcentaje`).not.toContain("%");
      expect(container.textContent ?? "").not.toContain("64.20");
      // …ni escondido en el ancho de un segmento.
      for (const nodo of container.querySelectorAll<HTMLElement>("[style]")) {
        expect(nodo.getAttribute("style"), `${modo} mide un ancho`).not.toContain("%");
      }
      cleanup();
    }
  });

  it("los CUATRO modos se pintan, uno por conjunto", () => {
    // El `Record` de la barra es TOTAL: ningún modo del catálogo cae en un `default` mudo.
    const cuantos: Record<string, number> = {};
    for (const modo of MODO_COMPOSICION_CAJA_SEED) {
      const { container } = pintarBarra({ modoComposicion: modo });
      cuantos[modo] = segmentos(container).length;
      // La barra existe y tiene nombre en los cuatro casos.
      expect(screen.getByRole("img").getAttribute("aria-label") ?? "").not.toBe("");
      cleanup();
    }
    expect(cuantos).toEqual({
      dos_bolsillos: 2,
      solo_tiendas: 1,
      solo_ordenex: 1,
      sin_reparto: 0,
    });
  });
});

describe("BarraComposicionCaja — el modo lo decide el SERVIDOR (R21)", () => {
  it("la tarjeta no compara importes: el modo llega del DTO", () => {
    // CONTRAPRUEBA: los MISMOS importes, dos modos distintos, dos pantallas distintas. Si la
    // pantalla dedujera el modo de `ganancia`/`deTerceros`/`signoGanancia`, los dos renders
    // serían idénticos y este caso no podría distinguirlos.
    const importes = {
      enCaja: "12000.00",
      ganancia: "2000.00",
      deTerceros: "10000.00",
      signoGanancia: "positivo" as const,
      porcentajeTiendas: "83.33",
    };

    const partida = pintarTarjeta({ ...importes, modoComposicion: "dos_bolsillos" });
    expect(segmentos(partida.container)).toHaveLength(2);
    expect(bolsillo(partida.container, "ordenex").dataset.superficie).toBe("neutra");
    cleanup();

    const entera = pintarTarjeta({ ...importes, modoComposicion: "solo_tiendas" });
    expect(segmentos(entera.container)).toHaveLength(1);
    expect(bolsillo(entera.container, "ordenex").dataset.superficie).toBe("peligro");

    // Y la fuente no tiene por dónde deducirlo: ni deriva las cifras ni compara importes.
    for (const ruta of [
      "app/(app)/wallet/_components/BarraComposicionCaja.tsx",
      "app/(app)/wallet/_components/CajaResumenCard.tsx",
    ]) {
      const fuente = codigoSinComentarios(ruta);
      expect(fuente, `${ruta} deriva la caja`).not.toMatch(/derivarCaja|derivarBalance/);
      expect(fuente).toContain("modoComposicion");
    }
  });
});

describe("BarraComposicionCaja — money-safe y color por token (R12/R39)", () => {
  it("R12: ninguna fuente nueva tiene forma de operar con dinero", () => {
    // Control de no-vacuidad: el barrido mira archivos que existen y tienen código.
    expect(FUENTES_NUEVAS.length).toBe(7);

    for (const ruta of FUENTES_NUEVAS) {
      const fuente = codigoSinComentarios(ruta);
      expect(fuente.length, `${ruta} está vacío`).toBeGreaterThan(500);
      for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        expect(fuente, `${ruta} llama a ${prohibida}`).not.toMatch(prohibida);
      }
      // Sin biblioteca de decimales y sin conversión a número, en el cliente solo queda pintar.
      expect(fuente, `${ruta} importa una biblioteca de decimales`).not.toMatch(
        /from\s+"@prisma\/client"|from\s+"decimal\.js"/,
      );
    }
  });

  it("R39: sin hex ni utilidades de paleta ad-hoc en las fuentes nuevas", () => {
    const HEX = /#[0-9a-fA-F]{3,8}\b/;
    const ARBITRARIO = /\[#/;
    const PALETA =
      /\b(?:bg|text|border|from|via|to|ring|outline|fill|stroke|decoration|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

    // AUTO-COMPROBACIÓN: el detector caza lo que dice cazar. Sin esto, tres expresiones mal
    // escritas dejarían el barrido pasando por no encontrar NADA.
    const falso = `const mala = "text-[#065f46] bg-emerald-600 border-red-500";`;
    expect(HEX.test(falso)).toBe(true);
    expect(ARBITRARIO.test(falso)).toBe(true);
    expect(PALETA.test(falso)).toBe(true);
    expect(PALETA.test("bg-warning-soft dark:bg-danger/15 text-muted-foreground")).toBe(false);

    for (const ruta of FUENTES_NUEVAS) {
      const fuente = codigoSinComentarios(ruta);
      expect(fuente, `${ruta} lleva un hex suelto`).not.toMatch(HEX);
      expect(fuente, `${ruta} lleva un color arbitrario`).not.toMatch(ARBITRARIO);
      expect(fuente, `${ruta} lleva una utilidad de paleta ad-hoc`).not.toMatch(PALETA);
    }
  });

  it("R39: y todo lo interactivo lleva el anillo de foco estándar", () => {
    // La tarjeta no tiene controles (R8), pero sí un enlace: el único elemento enfocable de
    // esta mitad de la pantalla no puede quedarse sin su estado de foco.
    const { container } = pintarTarjeta();
    const enlace = within(bolsillo(container, "tiendas")).getByRole("link");
    expect(enlace.className).toContain("focus-visible:ring-3");
    expect(enlace.className).toContain("focus-visible:ring-ring/50");
  });
});
