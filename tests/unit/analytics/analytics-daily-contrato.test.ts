import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { METRICAS, getMetrica } from "@/lib/analytics/metrics";
import { DIMENSIONES } from "@/lib/analytics/types";
import type { DimensionAnalitica, TablaRollup } from "@/lib/analytics/types";

// Feature 123 / T5 — GUARD DE CONTRATO entre el rollup `analytics_daily` y el catalogo de
// KPIs de la feature 135 (`lib/analytics/metrics.ts`). Cubre R2, R3, R4, R16, R17, R18,
// R19, R20, R23, R27 y R45.
//
// La regla del archivo, y lo unico que lo hace valer algo: TODO lo que se exige del
// esquema se DERIVA del catalogo en tiempo de ejecucion. No hay ni una lista de
// dimensiones ni de medidas escrita a mano y comparada consigo misma; si alguien anade
// manana una metrica snapshot con un grano nuevo, este archivo se pone rojo sin que nadie
// lo edite (R45).
//
// Lado del esquema: se lee `db/schema.prisma` y se extraen las columnas REALES del modelo
// (el `@map` cuando existe, el nombre del campo cuando no). Se lee el schema y no el
// cliente generado a proposito: el cliente sobrevive a un checkout y puede mentir.

const ROOT = path.join(__dirname, "..", "..", "..");
const schemaPrisma = fs.readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");

/** El unico valor legal de `TablaRollup` en el contrato de la 135 (R9). */
const TABLA: TablaRollup = "analytics_daily";

const MODELO = /model AnalyticsDaily \{[\s\S]*?\n\}/.exec(schemaPrisma)?.[0];

/** Una columna del modelo: nombre en la base y tipo Prisma declarado. */
interface Columna {
  readonly nombre: string;
  readonly tipo: string;
}

/**
 * Columnas escalares del modelo. Se descartan las lineas de relacion (su tipo es un
 * modelo, que empieza por mayuscula y no es un escalar de Prisma) y los atributos de
 * bloque (`@@index`, `@@map`).
 */
function columnasDelModelo(modelo: string): readonly Columna[] {
  const ESCALARES = new Set(["String", "Int", "BigInt", "Float", "Decimal", "Boolean", "DateTime", "Json", "Bytes"]);
  const columnas: Columna[] = [];
  for (const linea of modelo.split("\n")) {
    const m = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s+([A-Za-z]+)(\[\])?(\?)?\s/.exec(`${linea} `);
    if (!m) continue;
    const [, campo, tipoBase, esLista, opcional] = m;
    const esEnum = /^Gestion|^Rol|^Order|^Notificacion|^Estado|^Plantilla|^Carga/.test(tipoBase);
    if (esLista) continue;
    if (!ESCALARES.has(tipoBase) && !esEnum) continue;
    const map = new RegExp(`^\\s{2}${campo}\\s[\\s\\S]*?@map\\("([a-z0-9_]+)"\\)`).exec(linea);
    columnas.push({ nombre: map ? map[1] : campo, tipo: `${tipoBase}${opcional ?? ""}` });
  }
  return columnas;
}

const COLUMNAS = MODELO ? columnasDelModelo(MODELO) : [];
const NOMBRES = new Set(COLUMNAS.map((c) => c.nombre));

/** Columnas tecnicas de toda tabla del repo: ni grano ni medida. */
const TECNICAS = new Set(["id", "created_at", "updated_at"]);

/**
 * Nombres de columna con los que una dimension del catalogo podria materializarse en el
 * rollup: la propia dimension (`causa_devolucion`, `fecha`) o su clave foranea
 * (`zona_id`). Se prueban ambos en las dos direcciones para que la asercion no dependa de
 * como se decidio nombrar cada una.
 */
function nombresPosibles(dim: DimensionAnalitica): readonly string[] {
  return [dim, `${dim}_id`];
}

function tieneColumna(dim: DimensionAnalitica): boolean {
  return nombresPosibles(dim).some((n) => NOMBRES.has(n));
}

const METRICAS_ROLLUP = METRICAS.filter((m) => m.fuente.tipo === "rollup");
const METRICAS_LIVE = METRICAS.filter((m) => m.clase === "live");

/** (a) de R45: la union de los granos de las metricas cuya fuente es el rollup. */
const DIMENSIONES_DEL_ROLLUP = new Set<DimensionAnalitica>(
  METRICAS_ROLLUP.flatMap((m) => [...m.granos]),
);

/** (b) de R45: dimensiones que SOLO declaran metricas `live`. */
const DIMENSIONES_SOLO_LIVE = new Set<DimensionAnalitica>(
  [...new Set(METRICAS_LIVE.flatMap((m) => [...m.granos]))].filter(
    (d) => !DIMENSIONES_DEL_ROLLUP.has(d),
  ),
);

/** Las medidas: toda columna que no es tecnica ni dimension del grano. */
const MEDIDAS = COLUMNAS.filter(
  (c) =>
    !TECNICAS.has(c.nombre) &&
    !DIMENSIONES.some((d) => nombresPosibles(d).includes(c.nombre)),
);
const NOMBRES_MEDIDA = new Set(MEDIDAS.map((m) => m.nombre));

describe("T5 — el modelo del rollup se puede leer del esquema", () => {
  it("`db/schema.prisma` declara el modelo AnalyticsDaily mapeado al literal de TablaRollup", () => {
    expect(MODELO).toBeDefined();
    expect(MODELO!).toContain(`@@map("${TABLA}")`);
    // R9: todo nombre de columna es snake_case.
    for (const c of COLUMNAS) expect(c.nombre).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(COLUMNAS.length).toBeGreaterThan(0);
  });
});

describe("R45/R2 — (a) toda dimension de una metrica con fuente rollup tiene columna", () => {
  it("el catalogo declara al menos una metrica con fuente rollup (si no, el guard seria vacio)", () => {
    expect(METRICAS_ROLLUP.length).toBeGreaterThan(0);
    expect(DIMENSIONES_DEL_ROLLUP.size).toBeGreaterThan(0);
  });

  it.each([...DIMENSIONES_DEL_ROLLUP])(
    "la dimension `%s`, declarada por una metrica snapshot, tiene columna en analytics_daily",
    (dim) => {
      expect(
        tieneColumna(dim),
        `la dimension "${dim}" la declara ${METRICAS_ROLLUP.filter((m) => m.granos.includes(dim))
          .map((m) => m.id)
          .join(", ")} con fuente rollup, pero el modelo no tiene ninguna de las columnas ${nombresPosibles(
          dim,
        ).join(" / ")}`,
      ).toBe(true);
    },
  );

  it("el grano es EXACTAMENTE esa union: ninguna dimension del catalogo sobra en el modelo", () => {
    const conColumna = DIMENSIONES.filter(tieneColumna);
    expect([...conColumna].sort()).toEqual([...DIMENSIONES_DEL_ROLLUP].sort());
  });
});

describe("R45/R3/R4 — (b) ninguna dimension ni medida exclusiva de metricas `live` esta materializada", () => {
  it("el catalogo tiene dimensiones exclusivas de metricas live (si no, el guard seria vacio)", () => {
    expect(METRICAS_LIVE.length).toBeGreaterThan(0);
    expect(DIMENSIONES_SOLO_LIVE.size).toBeGreaterThan(0);
    // Hoy es exactamente `metodo_pago` (solo la declara `cod_recaudado`, financiera+live).
    expect([...DIMENSIONES_SOLO_LIVE]).toContain("metodo_pago");
  });

  it.each([...DIMENSIONES_SOLO_LIVE])(
    "la dimension `%s`, exclusiva de metricas live, NO tiene columna en analytics_daily",
    (dim) => {
      expect(
        tieneColumna(dim),
        `la dimension "${dim}" solo la declaran metricas clase live (${METRICAS_LIVE.filter((m) =>
          m.granos.includes(dim),
        )
          .map((m) => m.id)
          .join(", ")}): el rollup no debe materializarla (R3/R4)`,
      ).toBe(false);
    },
  );

  it("ninguna metrica `live` tiene una columna con su id (R4)", () => {
    for (const m of METRICAS_LIVE) {
      expect(NOMBRES.has(m.id), `la metrica live "${m.id}" no debe tener columna propia`).toBe(
        false,
      );
    }
  });
});

describe("R17/R5 — solo componentes aditivos: ni dinero, ni coma flotante, ni tasas guardadas", () => {
  it("ninguna columna es de coma flotante ni de tipo monetario", () => {
    for (const c of MEDIDAS) {
      expect(c.tipo.replace("?", ""), `columna ${c.nombre}`).toMatch(/^(Int|BigInt)$/);
    }
  });

  it("ninguna metrica de unidad `moneda` tiene columna (el dinero se lee de ledgers y cierres)", () => {
    const monetarias = METRICAS.filter((m) => m.unidad === "moneda");
    expect(monetarias.length).toBeGreaterThan(0);
    for (const m of monetarias) {
      expect(NOMBRES.has(m.id), `la metrica monetaria "${m.id}" no debe tener columna`).toBe(false);
    }
  });

  it("ninguna metrica de unidad `porcentaje` se guarda con su id: se deriva de numerador y denominador", () => {
    const tasas = METRICAS.filter((m) => m.unidad === "porcentaje" && m.definicion.razon);
    expect(tasas.length).toBeGreaterThan(0);
    for (const m of tasas) {
      expect(NOMBRES.has(m.id), `la tasa "${m.id}" no debe estar materializada`).toBe(false);
    }
  });
});

describe("R16/R18/R20 — los componentes de toda razon del catalogo estan entre las medidas", () => {
  const componentes = [
    ...new Set(
      METRICAS_ROLLUP.flatMap((m) =>
        m.definicion.razon
          ? [m.definicion.razon.numerador, ...m.definicion.razon.denominador]
          : [],
      ),
    ),
  ];

  it("el catalogo declara razones (si no, el guard seria vacio) e incluye `incidentes`", () => {
    expect(componentes.length).toBeGreaterThan(0);
    // R18: cuarto termino de DENOMINADOR_GESTIONES; sin ella las tres tasas dan de mas.
    expect(componentes).toContain("incidentes");
  });

  it.each(componentes)("el componente `%s` de una razon es una medida del rollup", (id) => {
    expect(
      NOMBRES_MEDIDA.has(id),
      `"${id}" es numerador o denominador de una tasa del catalogo, asi que debe existir como medida`,
    ).toBe(true);
  });

  it("el tiempo de ciclo se guarda como par numerador/denominador, nunca como promedio (R20)", () => {
    const ciclo = getMetrica("tiempo_ciclo");
    expect(ciclo?.fuente.tipo).toBe("rollup");
    expect(NOMBRES_MEDIDA.has("seg_ciclo_acum")).toBe(true);
    expect(NOMBRES_MEDIDA.has("seg_ciclo_n")).toBe(true);
    expect(NOMBRES_MEDIDA.has(ciclo!.id)).toBe(false);
    expect(MEDIDAS.find((m) => m.nombre === "seg_ciclo_acum")?.tipo).toBe("BigInt");
  });

  it("las medidas son exactamente diez (R16)", () => {
    expect(MEDIDAS.map((m) => m.nombre).sort()).toHaveLength(10);
  });
});

describe("R27 — `ordenes_creadas` existe porque el catalogo la declara como metrica propia", () => {
  it("el catalogo tiene `ordenes_creadas` como metrica independiente, snapshot y con fuente rollup", () => {
    const m = getMetrica("ordenes_creadas");
    expect(m).toBeDefined();
    expect(m!.clase).toBe("snapshot");
    expect(m!.fuente.tipo).toBe("rollup");
    expect(m!.unidadDeConteo).toBe("orden");
    // No es una particion de otra medida: `ordenes_por_estado` es otra entrada distinta.
    expect(getMetrica("ordenes_por_estado")).toBeDefined();
    expect(getMetrica("ordenes_por_estado")!.id).not.toBe(m!.id);
  });

  it("tiene columna propia, y el embudo tiene la SUYA con el sufijo `_stock` (R28)", () => {
    expect(NOMBRES_MEDIDA.has("ordenes_creadas")).toBe(true);
    expect(NOMBRES_MEDIDA.has("ordenes_estado_stock")).toBe(true);
    // Una sola columna `ordenes` fundiria un flujo con un stock (alternativa 5 de design §7).
    expect(NOMBRES_MEDIDA.has("ordenes")).toBe(false);
    expect(NOMBRES_MEDIDA.has("ordenes_por_estado")).toBe(false);
  });
});

describe("R19/R23 — lo que a proposito NO se materializa", () => {
  it("`sin_gestionar` esta en el catalogo pero NO tiene columna: se deriva del embudo", () => {
    const m = getMetrica("sin_gestionar");
    expect(m).toBeDefined();
    expect(m!.fuente.tipo).toBe("rollup");
    expect(NOMBRES.has(m!.id)).toBe(false);
    expect([...NOMBRES].some((n) => n.includes("sin_gestionar"))).toBe(false);
  });

  it("`primer_intento_ok` es conteo entero pese a declararse `porcentaje` en el catalogo", () => {
    const m = getMetrica("primer_intento_ok");
    expect(m!.unidad).toBe("porcentaje");
    expect(MEDIDAS.find((c) => c.nombre === "primer_intento_ok")?.tipo).toBe("Int");
    // D1: sin denominador propio. El suyo es `entregas` del mismo grano.
    expect(NOMBRES_MEDIDA.has("primer_intento_n")).toBe(false);
    expect(NOMBRES_MEDIDA.has("entregas")).toBe(true);
  });
});
