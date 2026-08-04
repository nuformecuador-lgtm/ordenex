import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { METRICAS, getMetrica } from "@/lib/analytics/metrics";
import { NOTA_SIN_GESTIONAR } from "@/lib/types/analitica-operativa";

// Feature 175 / T4.3 — GUARDA del UNIVERSO temporal del catalogo (R5, R6, R7, R9, R10, R11, R12).
//
// Que protege: el catalogo (`lib/analytics/metrics.ts`) es texto declarativo y prometia mas de
// lo que el rollup de la 124 sirve. Dos mentiras concretas, ya corregidas por esta feature:
//   1. `ordenes_por_estado` se leia como «el historico completo por estado», cuando la columna
//      `ordenes_estado_stock` de `analytics_daily` guarda el universo B2 (vivas al corte + las
//      que llegaron a terminal ESE dia). El archivo historico de terminales solo esta en las
//      medidas de FLUJO (entregas / devoluciones / rechazos / incidentes).
//   2. `sin_gestionar` figuraba como si tuviera medida propia en el rollup; no la tiene: la 126
//      la deriva del embudo (`AnaliticaOperativaService.ts:88`), y es «sin gestionar HOY», no
//      acumulada.
//
// POR QUE EL CASO DE R7 PROHIBE CONTAR EN VEZ DE ACTUALIZAR EL NUMERO: la descripcion del embudo
// decia «los 19 values»; el seed se ha movido dos veces (la 155 retiro un value —no se nombra
// aqui: hay un censo que prohibe citarlo— y lo dejo en 19, la 157 anadio `recolectando` y lo
// subio a 20) y se volvera a mover. Un guard que exija
// «20» solo compra tiempo hasta el proximo cambio de seed y ademas obliga a editar prosa en cada
// feature de estados. La correccion DURADERA es que ninguna descripcion cite un conteo de estados:
// el numero vive en `ORDER_STATUS_SEED` y en ningun otro sitio.
//
// TODOS los casos de este archivo documentan, en su propio comentario, la MUTACION concreta que
// los pone rojos; las siete mutaciones se aplicaron de verdad y se midio el rojo antes de
// revertirlas (bitacora en `progress/impl_175.md`).

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "db", "schema.prisma");

const UNIVERSO_B2 = "b2_vivas_mas_cierres_del_dia";

/* -------------------------------------------------------------------------- */
/* Lectura EN CRUDO del esquema (mismo patron que definiciones-catalogo)       */
/* -------------------------------------------------------------------------- */

/**
 * Nombres de columna del modelo, leidos del `db/schema.prisma` REAL y no del cliente
 * generado (que puede estar sin generar o desactualizado). Devuelve las dos formas: el
 * campo Prisma (`ordenesEstadoStock`) y su `@map` (`ordenes_estado_stock`), porque el
 * catalogo cita ids en snake_case.
 */
function leerColumnasDelModelo(nombre: string): Set<string> {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  const bloque = new RegExp(`model ${nombre} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!bloque) throw new Error(`No se encontro el modelo ${nombre} en db/schema.prisma`);
  const columnas = new Set<string>();
  for (const linea of bloque[1].split("\n")) {
    const limpia = linea.replace(/\/\/.*$/, "").trim();
    if (limpia.length === 0 || limpia.startsWith("@@")) continue;
    columnas.add(limpia.split(/\s+/)[0]);
    const mapeada = /@map\("([^"]+)"\)/.exec(limpia);
    if (mapeada) columnas.add(mapeada[1]);
  }
  return columnas;
}

const COLUMNAS_ANALYTICS_DAILY = leerColumnasDelModelo("AnalyticsDaily");

/** `sin_gestionar` -> `sinGestionar`: las dos formas en que se escribiria la columna. */
function aCamel(id: string): string {
  return id.replace(/_([a-z])/g, (_todo, letra: string) => letra.toUpperCase());
}

function tieneColumnaPropia(id: string): boolean {
  return COLUMNAS_ANALYTICS_DAILY.has(id) || COLUMNAS_ANALYTICS_DAILY.has(aCamel(id));
}

/* -------------------------------------------------------------------------- */
/* Derivaciones del propio catalogo (nada escrito a mano)                      */
/* -------------------------------------------------------------------------- */

/**
 * Las medidas de FLUJO, derivadas del catalogo y no de una lista escrita aqui: son los
 * terminos de las `razon` (numerador + denominador) de las tasas, es decir el mismo
 * `DENOMINADOR_GESTIONES` de `metrics.ts` sin duplicarlo. Si manana la 176 anade una tasa
 * nueva, esta lista se mueve sola.
 */
function medidasDeFlujo(): readonly string[] {
  const ids = new Set<string>();
  for (const metrica of METRICAS) {
    const razon = metrica.definicion.razon;
    if (!razon) continue;
    ids.add(razon.numerador);
    for (const termino of razon.denominador) ids.add(termino);
  }
  return [...ids];
}

/** Metricas que declaran derivarse de otra (hoy solo `sin_gestionar`; la regla es general). */
function metricasDerivadas() {
  return METRICAS.filter((m) => m.definicion.derivadaDe !== undefined);
}

/** Normaliza para buscar texto: minusculas y sin tildes (las descripciones no las llevan). */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * R7 — un conteo literal de estados del catalogo de `order_status`, en digitos o en letra.
 * `un`/`una`/`uno` quedan FUERA a proposito: «llego a un estado terminal» es prosa legitima,
 * no un conteo. La ventana de dos palabras cubre «los 20 posibles values» sin tragarse
 * numeros de feature («la 124 ... estado») que van seguidos de puntuacion.
 */
const NUMERO = [
  "\\d{1,3}",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciseis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidos",
  "treinta",
].join("|");

const CONTEO_DE_ESTADOS = new RegExp(
  `\\b(?:${NUMERO})\\b(?:\\s+\\w+){0,2}\\s+(?:estados?|estatus|values?)\\b`,
  "i",
);

/* -------------------------------------------------------------------------- */
/* R5                                                                          */
/* -------------------------------------------------------------------------- */

describe("R5 · el embudo declara el universo B2", () => {
  // MUTACION QUE LO MATA: borrar `universo: "b2_vivas_mas_cierres_del_dia"` de
  // `ordenes_por_estado.definicion` (`metrics.ts:132`). MEDIDA: rojo.
  it("el embudo declara el universo B2", () => {
    const embudo = getMetrica("ordenes_por_estado");
    expect(embudo, "el catalogo perdio la metrica del embudo").toBeDefined();
    // Legible por MAQUINA: un campo de dominio cerrado, no una frase dentro de la prosa.
    expect(embudo!.definicion.universo).toBe(UNIVERSO_B2);
  });

  it("el universo es un dominio cerrado: nadie mete prosa en el campo", () => {
    const universos = METRICAS.map((m) => m.definicion.universo).filter(
      (u): u is typeof UNIVERSO_B2 => u !== undefined,
    );
    expect(universos.length, "ninguna metrica declara universo: el caso seria vacuo").
      toBeGreaterThan(0);
    for (const universo of universos) expect(universo).toBe(UNIVERSO_B2);
  });
});

/* -------------------------------------------------------------------------- */
/* R6                                                                          */
/* -------------------------------------------------------------------------- */

describe("R6 · la descripcion del embudo remite a las medidas de flujo", () => {
  // MUTACION QUE LO MATA: quitar de la descripcion del embudo la remision a las medidas de
  // flujo (borrar «entregas, devoluciones, rechazos, incidentes» de `metrics.ts:118`) o la
  // frase de que el rollup no conserva el archivo historico. MEDIDA: rojo en ambas.
  //
  // El assert NO compara una frase larga entera —cualquier reescritura inocente la rompe y no
  // prueba nada—: exige los CUATRO ids de las medidas de flujo, DERIVADOS del catalogo, mas la
  // nocion de «no conserva el historico».
  it("la descripcion del embudo remite a las medidas de flujo para el historico de terminales", () => {
    const embudo = getMetrica("ordenes_por_estado");
    expect(embudo).toBeDefined();
    const descripcion = normalizar(embudo!.descripcion);

    const flujo = medidasDeFlujo();
    expect(
      flujo.length,
      "no se derivo ninguna medida de flujo del catalogo: el caso seria vacuo",
    ).toBeGreaterThanOrEqual(4);

    for (const id of flujo) {
      expect(descripcion, `el embudo no remite a la medida de flujo ${id}`).toContain(id);
    }

    expect(
      /\bno\s+conserva\b[^.;]*\bhistorico\b/.test(descripcion),
      "el embudo no dice que el rollup NO conserva el archivo historico de terminales",
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R7                                                                          */
/* -------------------------------------------------------------------------- */

describe("R7 · ninguna descripcion del catalogo cuenta estados a mano", () => {
  // MUTACION QUE LO MATA: reintroducir «19 values» —o «los 20 values», que es la trampa de
  // «solo hay que actualizar el numero»— en cualquier `descripcion`. MEDIDA: rojo en ambas.
  it("ninguna descripcion del catalogo cuenta estados a mano", () => {
    expect(METRICAS.length, "catalogo vacio: el recorrido seria vacuo").toBeGreaterThan(0);
    for (const metrica of METRICAS) {
      const encontrado = CONTEO_DE_ESTADOS.exec(normalizar(metrica.descripcion));
      expect(
        encontrado?.[0],
        `metrica ${metrica.id}: su descripcion cuenta estados a mano ("${encontrado?.[0]}"). ` +
          "El numero vive en ORDER_STATUS_SEED; se movio con la 155 y con la 157 y se volvera " +
          "a mover. No lo actualices: quitalo.",
      ).toBeUndefined();
    }
  });

  it("la regla detecta el conteo en digitos y en letra", () => {
    // Autoverificacion de la regla: sin esto, un regex roto dejaria pasar TODO en silencio y el
    // caso de arriba seria verde por vacuo. Son exactamente las formas de la mutacion.
    for (const prosa of [
      "Embudo con los 19 values vigentes de order_status.",
      "Embudo con los 20 values vigentes de order_status.",
      "Embudo sobre los 20 estados del catalogo.",
      "Embudo con los diecinueve values vigentes.",
      "Embudo sobre los veinte estados posibles.",
    ]) {
      expect(CONTEO_DE_ESTADOS.test(normalizar(prosa)), prosa).toBe(true);
    }
    // Y no confunde prosa legitima con un conteo.
    for (const prosa of [
      "las que llegaron a un estado terminal ese mismo dia",
      "universo B2 de la 124 (las vivas al corte)",
    ]) {
      expect(CONTEO_DE_ESTADOS.test(normalizar(prosa)), prosa).toBe(false);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R9                                                                          */
/* -------------------------------------------------------------------------- */

describe("R9 · sin_gestionar se declara derivada de ordenes_por_estado", () => {
  // MUTACION QUE LO MATA: borrar `derivadaDe: "ordenes_por_estado"` de
  // `sin_gestionar.definicion` (`metrics.ts:264`). MEDIDA: rojo.
  it("sin_gestionar se declara derivada de ordenes_por_estado", () => {
    const sinGestionar = getMetrica("sin_gestionar");
    expect(sinGestionar, "el catalogo perdio la metrica sin_gestionar").toBeDefined();
    expect(sinGestionar!.definicion.derivadaDe).toBe("ordenes_por_estado");
    expect(sinGestionar!.definicion.universo).toBe(UNIVERSO_B2);
  });

  it("toda metrica derivada cita un id que existe en el catalogo y no encadena derivaciones", () => {
    // Regla GENERAL, no solo para `sin_gestionar`: el estrechamiento a `MetricaId` lo garantiza
    // en compilacion, pero el catalogo se lee tambien en runtime (131/134) y una cadena
    // `a -> b -> c` haria que nadie supiera de que columna sale el numero.
    const derivadas = metricasDerivadas();
    expect(derivadas.length, "ninguna metrica declara derivadaDe: el caso seria vacuo").
      toBeGreaterThan(0);
    for (const metrica of derivadas) {
      const base = getMetrica(metrica.definicion.derivadaDe!);
      expect(base, `metrica ${metrica.id}: deriva de un id inexistente`).toBeDefined();
      expect(base!.definicion.derivadaDe, `metrica ${metrica.id}: derivacion encadenada`).
        toBeUndefined();
      expect(metrica.definicion.universo, `metrica ${metrica.id}`).toBe(base!.definicion.universo);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R10                                                                         */
/* -------------------------------------------------------------------------- */

describe("R10 · sin_gestionar se describe como del dia, no como acumulada", () => {
  // MUTACION QUE LO MATA (dos formas, ambas medidas): (a) quitar «HOY» / «del dia» de la
  // descripcion; (b) describirla como acumulada (cambiar «NO acumuladas» por «acumuladas»).
  //
  // EL NUCLEO DEL CASO ES EL AMARRE: `NOTA_SIN_GESTIONAR` (`lib/types/analitica-operativa.ts:75`)
  // ya declara esta semantica en el contrato de la 126, y `metrics.ts` NO puede importarla
  // (`modulo-puro.guardia.test.ts` prohibe que el catalogo importe fuera de su isla). El test SI
  // puede importar las dos, asi que la coherencia entre los dos textos se ata AQUI: las nociones
  // que exige la descripcion se derivan de los tokens de la constante, no se escriben a mano.
  const sinGestionar = getMetrica("sin_gestionar");
  const tokens = NOTA_SIN_GESTIONAR.split("_");

  it("la nota del contrato sigue codificando las dos nociones que se exigen", () => {
    // Sanidad del amarre: si alguien renombra la constante y pierde una de las dos nociones, el
    // resto del caso dejaria de exigirlas en silencio.
    expect(tokens, `NOTA_SIN_GESTIONAR = ${NOTA_SIN_GESTIONAR}`).toContain("dia");
    expect(tokens).toContain("b2");
  });

  it("sin_gestionar se describe como del dia, no como acumulada", () => {
    expect(sinGestionar).toBeDefined();
    const descripcion = normalizar(sinGestionar!.descripcion);

    // Token `dia` de la nota -> la descripcion dice HOY / del dia, y PEGADO al nombre de la
    // metrica, igual que en la nota (`sin_gestionar` + `es_del_dia`). Sin esa adherencia el
    // caso no mata la mutacion: el texto habla del universo B2 («ese mismo dia») y de las
    // gestiones «del dia» por otros motivos, asi que un «dia» suelto en cualquier parte de la
    // frase lo dejaria pasar.
    if (tokens.includes("dia")) {
      expect(
        /\bsin gestionar\s+(?:hoy|de hoy|del dia)\b/.test(descripcion),
        "sin_gestionar no se describe como del dia (HOY) junto al nombre de la metrica",
      ).toBe(true);
    }
    // Token `b2` de la nota -> la descripcion nombra el universo B2.
    if (tokens.includes("b2")) {
      expect(descripcion, "sin_gestionar no nombra el universo B2").toContain("universo b2");
    }

    // Y NO se describe como acumulada: toda aparicion de «acumulad*» debe estar negada o
    // marcada como lectura equivocada en su propio entorno (60 caracteres a cada lado).
    const apariciones = [...descripcion.matchAll(/acumulad\w*/g)];
    expect(apariciones.length, "la descripcion ni siquiera nombra la lectura acumulada").
      toBeGreaterThan(0);
    for (const aparicion of apariciones) {
      const desde = Math.max(0, aparicion.index - 60);
      const entorno = descripcion.slice(desde, aparicion.index + aparicion[0].length + 60);
      expect(
        /\bno\b|\bni\b|\bnunca\b|distint/.test(entorno),
        `sin_gestionar se describe como acumulada: "...${entorno}..."`,
      ).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R11                                                                         */
/* -------------------------------------------------------------------------- */

describe("R11 · analytics_daily no tiene columna sin_gestionar y el catalogo no la supone", () => {
  it("el parseo del modelo AnalyticsDaily encontro columnas reales", () => {
    // Sanidad OBLIGATORIA: si el regex fallara y devolviera vacio, los tres casos de abajo
    // pasarian por vacuo y el guard seria decorativo.
    expect(COLUMNAS_ANALYTICS_DAILY.size).toBeGreaterThan(10);
    for (const columna of ["ordenes_estado_stock", "entregas", "incidentes"]) {
      expect(COLUMNAS_ANALYTICS_DAILY.has(columna), `falta la columna ${columna}`).toBe(true);
    }
  });

  // MUTACION QUE LO MATA (la que pide `tasks.md`): simular la aparicion de la columna
  // `sin_gestionar` en el modelo `AnalyticsDaily` de `db/schema.prisma`. MEDIDA: rojo — y el
  // rojo obliga justamente a lo que se quiere: actualizar el catalogo (quitar `derivadaDe` y
  // reescribir la descripcion) en vez de dejarlo mintiendo.
  it("analytics_daily no tiene columna sin_gestionar", () => {
    expect(COLUMNAS_ANALYTICS_DAILY.has("sin_gestionar")).toBe(false);
    expect(COLUMNAS_ANALYTICS_DAILY.has("sinGestionar")).toBe(false);
  });

  it("ninguna metrica derivada tiene en realidad columna propia en el rollup", () => {
    // Regla GENERAL: declararse derivada mientras existe una columna con tu id es la mentira
    // inversa a la que corrigio la 175. Aqui muere tambien la mutacion de la columna.
    const derivadas = metricasDerivadas();
    expect(derivadas.length, "ninguna metrica derivada: el caso seria vacuo").toBeGreaterThan(0);
    for (const metrica of derivadas) {
      expect(
        tieneColumnaPropia(metrica.id),
        `metrica ${metrica.id}: se declara derivada de ${metrica.definicion.derivadaDe} pero ` +
          "analytics_daily YA tiene su columna; actualiza el catalogo",
      ).toBe(false);
    }
  });

  // MUTACION QUE LO MATA: quitar de la descripcion de `sin_gestionar` el inciso «no tiene medida
  // ni columna propia en el rollup diario». MEDIDA: rojo.
  //
  // OJO al vocabulario: la descripcion NO puede nombrar la tabla por su nombre —el censo de
  // `analytics-daily-guards.test.ts` exige que en `metrics.ts` ese literal aparezca SOLO como
  // declaracion de fuente (`tablas: [...]`)—, asi que la nocion se dice como «el rollup diario».
  // Este caso la exige con ese vocabulario para que la prosa no la pierda en silencio.
  it("toda metrica derivada dice en su descripcion que no tiene medida propia en el rollup", () => {
    const derivadas = metricasDerivadas();
    expect(derivadas.length, "ninguna metrica derivada: el caso seria vacuo").toBeGreaterThan(0);
    for (const metrica of derivadas) {
      const descripcion = normalizar(metrica.descripcion);
      expect(
        /\bno tiene\b[^.;)]*\bpropia\b[^.;)]*\brollup\b/.test(descripcion),
        `metrica ${metrica.id}: se declara derivada pero su descripcion no dice que NO tiene ` +
          "medida ni columna propia en el rollup diario",
      ).toBe(true);
    }
  });

  it("toda metrica de ordenes sin columna propia declara de que otra metrica se proyecta", () => {
    // Generalizacion de R11 sin lista escrita a mano: entre las metricas del rollup que cuentan
    // ORDENES, la que no tiene columna con su id y ademas mira un subconjunto ESTRICTO de los
    // estados de otra es, por construccion, una proyeccion de la medida de aquella (es el caso
    // de `sin_gestionar` sobre `ordenes_por_estado`); debe declararlo con `derivadaDe`.
    const deOrdenes = METRICAS.filter(
      (m) => m.fuente.tipo === "rollup" && m.unidadDeConteo === "orden" && m.unidad === "conteo",
    );
    expect(deOrdenes.length, "no hay metricas de ordenes en el rollup: caso vacuo").
      toBeGreaterThan(1);

    const obligadas = deOrdenes.filter((m) => {
      if (tieneColumnaPropia(m.id)) return false;
      const propios = new Set<string>(m.definicion.estados ?? []);
      if (propios.size === 0) return false;
      return deOrdenes.some((otra) => {
        if (otra.id === m.id) return false;
        const ajenos = new Set<string>(otra.definicion.estados ?? []);
        return ajenos.size > propios.size && [...propios].every((e) => ajenos.has(e));
      });
    });
    expect(
      obligadas.length,
      "ninguna metrica quedo obligada a declarar derivadaDe: el caso seria vacuo",
    ).toBeGreaterThan(0);

    for (const metrica of obligadas) {
      expect(
        metrica.definicion.derivadaDe,
        `metrica ${metrica.id}: no tiene columna propia en analytics_daily y proyecta los ` +
          "estados de otra metrica, asi que debe declarar derivadaDe",
      ).toBeDefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R12                                                                         */
/* -------------------------------------------------------------------------- */

describe("R12 · sin_gestionar conserva clase snapshot y fuente rollup", () => {
  // MUTACION QUE LO MATA (dos formas, ambas medidas): cambiar `sin_gestionar` a `clase: "live"`
  // o a `fuente: { tipo: "tabla_viva", tablas: ["orden"] }`. MEDIDA: rojo en ambas.
  //
  // No se toca `operativa-fuente.guardia.test.ts` (feature 126): alli vive el invariante general
  // `snapshot <=> rollup`; aqui se fija que la correccion del universo NO lo rompio, porque
  // `sin_gestionar` se sirve de la columna `ordenes_estado_stock` de `analytics_daily`
  // (`lib/services/AnaliticaOperativaService.ts:88`), que es tabla de rollup.
  it("sin_gestionar conserva clase snapshot y fuente rollup", () => {
    const sinGestionar = getMetrica("sin_gestionar");
    expect(sinGestionar).toBeDefined();
    expect(sinGestionar!.clase).toBe("snapshot");
    expect(sinGestionar!.fuente.tipo).toBe("rollup");
    expect([...sinGestionar!.fuente.tablas]).toEqual(["analytics_daily"]);
  });

  it("una metrica derivada se sirve de la misma clase y fuente que su base", () => {
    // Regla general: si se proyecta de la columna de otra metrica, no puede leerse de otra tabla
    // ni cambiar de clase; seria servir el numero de un sitio distinto del que dice el catalogo.
    const derivadas = metricasDerivadas();
    expect(derivadas.length).toBeGreaterThan(0);
    for (const metrica of derivadas) {
      const base = getMetrica(metrica.definicion.derivadaDe!)!;
      expect(metrica.clase, `metrica ${metrica.id}`).toBe(base.clase);
      expect(metrica.fuente.tipo, `metrica ${metrica.id}`).toBe(base.fuente.tipo);
      expect([...metrica.fuente.tablas], `metrica ${metrica.id}`).toEqual([...base.fuente.tablas]);
    }
  });
});
