import fs from "fs";
import path from "path";

import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNÉS — `fecha_reparto` SE ESCRIBE Y SE LIMPIA SIEMPRE CON `asignado_at`.
//
// LA INVARIANTE, DICHA COMO UNA SOLA REGLA (feature 246, R10):
//
//   > El día de reparto sólo tiene valor mientras la orden tenga mensajero asignado. Se escribe
//   > SIEMPRE en la misma escritura que fija `asignado_at`, y se limpia SIEMPRE en la misma
//   > escritura que lo limpia.
//
// ⚠️ POR QUÉ HACE FALTA UNA GUARDIA Y NO BASTA CON «acordarse». La feature 235 pagó exactamente
// este defecto: una marca persistida (`orden.ayuda`) con N sitios de limpieza y NINGUNO que rompa
// el build cuando se olvida uno. El resultado fue una fuga permanente en `/novedades`. `fecha_reparto`
// tiene la misma forma —una columna que acompaña a otra— y hoy son SEIS los sitios que limpian
// `asignado_at`. Una lista que haya que recordar es una lista que un día se olvida; un censo del
// árbol no se olvida.
//
// QUÉ CENSA, EXACTAMENTE. Recorre `lib/` entero buscando escrituras sobre `asignadoAt` /
// `asignado_at` —tanto en `data: { ... }` de Prisma como en `SET` de SQL crudo— y exige que la
// MISMA escritura toque `fechaReparto` / `fecha_reparto`. No mira una lista de archivos conocidos:
// un sitio NUEVO que escriba `asignado_at` entra solo en el censo. Ése es el punto.
//
// ⚠️ AVISO PARA OTRAS FICHAS EN VUELO (la 240, `rechazo manual de la tienda`): si tu arista limpia
// la asignación (`mensajero_asignado_id` / `asignado_at`), esta guardia se pondrá ROJA hasta que
// limpies también `fecha_reparto`. Eso es la guardia haciendo su trabajo, no un fallo tuyo.
//
// POR QUÉ SE LEE DEL FUENTE Y NO SE IMPORTA NADA. No hay ninguna constante que importar: lo que se
// vigila es la FORMA de un objeto literal repartido por seis archivos. Y el censo se escribe en un
// archivo de test, NUNCA por `node -e`: ahí `\b` llega como backspace y el censo miente en verde.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LIB = path.join(REPO_ROOT, "lib");

/** Corta en seco: si la guardia no puede leer lo que vigila, se detiene en ROJO. */
function reventar(que: string): never {
  throw new Error(
    `guardia fecha-reparto-acompana-asignado-at: ${que}. La guardia NO pudo leer lo que vigila; ` +
      `se detiene en ROJO en vez de dar por buena una lectura vacía. Si el código se reorganizó, ` +
      `actualiza la extracción — no borres la comprobación.`,
  );
}

/** Todos los `.ts` bajo `lib/`, recursivo. */
function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) out.push(...archivosTs(ruta));
    else if (entrada.name.endsWith(".ts")) out.push(ruta);
  }
  return out;
}

/**
 * Una ESCRITURA sobre la orden: el trozo de código que la contiene, ya sin comentarios.
 *
 * Se extrae por delimitadores equilibrados —llaves para un `data: { ... }` de Prisma, y de
 * `SET` hasta `WHERE` para un `UPDATE` crudo— y no por «N líneas alrededor»: una ventana de
 * líneas se puede colar en la escritura de al lado y dar por buena una limpieza que está en otro
 * sitio.
 */
interface Escritura {
  archivo: string;
  clase: "prisma-data" | "sql-set";
  texto: string;
}

/** Del `{` en `desde` hasta su `}` pareja. `null` si no cierra (código truncado o raro). */
function bloqueLlaves(fuente: string, desde: number): string | null {
  const abre = fuente.indexOf("{", desde);
  if (abre === -1) return null;
  let nivel = 0;
  for (let i = abre; i < fuente.length; i += 1) {
    const c = fuente[i];
    if (c === "{") nivel += 1;
    else if (c === "}") {
      nivel -= 1;
      if (nivel === 0) return fuente.slice(abre, i + 1);
    }
  }
  return null;
}

/**
 * Escrituras de Prisma: `data: { ... asignadoAt ... }`. Se busca cada `data:` y se comprueba si su
 * bloque menciona `asignadoAt`; así el bloque devuelto es EXACTAMENTE el de esa escritura.
 */
function escriturasPrisma(archivo: string, codigo: string): Escritura[] {
  const out: Escritura[] = [];
  const re = /\bdata\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const bloque = bloqueLlaves(codigo, m.index);
    if (bloque === null) continue;
    if (/\basignadoAt\b/.test(bloque)) out.push({ archivo, clase: "prisma-data", texto: bloque });
  }
  return out;
}

/**
 * Escrituras en SQL crudo: del `SET` hasta el `WHERE` (o `RETURNING`) de ese mismo `UPDATE`.
 * Sólo cuentan las que ASIGNAN `asignado_at` (`"asignado_at" =`), no las que lo leen.
 */
function escriturasSql(archivo: string, codigo: string): Escritura[] {
  const out: Escritura[] = [];
  const re = /\bSET\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const resto = codigo.slice(m.index);
    const fin = resto.search(/\bWHERE\b|\bRETURNING\b/);
    const set = fin === -1 ? resto.slice(0, 600) : resto.slice(0, fin);
    if (/"asignado_at"\s*=/.test(set)) out.push({ archivo, clase: "sql-set", texto: set });
  }
  return out;
}

/** ¿Esta escritura toca el día de reparto, de la forma que sea? */
function tocaFechaReparto(texto: string): boolean {
  return /\bfechaReparto\b/.test(texto) || /"fecha_reparto"/.test(texto);
}

// =============================================================================================
// FEATURE 262 (B9, design §6.3) — EL CENSO DEL **DÍA**, Y LA EXCEPCIÓN DECLARADA
// =============================================================================================
//
// ⚠️ POR QUÉ HACE FALTA UN SEGUNDO CENSO, Y ESTO ESTÁ **MEDIDO**, NO SUPUESTO. El censo de arriba
// recoge SÓLO los `data: {…}` que mencionan `asignadoAt` y SÓLO los `SET` que contienen
// `"asignado_at" =`. Una escritura que toque **únicamente** `fecha_reparto` **no entra en él**, así
// que las cuatro cláusulas de arriba **ni siquiera la ven** —incluida la de aritmética de zona
// horaria—. Es decir: la guardia vigilaba UNA dirección de la invariante 246/R10, y desde la 262
// existe la otra.
//
// LO QUE YA VIGILABA **NO SE TOCA NI SE RELAJA**: las cuatro cláusulas originales siguen abajo,
// palabra por palabra. Lo que se añade es un censo nuevo y una lista de excepciones **de un solo
// elemento**, con su fecha, su motivo y su puntero — mismo cuidado con el que la 261 anexó la
// reversión de D5 a la 246.
//
// LA EXCEPCIÓN, DICHA COMO REGLA: existe EXACTAMENTE UNA escritura del día que no acompaña a
// `asignado_at`, es `OrdenRepository.corregirDiaRepartoLote` y su `SET` asigna EXACTAMENTE
// `{fecha_reparto, updated_at}`. Si aparece una segunda, o si a ésta le suman una columna, esta
// guardia se pone ROJA.

/** Fecha, motivo y puntero de la única excepción admitida. Un `skip` sin razón escrita es deuda. */
const EXCEPCION_262 = {
  fecha: "2026-08-22",
  archivo: "lib/repositories/OrdenRepository.ts",
  /** El conjunto EXACTO de columnas que su `SET` puede asignar. Ordenado para comparar. */
  columnas: ["fecha_reparto", "updated_at"],
  motivo:
    "corregir el día de reparto de una orden YA asignada NO es una re-asignación: el mensajero es " +
    "el mismo y el instante en que se le asignó no ha cambiado, así que escribir `asignado_at` " +
    "FALSEARÍA el dato que el esquema define como «instante de la última (re)asignación». La " +
    "invariante sobrevive por el `WHERE` (exige mensajero y día previos), no por pisar una columna.",
  puntero: "specs/262-corregir-dia-reparto (design §6.2/§6.3, R27-R29)",
} as const;

/**
 * POR QUÉ LA HUELLA ES «ARCHIVO + CONJUNTO EXACTO DE COLUMNAS» Y NO OTRA COSA:
 *
 *  - **por archivo a secas, no**: `OrdenRepository.ts` tiene decenas de escrituras y la excepción
 *    se leería como «en este archivo vale todo» (A9);
 *  - **por nombre del método, tampoco**: el extractor trabaja sobre TEXTO y no conoce la función
 *    que lo contiene; deducirla retrocediendo hasta el `async <nombre>(` más cercano se rompe con
 *    la primera función anidada, y una guardia frágil termina desactivada (A10);
 *  - **el conjunto exacto de columnas es lo que cierra la puerta**: si mañana alguien le suma
 *    `"mensajero_asignado_id" =` o `"estatus_id" =` a esta misma escritura, la huella cambia y la
 *    guardia se pone roja. Que es justo lo que debe pasar: eso ya no sería una corrección de día.
 */
function columnasAsignadas(texto: string): string[] {
  return [...texto.matchAll(/"([a-z_]+)"\s*=/g)].map((m) => m[1]).sort();
}

/** Escrituras de Prisma que mencionan el DÍA (con o sin `asignadoAt`). */
function escriturasDiaPrisma(archivo: string, codigo: string): Escritura[] {
  const out: Escritura[] = [];
  const re = /\bdata\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const bloque = bloqueLlaves(codigo, m.index);
    if (bloque === null) continue;
    if (/\bfechaReparto\b/.test(bloque)) out.push({ archivo, clase: "prisma-data", texto: bloque });
  }
  return out;
}

/**
 * Escrituras en SQL crudo que ASIGNAN el día (`"fecha_reparto" =`), no las que lo leen.
 *
 * ⚠️ EL CORTE ES EL MISMO QUE ARRIBA —de `SET` al primer `WHERE`/`RETURNING`—, y eso importa: la
 * escritura de la corrección es un `UPDATE` plano cuyo `WHERE` va ANTES del `RETURNING`, así que el
 * corte cae donde debe y el `RETURNING` (que sí nombra otras columnas) queda FUERA de la huella por
 * construcción. La autocomprobación de más abajo usa la forma FINAL del SQL, con su `RETURNING`
 * ancho: validar el detector contra un texto que ya no existe en el árbol es una guardia que se
 * cree verificada.
 */
function escriturasDiaSql(archivo: string, codigo: string): Escritura[] {
  const out: Escritura[] = [];
  const re = /\bSET\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(codigo)) !== null) {
    const resto = codigo.slice(m.index);
    const fin = resto.search(/\bWHERE\b|\bRETURNING\b/);
    const set = fin === -1 ? resto.slice(0, 600) : resto.slice(0, fin);
    if (/"fecha_reparto"\s*=/.test(set)) out.push({ archivo, clase: "sql-set", texto: set });
  }
  return out;
}

/** ¿Esta escritura toca también `asignado_at`? (Las que SÍ ya las cubren las cláusulas de arriba.) */
function tocaAsignadoAt(texto: string): boolean {
  return /\basignadoAt\b/.test(texto) || /"asignado_at"\s*=/.test(texto);
}

/** Un recorrido de `lib/` que aplica los extractores que se le pasen. */
function censar(
  extractores: ((archivo: string, codigo: string) => Escritura[])[],
): Escritura[] {
  if (!fs.existsSync(LIB)) reventar("no existe el directorio `lib/`");
  const archivos = archivosTs(LIB);
  if (archivos.length === 0) reventar("no se encontró ni un `.ts` bajo `lib/`");
  const out: Escritura[] = [];
  for (const ruta of archivos) {
    const codigo = quitarComentarios(fs.readFileSync(ruta, "utf8"));
    const rel = path.relative(REPO_ROOT, ruta).replace(/\\/g, "/");
    for (const extraer of extractores) out.push(...extraer(rel, codigo));
  }
  return out;
}

const ESCRITURAS: Escritura[] = censar([escriturasPrisma, escriturasSql]);

/** Feature 262 (B9): el censo del DÍA — escrituras de `fecha_reparto`, con o sin `asignado_at`. */
const ESCRITURAS_DEL_DIA: Escritura[] = censar([escriturasDiaPrisma, escriturasDiaSql]);

describe("guardia · el día de reparto acompaña SIEMPRE a `asignado_at` (246/R10)", () => {
  it("la guardia encuentra escrituras que vigilar (si no, todo lo demás mentiría en verde)", () => {
    // Un censo vacío pasa todos los `every` del mundo. Esta cota es lo que impide que un refactor
    // que mueva las escrituras deje la guardia verde y muda.
    if (ESCRITURAS.length === 0) reventar("el censo no encontró ni una escritura de `asignado_at`");
    // Hoy son SEIS limpiezas + tres estampados (bodega, satélite, deshacer gestión) + el de
    // `generarGuiaLote`. La cota es holgada a propósito: lo que se afirma es «hay censo», no un
    // número exacto que un refactor legítimo tendría que venir a actualizar.
    expect(ESCRITURAS.length).toBeGreaterThanOrEqual(6);
  });

  it("TODA escritura que fija o limpia `asignado_at` toca también `fecha_reparto`", () => {
    const infractoras = ESCRITURAS.filter((e) => !tocaFechaReparto(e.texto));
    const detalle = infractoras
      .map((e) => `  · ${e.archivo} (${e.clase}):\n    ${e.texto.replace(/\s+/g, " ").slice(0, 200)}`)
      .join("\n");
    expect(
      infractoras,
      `Estas escrituras tocan \`asignado_at\` y NO tocan \`fecha_reparto\`:\n${detalle}\n\n` +
        `La invariante (246/R10) es que el día de reparto sólo tiene valor mientras la orden ` +
        `tenga mensajero. Si esta escritura FIJA la asignación, tiene que fijar también el día; ` +
        `si la LIMPIA, tiene que limpiarlo. En la misma escritura, no en una segunda pasada.`,
    ).toEqual([]);
  });

  it("una escritura que limpia `asignado_at` limpia el día a NULL, no lo deja con valor", () => {
    // La mitad negativa de la invariante: limpiar el mensajero y dejar una reserva viva sería una
    // reserva HUÉRFANA, y el corte tendría que decidir qué hacer con ella.
    const limpiezas = ESCRITURAS.filter((e) =>
      e.clase === "prisma-data"
        ? /\basignadoAt\s*:\s*null\b/.test(e.texto)
        : /"asignado_at"\s*=\s*NULL/i.test(e.texto),
    );
    if (limpiezas.length === 0) reventar("el censo no encontró ni una LIMPIEZA de `asignado_at`");
    for (const e of limpiezas) {
      const limpiaElDia =
        e.clase === "prisma-data"
          ? /\bfechaReparto\s*:\s*null\b/.test(e.texto)
          : /"fecha_reparto"\s*=\s*NULL/i.test(e.texto);
      expect(
        limpiaElDia,
        `${e.archivo} limpia \`asignado_at\` pero no pone \`fecha_reparto\` a NULL`,
      ).toBe(true);
    }
  });

  it("R17: ninguna escritura del día de reparto hace aritmética de zona horaria en el SQL", () => {
    // La única definición del día vive en `lib/utils/fecha-cr.ts` y entra a las consultas como
    // PARÁMETRO. Un `NOW()::date` o un `interval '6 hours'` aquí sería una segunda definición del
    // día, en el peor sitio posible: dentro de una sentencia, donde nadie la busca.
    const conDia = ESCRITURAS.filter((e) => e.clase === "sql-set" && tocaFechaReparto(e.texto));
    if (conDia.length === 0) reventar("el censo no encontró ninguna escritura SQL del día");
    for (const e of conDia) {
      expect(e.texto, `${e.archivo}: el SET usa NOW()::date`).not.toMatch(/NOW\(\)\s*::\s*date/i);
      expect(e.texto, `${e.archivo}: el SET usa CURRENT_DATE`).not.toMatch(/CURRENT_DATE/i);
      expect(e.texto, `${e.archivo}: el SET usa AT TIME ZONE`).not.toMatch(/AT TIME ZONE/i);
      expect(e.texto, `${e.archivo}: el SET nombra la zona de CR`).not.toMatch(
        /America\/Costa_Rica/,
      );
      expect(e.texto, `${e.archivo}: el SET usa un interval`).not.toMatch(/interval\s+'/i);
    }
  });
});

// =============================================================================================
// FEATURE 262 (B9) — LA OTRA DIRECCIÓN DE LA INVARIANTE: escrituras del DÍA sin `asignado_at`
// =============================================================================================

describe("guardia · el censo del DÍA y su ÚNICA excepción declarada (262/R29)", () => {
  it("(d1) el censo del día no está vacío y tiene al menos SIETE entradas", () => {
    // La cota es lo que impide que un refactor que mueva las escrituras deje esta mitad de la
    // guardia verde POR VACÍA — el fallo que este repo ya tuvo con una guardia que no podía fallar
    // nunca. Hoy son diez: tres estampados (bodega, satélite, `generarGuiaLote`), cinco limpiezas,
    // el `CASE` que la 261 puso en el deshacer de una gestión y la corrección de la 262. Siete es
    // holgado a propósito: lo que se afirma es «hay censo», no un número que un refactor legítimo
    // tendría que venir a actualizar.
    if (ESCRITURAS_DEL_DIA.length === 0) {
      reventar("el censo del día no encontró ni una escritura de `fecha_reparto`");
    }
    expect(ESCRITURAS_DEL_DIA.length).toBeGreaterThanOrEqual(7);
  });

  it("(d2) toda escritura del día que NO toca `asignado_at` es la excepción DECLARADA", () => {
    const sinAsignado = ESCRITURAS_DEL_DIA.filter((e) => !tocaAsignadoAt(e.texto));
    const infractoras = sinAsignado.filter(
      (e) =>
        e.archivo !== EXCEPCION_262.archivo ||
        JSON.stringify(columnasAsignadas(e.texto)) !== JSON.stringify(EXCEPCION_262.columnas),
    );
    const detalle = infractoras
      .map(
        (e) =>
          `  · ${e.archivo} (${e.clase}) columnas=[${columnasAsignadas(e.texto).join(", ")}]:\n` +
          `    ${e.texto.replace(/\s+/g, " ").slice(0, 200)}`,
      )
      .join("\n");
    expect(
      infractoras,
      `Estas escrituras tocan \`fecha_reparto\` SIN tocar \`asignado_at\`, y no son la excepción ` +
        `declarada:\n${detalle}\n\n` +
        `La invariante (246/R10) dice que el día de reparto sólo tiene valor mientras la orden ` +
        `tenga mensajero, y por eso se escribe y se limpia SIEMPRE con \`asignado_at\`. La ficha ` +
        `262 abrió UNA excepción, con nombre y con fecha:\n\n` +
        `  archivo:  ${EXCEPCION_262.archivo}\n` +
        `  columnas: {${EXCEPCION_262.columnas.join(", ")}}\n` +
        `  desde:    ${EXCEPCION_262.fecha}\n` +
        `  motivo:   ${EXCEPCION_262.motivo}\n` +
        `  ver:      ${EXCEPCION_262.puntero}\n\n` +
        `Si lo tuyo es OTRA corrección legítima del día, no la cuelgues de esta excepción: ` +
        `discútela y declárala aparte, con su propia razón escrita. Si lo tuyo asigna además el ` +
        `mensajero o el estado, entonces NO es una corrección de día y tiene que escribir ` +
        `\`asignado_at\` como todas las demás.`,
    ).toEqual([]);
  });

  it("(d3) esa excepción es EXACTAMENTE UNA, no «una o más»", () => {
    // El hueco que (d2) sola dejaría: una SEGUNDA escritura con la misma forma en el mismo archivo
    // pasaría (d2) sin que nadie la mirara. Con esta cota, la segunda pone la guardia roja aunque
    // se parezca a la primera — que es cuando más falta hace.
    const sinAsignado = ESCRITURAS_DEL_DIA.filter((e) => !tocaAsignadoAt(e.texto));
    expect(
      sinAsignado.length,
      `Se esperaba UNA sola escritura del día sin \`asignado_at\` (la excepción de la 262) y hay ` +
        `${sinAsignado.length}:\n` +
        sinAsignado.map((e) => `  · ${e.archivo}`).join("\n") +
        `\n\nDos escrituras con la misma huella no son «la misma excepción»: son dos, y la segunda ` +
        `no la ha discutido nadie.`,
    ).toBe(1);
  });

  it("(d4) la cláusula de aritmética horaria se aplica TAMBIÉN al censo del día", () => {
    // La única definición del día vive en `lib/utils/fecha-cr.ts` y entra a las consultas como
    // PARÁMETRO. Antes de la 262 esta comprobación sólo alcanzaba a las escrituras que tocaban
    // `asignado_at`; una segunda definición del día dentro de la sentencia de la corrección no la
    // miraba nadie.
    const sql = ESCRITURAS_DEL_DIA.filter((e) => e.clase === "sql-set");
    if (sql.length === 0) reventar("el censo del día no encontró ninguna escritura SQL");
    for (const e of sql) {
      expect(e.texto, `${e.archivo}: el SET usa NOW()::date`).not.toMatch(/NOW\(\)\s*::\s*date/i);
      expect(e.texto, `${e.archivo}: el SET usa CURRENT_DATE`).not.toMatch(/CURRENT_DATE/i);
      expect(e.texto, `${e.archivo}: el SET usa AT TIME ZONE`).not.toMatch(/AT TIME ZONE/i);
      expect(e.texto, `${e.archivo}: el SET nombra la zona de CR`).not.toMatch(
        /America\/Costa_Rica/,
      );
      expect(e.texto, `${e.archivo}: el SET usa un interval`).not.toMatch(/interval\s+'/i);
    }
  });
});

describe("guardia · autocomprobación del censo del DÍA (262/B9)", () => {
  // ⚠️ ESTE ES EL SQL **FINAL** DE `corregirDiaRepartoLote`, con su `RETURNING` ancho — el que de
  // verdad está en el árbol, no el del borrador de `design.md` §6.1. Validar un detector contra un
  // texto que ya no existe es una guardia que se cree verificada.
  const SQL_CORRECCION = `
    const movidas = await tx.$queryRaw\`
      UPDATE "orden"
      SET "fecha_reparto" = \${diaTexto}::date,
          "updated_at" = NOW()
      WHERE "id" IN (\${Prisma.join(ids)})
        AND "estatus_id" IN (\${Prisma.join(estatusIds)})
        AND "mensajero_asignado_id" IS NOT NULL
        AND "fecha_reparto" IS NOT NULL
        AND "fecha_reparto" <> \${diaTexto}::date
        AND "deleted_at" IS NULL
      RETURNING "id", "mensajero_asignado_id", "num_guia", "num_remision"\`;
  `;

  it("sobre la forma REAL del SQL de la corrección, la huella es {fecha_reparto, updated_at}", () => {
    const encontradas = escriturasDiaSql("fixture.ts", quitarComentarios(SQL_CORRECCION));
    expect(encontradas).toHaveLength(1);
    // El corte cae en el `WHERE`, así que el `RETURNING` —que nombra otras cuatro columnas— NO
    // entra en la huella. Esto es lo que demuestra que el detector lee lo que dice leer.
    expect(columnasAsignadas(encontradas[0].texto)).toEqual(["fecha_reparto", "updated_at"]);
    expect(tocaAsignadoAt(encontradas[0].texto)).toBe(false);
  });

  it("CONTRAPRUEBA: la MISMA sentencia con `asignado_at` añadido cambia la huella", () => {
    // La mutación M-k. Con `"asignado_at" = NULL` en el `SET`, la escritura deja de ser la
    // excepción declarada por DOS vías a la vez: cambia el conjunto de columnas y pasa a tocar
    // `asignado_at`. Si el detector no discriminara, este caso saldría idéntico al de arriba.
    const mutado = SQL_CORRECCION.replace(
      `"updated_at" = NOW()`,
      `"updated_at" = NOW(),\n          "asignado_at" = NULL`,
    );
    const encontradas = escriturasDiaSql("fixture.ts", quitarComentarios(mutado));
    expect(encontradas).toHaveLength(1);
    expect(columnasAsignadas(encontradas[0].texto)).toEqual([
      "asignado_at",
      "fecha_reparto",
      "updated_at",
    ]);
    expect(columnasAsignadas(encontradas[0].texto)).not.toEqual(EXCEPCION_262.columnas);
    expect(tocaAsignadoAt(encontradas[0].texto)).toBe(true);
  });

  it("caza una escritura del día NUEVA, en otro archivo y sin `asignado_at` (M-w)", () => {
    const fuente = `
      const filas = await tx.$queryRaw\`
        UPDATE "orden"
        SET "fecha_reparto" = \${otra}::date
        WHERE "id" = \${id}
        RETURNING "id"\`;
    `;
    const encontradas = escriturasDiaSql("lib/repositories/OtroRepository.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaAsignadoAt(encontradas[0].texto)).toBe(false);
    // Y NO encaja con la excepción: distinto archivo y distinto conjunto de columnas.
    expect(encontradas[0].archivo).not.toBe(EXCEPCION_262.archivo);
    expect(columnasAsignadas(encontradas[0].texto)).not.toEqual(EXCEPCION_262.columnas);
  });

  it("recoge también los `data` de Prisma que mencionan el día (los estampados y las limpiezas)", () => {
    const fuente = `
      await tx.orden.updateMany({
        where: { id },
        data: { mensajeroAsignadoId: null, asignadoAt: null, fechaReparto: null },
      });
    `;
    const encontradas = escriturasDiaPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    // Toca `asignadoAt`, así que la cubren las cuatro cláusulas ORIGINALES y no entra en (d2)/(d3).
    expect(tocaAsignadoAt(encontradas[0].texto)).toBe(true);
  });

  it("no confunde una LECTURA del día con una escritura", () => {
    const orderBy = `const x = await p.orden.findMany({ orderBy: { fechaReparto: "desc" } });`;
    expect(escriturasDiaPrisma("fixture.ts", quitarComentarios(orderBy))).toEqual([]);
    const select = `const sql = \`SELECT "fecha_reparto" FROM "orden" WHERE id = 1\`;`;
    expect(escriturasDiaSql("fixture.ts", quitarComentarios(select))).toEqual([]);
  });

  it("`columnasAsignadas` lee lo que hay, no una respuesta fija (contraprueba)", () => {
    expect(columnasAsignadas(`SET "a" = 1, "b" = 2`)).toEqual(["a", "b"]);
    expect(columnasAsignadas(`SET "z_uno" = 1`)).toEqual(["z_uno"]);
    expect(columnasAsignadas(`data: { fechaReparto }`)).toEqual([]);
  });
});

describe("guardia · autocomprobación (el censo detecta lo que dice detectar)", () => {
  it("caza un `data` de Prisma que fija `asignadoAt` sin el día", () => {
    const fuente = `
      await tx.orden.updateMany({
        where: { id },
        data: { estatusId, mensajeroAsignadoId: m, asignadoAt: new Date() },
      });
    `;
    const encontradas = escriturasPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(false);
  });

  it("da por buena la misma escritura cuando SÍ lleva el día", () => {
    const fuente = `
      await tx.orden.updateMany({
        where: { id },
        data: { estatusId, mensajeroAsignadoId: m, asignadoAt: new Date(), fechaReparto },
      });
    `;
    const encontradas = escriturasPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(true);
  });

  it("caza un `SET` de SQL crudo que limpia `asignado_at` sin el día", () => {
    const fuente = `
      const rows = await tx.$queryRaw\`
        UPDATE "orden"
        SET "mensajero_asignado_id" = NULL,
            "asignado_at" = NULL,
            "updated_at" = NOW()
        WHERE "id" = \${id}
        RETURNING "id"\`;
    `;
    const encontradas = escriturasSql("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(1);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(false);
  });

  it("el bloque extraído NO se desborda a la escritura de al lado", () => {
    // Si el censo cogiera «N líneas alrededor» en vez de llaves equilibradas, la limpieza del
    // segundo `data` daría por buena la del primero. Esto lo demuestra.
    const fuente = `
      await a.update({ data: { asignadoAt: new Date() } });
      await b.update({ data: { asignadoAt: null, fechaReparto: null } });
    `;
    const encontradas = escriturasPrisma("fixture.ts", quitarComentarios(fuente));
    expect(encontradas).toHaveLength(2);
    expect(tocaFechaReparto(encontradas[0].texto)).toBe(false); // la primera SIGUE siendo infractora
    expect(tocaFechaReparto(encontradas[1].texto)).toBe(true);
  });

  it("no confunde una LECTURA de `asignado_at` con una escritura", () => {
    // `ORDER BY asignado_at` y `select: { asignadoAt: true }` no son escrituras y no deben entrar
    // en el censo: si entraran, la guardia exigiría limpiar el día en un `SELECT`.
    const orderBy = `const x = await p.orden.findMany({ orderBy: { asignadoAt: "desc" } });`;
    expect(escriturasPrisma("fixture.ts", quitarComentarios(orderBy))).toEqual([]);
    const select = `const sql = \`SELECT "asignado_at" FROM "orden" WHERE id = 1\`;`;
    expect(escriturasSql("fixture.ts", quitarComentarios(select))).toEqual([]);
  });
});
