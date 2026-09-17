import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * ⭑ FICHA 436 · R30 — GUARDIA: LA CONVERSACIÓN NO SE GUARDA.
 *
 * ⚠️ QUÉ SE ESTÁ PROTEGIENDO, Y NO ES UNA ABSTRACCIÓN. Lo que la gente escribe en un asistente de
 * ayuda lleva, tarde o temprano, el nombre de un cliente, una dirección y un número de guía —«no me
 * deja cerrar la orden de doña Marta en Curridabat»—. Mientras nada de eso se persista, no hay
 * retención que decidir, no hay dato de cliente que custodiar y no hay nada que se pueda filtrar
 * desde la base. El día que alguien añada una columna de texto «para poder analizar las preguntas»,
 * esa decisión hay que tomarla a propósito y no descubrirla seis meses después.
 *
 * Lo ÚNICO que esta ficha escribe es un CONTADOR: cuántas consultas y cuántos «no lo sé». Números.
 *
 * Esta guardia mide DOS cosas que pueden cambiar sin que nada se ponga rojo:
 *   1. que el módulo no escriba en ninguna tabla que no sea `asistente_uso_diario`;
 *   2. que esa tabla no gane una columna donde quepa un texto libre.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const TABLA = "asistente_uso_diario";

/** El módulo del asistente MÁS su repositorio: todo lo que podría escribir algo. */
const ARCHIVOS = [
  "lib/repositories/AsistenteUsoRepository.ts",
  "lib/services/AsistenteService.ts",
  "lib/clients/anthropic-asistente.ts",
  ...listarTs("lib/asistente"),
  ...listarTs("app/api/asistente"),
];

function listarTs(relativo: string): string[] {
  const dir = path.join(RAIZ, relativo);
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) encontrados.push(...listarTs(`${relativo}/${entrada}`));
    else if (entrada.endsWith(".ts")) encontrados.push(`${relativo}/${entrada}`);
  }
  return encontrados;
}

/**
 * El código del archivo SIN sus comentarios.
 *
 * ⚠️ HACE FALTA, y lo descubrió esta guardia al nacer: el repositorio EXPLICA en su cabecera por qué
 * NO usa la API de modelo de Prisma para esta tabla, y el analizador leía esa frase —que está en un
 * comentario— como si fuera una escritura. Una guardia que se pone roja por lo que un comentario
 * CUENTA mide el texto, no el código.
 *
 * ⚠️ **EL QUITADOR ES EL COMPARTIDO DE LA 209** (revisión de la ficha, `m6`): el propio que tenía
 * aquí era el naíf —bloques antes que líneas—, con el que una barra-asterisco dentro de un
 * comentario de línea abre un bloque y se lleva por delante el código de debajo. En una guardia de
 * persistencia eso es un falso VERDE: el `INSERT` que buscaba podría estar en las líneas tragadas.
 */
const codigoDe = (archivo: string) =>
  quitarComentarios(readFileSync(path.join(RAIZ, archivo), "utf8"));

/**
 * ⭑ EL ANALIZADOR: las TABLAS sobre las que un archivo escribe.
 *
 * Mide las dos formas en las que en este árbol se escribe: SQL crudo (`INSERT INTO "x"`,
 * `UPDATE "x" SET`, `DELETE FROM "x"`) y la API de modelo de Prisma (`prisma.x.create(...)`,
 * `.upsert`, `.update`, `.delete`, `.createMany`…).
 *
 * Se exporta para que el CANARIO pueda darle un archivo inventado: una guardia que no se
 * autocomprueba puede estar verde por vacío.
 */
export function tablasEscritasEn(codigo: string): string[] {
  const escritas = new Set<string>();

  for (const m of codigo.matchAll(/INSERT\s+INTO\s+"?([a-zA-Z_]\w*)"?/gi)) escritas.add(m[1]);
  // Sin la bandera `s` (dotAll): el objetivo de `tsc` es anterior a es2018 y no la admite. No hace
  // falta — `\s+` ya cruza los saltos de línea de un `UPDATE` escrito en varias líneas.
  for (const m of codigo.matchAll(/UPDATE\s+"?([a-zA-Z_]\w*)"?\s+SET/gi)) escritas.add(m[1]);
  for (const m of codigo.matchAll(/DELETE\s+FROM\s+"?([a-zA-Z_]\w*)"?/gi)) escritas.add(m[1]);
  for (const m of codigo.matchAll(
    /\.(\w+)\s*\.\s*(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g,
  )) {
    escritas.add(m[1]);
  }

  return [...escritas].sort();
}

/** Los nombres que significan la MISMA tabla: el `snake_case` del SQL y el modelo de Prisma. */
const NOMBRES_PERMITIDOS = [TABLA, "asistenteUsoDiario"];

describe("436/R30 — el asistente no persiste ninguna conversación", () => {
  it("CONTROL DE NO-VACUIDAD: el barrido encuentra los archivos y alguno SÍ escribe", () => {
    expect(ARCHIVOS.length).toBeGreaterThanOrEqual(8);
    // Si el analizador no encontrara ni una escritura, el caso de abajo sería verde por vacío.
    const delRepositorio = tablasEscritasEn(codigoDe("lib/repositories/AsistenteUsoRepository.ts"));
    expect(delRepositorio).toEqual([TABLA]);
  });

  it("⭑ ningún archivo del módulo escribe en una tabla que no sea el contador", () => {
    const ofensas: string[] = [];
    for (const archivo of ARCHIVOS) {
      for (const tabla of tablasEscritasEn(codigoDe(archivo))) {
        if (!NOMBRES_PERMITIDOS.includes(tabla)) ofensas.push(`${archivo} -> ${tabla}`);
      }
    }
    expect(ofensas).toEqual([]);
  });

  it("⭑ CANARIO: una escritura a otra tabla se detecta, en SQL y por la API de modelo", () => {
    expect(
      tablasEscritasEn(`INSERT INTO "asistente_conversacion" ("pregunta") VALUES ($1)`),
    ).toEqual(["asistente_conversacion"]);
    expect(tablasEscritasEn(`await this.prisma.asistenteConversacion.create({ data })`)).toEqual([
      "asistenteConversacion",
    ]);
    expect(tablasEscritasEn(`UPDATE "orden" SET "estatus_id" = $1`)).toEqual(["orden"]);
    expect(tablasEscritasEn(`DELETE FROM "usuario" WHERE id = $1`)).toEqual(["usuario"]);
  });

  it("⭑ CANARIO al revés: una LECTURA no cuenta como escritura", () => {
    // Si el analizador marcara también los `SELECT`, marcaría todo y no distinguiría nada.
    expect(tablasEscritasEn(`SELECT * FROM "orden" WHERE id = $1`)).toEqual([]);
    expect(tablasEscritasEn(`await prisma.usuario.findFirst({ select: { id: true } })`)).toEqual([]);
  });
});

describe("436/R30 — y la tabla del contador no puede ganar una columna de texto libre", () => {
  const modelo = (() => {
    const esquema = readFileSync(path.join(RAIZ, "db/schema.prisma"), "utf8");
    const i = esquema.indexOf("model AsistenteUsoDiario {");
    expect(i, "el modelo AsistenteUsoDiario no está en db/schema.prisma").toBeGreaterThan(-1);
    return esquema.slice(i, esquema.indexOf("\n}", i));
  })();

  it("CONTROL DE NO-VACUIDAD: el bloque del modelo se leyó y tiene sus campos", () => {
    expect(modelo).toContain("consultas");
    expect(modelo).toContain("noLoSe");
  });

  it("⭑ los ÚNICOS campos `String` son el id y la clave ajena; nada donde quepa una pregunta", () => {
    const deTexto: string[] = [];
    for (const linea of modelo.split(/\r?\n/)) {
      const t = linea.trim();
      if (t.startsWith("//") || t.startsWith("@@")) continue;
      const campo = /^(\w+)\s+(String|Json|Bytes)\??\s/.exec(t);
      if (campo) deTexto.push(campo[1]);
    }
    // `id` y `usuarioId` son IDENTIFICADORES, no contenido. Cualquier otro `String` —`pregunta`,
    // `respuesta`, `slug`, `nota`— es exactamente lo que R30 prohíbe.
    expect(deTexto).toEqual(["id", "usuarioId"]);
  });

  it("⭑ y la MIGRACIÓN que la crea tampoco declara ninguna otra columna de texto", () => {
    // La otra mitad: el modelo y la base pueden divergir. Aquí se mide el DDL que se aplicó.
    const sql = readFileSync(
      path.join(RAIZ, "db/migrations/20260920120000_asistente_uso_diario/migration.sql"),
      "utf8",
    );
    const columnasTexto = [...sql.matchAll(/^\s*"(\w+)"\s+TEXT\b/gm)].map((m) => m[1]);
    expect(columnasTexto).toEqual(["id", "usuario_id"]);
    expect(sql).not.toMatch(/"(pregunta|respuesta|mensaje|conversacion|imagen)"/i);
  });
});
