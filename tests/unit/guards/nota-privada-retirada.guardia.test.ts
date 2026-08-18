// GUARDIA DEL ARNÉS — LA NOTA PRIVADA DEL MENSAJERO (FEATURE 116) ESTÁ RETIRADA Y NO VUELVE.
//
// Cubre **R20** (ningún archivo ni símbolo de la 116 permanece en el árbol) y **R22** (ninguna
// migración ni módulo de la 227 LEE o INSERTA a partir de `orden_mensajero_meta.nota`).
//
// **Por qué existe y por qué no basta con que compile.** La 227 retira una funcionalidad entera y
// BORRA su columna con una migración destructiva (M2). Lo que el typecheck garantiza es que hoy no
// queda una referencia rota; lo que NO garantiza es lo de mañana: alguien que reintroduzca
// `notaPrivada` en el DTO, o que resucite `findNotasByMensajero`, escribirá código que compila
// perfectamente contra un modelo Prisma que ya no tiene la columna y fallará EN EJECUCIÓN, o peor,
// contra una base donde el `down.sql` la haya repuesto vacía y devuelva `null` para todo sin que
// nada proteste.
//
// **Y sobre todo, R22 no es una cuestión de higiene: es una promesa.** Las notas de la 116 se
// escribieron bajo un texto literal en pantalla —«Solo tú puedes ver esta nota; no la ven la tienda
// ni otros mensajeros»—. El hilo de la 227 es COMPARTIDO con la tienda. Cualquier lectura o copia
// de aquella columna hacia este hilo es una fuga retroactiva, y es precisamente la clase de atajo
// que alguien propondría de buena fe («no perdamos los datos»). El humano firmó la pérdida el
// 2026-08-14 (decisión P1). Esta guardia es quien sostiene esa firma cuando ya nadie recuerde la
// conversación.
//
// **Recorre el ÁRBOL DE ARCHIVOS, no el grafo de imports (deliberado).** Un símbolo reintroducido
// en un módulo que todavía no importa nadie no aparece en ningún grafo de alcanzabilidad, y es
// exactamente el estado intermedio de quien está a mitad de resucitar la funcionalidad. El árbol
// lo ve igual.
//
// **Mira el CÓDIGO EJECUTABLE, no la prosa.** Esta retirada dejó a propósito comentarios
// históricos que NOMBRAN los símbolos retirados («aquí vivía `notaPrivada?`, se retiró con la
// columna»): son la memoria de por qué el hueco está ahí, y prohibirlos obligaría a borrar la
// explicación junto con el código. Por eso el escáner quita comentarios antes de buscar. La
// contrapartida —un símbolo escondido dentro de un comentario no se detecta— es irrelevante: un
// símbolo comentado no se ejecuta.
//
// **El detector se auto-prueba (bloque 0).** Una guardia estática rota no falla: calla. Aquí se
// prueba el quitador de comentarios y el buscador contra respuestas conocidas en las DOS
// direcciones, se afirma el tamaño del árbol recorrido, y hay un control POSITIVO sobre el árbol
// real (`marcarLuego`, de la feature 115, SÍ tiene que encontrarse: si el escáner no lo ve, es que
// no está viendo nada).
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");

/** Los directorios de producción y de prueba donde la 116 pudo vivir. */
const RAICES = ["app", "components", "lib", "scripts", "tests", "db"];

const EXTENSIONES = new Set([".ts", ".tsx", ".sql", ".prisma", ".mjs", ".js", ".jsx"]);
const IGNORADOS = new Set(["node_modules", ".next", ".git", "dist", "coverage", "out"]);

/** Este mismo archivo: nombra los símbolos prohibidos por definición y no puede acusarse. */
const YO = path.relative(ROOT, __filename).split(path.sep).join("/");

// ===========================================================================================
// Escáner
// ===========================================================================================

function listarArchivos(dir: string, acumulado: string[] = []): string[] {
  if (!existsSync(dir)) return acumulado;
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORADOS.has(entrada.name)) continue;
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(completo, acumulado);
    else if (EXTENSIONES.has(path.extname(entrada.name))) acumulado.push(completo);
  }
  return acumulado;
}

/**
 * El texto EJECUTABLE: fuera los comentarios de bloque (`/* … *\/`), los de línea (`//`) y los
 * de SQL/Prisma (`--`). El `//` solo cuenta como comentario si no viene precedido de `:`, para
 * no destripar una URL (`https://…`) y quedarse con media línea de código.
 */
export function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linea) => {
      const sinSql = linea.replace(/--.*$/, "");
      return sinSql.replace(/(^|[^:])\/\/.*$/, "$1");
    })
    .join("\n");
}

/** Archivos del árbol con su contenido EJECUTABLE ya limpio. */
function arbol(): { ruta: string; codigo: string; crudo: string }[] {
  return RAICES.flatMap((raiz) => listarArchivos(path.join(ROOT, raiz)))
    .map((completo) => {
      const ruta = path.relative(ROOT, completo).split(path.sep).join("/");
      const crudo = readFileSync(completo, "utf8");
      return { ruta, codigo: sinComentarios(crudo), crudo };
    })
    .filter((a) => a.ruta !== YO);
}

const ARBOL = arbol();

/** Rutas donde aparece `patron` en el código ejecutable. */
function dondeAparece(patron: RegExp, archivos = ARBOL): string[] {
  return archivos.filter((a) => patron.test(a.codigo)).map((a) => a.ruta);
}

// ===========================================================================================
// 0 — El detector, probado contra respuestas conocidas
// ===========================================================================================

describe("0 — el detector de esta guardia no está roto", () => {
  it("el quitador de comentarios borra prosa y conserva código", () => {
    expect(sinComentarios("// aqui vivia notaPrivada\nconst a = 1;")).not.toMatch(/notaPrivada/);
    expect(sinComentarios("/* upsertNota */ const b = 2;")).not.toMatch(/upsertNota/);
    expect(sinComentarios("-- findNotasByMensajero\nALTER TABLE x;")).not.toMatch(
      /findNotasByMensajero/,
    );
    // Y NO se lleva por delante el código que sí importa:
    expect(sinComentarios("// nota\nrepo.upsertNota(a);")).toMatch(/upsertNota/);
    expect(sinComentarios('const u = "https://x/y"; // comentario')).toMatch(/https:\/\/x\/y/);
  });

  it("el buscador encuentra lo que está y no encuentra lo que no está", () => {
    const falso = [
      { ruta: "falso/a.ts", codigo: "export const notaPrivada = 1;", crudo: "" },
      { ruta: "falso/b.ts", codigo: "export const otraCosa = 2;", crudo: "" },
    ];
    expect(dondeAparece(/\bnotaPrivada\b/, falso)).toEqual(["falso/a.ts"]);
    expect(dondeAparece(/\bjamasEscritoEnEsteRepo\b/, falso)).toEqual([]);
  });

  it("recorre un árbol de tamaño creíble y ningún archivo leído sale vacío", () => {
    expect(ARBOL.length).toBeGreaterThan(500);
    expect(ARBOL.filter((a) => a.crudo.length === 0)).toEqual([]);
  });

  it("CONTROL POSITIVO: `marcarLuego` (feature 115, que SIGUE viva) sí se encuentra", () => {
    // Si esta aserción fallara, el escáner no estaría leyendo nada y todos los «no aparece»
    // de abajo serían verdes por vacío.
    expect(dondeAparece(/\bmarcarLuego\b/).length).toBeGreaterThan(5);
  });
});

// ===========================================================================================
// R20 — ni archivos ni símbolos de la 116
// ===========================================================================================

/** Inventario CERRADO de la 116 (design §4), archivo por archivo. */
const ARCHIVOS_DE_LA_116 = [
  "lib/services/NotaPrivadaMensajeroService.ts",
  "lib/actions/notas-privadas-mensajero.ts",
  "lib/types/nota-privada-mensajero.ts",
  "lib/interfaces/services/INotaPrivadaMensajeroService.ts",
  "app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero.tsx",
  "tests/components/NotaPrivadaMensajero.test.tsx",
  "tests/unit/services/nota-privada-mensajero-service.test.ts",
  "tests/unit/actions/notas-privadas-mensajero-action.test.ts",
  "tests/unit/services/mis-asignaciones-nota-privada.test.ts",
  "tests/integration/repositories/nota-privada-mensajero-repo.int.test.ts",
];

/**
 * Los símbolos que la 116 exportaba o pintaba. Cada uno con la razón de su prohibición, para
 * que quien vea la guardia roja sepa si está resucitando la feature o solo eligió mal un
 * nombre.
 */
const SIMBOLOS_DE_LA_116: { patron: RegExp; que: string }[] = [
  { patron: /\bNotaPrivadaMensajeroService\b/, que: "el service de la 116" },
  { patron: /\bINotaPrivadaMensajeroService\b/, que: "su interfaz" },
  { patron: /\bNotaPrivadaMensajero\b/, que: "su componente" },
  { patron: /\bguardarNotaPrivada\b/, que: "su Server Action de guardado" },
  { patron: /\blimpiarNotaPrivada\b/, que: "su Server Action de limpieza" },
  { patron: /\bguardarNotaSchema\b/, que: "su schema zod de guardado" },
  { patron: /\blimpiarNotaSchema\b/, que: "su schema zod de limpieza" },
  { patron: /\bGuardarNotaResult\b/, que: "su resultado de guardado" },
  { patron: /\bLimpiarNotaResult\b/, que: "su resultado de limpieza" },
  { patron: /\bnotaPrivada\b/, que: "el campo del DTO y las props de las cards (R21)" },
  { patron: /\bupsertNota\b/, que: "el método del meta-repo" },
  { patron: /\blimpiarNota\b/, que: "el método del meta-repo" },
  { patron: /\bfindNotasByMensajero\b/, que: "el método del meta-repo" },
];

/**
 * La ÚNICA excepción, y con nombre y apellido: el test que verifica R21 tiene que NOMBRAR el
 * campo para poder afirmar que NO está (`expect(Object.keys(dto)).not.toContain("notaPrivada")`).
 * Un test de ausencia no puede escribirse sin decir de qué ausencia habla.
 *
 * Es una lista cerrada y no una anotación libre a propósito: la anotación se copia y se propaga;
 * esta lista obliga a tocar la guardia —y a justificarlo en un diff— para añadir un caso. Y
 * CADUCA: si el archivo desaparece, la guardia exige podarla, para que no quede una excepción
 * viva sin motivo vivo.
 */
const EXCEPCIONES: Record<string, string> = {
  "tests/unit/services/mis-asignaciones-service.test.ts":
    "R21: el test «el DTO no emite el campo de nota privada» comprueba la AUSENCIA de la clave",
};

describe("227 / R20 — la nota privada del mensajero (feature 116) está retirada", () => {
  it("cada excepción de la lista sigue existiendo (una excepción sin motivo vivo se poda)", () => {
    for (const ruta of Object.keys(EXCEPCIONES)) {
      expect(existsSync(path.join(ROOT, ruta)), `sobra la excepcion de ${ruta}`).toBe(true);
    }
  });

  it("no queda ningun archivo ni simbolo de la nota privada del mensajero", () => {
    const archivosVivos = ARCHIVOS_DE_LA_116.filter((r) => existsSync(path.join(ROOT, r)));
    expect(archivosVivos, "estos archivos de la feature 116 volvieron al arbol").toEqual([]);

    const candidatos = ARBOL.filter((a) => EXCEPCIONES[a.ruta] === undefined);
    const reapariciones = SIMBOLOS_DE_LA_116.flatMap(({ patron, que }) =>
      dondeAparece(patron, candidatos).map((ruta) => `${ruta} — ${patron.source} (${que})`),
    );
    expect(
      reapariciones,
      "la feature 116 se retiró entera (R20/R21); si esto vuelve a hacer falta, es una ficha nueva, " +
        "no una reintroducción silenciosa",
    ).toEqual([]);
  });

  it("la columna `nota` tampoco está en el modelo Prisma de `orden_mensajero_meta`", () => {
    // El símbolo `nota` a secas es demasiado común para buscarlo en todo el árbol, pero en el
    // schema sí se puede afirmar con precisión: el modelo tiene que quedarse sin ese campo.
    const schema = readFileSync(path.join(ROOT, "db", "schema.prisma"), "utf8");
    const modelo = schema.slice(
      schema.indexOf("model OrdenMensajeroMeta {"),
      schema.indexOf("}", schema.indexOf("model OrdenMensajeroMeta {")),
    );
    expect(modelo.length).toBeGreaterThan(100); // el modelo existe y se encontró de verdad
    expect(sinComentarios(modelo)).not.toMatch(/^\s*nota\s/m);
    // Y lo que NO se toca (R24) sigue ahí:
    expect(modelo).toMatch(/marcarLuego/);
    expect(modelo).toMatch(/@@unique\(\[usuarioId, ordenId\]\)/);
  });
});

// ===========================================================================================
// R22 — la 227 no lee ni copia el contenido borrado
// ===========================================================================================

/** Migraciones de la feature 227, por el nombre de su carpeta. */
const MIGRACIONES_227 = readdirSync(path.join(ROOT, "db", "migrations"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => n.endsWith("_orden_nota") || n.endsWith("_orden_mensajero_meta_drop_nota"));

/** Módulos de la 227: los del hilo `orden_nota`, estén donde estén. */
const MODULOS_227 = ARBOL.filter(
  (a) =>
    /(^|\/)(orden-notas?|OrdenNota[A-Za-z]*|HiloNotasOrden|ventana-hilo-notas)\.(ts|tsx)$/.test(
      a.ruta,
    ) || /(^|\/)IOrdenNota[A-Za-z]*\.ts$/.test(a.ruta),
);

describe("227 / R22 — el contenido de las notas privadas no se lee, no se copia y no se migra", () => {
  it("ninguna migracion ni modulo de la 227 lee orden_mensajero_meta.nota", () => {
    expect(MIGRACIONES_227.length, "no se encontraron las migraciones de la 227").toBeGreaterThan(1);

    const hallazgos: string[] = [];

    for (const carpeta of MIGRACIONES_227) {
      const dir = path.join(ROOT, "db", "migrations", carpeta);
      for (const archivo of readdirSync(dir)) {
        const ruta = `db/migrations/${carpeta}/${archivo}`;
        const sql = sinComentarios(readFileSync(path.join(dir, archivo), "utf8"));
        for (const sentencia of sql
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)) {
          // Una migración de esta feature puede ALTERAR `orden_mensajero_meta` (M2 le quita la
          // columna); lo que NO puede es LEER de ella ni escribir a partir de ella. Se prohíbe
          // toda DML, que es la única forma de mover contenido de un sitio a otro.
          if (/^\s*(SELECT|INSERT|UPDATE|DELETE|COPY|MERGE)\b/i.test(sentencia)) {
            hallazgos.push(`${ruta} — sentencia DML: ${sentencia.slice(0, 80)}`);
          }
          // Y ninguna sentencia puede nombrar a la vez la tabla vieja y la nueva: ese cruce
          // es, literalmente, la copia que R22 prohíbe.
          if (/orden_mensajero_meta/i.test(sentencia) && /orden_nota/i.test(sentencia)) {
            hallazgos.push(`${ruta} — cruza la tabla vieja con el hilo: ${sentencia.slice(0, 80)}`);
          }
        }
      }
    }

    for (const modulo of MODULOS_227) {
      // Los módulos del hilo no tienen nada que hacer contra la tabla de la meta privada: su
      // repositorio es `orden_nota` y punto.
      if (/orden_mensajero_meta|ordenMensajeroMeta/i.test(modulo.codigo)) {
        hallazgos.push(`${modulo.ruta} — toca \`orden_mensajero_meta\``);
      }
    }

    expect(
      hallazgos,
      "las notas privadas de la 116 se escribieron bajo una promesa literal de privacidad: " +
        "copiarlas al hilo compartido sería una fuga retroactiva (decisión humana P1, 2026-08-14)",
    ).toEqual([]);
  });

  it("la migración destructiva (M2) es SOLO un DROP COLUMN, sin lectura previa del dato", () => {
    const carpeta = MIGRACIONES_227.find((n) => n.endsWith("_orden_mensajero_meta_drop_nota"));
    expect(carpeta, "falta la migración M2").toBeDefined();
    const up = sinComentarios(
      readFileSync(path.join(ROOT, "db", "migrations", carpeta!, "migration.sql"), "utf8"),
    );
    const sentencias = up
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    // Una sola sentencia: no hay hueco donde meter un `CREATE TABLE respaldo_notas AS SELECT …`,
    // que es la forma amable de incumplir R22.
    expect(sentencias).toHaveLength(1);
    expect(sentencias[0]).toMatch(/^ALTER TABLE .* DROP COLUMN "nota"$/);
  });
});
