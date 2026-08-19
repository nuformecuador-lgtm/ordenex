import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { quitarComentarios, quitarComentariosSql } from "@/tests/fixtures/sin-comentarios";

// GUARDIA DE LA FEATURE 235 (T6.1, R40) — `orden.ayuda` NO VUELVE.
//
// QUE ERA. Un `boolean NOT NULL DEFAULT false` vivo del 2026-08-18 al 2026-08-19, que marcaba que
// un mensajero habia pedido ayuda a la tienda sobre una orden. Con ella la orden NUNCA salia de
// `en_reparto`, asi que seguia siendo parada del optimizador y del mapa, seguia siendo gestionable,
// el corte a «seccion aparte» era SOLO DE CLIENTE y el bloqueo del cierre funcionaba POR ACCIDENTE
// (`progress/auditoria_ayuda_tienda.md` §2/§4).
//
// POR QUE UNA GUARDIA Y NO SOLO EL `DROP COLUMN`. Porque el problema de esa columna no era el dato,
// era su CLASE: una marca persistida tiene tantos sitios de limpieza como transiciones tenga el
// estado que acompaña, y NINGUNO de ellos rompe el build cuando se olvida. Esa columna ya produjo
// dos fallos medidos: la FUGA PERMANENTE de `/novedades` (el corte nocturno barria la orden a
// `sin_gestionar` sin apagar el flag y la fila se quedaba ahi para siempre, auditoria §2.1) y una
// SEGUNDA PUERTA en la ventana de escritura del hilo que la 239 midio abriendose sobre el
// pre-estado de una devolucion. Cualquiera puede reintroducir «un booleano pequeño» con la mejor
// intencion. R40 lo prohibe: ninguna decision del sistema —visibilidad, ventana de escritura,
// bloqueo, listado, ruta, KPI— puede depender de esa marca.
//
// LO QUE **NO** VIGILA, y es deliberado: `orden.intentos_contacto`. Es historial ACUMULATIVO de la
// tienda, sobrevive a que la solicitud se retire y su propio contrato dice que NO debe atarse al
// flag. Sale de esta feature intacto, y por eso el patron lleva frontera de palabra.
//
// COMO CENSA, y por que asi (calcado de `gestion-aprobada-retirada.guardia.test.ts`):
//
//  1. **En un ARCHIVO, nunca por `node -e`.** Ahi el shell se come una capa de escapado y un `\b`
//     llega como backspace: el censo miente EN VERDE. Es un fallo ya vivido en este repo.
//  2. **Sobre el fuente SIN COMENTARIOS** (`quitarComentarios`, el quitador unico de la 209). Los
//     comentarios de este arbol NOMBRAN la columna a proposito para explicar por que se retiro;
//     censar prosa como si fuera codigo obligaria a borrar la explicacion para pasar la guardia,
//     que es exactamente al reves de lo que se quiere.
//  3. **Con frontera de palabra**, para que `ayuda_tienda` (el ESTATUS que la sustituye),
//     `solicitarAyudaOrden`, `RecuperarAyudaButton` o `intentos_contacto` no disparen falsos
//     positivos — y para que `orden.ayuda` de verdad si lo haga.
//
// QUE QUEDA FUERA DEL CENSO, y por que cada cosa:
//  - `db/migrations/`: son FOTOS HISTORICAS. La migracion que creo la columna y la que la retira
//    tienen que nombrarla; reescribirlas seria falsificar el historial de la base.
//  - `progress/` y `specs/`: bitacoras y contratos escritos en su momento.
//  - este mismo archivo: contiene los patrones de busqueda. Una allowlist sin justificacion es un
//    agujero; esta la lleva.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "components", "hooks", "scripts", "tests", "e2e", "db"];
const SCAN_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".prisma"]);

/** Rutas (relativas al repo, con `/`) exentas del censo, cada una con su motivo. */
const EXENTOS: ReadonlyArray<{ prefijo: string; motivo: string }> = [
  {
    prefijo: "db/migrations/",
    motivo: "fotos historicas: la migracion que creo la columna y la que la retira la nombran",
  },
  {
    prefijo: "tests/unit/guards/ayuda-columna-retirada.guardia.test.ts",
    motivo: "este archivo: contiene los patrones de busqueda",
  },
  {
    prefijo: "tests/integration/db/ayuda-tienda-migration.test.ts",
    motivo:
      "test hermano: afirma el TEXTO de las migraciones de esta feature, incluida la sentencia del " +
      "down que repone la columna (`ADD COLUMN ... \"ayuda\" boolean ...`). Sin esta exencion, la " +
      "unica forma de pasar la guardia seria dejar de comprobar que el down existe y es correcto",
  },
  {
    prefijo: "tests/unit/guards/gestion-aprobada-retirada.guardia.test.ts",
    motivo:
      "guardia hermana: su AUTOCOMPROBACION lleva un fuente sintetico con `data: { ayuda: false }` " +
      "para demostrar que NO ladra ante la prosa que explica el retiro de la otra columna",
  },
];

/**
 * Los patrones, ESTRECHOS A PROPOSITO y medidos contra el arbol real.
 *
 * `ayuda` es una palabra que aparece por todas partes en este repo —`solicitarAyudaOrden`,
 * «Solicitar ayuda», `ayuda_tienda`, `RecuperarAyudaButton`, `transicionarAyuda`, y hasta una clave
 * `ayuda:` de un mapa de textos de liquidacion que no tiene NADA que ver con esto—. Un `\bayuda\b`
 * a secas daria una guardia que ladra siempre, y una guardia que ladra siempre se acaba
 * desactivando. Asi que se persiguen las formas de USO DE LA COLUMNA, que son estas tres y no mas:
 *
 *   1. la ESCRITURA/PROYECCION Prisma: `ayuda: true` / `ayuda: false` / `ayuda: row.ayuda`;
 *   2. la LECTURA de una fila o DTO, acotada a los receptores que existen en este arbol;
 *   3. la DECLARACION del campo, en Prisma (`@map("ayuda")`) o en SQL (`"ayuda" boolean`).
 *
 * La autocomprobacion de abajo prueba las tres contra el texto EXACTO que tenia el arbol cuando la
 * columna existia, y prueba tambien los falsos positivos que importan.
 */
const PATRONES: ReadonlyArray<{ re: RegExp; que: string }> = [
  {
    re: /(?<![\w$.\-"'`])ayuda\s*:\s*(true|false|row\.|orden\.|o\.|fila\.)/,
    que: "escritura o proyeccion Prisma de la columna (`ayuda: true` / `ayuda: row.ayuda`)",
  },
  {
    re: /\b(orden|row|o|fila|novedad|asignacion|acceso\.orden)\.ayuda\b(?!_)/,
    que: "lectura `.ayuda` de una fila, una orden o un DTO",
  },
  {
    re: /@map\("ayuda"\)|"ayuda"\s+boolean/i,
    que: "declaracion del campo en el schema de Prisma o en SQL",
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...walk(full));
    } else if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function relativo(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function estaExento(rel: string): boolean {
  return EXENTOS.some((e) => rel.startsWith(e.prefijo));
}

/** `true` si el CODIGO (sin comentarios) usa la columna en alguna de sus formas. */
function detecta(fuente: string): boolean {
  const codigo = quitarComentarios(fuente);
  return PATRONES.some(({ re }) => re.test(codigo));
}

/** Ficheros del arbol (fuera de las exenciones) cuyo CODIGO menciona la columna. */
function censar(): string[] {
  const encontrados: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(REPO_ROOT, dir))) {
      const rel = relativo(file);
      if (estaExento(rel)) continue;
      if (detecta(fs.readFileSync(file, "utf8"))) encontrados.push(rel);
    }
  }
  return encontrados.sort();
}

describe("235/R40 — `orden.ayuda` esta RETIRADA del arbol", () => {
  it("ningun modulo de codigo la usa (censo sobre fuente sin comentarios)", () => {
    expect(
      censar(),
      "ninguna decision del sistema —visibilidad, ventana de escritura, bloqueo, listado, ruta o " +
        "KPI— puede depender de una marca persistida de ayuda (R40). Lo que dice si hay una " +
        "solicitud viva es el ESTADO de la orden (`ayuda_tienda`). Si hace falta una marca nueva, " +
        "es una decision de producto: pasa por la puerta, no por un booleano.",
    ).toEqual([]);
  });

  it("el schema de Prisma no declara la columna", () => {
    const schema = fs.readFileSync(path.join(REPO_ROOT, "db", "schema.prisma"), "utf8");
    const sinComentarios = quitarComentarios(schema);
    expect(sinComentarios).not.toMatch(/^\s*ayuda\s+Boolean/m);
    // Y lo que SI sigue estando, para que el caso no pase por haber mirado el archivo equivocado:
    expect(sinComentarios).toMatch(/intentosContacto\s+Int/);
  });

  it("la migracion que la retira existe y lleva su down (R42)", () => {
    const dir = fs
      .readdirSync(path.join(REPO_ROOT, "db", "migrations"), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .find((n) => n.endsWith("_orden_retiro_ayuda"));
    expect(dir, "falta la migracion `<ts>_orden_retiro_ayuda`").toBeDefined();
    const base = path.join(REPO_ROOT, "db", "migrations", dir as string);
    const up = fs.readFileSync(path.join(base, "migration.sql"), "utf8");
    const down = fs.readFileSync(path.join(base, "down.sql"), "utf8");
    expect(up).toMatch(/ALTER TABLE "orden" DROP COLUMN "ayuda";/);
    // El down la repone con el MISMO tipo, nulabilidad y default con el que el codigo anterior la
    // leia (R42): una base que ese codigo puede leer sin romperse.
    expect(down).toMatch(
      /ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "ayuda" boolean NOT NULL DEFAULT false;/,
    );
    // R41: ni el up ni el down mueven ordenes de estado desde SQL. Se mira el SQL SIN COMENTARIOS:
    // los dos explican por que NO hacen ese `UPDATE`, y censar la explicacion obligaria a borrarla.
    for (const sql of [up, down]) {
      const sentencias = quitarComentariosSql(sql);
      expect(sentencias).not.toMatch(/UPDATE\s+"orden"/i);
      expect(sentencias).not.toMatch(/SET\s+"?estatus_id"?/i);
    }
  });

  it("`orden.intentos_contacto` NO se retira: es historial de la tienda, no estado de la solicitud", () => {
    // La otra mitad de la decision, afirmada para que nadie la arrastre «por limpieza». Su propio
    // contrato dice que sobrevive a que la solicitud se retire.
    const schema = fs.readFileSync(path.join(REPO_ROOT, "db", "schema.prisma"), "utf8");
    expect(quitarComentarios(schema)).toMatch(/intentos_contacto/);
  });
});

describe("235/R40 — AUTOCOMPROBACION: la guardia se sabe poner roja", () => {
  // Sin esto, un regex mal escrito o una allowlist demasiado ancha dejarian esta guardia en verde
  // para siempre. Este repo ya tuvo un arnes de mutaciones que reporto 9/9 supervivientes DOS VECES
  // sin haber ejecutado un test: una guardia que no se sabe romper no protege nada.
  //
  // Se prueba la MISMA funcion de deteccion que usa el censo, sobre el texto EXACTO que tendria el
  // arbol si alguien reintrodujera la columna — en cada uno de los sitios donde estuvo.

  it("detecta la columna reintroducida en `schema.prisma`", () => {
    expect(detecta('  ayuda                  Boolean   @default(false) @map("ayuda")')).toBe(true);
  });

  it("detecta el encendedor reintroducido en el repositorio", () => {
    const comoEnMarcarAyuda = `
      await this.prisma.orden.update({
        where: { id: ordenId },
        data: { ayuda: true },
      });`;
    expect(detecta(comoEnMarcarAyuda)).toBe(true);
  });

  it("detecta la rama reintroducida en el predicado de novedades", () => {
    expect(detecta('{ ayuda: true, estatus: { value: ESTATUS_EN_REPARTO } },')).toBe(true);
  });

  it("detecta el `select` reintroducido y la lectura de la fila", () => {
    expect(detecta("        ayuda: true,")).toBe(true);
    expect(detecta("      ayuda: row.ayuda,")).toBe(true);
    expect(detecta("  const partida = orden.ayuda ? con : sin;")).toBe(true);
  });

  it("detecta el tercer parametro reintroducido en la ventana del hilo", () => {
    expect(detecta("estaEnVentanaDeEscritura(acceso.rol, acceso.orden.estatusValue, acceso.orden.ayuda)")).toBe(
      true,
    );
  });

  // --- Los falsos positivos que importan: si la guardia ladrara ante estos, la unica forma de
  // pasarla seria borrar la feature que la sustituye o la explicacion de por que se retiro.

  it("NO ladra ante el ESTATUS que la sustituye (`ayuda_tienda`)", () => {
    expect(detecta('{ estatus: { value: "ayuda_tienda" } },')).toBe(false);
    expect(detecta('const ESTATUS_AYUDA = "ayuda_tienda";')).toBe(false);
    expect(detecta('  ayuda_tienda: "Ayuda solicitada a la tienda",')).toBe(false);
    expect(detecta('origenTipo: "solicitud_ayuda_tienda",')).toBe(false);
  });

  it("NO ladra ante el contador de intentos de contacto, que NO se retira", () => {
    expect(detecta("data: { intentosContacto: { increment: 1 } },")).toBe(false);
    expect(detecta('intentos_contacto')).toBe(false);
  });

  it("NO ladra ante los nombres de la feature (acciones, botones, textos)", () => {
    expect(detecta("import { solicitarAyudaOrden } from \"@/lib/actions/orden-ayuda\";")).toBe(false);
    expect(detecta("<RecuperarAyudaButton ordenId={orden.id} />")).toBe(false);
    expect(detecta("const AYUDA_SECCION_TITULO = \"Con ayuda solicitada\";")).toBe(false);
    expect(detecta("async transicionarAyuda(input: TransicionAyudaInput): Promise<boolean> {")).toBe(
      false,
    );
  });

  it("NO ladra ante la EXPLICACION de por que se retiro (comentarios)", () => {
    // Es el falso positivo que mas importa: si ladrara, la unica forma de pasar la guardia seria
    // borrar el motivo — y el motivo es lo que impide que alguien la reintroduzca manana.
    const soloProsa = `
      // Feature 235 (T6.1): aqui se leia \`ayuda\`. La columna se retiro porque una marca
      // persistida y un estado pueden divergir: \`data: { ayuda: false }\` habia que recordarlo
      // en cada salida del estado, y nadie lo recordaba.
      estatus: { select: { value: true } },`;
    expect(detecta(soloProsa)).toBe(false);
  });

  it("el censo mira de verdad: recorre un arbol grande", () => {
    // ANTI-VACUIDAD. Un censo que no recorre nada devuelve [] y pasa en verde para siempre; ya
    // paso en este repo.
    const totales = SCAN_DIRS.flatMap((d) => walk(path.join(REPO_ROOT, d)));
    expect(totales.length).toBeGreaterThan(500);
  });
});
