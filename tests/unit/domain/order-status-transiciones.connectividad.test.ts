import { describe, it, expect } from "vitest";
import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import {
  TRANSICIONES,
  ESTADOS_CREACION,
  ESTADOS_TERMINALES,
  ESTADOS_VESTIGIALES,
} from "@/lib/types/order-status-transiciones";

// Feature 140 — T3.1 (R14/R15/R16): INVARIANTE DE CONECTIVIDAD del grafo de estados.
// Se recorre `TRANSICIONES` mas un nodo virtual `START` con una arista a cada estado de
// creacion, y se exige:
//   - todo estado NO terminal: >= 1 entrada y >= 1 salida (callejon sin salida / cuello de
//     botella inalcanzable = fallo, R15, nombrando los `value` ofensores);
//   - todo estado terminal: >= 1 entrada (un terminal inalcanzable tambien es un bug);
//   - cobertura EXACTA del catalogo (R16): sin exenciones, el conjunto vestigial esta VACIO.

const TERMINALES = new Set<string>(ESTADOS_TERMINALES);
const CREACION = new Set<string>(ESTADOS_CREACION);

/** Grados de entrada/salida de cada `value`, contando `START -> creacion` como entrada. */
function calcularGrados(): Map<OrderStatusValue, { entradas: number; salidas: number }> {
  const grados = new Map<OrderStatusValue, { entradas: number; salidas: number }>();
  for (const value of ORDER_STATUS_SEED) grados.set(value, { entradas: 0, salidas: 0 });
  // Nodo virtual START: la creacion es una entrada real al grafo (R14).
  for (const destino of ESTADOS_CREACION) grados.get(destino)!.entradas += 1;
  for (const [origen, destinos] of Object.entries(TRANSICIONES)) {
    for (const destino of destinos) {
      grados.get(origen as OrderStatusValue)!.salidas += 1;
      grados.get(destino.to)!.entradas += 1;
    }
  }
  return grados;
}

describe("R14/R15 — el grafo de TRANSICIONES no tiene callejones sin salida", () => {
  it("todo estado NO terminal tiene al menos UNA salida", () => {
    const grados = calcularGrados();
    const sinSalida = [...grados.entries()]
      .filter(([value, g]) => !TERMINALES.has(value) && g.salidas === 0)
      .map(([value]) => value);
    // El fallo nombra el/los `value` ofensores (R15).
    expect(sinSalida, `callejon sin salida: ${sinSalida.join(", ")}`).toEqual([]);
  });

  it("todo estado tiene al menos UNA entrada (los de creacion, desde START)", () => {
    const grados = calcularGrados();
    const sinEntrada = [...grados.entries()]
      .filter(([, g]) => g.entradas === 0)
      .map(([value]) => value);
    expect(sinEntrada, `cuello de botella inalcanzable: ${sinEntrada.join(", ")}`).toEqual([]);
  });

  it("los estados terminales tienen entrada y estan exentos de necesitar salida", () => {
    const grados = calcularGrados();
    for (const terminal of ESTADOS_TERMINALES) {
      expect(grados.get(terminal)!.entradas, `terminal inalcanzable: ${terminal}`).toBeGreaterThan(
        0,
      );
    }
    // `devuelta_a_tienda` cierra el flujo de devolucion: salida 0 esperada.
    expect(grados.get("devuelta_a_tienda")!.salidas).toBe(0);
    // `entregada` conserva la salida legitima #31 (deshacer gestion): el test EXIME, no prohibe.
    expect(grados.get("entregada")!.salidas).toBeGreaterThan(0);
  });

  it("cada estado de creacion es alcanzable desde START y tiene salida de flujo", () => {
    const grados = calcularGrados();
    expect([...CREACION].sort()).toEqual(
      ["en_fulfillment", "en_preparacion", "en_ruta_bodega_central"].sort(),
    );
    for (const value of ESTADOS_CREACION) {
      expect(grados.get(value)!.salidas, `estado de creacion sin salida: ${value}`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("R16 — cobertura EXACTA del catalogo, sin exenciones", () => {
  it("los value que aparecen en el mapa, terminales y creacion cubren los 18 del SEED", () => {
    const cubiertos = new Set<string>([...CREACION, ...TERMINALES]);
    for (const [origen, destinos] of Object.entries(TRANSICIONES)) {
      cubiertos.add(origen);
      for (const destino of destinos) cubiertos.add(destino.to);
    }
    const faltantes = ORDER_STATUS_SEED.filter((value) => !cubiertos.has(value));
    const sobrantes = [...cubiertos].filter(
      (value) => !(ORDER_STATUS_SEED as readonly string[]).includes(value),
    );
    expect(faltantes, `value del catalogo sin clasificar: ${faltantes.join(", ")}`).toEqual([]);
    expect(sobrantes, `value fuera del catalogo: ${sobrantes.join(", ")}`).toEqual([]);
    expect(ORDER_STATUS_SEED.length).toBe(18);
  });

  it("el conjunto de estados vestigiales declarados esta VACIO (Q2)", () => {
    expect(ESTADOS_VESTIGIALES).toEqual([]);
  });

  it("el mapa declara una entrada por cada value del catalogo (exhaustividad, R5)", () => {
    expect(Object.keys(TRANSICIONES).sort()).toEqual([...ORDER_STATUS_SEED].sort());
  });
});
