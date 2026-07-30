import { describe, it, expect } from "vitest";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_REPROGRAMADA_INTENTO,
} from "@/lib/types/orden-historial";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 160 (T1) — la DECLARACION del criterio de intento de entrega y su coherencia con el
// mapa cerrado de la 140. Estos tests no prueban una query: prueban la DECISION.
//
// Por que importan: el conteo que se deriva de aqui gobierna el escalado automatico del cron
// SLA (99), que manda ordenes a `rechazada` y dispara `cobroRechazado` (56) — un cobro real a
// la tienda. Si la lista de familias se relaja, se cobra antes de tiempo.

describe("ORIGEN_TIPOS_REPROGRAMADA_INTENTO — la rama B del criterio (160/R1b/R2)", () => {
  it("R1b: `gestion` ESTA en la lista (arista #13: el mensajero fue y no entrego)", () => {
    expect(ORIGEN_TIPOS_REPROGRAMADA_INTENTO).toContain("gestion");
  });

  // EL CORTE DE LA FEATURE. `reprogramacion_tienda` (#22) es un tramite de escritorio sobre una
  // orden YA devuelta: `reprogramarDesdeDevuelta` NO anula la gestion `devuelta` previa, asi que
  // esa fila sigue vigente y ya conto el intento. Sumar tambien esta seria doble conteo.
  it("R2: `reprogramacion_tienda` NO esta en la lista (seria doble conteo)", () => {
    expect(ORIGEN_TIPOS_REPROGRAMADA_INTENTO).not.toContain("reprogramacion_tienda");
  });

  // R1: el criterio se escribe por INCLUSION. La lista tiene UN solo valor hoy; cualquier otra
  // familia del enum queda fuera POR DEFECTO. Este test es la guarda contra el cambio silencioso
  // a lista negra: si alguien la reescribiera "todas menos X", este test rompe.
  it("R1: es una lista de INCLUSION — TODAS las demas familias del enum quedan fuera", () => {
    const fuera = ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.filter(
      (t) => !(ORIGEN_TIPOS_REPROGRAMADA_INTENTO as readonly string[]).includes(t),
    );
    expect(ORIGEN_TIPOS_REPROGRAMADA_INTENTO).toEqual(["gestion"]);
    expect(fuera).toHaveLength(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length - 1);
    // Nombrado explicitamente porque son las familias que el proximo lector podria querer sumar.
    expect(fuera).toContain("reprogramacion_tienda");
    expect(fuera).toContain("ajuste_estado");
    expect(fuera).toContain("liberacion_reprogramada");
    expect(fuera).toContain("deshacer_gestion");
  });

  it("`deshacer_gestion` esta en la familia CON gestion pero NO cuenta como reprogramacion", () => {
    expect(ORIGEN_TIPOS_CON_GESTION).toContain("deshacer_gestion");
    expect(ORIGEN_TIPOS_REPROGRAMADA_INTENTO).not.toContain("deshacer_gestion");
  });
});

describe("TRANSICIONES — supuestos del criterio contra el mapa cerrado de la 140 (160/R1/R3)", () => {
  /** Todas las aristas del mapa, aplanadas a `(origen, destino, via)`. */
  const aristas = Object.entries(TRANSICIONES).flatMap(([origen, destinos]) =>
    (destinos as readonly { to: string; via: string }[]).map((d) => ({
      origen,
      destino: d.to,
      via: d.via,
    })),
  );

  // Si el mapa ganara una TERCERA arista a `reprogramada`, el criterio de la 160 habria que
  // revisarlo (design §1.2 lo dice explicitamente: se para y se escala). Este test lo detecta.
  it("R1: hay EXACTAMENTE dos aristas con destino `reprogramada`, y son #13 y #22", () => {
    const aReprogramada = aristas.filter((a) => a.destino === "reprogramada");
    expect(aReprogramada).toHaveLength(2);
    expect(aReprogramada).toEqual(
      expect.arrayContaining([
        { origen: "en_reparto", destino: "reprogramada", via: "gestion" }, // #13, cuenta
        { origen: "devuelta", destino: "reprogramada", via: "reprogramacion_tienda" }, // #22, no
      ]),
    );
  });

  // La equivalencia que hace correcto el predicado: `destino = reprogramada AND origen = gestion`
  // identifica EXACTAMENTE la arista #13, ni una mas.
  it("R1b: `reprogramada` + familia `gestion` identifica UNA sola arista, la #13", () => {
    const conGestion = aristas.filter(
      (a) =>
        a.destino === "reprogramada" &&
        (ORIGEN_TIPOS_REPROGRAMADA_INTENTO as readonly string[]).includes(a.via),
    );
    expect(conGestion).toEqual([
      { origen: "en_reparto", destino: "reprogramada", via: "gestion" },
    ]);
  });

  it("R1a: la rama A (`devuelta`) sigue admitiendo cualquier familia de origen", () => {
    const aDevuelta = aristas.filter((a) => a.destino === "devuelta");
    expect(aDevuelta.length).toBeGreaterThanOrEqual(1);
    // Hoy solo la gestion del mensajero (#14); el predicado NO la acota por familia a proposito
    // (design §1.4: endurecerla reduciria conteos y retrasaria escalados).
    expect(aDevuelta.map((a) => a.via)).toContain("gestion");
  });

  // D3/R3 — REESCRITO el 2026-07-30 por la feature 158 (Q-D), no borrado.
  //
  // Este caso se escribio cuando la 154 vivia en otra rama y `incidente` ni existia en el
  // catalogo: por eso era condicional y afirmaba «cero salidas». La 154 lo dio de alta sin
  // salidas y la 158 (Q-D) le declara UNA, la de deshacer. La afirmacion «cero salidas» YA NO
  // es el invariante.
  //
  // Lo que R3 protege de verdad —y lo que este caso pasa a afirmar, MAS fuerte que antes— es
  // que NINGUNA arista que toque `incidente` entra en el conteo de intentos, ni de entrada ni
  // de salida. El conteo tiene exactamente dos ramas: destino `devuelta` (cualquier familia) y
  // destino `reprogramada` con familia en `ORIGEN_TIPOS_REPROGRAMADA_INTENTO`. Si una feature
  // futura declarara `incidente -> devuelta` o `incidente -> reprogramada (gestion)`, el
  // escalado del cron SLA se adelantaria y con el un `cobroRechazado` real: este caso lo caza.
  it("R3: ninguna arista que toque `incidente` entra en el conteo de intentos", () => {
    const catalogo = ORDER_STATUS_SEED as readonly string[];
    expect(catalogo).toContain("incidente"); // la 154 ya aterrizo

    const tocanIncidente = aristas.filter(
      (a) => a.origen === "incidente" || a.destino === "incidente",
    );
    expect(tocanIncidente.length).toBeGreaterThan(0); // el caso no es vacuo

    const cuentaComoIntento = (a: { destino: string; via: string }): boolean =>
      a.destino === "devuelta" ||
      (a.destino === "reprogramada" &&
        (ORIGEN_TIPOS_REPROGRAMADA_INTENTO as readonly string[]).includes(a.via));

    expect(tocanIncidente.filter(cuentaComoIntento)).toEqual([]);
  });

  // La contraparte: `incidente` SIGUE siendo terminal en el sentido del negocio — TODAS sus
  // salidas declaradas son REVERSIONES (deshacer un reporte erroneo), nunca una continuacion del
  // flujo. REESCRITO en el PR 2 de la 158, no borrado: el caso afirmaba «su UNICA salida es
  // #53» y el camino del ADMIN suma las cinco inversas #54-#58. Lo que mide sigue siendo lo
  // mismo y sigue siendo lo que importa AQUI: ninguna salida de `incidente` puede llevar a
  // `devuelta` ni a `reprogramada`, que son los dos unicos destinos que cuentan como intento y
  // que por esa via dispararian un `cobroRechazado` real.
  it("158/Q-D/R61: todas las salidas de `incidente` son reversiones, y ninguna cuenta como intento", () => {
    const salidas = aristas.filter((a) => a.origen === "incidente");
    expect(salidas).toHaveLength(6);
    expect(salidas.map((a) => a.via).sort()).toEqual([
      "deshacer_gestion", // #53, camino del MENSAJERO
      "incidente", // #54-#58, camino del ADMIN
      "incidente",
      "incidente",
      "incidente",
      "incidente",
    ]);
    // Lo que este archivo protege: ningun destino de salida es de los que cuentan.
    for (const s of salidas) {
      expect(s.destino).not.toBe("devuelta");
      expect(s.destino).not.toBe("reprogramada");
    }
  });

  // D3: `indemnizada` se planteo y se DESCARTO. No se declara, no se referencia y no se deja
  // preparado nada que desterminalice `incidente`.
  it("D3: no existe ningun estado `indemnizada` declarado ni referenciado", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain("indemnizada");
    expect(aristas.some((a) => a.destino === "indemnizada")).toBe(false);
    expect(aristas.some((a) => a.origen === "indemnizada")).toBe(false);
  });
});
