import { describe, expect, it } from "vitest";

import {
  etiquetaDeLeyenda,
  firmaDeSegmentos,
} from "@/components/private/analytics/lienzo/DonutLienzo";
import {
  CLASES_LIENZO,
  clasesDeLienzo,
} from "@/components/private/analytics/GraficaMarco";

// La animación del donut al CAMBIAR los datos. Bug reportado el 2026-08-18: al cambiar el
// filtro, las porciones saltaban a su tamaño nuevo de golpe; la animación sólo se veía en el
// primer pintado.
//
// Causa: recharts 3 anima el `Pie` en su MONTAJE, y cuando sólo cambia `data` —mismo número de
// segmentos, mismos nombres— React reutiliza el componente y no hay montaje que animar.
// Arreglo: una `key` derivada de las cifras, de modo que un cambio de datos remonte el `Pie`.
//
// Se prueba la FIRMA y no el remontaje: `ResponsiveContainer` mide su contenedor y en jsdom
// mide 0×0, así que recharts no llega a dibujar sectores que observar (es la misma razón por
// la que `AnalyticsGraficas.test.tsx` no mira el SVG). La firma es la única pieza con lógica,
// y es donde vive la decisión.

describe("Donut — la firma que dispara la reanimación", () => {
  it("dos repartos distintos dan firmas distintas", () => {
    const antes = firmaDeSegmentos([
      { name: "Entregadas", value: 20 },
      { name: "No entregadas", value: 80 },
    ]);
    const despues = firmaDeSegmentos([
      { name: "Entregadas", value: 35 },
      { name: "No entregadas", value: 65 },
    ]);

    expect(antes).not.toBe(despues);
  });

  // La otra dirección, y la que de verdad importa: un render que no cambia ninguna cifra
  // conserva la firma. Sin esto el anillo se reanimaría en CADA render —basta pasar el ratón
  // por encima para provocar uno— y parpadearía sin parar.
  it("los mismos datos dan la MISMA firma, aunque lleguen en otro array", () => {
    const a = firmaDeSegmentos([{ name: "Entregadas", value: 20 }]);
    const b = firmaDeSegmentos([{ name: "Entregadas", value: 20 }]);

    expect(a).toBe(b);
  });

  it("distingue el cero medido del hueco sin dato", () => {
    expect(firmaDeSegmentos([{ name: "Entregadas", value: 0 }])).not.toBe(
      firmaDeSegmentos([{ name: "Entregadas", value: null }]),
    );
  });

  // Cambiar sólo la etiqueta también es un cambio visible, y también merece reanimar.
  it("distingue dos segmentos con el mismo valor y distinto nombre", () => {
    expect(firmaDeSegmentos([{ name: "Entregadas", value: 5 }])).not.toBe(
      firmaDeSegmentos([{ name: "No entregadas", value: 5 }]),
    );
  });

  // La mutación que este caso mata: concatenar sin separadores. `[a:1, b:2]` y `[a:1b:2]`
  // acabarían con la misma firma y un cambio real no reanimaría.
  it("no colapsa dos repartos distintos de los mismos textos", () => {
    expect(
      firmaDeSegmentos([
        { name: "a", value: 1 },
        { name: "b", value: 2 },
      ]),
    ).not.toBe(firmaDeSegmentos([{ name: "a", value: 1 }]));
  });

  it("el conjunto vacío tiene firma estable", () => {
    expect(firmaDeSegmentos([])).toBe(firmaDeSegmentos([]));
  });
});

// La leyenda LATERAL con su conteo (pedido del 2026-08-18: «que se vea el valor sin necesidad
// de pasar sobre el segmento»). El texto de cada entrada es la única pieza con lógica; la
// posición es configuración de recharts y en jsdom no hay layout que medir.
describe("Donut — el texto de la leyenda lateral", () => {
  /** El formateador que la gráfica ya resolvió por unidad. Aquí, uno de conteo. */
  const comoConteo = (valor: number | null) => (valor === null ? "—" : String(valor));

  it("pega el conteo al nombre", () => {
    expect(etiquetaDeLeyenda("Entregadas", 20, comoConteo)).toBe("Entregadas: 20");
    expect(etiquetaDeLeyenda("No entregadas", 80, comoConteo)).toBe("No entregadas: 80");
  });

  // El valor pasa por `formatear`, que la gráfica resuelve POR UNIDAD. La mutación que este
  // caso mata: concatenar el número a pelo — en un donut de dinero la leyenda escribiría el
  // monto en crudo, sin separadores ni símbolo.
  it("usa el formateador recibido, no el número crudo", () => {
    const comoMoneda = (valor: number | null) => `[${valor}]`;
    expect(etiquetaDeLeyenda("Flete", 1500, comoMoneda)).toBe("Flete: [1500]");
  });

  // Un «Entregadas: —» ocupa el sitio de una cifra que no existe. El hueco se ve mejor vacío
  // que relleno con un guion.
  it("sin dato escribe SOLO el nombre", () => {
    expect(etiquetaDeLeyenda("Entregadas", null, comoConteo)).toBe("Entregadas");
  });

  it("el cero SÍ es una cifra y se escribe", () => {
    expect(etiquetaDeLeyenda("Entregadas", 0, comoConteo)).toBe("Entregadas: 0");
  });
});

// La proporción del lienzo. Nació el 2026-08-18 para la serie de órdenes cargadas por día: a
// ancho completo, un 16:9 son ~675 px de alto para una fila de barras, y la gráfica se comía la
// pantalla.
//
// Se prueba la función que resuelve la clase y no el render: recharts mide su contenedor y en
// jsdom mide 0×0, así que el alto real no es observable aquí. La clase es la decisión.
describe("La proporción del lienzo", () => {
  it("por defecto es la de siempre, 16:9", () => {
    expect(clasesDeLienzo()).toBe(CLASES_LIENZO);
    expect(clasesDeLienzo("normal")).toBe(CLASES_LIENZO);
    expect(CLASES_LIENZO).toContain("aspect-video");
  });

  // 32:9 es exactamente la mitad de alto que 16:9 al mismo ancho. La mutación que este caso
  // mata: elegir otra proporción «parecida» que no sea la mitad.
  it("«bajo» es la MITAD de alto: 32:9", () => {
    expect(clasesDeLienzo("bajo")).toContain("aspect-[32/9]");
    expect(clasesDeLienzo("bajo")).not.toContain("aspect-video");
  });

  // Las dos clases se escriben completas y literales porque Tailwind compila estáticamente:
  // una clase construida por interpolación no existiría en el CSS final. Y las dos conservan
  // `w-full min-h-0`, que es lo que las hace sobrevivir dentro de una columna flex.
  it("las dos conservan el ancho completo y el `min-h-0` del contenedor flex", () => {
    for (const clases of [clasesDeLienzo(), clasesDeLienzo("bajo")]) {
      expect(clases).toContain("w-full");
      expect(clases).toContain("min-h-0");
    }
  });
});
