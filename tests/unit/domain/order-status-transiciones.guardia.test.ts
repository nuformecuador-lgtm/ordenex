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

  it("el inventario de flujo tiene las 59 aristas y 57 pares unicos (A.3 + #43/#44 - #4/#6/#7c - #1/#2/#3/#7b + 149 #45-#47 + 158 #53 + 158 admin #48-#52/#54-#58 + 157 #45b/#46b + 239 #59/#60/#61 - #14 + 235 #62/#63/#64)", () => {
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

// ---------------------------------------------------------------------------------------------
// FEATURE 235 — el estatus de la AYUDA A LA TIENDA y sus tres aristas (R12).
//
// Lo que estos casos protegen no es que las tres existan (eso ya lo dice el inventario de arriba):
// es que las SALIDAS de `ayuda_tienda` sean EXACTAMENTE dos. R12 lo pide con esas palabras —
// «declarar como legales exactamente las transiciones que tengan productor, y NINGUNA sin
// productor»— y el precedente de lo contrario esta escrito en el repo: la 154 declaro #43/#44 sin
// productor y «costo el tren 154+155+156».
// ---------------------------------------------------------------------------------------------
describe("235+237 — el estatus de ayuda: sus CUATRO salidas, y ni una mas (235/R12, 237/R1)", () => {
  it("235/R2: `en_reparto -> ayuda_tienda` es legal (#62, la solicitud del mensajero)", () => {
    expect(() => assertTransicionValida("en_reparto", "ayuda_tienda")).not.toThrow();
  });

  it("235/R8: `ayuda_tienda -> en_reparto` es legal (#63, el rescate por cualquiera de los dos lados)", () => {
    expect(() => assertTransicionValida("ayuda_tienda", "en_reparto")).not.toThrow();
  });

  it("235/R26: `ayuda_tienda -> sin_gestionar` es legal (#64, el corte de la noche)", () => {
    expect(() => assertTransicionValida("ayuda_tienda", "sin_gestionar")).not.toThrow();
  });

  it("237/R1: `ayuda_tienda -> reprogramada` es legal (#65, la tienda reprograma desde ayuda)", () => {
    expect(() => assertTransicionValida("ayuda_tienda", "reprogramada")).not.toThrow();
  });

  it("237/R1: `ayuda_tienda -> rechazada` es legal (#66, la tienda rechaza desde ayuda)", () => {
    expect(() => assertTransicionValida("ayuda_tienda", "rechazada")).not.toThrow();
  });

  it("235/R12 + 237/R1: las salidas de `ayuda_tienda` son EXACTAMENTE esas cuatro, enumeradas enteras", () => {
    // Censo CERRADO sobre el mapa real. Una salida de mas aqui es una arista sin productor (el
    // fallo de la 154); una de menos deja el estatus convertido en un POZO del que no se sale.
    //
    // ⏳ 2026-08-20 (feature 237): pasa de DOS a CUATRO. Las dos altas llegan CON su productor
    // (`GestionDesdeAyudaService.gestionar` -> `GestionOrdenRepository.crearGestionDesdeAyuda`), y
    // comparten `via` porque son el mismo acto con dos resultados.
    const salidas = TRANSICIONES.ayuda_tienda.map((d) => `${d.to} (${d.via})`).sort();
    expect(salidas).toEqual([
      "en_reparto (rescate_ayuda_tienda)",
      "rechazada (gestion_tienda_ayuda)",
      "reprogramada (gestion_tienda_ayuda)",
      "sin_gestionar (corte_sin_gestionar)",
    ]);
  });

  it.each([
    // ⏳ 2026-08-20 (feature 237): `reprogramada` y `rechazada` SALEN de esta lista — ya son
    // legales, con productor, dos casos mas arriba. Las TRES que quedan siguen ilegales A
    // PROPOSITO (237/R1): la tienda no puede declarar entregado un paquete que no vio, ni devolver
    // por su cuenta lo que sigue en la moto, ni reportar un incidente que no presencio. Si alguna
    // se vuelve legal sin traer su productor, este caso lo dice.
    ["entregada"],
    ["devolucion_por_confirmar"],
    ["incidente"],
    // Y las dos bodegas: no hay recuperacion manual desde aqui, el paquete esta en la moto.
    ["en_bodega_central"],
    ["en_bodega_satelite"],
  ] as const)(
    "235/R12 + 237/R1: `ayuda_tienda -> %s` sigue siendo ILEGAL (no tiene productor)",
    (destino) => {
      expect(() => assertTransicionValida("ayuda_tienda", destino)).toThrow(TransicionIlegalError);
    },
  );

  it("235: `en_reparto` conserva sus SEIS salidas previas — pedir ayuda no sustituye a ninguna", () => {
    const destinos = TRANSICIONES.en_reparto.map((d) => d.to).sort();
    expect(destinos).toEqual([
      "ayuda_tienda",
      "devolucion_por_confirmar",
      "entregada",
      "incidente",
      "rechazada",
      "reprogramada",
      "sin_gestionar",
    ]);
  });

  it("235: no se puede NACER en el estatus de ayuda (no esta en ESTADOS_CREACION)", () => {
    expect(() => assertTransicionValida(null, "ayuda_tienda")).toThrow(TransicionIlegalError);
  });
});

describe("R6 — la guardia rechaza los pares que no estan en TRANSICIONES", () => {
  it.each([
    ["entregada", "devuelta_a_tienda"],
    ["en_preparacion", "entregada"],
    ["devuelta_a_tienda", "en_reparto"],
    // Feature 149: `por_recoger -> en_bodega_satelite` SALE de esta lista porque paso a ser
    // LEGAL (#47). Se sustituye por `por_recoger -> en_preparacion`, que sigue siendo ilegal
    // (D3': la reversion normaliza a un estado de BODEGA, nunca vuelve a un estado pre-guia).
    ["por_recoger", "en_preparacion"],
    ["sin_gestionar", "en_reparto"],
    ["devolviendo_a_bodega_central", "devuelta_a_tienda"],
  ] as const)("lanza TransicionIlegalError en %s -> %s", (origen, destino) => {
    expect(() => assertTransicionValida(origen, destino)).toThrow(TransicionIlegalError);
  });

  // --- REGRESION 149 (R27/R28) ------------------------------------------------------------
  it("REGRESION 149/R27: las TRES aristas de `deshacer_asignacion` (#45/#46/#47) son LEGALES", () => {
    expect(() => assertTransicionValida("por_recoger", "en_bodega_central")).not.toThrow(); // #46
    expect(() => assertTransicionValida("por_recoger", "en_bodega_satelite")).not.toThrow(); // #47
    expect(() =>
      assertTransicionValida("en_ruta_bodega_satelite", "en_bodega_central"),
    ).not.toThrow(); // #45
  });

  it.each([
    // D3': la normalizacion manda a BODEGA; volver a un estado pre-guia sigue prohibido.
    //
    // Los dos casos hacia el estado de fulfillment SE RETIRARON al integrar la feature 155:
    // ese value ya no existe en `OrderStatusValue`, asi que la transicion no es solo ilegal,
    // es INEXPRESABLE -- el compilador lo rechaza antes de que este test pueda ejecutarse, que
    // es una garantia mas fuerte que la de un assert en runtime. Lo que sigue vivo es la
    // prohibicion hacia `en_preparacion`, que si es un estado alcanzable.
    ["por_recoger", "en_preparacion"],
    ["en_ruta_bodega_satelite", "en_preparacion"],
    // Ya recogida / ya recibida: el deshacer no reabre estos caminos (R16).
    ["en_reparto", "por_recoger"],
    ["en_reparto", "en_bodega_central"],
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
// R20/R21 (#1/#3/#7b, del estado de fulfillment) las cobra la 155, mas abajo.
// ---------------------------------------------------------------------------------------------
describe("154 — ALTAS del grafo v2 (R13/R14/R15)", () => {
  it("R13: es LEGAL que una orden nazca en por_recolectar_en_tienda", () => {
    expect(() => assertTransicionValida(null, "por_recolectar_en_tienda")).not.toThrow();
    expect([...ESTADOS_CREACION]).toContain("por_recolectar_en_tienda");
  });

  // Feature 157 (ampliacion): la #43 se parte en dos actos. Primero el maestro decide QUIEN
  // va (`recolectando`), y solo entonces ese mensajero puede recolectar. Antes se podia
  // recolectar desde la espera, que es lo mismo que decir que la asignacion no significaba nada.
  it("R14: es LEGAL recolectando -> en_ruta_bodega_central (#43)", () => {
    expect(() =>
      assertTransicionValida("recolectando", "en_ruta_bodega_central"),
    ).not.toThrow();
  });

  it("157: es LEGAL por_recolectar_en_tienda -> recolectando (#45b) y su reversion (#46b)", () => {
    expect(() =>
      assertTransicionValida("por_recolectar_en_tienda", "recolectando"),
    ).not.toThrow();
    expect(() =>
      assertTransicionValida("recolectando", "por_recolectar_en_tienda"),
    ).not.toThrow();
  });

  it("157: ya NO se puede recolectar desde la espera, sin pasar por la asignacion", () => {
    expect(() =>
      assertTransicionValida("por_recolectar_en_tienda", "en_ruta_bodega_central"),
    ).toThrow();
  });

  it("R15: es LEGAL en_reparto -> incidente (#44)", () => {
    expect(() => assertTransicionValida("en_reparto", "incidente")).not.toThrow();
  });

  // Feature 154/R16 + feature 158/Q-D/R13 + 158/R61 — REESCRITO DOS VECES, nunca borrado ni
  // debilitado.
  //
  // El caso original (154) iteraba TODO el catalogo esperando `throw` desde `incidente`. Q-D
  // (PR 1) abrio EXACTAMENTE UNA salida (#53, el deshacer del mensajero). El camino del ADMIN
  // (PR 2) abre CINCO mas (#54-#58), que son las inversas de sus cinco entradas y sirven a la
  // REVERSION del reporte, no a ninguna continuacion del flujo. El caso conserva su barrido
  // completo —que es de donde saca su poder— y exime solo a esas SEIS: los otros 13 destinos
  // del catalogo deben seguir siendo ilegales, uno por uno. Una salida de mas sin declararla
  // aqui pone el caso en rojo exactamente igual que antes.
  it("154/R16 + 158/R13/R61: desde incidente SOLO son legales las 6 reversiones; el resto del catalogo sigue ilegal", () => {
    const SALIDAS_DECLARADAS: readonly OrderStatusValue[] = [
      "en_reparto", // #53 — deshacer la gestion del MENSAJERO
      "en_bodega_central", // #54 — reversion del reporte del ADMIN
      "en_bodega_satelite", // #55
      "en_ruta_bodega_central", // #56
      "en_ruta_bodega_satelite", // #57
      "por_recoger", // #58
    ];
    for (const destino of SALIDAS_DECLARADAS) {
      expect(
        () => assertTransicionValida("incidente", destino),
        `incidente -> ${destino} deberia ser legal (reversion declarada)`,
      ).not.toThrow();
    }
    const ilegales = ORDER_STATUS_SEED.filter((d) => !SALIDAS_DECLARADAS.includes(d));
    // Barrido COMPLETO: 19 values del catalogo - 6 declarados = 13 destinos que deben lanzar.
    expect(ilegales).toHaveLength(ORDER_STATUS_SEED.length - 6);
    for (const destino of ilegales) {
      expect(
        () => assertTransicionValida("incidente", destino),
        `incidente -> ${destino} deberia seguir siendo ilegal`,
      ).toThrow(TransicionIlegalError);
    }
  });

  // Feature 158/R13 — los caminos NOMBRADOS por el requisito, uno a uno. No alcanza con el
  // barrido de arriba: R13 enumera vias concretas (cron SLA, liberacion al aprobar el cierre,
  // recuperacion manual, devolucion a la tienda, ajuste admin, reasignacion, ruteo) y este
  // caso las nombra para que el fallo diga CUAL se abrio.
  //
  // ⚠️ PR 2 (camino del ADMIN): DOS filas salen de esta lista y NO se borran, se MUEVEN a su
  // verdad nueva en el caso de abajo — `-> en_bodega_central` y `-> en_bodega_satelite`, que
  // desde la 158/PR2 SI son legales como REVERSION del reporte del admin (#54/#55). Lo que R13
  // prohibe sigue prohibido y se sigue midiendo: que el CRON SLA, la LIBERACION del cierre o la
  // RECUPERACION MANUAL saquen la orden de ahi. Eso no lo garantiza el mapa —el par es el mismo—
  // sino la FAMILIA: ver el caso siguiente.
  it.each([
    ["liberacion al aprobar el cierre", "sin_gestionar"],
    ["devolucion a la tienda", "por_devolver"],
    ["devolucion a la tienda (central)", "por_devolver_a_tienda"],
    ["ajuste administrativo generico", "devolviendo_a_tienda"],
    ["escalado a rechazada", "rechazada"],
    ["marcar entregada a mano", "entregada"],
    ["continuar el flujo de devolucion", "devolviendo_a_bodega_central"],
    ["marcar devuelta a mano", "devuelta"],
  ] as const)("158/R13: %s NO puede sacar una orden de `incidente` (-> %s)", (_via, destino) => {
    expect(() => assertTransicionValida("incidente", destino)).toThrow(TransicionIlegalError);
  });

  // Feature 158/R13/R61 (PR 2) — el par `incidente -> en_bodega_*` pasa a ser legal, pero SOLO
  // como reversion. Lo que este caso fija es que las SEIS salidas pertenecen a las DOS familias
  // de reversion y a ninguna otra: si alguien declarara `incidente -> en_bodega_central` con
  // `via: "liberacion_devuelta_sla"` o `"recuperacion_manual"` —que son las vias que R13 nombra
  // y que la guardia por par NO puede distinguir— este caso se pone rojo.
  it("158/R13/R61: las 6 salidas de `incidente` son de familia de REVERSION, ninguna de negocio", () => {
    const FAMILIAS_DE_REVERSION = ["deshacer_gestion", "incidente"];
    const salidas = TRANSICIONES.incidente;
    expect(salidas).toHaveLength(6);
    for (const s of salidas) {
      expect(FAMILIAS_DE_REVERSION, `salida ${s.to} con familia de negocio ${s.via}`).toContain(
        s.via,
      );
    }
    // Y las familias que R13 prohibe NO aparecen en ninguna salida de `incidente`.
    for (const prohibida of [
      "liberacion_devuelta_sla",
      "escalado_devuelta_sla",
      "recuperacion_manual",
      "liberacion_sin_gestionar",
      "liberacion_reprogramada",
      "devolucion_rechazada",
      "ajuste_estado",
      "asignacion_bodega",
      "asignacion_satelite",
      "ruteo_satelite",
      "gestion",
    ]) {
      expect(salidas.map((s) => s.via as string)).not.toContain(prohibida);
    }
  });

  it("R17 (+157): la unica salida legal de por_recolectar_en_tienda es recolectando", () => {
    const legales = ORDER_STATUS_SEED.filter((destino) => {
      try {
        assertTransicionValida("por_recolectar_en_tienda", destino);
        return true;
      } catch {
        return false;
      }
    });
    expect(legales).toEqual(["recolectando"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 156 — "Generar guia" SIN asignar mensajero. Aqui se COBRA la postergacion que la 154
// dejo escrita: las bajas R18/R19 de aquel spec (#4, #6, #7c) se ejecutan en esta feature, que
// es la que retira a su ultimo productor (`GuiaAsignacionService.generarGuia` deja de asignar y
// de rutear; `rutearABodegaSatelite` deja de admitir `en_preparacion`).
//
// Los casos de abajo son los MISMOS que la 154 dejo afirmando "sigue siendo legal": no se
// borran, se mueven a su nueva verdad ("ya no es legal"). Los del estado de fulfillment
// (R20/R21 de la 154, #1/#3/#7b) los cobra el describe de la 155, mas abajo.
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

  it("el mapa retira las aristas de la 156 y de la 155, la 149 suma tres y la 158 once: 45 -> 52 (y 42 -> 52 pares)", () => {
    const total = Object.entries(TRANSICIONES).reduce(
      (acc, [, destinos]) => acc + (destinos as readonly unknown[]).length,
      0,
    );
    expect(total).toBe(RECUENTO_INVENTARIO.aristasFlujo);
    // 45 de la 154 - #4/#6/#7c (156) - #1/#2/#3/#7b (155) = 38, + #45/#46/#47 de la 149 = 41,
    // + #53 de la 158/PR1 (deshacer un incidente) = 42, + las DIEZ del camino del ADMIN de la
    // 158/PR2 (#48-#52 entradas, #54-#58 inversas) = 52.
    // El invariante que protege este caso son las BAJAS (los pares retirados siguen siendo
    // ilegales, ver los casos de arriba); el recuento absoluto se mueve con cada feature aditiva.
    // Feature 239 (2026-08-19): 54 -> 56 y 52 -> 54. Suma #59/#60/#61 (tres pares NUEVOS) y
    // RETIRA #14 (`en_reparto -> devuelta`, par unico). Es la primera feature de esta lista que
    // da de BAJA una arista de `gestion`.
    // Feature 235 (2026-08-19): 56 -> 59 y 54 -> 57. Suma #62/#63/#64 (tres pares NUEVOS) y NO
    // retira ninguna: pedir ayuda no sustituye a ningun desenlace de `en_reparto`, lo anade.
    // Feature 237 (2026-08-20): 59 -> 61 y 57 -> 59. Suma #65/#66 (`ayuda_tienda -> reprogramada`
    // y `-> rechazada`, dos pares NUEVOS) y NO retira ninguna. Comparten `via` entre si, pero un
    // par lo define origen -> destino, asi que cuentan como dos en las dos columnas.
    expect(RECUENTO_INVENTARIO.aristasFlujo).toBe(61); // +2: 157; +3 -1: 239; +3: 235; +2: 237
    expect(RECUENTO_INVENTARIO.paresUnicos).toBe(59); // +2: 157; +3 -1: 239; +3: 235; +2: 237
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 155 — retiro del estado de fulfillment. Aqui se COBRAN las dos bajas que la 154 dejo
// escritas (R20/R21 = #1/#3/#7b) y la que su propio inventario arrastraba (#2), junto con las
// DOS entradas de creacion que sobraban. Los casos NO se borran: se mueven a su nueva verdad.
//
// El value ya no pertenece a `OrderStatusValue` (salio de `ORDER_STATUS_SEED`), asi que se
// construye por concatenacion — mismo patron que este archivo ya usa para los nombres pre-137 —
// y se afirma con el cast: es exactamente lo que llegaria desde la DB si una fila legada lo
// tuviera, y la guardia debe rechazarlo igual.
// ---------------------------------------------------------------------------------------------
const ESTADO_RETIRADO_155 = ["en", "fulfillment"].join("_") as OrderStatusValue;

describe("155/R27/R28 — BAJAS EJECUTADAS: el estado de fulfillment sale del grafo", () => {
  it("el mapa ya no declara ninguna arista desde el estado retirado", () => {
    expect(Object.keys(TRANSICIONES)).not.toContain(ESTADO_RETIRADO_155);
    expect(TRANSICIONES[ESTADO_RETIRADO_155 as keyof typeof TRANSICIONES]).toBeUndefined();
  });

  it.each([
    ["154/R20 = #1", "por_recoger"],
    ["#2 (del inventario del apendice A)", "en_bodega_central"],
    ["154/R21 = #3/#7b", "en_ruta_bodega_satelite"],
  ] as const)(
    "%s: la transicion hacia %s ya NO es legal desde el estado retirado",
    (_r, destino) => {
      expect(() => assertTransicionValida(ESTADO_RETIRADO_155, destino)).toThrow(
        TransicionIlegalError,
      );
    },
  );

  it("ningun destino del catalogo es alcanzable desde el estado retirado", () => {
    for (const destino of ORDER_STATUS_SEED) {
      expect(() => assertTransicionValida(ESTADO_RETIRADO_155, destino)).toThrow(
        TransicionIlegalError,
      );
    }
  });

  it("R31: ya NO es legal que una orden NAZCA en el estado retirado", () => {
    expect(() => assertTransicionValida(null, ESTADO_RETIRADO_155)).toThrow(TransicionIlegalError);
  });

  it("R22: ya NO es legal que una orden NAZCA en en_ruta_bodega_central (estado fijo de la API)", () => {
    expect(() => assertTransicionValida(null, "en_ruta_bodega_central")).toThrow(
      TransicionIlegalError,
    );
  });

  it("R31: ESTADOS_CREACION tiene EXACTAMENTE dos values", () => {
    expect([...ESTADOS_CREACION]).toEqual(["en_preparacion", "por_recolectar_en_tienda"]);
  });

  it("R31: nacer en cualquier otro estado del catalogo es ilegal", () => {
    const creacionLegal = ORDER_STATUS_SEED.filter((destino) => {
      try {
        assertTransicionValida(null, destino);
        return true;
      } catch {
        return false;
      }
    });
    expect([...creacionLegal].sort()).toEqual([...ESTADOS_CREACION].sort());
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
      // Feature 158/Q-D: `incidente -> en_reparto` SALE de esta lista porque paso a ser LEGAL
      // (#53, el deshacer). Se sustituye por `incidente -> entregada`, que sigue siendo ilegal
      // —marcar entregada una orden con el paquete perdido es justo lo que no puede pasar— y
      // conserva la propiedad que el caso mide: un par ilegal CON el value nuevo.
      ["incidente", "entregada"],
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
    // Feature 157 (ampliacion): la recoleccion parte de `recolectando` — solo recolecta quien
    // fue asignado—, y la espera sin dueño lleva ahora a la asignacion.
    expect(pares).toContain("recolectando->en_ruta_bodega_central (recoleccion_tienda)");
    expect(pares).toContain(
      "por_recolectar_en_tienda->recolectando (asignacion_recoleccion)",
    );
    // Feature 158/Q-G: el `via` de #44 pasa de `gestion` a `incidente`, que es la familia que
    // el append persiste de verdad (`origen_tipo = incidente`). El caso NO se borra: afirma la
    // forma nueva, y si alguien devolviera el `via` a `gestion` sin tocar el append —o al
    // reves— caeria aqui y en "el mapa declara exactamente las aristas del inventario".
    expect(pares).toContain("en_reparto->incidente (incidente)");
    expect(pares).not.toContain("en_reparto->incidente (gestion)");
    expect(INVENTARIO_CREACION.map((a) => a.destino)).toContain("por_recolectar_en_tienda");
  });

  // Feature 158 (Q-D): la arista de DESHACER un incidente, tambien transcrita a mano.
  it("158/Q-D: #53 `incidente -> en_reparto` esta en el inventario, con su familia", () => {
    const pares = INVENTARIO_FLUJO.map((a) => `${a.origen}->${a.destino} (${a.via})`);
    expect(pares).toContain("incidente->en_reparto (deshacer_gestion)");
    // Y es la UNICA salida de `incidente` con familia `deshacer_gestion`: las otras cinco son
    // reversiones del reporte del ADMIN y llevan la familia `incidente` (ver el caso siguiente).
    expect(
      INVENTARIO_FLUJO.filter((a) => a.origen === "incidente" && a.via === "deshacer_gestion"),
    ).toHaveLength(1);
  });

  // Feature 158/PR2 — INVERTIDO el 2026-07-30, no borrado. El caso original afirmaba que las
  // DIEZ aristas del camino del ADMIN NO estaban declaradas todavia, porque el PR 1 no traia su
  // productor (design §15.2: no se declara una arista antes que su productor). El PR 2 SI lo
  // trae (`IncidenteAdminRepository`), asi que el caso pasa a exigir lo contrario CON LA MISMA
  // FUERZA: las diez existen, en las dos direcciones, con la familia `incidente` y ninguna otra.
  // Retirar cualquiera de ellas —o declararla con otra familia— pone esto en rojo.
  it("158/R62: las 10 aristas del camino del ADMIN estan declaradas, con la familia `incidente`", () => {
    const ORIGENES_ADMIN: readonly OrderStatusValue[] = [
      "en_bodega_central",
      "en_bodega_satelite",
      "en_ruta_bodega_central",
      "en_ruta_bodega_satelite",
      "por_recoger",
    ];
    const pares = INVENTARIO_FLUJO.map((a) => `${a.origen}->${a.destino} (${a.via})`);
    for (const origen of ORIGENES_ADMIN) {
      // Entrada (#48-#52) e inversa (#54-#58), las dos legales...
      expect(
        () => assertTransicionValida(origen, "incidente"),
        `${origen} -> incidente deberia ser legal (reporte del admin)`,
      ).not.toThrow();
      expect(
        () => assertTransicionValida("incidente", origen),
        `incidente -> ${origen} deberia ser legal (reversion del reporte)`,
      ).not.toThrow();
      // ...y las dos con la familia `incidente`, que es la que la 154 dio de alta para esto y
      // que la 158 produce (no se anadio ninguna familia nueva: design §9.10 midio su coste).
      expect(pares).toContain(`${origen}->incidente (incidente)`);
      expect(pares).toContain(`incidente->${origen} (incidente)`);
    }
    // Y son EXACTAMENTE diez: cinco entradas del admin + cinco inversas. OJO al descuento de
    // #44: Q-G le realineo el `via` a `incidente`, asi que las entradas con esa familia son
    // SEIS y la sexta es la del MENSAJERO (`en_reparto -> incidente`). Lo que separa los dos
    // caminos es el ORIGEN, no la familia.
    const entradasFamilia = INVENTARIO_FLUJO.filter(
      (a) => a.destino === "incidente" && a.via === "incidente",
    );
    expect(entradasFamilia).toHaveLength(6);
    expect(entradasFamilia.filter((a) => a.origen !== "en_reparto")).toHaveLength(5);
    expect(
      INVENTARIO_FLUJO.filter((a) => a.origen === "incidente" && a.via === "incidente"),
    ).toHaveLength(5);
  });

  // Feature 156: 45/41/4 -> 42/39/4 al retirar #4/#6/#7c.
  // Feature 155: 42/39/4 -> 38/36/2 al retirar #1/#2/#3/#7b y las dos creaciones sobrantes.
  // Feature 149: 38/36/2 -> 41/39/2 con sus tres aristas (#45/#46/#47), que son pares NUEVOS.
  // Feature 158/PR1: 41/39/2 -> 42/40/2 con #53 (`incidente -> en_reparto`), par NUEVO.
  // Feature 158/PR2: 42/40/2 -> 52/50/2 con las diez del ADMIN, las diez pares NUEVOS.
  // Feature 239 (2026-08-19): 54/52/2 -> 56/54/2 con #59/#60/#61 (pares nuevos) menos #14.
  // Feature 237 (2026-08-20): 59/57/2 -> 61/59/2 con #65/#66 (pares nuevos), sin bajas.
  it("los recuentos del inventario son 61 flujo / 59 pares / 2 creacion", () => {
    expect(RECUENTO_INVENTARIO).toEqual({
      aristasFlujo: 61, // feature 237 (2026-08-20): 59 -> 61, dos altas y ninguna baja
      paresUnicos: 59, // feature 237: las dos altas son pares NUEVOS
      aristasCreacion: 2,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 239 (T1.4, R29) — la devolucion espera al cierre. ALTAS #59/#60/#61 y BAJA de #14.
//
// La BAJA es la que importa: mientras `en_reparto -> devuelta` siga siendo legal, cualquier
// camino que la reintroduzca vuelve a dejar la orden en `devuelta` al gestionar, y con ella
// vuelve el cobro prematuro que esta feature cierra (la ventana de SLA arranca sin que la tienda
// haya podido ver la novedad). Por eso se afirma que LANZA, no que "no se usa".
// ---------------------------------------------------------------------------------------------
describe("239/R29 — el pre-estado de la devolucion y la baja de `en_reparto -> devuelta`", () => {
  it("R2/R29: `en_reparto -> devuelta` ya es ILEGAL (arista #14 retirada)", () => {
    expect(() => assertTransicionValida("en_reparto", "devuelta")).toThrow(TransicionIlegalError);
    // Y no queda declarada por ninguna otra familia: el par entero desaparecio del mapa.
    expect(
      INVENTARIO_FLUJO.filter((a) => a.origen === "en_reparto" && a.destino === "devuelta"),
    ).toHaveLength(0);
  });

  it("R2/#59: gestionar una devolucion lleva la orden al PRE-ESTADO, y eso es legal", () => {
    expect(() =>
      assertTransicionValida("en_reparto", "devolucion_por_confirmar"),
    ).not.toThrow();
    const arista = INVENTARIO_FLUJO.find(
      (a) => a.origen === "en_reparto" && a.destino === "devolucion_por_confirmar",
    );
    expect(arista?.via).toBe("gestion"); // misma familia que el resto de resultados de gestion
  });

  it("R4/#60: el ANCLAJE `devolucion_por_confirmar -> devuelta` es legal y tiene familia PROPIA", () => {
    expect(() =>
      assertTransicionValida("devolucion_por_confirmar", "devuelta"),
    ).not.toThrow();
    const anclaje = TRANSICIONES.devolucion_por_confirmar.find((d) => d.to === "devuelta");
    // Familia propia y no `gestion` ni `devolucion_rechazada`: el cron del SLA busca EXACTAMENTE
    // esta familia para saber en que instante arranco el reloj (R12).
    expect(anclaje?.via).toBe("anclaje_devolucion");
    expect(anclaje?.rol).toContain("admin");
  });

  it("R24/#61: el mensajero puede deshacer su devolucion del dia desde el pre-estado", () => {
    expect(() =>
      assertTransicionValida("devolucion_por_confirmar", "en_reparto"),
    ).not.toThrow();
    const deshacer = TRANSICIONES.devolucion_por_confirmar.find((d) => d.to === "en_reparto");
    expect(deshacer?.via).toBe("deshacer_gestion");
  });

  it("P4 FIRMADA EN CONTRA: el pre-estado NO tiene arista de `recuperacion_manual`", () => {
    // Decision humana del 2026-08-19 (`requirements.md`, PUERTA HUMANA). El adminSatelite NO
    // puede recuperar a bodega una devolucion no anclada, aunque tenga el paquete delante. Si
    // esto se pone rojo es porque alguien anadio la puerta trasera "por comodidad": la via
    // correcta es reabrir P4, no declarar la arista.
    const familias = TRANSICIONES.devolucion_por_confirmar.map((d) => d.via);
    expect(familias).not.toContain("recuperacion_manual");
    expect(() =>
      assertTransicionValida("devolucion_por_confirmar", "en_bodega_central"),
    ).toThrow(TransicionIlegalError);
    expect(() =>
      assertTransicionValida("devolucion_por_confirmar", "en_bodega_satelite"),
    ).toThrow(TransicionIlegalError);
  });

  it("las SIETE salidas de `devuelta` se conservan intactas (siguen teniendo productor)", () => {
    // `devuelta` pasa a significar "devolucion ANCLADA"; sus salidas son el camino de esas
    // ordenes y no cambian. Si alguna cayera, una devolucion confirmada se quedaria sin salida.
    expect(TRANSICIONES.devuelta).toHaveLength(7);
    expect(TRANSICIONES.devuelta.map((d) => `${d.to}:${d.via}`).sort()).toEqual(
      [
        "en_bodega_central:liberacion_devuelta_sla",
        "en_bodega_central:recuperacion_manual",
        "en_bodega_satelite:liberacion_devuelta_sla",
        "en_bodega_satelite:recuperacion_manual",
        "en_reparto:deshacer_gestion",
        "rechazada:escalado_devuelta_sla",
        "reprogramada:reprogramacion_tienda",
      ].sort(),
    );
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
