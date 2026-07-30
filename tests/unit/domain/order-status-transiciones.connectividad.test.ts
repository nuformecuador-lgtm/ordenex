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
//
// Feature 154 (R16/R17/R25/R26): el catalogo pasa a 20 values, la creacion a 4 y los terminales
// a 3. `por_recolectar_en_tienda` es NO terminal (entra por creacion, sale por #43) e `incidente`
// es TERMINAL SIN NINGUNA salida (entra por #44). Al ser la 154 SOLO ADITIVA no se retira
// ninguna arista, asi que ningun estado preexistente pierde entradas ni salidas.
//
// Feature 156 (R3): SI se retiran tres aristas (#4/#6/#7c) y `en_preparacion` se queda con UNA
// sola salida (#5, a la bodega central). Este invariante es justo la red que impide pasarse de
// frenada: si alguien retirara tambien #5, `en_preparacion` quedaria sin salida y estos tests
// lo nombrarian. Lo mismo vale para `por_recoger` y `en_ruta_bodega_satelite`, que pierden un
// productor pero conservan entradas por otras aristas.
//
// Feature 155 (R22/R27/R28/R31): el catalogo baja de 20 a 19 values (sale el estado de
// fulfillment) y la creacion de 4 a 2. Este invariante es la razon por la que la 155 no podia
// limitarse a borrar las cuatro aristas del estado retirado: hacerlo sin sacar tambien el value
// del catalogo lo habria dejado con 0 entradas Y 0 salidas, y los dos primeros tests de este
// archivo lo habrian nombrado. El retiro es atomico: value, aristas y entradas de creacion.
// `en_ruta_bodega_central` deja de nacer por creacion pero conserva entrada por #30/#43.

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

  // Feature 154/R16: `incidente` es TERMINAL y ademas cierra de verdad — 0 salidas. El estado
  // `indemnizada` que se planteo en el gate para desterminarlo se DESCARTO (2026-07-29).
  it("154/R16: incidente es terminal, alcanzable (#44) y SIN ninguna arista de salida", () => {
    const grados = calcularGrados();
    expect([...ESTADOS_TERMINALES]).toContain("incidente");
    expect(grados.get("incidente")!.entradas).toBeGreaterThan(0);
    expect(grados.get("incidente")!.salidas).toBe(0);
    expect(TRANSICIONES.incidente).toEqual([]);
  });

  // Feature 154/R17: `por_recolectar_en_tienda` NO es terminal: tiene entrada (creacion) y salida.
  it("154/R17: por_recolectar_en_tienda NO es terminal y tiene entrada y salida", () => {
    const grados = calcularGrados();
    expect([...ESTADOS_TERMINALES]).not.toContain("por_recolectar_en_tienda");
    expect(grados.get("por_recolectar_en_tienda")!.entradas).toBeGreaterThan(0);
    expect(grados.get("por_recolectar_en_tienda")!.salidas).toBeGreaterThan(0);
  });

  // Feature 156/R3: tras retirar #4/#6/#7c, `en_preparacion` conserva EXACTAMENTE una salida
  // (#5 -> en_bodega_central) y los dos destinos que dejo de alimentar siguen siendo
  // alcanzables por otras vias (nadie se queda huerfano por este retiro).
  it("156/R3: en_preparacion tiene una sola salida y no deja huerfano a ningun destino", () => {
    const grados = calcularGrados();
    expect(grados.get("en_preparacion")!.salidas).toBe(1);
    expect(TRANSICIONES.en_preparacion.map((d) => d.to)).toEqual(["en_bodega_central"]);
    // `por_recoger` sigue alimentado por la asignacion desde bodega central y satelite;
    // `en_ruta_bodega_satelite`, por el ruteo desde la bodega central.
    expect(grados.get("por_recoger")!.entradas).toBeGreaterThan(0);
    expect(grados.get("en_ruta_bodega_satelite")!.entradas).toBeGreaterThan(0);
  });

  it("cada estado de creacion es alcanzable desde START y tiene salida de flujo", () => {
    const grados = calcularGrados();
    // Feature 155/R22/R31: de 4 a EXACTAMENTE 2. Son las dos salidas de
    // `resolverDestinoCreacion`; ningun otro estado del catalogo admite nacimiento.
    expect([...CREACION].sort()).toEqual(
      [
        "en_preparacion", // rama (a): la tienda ya tiene el paquete en bodega
        "por_recolectar_en_tienda", // rama (b): el paquete sigue en la tienda (154/R13)
      ].sort(),
    );
    for (const value of ESTADOS_CREACION) {
      expect(grados.get(value)!.salidas, `estado de creacion sin salida: ${value}`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("R16 — cobertura EXACTA del catalogo, sin exenciones", () => {
  it("los value que aparecen en el mapa, terminales y creacion cubren los 19 del SEED", () => {
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
    expect(ORDER_STATUS_SEED.length).toBe(19); // feature 154: 18 -> 20; feature 155: 20 -> 19
  });

  // Feature 154/R25: los DOS values nuevos quedan clasificados en el mapa. Es la contraparte
  // en runtime del `satisfies Record<OrderStatusValue, ...>` (que rompe el BUILD si falta uno):
  // aqui se nombra explicitamente a los recien llegados para que el fallo sea legible.
  it("154/R25: los dos values nuevos estan clasificados en el mapa (sin sobrantes)", () => {
    expect(Object.keys(TRANSICIONES)).toContain("por_recolectar_en_tienda");
    expect(Object.keys(TRANSICIONES)).toContain("incidente");
    expect(ORDER_STATUS_SEED).toContain("por_recolectar_en_tienda");
    expect(ORDER_STATUS_SEED).toContain("incidente");
  });

  it("el conjunto de estados vestigiales declarados esta VACIO (Q2)", () => {
    expect(ESTADOS_VESTIGIALES).toEqual([]);
  });

  it("el mapa declara una entrada por cada value del catalogo (exhaustividad, R5)", () => {
    expect(Object.keys(TRANSICIONES).sort()).toEqual([...ORDER_STATUS_SEED].sort());
  });
});
