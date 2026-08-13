import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Feature 123 / T7 — los dos guards de la feature. Cubren R29 y R44.
// Feature 124 / T5.2 y T5.3 (D6-E1) — los dos se RE-ALCANZAN, no se retiran ni se aflojan.
//
// T7.1 FRONTERA (R44 de la 123 -> R42 de la 124): la 123 afirmaba que NADIE nombra la tabla.
// La 124 es, por definicion, el primer archivo que la nombra: ese guardia se ponia rojo el
// primer dia POR HACER SU TRABAJO. En vez de retirarlo, se ENDURECE:
//
//   antes                                   despues
//   ------------------------------------    -------------------------------------------------
//   nadie nombra la tabla (salvo el         solo los MODULOS DECLARADOS del escritor la
//   catalogo de la 135)                     nombran, mas las dos excepciones del catalogo
//   ningun acceso de ninguna clase          UN SOLO archivo puede ACCEDER: el repositorio
//   —                                       ninguna LECTURA en todo el arbol salvo dentro del
//                                           metodo `sumarMedidasEscritasDeFecha`
//   —                                       ningun SEGUNDO ESCRITOR: escribir fuera del
//                                           repositorio es rojo, y dentro solo en
//                                           `escribirFecha` / `retirarFilasRancias`
//
// Asi el tripwire sigue armado para la 126, que es a quien de verdad iba dirigido.
//
// T7.2 TRIPWIRE DE SUMA (R29 de la 123 -> R43 de la 124): `ordenes_estado_stock` es un STOCK al
// corte y sumarla entre fechas cuenta la misma orden una vez por dia que estuvo viva — un
// numero plausible que nadie detecta. Sigue vigente sobre la columna ENTERA, tambien para los
// tres estatus terminales, pese a que bajo D2-B2 esos se comporten de hecho como un flujo del
// dia: esa coincidencia NO se explota.
// El analizador se afina en la 124 (T5.3) porque el escritor legitimo caia en el sin cometer
// ninguna infraccion (nombra `ordenesEstadoStock`, usa `groupBy` sobre `orden` y tiene
// `desde`/`hasta` en la misma ventana de texto). Ahora se exige que la columna este DENTRO de
// la expresion agregada. Para que no sea una asercion vacia, el propio archivo comprueba que
// DISCRIMINA con cadenas sinteticas: si el analizador dejara de detectar la agregacion sobre un
// rango, este archivo se pone rojo aunque el repo siga limpio.

const ROOT = path.join(__dirname, "..", "..", "..");

/** Directorios de CODIGO que se rastrean. `db/`, `specs/`, `tests/` y `progress/` no. */
const DIRS_CODIGO = ["app", "lib", "scripts", "components", "hooks", "providers", "e2e"];

/** Solo `lib/` y `app/` para el tripwire de suma (R29 lo dice literalmente). */
const DIRS_TRIPWIRE = ["lib", "app"];

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
const ARCHIVOS_TRIPWIRE = DIRS_TRIPWIRE.flatMap(recorrer).map(posix);

function leer(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Quita comentarios (`/* *\/` y `//`) antes de buscar el nombre de la tabla.
 *
 * POR QUE, y por que NO un allowlist (§9 de `progress/impl_124.md`): al mergear la feature
 * 122 entro `lib/analytics/alcance-columnas.ts`, que NOMBRA `analytics_daily` en el docblock
 * de `whereRollup` —prosa que explica a que tabla apunta el fragmento de `where`— y no la
 * consulta por ningun lado. Meterlo en `ARCHIVOS_QUE_PUEDEN_NOMBRARLA` seria comprar el
 * verde a cambio de un permiso PERMANENTE: el dia que alguien anada una consulta de verdad a
 * ese archivo, el guardia ya no diria nada. Despiojar el texto ataca la causa —una mencion en
 * prosa no es una referencia a la tabla— y deja el allowlist restringido al escritor real.
 *
 * La logica es la misma que la de `soloCodigo` en
 * `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` (guardia de la 122). Se REPLICA
 * en vez de extraerse a un modulo compartido para no tocar un archivo de una feature ya
 * mergeada: son cuatro lineas y cada guardia queda legible de arriba abajo. El caso «el
 * despiojado DISCRIMINA» de mas abajo impide que esta funcion se convierta en un borrador
 * silencioso de codigo real.
 */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

/**
 * El contenido del archivo SIN comentarios. Es lo que leen los CUATRO casos del bloque R42
 * (nombrado, acceso, lectura y segundo escritor), no solo el del nombrado.
 *
 * La decision de aplicarlo a los cuatro es deliberada: el criterio «un comentario no es una
 * consulta» vale igual para `prisma.analyticsDaily.findMany` citado dentro de un docblock de
 * ejemplo que para el nombre pelado de la tabla. Si el nombrado se despiojara y el acceso no,
 * el mismo archivo de la 122 volveria a salir rojo en cuanto alguien pegara un ejemplo de
 * consulta en su prosa, y la reaccion seria —otra vez— allowlistearlo. Como efecto lateral,
 * `cuerpoDeMetodo` se vuelve MAS fiable: una llave suelta dentro de un comentario ya no puede
 * descuadrar el conteo de llaves del cuerpo.
 *
 * MEMOIZADO, y los casos de abajo ademas PREFILTRAN sobre el texto crudo: despiojar los ~1200
 * archivos del arbol cinco veces cuesta decenas de segundos (el `/\*[\s\S]*?\*\/` lazy recorre
 * hasta el final del archivo cada vez que ve un `/\*` sin cierre). El prefiltro es exacto, no
 * una heuristica: quitar texto solo puede ELIMINAR coincidencias, nunca crearlas, asi que un
 * archivo que no casa en crudo tampoco casa despiojado y no hace falta ni despiojarlo.
 */
const CODIGO_CACHE = new Map<string, string>();
function leerCodigo(rel: string): string {
  const cacheado = CODIGO_CACHE.get(rel);
  if (cacheado !== undefined) return cacheado;
  const codigo = soloCodigo(leer(rel));
  CODIGO_CACHE.set(rel, codigo);
  return quitarComentarios(codigo);
}

/* -------------------------------------------------------------------------- */
/* T7.1 — frontera (R44)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Las dos excepciones DECLARATIVAS heredadas del catalogo de la 135:
 * - `lib/analytics/types.ts`: el literal es el tipo `TablaRollup` del contrato de la 135.
 * - `lib/analytics/metrics.ts`: el catalogo de la 135 DECLARA la fuente de sus 14 metricas
 *   snapshot (`fuente: { tipo: "rollup", tablas: ["analytics_daily"] }`). Es una
 *   declaracion, no un acceso: el caso de abajo comprueba que TODA ocurrencia en ese
 *   archivo esta dentro de un `tablas: [...]` y que no hay ni una consulta.
 *
 * SIGUEN SIENDO DOS, Y NO TRES — resolucion del conflicto con el chore `65152f90` de `dev`
 * (2026-08-02). Ese chore ataco esta MISMA colision dando de alta un tercer archivo,
 * `lib/analytics/alcance-columnas.ts`, cuya unica mencion vive en el docblock de
 * `whereRollup`. El diagnostico de aquel commit es correcto en todo salvo en el remedio: si
 * la mencion es prosa, lo que sobra no es el archivo sino los COMENTARIOS, y por eso aqui se
 * despiojan antes de buscar (ver `soloCodigo` arriba). La diferencia no es de estilo: el alta
 * concede un permiso PERMANENTE sobre el archivo —el dia que alguien le anada una consulta de
 * verdad, este caso ya no dira nada—, mientras que despiojar solo perdona lo que de veras es
 * prosa y deja el allowlist restringido al escritor real. La contrapartida que aquel chore
 * escribio NO se pierde: se conserva integra mas abajo, como caso independiente del
 * allowlist, y ahora es mas fuerte porque no esta sosteniendo ninguna excepcion.
 */
const EXCEPCIONES_CATALOGO = ["lib/analytics/types.ts", "lib/analytics/metrics.ts"];

/**
 * Los modulos DECLARADOS del escritor de la 124 (`design.md §2`). Es un ALLOWLIST de rutas
 * EXACTAS, y todas tienen que EXISTIR: ver el caso «toda ruta del allowlist existe».
 *
 * Por que la existencia es parte del contrato y no un detalle: un allowlist que enumera rutas
 * inexistentes es un comodin silencioso. El dia en que alguien renombre
 * `AnaliticaRollupRepository.ts` o mueva el handler de carpeta, la entrada vieja se queda ahi
 * cubriendo una ruta que ya no existe, y la nueva —al no estar en la lista— tendria que salir
 * roja... salvo que alguien la anada «para arreglar el rojo» y deje la muerta. Al cabo de dos
 * features la lista describe un arbol imaginario y ya no restringe nada. Exigir que las diez
 * rutas existan obliga a que cada movimiento de archivo pase por aqui.
 *
 * Que este en esta lista NO da derecho a acceder a la tabla: solo el repositorio puede
 * (ver `REPOSITORIO_ESCRITOR`). Un handler que nombre la tabla en un comentario es legal; un
 * handler que la consulte, no.
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

/**
 * Feature 126 (T3.3, R27) — EL LECTOR DECLARADO. Se abre la prohibicion para UN archivo y
 * SOLO para leer; escribir sigue siendo rojo (R2 de la 126) y leer desde cualquier otro
 * archivo del arbol —el servicio, la Server Action, un componente— tambien.
 *
 * POR QUE UNA ENTRADA NOMINAL Y NO UN DIRECTORIO: la prohibicion de R42 «es tuya de levantar,
 * con su mutacion, no de aflojar de paso» (`design.md > D11` de la 126). Ampliar a
 * `lib/repositories/` amnistiaria a cualquier repositorio futuro, y la 128 (cache) y la 134
 * (CSV) van a querer leer el rollup: que tengan que pasar por aqui es el punto.
 */
const LECTOR_126 = "lib/repositories/AnaliticaOperativaRollupRepository.ts";

/**
 * Los DOS unicos metodos del lector de la 126 donde puede vivir una lectura, por NOMBRE. Son
 * los dos de `IAnaliticaOperativaRollupRepository`: si manana ese archivo gana un tercer
 * metodo que consulte la tabla, este guardia lo ve.
 */
const METODOS_LECTURA_126 = ["agregarCubos", "etiquetasDeEstatus"];

const ARCHIVOS_QUE_PUEDEN_NOMBRARLA = [...MODULOS_ESCRITOR, ...EXCEPCIONES_CATALOGO, LECTOR_126];

/** El UNICO archivo del arbol autorizado a ACCEDER a la tabla. */
const REPOSITORIO_ESCRITOR = "lib/repositories/AnaliticaRollupRepository.ts";

/**
 * Los DOS unicos metodos del repositorio donde puede vivir una ESCRITURA (R29/R30):
 * `escribirFecha` (upsert de los cubos de la fecha) y `retirarFilasRancias` (el barrido que
 * hace que el recomputo deje la fecha como si se hubiera calculado desde cero).
 */
const METODOS_ESCRITURA = ["escribirFecha", "retirarFilasRancias"];

/**
 * El UNICO metodo del arbol donde puede vivir una LECTURA del rollup: la reconciliacion de R34
 * (D5), que suma las filas recien escritas de la fecha dentro de la misma transaccion. Cualquier
 * otra lectura pertenece a la 122/126/128 y aqui es rojo (R3).
 */
const METODO_LECTURA = "sumarMedidasEscritasDeFecha";

/** Nombrar la tabla, por su nombre SQL o por el del modelo Prisma. Sin `g`: se reutiliza. */
const NOMBRA_LA_TABLA = /analytics_daily|analyticsDaily/;

/**
 * Version INSENSIBLE A MAYUSCULAS, solo para el prefiltro de los tres casos de acceso. Tiene
 * que ser un superconjunto de todo lo que casan `ACCESOS`/`LECTURAS`/`ESCRITURAS` —que llevan
 * `/i` en sus patrones SQL— o el prefiltro se comeria un `FROM "ANALYTICS_DAILY"` a gritos.
 */
const MENCIONA_LA_TABLA = /analytics_daily|analyticsdaily/i;

/** Cualquier forma de ACCEDER a la tabla, sea leyendo o escribiendo. */
const ACCESOS = [
  /prisma\s*\.\s*analyticsDaily/,
  /db\s*\.\s*analyticsDaily/,
  /\banalyticsDaily\s*\.\s*(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|aggregate|groupBy|count)\b/,
  /\bFROM\s+"?analytics_daily"?/i,
  /\bINTO\s+"?analytics_daily"?/i,
  /\bUPDATE\s+"?analytics_daily"?/i,
  /\bJOIN\s+"?analytics_daily"?/i,
];

/** LECTURAS del rollup. Prohibidas en todo el arbol salvo dentro de `METODO_LECTURA`. */
const LECTURAS = [
  /\banalyticsDaily\s*\.\s*(findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|aggregate|groupBy|count)\b/,
  /\bSELECT\b[\s\S]{0,2000}?\bFROM\s+"?analytics_daily"?/i,
];

/** ESCRITURAS del rollup. Prohibidas fuera de `METODOS_ESCRITURA` del repositorio. */
const ESCRITURAS = [
  /\banalyticsDaily\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\b/,
  /\bINSERT\s+INTO\s+"?analytics_daily"?/i,
  /\bUPDATE\s+"?analytics_daily"?/i,
  /\bDELETE\s+FROM\s+"?analytics_daily"?/i,
];

/** Indice de la llave que cierra la que abre en `abre`, o -1 si no cierra. */
function cierraLlave(texto: string, abre: number): number {
  for (let j = abre, prof = 0; j < texto.length; j++) {
    if (texto[j] === "{") prof++;
    else if (texto[j] === "}" && --prof === 0) return j;
  }
  return -1;
}

/**
 * Cuerpo (incluidas las llaves) del metodo `nombre`, o `null` si no aparece con cuerpo.
 *
 * Localizar el metodo POR NOMBRE y comprobar que la lectura cae DENTRO de su cuerpo —y no
 * meramente en el mismo archivo— es lo que impide que el repositorio se convierta en un saco
 * donde cabe cualquier consulta con solo tener el metodo correcto en alguna parte.
 *
 * EL TIPO DE RETORNO ES LA PARTE DIFICIL, y la primera version la fallaba en silencio. En
 * `): Promise<{ entregas: number }> {` la primera `{` del texto pertenece al TIPO, no al cuerpo,
 * y detras de su `}` no viene otra `{` sino un `>`: la heuristica de «si detras hay otra llave,
 * la anterior era el tipo» devolvia `{ entregas: number }` como cuerpo del metodo. Con eso, una
 * consulta escrita en el cuerpo real quedaba clasificada como FUERA del metodo permitido — o, lo
 * que es peor en la otra direccion, el guardia dejaba de ver el cuerpo entero.
 *
 * Se resuelve contando ANGULOS: el cuerpo es la primera `{` a profundidad de `<>` igual a cero.
 * Las `{` que aparecen a profundidad mayor que cero son tipos objeto inline y se saltan enteras.
 * `=>` se consume como una unidad para que la flecha de un tipo funcion no cierre un angulo.
 *
 * Si la primera aparicion del nombre es una FIRMA sin cuerpo (una interfaz declarada en el mismo
 * archivo, que termina en `;`), se sigue buscando la siguiente aparicion en vez de rendirse: el
 * repositorio y su interfaz pueden convivir y el que importa es el que tiene cuerpo.
 */
function cuerpoDeMetodo(contenido: string, nombre: string): string | null {
  const declaraciones = new RegExp(
    `(?:^|[^\\w$.])${nombre}\\s*(?:<[^>\\n]*>)?\\s*\\(`,
    "gm",
  );
  for (const decl of contenido.matchAll(declaraciones)) {
    // Fin de la lista de parametros.
    let i = contenido.indexOf("(", decl.index);
    for (let prof = 0; i < contenido.length; i++) {
      if (contenido[i] === "(") prof++;
      else if (contenido[i] === ")" && --prof === 0) {
        i++;
        break;
      }
    }

    let angulos = 0;
    for (; i < contenido.length; i++) {
      const c = contenido[i];
      if (c === "=" && contenido[i + 1] === ">") {
        i++; // `=>` de un tipo funcion: no es un cierre de angulo
      } else if (c === "<") {
        angulos++;
      } else if (c === ">") {
        if (angulos > 0) angulos--;
      } else if (c === "{") {
        const fin = cierraLlave(contenido, i);
        if (fin === -1) break;
        if (angulos > 0) {
          i = fin; // tipo objeto inline dentro de un generico: se salta entero
          continue;
        }
        return contenido.slice(i, fin + 1);
      } else if (c === ";") {
        break; // firma sin cuerpo: probar con la siguiente aparicion del nombre
      }
    }
  }
  return null;
}

const existe = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("R42 — frontera re-alcanzada: solo el escritor declarado escribe, y nadie lee todavia", () => {
  it("el rastreo encuentra archivos (si no, el guard seria vacio)", () => {
    expect(ARCHIVOS_CODIGO.length).toBeGreaterThan(100);
    // Las dos excepciones del catalogo SI tienen que existir: son de la 135, ya mergeada.
    for (const permitido of EXCEPCIONES_CATALOGO) {
      expect(ARCHIVOS_CODIGO).toContain(permitido);
    }
  });

  it("solo los modulos declarados del escritor y el catalogo de la 135 nombran la tabla", () => {
    const infractores = ARCHIVOS_CODIGO.filter(
      (rel) =>
        !ARCHIVOS_QUE_PUEDEN_NOMBRARLA.includes(rel) &&
        NOMBRA_LA_TABLA.test(leer(rel)) && // prefiltro barato sobre el crudo
        NOMBRA_LA_TABLA.test(leerCodigo(rel)), // y la mencion no es solo un comentario
    );
    expect(
      infractores,
      "solo el escritor declarado de la 124 puede nombrar `analytics_daily` EN CODIGO (los " +
        "comentarios se despiojan antes de buscar): el backfill es la 125 y las consultas la " +
        "126/122/128. Estos archivos no estan en la lista y la nombran: " +
        infractores.join(", "),
    ).toEqual([]);
  });

  it("un SOLO archivo puede ACCEDER a la tabla: el repositorio del escritor", () => {
    const accesos: string[] = [];
    for (const rel of ARCHIVOS_CODIGO) {
      if (rel === REPOSITORIO_ESCRITOR || rel === LECTOR_126) continue;
      if (!MENCIONA_LA_TABLA.test(leer(rel))) continue; // todo ACCESO nombra la tabla
      const contenido = leerCodigo(rel);
      for (const patron of ACCESOS) {
        if (patron.test(contenido)) accesos.push(`${rel} :: ${patron}`);
      }
    }
    expect(
      accesos,
      `la unica puerta a \`analytics_daily\` es ${REPOSITORIO_ESCRITOR} (docs/architecture.md: ` +
        "el servicio compone y decide, el repositorio consulta). Ni el handler, ni el servicio, " +
        "ni los scripts pueden tocarla directamente.",
    ).toEqual([]);
  });

  // Feature 126 / T3.3 (R27) — EL RE-ALCANCE. Antes: NADIE lee el rollup. Ahora: lo lee UN
  // archivo —el lector declarado de la 126— y SOLO dentro de sus dos metodos, ademas de la
  // reconciliacion del propio job. El resto del arbol sigue rojo, y por eso la mutacion de
  // R27 (anadir un `prisma.analyticsDaily.findMany` en el servicio, en la accion o en un
  // componente) pone rojo este caso.
  //
  // Lo que NO se hizo, a proposito: borrar el caso, ampliar la lista a `lib/repositories/` ni
  // relajar los patrones de `LECTURAS`. La apertura es POR ARCHIVO Y POR NOMBRE DE METODO.
  it("un solo archivo puede LEER la tabla: el lector declarado de la 126", () => {
    const lecturas: string[] = [];
    for (const rel of ARCHIVOS_CODIGO) {
      if (!MENCIONA_LA_TABLA.test(leer(rel))) continue; // toda LECTURA nombra la tabla
      const contenido = leerCodigo(rel);
      const patronesQueDisparan = LECTURAS.filter((p) => p.test(contenido));
      if (patronesQueDisparan.length === 0) continue;

      // Los DOS unicos archivos con permiso, cada uno con sus metodos permitidos por NOMBRE.
      const permitidos =
        rel === REPOSITORIO_ESCRITOR
          ? [METODO_LECTURA]
          : rel === LECTOR_126
            ? METODOS_LECTURA_126
            : null;
      if (permitidos === null) {
        lecturas.push(`${rel} :: ${patronesQueDisparan.join(", ")}`);
        continue;
      }

      // Con permiso de archivo NO basta: la lectura tiene que caer DENTRO del cuerpo de uno de
      // sus metodos declarados, no meramente en el mismo archivo. Si no, el archivo se
      // convierte en un saco donde cabe cualquier consulta con solo tener el metodo correcto
      // en alguna parte.
      const cuerpos = permitidos
        .map((m) => cuerpoDeMetodo(contenido, m))
        .filter((c): c is string => c !== null);
      if (cuerpos.length === 0) {
        lecturas.push(`${rel} :: lee el rollup pero no existe ninguno de sus metodos declarados`);
        continue;
      }
      let fuera = contenido;
      for (const cuerpo of cuerpos) fuera = fuera.split(cuerpo).join("\n/* cuerpo permitido */\n");
      for (const patron of patronesQueDisparan) {
        if (patron.test(fuera)) {
          lecturas.push(`${rel} :: lectura FUERA de ${permitidos.join("/")}`);
        }
      }
    }
    expect(
      lecturas,
      "la 124 sigue sin exponer consultas del rollup y la 126 abre EXACTAMENTE una puerta: " +
        `${LECTOR_126}, y dentro de el solo ${METODOS_LECTURA_126.join(" y ")}. La ` +
        `reconciliacion del job sigue permitida en ${METODO_LECTURA}. Todo lo demas es rojo: ` +
        "leer el rollup desde el servicio, desde la accion o desde un componente rompe R27.",
    ).toEqual([]);
  });

  it("el lector de la 126 existe y SOPORTA PESO: si dejara de leer, la apertura sobra", () => {
    // Direccion 1 — una apertura que apunta a un archivo inexistente es un comodin silencioso.
    expect(existe(LECTOR_126), `${LECTOR_126} esta autorizado a leer pero no existe`).toBe(true);
    // Direccion 2 — y si algun dia dejara de leer la tabla, la entrada sobra y hay que
    // retirarla: una excepcion inerte es un permiso latente que nadie recuerda revisar.
    const contenido = leerCodigo(LECTOR_126);
    expect(
      LECTURAS.some((p) => p.test(contenido)),
      `${LECTOR_126} ya no lee el rollup: retira la apertura de R27`,
    ).toBe(true);
    // Direccion 3 — y sus dos metodos declarados existen con cuerpo.
    for (const metodo of METODOS_LECTURA_126) {
      expect(cuerpoDeMetodo(contenido, metodo), `falta el metodo ${metodo}`).not.toBeNull();
    }
  });

  it("el lector de la 126 NO escribe: la apertura es de lectura y solo de lectura", () => {
    // R2 de la 126. Se afirma por separado del caso general de escritura para que el «no
    // escribe» del lector tenga su propio nombre y no sea la mera ausencia de un rojo.
    const contenido = leerCodigo(LECTOR_126);
    for (const patron of ESCRITURAS) {
      expect(patron.test(contenido), `${LECTOR_126} escribe el rollup: ${patron}`).toBe(false);
    }
  });

  it("no hay un SEGUNDO escritor: la escritura vive en dos metodos del repositorio (R29/R30)", () => {
    const escrituras: string[] = [];
    for (const rel of ARCHIVOS_CODIGO) {
      if (!MENCIONA_LA_TABLA.test(leer(rel))) continue; // toda ESCRITURA nombra la tabla
      const contenido = leerCodigo(rel);
      const patronesQueDisparan = ESCRITURAS.filter((p) => p.test(contenido));
      if (patronesQueDisparan.length === 0) continue;
      if (rel !== REPOSITORIO_ESCRITOR) {
        escrituras.push(`${rel} :: ${patronesQueDisparan.join(", ")}`);
        continue;
      }
      const cuerpos = METODOS_ESCRITURA.map((m) => cuerpoDeMetodo(contenido, m)).filter(
        (c): c is string => c !== null,
      );
      if (cuerpos.length === 0) {
        escrituras.push(
          `${rel} :: escribe pero no existe ni \`${METODOS_ESCRITURA.join("` ni `")}\``,
        );
        continue;
      }
      let fuera = contenido;
      for (const cuerpo of cuerpos) fuera = fuera.split(cuerpo).join("\n/* cuerpo permitido */\n");
      for (const patron of patronesQueDisparan) {
        if (patron.test(fuera)) {
          escrituras.push(
            `${rel} :: escritura FUERA de ${METODOS_ESCRITURA.join("/")} :: ${patron}`,
          );
        }
      }
    }
    expect(
      escrituras,
      "la 124 es el UNICO escritor de `analytics_daily` y escribe por un solo sitio: " +
        `\`escribirFecha\` (upsert de los cubos) y \`retirarFilasRancias\` (barrido de R29), ` +
        `ambos en ${REPOSITORIO_ESCRITOR}. Un segundo escritor rompe R30 y R35.`,
    ).toEqual([]);
  });

  it("TODA ruta del allowlist existe en el arbol: una entrada muerta es un comodin silencioso", () => {
    // T5.2(d)/(e) — la asercion que impide que el allowlist se convierta en una lista de deseos.
    // Direccion 1: si un archivo del escritor se renombra o se borra, su entrada vieja se queda
    // aqui autorizando una ruta que ya no existe -> ROJO, y hay que actualizar la lista.
    // Direccion 2: si alguien inventa una ruta para «arreglar» un rojo sin crear el archivo
    // -> ROJO tambien. Un allowlist solo restringe si describe el arbol de verdad.
    const inexistentes = ARCHIVOS_QUE_PUEDEN_NOMBRARLA.filter((rel) => !existe(rel));
    expect(
      inexistentes,
      "estas rutas estan en el allowlist de `analytics_daily` pero no existen en el arbol. Una " +
        "entrada muerta autoriza una ruta imaginaria y deja de restringir nada: o se crea el " +
        "archivo, o se retira la entrada. Rutas: " +
        inexistentes.join(", "),
    ).toEqual([]);

    // Y existir no basta: tienen que caer dentro de los directorios que el guardia RASTREA,
    // porque si no, nombrar la tabla desde ahi nunca se habria mirado.
    for (const rel of ARCHIVOS_QUE_PUEDEN_NOMBRARLA) {
      expect(ARCHIVOS_CODIGO, `${rel} no esta dentro de los directorios rastreados`).toContain(rel);
    }

    // El repositorio es el unico con permiso de acceso, y esta en el allowlist.
    expect(ARCHIVOS_QUE_PUEDEN_NOMBRARLA).toContain(REPOSITORIO_ESCRITOR);
  });

  it("los modulos declarados del escritor son legales TAL CUAL (T5.2c)", () => {
    // La contracara de los dos casos de arriba: el escritor legitimo, tal como queda, no aparece
    // en ninguna de las tres listas de infractores. Se afirma aqui por separado para que el
    // «verde» de T5.2(c) tenga un caso con nombre propio y no sea la mera ausencia de rojos.
    const presentes = MODULOS_ESCRITOR.filter(existe);
    expect(presentes, "ningun modulo del escritor existe todavia: T5.2(c) no mide nada").not.toEqual(
      [],
    );
    for (const rel of presentes) {
      expect(ARCHIVOS_QUE_PUEDEN_NOMBRARLA).toContain(rel);
      if (rel === REPOSITORIO_ESCRITOR) continue;
      const contenido = leerCodigo(rel);
      for (const patron of ACCESOS) {
        expect(patron.test(contenido), `${rel} accede a la tabla y no es el repositorio`).toBe(
          false,
        );
      }
    }
  });

  it("el localizador de cuerpos de metodo DISCRIMINA dentro/fuera (si no, el guard es vacio)", () => {
    const clase = `
      export class AnaliticaRollupRepository {
        async sumarMedidasEscritasDeFecha(fecha: string): Promise<{ entregas: number }> {
          const filas = await prisma.analyticsDaily.aggregate({ where: { fecha } });
          return { entregas: filas._sum.entregas ?? 0 };
        }

        async consultaProhibida(): Promise<void> {
          await prisma.analyticsDaily.findMany({});
        }
      }
    `;
    const cuerpo = cuerpoDeMetodo(clase, "sumarMedidasEscritasDeFecha");
    expect(cuerpo, "no encontro el cuerpo del metodo pese al tipo de retorno con llaves").not.toBeNull();
    expect(cuerpo!).toContain("aggregate");
    expect(cuerpo!).not.toContain("findMany"); // el metodo vecino NO se cuela
    expect(cuerpoDeMetodo(clase, "metodoQueNoExiste")).toBeNull();

    // El tipo de retorno con llaves DENTRO de un generico es el caso que la primera version
    // fallaba: devolvia `{ entregas: number }` —el TIPO— como si fuera el cuerpo.
    expect(cuerpo!).not.toBe("{ entregas: number }");

    // Generico anidado y tipo funcion: ni `Array<{...}>` ni la flecha de `(x) => y` deben
    // confundir al contador de angulos.
    const anidado = `
      async escribirFecha(f: Date, mapear: (x: number) => string): Promise<Array<{ id: string }>> {
        await prisma.analyticsDaily.upsert({ where: {}, create: {}, update: {} });
        return [];
      }
    `;
    expect(cuerpoDeMetodo(anidado, "escribirFecha")).toContain("upsert");

    // Una FIRMA sin cuerpo (la interfaz declarada en el mismo archivo) no debe hacer que se
    // rinda: sigue buscando hasta la implementacion real.
    const conInterfaz = `
      export interface IRepo {
        retirarFilasRancias(fecha: Date, marca: Date): Promise<number>;
      }
      export class Repo implements IRepo {
        async retirarFilasRancias(fecha: Date, marca: Date): Promise<number> {
          return prisma.analyticsDaily.deleteMany({ where: { fecha } }).then((r) => r.count);
        }
      }
    `;
    expect(cuerpoDeMetodo(conInterfaz, "retirarFilasRancias")).toContain("deleteMany");
  });

  it("el despiojado de comentarios DISCRIMINA: tapa la prosa, NO el codigo", () => {
    // Sin este caso, `soloCodigo` seria una asercion vacia: un stripper que devolviera cadena
    // vacia dejaria los cuatro casos de arriba en verde para siempre y nadie se enteraria.
    // Direccion 1 — la prosa se tapa. Es literalmente la forma del docblock de `whereRollup`
    // en `lib/analytics/alcance-columnas.ts` (feature 122), que es lo que motivo el cambio.
    const soloProsa = `
      /**
       * Fragmento de \`where\` para el rollup diario analytics_daily.
       * Devuelve un objeto plano y no \`Prisma.AnalyticsDailyWhereInput\`.
       */
      export function whereRollup(alcance: AlcanceDatos): Record<string, string> {
        return { zonaId: alcance.zonaId };
      }
      // otra mencion suelta en prosa: analytics_daily
    `;
    expect(NOMBRA_LA_TABLA.test(soloProsa)).toBe(true); // el archivo crudo SI la nombra...
    expect(NOMBRA_LA_TABLA.test(soloCodigo(soloProsa))).toBe(false); // ...pero no en codigo
    expect(soloCodigo(soloProsa)).toContain("whereRollup"); // y el codigo sobrevive entero

    // Direccion 2 — LA QUE IMPORTA: nombrarla en CODIGO sigue siendo detectado. Si alguien
    // rompe el stripper y se traga codigo real, estas tres se ponen rojas.
    const enSqlCrudo = `const f = await prisma.$queryRaw\`SELECT 1 FROM "analytics_daily"\`;`;
    expect(NOMBRA_LA_TABLA.test(soloCodigo(enSqlCrudo))).toBe(true);
    expect(ACCESOS.some((p) => p.test(soloCodigo(enSqlCrudo)))).toBe(true);

    const conModeloPrisma = `const f = await prisma.analyticsDaily.findMany({});`;
    expect(NOMBRA_LA_TABLA.test(soloCodigo(conModeloPrisma))).toBe(true);
    expect(LECTURAS.some((p) => p.test(soloCodigo(conModeloPrisma)))).toBe(true);

    // Direccion 3 — el caso mixto: un comentario NO amnistia el codigo que lo acompana.
    const mixto = `
      // este archivo no deberia tocar analytics_daily
      export async function colado() {
        return prisma.analyticsDaily.findMany({ where: {} });
      }
    `;
    const despiojado = soloCodigo(mixto);
    expect(NOMBRA_LA_TABLA.test(despiojado)).toBe(true);
    expect(despiojado).toContain("findMany");
    expect(despiojado).not.toContain("no deberia tocar");

    // Direccion 4 — el fallo CONCRETO que convertiria el stripper en un borrador de codigo:
    // que el `[\\s\\S]*?` de los comentarios de bloque se vuelva GOLOSO. Con dos docblocks en
    // el mismo archivo se tragaria todo lo que hay entre el primer `/*` y el ultimo cierre,
    // consulta incluida, y los cuatro casos de arriba pasarian a estar verdes por vacio.
    const dosDocblocks = `
      /** primer docblock: menciona analytics_daily en prosa. */
      export async function consultaDeVerdad() {
        return prisma.analyticsDaily.findMany({ where: {} });
      }
      /** segundo docblock: tambien la menciona, analytics_daily. */
      export const NADA = 1;
    `;
    const dosDespiojado = soloCodigo(dosDocblocks);
    expect(dosDespiojado, "el stripper se comio el codigo entre dos docblocks").toContain(
      "findMany",
    );
    expect(NOMBRA_LA_TABLA.test(dosDespiojado)).toBe(true);
    expect(LECTURAS.some((p) => p.test(dosDespiojado))).toBe(true);
  });

  it("en el catalogo de la 135 el literal es una DECLARACION de fuente, no una consulta", () => {
    // Sin las lineas de comentario: la cabecera del catalogo EXPLICA que ninguna metrica
    // financiera puede citar `analytics_daily`, y esa prosa no es una referencia al codigo.
    const metrics = quitarComentarios(leer("lib/analytics/metrics.ts"));
    const ocurrencias = metrics.match(/analytics_daily/g) ?? [];
    const declaraciones = metrics.match(/tablas: \["analytics_daily"\]/g) ?? [];
    expect(ocurrencias.length).toBeGreaterThan(0);
    expect(declaraciones.length).toBe(ocurrencias.length);

    const types = leer("lib/analytics/types.ts");
    expect(types).toMatch(/type TablaRollup = "analytics_daily"/);
  });

  it("en el adaptador de la 122 el literal vive en un COMENTARIO, no en codigo ejecutable", () => {
    // CONSERVADO del chore `65152f90` de `dev`, que lo escribio como contrapartida de dar de
    // alta el archivo en la lista blanca. Aqui el archivo NO esta en la lista —la 124 despioja
    // comentarios en vez de allowlistear—, asi que este caso deja de ser la letra pequena de
    // una excepcion y pasa a ser una afirmacion limpia sobre `alcance-columnas.ts`: su unica
    // mencion a la tabla es prosa. Si esa mencion bajara alguna vez a una linea ejecutable —un
    // `const TABLA = "analytics_daily"` que arme una consulta dinamica, por ejemplo—, se pone
    // rojo por DOS vias: por este caso y por el del nombrado, que ya no lo perdonaria.
    const fuente = leer("lib/analytics/alcance-columnas.ts");
    const lineas = fuente.split("\n").filter((l) => /analytics_daily|analyticsDaily/.test(l));
    expect(
      lineas.length,
      "el archivo dejo de nombrar la tabla: este caso sobra, retiralo",
    ).toBeGreaterThan(0);
    for (const linea of lineas) {
      expect(linea.trim(), `linea ejecutable que nombra la tabla: ${linea.trim()}`).toMatch(
        /^(\/\/|\*|\/\*)/,
      );
    }
    // Y no ejecuta NADA contra la base: ni SQL crudo ni cliente Prisma en tiempo de
    // ejecucion (`import type` desaparece en compilacion).
    expect(fuente).not.toMatch(/\$queryRaw|\$executeRaw|getPrismaClient/);
    expect(fuente).toMatch(/import type \{ Prisma \}/);
  });

  it("no hay repositorio, servicio ni interfaz con el nombre de la TABLA", () => {
    // Heredado de la 123 y CONSERVADO: no contradice el re-alcance de la 124, cuyos modulos se
    // llaman `AnaliticaRollup*` (nombre del HECHO de negocio, `docs/conventions.md`) y no
    // `AnalyticsDaily*` (nombre de la tabla). Si manana apareciera un `AnalyticsDailyService`,
    // seria un consumidor de la 126 colandose por la puerta de atras.
    //
    // Este caso es el UNICO del bloque que sigue leyendo el archivo CRUDO, a proposito: no
    // busca accesos a la tabla sino NOMBRES DE MODULO, y un modulo llamado `AnalyticsDaily*`
    // citado hasta en un comentario ya merece una mirada humana (o existe, y entonces el
    // rastreo lo encontrara por su propio contenido, o se esta planeando, y es el momento de
    // discutirlo). Ademas no ha colisionado con nadie: la 122 nombra la TABLA, no un modulo.
    for (const patron of [/AnalyticsDailyRepo/, /AnalyticsDailyService/, /IAnalyticsDaily/]) {
      expect(ARCHIVOS_CODIGO.filter((rel) => patron.test(leer(rel)))).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* T7.2 — tripwire de suma (R29)                                               */
/* -------------------------------------------------------------------------- */

const COLUMNA_STOCK = /ordenes_estado_stock|ordenesEstadoStock/g;

/**
 * T5.3 (R43) — QUE CUENTA COMO «AGREGAR LA COLUMNA», Y POR QUE SE AFINO.
 *
 * El analizador original marcaba la ventana de +-400 caracteres alrededor de la columna si
 * contenia CUALQUIER agregacion (`SUM(`, `_sum`, `sum:`, `groupBy`, `aggregate`). El escritor
 * legitimo de la 124 cae ahi SIN COMETER NINGUNA INFRACCION: nombra `ordenesEstadoStock`, usa
 * `groupBy` sobre `orden` (no sobre el rollup) y tiene `desde`/`hasta` en la misma ventana de
 * texto porque son las cotas del dia. Un falso positivo aqui es peor que inutil: la reaccion
 * natural seria renombrar variables o meter una excepcion, y las dos DESARMAN el guardia justo
 * antes de que llegue su destinatario real, la 126.
 *
 * Ahora se exige que la columna este DENTRO de la expresion agregada:
 *   - dentro de los parentesis de un `SUM(...)`;
 *   - dentro del objeto de un `_sum: { ... }` / `sum: { ... }` de Prisma;
 *   - dentro de una reduccion explicita, `.reduce( ... )`.
 * Compartir ventana con un `groupBy` cualquiera ya NO basta.
 *
 * Lo que NO cambia: el criterio de rango. Una vez establecido que se esta agregando la columna,
 * sigue siendo infraccion si la consulta abarca varias fechas o no esta clavada a ninguna.
 */

/** Indice del parentesis/llave que cierra el que abre en `apertura`. -1 si no cierra. */
function cierraEn(texto: string, apertura: number, abre: string, cierra: string): number {
  for (let i = apertura, prof = 0; i < texto.length; i++) {
    if (texto[i] === abre) prof++;
    else if (texto[i] === cierra && --prof === 0) return i;
  }
  return -1;
}

/** Tramos [inicio, fin] del texto que son una expresion de agregacion. */
function tramosDeAgregacion(contenido: string): readonly (readonly [number, number])[] {
  const tramos: [number, number][] = [];
  const anadir = (apertura: number, abre: string, cierra: string) => {
    const fin = cierraEn(contenido, apertura, abre, cierra);
    if (fin > apertura) tramos.push([apertura, fin]);
  };
  // `SUM( ... )` en SQL. El `\b` descarta `checksum(`; el `_` de `_sum(` tampoco casa.
  for (const m of contenido.matchAll(/\bsum\s*\(/gi)) anadir(m.index! + m[0].length - 1, "(", ")");
  // `_sum: { ... }` / `sum: { ... }` de Prisma.
  for (const m of contenido.matchAll(/\b_?sum\s*:\s*\{/g)) anadir(m.index! + m[0].length - 1, "{", "}");
  // Reduccion explicita en JS/TS.
  for (const m of contenido.matchAll(/\breduce\s*\(/g)) anadir(m.index! + m[0].length - 1, "(", ")");
  return tramos;
}

/**
 * Marcas de que la agregacion abarca VARIAS fechas. `desde`/`hasta` entran porque son el
 * vocabulario de `RangoResuelto` (feature 135), que es justo lo que la 126 va a usar.
 */
const RANGO =
  /\bBETWEEN\b|\bgte\b|\blte\b|\bgt\s*:|\blt\s*:|"?fecha"?\s*(>=|<=|>|<)|fecha\s*:\s*\{|\bdesdeFecha\b|\bhastaFecha\b|\bdesde\b|\bhasta\b/i;

/** Marca de que la consulta esta clavada a UNA fecha: `fecha = x` o `fecha: x` escalar. */
const FECHA_UNICA = /"?fecha"?\s*(?::|=(?!=))\s*(?!\{)/i;

/** Ventana de contexto alrededor de la columna, en caracteres. */
const VENTANA = 400;

/**
 * Devuelve las agregaciones de `ordenes_estado_stock` que NO estan acotadas a una fecha
 * unica. Devolver la lista (y no un booleano) es lo que permite que el mensaje de error
 * diga QUE se encontro, y lo que permite alimentarlo con cadenas sinteticas para
 * comprobar que discrimina.
 *
 * Dos condiciones, y las DOS tienen que darse (T5.3):
 *   1. la columna esta DENTRO de una expresion de agregacion (`tramosDeAgregacion`), no
 *      meramente cerca de un `groupBy` cualquiera;
 *   2. esa agregacion abarca un rango de fechas, o no esta clavada a ninguna.
 */
function agregacionesSinFechaUnica(contenido: string): readonly string[] {
  const tramos = tramosDeAgregacion(contenido);
  const hallazgos: string[] = [];
  for (const m of contenido.matchAll(COLUMNA_STOCK)) {
    const i = m.index ?? 0;
    const dentroDeAgregacion = tramos.some(([ini, fin]) => i > ini && i < fin);
    if (!dentroDeAgregacion) continue;
    const ventana = contenido.slice(Math.max(0, i - VENTANA), i + VENTANA);
    if (RANGO.test(ventana) || !FECHA_UNICA.test(ventana)) {
      hallazgos.push(ventana.replace(/\s+/g, " ").trim().slice(0, 200));
    }
  }
  return hallazgos;
}

describe("R29 — el tripwire DISCRIMINA: cadenas de prueba sinteticas", () => {
  it("caza un SUM SQL de la columna sobre un rango de fechas", () => {
    const malo = `
      const filas = await prisma.$queryRaw\`
        SELECT zona_id, SUM(ordenes_estado_stock) AS total
        FROM analytics_daily
        WHERE fecha BETWEEN \${desdeFecha} AND \${hastaFecha}
        GROUP BY zona_id\`;
    `;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("caza el `_sum` de Prisma sobre un rango de fechas", () => {
    const malo = `
      const total = await prisma.analyticsDaily.aggregate({
        _sum: { ordenesEstadoStock: true },
        where: { fecha: { gte: rango.desde, lte: rango.hasta } },
      });
    `;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("caza una agregacion sin ninguna acotacion por fecha", () => {
    const malo = `const total = filas.reduce((acc, f) => acc + f.ordenesEstadoStock, 0); // sum: embudo`;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("NO se queja de una agregacion clavada a UNA fecha (el uso legitimo del embudo)", () => {
    const bueno = `
      SELECT estatus_id, SUM(ordenes_estado_stock) AS total
      FROM analytics_daily
      WHERE fecha = $1
      GROUP BY estatus_id
    `;
    expect(agregacionesSinFechaUnica(bueno)).toEqual([]);
  });

  it("NO se queja del `_sum` de Prisma con la fecha escalar", () => {
    const bueno = `
      const embudo = await prisma.analyticsDaily.groupBy({
        by: ["estatusId"],
        _sum: { ordenesEstadoStock: true },
        where: { fecha: fechaDelCorte },
      });
    `;
    expect(agregacionesSinFechaUnica(bueno)).toEqual([]);
  });

  it("NO se queja de una simple lectura de la columna sin agregar", () => {
    const bueno = `const stock = fila.ordenesEstadoStock;`;
    expect(agregacionesSinFechaUnica(bueno)).toEqual([]);
  });

  // ---- T5.3: los dos casos nuevos de la 124 ----

  it("NO se queja del ESCRITOR LEGITIMO de la 124, que escribe la columna pero no la suma", () => {
    // Este es el falso positivo que motivo el afinado: la columna, un `groupBy` (sobre `orden`,
    // no sobre el rollup) y las cotas `desde`/`hasta` del dia comparten ventana de texto. Con el
    // analizador viejo esto salia ROJO sin cometer ninguna infraccion.
    const escritorLegitimo = `
      const porEstatus = await this.prisma.orden.groupBy({
        by: ["zonaId", "tiendaId", "mensajeroAsignadoId"],
        _count: { _all: true },
        where: {
          deletedAt: null,
          createdAt: { gte: ventana.desde, lt: ventana.hasta },
        },
      });
      return porEstatus.map((g) => ({
        ...coordenadasDe(g),
        ordenesEstadoStock: g._count._all,
        ordenesCreadas: 0,
      }));
    `;
    expect(agregacionesSinFechaUnica(escritorLegitimo)).toEqual([]);
  });

  it("SIGUE cazando la agregacion real de la columna sobre un rango dentro de un `groupBy`", () => {
    // La contracara del caso anterior: mismo `groupBy`, pero ahora la columna SI esta dentro de
    // la expresion agregada y el `where` abarca un rango. Es exactamente lo que la 126 no debe
    // hacer, y aplica tambien a los tres estatus terminales pese a D2-B2.
    const malo = `
      const porZona = await prisma.analyticsDaily.groupBy({
        by: ["zonaId"],
        _sum: { ordenesEstadoStock: true },
        where: { fecha: { gte: rango.desde, lte: rango.hasta } },
      });
    `;
    expect(agregacionesSinFechaUnica(malo)).toHaveLength(1);
  });

  it("la columna DENTRO de la expresion agregada es la condicion, no compartir ventana", () => {
    // Frontera explicita del afinado, por si alguien lo afloja mas: un `SUM` de OTRA columna en
    // la misma ventana no basta para acusar...
    const otraColumna = `
      SELECT SUM(ordenes_creadas) AS total, ordenes_estado_stock
      FROM analytics_daily WHERE fecha BETWEEN $1 AND $2
    `;
    expect(agregacionesSinFechaUnica(otraColumna)).toEqual([]);
    // ...pero meter la columna dentro de ese mismo SUM si.
    const dentro = `
      SELECT SUM(ordenes_creadas + ordenes_estado_stock) AS total
      FROM analytics_daily WHERE fecha BETWEEN $1 AND $2
    `;
    expect(agregacionesSinFechaUnica(dentro)).toHaveLength(1);
  });

  it("la reconciliacion de R34 solo pasa si DECLARA la fecha unica sobre la que suma", () => {
    // El helper `sumarMedidas` del servicio (R34/D5) suma la columna sobre los cubos de UNA
    // fecha, que es legitimo: R43 prohibe sumar ENTRE fechas. Pero un `filas.reduce((a, f) => a +
    // f.ordenesEstadoStock, 0)` suelto es TEXTUALMENTE IDENTICO a la tercera cadena mala de este
    // bloque («caza una agregacion sin ninguna acotacion por fecha»), y el analizador no puede
    // distinguirlos sin dejar de detectar aquella — cosa que T5.3 prohibe expresamente.
    //
    // La salida NO es una excepcion en el guardia, sino que el codigo DIGA sobre que fecha suma:
    // basta con que la fecha este en el ambito (en la firma del helper) para que la agregacion
    // quede clavada a una fecha unica y el guardia la acepte. Ese es el contrato que el escritor
    // de la 124 tiene que cumplir, y queda fijado aqui en vez de en un comentario suelto.
    const sinDeclararla = `
      function sumarMedidas(filas: readonly FilaRollup[]): MedidasReconciliables {
        return {
          ordenesCreadas: filas.reduce((a, f) => a + f.ordenesCreadas, 0),
          ordenesEstadoStock: filas.reduce((a, f) => a + f.ordenesEstadoStock, 0),
        };
      }
    `;
    expect(agregacionesSinFechaUnica(sinDeclararla)).toHaveLength(1);

    const declarandola = `
      function sumarMedidas(fecha: FechaCR, filas: readonly FilaRollup[]): MedidasReconciliables {
        return {
          ordenesCreadas: filas.reduce((a, f) => a + f.ordenesCreadas, 0),
          ordenesEstadoStock: filas.reduce((a, f) => a + f.ordenesEstadoStock, 0),
        };
      }
    `;
    expect(agregacionesSinFechaUnica(declarandola)).toEqual([]);
  });
});

describe("R29 — ningun archivo de `lib/` ni `app/` suma `ordenes_estado_stock` entre fechas", () => {
  it("el rastreo cubre lib/ y app/ (si no, el guard seria vacio)", () => {
    expect(ARCHIVOS_TRIPWIRE.length).toBeGreaterThan(100);
    expect(ARCHIVOS_TRIPWIRE.some((f) => f.startsWith("lib/"))).toBe(true);
    expect(ARCHIVOS_TRIPWIRE.some((f) => f.startsWith("app/"))).toBe(true);
  });

  it("no hay ni una agregacion de la columna fuera de una fecha unica", () => {
    const infracciones: string[] = [];
    for (const rel of ARCHIVOS_TRIPWIRE) {
      for (const hallazgo of agregacionesSinFechaUnica(leer(rel))) {
        infracciones.push(`${rel}: ${hallazgo}`);
      }
    }
    expect(
      infracciones,
      "`ordenes_estado_stock` es un STOCK al corte del dia (R28): sumarla entre fechas cuenta la misma orden una vez por cada dia que estuvo viva. Agrega dentro de UNA fecha, o usa `ordenes_creadas`, que si es un flujo.",
    ).toEqual([]);
  });
});
