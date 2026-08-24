// @vitest-environment jsdom
//
// Feature 258 (F6.3) — LA LÍNEA de entregas acumuladas, montada sobre `GraficaLineas`.
// Mapea: R49, R59, R60, R76, R78.
//
// ⚠ NO SE CONSULTA NI UN NODO DEL SVG. `recharts` mide su contenedor y en jsdom mide 0×0, así
// que `ResponsiveContainer` renderiza vacío: afirmar sobre `<path>` o `<circle>` sería un test
// que no mide nada y que además pasaría en verde el día que la curva desapareciera.
//
// Lo que SÍ existe siempre —y por eso es lo que se afirma— son dos cosas del propio paquete:
// el `<h3>` del marco con el título (que es el nombre accesible obligatorio de la región) y la
// alternativa textual de `SerieTextual`, una entrada `<li>` por punto.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ETIQUETA_SERIE_RITMO } from "@/app/(app)/monitoreo/_components/serie-ritmo";
import { TableroDiaTotales } from "@/app/(app)/monitoreo/_components/TableroDiaTotales";
import type { PuntoRitmoEntregas, TotalesTableroDia } from "@/lib/types/tablero-dia";
import { quitarComentarios } from "../fixtures/sin-comentarios";

afterEach(cleanup);

const TOTALES: TotalesTableroDia = {
  asignadas: 10,
  entregadas: 6,
  reprogramadas: 1,
  devueltas: 1,
  rechazadas: 0,
  incidentes: 0,
  sinRecoger: 1,
  enReparto: 1,
  otros: 0,
};

/** Tal cual la produce el servicio: `0..H` sin huecos. */
const serie = (acumulados: readonly number[]): readonly PuntoRitmoEntregas[] =>
  acumulados.map((acumulado, hora) => ({ hora, acumulado }));

const pintar = (ritmo: readonly PuntoRitmoEntregas[]) =>
  render(<TableroDiaTotales totales={TOTALES} ritmoEntregas={ritmo} />);

/** La lista de la alternativa textual, que `SerieTextual` etiqueta con el título. */
const listaTextual = () => screen.queryByRole("list", { name: ETIQUETA_SERIE_RITMO });

describe("Feature 258 · R76 — la línea se REUSA de `GraficaLineas`", () => {
  it("monta la gráfica del paquete: región con nombre accesible y su `<h3>`", () => {
    pintar(serie([0, 2, 5]));

    // `GraficaMarco` pinta `<section aria-label={titulo}><h3>{titulo}</h3>…`.
    const region = screen.getByRole("region", { name: ETIQUETA_SERIE_RITMO });
    expect(region).toBeInTheDocument();
    expect(within(region).getByRole("heading", { level: 3 })).toHaveTextContent(
      ETIQUETA_SERIE_RITMO,
    );
  });

  it("la monta en su PROPIA tarjeta, no dentro del bloque de totales", () => {
    // Con filtro activo la tira dice «Totales de lo filtrado» (R64) y la línea sigue hablando
    // del día ENTERO: meterla bajo ese encabezado volvería a abrir la confusión que R64 cierra.
    pintar(serie([0, 2, 5]));
    const tira = document.querySelector('[data-slot="tablero-dia-totales"]') as HTMLElement;
    const region = screen.getByRole("region", { name: ETIQUETA_SERIE_RITMO });

    expect(tira).not.toBeNull();
    expect(tira.contains(region)).toBe(false);
    expect(document.querySelector('[data-slot="tablero-dia-ritmo"]')?.contains(region)).toBe(
      true,
    );
  });
});

describe("Feature 258 · R60 — la alternativa textual la produce la primitiva", () => {
  it("hay una entrada por punto de la serie, con su hora y su acumulado", () => {
    pintar(serie([0, 2, 5]));

    const lista = listaTextual();
    expect(lista).not.toBeNull();
    const entradas = [...lista!.querySelectorAll("li")].map((li) => li.textContent ?? "");

    expect(entradas).toHaveLength(3);
    expect(entradas[0]).toContain(ETIQUETA_SERIE_RITMO);
    // «Entregas acumuladas, 12 a. m.: 0» — serie, categoría y valor formateado.
    expect(entradas[1]).toMatch(/1\s*a\.\s*m\..*: 2$/);
    expect(entradas[2]).toMatch(/2\s*a\.\s*m\..*: 5$/);
  });

  it("no se escribe a mano: el archivo de la ruta no monta ninguna lista propia", () => {
    // R60 dice literalmente que el sistema NO debe escribirla si la primitiva ya la produce.
    const codigo = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/TableroDiaTotales.tsx"),
        "utf8",
      ),
    );
    expect(codigo).toContain("GraficaLineas");
    expect(codigo).not.toContain("SerieTextual");
    expect(codigo).not.toContain("sr-only");
  });
});

describe("Feature 258 · R59 — un día sin entregas pinta el VACÍO del marco, no una línea", () => {
  it("con todos los acumulados a cero sale el `EmptyState` y NO la lista de puntos", () => {
    // Ésta es la entrada REAL del servicio a media mañana de un día sin entregas: los puntos
    // existen y todos valen 0. Si el adaptador los pasara tal cual, `GraficaLineas` los
    // contaría como datos y pintaría una línea plana a cero.
    pintar(serie([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

    expect(screen.getByText(/Todavía no hay entregas hoy/i)).toBeInTheDocument();
    expect(
      listaTextual(),
      "se pintó la alternativa textual: la gráfica cree que hay datos y está dibujando una " +
        "línea plana a cero (R59)",
    ).toBeNull();
  });

  it("y en cuanto hay una entrega, el vacío desaparece y la curva existe", () => {
    pintar(serie([0, 0, 1]));
    expect(screen.queryByText(/Todavía no hay entregas hoy/i)).toBeNull();
    expect(listaTextual()).not.toBeNull();
  });
});

describe("Feature 258 · R49/R78 — el color y el lienzo son del paquete", () => {
  it("la feature NO pasa color por props ni declara lógica de tema propia", () => {
    const codigo = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/TableroDiaTotales.tsx"),
        "utf8",
      ),
    );
    // `paleta.ts` asigna el color por índice de serie y el color no viaja en las props: si
    // este archivo escribiera uno, sería un segundo catálogo a mano.
    for (const senal of ["color", "stroke", "fill", "chart-", "dark:"]) {
      expect(codigo, `la tira de totales declara \`${senal}\` para la gráfica`).not.toContain(
        senal,
      );
    }
  });

  it("R78 — no importa `recharts` ni nada de `…/analytics/lienzo/`", () => {
    const codigo = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/TableroDiaTotales.tsx"),
        "utf8",
      ),
    );
    expect(codigo).not.toMatch(/from\s+["']recharts["']/);
    expect(codigo).not.toMatch(/analytics\/lienzo\//);
    // El lienzo llega diferido porque lo difiere `GraficaLineas`, no porque aquí se haga nada:
    // se comprueba que la gráfica sigue montándolo con `lazy(() => import(…))`.
    const grafica = readFileSync(
      path.join(process.cwd(), "components/private/analytics/GraficaLineas.tsx"),
      "utf8",
    );
    expect(grafica).toMatch(/lazy\(\s*\(\)\s*=>\s*import\(/);
  });
});

describe("Feature 258 · la línea es una franja de APOYO, no la protagonista", () => {
  it("lleva un techo de ancho, que es lo que le pone techo al alto", () => {
    // Medido en la app: sin techo salía a 371 px, más alta que la tira de totales (251) y que
    // cualquier tarjeta de mensajero (239).
    //
    // ⚠️ El alto NO es medible aquí: jsdom no hace layout. Y no se puede fijar por píxeles,
    // porque el paquete calcula el alto desde la PROPORCIÓN (`aspect-[32/9]`) sobre el ancho.
    // Lo que sí se puede afirmar —y es exactamente lo que decide el alto— es que la gráfica
    // recibe un tope de ancho por su prop `className`: con `max-w-2xl` (672 px) el lienzo mide
    // 672 × 9/32 = 189 px. Sin esta clase, el alto vuelve a ser el ancho de la tarjeta / 3,56.
    pintar(serie([0, 2, 5]));
    const region = screen.getByRole("region", { name: ETIQUETA_SERIE_RITMO });

    const clases = region.className.split(/\s+/);
    expect(
      clases.some((c) => c.startsWith("max-w-")),
      "la gráfica no lleva techo de ancho: su alto vuelve a ser el de la tarjeta entera",
    ).toBe(true);
  });

  it("no se le pisa el alto del lienzo por dentro: el paquete lo prohíbe y sería mudo", () => {
    // La otra forma de bajarla sería una variante arbitraria que alcance el `div` del lienzo
    // dentro del paquete. Se descarta: el día que `GraficaLineas` cambie su estructura, esa
    // clase deja de aplicarse EN SILENCIO y la gráfica vuelve a comerse la pantalla sin que
    // nada se ponga rojo.
    const codigo = quitarComentarios(
      readFileSync(
        path.join(process.cwd(), "app/(app)/monitoreo/_components/TableroDiaTotales.tsx"),
        "utf8",
      ),
    );
    expect(codigo).not.toMatch(/\[&[>_]/);
    expect(codigo).not.toMatch(/\bh-\[\d/);
    expect(codigo).not.toMatch(/aspect-/);
  });

  it("las horas planas del principio no llegan a la alternativa textual", () => {
    // Lo que se recorta en el adaptador tiene que notarse en lo que el usuario recibe, no
    // sólo en el resultado de la función pura.
    pintar(serie([0, 0, 0, 0, 0, 0, 0, 3, 7]));

    const entradas = [...listaTextual()!.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(entradas).toHaveLength(3);
    expect(entradas[0]).toMatch(/: 0$/);
    expect(entradas.at(-1)).toMatch(/: 7$/);
    // Y las horas de madrugada, que eran línea plana, ya no están.
    expect(entradas.some((e) => /12\s*a\.\s*m\./.test(e))).toBe(false);
  });
});
