import { describe, it, expect } from "vitest";
import {
  ANALITICA_TAGS,
  METRICAS,
  getMetrica,
  listarMetricas,
  sonSumables,
  tagDeDominio,
} from "@/lib/analytics/metrics";
import { DIMENSIONES, MENSAJERO_SIN_ASIGNAR, ROLES_ANALITICA } from "@/lib/analytics/types";
import type { DimensionAnalitica, EstadoProduccion, Metrica } from "@/lib/analytics/types";
import { esAccesoTotal } from "@/lib/auth/acceso-total";

// Feature 135 / T3.2 + T3.5 — invariantes ESTRUCTURALES del catalogo de KPIs.
// Cada grupo lleva el `R<n>` que verifica. El catalogo es contrato (D1 «todas»,
// 2026-07-30): 15 ids operativos + 8 financieros = 23 metricas. La feature 173 anadio
// DOS financieras (`dinero_en_caja` y `ganancia_ordenex`) con autorizacion humana propia y
// fechada: `progress/decision_F2_173.md` (P4), 2026-08-03. Total vigente: 15 + 10 = 25.
//
// Estos tests NO comprueban ningun calculo (la 135 declara, no computa): comprueban
// que la declaracion es completa, cerrada y coherente consigo misma, que es
// justamente lo que las 13 features consumidoras dan por supuesto.

/** Las DOCE claves de R3, en orden alfabetico para comparar sin depender del orden. */
const CLAVES_DE_UNA_METRICA = [
  "alcance",
  "clase",
  "definicion",
  "descripcion",
  "dominio",
  "estadoProduccion",
  "etiqueta",
  "fuente",
  "granos",
  "id",
  "unidad",
  "unidadDeConteo",
];

/** Las cinco de D10/R35: se cuentan por GESTION, nunca por orden. */
const METRICAS_POR_GESTION = [
  "entregas",
  "devoluciones",
  "rechazos",
  "reprogramaciones",
  "incidentes",
];

const TASAS = ["tasa_entrega", "tasa_devolucion", "tasa_rechazo"];

describe("catalogo de metricas · tamano del contrato (D1)", () => {
  it("declara exactamente las 25 metricas aprobadas", () => {
    // 23 de la 135 (D1, 2026-07-30) + 2 de la 173 (P4, `progress/decision_F2_173.md`).
    expect(METRICAS).toHaveLength(25);
  });

  it("declara quince metricas operativas y diez financieras", () => {
    // Las operativas NO se tocan: la 173 es una feature de dinero de punta a punta.
    expect(listarMetricas({ dominio: "operativa" })).toHaveLength(15);
    expect(listarMetricas({ dominio: "financiera" })).toHaveLength(10);
  });
});

describe("R3 · forma completa de una metrica", () => {
  it("declara las 12 claves exactas y ninguna extra", () => {
    for (const metrica of METRICAS) {
      expect(Object.keys(metrica).sort(), `metrica ${metrica.id}`).toEqual(CLAVES_DE_UNA_METRICA);
    }
  });

  it("no compila una entrada a la que le falte unidadDeConteo", () => {
    // @ts-expect-error R3: falta `unidadDeConteo`; una entrada incompleta NO debe compilar.
    const incompleta: Metrica = {
      id: "metrica_incompleta",
      etiqueta: "Incompleta",
      descripcion: "Le falta unidadDeConteo a proposito.",
      dominio: "operativa",
      clase: "live",
      unidad: "conteo",
      estadoProduccion: "declarada",
      granos: ["fecha"],
      fuente: { tipo: "tabla_viva", tablas: ["orden"] },
      alcance: {
        maestro: "total",
        admin: "total",
        adminSatelite: "acotado",
        adminTienda: "acotado",
        mensajero: "acotado",
      },
      definicion: {},
    };
    expect(incompleta.id).toBe("metrica_incompleta");
  });
});

describe("R4 · identidad estable de cada metrica", () => {
  it("no repite ningun id", () => {
    const ids = METRICAS.map((m) => m.id);
    expect(new Set(ids).size).toBe(METRICAS.length);
  });

  it("escribe todos los ids en snake_case y ninguno vacio", () => {
    for (const metrica of METRICAS) {
      expect(metrica.id, `id invalido: "${metrica.id}"`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("encuentra por id cualquier metrica declarada", () => {
    for (const metrica of METRICAS) {
      expect(getMetrica(metrica.id)).toBe(metrica);
    }
  });

  it("devuelve undefined para un id desconocido en vez de lanzar", () => {
    expect(() => getMetrica("no_existe")).not.toThrow();
    expect(getMetrica("no_existe")).toBeUndefined();
    expect(getMetrica("")).toBeUndefined();
  });
});

describe("R5 · dominio y clase", () => {
  it("restringe dominio a operativa o financiera", () => {
    for (const metrica of METRICAS) {
      expect(["operativa", "financiera"]).toContain(metrica.dominio);
    }
  });

  it("es snapshot si y solo si su fuente es el rollup analytics_daily", () => {
    for (const metrica of METRICAS) {
      const esRollup = metrica.fuente.tipo === "rollup";
      expect(metrica.clase === "snapshot", `metrica ${metrica.id}`).toBe(esRollup);
      if (esRollup) expect([...metrica.fuente.tablas]).toEqual(["analytics_daily"]);
    }
  });
});

describe("R7 · alcance por rol declarado y exhaustivo", () => {
  it("declara los 5 roles exactos sin apiKey", () => {
    for (const metrica of METRICAS) {
      expect(Object.keys(metrica.alcance).sort(), `metrica ${metrica.id}`).toEqual(
        [...ROLES_ANALITICA].sort(),
      );
      expect(Object.keys(metrica.alcance)).not.toContain(["api", "Key"].join(""));
    }
  });

  it("usa solo los tres valores del dominio cerrado de alcance", () => {
    for (const metrica of METRICAS) {
      for (const alcance of Object.values(metrica.alcance)) {
        expect(["total", "acotado", "prohibido"]).toContain(alcance);
      }
    }
  });

  it("da acceso total a maestro y admin en toda metrica", () => {
    // El criterio NO es una lista de roles escrita a mano: es el helper que ya define
    // la equivalencia maestro ~ admin en el repo (`lib/auth/acceso-total.ts`). Si
    // alguien rompe esa equivalencia, este test cae.
    const conAccesoTotal = ROLES_ANALITICA.filter((rol) => esAccesoTotal(rol));
    expect([...conAccesoTotal].sort()).toEqual(["admin", "maestro"]);

    for (const metrica of METRICAS) {
      for (const rol of conAccesoTotal) {
        expect(metrica.alcance[rol], `metrica ${metrica.id} / rol ${rol}`).toBe("total");
      }
    }
  });
});

describe("R10 · granos declarados", () => {
  it("usa solo dimensiones del dominio cerrado", () => {
    for (const metrica of METRICAS) {
      for (const grano of metrica.granos) {
        expect(DIMENSIONES, `metrica ${metrica.id}`).toContain(grano);
      }
    }
  });

  it("incluye siempre el grano fecha", () => {
    for (const metrica of METRICAS) {
      expect(metrica.granos, `metrica ${metrica.id}`).toContain("fecha");
    }
  });

  it("no repite un grano dentro de la misma metrica", () => {
    for (const metrica of METRICAS) {
      expect(new Set(metrica.granos).size, `metrica ${metrica.id}`).toBe(metrica.granos.length);
    }
  });

  it("no compila una dimension inventada", () => {
    // @ts-expect-error R10: "cliente" no pertenece al dominio cerrado de dimensiones.
    const granos: readonly DimensionAnalitica[] = ["fecha", "cliente"];
    expect(granos).toHaveLength(2);
  });
});

describe("R11 · los intentos de entrega no se redefinen", () => {
  it("primer_intento_ok remite al criterio de intentos vigentes del historial", () => {
    const metrica = getMetrica("primer_intento_ok");
    expect(metrica).toBeDefined();
    expect(metrica!.definicion.criterio).toBe("intentos_vigentes_historial");
  });

  it("primer_intento_ok no declara umbral propio ni columna materializada", () => {
    const definicion = getMetrica("primer_intento_ok")!.definicion;
    for (const clave of Object.keys(definicion)) {
      expect(clave, `clave sospechosa en primer_intento_ok: ${clave}`).not.toMatch(
        /umbral|limite|dias|horas|columna|materializ/i,
      );
    }
    // Tampoco por la puerta de atras: nada de "intentos <= 1" escrito a mano.
    expect(definicion.razon).toBeUndefined();
  });

  it("ninguna otra metrica inventa un criterio de intentos distinto", () => {
    for (const metrica of METRICAS) {
      if (metrica.definicion.criterio !== undefined) {
        expect(metrica.definicion.criterio, `metrica ${metrica.id}`).toBe(
          "intentos_vigentes_historial",
        );
      }
    }
  });
});

describe("R12 · etiquetas de invalidacion por dominio", () => {
  it("expone una etiqueta estable por dominio", () => {
    expect(ANALITICA_TAGS).toEqual({
      operativa: "analitica:operativa",
      financiera: "analitica:financiera",
    });
  });

  it("deriva la etiqueta de cualquier metrica sin inventar cadenas", () => {
    expect(tagDeDominio("operativa")).toBe("analitica:operativa");
    expect(tagDeDominio("financiera")).toBe("analitica:financiera");
    for (const metrica of METRICAS) {
      expect(tagDeDominio(metrica.dominio)).toBe(ANALITICA_TAGS[metrica.dominio]);
    }
  });

  it("distingue la etiqueta operativa de la financiera", () => {
    expect(tagDeDominio("operativa")).not.toBe(tagDeDominio("financiera"));
  });
});

describe("R30 · cubo sin_asignar en el grano de mensajero", () => {
  it("agrupa las ordenes sin mensajero en el cubo sin_asignar", () => {
    const conGranoMensajero = METRICAS.filter((m) => m.granos.includes("mensajero"));
    expect(conGranoMensajero.length).toBeGreaterThan(0);
    for (const metrica of conGranoMensajero) {
      expect(metrica.definicion.sinAsignar, `metrica ${metrica.id}`).toBe("incluir");
    }
  });

  it("expone el literal del cubo como constante unica", () => {
    expect(MENSAJERO_SIN_ASIGNAR).toBe("sin_asignar");
  });

  it("no declara sinAsignar en metricas que no agrupan por mensajero", () => {
    for (const metrica of METRICAS) {
      if (!metrica.granos.includes("mensajero")) {
        expect(metrica.definicion.sinAsignar, `metrica ${metrica.id}`).toBeUndefined();
      }
    }
  });
});

describe("R33 · metricas declaradas sin productor", () => {
  it("admite metricas declaradas sin productor", () => {
    for (const metrica of METRICAS) {
      expect(["producida", "declarada"], `metrica ${metrica.id}`).toContain(
        metrica.estadoProduccion,
      );
    }
    expect(listarMetricas({ estadoProduccion: "declarada" }).length).toBeGreaterThan(0);
  });

  it("no compila un tercer estado de produccion", () => {
    // @ts-expect-error R33: el dominio es cerrado: solo `producida` o `declarada`.
    const estado: EstadoProduccion = "planeada";
    expect(estado).toBe("planeada");
  });

  it("filtra el subconjunto producido de forma consultable", () => {
    const producidas = listarMetricas({ estadoProduccion: "producida" });
    expect(producidas.length).toBeGreaterThan(0);
    for (const metrica of producidas) expect(metrica.estadoProduccion).toBe("producida");
    expect(producidas.length + listarMetricas({ estadoProduccion: "declarada" }).length).toBe(
      METRICAS.length,
    );
  });

  it("combina el filtro de estado de produccion con el de dominio", () => {
    const financierasProducidas = listarMetricas({
      dominio: "financiera",
      estadoProduccion: "producida",
    });
    for (const metrica of financierasProducidas) {
      expect(metrica.dominio).toBe("financiera");
      expect(metrica.estadoProduccion).toBe("producida");
    }
  });
});

describe("R35 · convencion unica: se cuenta por gestion", () => {
  it("cuenta gestiones vigentes, no ordenes", () => {
    for (const id of METRICAS_POR_GESTION) {
      const metrica = getMetrica(id);
      expect(metrica, `falta la metrica ${id}`).toBeDefined();
      expect(metrica!.unidadDeConteo, `metrica ${id}`).toBe("gestion");
      expect(metrica!.definicion.excluye?.join(" "), `metrica ${id}`).toContain("anulada_at");
    }
  });

  it("no declara una familia paralela por orden", () => {
    for (const metrica of METRICAS) {
      expect(metrica.id, `familia paralela detectada: ${metrica.id}`).not.toMatch(/_por_orden$/);
    }
  });

  it("las tasas se declaran sobre gestiones", () => {
    for (const id of TASAS) {
      const metrica = getMetrica(id)!;
      expect(metrica.unidadDeConteo, `metrica ${id}`).toBe("gestion");
      expect([...metrica.definicion.razon!.denominador], `metrica ${id}`).toEqual([
        "entregas",
        "devoluciones",
        "rechazos",
        "incidentes",
      ]);
      // D10: la advertencia va en la propia descripcion, no en un comentario de codigo.
      expect(metrica.definicion.razon!.numerador).toBe(
        { tasa_entrega: "entregas", tasa_devolucion: "devoluciones", tasa_rechazo: "rechazos" }[id],
      );
    }
  });

  it("advierte en la descripcion que el denominador no son ordenes", () => {
    for (const id of TASAS) {
      expect(getMetrica(id)!.descripcion.toLowerCase(), `metrica ${id}`).toContain(
        "no es el numero de ordenes",
      );
    }
  });

  it("cita las gestiones anuladas en la descripcion de toda metrica", () => {
    for (const metrica of METRICAS) {
      expect(metrica.descripcion.toLowerCase(), `metrica ${metrica.id}`).toMatch(
        /gestion(es)? anulada|anulada_at/,
      );
    }
  });

  it("apunta el numerador y el denominador de toda razon a ids reales del catalogo", () => {
    for (const metrica of METRICAS) {
      const razon = metrica.definicion.razon;
      if (!razon) continue;
      expect(getMetrica(razon.numerador), `metrica ${metrica.id}`).toBeDefined();
      for (const id of razon.denominador) {
        expect(getMetrica(id), `metrica ${metrica.id} / denominador ${id}`).toBeDefined();
      }
    }
  });
});

describe("R36 · la unidad de conteo es evidente en la propia metrica", () => {
  it("expone la unidad de conteo de cada metrica dentro del dominio cerrado", () => {
    for (const metrica of METRICAS) {
      expect(["gestion", "orden", "moneda", "tiempo"], `metrica ${metrica.id}`).toContain(
        metrica.unidadDeConteo,
      );
    }
  });

  it("cuenta ordenes en ordenes_creadas y en ordenes_por_estado", () => {
    expect(getMetrica("ordenes_creadas")!.unidadDeConteo).toBe("orden");
    expect(getMetrica("ordenes_por_estado")!.unidadDeConteo).toBe("orden");
  });

  it("sonSumables devuelve false entre entregas y ordenes_creadas", () => {
    expect(sonSumables("entregas", "ordenes_creadas")).toBe(false);
    expect(sonSumables("ordenes_creadas", "entregas")).toBe(false);
  });

  it("sonSumables devuelve true entre entregas y devoluciones", () => {
    expect(sonSumables("entregas", "devoluciones")).toBe(true);
    expect(sonSumables("entregas", "entregas")).toBe(true);
  });

  it("sonSumables devuelve false entre una metrica de dinero y una de gestiones", () => {
    expect(sonSumables("ingreso_flete", "entregas")).toBe(false);
    expect(sonSumables("tiempo_ciclo", "ordenes_creadas")).toBe(false);
  });
});
