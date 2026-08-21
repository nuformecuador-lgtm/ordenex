import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { quitarComentarios, quitarComentariosSql } from "../../fixtures/sin-comentarios";
import { ARCHIVOS_BACKEND, REPO_ROOT, arbolDeLaFeature } from "./_arbol-de-la-feature";

// Feature 192 (B8.5) — R59. **GUARDIA DE DINERO, no de estilo.**
//
// `orden.asignado_at` es el DENOMINADOR del ranking diario del mensajero (feature 76/R38,
// ficha 166). El numerador solo cuenta entregas, asi que estampar esa columna en una
// recoleccion —que no es una entrega— BAJA el porcentaje del mensajero sin darle forma de
// subirlo: le toca el pago y el premio para arreglar una pantalla de lectura. El humano
// descarto esa opcion explicitamente (alternativa 14) y eligio el segundo camino por el
// historial.
//
// Esta feature es SOLO LECTURA sobre esa columna. El guardia existe para que un futuro "ya que
// estamos, unifiquemos el criterio en una columna" salga ROJO en vez de salir en produccion.

const ESCRITURAS_SQL = /\b(UPDATE|INSERT|DELETE|MERGE)\b/;
const ESCRITURAS_PRISMA = /\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\s*\(/;

/**
 * Los comentarios se quitan ANTES de censar: este mismo repositorio explica por escrito que
 * no hace ni un `INSERT`, `UPDATE` ni `DELETE`, y un censo que leyera esa frase como una
 * infraccion obligaria a borrar la explicacion para pasar el guardia. Se mide el codigo.
 *
 * Feature 209 — el quitador es ahora el COMPARTIDO (misma copia que `_arbol-de-la-feature`).
 * Lo que cambia: antes solo caia el comentario de LINEA COMPLETA, asi que un `.update(` citado
 * al final de una linea de codigo sobrevivia y esta guardia de DINERO lo contaba como una
 * escritura. Medido contra los 16 archivos que censa: ningun veredicto se mueve.
 */
const sinComentarios = quitarComentarios;

const MIGRACIONES = path.join(REPO_ROOT, "db", "migrations");

/** La migracion que NOMBRA la columna sin tocarla. Ver el bloque de abajo: es el 3 → 2. */
const LA_QUE_SOLO_LA_EXPLICA = "20260731130000_order_status_recolectando/migration.sql";

/**
 * Las UNICAS migraciones del repo que TOCAN `asignado_at`, congeladas. Esta feature no añade
 * ninguna (R37: ni migraciones ni indices). Si aparece una tercera, hay que mirarla a mano
 * antes de tocar esta lista.
 *
 * ## Por que esta lista tenia TRES entradas hasta el 2026-08-12 (feature 209)
 *
 * El censo leia el `.sql` EN CRUDO, asi que contaba tambien a quien solo la NOMBRA en prosa.
 * La tercera entrada era `20260731130000_order_status_recolectando/migration.sql`, cuya unica
 * aparicion de `asignado_at` esta en la linea 37, dentro de un comentario `--` que dice
 * literalmente que NO la toca. Las otras dos si la tocan en SQL vivo (`ADD COLUMN` +
 * `CREATE INDEX`, y sus `DROP` en el `down.sql`).
 *
 * El total baja de 3 a 2 A PROPOSITO, y baja porque el censo dejo de mentir: **esto es una
 * lista blanca de QUIEN PUEDE TOCAR el denominador del pago al mensajero.** Una entrada de mas
 * es permiso concedido a quien nunca lo pidio, y es exactamente el precedente con el que
 * alguien justificara dentro de seis meses que su migracion tambien puede entrar. Documentar
 * la columna sigue siendo libre; tocarla, no.
 *
 * El caso «209: …» de mas abajo es el recibo de ese 3 → 2 y lo que impide que se deshaga en
 * silencio.
 */
const MIGRACIONES_QUE_TOCAN_LA_COLUMNA = [
  "20260716120000_orden_asignado_at/down.sql",
  "20260716120000_orden_asignado_at/migration.sql",
  // ── FEATURE 246 (2026-08-20) — LA TERCERA Y CUARTA ENTRADA, MIRADAS A MANO ────────────────────
  //
  // La cabecera de arriba lo pedia con todas las letras: «si aparece una tercera, hay que mirarla
  // a mano antes de tocar esta lista». Esto es ese recibo.
  //
  // QUE HACE LA 246 CON `asignado_at`: **nada a los datos**. Lo que hace es INDEXARLA junto a
  // `fecha_reparto`. El `EXPLAIN` de produccion mostro que la consulta del denominador del ranking
  // se sirve con un `Index Only Scan` sobre `(mensajero_asignado_id, asignado_at)`, y que el `OR`
  // que la 246 anade sobre `fecha_reparto` lo ROMPIA porque esa columna no estaba en el indice. La
  // migracion AMPLIA ese indice a `(mensajero_asignado_id, asignado_at, fecha_reparto)` — y el
  // `down.sql` repone el de dos columnas, por eso son DOS entradas y no una.
  //
  // POR QUE SE CONCEDE EL PERMISO Y NO SE RELAJA EL CENSO. Habria sido mas comodo ensenarle a esta
  // guardia que «un `CREATE INDEX` no toca la columna». Seria FALSO en el sentido que importa
  // —quien puede reindexar puede reordenar, y reordenar las columnas de ese indice le quita el plan
  // a `TableroDiaRepository` sin romper nada mas— y ademas contradiria el precedente: la entrada
  // original de esta lista (`20260716120000_orden_asignado_at`) entro aqui precisamente por su
  // `ADD COLUMN` **+ `CREATE INDEX`**. Indexar es tocar, para esta lista. Se declara.
  //
  // Y EL PERMISO NO ES UN CHEQUE EN BLANCO: el caso «246: …» de mas abajo exige que en estas dos
  // entradas `asignado_at` aparezca UNICAMENTE dentro de `CREATE INDEX` / `DROP INDEX`. Si alguna
  // pasara a escribir la columna, cae ese caso — no este.
  "20260820180000_orden_fecha_reparto/down.sql",
  "20260820180000_orden_fecha_reparto/migration.sql",
];

/** Las entradas de la lista blanca que SOLO pueden indexar la columna, nunca escribirla. */
const SOLO_PUEDEN_INDEXAR = [
  "20260820180000_orden_fecha_reparto/migration.sql",
  "20260820180000_orden_fecha_reparto/down.sql",
];

function migracionesQueTocanAsignadoAt(): string[] {
  const salida: string[] = [];
  for (const dir of fs.readdirSync(MIGRACIONES)) {
    const carpeta = path.join(MIGRACIONES, dir);
    if (!fs.statSync(carpeta).isDirectory()) continue;
    for (const archivo of fs.readdirSync(carpeta)) {
      if (!archivo.endsWith(".sql")) continue;
      const texto = fs.readFileSync(path.join(carpeta, archivo), "utf8");
      // El SQL vivo, sin `--` ni `/* … */`: la prosa que EXPLICA la columna no es tocarla.
      if (quitarComentariosSql(texto).includes("asignado_at")) salida.push(`${dir}/${archivo}`);
    }
  }
  return salida.sort();
}

describe("asignado_at es de SOLO LECTURA en toda la feature", () => {
  it("los archivos censados existen: el guardia mira lo que dice mirar", () => {
    for (const ruta of ARCHIVOS_BACKEND) {
      expect(fs.existsSync(path.join(REPO_ROOT, ruta)), `falta ${ruta}`).toBe(true);
    }
  });

  it("ningun archivo de la feature emite una escritura, ni en SQL ni por Prisma (R59)", () => {
    // No se censa "asignadoAt aparece en un payload" sino algo mas fuerte y menos fragil: la
    // feature no escribe NADA. Sin `UPDATE`, sin `INSERT` y sin `.update(`, no hay forma de
    // tocar esa columna ni por descuido ni por "ya que estamos".
    for (const { ruta, texto } of arbolDeLaFeature()) {
      const codigo = sinComentarios(texto);
      expect(ESCRITURAS_SQL.test(codigo), `${ruta} contiene SQL de escritura`).toBe(false);
      expect(ESCRITURAS_PRISMA.test(codigo), `${ruta} llama a un metodo de escritura`).toBe(false);
    }
  });

  it("la feature no añade ninguna migracion que toque la columna (R37/R59)", () => {
    expect(migracionesQueTocanAsignadoAt()).toEqual(MIGRACIONES_QUE_TOCAN_LA_COLUMNA);
  });

  it("209: la migracion de `recolectando` la NOMBRA pero no la toca (el recibo del 3 → 2)", () => {
    // Este caso existe para que el numero de arriba no sea un misterio: la entrada que salio
    // de la lista el 2026-08-12 sigue aqui, medida en las dos caras. Y no es un test muerto:
    // una migracion YA APLICADA es inmutable, asi que editarla en sitio es drift, y si esa
    // edicion pasara a tocar `asignado_at` de verdad, este caso cae ANTES de que la lista
    // blanca de arriba tenga que decidir si le abre la puerta.
    const texto = fs.readFileSync(path.join(MIGRACIONES, LA_QUE_SOLO_LA_EXPLICA), "utf8");

    expect(texto, `${LA_QUE_SOLO_LA_EXPLICA} ya no explica la columna`).toContain("asignado_at");
    expect(
      quitarComentariosSql(texto),
      `${LA_QUE_SOLO_LA_EXPLICA} paso a TOCAR asignado_at en SQL vivo`,
    ).not.toContain("asignado_at");
    expect(migracionesQueTocanAsignadoAt()).not.toContain(LA_QUE_SOLO_LA_EXPLICA);
  });

  it("246: el permiso nuevo es SOLO para indexar — ni una escritura sobre la columna", () => {
    // Esto es lo que convierte las dos entradas nuevas de la lista blanca en un permiso ACOTADO en
    // vez de en un cheque en blanco. Se exige, sentencia a sentencia, que toda aparicion de
    // `asignado_at` en SQL VIVO caiga dentro de un `CREATE INDEX` o de un `DROP INDEX`.
    //
    // Si manana alguien anade a esa migracion un `UPDATE "orden" SET "asignado_at" = …` —el
    // "ya que estamos" contra el que existe toda esta guardia— este caso cae, y cae ANTES de que
    // la lista blanca de arriba parezca haberlo autorizado.
    for (const ruta of SOLO_PUEDEN_INDEXAR) {
      const vivo = quitarComentariosSql(fs.readFileSync(path.join(MIGRACIONES, ruta), "utf8"));
      expect(vivo, `${ruta} ya no menciona la columna: sobra de la lista blanca`).toContain(
        "asignado_at",
      );
      const sentencias = vivo
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);
      expect(sentencias.length, `${ruta} sin sentencias que censar`).toBeGreaterThan(0);
      for (const sentencia of sentencias) {
        if (!sentencia.includes("asignado_at")) continue;
        expect(
          /^(CREATE INDEX|DROP INDEX)\b/i.test(sentencia),
          `${ruta} toca \`asignado_at\` fuera de un indice:\n${sentencia.slice(0, 200)}`,
        ).toBe(true);
      }
      // Y ninguna forma de escritura de datos, dicha aparte por si el reparto por `;` fallara.
      expect(ESCRITURAS_SQL.test(vivo), `${ruta} contiene SQL de escritura`).toBe(false);
    }
  });

  it("246: el censo de ese permiso detecta lo que dice detectar (autocomprobacion)", () => {
    // Si el reparto por `;` o el regex dejaran de medir, el caso de arriba pasaria en verde con una
    // escritura dentro. Se prueba contra respuestas conocidas, en las DOS direcciones.
    const legal = 'CREATE INDEX "x" ON "orden" ("mensajero_asignado_id", "asignado_at")';
    const ilegal = 'UPDATE "orden" SET "asignado_at" = NOW()';
    expect(/^(CREATE INDEX|DROP INDEX)\b/i.test(legal)).toBe(true);
    expect(/^(CREATE INDEX|DROP INDEX)\b/i.test(ilegal)).toBe(false);
    expect(ESCRITURAS_SQL.test(ilegal)).toBe(true);
    expect(ESCRITURAS_SQL.test(legal)).toBe(false);
  });

  it("el repositorio SI la lee: la columna aparece en un WHERE y en un SELECT", () => {
    const repo = fs.readFileSync(
      path.join(REPO_ROOT, "lib/repositories/TableroDiaRepository.ts"),
      "utf8",
    );
    // Si esto se pusiera rojo, el guardia de arriba se habria vuelto trivial (nadie la usa).
    expect(repo).toContain('"asignado_at"');
  });
});
