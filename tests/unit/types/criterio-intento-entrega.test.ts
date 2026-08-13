import { describe, it, expect } from "vitest";
import * as ordenHistorialModule from "@/lib/types/orden-historial";
import { ORIGEN_TIPOS_CON_GESTION } from "@/lib/types/orden-historial";
import { RESULTADOS_QUE_CUENTAN_COMO_INTENTO } from "@/lib/types/gestion-orden";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 213 (T9) — la DECLARACION del criterio de intento de entrega y su coherencia con el
// mapa cerrado de la 140. Estos tests no prueban una query: prueban la DECISION.
//
// Por que importan: el conteo que se deriva de aqui gobierna el escalado automatico del cron
// SLA (99), que manda ordenes a `rechazada` y dispara `cobroRechazado` (56) — un cobro real a
// la tienda. Si la lista de resultados se relaja, se cobra antes de tiempo.
//
// Que cambio respecto de la 160: el criterio ya NO se declara con familias de ORIGEN del
// historial. Se declara con RESULTADOS de gestion, y el intento se gana al APROBARSE el cierre.

/** Los 5 valores del enum `GestionResultado` (`db/schema.prisma:654-662`). */
const GESTION_RESULTADOS = [
  "entregada",
  "reprogramada",
  "devuelta",
  "rechazada",
  "incidente",
] as const;

describe("RESULTADOS_QUE_CUENTAN_COMO_INTENTO — el criterio declarado (213/R1/R2/R33)", () => {
  it("R1: la lista es EXACTAMENTE rechazada, devuelta y reprogramada", () => {
    expect(RESULTADOS_QUE_CUENTAN_COMO_INTENTO).toEqual([
      "rechazada",
      "devuelta",
      "reprogramada",
    ]);
  });

  // R1: `rechazada` es la NOVEDAD del criterio. Con el criterio viejo (destinos de transicion)
  // no contaba por ninguna via: su destino no era `devuelta` ni `reprogramada`.
  it("R1: `rechazada` cuenta, y con el criterio viejo no contaba por ninguna via", () => {
    expect(RESULTADOS_QUE_CUENTAN_COMO_INTENTO).toContain("rechazada");
  });

  // R2: la entrega lograda no es un intento fallido; el incidente es un desenlace terminal
  // propio (paquete danado/perdido/robado), no una visita mas.
  it("R2: `entregada` e `incidente` NO estan en la lista", () => {
    expect(RESULTADOS_QUE_CUENTAN_COMO_INTENTO).not.toContain("entregada");
    expect(RESULTADOS_QUE_CUENTAN_COMO_INTENTO).not.toContain("incidente");
  });

  // EL CASO QUE PROTEGE EL DINERO, heredado del proposito del caso homonimo de la 160. La lista
  // se escribe por INCLUSION: cualquier OTRO valor del enum queda fuera POR DEFECTO. Si alguien
  // la reescribiera como "todos menos X", un `resultado` FUTURO empezaria a contar solo,
  // subiria el conteo, adelantaria el escalado del cron SLA y cobraria `cobroRechazado` (56)
  // antes de tiempo, en silencio.
  it("R1: es una lista de INCLUSION — TODOS los demas resultados del enum quedan fuera", () => {
    const dentro = RESULTADOS_QUE_CUENTAN_COMO_INTENTO as readonly string[];
    const fuera = GESTION_RESULTADOS.filter((r) => !dentro.includes(r));
    expect(fuera).toEqual(["entregada", "incidente"]);
    expect(dentro).toHaveLength(GESTION_RESULTADOS.length - fuera.length);
    // Y todo lo que esta dentro es un valor REAL del enum (el `satisfies` lo fuerza en compile
    // time; aqui se comprueba en runtime para que el caso no dependa solo del tipo).
    for (const r of dentro) expect(GESTION_RESULTADOS as readonly string[]).toContain(r);
  });

  // R33 (D6) — LIMITACION DECLARADA. `sin_gestionar` no esta y NO PUEDE estar: no es un valor
  // de `GestionResultado`. Una orden cortada por el cron no tiene fila de `gestion_orden`
  // (`gestion_orden.resultado` es NOT NULL y solo existe si hubo gestion), asi que el corte
  // automatico no aporta ningun resultado nuevo. Consecuencia aceptada: el agujero que dio
  // origen a la ficha —la orden que sale, la corta el cron, vuelve a bodega y sale otra vez con
  // el mismo contador— SIGUE ABIERTO tras esta feature.
  it("R33: `sin_gestionar` no esta en la lista y NO PUEDE estar (no es un GestionResultado)", () => {
    expect(RESULTADOS_QUE_CUENTAN_COMO_INTENTO as readonly string[]).not.toContain(
      "sin_gestionar",
    );
    expect(GESTION_RESULTADOS as readonly string[]).not.toContain("sin_gestionar");
  });
});

describe("sin criterio residual por transicion (213/R13/R25/R26)", () => {
  // R13: "el sistema NO DEBE conservar ningun camino de lectura, activo o inactivo, que derive
  // el conteo de los destinos de las transiciones". La lista blanca de familias de origen que
  // sostenia la rama B del criterio viejo (160) se retira; dejarla huerfana habria sido un
  // segundo derivador legado, es decir un incumplimiento de R6, no una compatibilidad.
  it("R13/R25: `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` ya NO existe como export", () => {
    expect(Object.keys(ordenHistorialModule)).not.toContain(
      "ORIGEN_TIPOS_REPROGRAMADA_INTENTO",
    );
    expect("ORIGEN_TIPOS_REPROGRAMADA_INTENTO" in ordenHistorialModule).toBe(false);
  });

  // R26: `ORIGEN_TIPOS_CON_GESTION` SI se queda, pero con otro dueno: desambigua la nulidad del
  // enlace `gestion_orden_id` en el historial (67/R25-R26). No decide intentos.
  it("R26: `ORIGEN_TIPOS_CON_GESTION` sobrevive con su dueno real (la nulidad del enlace)", () => {
    expect(ORIGEN_TIPOS_CON_GESTION).toEqual(["gestion", "deshacer_gestion"]);
  });
});

describe("TRANSICIONES — guardia de NO-REGRESION del mapa cerrado (213/R12/R14)", () => {
  /** Todas las aristas del mapa, aplanadas a `(origen, destino, via)`. */
  const aristas = Object.entries(TRANSICIONES).flatMap(([origen, destinos]) =>
    (destinos as readonly { to: string; via: string }[]).map((d) => ({
      origen,
      destino: d.to,
      via: d.via,
    })),
  );

  // R14: el mapa NO se toca. Este caso ya existia con la 160; lo que cambia es lo que AFIRMA.
  // Antes derivaba de aqui que la arista #13 contaba como intento y la #22 no. Ahora NINGUNA
  // arista decide intentos: solo se comprueba que el mapa sigue igual.
  it("R14: siguen existiendo EXACTAMENTE 2 aristas con destino `reprogramada` (#13 y #22)", () => {
    const aReprogramada = aristas.filter((a) => a.destino === "reprogramada");
    expect(aReprogramada).toHaveLength(2);
    expect(aReprogramada).toEqual(
      expect.arrayContaining([
        { origen: "en_reparto", destino: "reprogramada", via: "gestion" }, // #13
        { origen: "devuelta", destino: "reprogramada", via: "reprogramacion_tienda" }, // #22
      ]),
    );
  });

  // R12: la conclusion de 160/R2 SOBREVIVE (la reprogramacion de la tienda no suma), pero su
  // razonamiento se reescribe: ya no es "para no contar doble con la fila `devuelta` vigente",
  // es que ninguna transicion suma — el intento se gana con el resultado de gestion del cierre
  // aprobado. `reprogramarDesdeDevuelta` crea una gestion sintetica, pero esa gestion solo
  // podria contar si su cierre llega a `aprobado`, que es el mismo listón que todas.
  it("R12/R14: ninguna arista del mapa decide por si sola un intento de entrega", () => {
    // La afirmacion es estructural: el modulo del mapa no exporta nada que hable de intentos.
    const aristasQueDeciden = aristas.filter((a) =>
      Object.prototype.hasOwnProperty.call(a, "cuentaComoIntento"),
    );
    expect(aristasQueDeciden).toEqual([]);
    // Y el criterio vigente no menciona familias de origen ni destinos: son resultados.
    for (const r of RESULTADOS_QUE_CUENTAN_COMO_INTENTO as readonly string[]) {
      expect(aristas.some((a) => a.via === r)).toBe(false);
    }
  });

  it("R14: `devuelta` sigue teniendo al menos una arista y la del mensajero es de familia `gestion`", () => {
    const aDevuelta = aristas.filter((a) => a.destino === "devuelta");
    expect(aDevuelta.length).toBeGreaterThanOrEqual(1);
    expect(aDevuelta.map((a) => a.via)).toContain("gestion");
  });

  // R14: `incidente` sigue siendo terminal en el sentido del negocio — todas sus salidas son
  // REVERSIONES (deshacer un reporte erroneo), nunca una continuacion del flujo. REESCRITO en
  // la 213: el caso ya no deriva de aqui "no cuenta como intento" (eso lo decide ahora el
  // resultado `incidente`, que esta FUERA de la lista, ver R2 arriba); lo que sigue midiendo,
  // y sigue importando, es que ninguna arista se agrego, retiro ni redirigio.
  it("R14/158-Q-D: las salidas de `incidente` siguen siendo las 6 declaradas, todas reversiones", () => {
    const catalogo = ORDER_STATUS_SEED as readonly string[];
    expect(catalogo).toContain("incidente"); // la 154 ya aterrizo

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
    // Ninguna salida lleva a `devuelta` ni a `reprogramada`: el mapa no se redirigio.
    for (const s of salidas) {
      expect(s.destino).not.toBe("devuelta");
      expect(s.destino).not.toBe("reprogramada");
    }
  });

  // D3 (140): `indemnizada` se planteo y se DESCARTO. No se declara, no se referencia y no se
  // deja preparado nada que desterminalice `incidente`.
  it("R14/D3: no existe ningun estado `indemnizada` declarado ni referenciado", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain("indemnizada");
    expect(aristas.some((a) => a.destino === "indemnizada")).toBe(false);
    expect(aristas.some((a) => a.origen === "indemnizada")).toBe(false);
  });
});
