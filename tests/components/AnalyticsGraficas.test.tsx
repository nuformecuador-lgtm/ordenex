// @vitest-environment jsdom
//
// Graficas del paquete de analitica (feature 130): R5-R11, R28, R31, R33 y la
// UNICA asercion admisible sobre el lienzo (R41).
//
// POR QUE NINGUNA ASERCION MIRA EL SVG (R41, design.md §6.2.1): el stub global de
// `ResizeObserver` (`tests/setup/jest-dom.ts`) tiene `observe(){}` VACIO, asi que
// `ResponsiveContainer` de recharts no lanza — renderiza VACIO. Un
// `expect(container.querySelector("svg")).toBeNull()` pasaria siempre, monte el
// componente su lienzo o no: cobertura cero con luz verde. Por eso el contenido se
// afirma sobre la alternativa textual (R10) y el lienzo se sustituye por un doble
// LOCAL (`vi.mock`, nunca el setup global, design.md §6.3) que solo sirve para
// responder "¿se intenta montar?". Esa unica asercion tiene comprobacion de
// mutacion registrada en `progress/impl_130.md` (T4.5).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { GraficaBarras } from "@/components/private/analytics/GraficaBarras";
import { GraficaDonut } from "@/components/private/analytics/GraficaDonut";
import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { MAX_PUNTOS_SERIE } from "@/components/private/analytics/topes";
import { SIN_MONTO } from "@/lib/config/moneda";

vi.mock("@/components/private/analytics/lienzo/BarrasLienzo", () => ({
  default: () => <div data-testid="lienzo-barras" />,
}));
vi.mock("@/components/private/analytics/lienzo/LineasLienzo", () => ({
  default: () => <div data-testid="lienzo-lineas" />,
}));
vi.mock("@/components/private/analytics/lienzo/DonutLienzo", () => ({
  default: () => <div data-testid="lienzo-donut" />,
}));

const VACIO = { titulo: "Sin datos en el rango", descripcion: "Prueba con otro rango de fechas" };

const serie = (id: string, puntos: readonly (number | null)[]) => ({
  id,
  etiqueta: `Serie ${id}`,
  puntos: puntos.map((valor, i) => ({ categoria: `dia-${i}`, valor })),
});

const GRAFICAS = [
  ["GraficaBarras", GraficaBarras, "lienzo-barras"],
  ["GraficaLineas", GraficaLineas, "lienzo-lineas"],
  ["GraficaDonut", GraficaDonut, "lienzo-donut"],
] as const;

afterEach(() => {
  cleanup();
});

describe("estados de las graficas (R5-R8, R25)", () => {
  it.each(GRAFICAS)("%s con serie vacia muestra el estado vacio y no el lienzo", async (_n, Grafica, testId) => {
    render(<Grafica titulo="Entregas" series={[]} unidad="conteo" vacio={VACIO} />);

    expect(screen.getByText(VACIO.titulo)).toBeInTheDocument();
    expect(screen.getByText(VACIO.descripcion)).toBeInTheDocument();
    expect(screen.queryByTestId(testId)).toBeNull();
    // R25: el vacio de la grafica NO repite el del shell de la 129.
    expect(screen.queryByText(/entrega posterior/i)).toBeNull();
  });

  it.each(GRAFICAS)("%s mientras carga muestra skeleton y anuncia el estado una sola vez", (_n, Grafica, testId) => {
    render(
      <Grafica titulo="Entregas" series={[serie("a", [1, 2])]} unidad="conteo" vacio={VACIO} cargando />,
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.queryByText(VACIO.titulo)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(GRAFICAS)("%s con error muestra el mensaje en un role=alert y nada mas", (_n, Grafica, testId) => {
    render(
      <Grafica titulo="Entregas" series={[serie("a", [1])]} unidad="conteo" vacio={VACIO} error="No se pudo consultar" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo consultar");
    expect(screen.queryByTestId(testId)).toBeNull();
    expect(screen.queryByText(VACIO.titulo)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each(GRAFICAS)("%s con error y carga simultaneos gana el error", (_n, Grafica) => {
    render(
      <Grafica titulo="Entregas" series={[]} unidad="conteo" vacio={VACIO} cargando error="Falla" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Falla");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(VACIO.titulo)).toBeNull();
  });
});

describe("nombre accesible y alternativa textual (R9, R10, R11)", () => {
  it.each(GRAFICAS)("%s toma su nombre accesible del titulo recibido", (_n, Grafica) => {
    render(<Grafica titulo="Tasa de entrega" series={[serie("a", [1])]} unidad="conteo" vacio={VACIO} />);

    expect(screen.getByRole("region", { name: "Tasa de entrega" })).toBeInTheDocument();
  });

  it("publica una entrada de texto por punto de dato aunque el lienzo mida cero", () => {
    render(
      <GraficaBarras
        titulo="Entregas"
        series={[serie("a", [10, 20, 30]), serie("b", [1, 2, 3])]}
        unidad="conteo"
        vacio={VACIO}
      />,
    );

    const lista = screen.getByRole("list", { name: "Entregas" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(6);
    expect(within(lista).getByText("Serie a, dia-0: 10")).toBeInTheDocument();
    expect(within(lista).getByText("Serie b, dia-2: 3")).toBeInTheDocument();
  });

  it("un punto nulo se muestra como dato ausente, no como cero", () => {
    render(
      <GraficaLineas titulo="Entregas" series={[serie("a", [null, 5])]} unidad="conteo" vacio={VACIO} />,
    );

    const lista = screen.getByRole("list", { name: "Entregas" });
    expect(within(lista).getByText(`Serie a, dia-0: ${SIN_MONTO}`)).toBeInTheDocument();
    expect(within(lista).queryByText("Serie a, dia-0: 0")).toBeNull();
  });

  it("formatea cada entrada segun la unidad recibida", () => {
    render(<GraficaBarras titulo="Ingresos" series={[serie("a", [3500])]} unidad="moneda" vacio={VACIO} />);

    const lista = screen.getByRole("list", { name: "Ingresos" });
    expect(within(lista).getByRole("listitem")).toHaveTextContent("3");
    expect(within(lista).getByRole("listitem")).not.toHaveTextContent("Serie a, dia-0: 3500");
  });
});

describe("montaje del lienzo (R41, unica asercion sobre el lienzo)", () => {
  it.each(GRAFICAS)("%s intenta montar su lienzo cuando hay datos", async (_n, Grafica, testId) => {
    render(<Grafica titulo="Entregas" series={[serie("a", [1, 2])]} unidad="conteo" vacio={VACIO} />);

    expect(await screen.findByTestId(testId)).toBeInTheDocument();
  });
});

describe("reduccion de movimiento (R28)", () => {
  it.each(GRAFICAS)("%s con prefers-reduced-motion no aplica clases de animacion", (_n, Grafica) => {
    // OJO CON LO QUE ESTE TEST MIDE Y LO QUE NO.
    //
    // Mide: el CODIGO DE ESTA FEATURE no emite ni una clase de animacion, ni con la
    // preferencia activada ni sin ella. Eso si esta bajo nuestro control y se afirma.
    //
    // NO mide el lienzo, y decir "sencillamente no anima" seria inexacto: recharts
    // SI anima sus barras y lineas cuando la preferencia esta APAGADA. Que las deje
    // de animar cuando esta encendida lo resuelve un DEFAULT suyo
    // (`isAnimationActive: "auto"` -> `usePrefersReducedMotion`), no una prop que
    // nosotros fijemos. Es decir: R28 se cumple en el lienzo por cortesia de la
    // libreria, con `package.json` en `^3.10.1` (rango abierto). Si un dia recharts
    // cambia ese default, este test seguiria verde y R28 se romperia sin avisar.
    // Anotado en `progress/impl_130.md` como dependencia de un default de terceros.
    const { container } = render(
      <Grafica titulo="Entregas" series={[serie("a", [1])]} unidad="conteo" vacio={VACIO} />,
    );

    const clases = Array.from(container.querySelectorAll("*"))
      .flatMap((nodo) => Array.from(nodo.classList))
      .join(" ");
    expect(clases).not.toMatch(/\banimate-/);
    expect(clases).not.toMatch(/\bduration-/);
    expect(clases).not.toMatch(/\btransition\b/);
  });
});

describe("topes de series y de puntos (R10 acotado, R31, R33)", () => {
  const aviso = (mostradas: number, recibidas: number) => `Se muestran ${mostradas} de ${recibidas}`;

  it("con 8 series, en produccion, anuncia por texto cuantas muestra de cuantas", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const series = Array.from({ length: 8 }, (_, i) => serie(`s${i}`, [1, 2]));
      render(
        <GraficaBarras
          titulo="Entregas"
          series={series}
          unidad="conteo"
          vacio={VACIO}
          avisoRecorte={aviso}
        />,
      );

      // Ya no se recorta por numero de series (2026-08-18): las OCHO llegan enteras y no hay
      // aviso que anunciar. Antes eran cinco y un «Se muestran 5 de 8».
      expect(screen.queryByText("Se muestran 5 de 8")).toBeNull();
      const lista = screen.getByRole("list", { name: "Entregas" });
      expect(within(lista).getAllByRole("listitem")).toHaveLength(8 * 2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // El techo de PUNTOS sobrevive y es el que acota la salida: es de legibilidad de un eje
  // temporal, no de color, y ninguna paleta lo resuelve.
  it("con 400 puntos, en produccion, cada serie se acota a MAX_PUNTOS_SERIE", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const largos = Array.from({ length: 8 }, (_, i) =>
        serie(`s${i}`, Array.from({ length: 400 }, () => 1)),
      );
      render(
        <GraficaLineas
          titulo="Entregas"
          series={largos}
          unidad="conteo"
          vacio={VACIO}
          avisoRecorte={aviso}
        />,
      );

      const lista = screen.getByRole("list", { name: "Entregas" });
      expect(within(lista).getAllByRole("listitem")).toHaveLength(8 * MAX_PUNTOS_SERIE);
      expect(screen.getByText("Se muestran 62 de 400")).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // ⚠ ESTE BLOQUE SE DIO LA VUELTA EL 2026-08-18, y el comentario que habia aqui explicaba
  // muy bien POR QUE existia: el color del donut distingue SEGMENTOS, `paleta.ts` lanzaba
  // `IndiceSerieFueraDeRangoError` para cualquier indice >= 5 **en todo NODE_ENV, produccion
  // incluida**, y por tanto un donut de 6+ categorias —`ordenes_por_estado` tiene 19—
  // REVENTARIA EN EL NAVEGADOR si la grafica no recortaba. El recorte era codigo de
  // seguridad, no cosmetica.
  //
  // Lo que cambio no es la opinion sino el PELIGRO: la paleta ahora tiene veinte tokens y
  // CICLA, asi que `varDeSerie` ya no lanza por muchas categorias que lleguen. Sin nada que
  // reventar, el recorte solo costaba dato — quince buckets de veinte en el desglose por
  // estado—. Estos casos vigilan la direccion nueva: que se pinten TODAS.
  describe("el donut ya no recorta segmentos (2026-08-18)", () => {
    const donut = (categorias: number) => [
      {
        id: "estados",
        etiqueta: "Estados",
        puntos: Array.from({ length: categorias }, (_, i) => ({
          categoria: `estado-${i}`,
          valor: i + 1,
        })),
      },
    ];

    it("con 6 categorias las pinta las seis, sin lanzar", () => {
      expect(() =>
        render(
          <GraficaDonut titulo="Estados" series={donut(6)} unidad="conteo" vacio={VACIO} />,
        ),
      ).not.toThrow();

      const lista = screen.getByRole("list", { name: "Estados" });
      expect(within(lista).getAllByRole("listitem")).toHaveLength(6);
    });

    // El caso que motivo el cambio: los veinte estados del catalogo caben enteros.
    it("con 20 categorias pinta las veinte y no anuncia ningun recorte", () => {
      render(
        <GraficaDonut
          titulo="Estados"
          series={donut(20)}
          unidad="conteo"
          vacio={VACIO}
          avisoRecorte={aviso}
        />,
      );

      const lista = screen.getByRole("list", { name: "Estados" });
      expect(within(lista).getAllByRole("listitem")).toHaveLength(20);
      expect(screen.queryByText(/Se muestran/)).toBeNull();
      // La ultima NO se perdio por el camino: es la que el techo viejo se comia primero.
      expect(within(lista).getByText("Estados, estado-19: 20")).toBeInTheDocument();
    });

    // Y en produccion tampoco: antes era el entorno donde SI recortaba en silencio.
    it("en produccion tampoco recorta", () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        render(
          <GraficaDonut
            titulo="Estados"
            series={donut(19)}
            unidad="conteo"
            vacio={VACIO}
            avisoRecorte={aviso}
          />,
        );

        const lista = screen.getByRole("list", { name: "Estados" });
        expect(within(lista).getAllByRole("listitem")).toHaveLength(19);
        expect(screen.queryByText("Se muestran 5 de 19")).toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  it("una grafica de barras con 6 series las pinta las seis, sin lanzar", () => {
    const series = Array.from({ length: 6 }, (_, i) => serie(`s${i}`, [1]));
    expect(() =>
      render(<GraficaBarras titulo="Entregas" series={series} unidad="conteo" vacio={VACIO} />),
    ).not.toThrow();
  });
});
