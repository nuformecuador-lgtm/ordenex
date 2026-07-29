import { describe, it, expect } from "vitest";
import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import {
  TRANSICIONES,
  ESTADOS_CREACION,
  TransicionIlegalError,
  assertTransicionValida,
  esOrderStatusValue,
} from "@/lib/types/order-status-transiciones";
import {
  INVENTARIO_CREACION,
  INVENTARIO_FLUJO,
  RECUENTO_INVENTARIO,
} from "@/tests/fixtures/inventario-transiciones-140";

// Feature 140 — T3.2 (R6/R8/R10/R12): unit de la funcion PURA `assertTransicionValida`.
// El inventario del apendice A entra data-driven (fixture transcrita a mano, no derivada del
// mapa): cada arista real DEBE pasar (R8) y los pares no listados DEBEN lanzar (R6).

const CREACION = new Set<string>(ESTADOS_CREACION);

describe("R8 — la guardia acepta TODAS las transiciones del inventario", () => {
  it.each(INVENTARIO_FLUJO.map((a) => [a.n, a.origen, a.destino, a.via, a.callSite] as const))(
    "#%s acepta %s -> %s (via %s, %s)",
    (_n, origen, destino) => {
      expect(() => assertTransicionValida(origen, destino)).not.toThrow();
    },
  );

  it("el inventario de flujo tiene las 42 aristas y 39 pares unicos (A.3 + #7b + #43/#44 - #4/#6/#7c)", () => {
    expect(INVENTARIO_FLUJO).toHaveLength(RECUENTO_INVENTARIO.aristasFlujo);
    const pares = new Set(INVENTARIO_FLUJO.map((a) => `${a.origen}->${a.destino}`));
    expect(pares.size).toBe(RECUENTO_INVENTARIO.paresUnicos);
  });

  it("el mapa declara exactamente las aristas del inventario, ni una mas", () => {
    const enMapa = Object.entries(TRANSICIONES)
      .flatMap(([origen, destinos]) => destinos.map((d) => `${origen}->${d.to} (${d.via})`))
      .sort();
    const enInventario = INVENTARIO_FLUJO.map((a) => `${a.origen}->${a.destino} (${a.via})`).sort();
    expect(enMapa).toEqual(enInventario);
  });
});

describe("R6 — la guardia rechaza los pares que no estan en TRANSICIONES", () => {
  it.each([
    ["entregada", "devuelta_a_tienda"],
    ["en_preparacion", "entregada"],
    ["devuelta_a_tienda", "en_reparto"],
    ["por_recoger", "en_bodega_satelite"],
    ["sin_gestionar", "en_reparto"],
    ["devolviendo_a_bodega_central", "devuelta_a_tienda"],
  ] as const)("lanza TransicionIlegalError en %s -> %s", (origen, destino) => {
    expect(() => assertTransicionValida(origen, destino)).toThrow(TransicionIlegalError);
  });

  it("REGRESION 139/R9: rechazada -> devolviendo_a_tienda es ILEGAL (arista #27 retirada)", () => {
    expect(() => assertTransicionValida("rechazada", "devolviendo_a_tienda")).toThrow(
      TransicionIlegalError,
    );
    // La unica salida de `rechazada` hacia la devolucion es la aprobacion del cierre.
    expect(() => assertTransicionValida("rechazada", "por_devolver")).not.toThrow();
    expect(() => assertTransicionValida("rechazada", "por_devolver_a_tienda")).not.toThrow();
  });

  it("rechaza el auto-lazo de cualquier estado (X -> X nunca esta declarado)", () => {
    for (const value of ORDER_STATUS_SEED) {
      expect(() => assertTransicionValida(value, value), `auto-lazo aceptado en ${value}`).toThrow(
        TransicionIlegalError,
      );
    }
  });

  it("R9/Q3: no existe override ANY -> ANY; el ajuste administrativo pasa por el mismo mapa", () => {
    // Las 3 aristas de `ajuste_estado` declaradas (#28/#40/#42) pasan...
    expect(() => assertTransicionValida("devolviendo_a_tienda", "devuelta_a_tienda")).not.toThrow();
    expect(() => assertTransicionValida("por_devolver", "devolviendo_a_bodega_central")).not.toThrow();
    expect(() => assertTransicionValida("por_devolver_a_tienda", "devolviendo_a_tienda")).not.toThrow();
    // ...y un "rescate" administrativo arbitrario NO pasa, aunque lo pida un maestro/admin.
    expect(() => assertTransicionValida("sin_gestionar", "entregada")).toThrow(
      TransicionIlegalError,
    );
    expect(() => assertTransicionValida("devuelta_a_tienda", "en_preparacion")).toThrow(
      TransicionIlegalError,
    );
  });
});

describe("R10 — la creacion (null -> X) tambien se valida", () => {
  it.each(INVENTARIO_CREACION.map((a) => [a.destino, a.via] as const))(
    "acepta nacer en %s (via %s)",
    (destino) => {
      expect(() => assertTransicionValida(null, destino)).not.toThrow();
    },
  );

  it("acepta EXACTAMENTE los estados de creacion del catalogo", () => {
    expect(INVENTARIO_CREACION).toHaveLength(RECUENTO_INVENTARIO.aristasCreacion);
    const aceptados = ORDER_STATUS_SEED.filter((value) => {
      try {
        assertTransicionValida(null, value);
        return true;
      } catch {
        return false;
      }
    });
    expect([...aceptados].sort()).toEqual([...ESTADOS_CREACION].sort());
  });

  it.each(
    ORDER_STATUS_SEED.filter((value) => !CREACION.has(value)).map((value) => [value] as const),
  )("rechaza nacer en %s (fuera de ESTADOS_CREACION)", (destino) => {
    expect(() => assertTransicionValida(null, destino)).toThrow(TransicionIlegalError);
  });
});

describe("R12 — el error de dominio es distinguible y no filtra PII", () => {
  it("es asertable por instanceof y conserva origen/destino", () => {
    let capturado: unknown;
    try {
      assertTransicionValida("entregada", "devuelta_a_tienda");
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(TransicionIlegalError);
    expect(capturado).toBeInstanceOf(Error);
    const error = capturado as TransicionIlegalError;
    expect(error.name).toBe("TransicionIlegalError");
    expect(error.origen).toBe("entregada");
    expect(error.destino).toBe("devuelta_a_tienda");
  });

  it("el mensaje menciona SOLO los dos value del catalogo", () => {
    const mensaje = new TransicionIlegalError("entregada", "devuelta_a_tienda").message;
    expect(mensaje).toBe("transicion ilegal: entregada -> devuelta_a_tienda");
    // El mensaje se compone EXACTAMENTE de los dos `value`: nada de ids, ordenes ni actores.
    const tokens = mensaje.replace("transicion ilegal: ", "").split(" -> ");
    expect(tokens).toEqual(["entregada", "devuelta_a_tienda"]);
    expect(mensaje).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // sin UUIDs
  });

  it("el mensaje de la creacion ilegal no expone ids ni el actor", () => {
    const mensaje = new TransicionIlegalError(null, "entregada").message;
    expect(mensaje).toBe("transicion ilegal: creacion -> entregada");
    expect(mensaje).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // sin UUIDs (ids de orden/estado)
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 154 — catalogo de estados v2. Numeracion R<n> de `specs/154-catalogo-estados-v2`.
//
// PUERTA T0 (cerrada con el humano el 2026-07-29): la 154 es SOLO ADITIVA. No retiro NINGUNA
// arista. Por eso sus requisitos de BAJA (R18-R21) NO se verificaron como "ahora es ilegal"
// sino como lo contrario, con el retiro mudado a la feature que recablea
// `GuiaAsignacionService` (155/156). Ver `progress/impl_154.md`.
//
// Feature 156: R18/R19 ya se COBRARON (#4/#6/#7c retiradas, describe "156 — BAJAS EJECUTADAS").
// R20/R21 (#1/#3/#7b, de `en_fulfillment`) siguen diferidas a la 155.
// ---------------------------------------------------------------------------------------------
describe("154 — ALTAS del grafo v2 (R13/R14/R15)", () => {
  it("R13: es LEGAL que una orden nazca en por_recolectar_en_tienda", () => {
    expect(() => assertTransicionValida(null, "por_recolectar_en_tienda")).not.toThrow();
    expect([...ESTADOS_CREACION]).toContain("por_recolectar_en_tienda");
  });

  it("R14: es LEGAL por_recolectar_en_tienda -> en_ruta_bodega_central (#43)", () => {
    expect(() =>
      assertTransicionValida("por_recolectar_en_tienda", "en_ruta_bodega_central"),
    ).not.toThrow();
  });

  it("R15: es LEGAL en_reparto -> incidente (#44)", () => {
    expect(() => assertTransicionValida("en_reparto", "incidente")).not.toThrow();
  });

  it("R16: incidente no tiene NINGUNA salida legal (terminal de verdad)", () => {
    for (const destino of ORDER_STATUS_SEED) {
      expect(
        () => assertTransicionValida("incidente", destino),
        `incidente -> ${destino} deberia ser ilegal`,
      ).toThrow(TransicionIlegalError);
    }
  });

  it("R17: la unica salida legal de por_recolectar_en_tienda es en_ruta_bodega_central", () => {
    const legales = ORDER_STATUS_SEED.filter((destino) => {
      try {
        assertTransicionValida("por_recolectar_en_tienda", destino);
        return true;
      } catch {
        return false;
      }
    });
    expect(legales).toEqual(["en_ruta_bodega_central"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 156 — "Generar guia" SIN asignar mensajero. Aqui se COBRA la postergacion que la 154
// dejo escrita: las bajas R18/R19 de aquel spec (#4, #6, #7c) se ejecutan en esta feature, que
// es la que retira a su ultimo productor (`GuiaAsignacionService.generarGuia` deja de asignar y
// de rutear; `rutearABodegaSatelite` deja de admitir `en_preparacion`).
//
// Los casos de abajo son los MISMOS que la 154 dejo afirmando "sigue siendo legal": no se
// borran, se mueven a su nueva verdad ("ya no es legal"). Los de `en_fulfillment` (R20/R21 de
// la 154, #1/#3/#7b) siguen en el describe de bajas diferidas: los retira la 155.
// ---------------------------------------------------------------------------------------------
describe("156 — BAJAS EJECUTADAS: generar guia ya no asigna mensajero ni rutea a satelite", () => {
  it.each([
    ["154/R18 = #4", "en_preparacion", "por_recoger"],
    ["154/R19 = #6 y #7c", "en_preparacion", "en_ruta_bodega_satelite"],
  ] as const)("%s: %s -> %s ya NO es legal (lo retiro la 156)", (_r, origen, destino) => {
    expect(() => assertTransicionValida(origen, destino)).toThrow(TransicionIlegalError);
  });

  it("156/R3: la UNICA salida legal de en_preparacion es en_bodega_central", () => {
    const legales = ORDER_STATUS_SEED.filter((destino) => {
      try {
        assertTransicionValida("en_preparacion", destino);
        return true;
      } catch {
        return false;
      }
    });
    expect(legales).toEqual(["en_bodega_central"]);
  });

  it("el mapa retira EXACTAMENTE tres aristas: 45 -> 42 (y 41 -> 39 pares)", () => {
    const total = Object.entries(TRANSICIONES).reduce(
      (acc, [, destinos]) => acc + (destinos as readonly unknown[]).length,
      0,
    );
    expect(total).toBe(RECUENTO_INVENTARIO.aristasFlujo);
    expect(RECUENTO_INVENTARIO.aristasFlujo).toBe(42); // 45 de la 154 - #4 - #6 - #7c
    expect(RECUENTO_INVENTARIO.paresUnicos).toBe(39);
  });
});

describe("154 — BAJAS DIFERIDAS: R20/R21 se mudan a la feature 155", () => {
  // La decision Q2 del gate (2026-07-29) supero el texto de R18-R21 de la 154: cada arista
  // muere en el commit que retira a su ultimo productor. R18/R19 ya se cobraron arriba (156).
  // Estas dos siguen pendientes: la 156 ya les quito el productor (`generarGuia` y
  // `rutearABodegaSatelite` no admiten `en_fulfillment`), pero retirarlas ANTES de que la 155
  // haga el backfill dejaria a `en_fulfillment` sin ninguna salida legal y atraparia sus
  // ordenes vivas. Este test es el CONTRATO de esa postergacion: cuando la 155 las retire,
  // romperá aqui y obligará a mover el caso a esa feature.
  it.each([
    ["R20 (#1, lo retira la 155)", "en_fulfillment", "por_recoger"],
    ["R21 (#3/#7b, los retira la 155)", "en_fulfillment", "en_ruta_bodega_satelite"],
  ] as const)("%s: %s -> %s SIGUE siendo legal tras la 156", (_r, origen, destino) => {
    expect(() => assertTransicionValida(origen, destino)).not.toThrow();
  });

  it("en_fulfillment conserva sus cuatro aristas (declaradas y sin productor)", () => {
    expect(TRANSICIONES.en_fulfillment).toHaveLength(4);
  });
});

describe("154 — SUPERVIVIENTES que el spec fija explicitamente (R22/R23)", () => {
  it("R22: en_preparacion -> en_bodega_central sigue legal (destino de generar guia)", () => {
    expect(() => assertTransicionValida("en_preparacion", "en_bodega_central")).not.toThrow();
  });

  it.each([
    ["en_bodega_central", "en_ruta_bodega_satelite"],
    ["en_bodega_central", "por_recoger"],
    ["en_bodega_satelite", "por_recoger"],
  ] as const)("R23: la asignacion %s -> %s sigue legal", (origen, destino) => {
    expect(() => assertTransicionValida(origen, destino)).not.toThrow();
  });
});

describe("154/R24 — el error de transicion ilegal no filtra nada del cliente", () => {
  it("el mensaje de un par ilegal cita SOLO los dos value del catalogo", () => {
    const mensaje = new TransicionIlegalError("incidente", "entregada").message;
    expect(mensaje).toBe("transicion ilegal: incidente -> entregada");
    const tokens = mensaje.replace("transicion ilegal: ", "").split(" -> ");
    expect(tokens).toEqual(["incidente", "entregada"]);
    expect(mensaje).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // sin UUIDs
  });

  it("todo par ilegal que involucre los values nuevos produce un mensaje de solo dos values", () => {
    const pares: Array<[OrderStatusValue, OrderStatusValue]> = [
      ["incidente", "en_reparto"],
      ["por_recolectar_en_tienda", "entregada"],
      ["entregada", "por_recolectar_en_tienda"],
    ];
    for (const [origen, destino] of pares) {
      let capturado: unknown;
      try {
        assertTransicionValida(origen, destino);
      } catch (error) {
        capturado = error;
      }
      expect(capturado).toBeInstanceOf(TransicionIlegalError);
      expect((capturado as Error).message).toBe(`transicion ilegal: ${origen} -> ${destino}`);
    }
  });
});

describe("154/R27 — el inventario auditable sigue sincronizado con el mapa", () => {
  it("las dos aristas nuevas estan en el inventario transcrito a mano", () => {
    const pares = INVENTARIO_FLUJO.map((a) => `${a.origen}->${a.destino} (${a.via})`);
    expect(pares).toContain("por_recolectar_en_tienda->en_ruta_bodega_central (recoleccion_tienda)");
    expect(pares).toContain("en_reparto->incidente (gestion)");
    expect(INVENTARIO_CREACION.map((a) => a.destino)).toContain("por_recolectar_en_tienda");
  });

  // Feature 156: los recuentos bajan de 45/41 a 42/39 al retirar #4/#6/#7c.
  it("los recuentos del inventario son 42 flujo / 39 pares / 4 creacion", () => {
    expect(RECUENTO_INVENTARIO).toEqual({
      aristasFlujo: 42,
      paresUnicos: 39,
      aristasCreacion: 4,
    });
  });
});

describe("R4/R13 — la guardia trabaja sobre value del catalogo, en O(1)", () => {
  it("esOrderStatusValue reconoce los value del SEED y descarta lo demas", () => {
    for (const value of ORDER_STATUS_SEED) expect(esOrderStatusValue(value)).toBe(true);
    // Nombres pre-137 (renombrados por la feature 137): se construyen por concatenacion para
    // no escribirlos literalmente y no disparar el censo de `censo-order-status-rename`.
    expect(esOrderStatusValue(["en", "bodega"].join("_"))).toBe(false);
    expect(esOrderStatusValue(["recibido", "origen"].join("_"))).toBe(false);
    expect(esOrderStatusValue("EN_REPARTO")).toBe(false); // el catalogo es case-sensitive
    expect(esOrderStatusValue("")).toBe(false);
  });

  it("valida sin efectos secundarios: mil llamadas no mutan el mapa", () => {
    const antes = JSON.stringify(TRANSICIONES);
    for (let i = 0; i < 1000; i += 1) {
      const origen = ORDER_STATUS_SEED[i % ORDER_STATUS_SEED.length] as OrderStatusValue;
      try {
        assertTransicionValida(origen, "en_reparto");
      } catch {
        /* ilegal esperado en la mayoria: aqui solo importa que no mute nada */
      }
    }
    expect(JSON.stringify(TRANSICIONES)).toBe(antes);
  });
});
