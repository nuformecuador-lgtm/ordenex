import { describe, it, expect } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

// Feature 28 (R6, R7): guard anti-`embalaje`. Recorre el arbol del repo y falla
// si aparece la palabra `embalaje` (case-insensitive) fuera del whitelist
// confirmado por el humano (decisiones append-only / definicion de la feature).
//
// ---------------------------------------------------------------------------
// Feature 329 (2026-08-28) — por que este archivo lee en paralelo y con su
// propio `testTimeout`. MEDIDO, no supuesto:
//
// El guard abre 3.985 archivos (41 MB) uno por uno. Perfilado por etapas sobre
// este mismo arbol, el reparto del tiempo es:
//
//   | etapa                          | caliente | primera pasada |
//   |--------------------------------|----------|----------------|
//   | readdirSync (601 directorios)  |   26 ms  |      60 ms     |
//   | path.relative (whitelist)      |   17 ms  |      49 ms     |
//   | **readFileSync (3.985 archivos)** | **264 ms** | **37.787 ms** |
//   | split + regex por linea (894k) |  100 ms  |     131 ms     |
//   | **total**                      | **430 ms** | **38.136 ms**  |
//
// O sea: el 99,1% del caso malo es la LATENCIA DE `open()`, y nada mas. El
// coste por archivo pasa de 0,066 ms (caliente) a 9,48 ms (primera pasada sobre
// un worktree recien creado, con el filtro del antivirus tocando cada archivo
// por primera vez): un factor de 143x. Ese caso malo son 38 s y por si solo ya
// revienta el `testTimeout` global de 20 s SIN NADA MAS CORRIENDO. Con los
// worktrees como via normal de paralelismo, cada feature estrena arbol y paga
// esa primera pasada; por eso el rojo salia en casi todas las tandas y siempre
// "pasaba en aislado" a la segunda.
//
// Descartado que fuera contencion de CPU: la feature 203 midio el peor factor
// de degradacion por CPU del repo en 3,35x, y 430 ms x 3,35 = 1,4 s. No llega
// a 20 s ni de lejos. Reproducido aqui ademas con 10 procesos quemando CPU+IO:
// el guard paso de 444 ms a 477 ms. El cuello es I/O, no CPU.
//
// Que se cambio, y lo que NO se cambio: el conjunto vigilado es EXACTAMENTE el
// mismo (mismos IGNORED_DIRS, mismas extensiones, mismo whitelist, mismo
// /embalaje/i, mismo orden de reporte). Solo cambia COMO se lee:
//
//   1. Las lecturas se solapan con un pool acotado en vez de ir en serie, que
//      es lo unico que ataca una latencia de `open()`. Rodilla medida sobre
//      3.985 archivos: 1->561 ms, 2->374, 4->212, **8->175**, 16->173, 32->168.
//      Se fija en 8: a partir de ahi la ganancia es <2% porque el pool de hilos
//      de libuv (UV_THREADPOOL_SIZE, 4 por defecto) es el techo real.
//   2. Se descarta cada archivo con UN test sobre el contenido entero en vez de
//      partirlo en lineas y correr el regex 894.000 veces. Solo se parte en
//      lineas el archivo que YA dio positivo, que es el unico donde hacen falta
//      numeros de linea para el reporte.
//   3. Se busca sobre `latin1` para no decodificar 41 MB de UTF-8 a string JS
//      por gusto. Es exacto para ESTE patron: `embalaje` es ASCII puro y en
//      UTF-8 un byte ASCII nunca aparece dentro de una secuencia multibyte, asi
//      que no hay ni falsos positivos ni falsos negativos posibles. El reporte
//      si decodifica UTF-8, para que los acentos de la linea salgan bien.
//
// Resultado medido (mediana de 5, mismo arbol, misma maquina): **382 ms -> 175
// ms**, 2,2x. Las cuatro variantes devuelven los mismos 117 hallazgos sobre el
// arbol sin whitelist, que es la comprobacion de que no se afloja la cobertura.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const GUARD_FILE_ABS = path.join(__dirname, "no-embalaje.test.ts");

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  "build",
  "progress",
  // `.claude/` es estado del harness (worktrees aislados de subagentes,
  // settings, skills), no fuente del repo. En particular `.claude/worktrees/`
  // contiene checkouts anidados del propio repo: sin este ignore el guard se
  // encuentra copias de archivos que SI estan en el whitelist (incluido el
  // propio guard) pero bajo otra ruta relativa, y falla por su reflejo. El
  // guard audita el codigo del proyecto, no copias anidadas de si mismo.
  ".claude",
  // `.vitest/` es el volcado JSON que `pnpm run test:json` deja para que
  // `comparar-baseline-rojos.mjs` sepa que fallo. Es estado del arnes, no
  // fuente del repo, y ademas contiene los NOMBRES de todos los tests: entre
  // ellos los del propio guard, asi que sin este ignore la primera corrida
  // completa dejaba el repo en un estado donde la segunda fallaba por su
  // propio reflejo. Se ignora el DIRECTORIO -- por eso el reporte ya no cae
  // en la raiz-- y no se anota el archivo en el whitelist: lo que no es
  // fuente no deberia necesitar una excepcion nominal.
  ".vitest",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cts",
  ".mts",
  ".json",
  ".md",
  ".sql",
  ".prisma",
  ".toml",
  ".yml",
  ".yaml",
  ".css",
  ".txt",
  ".sh",
]);

// Rutas (relativas a REPO_ROOT, con separadores normalizados a "/") donde SI
// puede aparecer `embalaje` sin que el guard falle.
//
// Ademas de la whitelist confirmada por el humano (specs de esta feature y
// feature_list.json), se whitelistean explicitamente los DOS artefactos que
// R3/R4 exigen crear y que POR DEFINICION deben citar el valor literal
// 'embalaje' para documentar/verificar el rename (el UPDATE de la migracion y
// el test estatico que lo comprueba por regex). Sin esta excepcion el propio
// guard se auto-contradiria con R3/R4.
const WHITELIST_PREFIXES = [
  "specs/rename-embalaje-fulfillment/",
  "db/migrations/20260710140000_rename_order_status_embalaje_en_fulfillment/",
  // Feature 27: el spec cita 'embalaje' solo para documentar el rename historico de la
  // feature 28 como contexto; no reintroduce el valor.
  "specs/27-fulfillment-tienda/",
  // Feature 135: el spec cita el folder historico *_rename_order_status_embalaje_en_fulfillment
  // como PRECEDENTE del rename por UPDATE (order_status es tabla catalogo, no enum); no
  // reintroduce el valor 'embalaje'. Mismo patron que specs/27 y specs/rename-embalaje-fulfillment.
  "specs/137-order-status-rename-nomenclatura/",
];
const WHITELIST_FILES = new Set([
  "feature_list.json",
  "tests/integration/db/rename-order-status-migration.test.ts",
  // Lote 153-160: estos specs NO citan el value 'embalaje'; citan el NOMBRE DE ARCHIVO de
  // este guard (`tests/unit/guards/no-embalaje.test.ts`) como precedente de modelado para
  // sus propios guards. El guard busca /embalaje/i linea a linea y no distingue el nombre
  // del guard del value prohibido, asi que hay que whitelistearlos por archivo (mas estrecho
  // que whitelistear la carpeta entera del spec, como se hizo con specs/27 y specs/137).
  "specs/155-creacion-bifurcada-fulfillment/design.md",
  "specs/159-quitar-sugerencia-mensajeros/design.md",
  "specs/159-quitar-sugerencia-mensajeros/tasks.md",
  // Feature 167: MISMO caso que los tres de arriba. `design.md §8` cita el NOMBRE DE ARCHIVO de
  // este guard como molde del suyo (`entregas-sin-recoleccion.test.ts`); no menciona el value
  // 'embalaje' por ningun lado. Alta por archivo, no por carpeta.
  "specs/167-apartado-recoleccion-mensajero/design.md",
  // Feature 135: MISMO caso, y era el ULTIMO rojo del repo (2026-07-31). Su `tasks.md:187` narra
  // en la bitacora un flaky de CI nombrando este guard ("timeout del guard `no-embalaje`"); es
  // prosa sobre la herramienta, no una reintroduccion del value. Estuvo rojo dias porque cada
  // feature que lo encontraba lo declaraba deuda ajena y seguia: nadie lo daba de alta.
  "specs/135-analitica-catalogo-kpis-rangos/tasks.md",
  // Feature 122: MISMO caso, y por el MISMO motivo que el de arriba —tanto que su `tasks.md:243`
  // narra en la bitacora que `./init.sh` cae por este guard y, al escribir su nombre, se
  // convierte en la causa de que siga cayendo. Es prosa sobre la herramienta, no una
  // reintroduccion del value 'embalaje'. Se da de alta aqui, en la tanda M de la 170, porque
  // dejaba el gate del repo ENTERO rojo y la regla es que quien lo encuentra lo da de alta en
  // vez de declararlo deuda ajena y seguir. Alta por archivo, no por carpeta.
  "specs/122-analitica-alcance-por-rol/tasks.md",
  // Feature 86 (enmienda 2026-08-08): la landing publica replica el home de
  // ordenex.co, y sus politicas de dano usan `embalaje` en su sentido ordinario
  // del castellano —el material con que se protege un paquete—, copy tomado del
  // sitio publicado. Nada que ver con el value de `order_status` que este guard
  // persigue: no es un estado, no toca la base, no vuelve por la puerta de
  // atras. Alta por archivo (no por carpeta) para que si `app/_landing/` crece
  // con codigo que SI toque estados, el guard lo siga viendo.
  "app/_landing/LandingPoliticas.tsx",
]);

function toRelPosix(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function isWhitelisted(absPath: string): boolean {
  if (absPath === GUARD_FILE_ABS) return true;
  const rel = toRelPosix(absPath);
  if (WHITELIST_FILES.has(rel)) return true;
  return WHITELIST_PREFIXES.some((prefix) => rel.startsWith(prefix));
}

interface Hallazgo {
  file: string;
  line: number;
  text: string;
}

// Recorre el arbol y devuelve los archivos candidatos EN ORDEN DE RECORRIDO.
// Los `readdirSync` se dejan sincronos a proposito: son 601 directorios y 26 ms
// medidos, no es ahi donde se va el tiempo (ver cabecera).
function collectFiles(dir: string, archivos: string[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(abs, archivos);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (isWhitelisted(abs)) continue;
    archivos.push(abs);
  }
}

// Concurrencia de lectura. 8 es la rodilla medida (ver cabecera); por encima la
// ganancia es <2% porque el techo lo pone el pool de hilos de libuv.
const CONCURRENCIA_LECTURA = 8;

function hallazgosDeArchivo(abs: string, buf: Buffer): Hallazgo[] {
  // Descarte barato: un solo test sobre el contenido entero, sin decodificar
  // UTF-8 ni partir en lineas. Exacto para un patron ASCII (ver cabecera).
  if (!/embalaje/i.test(buf.toString("latin1"))) return [];

  // Solo aqui, en el archivo que YA dio positivo, se paga la decodificacion
  // UTF-8 y el corte en lineas para poder reportar linea y texto.
  const hallazgos: Hallazgo[] = [];
  const rel = toRelPosix(abs);
  buf
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, idx) => {
      if (/embalaje/i.test(line)) {
        hallazgos.push({ file: rel, line: idx + 1, text: line.trim() });
      }
    });
  return hallazgos;
}

async function buscarHallazgos(root: string): Promise<Hallazgo[]> {
  const archivos: string[] = [];
  collectFiles(root, archivos);

  // Cada worker escribe en el hueco que le corresponde al archivo, no en una
  // lista compartida: asi el reporte sale en el MISMO orden de recorrido que
  // antes, aunque las lecturas terminen desordenadas.
  const porArchivo: Hallazgo[][] = new Array(archivos.length);
  let siguiente = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = siguiente++;
      if (i >= archivos.length) return;
      const abs = archivos[i];
      porArchivo[i] = hallazgosDeArchivo(abs, await fsp.readFile(abs));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA_LECTURA, archivos.length) }, worker),
  );

  return porArchivo.flat();
}

describe("guard anti-embalaje (R6, R7)", () => {
  // `testTimeout` propio (60 s) en vez del global de 20 s. El numero sale de la
  // medicion, no de doblar a ojo: el peor caso observado de este recorrido son
  // 38,1 s (primera pasada sobre un worktree recien creado), que ya se sale de
  // los 20 s el solo. 60 s cubre ese peor caso medido con 1,57x de margen y son
  // ~340x el caso normal de despues del arreglo (175 ms), asi que sigue siendo
  // una senal util si algun dia esto se cuelga de verdad. Se queda por debajo
  // de los 90 s de `WORKER_START_TIMEOUT` de vitest (no configurable) para no
  // tapar el otro modo de fallo, el de "no arranco el worker".
  it("no queda ninguna referencia a 'embalaje' fuera del whitelist", async () => {
    const hallazgos = await buscarHallazgos(REPO_ROOT);

    if (hallazgos.length > 0) {
      const detalle = hallazgos
        .map((h) => `${h.file}:${h.line}: ${h.text}`)
        .join("\n");
      throw new Error(`Se encontraron referencias a 'embalaje' fuera del whitelist:\n${detalle}`);
    }

    expect(hallazgos).toHaveLength(0);
  }, 60_000);
});
