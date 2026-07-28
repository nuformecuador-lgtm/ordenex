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

  it("el inventario de flujo tiene las 46 aristas y 42 pares unicos (A.3 + #7b/#7c + 149 #43-#45)", () => {
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
    ["devuelta_a_tienda", "en_ruta"],
    // Feature 149: `por_recoger -> en_bodega_satelite` SALE de esta lista porque paso a ser
    // LEGAL (#44). Se sustituye por `por_recoger -> en_preparacion`, que sigue siendo ilegal
    // (D3': la reversion normaliza a un estado de BODEGA, nunca vuelve a un estado pre-guia).
    ["por_recoger", "en_preparacion"],
    ["sin_gestionar", "en_ruta"],
    ["devolviendo_a_bodega_central", "devuelta_a_tienda"],
  ] as const)("lanza TransicionIlegalError en %s -> %s", (origen, destino) => {
    expect(() => assertTransicionValida(origen, destino)).toThrow(TransicionIlegalError);
  });

  // --- REGRESION 149 (R27/R28) ------------------------------------------------------------
  it("REGRESION 149/R27: las TRES aristas de `deshacer_asignacion` (#43/#44/#45) son LEGALES", () => {
    expect(() => assertTransicionValida("por_recoger", "en_bodega_central")).not.toThrow(); // #43
    expect(() => assertTransicionValida("por_recoger", "en_bodega_satelite")).not.toThrow(); // #44
    expect(() =>
      assertTransicionValida("en_ruta_bodega_satelite", "en_bodega_central"),
    ).not.toThrow(); // #45
  });

  it.each([
    // D3': la normalizacion manda a BODEGA; volver a un estado pre-guia sigue prohibido.
    ["por_recoger", "en_fulfillment"],
    ["por_recoger", "en_preparacion"],
    ["en_ruta_bodega_satelite", "en_fulfillment"],
    ["en_ruta_bodega_satelite", "en_preparacion"],
    // Ya recogida / ya recibida: el deshacer no reabre estos caminos (R16).
    ["en_ruta", "por_recoger"],
    ["en_ruta", "en_bodega_central"],
    ["en_bodega_satelite", "en_ruta_bodega_satelite"],
  ] as const)(
    "REGRESION 149/R28: %s -> %s sigue siendo ILEGAL (la 149 no lo abrio)",
    (origen, destino) => {
      expect(() => assertTransicionValida(origen, destino)).toThrow(TransicionIlegalError);
    },
  );

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

  it("acepta EXACTAMENTE los tres estados de creacion del catalogo", () => {
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

describe("R4/R13 — la guardia trabaja sobre value del catalogo, en O(1)", () => {
  it("esOrderStatusValue reconoce los value del SEED y descarta lo demas", () => {
    for (const value of ORDER_STATUS_SEED) expect(esOrderStatusValue(value)).toBe(true);
    // Nombres pre-137 (renombrados por la feature 137): se construyen por concatenacion para
    // no escribirlos literalmente y no disparar el censo de `censo-order-status-rename`.
    expect(esOrderStatusValue(["en", "bodega"].join("_"))).toBe(false);
    expect(esOrderStatusValue(["recibido", "origen"].join("_"))).toBe(false);
    expect(esOrderStatusValue("EN_RUTA")).toBe(false); // el catalogo es case-sensitive
    expect(esOrderStatusValue("")).toBe(false);
  });

  it("valida sin efectos secundarios: mil llamadas no mutan el mapa", () => {
    const antes = JSON.stringify(TRANSICIONES);
    for (let i = 0; i < 1000; i += 1) {
      const origen = ORDER_STATUS_SEED[i % ORDER_STATUS_SEED.length] as OrderStatusValue;
      try {
        assertTransicionValida(origen, "en_ruta");
      } catch {
        /* ilegal esperado en la mayoria: aqui solo importa que no mute nada */
      }
    }
    expect(JSON.stringify(TRANSICIONES)).toBe(antes);
  });
});
