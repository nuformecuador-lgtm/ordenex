import { describe, it, expect } from "vitest";
import * as ordenHistorialModule from "@/lib/types/orden-historial";
import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGEN_TIPOS_CON_GESTION,
  ORIGEN_TIPOS_VISITA_REAL,
  RESULTADOS_QUE_CUENTAN_COMO_INTENTO,
} from "@/lib/types/orden-historial";
import { whereIntentosVigentes } from "@/lib/repositories/OrdenHistorialRepository";
import { TRANSICIONES } from "@/lib/types/order-status-transiciones";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 215 (T9) — la DECLARACION del criterio de intento de entrega y su coherencia con el
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

describe("RESULTADOS_QUE_CUENTAN_COMO_INTENTO — el criterio declarado (215/R1/R2/R33)", () => {
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

// Feature 215 (T19/T21, design §3.4) — la SEGUNDA lista de INCLUSION del criterio. La primera
// (`RESULTADOS_QUE_CUENTAN_COMO_INTENTO`) dice QUE resultados cuentan; esta dice de QUIEN: solo
// las gestiones de una VISITA REAL del mensajero. Las gestiones SINTETICAS —el escalado del cron
// SLA y la reprogramacion de escritorio de la tienda— entran al cierre del mensajero por la
// puerta de atras y, sin esta lista, sumarian un intento que nadie hizo. [💰]
describe("ORIGEN_TIPOS_VISITA_REAL — el discriminador de las sinteticas (215/R34)", () => {
  it("R34-a: la lista es EXACTAMENTE `gestion` (la visita del mensajero en calle)", () => {
    expect(ORIGEN_TIPOS_VISITA_REAL).toEqual(["gestion"]);
  });

  // EL CASO QUE PROTEGE EL DINERO (R34-c). Con lista NEGRA (`none`/`notIn` sobre las sinteticas
  // conocidas), una familia sintetica FUTURA empezaria a contar SOLA en cuanto alguien la
  // declarara: subiria el conteo, adelantaria el escalado del cron SLA a `rechazada` y cobraria
  // `cobroRechazado` (56) a la tienda antes de tiempo, en silencio y sin romper ningun test. Con
  // lista de INCLUSION, lo que una familia nueva hace por defecto es NO contar.
  it("R34-c: es lista de INCLUSION — TODAS las demas familias del enum quedan FUERA", () => {
    const dentro = ORIGEN_TIPOS_VISITA_REAL as readonly string[];
    const fuera = (ORDEN_HISTORIAL_ORIGEN_TIPO_SEED as readonly string[]).filter(
      (t) => !dentro.includes(t),
    );
    // Las DOS sinteticas medidas en design §3.4, nombradas una a una para que su exclusion sea
    // una afirmacion y no un efecto colateral del filtro de arriba.
    expect(fuera).toContain("escalado_devuelta_sla"); // R18-b: la del cron SLA
    expect(fuera).toContain("reprogramacion_tienda"); // R12: la de la tienda
    expect(fuera).toHaveLength(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED.length - dentro.length);
    // Y lo que esta dentro es una familia REAL del enum (el `satisfies` lo fuerza en compile
    // time; aqui se comprueba en runtime para que el caso no dependa solo del tipo).
    for (const t of dentro) {
      expect(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED as readonly string[]).toContain(t);
    }
  });

  // La lista no sirve de nada si el predicado no la usa como inclusion. Se mira el `where` REAL.
  it("R34-c: el predicado usa la lista con `in` y NO contiene ningun `none` ni `notIn`", () => {
    const where = whereIntentosVigentes("o1") as unknown as {
      historialEstados: { some: { ordenId: string; origenTipo: { in: string[] } } };
    };
    expect(where.historialEstados.some.origenTipo).toEqual({ in: [...ORIGEN_TIPOS_VISITA_REAL] });
    // El `ordenId` repetido dentro del `some` NO es decorativo: `orden_historial_estado` no tiene
    // indice por `gestion_orden_id`, y repetirlo hace que el `EXISTS` entre por
    // `@@index([ordenId, createdAt])` en vez de recorrer una tabla append-only entera.
    expect(where.historialEstados.some.ordenId).toBe("o1");
    const json = JSON.stringify(where);
    expect(json).not.toContain("none");
    expect(json).not.toContain("notIn");
    // Las dos sinteticas conocidas no aparecen NOMBRADAS en el where: no se excluyen una a una
    // (eso seria lista negra), quedan fuera por no estar en la lista blanca.
    expect(json).not.toContain("escalado_devuelta_sla");
    expect(json).not.toContain("reprogramacion_tienda");
  });
});

describe("sin criterio residual por transicion (215/R13/R25/R26)", () => {
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

describe("TRANSICIONES — guardia de NO-REGRESION del mapa cerrado (215/R14)", () => {
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

  // REASIGNADO en el Grupo 4 (T21): este caso figuraba como el dueno de R12 y NO lo era. Afirma
  // algo cierto —que el MAPA de transiciones no decide intentos— pero distinto de lo que R12
  // exige, que es que la gestion sintetica de `reprogramarDesdeDevuelta` no sume aunque su cierre
  // se apruebe. Eso lo cubre ahora el PREDICADO, en
  // `orden-historial-repository.test.ts` · «R12: la reprogramacion de la TIENDA no cuenta...» y
  // «R12: `devuelta` real + reprogramacion de la tienda en OTRO cierre aprobado -> 1, no 2».
  //
  // El caso se CONSERVA intacto en lo que mide (cubre R14) porque la mutacion que mataba sigue
  // viva: si alguien devolviera al mapa una arista con marca de intento —`cuentaComoIntento`— o
  // reintrodujera un `via` que coincidiera con un `GestionResultado`, este caso rompe. Solo se
  // le retira la etiqueta R12, que era un requisito sin dueno real.
  it("R14: ninguna arista del mapa decide por si sola un intento de entrega", () => {
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

  // INVERTIDO el 2026-08-19 por la feature 239, y hay que leer POR QUE antes de tocarlo: NO es
  // una fusion de criterios (eso seria regresion, R16), es que la arista del mensajero cambio de
  // DESTINO. Desde la 239 gestionar una devolucion deja la orden en `devolucion_por_confirmar`,
  // no en `devuelta`; a `devuelta` se llega al APROBAR el cierre (familia `anclaje_devolucion`).
  //
  // EL CONTEO DE INTENTOS NO CAMBIA (R17), y este caso lo afirma: `whereIntentosVigentes` no
  // mira NINGUN destino de transicion — mira `resultado` (`devuelta` sigue en la lista) y la
  // familia de la fila de historial (`gestion` sigue siendo la que escribe la gestion del
  // mensajero, solo que ahora hacia el pre-estado). Las dos condiciones siguen intactas.
  it("R14/239: la arista del mensajero conserva la familia `gestion` (cambia su DESTINO, no el conteo)", () => {
    const delMensajero = aristas.filter(
      (a) => a.origen === "en_reparto" && a.destino === "devolucion_por_confirmar",
    );
    expect(delMensajero).toHaveLength(1);
    expect(delMensajero[0].via).toBe("gestion"); // R17: la sexta condicion del predicado sigue casando

    // `devuelta` conserva entrada: la del ANCLAJE, con familia PROPIA. Y esa familia NO esta en
    // `ORIGEN_TIPOS_VISITA_REAL`, que es lo que impide que la confirmacion administrativa sume
    // un intento de mas (y con el, un `cobroRechazado` antes de tiempo).
    const aDevuelta = aristas.filter((a) => a.destino === "devuelta");
    expect(aDevuelta.length).toBeGreaterThanOrEqual(1);
    expect(aDevuelta.map((a) => a.via)).toContain("anclaje_devolucion");
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("anclaje_devolucion");
  });

  // R14: `incidente` sigue siendo terminal en el sentido del negocio — todas sus salidas son
  // REVERSIONES (deshacer un reporte erroneo), nunca una continuacion del flujo. REESCRITO en
  // la 215: el caso ya no deriva de aqui "no cuenta como intento" (eso lo decide ahora el
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
