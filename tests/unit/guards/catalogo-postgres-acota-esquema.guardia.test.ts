import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 421 (R3, R4, R5) — NINGUNA CONSULTA A UN CATALOGO DE POSTGRES SIN ACOTAR EL ESQUEMA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE, Y POR QUE NO ES CELO. Los catalogos de Postgres (`pg_enum`, `pg_type`, `pg_class`,
// `pg_indexes`, `pg_constraint`, `pg_policies`, `information_schema.*`) son GLOBALES A LA BASE: el
// `search_path` NO los filtra. Una consulta que busque por NOMBRE —`typname = 'notificacion_evento'`,
// `relname = 'notificacion'`, `indexname = '…'`— devuelve el objeto de `public` **y el de cualquier
// otro esquema que tenga uno igual**.
//
// Y este arbol crea esquemas con objetos de igual nombre CONSTANTEMENTE: 29 archivos de
// `tests/integration/db/` se aislan con `CREATE SCHEMA` + su DDL + `DROP SCHEMA … CASCADE`, y varios
// clonan ahi el mismo enum (`push-cupo-carrera.test.ts`). Con `maxWorkers` > 1 (vitest.config.ts)
// dos coinciden en el tiempo.
//
// NO ES UNA HIPOTESIS. El 2026-09-11 esto puso EL GATE DE RELEASE en rojo:
// `notificacion-evento-avisos-agregados-migration.test.ts` esperaba 11 etiquetas del enum y recibio
// 23 —cada etiqueta DUPLICADA—, porque su `string_agg` estaba sumando DOS tipos. Aislado salia
// verde 20 de 20 veces; la segunda corrida completa tambien. O sea: el modo de fallo es
// INTERMITENTE Y DEPENDE DE QUIEN CORRA AL LADO, que es el que menos se diagnostica y el que mas
// tienta a comprar el verde metiendolo en el baseline.
//
// EL CENSO DEL DIA QUE SE ARREGLO, sobre `tests/` y contando tambien `pg_namespace`: 162
// consultas, de las que **125 ya acotaban** y **37 no** (en 21 archivos). Que la mayoria lo
// hiciera bien es justo lo que convierte a las otras 37 en un olvido y no en una decision — y lo
// que hace falta para que no vuelva a colarse una es esta guardia, no acordarse.
//
// COMO MIDE. Sobre el fuente SIN COMENTARIOS (el quitador del repo: los comentarios de este arbol
// nombran a proposito lo que el codigo tiene prohibido, y escanear prosa afirma en falso con la
// misma cara de verde), extrae los LITERALES de cadena, se queda con los que son SQL a un catalogo
// y exige que digan de que esquema hablan.
//
// LO QUE **NO** VE, dicho aqui para que sea un hecho conocido: una consulta TROCEADA en varios
// literales concatenados (`"SELECT … FROM pg_indexes" + " WHERE …"`). Cada pedazo se mira por
// separado, asi que el `WHERE` que acota vive en otro literal y el detector no puede emparejarlos.
// Habia UNA en el arbol (`scripts/bench-busqueda-ordenes.ts`) y esta guardia la denuncio al
// estrenarse: se reescribio como una sola plantilla, que es como hay que escribirlas.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

/** El propio archivo, en la forma en que lo lista `git ls-files`. */
const ESTA_GUARDIA = "tests/unit/guards/catalogo-postgres-acota-esquema.guardia.test.ts";

/**
 * Las muestras DELIBERADAS de la contraprueba viven en este archivo, asi que se excluyen del
 * barrido global. Para que la exclusion no se convierta en un agujero, su numero se afirma aparte:
 * si alguien escribe aqui una consulta de verdad sin acotar, el conteo deja de cuadrar.
 *
 * Son DOS, y las dos estan al final del archivo: `MUESTRA_SIN_ACOTAR` y `MUESTRA_SOLO_PROSA` (esta
 * ultima porque su texto —que para el detector es un literal mas— nombra un `SELECT … FROM
 * pg_enum` A PROPOSITO, para probar que ahi dentro SI se ignora por ser un comentario).
 */
const MUESTRAS_SIN_ACOTAR_EN_ESTA_GUARDIA = 2;

const CATALOGOS =
  /\b(pg_enum|pg_type|pg_class|pg_index|pg_indexes|pg_constraint|pg_policies|pg_proc|pg_attribute|pg_attrdef|pg_trigger|pg_tables|pg_views|pg_matviews|pg_sequences|information_schema\.\w+)\b/;

/**
 * Lo que cuenta como «dice de que esquema habla»: la columna de esquema del catalogo
 * correspondiente, el `JOIN` a `pg_namespace`, o un cast que resuelve a un objeto concreto.
 */
const ACOTA =
  /\b(nspname|schemaname|relnamespace|typnamespace|pronamespace|connamespace|table_schema|constraint_schema|udt_schema|specific_schema|sequence_schema|schema_name|regnamespace|regclass|regtype|regproc)\b/;

export interface ConsultaDeCatalogo {
  sql: string;
  linea: number;
}

/**
 * Los literales de cadena de un fuente TypeScript: `'…'`, `"…"` y `` `…` `` con sus `${…}`
 * anidados (que se devuelven TAL CUAL, porque `${TABLA}` forma parte del SQL que se manda).
 *
 * Presupone que los comentarios ya NO estan. Por eso no los vuelve a mirar: de eso se encarga
 * `quitarComentarios`, que es el unico quitador del repo.
 */
function literalesDeCadena(fuente: string): { texto: string; inicio: number }[] {
  const salida: { texto: string; inicio: number }[] = [];
  const n = fuente.length;
  let i = 0;

  /** Devuelve el indice DESPUES de la comilla de cierre. */
  function finDeCadena(desde: number, comilla: string): number {
    let j = desde + 1;
    while (j < n) {
      if (fuente[j] === "\\") {
        j += 2;
        continue;
      }
      if (fuente[j] === comilla) return j + 1;
      if (comilla !== "`" && fuente[j] === "\n") return j;
      if (comilla === "`" && fuente[j] === "$" && fuente[j + 1] === "{") {
        j = finDeInterpolacion(j + 2);
        continue;
      }
      j += 1;
    }
    return n;
  }

  /** Devuelve el indice DESPUES de la llave que cierra un `${…}`, saltando lo que anide. */
  function finDeInterpolacion(desde: number): number {
    let j = desde;
    let llaves = 1;
    while (j < n && llaves > 0) {
      const c = fuente[j];
      if (c === "'" || c === '"' || c === "`") {
        j = finDeCadena(j, c);
        continue;
      }
      if (c === "{") llaves += 1;
      if (c === "}") llaves -= 1;
      j += 1;
    }
    return j;
  }

  while (i < n) {
    const c = fuente[i];
    if (c === "'" || c === '"' || c === "`") {
      const fin = finDeCadena(i, c);
      salida.push({ texto: fuente.slice(i + 1, Math.max(i + 1, fin - 1)), inicio: i });
      i = fin;
      continue;
    }
    i += 1;
  }
  return salida;
}

/** Las consultas a un catalogo que hay en un fuente, acoten o no. */
export function consultasACatalogos(fuente: string): ConsultaDeCatalogo[] {
  const codigo = quitarComentarios(fuente);
  const salida: ConsultaDeCatalogo[] = [];
  for (const { texto, inicio } of literalesDeCadena(codigo)) {
    if (!CATALOGOS.test(texto)) continue;
    if (!/\bSELECT\b/i.test(texto) || !/\bFROM\b/i.test(texto)) continue;
    salida.push({ sql: texto, linea: codigo.slice(0, inicio).split("\n").length });
  }
  return salida;
}

/** Las que ademas NO dicen de que esquema hablan. */
export function consultasSinEsquema(fuente: string): ConsultaDeCatalogo[] {
  return consultasACatalogos(fuente).filter((c) => !ACOTA.test(c.sql));
}

function archivosDelArbol(): string[] {
  return execFileSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: RAIZ, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

describe("FICHA 421 — toda consulta a un catalogo de Postgres acota el esquema", () => {
  const archivos = archivosDelArbol();

  it("el barrido encuentra archivos y consultas: si midiera cero, el verde no valdria nada", () => {
    const suficientes = archivos.length > 1000;
    expect(suficientes, `\`git ls-files\` devolvio ${archivos.length} fuentes: no mide nada`).toBe(
      true,
    );
    const total = archivos.reduce(
      (n, f) => n + consultasACatalogos(readFileSync(path.join(RAIZ, f), "utf8")).length,
      0,
    );
    // El dia del arreglo eran 146 en el arbol: 145 en `tests/` y 1 en `scripts/`. El umbral es
    // holgado a proposito: lo que vigila es que no haya NINGUNA sin acotar, no cuantas hay.
    expect(total, "el detector dejo de ver las consultas a catalogos").toBeGreaterThan(100);
  });

  it("⭑ NINGUNA consulta del arbol lee un catalogo sin decir de que esquema habla", () => {
    const hallazgos: string[] = [];
    for (const archivo of archivos) {
      if (archivo === ESTA_GUARDIA) continue;
      for (const c of consultasSinEsquema(readFileSync(path.join(RAIZ, archivo), "utf8"))) {
        hallazgos.push(`${archivo}:${c.linea} -> ${c.sql.trim().replace(/\s+/g, " ").slice(0, 120)}`);
      }
    }
    expect(
      hallazgos,
      `Consulta(s) a un catalogo de Postgres sin acotar el esquema. Con un esquema temporal vivo ` +
        `(los crea la propia suite) devuelven objetos de MAS y el test enrojece por culpa de otro ` +
        `archivo. Anade \`n.nspname = 'public'\` (via \`JOIN pg_namespace\`), \`schemaname = 'public'\` ` +
        `o \`table_schema = 'public'\` segun el catalogo:\n${hallazgos.join("\n")}`,
    ).toEqual([]);
  });

  it("la exclusion de este archivo no tapa nada: sus muestras sin acotar son las deliberadas", () => {
    const propias = consultasSinEsquema(readFileSync(path.join(RAIZ, ESTA_GUARDIA), "utf8"));
    expect(propias).toHaveLength(MUESTRAS_SIN_ACOTAR_EN_ESTA_GUARDIA);
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // CONTRAPRUEBA (R4, R5). Sin esto, un detector roto —que devolviera cero siempre— dejaria la
  // guardia verde para siempre. Las tres muestras de abajo son las que cuenta el caso anterior.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const MUESTRA_SIN_ACOTAR = `
    const filas = await prisma.$queryRawUnsafe(
      \`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'notificacion_evento' ORDER BY e.enumsortorder\`,
    );
  `;

  const MUESTRA_ACOTADA = `
    const filas = await prisma.$queryRawUnsafe(
      \`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'notificacion_evento' AND n.nspname = 'public'\`,
    );
  `;

  // ⚠️ ESTAS DOS LINEAS SON LAS QUE ROMPIAN EL BARRIDO A `grep`. Medido el dia del arreglo: el
  // grep crudo daba 88 «hallazgos» y mas de la mitad eran exactamente esto —titulos de `it(...)` y
  // comentarios que nombran el catalogo a proposito—. Una guardia con ese ruido se desactiva sola.
  //
  // LIMITE CONOCIDO, dicho aqui para que no sea una sorpresa: un TITULO que ademas contuviera las
  // palabras `SELECT` y `FROM` si se denunciaria. Es un falso POSITIVO —ruidoso, no silencioso—,
  // que es la direccion aceptable; en el arbol de hoy no hay ninguno.
  const MUESTRA_SOLO_PROSA = `
    // se lee con un SELECT ... FROM pg_enum, no del .sql: el catalogo es otra fuente
    it("\`pg_enum\` tiene el valor nuevo, y pg_type y la base dicen lo mismo", () => {});
  `;

  const MUESTRA_CON_INDICES = `
    const a = \`SELECT indexname FROM pg_indexes WHERE tablename = '\${TABLA}'\`;
    const b = \`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'x'\`;
  `;

  it("⭑ denuncia una consulta sin acotar, y dice en que linea", () => {
    const hallazgos = consultasSinEsquema(MUESTRA_SIN_ACOTAR);
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0].sql).toContain("pg_enum");
    // La linea es la del literal dentro de la muestra: lo que hace accionable el mensaje.
    expect(hallazgos[0].linea).toBe(3);
  });

  it("no denuncia la misma consulta cuando SI acota el esquema", () => {
    expect(consultasACatalogos(MUESTRA_ACOTADA)).toHaveLength(1);
    expect(consultasSinEsquema(MUESTRA_ACOTADA)).toEqual([]);
  });

  it("⭑ no confunde prosa con codigo: ni comentarios ni titulos de `it(...)`", () => {
    // El comentario nombra el catalogo Y el titulo tambien; ninguno de los dos es una consulta.
    expect(consultasACatalogos(MUESTRA_SOLO_PROSA)).toEqual([]);
  });

  it("separa las dos consultas de un mismo archivo: denuncia la mala y deja la buena", () => {
    expect(consultasACatalogos(MUESTRA_CON_INDICES)).toHaveLength(2);
    const malas = consultasSinEsquema(MUESTRA_CON_INDICES);
    expect(malas).toHaveLength(1);
    expect(malas[0].sql).toContain("${TABLA}");
  });
});
