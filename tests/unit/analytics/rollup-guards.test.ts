import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  TIMEOUT_TX_ROLLUP_MS,
  UMBRAL_AVISO_FILAS_CORRIDA,
} from "@/lib/config/analitica-rollup";

// Feature 124 / T5.4 — LOS CUATRO GUARDIAS ESTATICOS DEL ESCRITOR.
//
//   R4  — el job es de SOLO LECTURA sobre el dominio y sobre el dinero.
//   R26 — ningun literal de coordenada: toda coordenada sale de un `GROUP BY` sobre datos reales.
//   R6  — ni `startOfDayCR` ni aritmetica de zona horaria propia.
//   R47 — la cifra de volumen vive en UNA sola constante, declarada provisional y no medida.
//
// Los cuatro leen el FUENTE de los modulos del escritor (forma calcada de
// `tests/integration/db/analytics-daily-guards.test.ts`: recorrido de directorios, rutas POSIX,
// red anti-vacio). Son estaticos a proposito: R4 y R26 describen algo que NO debe existir, y lo
// que no existe no se puede observar ejecutando el job. Un test de integracion que compruebe
// «la orden no cambio» solo cubre el camino que ese test recorre; el guardia cubre el archivo.
//
// TODOS los guardias trabajan sobre el fuente SIN COMENTARIOS. No es cosmetica: los modulos del
// escritor EXPLICAN en prosa justo lo que tienen prohibido hacer —`rollup-dia.ts` dedica un
// parrafo a por que no importa `startOfDayCR`, el repositorio dice «ni un UPDATE ... sobre
// `orden`», la interfaz menciona el cubo `sin_asignar`—. Sobre el texto crudo los cuatro
// guardias saldrian rojos por la documentacion que los respeta, y la salida rapida a ese rojo
// seria borrar los comentarios. Ver el caso «el despojador de comentarios DISCRIMINA».

const ROOT = path.join(__dirname, "..", "..", "..");

/** Directorios de CODIGO que se rastrean. `db/`, `specs/`, `tests/` y `progress/` no. */
const DIRS_CODIGO = ["app", "lib", "scripts", "components", "hooks", "providers", "e2e"];

const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function recorrer(dir: string): readonly string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const salida: string[] = [];
  for (const entrada of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      salida.push(...recorrer(rel));
    } else if (EXTENSIONES.includes(path.extname(entrada.name))) {
      salida.push(rel);
    }
  }
  return salida;
}

/** Ruta relativa con separadores POSIX, para comparar igual en Windows y en CI. */
const posix = (p: string) => p.split(path.sep).join("/");

const ARCHIVOS_CODIGO = DIRS_CODIGO.flatMap(recorrer).map(posix);

const existe = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const leer = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Los modulos del ESCRITOR (`design.md §2` + los dos scripts). Misma lista que el allowlist del
 * guardia de frontera (T5.2), y por la MISMA razon se exige que todas las rutas existan: una
 * entrada muerta es un comodin silencioso. Si manana se renombra el repositorio, la entrada
 * vieja se quedaria aqui vigilando un archivo inexistente y el nuevo —al no estar en la lista—
 * no lo vigilaria nadie. El caso «toda ruta vigilada existe» lo impide.
 */
const MODULOS_ESCRITOR = [
  "lib/interfaces/repositories/IAnaliticaRollupRepository.ts",
  "lib/interfaces/services/IAnaliticaRollupService.ts",
  "lib/repositories/AnaliticaRollupRepository.ts",
  "lib/services/AnaliticaRollupService.ts",
  "lib/services/jobs/analitica-rollup-diario-handler.ts",
  "lib/services/jobs/analitica-rollup-diario-encolado.ts",
  "lib/analytics/rollup-dia.ts",
  "lib/config/analitica-rollup.ts",
  "scripts/seed-jobs-analitica-rollup-diario.ts",
  "scripts/rollup-analitica-manual.ts",
];

const ARCHIVO_CONFIG = "lib/config/analitica-rollup.ts";
const ARCHIVO_HANDLER = "lib/services/jobs/analitica-rollup-diario-handler.ts";

/* -------------------------------------------------------------------------- */
/* Despojador de comentarios                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Devuelve el fuente sin comentarios de linea ni de bloque, CONSERVANDO intactas las cadenas y
 * las plantillas —donde vive el SQL que R4 y R26 tienen que inspeccionar—.
 *
 * Recorre caracter a caracter en vez de aplicar una regex, porque una regex sobre `//.*$`
 * destruiria cualquier `//` dentro de una cadena y, peor, dejaria intacto el `/* *\/` de dentro
 * de una plantilla SQL. Las cadenas se copian enteras (con sus escapes) y no se interpretan.
 */
function sinComentarios(codigo: string): string {
  let salida = "";
  let i = 0;
  while (i < codigo.length) {
    const c = codigo[i];
    const sig = codigo[i + 1];
    if (c === "/" && sig === "/") {
      while (i < codigo.length && codigo[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && sig === "*") {
      i += 2;
      while (i < codigo.length && !(codigo[i] === "*" && codigo[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      salida += c;
      i++;
      while (i < codigo.length) {
        if (codigo[i] === "\\") {
          salida += codigo.slice(i, i + 2);
          i += 2;
          continue;
        }
        salida += codigo[i];
        const cierra = codigo[i] === c;
        i++;
        if (cierra) break;
      }
      continue;
    }
    salida += c;
    i++;
  }
  return salida;
}

/** Fuente vigilado de cada modulo del escritor, ya sin comentarios. */
function fuentesVigilados(): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>();
  for (const rel of MODULOS_ESCRITOR) {
    if (existe(rel)) mapa.set(rel, sinComentarios(leer(rel)));
  }
  return mapa;
}

/** Red anti-vacio comun: si el rastreo no encuentra el escritor, el guardia no mide nada. */
function exigirQueMida(fuentes: ReadonlyMap<string, string>): void {
  expect(
    fuentes.size,
    "el rastreo no encontro NINGUN modulo del escritor: el guardia estaria pasando por vacio, " +
      "no por limpio. Rutas esperadas: " +
      MODULOS_ESCRITOR.join(", "),
  ).toBe(MODULOS_ESCRITOR.length);
}

describe("T5.4 — cimientos: los modulos vigilados existen y se leen de verdad", () => {
  it("el rastreo del arbol de codigo encuentra archivos (si no, todo el archivo es vacio)", () => {
    expect(ARCHIVOS_CODIGO.length).toBeGreaterThan(100);
    expect(ARCHIVOS_CODIGO.some((f) => f.startsWith("lib/"))).toBe(true);
    expect(ARCHIVOS_CODIGO.some((f) => f.startsWith("scripts/"))).toBe(true);
  });

  it("TODA ruta vigilada existe: una entrada muerta es un comodin silencioso", () => {
    // Mismo criterio que se le exigio al allowlist del guardia de frontera (T5.2). Aqui la
    // direccion del dano es la contraria y por eso importa igual: si un modulo del escritor
    // desaparece de la lista de vigilancia —renombrado, movido de carpeta— deja de estar
    // vigilado y los cuatro guardias siguen VERDES sobre un escritor que ya nadie mira.
    const inexistentes = MODULOS_ESCRITOR.filter((rel) => !existe(rel));
    expect(
      inexistentes,
      "estas rutas se declaran modulos del escritor de la 124 pero no existen en el arbol. O se " +
        "crea el archivo, o se retira la entrada: mientras tanto, el guardia vigila un archivo " +
        "imaginario. Rutas: " +
        inexistentes.join(", "),
    ).toEqual([]);

    // Y existir no basta: tienen que caer dentro de los directorios rastreados, porque el
    // guardia de la cifra unica (R47) recorre ESOS directorios.
    for (const rel of MODULOS_ESCRITOR) {
      expect(ARCHIVOS_CODIGO, `${rel} no esta dentro de los directorios rastreados`).toContain(rel);
    }
  });

  it("el despojador de comentarios DISCRIMINA (si no, los cuatro guardias son vacios)", () => {
    const fuente = [
      '// UPDATE "orden" SET x = 1 -- esto es prosa, no codigo',
      "/* startOfDayCR: explicado en un bloque, tampoco es codigo */",
      'const sql = `UPDATE "orden" SET x = 1`;',
      'const url = "https://ejemplo.test/a//b";',
      "const re = /^\\d{4}-\\d{2}-\\d{2}$/;",
      "export const N = 1; // cola",
    ].join("\n");
    const limpio = sinComentarios(fuente);

    // Los comentarios se van...
    expect(limpio).not.toContain("esto es prosa");
    expect(limpio).not.toContain("startOfDayCR");
    expect(limpio).not.toContain("cola");
    // ...y el codigo se queda ENTERO, con su SQL, su `//` dentro de la cadena y su regex.
    expect(limpio).toContain('`UPDATE "orden" SET x = 1`');
    expect(limpio).toContain("https://ejemplo.test/a//b");
    expect(limpio).toContain("/^\\d{4}-\\d{2}-\\d{2}$/");
    expect(limpio).toContain("export const N = 1;");

    // Sobre los modulos REALES: cada uno tenia comentarios (se acortan) y ninguno se queda sin
    // codigo (siguen exportando algo). Es la red contra un desincronizado del despojador que se
    // comiera medio archivo y dejara los guardias verdes por amputacion.
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    for (const [rel, limpio2] of fuentes) {
      expect(limpio2.length, `${rel}: el despojador no quito ni un comentario`).toBeLessThan(
        leer(rel).length,
      );
      expect(limpio2, `${rel}: el despojador se comio el codigo`).toContain("export");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R4 — solo lectura del dominio y del dinero                                  */
/* -------------------------------------------------------------------------- */

/**
 * Las tablas que R4 nombra una a una: dominio operativo + cierre + TODO el dinero
 * (`db/schema.prisma`). La lista esta escrita para que el mensaje de error diga QUE se protege;
 * la comprobacion de abajo es mas estricta que la lista (ver `TABLAS_ESCRIBIBLES`).
 */
const TABLAS_R4 = [
  "orden",
  "gestion_orden",
  "orden_historial_estado",
  "cierre_dia",
  "cierre_detail",
  "cierre_bodega",
  "wallet_movimiento",
  "wallet_tienda_movimiento",
  "pago_mensajero_movimiento",
  "tarifas",
  "tarifa_zona_mensajero",
  "gasto_fijo_plantilla",
  "premio_ranking",
];

/**
 * Las UNICAS dos tablas que el escritor puede escribir. Se comprueba por lista blanca y no por
 * lista negra: una lista negra deja fuera la tabla que alguien anada manana.
 *
 * - `analytics_daily` es la tabla que este job EXISTE para escribir (`DELETE` de rancias +
 *   `INSERT ... ON CONFLICT` de los cubos, R27/R29). Quien la escribe y desde donde lo gobierna
 *   el guardia de frontera (T5.2), no este.
 * - `jobs` es la cola: `scripts/seed-jobs-analitica-rollup-diario.ts` encola la primera
 *   ocurrencia recurrente (R36). NO es dominio ni es dinero —es la infraestructura que hace
 *   correr el job—, asi que R4 no la alcanza y admitirla no abre ningun agujero sobre lo que R4
 *   protege. Hoy ademas ni siquiera se ejerce: el seed encola a traves de
 *   `IJobRepository.enqueue` y no toca Prisma, asi que la excepcion esta declarada para que
 *   manana nadie tenga que aflojar la lista de R4 para hacer algo legitimo.
 */
const TABLAS_ESCRIBIBLES = ["analytics_daily", "jobs"];
const MODELOS_ESCRIBIBLES = ["analyticsDaily", "job"];

const VERBOS_SQL = "INSERT\\s+INTO|UPDATE|DELETE\\s+FROM";
const METODOS_ESCRITURA_PRISMA =
  "create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany";

/** Escrituras SQL: `[{verbo, tabla}]`. Excluye el `DO UPDATE SET` del `ON CONFLICT`. */
function escriturasSql(codigo: string): readonly { verbo: string; tabla: string }[] {
  const salida: { verbo: string; tabla: string }[] = [];
  const patron = new RegExp(`\\b(${VERBOS_SQL})\\s+"?([a-zA-Z_][\\w]*)"?`, "gi");
  for (const m of codigo.matchAll(patron)) {
    const antes = codigo.slice(Math.max(0, (m.index ?? 0) - 8), m.index ?? 0);
    // `ON CONFLICT ... DO UPDATE SET` no escribe otra tabla: es la rama del upsert.
    if (/\bDO\s+$/i.test(antes)) continue;
    salida.push({ verbo: m[1].replace(/\s+/g, " ").toUpperCase(), tabla: m[2].toLowerCase() });
  }
  return salida;
}

/** Escrituras por el query builder de Prisma: `[{receptor, modelo, metodo}]`. */
function escriturasPrisma(codigo: string): readonly { modelo: string; metodo: string }[] {
  const patron = new RegExp(
    `\\b(?:this\\s*\\.\\s*)?(?:prisma|tx|db|client|dbClient)\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${METODOS_ESCRITURA_PRISMA})\\s*\\(`,
    "g",
  );
  return [...codigo.matchAll(patron)].map((m) => ({ modelo: m[1], metodo: m[2] }));
}

describe("R4 — el job NO escribe en el dominio ni en el dinero", () => {
  it("el analizador de escrituras DISCRIMINA (si no, el guardia es vacio)", () => {
    // Lo que TIENE que cazar.
    expect(escriturasSql('await tx.$queryRaw`UPDATE "orden" SET total = 0`;')).toEqual([
      { verbo: "UPDATE", tabla: "orden" },
    ]);
    expect(escriturasSql("DELETE FROM gestion_orden WHERE id = $1")).toEqual([
      { verbo: "DELETE FROM", tabla: "gestion_orden" },
    ]);
    expect(escriturasSql('INSERT INTO "wallet_movimiento" (id) VALUES ($1)')).toEqual([
      { verbo: "INSERT INTO", tabla: "wallet_movimiento" },
    ]);
    expect(escriturasPrisma("await this.prisma.orden.updateMany({ where: {} });")).toEqual([
      { modelo: "orden", metodo: "updateMany" },
    ]);
    expect(escriturasPrisma("await tx.gestionOrden.delete({ where: { id } });")).toEqual([
      { modelo: "gestionOrden", metodo: "delete" },
    ]);

    // Lo que NO debe confundirlo: el `DO UPDATE SET` del upsert legitimo del rollup.
    const upsert = `INSERT INTO "analytics_daily" (id) VALUES ($1)
      ON CONFLICT ("fecha") DO UPDATE SET "entregas" = EXCLUDED."entregas"`;
    expect(escriturasSql(upsert)).toEqual([{ verbo: "INSERT INTO", tabla: "analytics_daily" }]);
    // Ni una lectura, ni un `Map.delete` que no cuelgue de un cliente Prisma.
    expect(escriturasSql('SELECT * FROM "orden" WHERE id = $1')).toEqual([]);
    expect(escriturasPrisma("cubos.delete(clave);")).toEqual([]);
  });

  it("ningun modulo del escritor escribe SQL sobre una tabla que no sea el rollup o la cola", () => {
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    for (const [rel, codigo] of fuentes) {
      for (const { verbo, tabla } of escriturasSql(codigo)) {
        if (TABLAS_ESCRIBIBLES.includes(tabla)) continue;
        infracciones.push(`${rel}: ${verbo} ${tabla}`);
      }
    }
    expect(
      infracciones,
      "R4: el job es de SOLO LECTURA sobre el dominio y sobre el dinero. No puede escribir, " +
        `actualizar ni borrar ninguna fila de ${TABLAS_R4.join(", ")}. Las UNICAS tablas que ` +
        `puede escribir son ${TABLAS_ESCRIBIBLES.join(" y ")}: el rollup, que es lo que existe ` +
        "para escribir, y la cola, que no es dominio ni dinero. Infracciones: " +
        infracciones.join(" | "),
    ).toEqual([]);
  });

  it("ningun modulo del escritor usa el query builder de Prisma para mutar", () => {
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    for (const [rel, codigo] of fuentes) {
      for (const { modelo, metodo } of escriturasPrisma(codigo)) {
        if (MODELOS_ESCRIBIBLES.includes(modelo)) continue;
        infracciones.push(`${rel}: prisma.${modelo}.${metodo}()`);
      }
    }
    expect(
      infracciones,
      "R4: `prisma.orden.update`, `.create`, `.delete`, `.updateMany`... estan prohibidos en el " +
        `escritor para cualquier modelo que no sea ${MODELOS_ESCRIBIBLES.join(" o ")}. ` +
        "Infracciones: " +
        infracciones.join(" | "),
    ).toEqual([]);
  });

  it("las trece tablas que R4 nombra no aparecen como destino de ninguna escritura", () => {
    // Redundante con el caso de la lista blanca, y deliberado: este es el que NOMBRA las tablas
    // del requisito. Si manana alguien relajara la lista blanca, este seguiria rojo para las
    // trece que R4 protege, que son las que importan.
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    for (const [rel, codigo] of fuentes) {
      for (const { verbo, tabla } of escriturasSql(codigo)) {
        if (TABLAS_R4.includes(tabla)) infracciones.push(`${rel}: ${verbo} ${tabla}`);
      }
    }
    expect(infracciones, "R4, tablas de dominio y dinero escritas: " + infracciones.join(" | ")).toEqual(
      [],
    );
  });

  it("no hay SQL sin analizar: `$executeRawUnsafe` / `$queryRawUnsafe` estan prohibidos", () => {
    // Sin esto los dos casos de arriba tendrian una puerta trasera del tamano de un `string`:
    // `tx.$executeRawUnsafe(sqlConstruidoEnOtroSitio)` no expone su tabla al analizador.
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infractores = [...fuentes]
      .filter(([, codigo]) => /\$(?:execute|query)RawUnsafe\b/.test(codigo))
      .map(([rel]) => rel);
    expect(
      infractores,
      "el SQL del escritor tiene que ser legible por el guardia: un `Unsafe` con la consulta en " +
        "una variable deja a R4 sin nada que inspeccionar.",
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R26 — ningun literal de coordenada                                          */
/* -------------------------------------------------------------------------- */

/**
 * R26: toda coordenada sale de un `GROUP BY` sobre datos reales, asi que en el escritor no
 * puede haber NI UN literal de `zona_id`, `tienda_id`, `mensajero_id` ni `estatus_id`. Se
 * detectan cuatro formas, que son las que se han visto de verdad en este repo:
 *
 *  (a) un uuid escrito a mano;
 *  (b) un cuid escrito a mano (`c` + 24 alfanumericos: el formato de los ids del catalogo);
 *  (c) una asignacion literal a una de las cuatro claves (`zona_id: "TODAS"`, `zonaId = 'x'`);
 *  (d) una comparacion SQL de una de las cuatro claves contra una cadena literal;
 *  (e) un centinela con nombre: `'sin_asignar'` es el que R25 prohibe por su nombre.
 *
 * Lo que NO es infraccion, y por eso el analizador tiene que distinguirlo: `zonaId: string` (un
 * tipo), `AS zona_id` (un alias del `GROUP BY`) y `zonaId: f.zona_id` (el mapeo de la fila que
 * la consulta devolvio, que es precisamente lo que R26 EXIGE).
 */
const CLAVES_COORDENADA = "zona_?[Ii]d|tienda_?[Ii]d|mensajero_?[Ii]d|mensajero_asignado_id|estatus_?[Ii]d|estatus_destino_id";

const LITERALES_COORDENADA: readonly { nombre: string; patron: RegExp }[] = [
  {
    nombre: "uuid literal",
    patron: /['"`][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"`]/gi,
  },
  { nombre: "cuid literal", patron: /['"`]c[a-z0-9]{24,}['"`]/g },
  {
    nombre: "asignacion literal a una clave de coordenada",
    patron: new RegExp(`\\b(?:${CLAVES_COORDENADA})\\s*(?::|=(?!=|>))\\s*['"\`]`, "g"),
  },
  {
    nombre: "comparacion SQL de una coordenada contra una cadena",
    patron: new RegExp(`"?(?:${CLAVES_COORDENADA})"?\\s*(?:=|\\bIN\\b)\\s*'`, "gi"),
  },
  { nombre: "centinela de coordenada", patron: /['"`](?:sin_asignar|SIN_ASIGNAR|sin-asignar)['"`]/g },
];

function literalesDeCoordenada(codigo: string): readonly string[] {
  const hallazgos: string[] = [];
  for (const { nombre, patron } of LITERALES_COORDENADA) {
    for (const m of codigo.matchAll(patron)) hallazgos.push(`${nombre}: ${m[0]}`);
  }
  return hallazgos;
}

describe("R26 — ninguna coordenada escrita a mano en el escritor", () => {
  it("el analizador DISCRIMINA literal de derivado (si no, el guardia es vacio)", () => {
    // Lo que TIENE que cazar.
    expect(
      literalesDeCoordenada('const zonaId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";'),
    ).toHaveLength(2); // uuid + asignacion a una clave: las dos formas lo cazan
    expect(literalesDeCoordenada('zona_id: "TODAS",')).toHaveLength(1);
    // Las cinco formas se solapan a proposito: un mismo literal puede caer en varias. Lo que
    // importa es que ninguna infraccion salga con CERO hallazgos.
    expect(literalesDeCoordenada("estatusId = 'cku1a2b3c4d5e6f7g8h9i0jkl',")).toHaveLength(3);
    expect(literalesDeCoordenada("mensajeroId: 'sin_asignar',")).toHaveLength(2); // centinela + asignacion
    expect(literalesDeCoordenada(`WHERE o."zona_id" = 'gam-central'`)).toHaveLength(1);

    // Lo que NO debe confundirlo: el escritor legitimo, tal cual.
    expect(literalesDeCoordenada("readonly zonaId: string;")).toEqual([]);
    expect(literalesDeCoordenada("mensajeroId: string | null;")).toEqual([]);
    expect(literalesDeCoordenada(`o."zona_id"  AS zona_id,`)).toEqual([]);
    expect(literalesDeCoordenada("return { zonaId: f.zona_id, estatusId: f.estatus_id };")).toEqual(
      [],
    );
    expect(literalesDeCoordenada(`GROUP BY 1, 2, 3, 4`)).toEqual([]);
    // Un literal que NO es coordenada (el `value` de un resultado de gestion) es legal: sale del
    // catalogo de enums, no de las cuatro claves foraneas.
    expect(literalesDeCoordenada(`g."resultado" = 'devuelta'`)).toEqual([]);
  });

  it("ningun modulo del escritor contiene un literal de coordenada", () => {
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    for (const [rel, codigo] of fuentes) {
      for (const hallazgo of literalesDeCoordenada(codigo)) infracciones.push(`${rel}: ${hallazgo}`);
    }
    expect(
      infracciones,
      "R26: toda coordenada del rollup (`zona_id`, `tienda_id`, `mensajero_id`, `estatus_id`) " +
        "DEBE proceder de un `GROUP BY` sobre datos reales y satisfacer las cuatro claves " +
        "foraneas. Un id escrito a mano rompe la FK o —peor— escribe un cubo que no corresponde " +
        "a nada; un centinela como `sin_asignar` rompe R25, que exige `NULL`. Infracciones: " +
        infracciones.join(" | "),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* R6 — ni `startOfDayCR` ni aritmetica de zona horaria propia                 */
/* -------------------------------------------------------------------------- */

/**
 * R6 — QUE SE ADMITE EN EL HANDLER, Y POR QUE NO ABRE LA VENTANA 18:00-18:00.
 *
 * `startOfDayCR` devuelve la MEDIANOCHE UTC de la fecha calendario CR (convencion `@db.Date` de
 * la feature 46), seis horas ANTES del comienzo real del dia en Costa Rica. Usarla como cota
 * contra columnas `timestamp` produce la ventana 18:00-18:00 que hoy arrastra `RankingService`
 * (ficha 166): la trampa documentada del repo. En el escritor esta PROHIBIDA sin excepcion, y
 * con ella toda aritmetica de zona horaria propia.
 *
 * PERO `analitica-rollup-diario-handler.ts` necesita expresar «las 00:30 hora de pared CR del
 * dia siguiente» como instante UTC para la recurrencia (D3), y `lib/utils/fecha-cr.ts` no
 * exporta ningun helper de «proximo instante a tal hora de pared CR»: expone inicios de dia y
 * fechas calendario, no horas arbitrarias. Se admite ahi UN desplazamiento de seis horas, y la
 * admision se acota con cinco condiciones para que por ella no quepa nada mas:
 *
 *   1. SOLO en ese archivo. En cualquier otro modulo del escritor, rojo.
 *   2. UNA sola vez. Una segunda ocurrencia en el mismo archivo ya no es «la recurrencia»: es
 *      aritmetica de fechas dispersa, y es rojo.
 *   3. El multiplicador tiene que ser EXACTAMENTE 6. Un 18 —la ventana de `RankingService`—, un
 *      12 o cualquier otro numero es rojo AUNQUE este en el handler. Este es el punto que
 *      cierra el agujero: la excepcion no dice «aqui se permite tocar horas», dice «aqui se
 *      permite el offset de CR, que es 6 y solo 6».
 *   4. Tiene que estar ligada a una constante con nombre `CR_OFFSET*`, en su declaracion. Un
 *      `now.getTime() - 6 * 60 * 60 * 1000` incrustado en medio de una expresion es rojo.
 *   5. El handler sigue sin poder nombrar `startOfDayCR` ni `RankingService`, como todos los
 *      demas.
 *
 * La fecha objetivo y las cotas del dia NO se benefician de nada de esto: salen de
 * `rollup-dia.ts`, que se apoya entero en `fecha-cr.ts` (caso «el dia CR sale de fecha-cr.ts»).
 */
const NOMBRES_PROHIBIDOS_R6: readonly { nombre: string; patron: RegExp }[] = [
  { nombre: "startOfDayCR", patron: /\bstartOfDayCR\b/ },
  { nombre: "RankingService (su ventana es 18:00-18:00)", patron: /\bRankingService\b/ },
  { nombre: "getTimezoneOffset", patron: /\bgetTimezoneOffset\s*\(/ },
  { nombre: "cota horaria CR escrita a mano (T06:00)", patron: /T\s*0?6:00/ },
  { nombre: "cota horaria de RankingService escrita a mano (T18:00)", patron: /T\s*18:00/ },
];

/** `24 * 60 * 60 * 1000` es la DURACION de un dia, no un desplazamiento de zona horaria. */
const HORAS_SIN_OFFSET = [24];
/** El offset de CR: UTC-6, fijo (sin horario de verano). */
const HORAS_OFFSET_CR = 6;
const MS_POR_HORA = 3_600_000;

/** Desplazamientos horarios escritos a mano: `[{horas, indice}]`. */
function desplazamientosHorarios(codigo: string): readonly { horas: number; indice: number }[] {
  const salida: { horas: number; indice: number }[] = [];
  // `N * 60 * 60 * 1000`, `N * 3600 * 1000`, `N * 3_600_000`.
  const productos = /(\d+)\s*\*\s*(?:60\s*\*\s*60\s*\*\s*1_?000|3_?600\s*\*\s*1_?000|3_?600_?000)/g;
  for (const m of codigo.matchAll(productos)) {
    salida.push({ horas: Number(m[1]), indice: m.index ?? 0 });
  }
  // El mismo desplazamiento ya multiplicado: cualquier literal que sea un numero exacto de
  // horas en milisegundos, de 1 h a 23 h. `86400000` (un dia) queda fuera a proposito.
  for (const m of codigo.matchAll(/(?<![\w.$])(\d{7,8})(?![\w.])/g)) {
    const valor = Number(m[1]);
    if (valor % MS_POR_HORA !== 0) continue;
    const horas = valor / MS_POR_HORA;
    if (horas < 1 || horas > 23) continue;
    salida.push({ horas, indice: m.index ?? 0 });
  }
  return salida;
}

describe("R6 — el escritor no reimplementa la zona horaria de Costa Rica", () => {
  it("el detector de desplazamientos DISCRIMINA (si no, el guardia es vacio)", () => {
    expect(desplazamientosHorarios("const X = 6 * 60 * 60 * 1000;").map((d) => d.horas)).toEqual([6]);
    expect(desplazamientosHorarios("const X = 18 * 60 * 60 * 1000;").map((d) => d.horas)).toEqual([
      18,
    ]);
    expect(desplazamientosHorarios("const X = 6 * 3_600_000;").map((d) => d.horas)).toEqual([6]);
    expect(desplazamientosHorarios("const X = 21600000;").map((d) => d.horas)).toEqual([6]);
    expect(desplazamientosHorarios("const X = 64800000;").map((d) => d.horas)).toEqual([18]);
    // Un dia entero no es un desplazamiento de zona horaria por ninguna de las dos vias.
    expect(desplazamientosHorarios("const UN_DIA_MS = 24 * 60 * 60 * 1000;").map((d) => d.horas)).toEqual(
      [24],
    );
    expect(desplazamientosHorarios("const UN_DIA_MS = 86400000;")).toEqual([]);
    expect(desplazamientosHorarios("const N = 12345;")).toEqual([]);
  });

  it("ningun modulo del escritor nombra `startOfDayCR` ni el resto de la lista negra", () => {
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    for (const [rel, codigo] of fuentes) {
      for (const { nombre, patron } of NOMBRES_PROHIBIDOS_R6) {
        if (patron.test(codigo)) infracciones.push(`${rel}: ${nombre}`);
      }
    }
    expect(
      infracciones,
      "R6: `startOfDayCR` devuelve la medianoche UTC de la fecha CR, seis horas ANTES del " +
        "comienzo real del dia en Costa Rica. Contra columnas `timestamp` produce la ventana " +
        "18:00-18:00 de `RankingService` (ficha 166). Las cotas del rollup salen de " +
        "`inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`. Infracciones: " +
        infracciones.join(" | "),
    ).toEqual([]);
  });

  it("ninguna hora de desplazamiento a mano, salvo el offset de CR en la recurrencia", () => {
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    let admitidasEnHandler = 0;
    for (const [rel, codigo] of fuentes) {
      for (const { horas, indice } of desplazamientosHorarios(codigo)) {
        if (HORAS_SIN_OFFSET.includes(horas)) continue;
        const declaracion = /\bCR_OFFSET\w*\s*(?::\s*number\s*)?=\s*$/.test(
          codigo.slice(Math.max(0, indice - 40), indice),
        );
        const admisible =
          rel === ARCHIVO_HANDLER && horas === HORAS_OFFSET_CR && declaracion;
        if (admisible) {
          admitidasEnHandler++;
          continue;
        }
        infracciones.push(`${rel}: desplazamiento de ${horas} h escrito a mano`);
      }
    }
    expect(
      infracciones,
      "R6: la aritmetica de zona horaria vive SOLO en `lib/utils/fecha-cr.ts`. La UNICA " +
        `excepcion admitida es el offset de CR (${HORAS_OFFSET_CR} h) en ${ARCHIVO_HANDLER}, en ` +
        "la declaracion de `CR_OFFSET_MS`, para expresar las 00:30 CR de la recurrencia como " +
        "06:30 UTC: `fecha-cr.ts` no exporta un helper de hora de pared arbitraria. Un 18 ahi " +
        "—la ventana de `RankingService`— es rojo igual. Infracciones: " +
        infracciones.join(" | "),
    ).toEqual([]);

    // La excepcion es de UNA: una segunda ocurrencia ya no es «la recurrencia».
    expect(
      admitidasEnHandler,
      "el offset de CR se admite UNA sola vez en el handler; si hay mas de una, la aritmetica " +
        "de fechas se esta dispersando y hay que llevarla a `fecha-cr.ts`",
    ).toBeLessThanOrEqual(1);
  });

  it("ningun `toLocale*` ni `Intl.DateTimeFormat` sin `timeZone` explicito (R9)", () => {
    const fuentes = fuentesVigilados();
    exigirQueMida(fuentes);
    const infracciones: string[] = [];
    for (const [rel, codigo] of fuentes) {
      for (const m of codigo.matchAll(/\b(toLocale(?:Date|Time)?String|Intl\.DateTimeFormat)\s*\(/g)) {
        const cola = codigo.slice(m.index ?? 0, (m.index ?? 0) + 300);
        if (!/timeZone/.test(cola)) infracciones.push(`${rel}: ${m[1]} sin timeZone`);
      }
    }
    expect(
      infracciones,
      "R9: el resultado del rollup no puede depender del `TZ` del proceso. Un " +
        "`toLocaleDateString` sin `timeZone` produce una fecha distinta segun donde corra.",
    ).toEqual([]);
  });

  it("el dia CR y sus cotas salen de `lib/utils/fecha-cr.ts` (la contracara en verde)", () => {
    // La ausencia de infracciones no demuestra que la fecha salga del sitio bueno: podria no
    // salir de ningun sitio. Este caso afirma el positivo.
    const rollupDia = leer("lib/analytics/rollup-dia.ts");
    expect(rollupDia).toMatch(/from\s+["']@\/lib\/utils\/fecha-cr["']/);
    for (const helper of ["fechaCalendarioCR", "inicioDelDiaCREnUtc", "inicioDelDiaSiguienteCREnUtc"]) {
      expect(rollupDia, `rollup-dia.ts no usa ${helper}`).toContain(helper);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R47 — la cifra de volumen vive en UNA sola constante                        */
/* -------------------------------------------------------------------------- */

/**
 * R47/D9 — LA CIFRA NO SE ESCRIBE EN ESTE ARCHIVO.
 *
 * El umbral se IMPORTA de `lib/config/analitica-rollup.ts` y las formas literales se derivan de
 * su valor. Teclearla aqui convertiria al propio guardia en la segunda copia que existe para
 * prohibir: el dia en que la 125 la sustituya por un numero medido, este test seguiria verde
 * mientras vigila una cifra que ya no es la del sistema.
 *
 * `TIMEOUT_TX_ROLLUP_MS` vive en ese mismo archivo y queda FUERA de este guardia: no es una
 * cifra de volumen, es el limite de la transaccion interactiva de Prisma (el default de 5 s
 * esta pensado para la mutacion de una request, no para una agregacion diaria). R47 habla de
 * «cifras de volumen dispersas»; un timeout no lo es. Que este en el mismo archivo es una
 * conveniencia (un solo sitio donde tocar los numeros del job), no una excepcion al guardia: se
 * comprueba aparte que su comentario lo declara y que su valor no coincide con el del umbral.
 */
function formasLiterales(valor: number): RegExp {
  const digitos = String(valor);
  const alternativas = [digitos.split("").join("_?")];
  for (let k = 1; k < digitos.length; k++) {
    const base = 10 ** k;
    if (valor % base === 0) alternativas.push(`${valor / base}[eE]\\+?${k}`);
  }
  return new RegExp(`(?<![\\w.$])(?:${alternativas.join("|")})(?![\\w.])`, "g");
}

/**
 * Ocurrencias PREEXISTENTES de la cifra que no son cifras de volumen. Van con su cuenta exacta
 * y se exige ademas que la linea hable de un timeout: el allowlist es por CLASE de uso, no por
 * ruta, y una segunda ocurrencia en el mismo archivo sigue siendo roja.
 *
 * Si esta lista caduca (porque el umbral cambie de valor o porque estos timeouts cambien), el
 * guardia se pone rojo y hay que actualizarla. Es deliberado: la alternativa —ignorar el
 * archivo entero— es un comodin silencioso.
 */
const AJENAS_A_R47: readonly { ruta: string; ocurrencias: number }[] = [
  { ruta: "lib/clients/google-route-optimization.ts", ocurrencias: 1 },
  { ruta: "lib/config/route-optimization.ts", ocurrencias: 1 },
  // Mismo caso que los dos de arriba: el default de `timeoutMs` del cliente de trazado, en
  // milisegundos. No es una cifra de VOLUMEN, que es lo unico que R47 centraliza.
  { ruta: "lib/clients/google-routes.ts", ocurrencias: 1 },
];

describe("R47 — el umbral de volumen vive en una sola constante, provisional y no medida", () => {
  it("el detector de formas literales DISCRIMINA (si no, el guardia es vacio)", () => {
    const patron = () => formasLiterales(20000);
    expect("const x = 20000;".match(patron())).toHaveLength(1);
    expect("const x = 20_000;".match(patron())).toHaveLength(1);
    expect("const x = 2e4;".match(patron())).toHaveLength(1);
    // Ni un prefijo, ni un sufijo, ni una parte de otro numero.
    expect("const x = 120_000;".match(patron())).toBeNull();
    expect("const x = 200000;".match(patron())).toBeNull();
    expect("const x = 20000.5;".match(patron())).toBeNull();
    expect("const x = v20000;".match(patron())).toBeNull();
  });

  it("la constante existe, es un entero positivo y no coincide con el timeout de la tx", () => {
    expect(Number.isInteger(UMBRAL_AVISO_FILAS_CORRIDA)).toBe(true);
    expect(UMBRAL_AVISO_FILAS_CORRIDA).toBeGreaterThan(0);
    // Si coincidieran, el guardia de duplicacion estaria midiendo el timeout sin saberlo.
    expect(
      UMBRAL_AVISO_FILAS_CORRIDA,
      "el umbral de volumen y el timeout de la transaccion no pueden valer lo mismo: el guardia " +
        "de cifra unica no podria distinguirlos",
    ).not.toBe(TIMEOUT_TX_ROLLUP_MS);
  });

  it("(a) el comentario declara que la cifra es PROVISIONAL y NO MEDIDA (D9)", () => {
    const fuente = leer(ARCHIVO_CONFIG);
    const lineas = fuente.split(/\r?\n/);
    const iDecl = lineas.findIndex((l) => /export\s+const\s+UMBRAL_AVISO_FILAS_CORRIDA\b/.test(l));
    expect(iDecl, `no se encontro la declaracion en ${ARCHIVO_CONFIG}`).toBeGreaterThanOrEqual(0);

    // Se aplana a una sola linea: una frase de un comentario viene partida por el ajuste de
    // linea y por el `//` o el `*` del margen, y el guardia no puede depender de donde caiga.
    const prosa = lineas
      .slice(0, iDecl)
      .filter((l) => /^\s*(?:\/\/|\/\*|\*)/.test(l))
      .map((l) => l.replace(/^\s*(?:\/\/|\/\*+|\*)\s?/, ""))
      .join(" ");
    expect(
      prosa,
      "R47/D9: la cifra tiene que ir acompanada de un comentario que diga, sin eufemismos, que " +
        "es PROVISIONAL. No hay ni un dato de volumen medido en el repo y esta feature es la " +
        "que empieza a producirlo: sin esa declaracion, el numero se lee manana como si alguien " +
        "lo hubiera medido.",
    ).toMatch(/provisional/i);
    expect(
      prosa,
      "R47/D9: el comentario tiene que decir ademas que NO ESTA MEDIDA. «Provisional» a secas " +
        "admite la lectura «medida pero sujeta a cambio», que es justo la que D9 prohibe.",
    ).toMatch(/\bno\s+(?:est[aá]\s+|esta\s+)?medid[ao]\b/i);

    // Y el aviso es un aviso: nada se rechaza ni se trunca por superarlo (D9: sin topes).
    expect(prosa).toMatch(/aviso|no es un l[ií]mite|nada se rechaza/i);
  });

  it("(b) la cifra no aparece en ningun otro archivo del arbol de codigo", () => {
    expect(ARCHIVOS_CODIGO.length).toBeGreaterThan(100);
    expect(ARCHIVOS_CODIGO, "el archivo de configuracion no esta en el rastreo").toContain(
      ARCHIVO_CONFIG,
    );

    const enConfig = leer(ARCHIVO_CONFIG).match(formasLiterales(UMBRAL_AVISO_FILAS_CORRIDA)) ?? [];
    expect(
      enConfig.length,
      `la cifra tiene que aparecer EXACTAMENTE una vez en ${ARCHIVO_CONFIG} (la declaracion). ` +
        `Aparece ${enConfig.length} veces: duplicarla dentro del propio archivo es duplicarla.`,
    ).toBe(1);

    const infracciones: string[] = [];
    const ajenasVistas = new Map<string, number>();
    for (const rel of ARCHIVOS_CODIGO) {
      if (rel === ARCHIVO_CONFIG) continue;
      const contenido = leer(rel);
      const ocurrencias = [...contenido.matchAll(formasLiterales(UMBRAL_AVISO_FILAS_CORRIDA))];
      if (ocurrencias.length === 0) continue;
      const ajena = AJENAS_A_R47.find((a) => a.ruta === rel);
      if (ajena !== undefined && ocurrencias.length === ajena.ocurrencias) {
        // Admitida solo si TODAS sus ocurrencias son, por su linea, un timeout en milisegundos.
        const todasSonTimeout = ocurrencias.every((m) => {
          const inicio = contenido.lastIndexOf("\n", m.index ?? 0) + 1;
          const fin = contenido.indexOf("\n", m.index ?? 0);
          return /timeout/i.test(contenido.slice(inicio, fin === -1 ? undefined : fin));
        });
        if (todasSonTimeout) {
          ajenasVistas.set(rel, ocurrencias.length);
          continue;
        }
      }
      infracciones.push(`${rel} (${ocurrencias.length}x)`);
    }
    expect(
      infracciones,
      "R47: el umbral de aviso de volumen vive en UNA sola constante " +
        `(${ARCHIVO_CONFIG}); si hace falta en otro sitio, se IMPORTA. Una cifra de volumen ` +
        "copiada es una cifra que la 125 no va a poder sustituir por la medida. Copias: " +
        infracciones.join(", "),
    ).toEqual([]);

    // El allowlist no puede tener entradas muertas, por lo mismo que la lista de modulos.
    for (const { ruta, ocurrencias } of AJENAS_A_R47) {
      expect(
        ajenasVistas.get(ruta),
        `${ruta} figura como ocurrencia ajena a R47 (un timeout en ms) pero ya no contiene la ` +
          "cifra, o no la contiene esa cantidad de veces, o dejo de ser un timeout. Retira o " +
          "corrige la entrada: un allowlist que describe un arbol imaginario no restringe nada.",
      ).toBe(ocurrencias);
    }
  });

  it("(c) `TIMEOUT_TX_ROLLUP_MS` se trata aparte y se declara que NO es cifra de volumen", () => {
    const fuente = leer(ARCHIVO_CONFIG);
    expect(fuente).toMatch(/export\s+const\s+TIMEOUT_TX_ROLLUP_MS\b/);
    // Una frase de un JSDoc viene partida por saltos de linea y por el `*` del margen: se
    // aplana antes de buscarla, o el guardia depende de donde caiga el ajuste de linea.
    const prosaPlana = fuente.replace(/\n\s*\*\s?/g, " ").replace(/\n\s*\/\/\s?/g, " ");
    expect(
      prosaPlana,
      "el timeout convive con el umbral en el mismo archivo; si su comentario no dice que NO es " +
        "una cifra de volumen, manana alguien lo lee como el segundo umbral de R47",
    ).toMatch(/NO\s+es\s+una\s+cifra\s+de\s+volumen/i);
    expect(Number.isInteger(TIMEOUT_TX_ROLLUP_MS)).toBe(true);
    expect(TIMEOUT_TX_ROLLUP_MS).toBeGreaterThan(0);
  });

  it("(d) ningun otro archivo declara una constante de umbral de volumen del rollup", () => {
    // La otra forma de dispersar la cifra: no copiar el numero, sino declarar otro umbral con
    // otro valor en otro sitio. R47 dice «una sola constante», no «un solo numero».
    const patron = /\b(?:const|let|var)\s+([A-Z0-9_]*(?:UMBRAL|LIMITE|MAX)[A-Z0-9_]*(?:FILAS|VOLUMEN|CUBOS)[A-Z0-9_]*|[A-Z0-9_]*(?:FILAS|VOLUMEN|CUBOS)[A-Z0-9_]*(?:UMBRAL|LIMITE|MAX)[A-Z0-9_]*)\s*=/g;
    const infracciones: string[] = [];
    for (const rel of ARCHIVOS_CODIGO) {
      if (rel === ARCHIVO_CONFIG) continue;
      for (const m of leer(rel).matchAll(patron)) infracciones.push(`${rel}: ${m[1]}`);
    }
    expect(
      infracciones,
      `el umbral de volumen del rollup se declara solo en ${ARCHIVO_CONFIG}. Constantes ` +
        "sospechosas: " +
        infracciones.join(", "),
    ).toEqual([]);
  });
});
