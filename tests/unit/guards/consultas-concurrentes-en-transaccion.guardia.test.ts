import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GUARDIA DE LA FICHA 450 (T5, R8/R9/R10/R11) — UNA CONSULTA A LA VEZ SOBRE UN CLIENTE DE
// TRANSACCION
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// EL DEFECTO QUE VIGILA. `@prisma/adapter-pg` da a cada `$transaction` interactivo UNA sola
// conexion (`pg.PoolClient`) para toda la transaccion. Sobre el cliente AGRUPADO un `Promise.all`
// es correcto —cada consulta coge su propia conexion del pool—; sobre un `tx` NO lo es: las dos
// van al mismo `pg.Client`. Si la primera falla y aborta la transaccion, la segunda —ya encolada,
// y nadie puede cancelarla— corre contra una transaccion ABORTADA y recibe `25P02`. La ficha 440
// lo midio desde el otro extremo: 27 respuestas 500 a un mensajero en una hora.
//
// ⚠️ EL AVISO DE `pg` NO ES LA MEDIDA. `Calling client.query() when the client is already
// executing a query` solo salta si la cola YA tenia algo al encolar, o sea con TRES consultas; y
// `util.deprecate` lo emite una vez por proceso. El dano necesita DOS. Por eso esta guardia cuenta
// el patron en el codigo y no espera a ver un aviso en los logs.
//
// POR QUE HACEN FALTA DOS BRAZOS, Y POR QUE UN DETECTOR «`Promise.all` dentro del `$transaction`»
// NO BASTA (design §5.5). El `Promise.all` que esta ficha retira NO estaba escrito dentro de
// ninguna transaccion: estaba en `lib/services/WalletFeedService.ts`, en una funcion que recibe el
// `tx` POR PARAMETRO. Un detector que solo mirase los cuerpos de `$transaction` devolvia CERO — y
// eso es exactamente lo que hizo que nadie los viera leyendo el codigo durante meses.
//
//   · BRAZO A (R8) — por el TIPO DEL PARAMETRO: una funcion que recibe algo tipado `*TxClient` /
//     `Prisma.TransactionClient` y lanza dos o mas operaciones concurrentes sobre ese parametro.
//   · BRAZO B (R9) — por el `tx` INFERIDO: el cuerpo de un `$transaction(async (tx) => …)` que
//     lanza dos o mas operaciones concurrentes sobre su propio cliente.
//   · BRAZO C (R11) — por la EXPANSION DE RELACIONES: una lectura sobre un cliente de transaccion
//     cuyo `select`/`include` ANIDA relaciones. Este brazo no existia en el diseño original: lo
//     obligo lo que midio la caza del emisor (T2), abajo.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LO QUE MIDIO LA CAZA DEL EMISOR, Y POR QUE NACE EL BRAZO C (FICHA 450 / T2, 2026-09-21)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Contra Postgres real, con un contador de consultas en vuelo POR CONEXION
// (`tests/integration/db/_consultas-en-vuelo.ts`):
//
//   · un `Promise.all` de dos lecturas sobre un `tx` da **1** consulta en vuelo — Prisma serializa
//     por su cuenta las peticiones de una transaccion interactiva (medido tambien con las dos en
//     ticks distintos y con tres);
//   · pero UNA sola lectura cuyo `select` anida CINCO relaciones da **5 consultas en vuelo sobre
//     la misma conexion, 4 solapes y el aviso de `pg` capturado en un proceso limpio**. Prisma no
//     resuelve las relaciones con un JOIN: expande la lectura en 1 + N consultas y lanza las N
//     hermanas A LA VEZ. Sobre el pool eso es inofensivo (3 conexiones, maximo 1 en vuelo); sobre
//     una transaccion, no.
//
// O sea: el patron que el brazo A retira es un defecto de FORMA que hoy Prisma tapa por dentro, y
// el que produce el aviso en produccion es otro. Los dos se vigilan, y el brazo A no sobra: que
// Prisma lo serialice hoy es un accidente de version —`pg@9.0` convertira el aviso en error— y el
// codigo seguiria diciendo «estas dos pueden ir a la vez», que es falso.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// LIMITES DECLARADOS (T5.5) — lo que esta guardia NO ve
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
//   1. CLOSURE QUE CAPTURA EL `tx`. Si una funcion interna se queda con el `tx` de su entorno y lo
//      usa dentro de un `Promise.all` escrito FUERA del cuerpo del `$transaction` y FUERA de una
//      funcion con el parametro tipado, ningun brazo lo ve. El alcance textual acaba en el cuerpo.
//   2. HELPER CON EL TIPO ESCRITO EN LINEA. Un parametro tipado
//      `{ gestionOrden: { findMany: … } }` en vez de `*TxClient` no entra en el censo del brazo A:
//      el brazo A reconoce el patron por el NOMBRE del tipo, que es como se escribe en este repo.
//   3. OTRAS FORMAS DE CONCURRENCIA. Se reconocen `Promise.all`, `allSettled`, `race` y `any`. Un
//      `for` que acumula promesas sin `await` y las resuelve luego, o un `Array.map` cuyo
//      resultado se espera mas tarde, no los ve ningun brazo.
//
// Los tres limites son reales y quedan escritos aqui —y no tapados— porque una guardia que
// pretende ver mas de lo que ve es peor que una que declara su alcance.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AUTOCOMPROBACION (R10, obligatoria por `docs/verification.md`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// El ultimo bloque demuestra que cada detector se pone ROJO ante el codigo literal que esta ficha
// retira y VERDE ante el `Promise.all` sobre el cliente AGRUPADO, que es legitimo y existe hoy en
// el arbol. Sin eso, «cero violaciones» no significa nada: este repo ya tuvo un arnes que reporto
// 9/9 supervivientes dos veces sin haber ejecutado un test.

const RAIZ = path.join(__dirname, "..", "..", "..");
const CARPETA_LIB = path.join(RAIZ, "lib");

/** Las formas de `Promise` que lanzan varias operaciones a la vez. */
const FAMILIA_PROMISE = String.raw`Promise\s*\.\s*(?:all|allSettled|race|any)\s*\(`;

/** Los tipos que declaran «esto es el cliente de una transaccion». */
const TIPO_DE_TRANSACCION = String.raw`(?:\w*TxClient|Prisma\.TransactionClient|TransactionClient)`;

interface Violacion {
  archivo: string;
  linea: number;
  cliente: string;
  fragmento: string;
}

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosTs(p));
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) salida.push(p);
  }
  return salida;
}

/** Devuelve el texto entre el delimitador de apertura en `desde` y su pareja. Incluye ambos. */
function bloqueBalanceado(fuente: string, desde: number, abre: string, cierra: string): string {
  let nivel = 0;
  for (let i = desde; i < fuente.length; i += 1) {
    if (fuente[i] === abre) nivel += 1;
    else if (fuente[i] === cierra) {
      nivel -= 1;
      if (nivel === 0) return fuente.slice(desde, i + 1);
    }
  }
  return fuente.slice(desde);
}

function numeroDeLinea(fuente: string, indice: number): number {
  return fuente.slice(0, indice).split("\n").length;
}

/**
 * Cuantas veces aparece `cliente` dentro de `texto`, en CUALQUIER posicion.
 *
 * ⚠️ AQUI ESTA LA PIEZA QUE HACIA INVISIBLE AL DEFECTO, y se descubrio porque la autocomprobacion
 * de abajo se nego a ponerse roja. Contar solo `cliente.algo` —el cliente como EMISOR— deja fuera
 * el caso real de esta ficha:
 *
 *     Promise.all([leerDetallePorOrden(cierreId, tx), tx.gestionOrden.findMany({ … })])
 *
 * Ahi `tx` emite UNA consulta y viaja como ARGUMENTO a una funcion que emite la otra. Contando
 * emisores sale 1 y no hay violacion; contando apariciones salen 2, que es lo que de verdad llega
 * a la conexion. La consulta escondida detras de un helper es precisamente el motivo de que nadie
 * viera estos dos sitios leyendo el codigo.
 */
function usosDelCliente(texto: string, cliente: string): number {
  const re = new RegExp(String.raw`\b${cliente}\b`, "g");
  return (texto.match(re) ?? []).length;
}

/**
 * Los `Promise.<familia>(…)` de `cuerpo` que lanzan 2 o mas operaciones sobre `cliente`.
 * `desplazamiento` es la posicion de `cuerpo` dentro del archivo, para dar la linea real.
 */
function concurrenciaSobre(
  cuerpo: string,
  cliente: string,
  archivo: string,
  fuente: string,
  desplazamiento: number,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const re = new RegExp(FAMILIA_PROMISE, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cuerpo)) !== null) {
    const abre = cuerpo.indexOf("(", m.index + m[0].length - 1);
    const argumento = bloqueBalanceado(cuerpo, abre, "(", ")");
    if (usosDelCliente(argumento, cliente) < 2) continue;
    violaciones.push({
      archivo,
      linea: numeroDeLinea(fuente, desplazamiento + m.index),
      cliente,
      fragmento: argumento.replace(/\s+/g, " ").slice(0, 110),
    });
  }
  return violaciones;
}

// ── BRAZO A — por el tipo del parametro ───────────────────────────────────────────────────────

interface FuncionConTx {
  archivo: string;
  linea: number;
  cliente: string;
  cuerpo: string;
  desplazamiento: number;
}

/**
 * Censa toda funcion/metodo con un parametro tipado como cliente de transaccion, y se queda con su
 * cuerpo. El patron reconoce `nombre: Tipo` dentro de una lista de parametros seguida de `{`.
 */
function funcionesConParametroDeTransaccion(archivo: string, fuente: string): FuncionConTx[] {
  const salida: FuncionConTx[] = [];
  const re = new RegExp(
    String.raw`\(([^()]*\b(\w+)\s*:\s*(?:readonly\s+)?${TIPO_DE_TRANSACCION}[^()]*)\)\s*(?::[^={;]*)?(?:=>\s*)?\{`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    const abre = fuente.indexOf("{", m.index + m[0].length - 1);
    salida.push({
      archivo,
      linea: numeroDeLinea(fuente, m.index),
      cliente: m[2],
      cuerpo: bloqueBalanceado(fuente, abre, "{", "}"),
      desplazamiento: abre,
    });
  }
  return salida;
}

// ── BRAZO B — por el `tx` inferido de un `$transaction` ───────────────────────────────────────

interface CuerpoDeTransaccion {
  archivo: string;
  linea: number;
  cliente: string;
  cuerpo: string;
  desplazamiento: number;
}

function cuerposDeTransaccion(archivo: string, fuente: string): CuerpoDeTransaccion[] {
  const salida: CuerpoDeTransaccion[] = [];
  const re = /\$transaction\s*\(\s*(?:async\s*)?\(?\s*(\w+)\s*\)?\s*(?::[^=]*)?=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    const abre = fuente.indexOf("{", m.index + m[0].length - 1);
    salida.push({
      archivo,
      linea: numeroDeLinea(fuente, m.index),
      cliente: m[1],
      cuerpo: bloqueBalanceado(fuente, abre, "{", "}"),
      desplazamiento: abre,
    });
  }
  return salida;
}

// ── BRAZO C — por la expansion de relaciones dentro de una transaccion ────────────────────────

/** Los metodos de lectura de Prisma que pueden expandirse en N consultas por relacion. */
const LECTURAS = String.raw`(?:findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow)`;

/**
 * ¿El objeto de opciones de una lectura anida relaciones? Anida si trae un `include:` (a cualquier
 * profundidad) o si dentro de su `select:` hay OTRO `select:`/`include:`.
 */
function anidaRelaciones(opciones: string): boolean {
  if (/\binclude\s*:/.test(opciones)) return true;
  const primero = opciones.indexOf("select:");
  if (primero < 0) return false;
  const resto = opciones.slice(primero + "select:".length);
  return /\bselect\s*:/.test(resto);
}

/**
 * Las lecturas de `cuerpo` emitidas sobre `cliente` cuyo `select`/`include` anida relaciones.
 * Resuelve `select: CONSTANTE` contra las constantes del propio archivo: en este repo los `select`
 * grandes viven en una constante de modulo (`SNAPSHOT_SELECT`, `CIERRE_PASADO_SELECT`, …) y un
 * detector que solo mirase literales en linea devolveria cero justo donde mas importa.
 */
function lecturasConRelacionesAnidadas(
  cuerpo: string,
  cliente: string,
  archivo: string,
  fuente: string,
  desplazamiento: number,
  constantes: Map<string, string>,
): Violacion[] {
  const violaciones: Violacion[] = [];
  const re = new RegExp(String.raw`\b${cliente}\s*\.\s*(\w+)\s*\.\s*${LECTURAS}\s*\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(cuerpo)) !== null) {
    const abre = cuerpo.indexOf("(", m.index + m[0].length - 1);
    let opciones = bloqueBalanceado(cuerpo, abre, "(", ")");
    const porConstante = /select\s*:\s*([A-Z][A-Z0-9_]*)/.exec(opciones);
    if (porConstante !== null) {
      opciones += "\n" + (constantes.get(porConstante[1]) ?? "");
    }
    if (!anidaRelaciones(opciones)) continue;
    violaciones.push({
      archivo,
      linea: numeroDeLinea(fuente, desplazamiento + m.index),
      cliente,
      fragmento: `${m[0]}…`,
    });
  }
  return violaciones;
}

/** `const NOMBRE = { … }` de nivel de modulo, por nombre. */
function constantesDeModulo(fuente: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const re = /\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^={]*)?=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    const abre = fuente.indexOf("{", m.index + m[0].length - 1);
    mapa.set(m[1], bloqueBalanceado(fuente, abre, "{", "}"));
  }
  return mapa;
}

// ── El censo del arbol ────────────────────────────────────────────────────────────────────────

interface Censo {
  archivos: number;
  funcionesConTx: number;
  cuerposDeTransaccion: number;
  violacionesA: Violacion[];
  violacionesB: Violacion[];
  violacionesC: Violacion[];
}

function censar(carpeta: string): Censo {
  const censo: Censo = {
    archivos: 0,
    funcionesConTx: 0,
    cuerposDeTransaccion: 0,
    violacionesA: [],
    violacionesB: [],
    violacionesC: [],
  };
  for (const absoluto of archivosTs(carpeta)) {
    const relativo = path.relative(RAIZ, absoluto).replace(/\\/g, "/");
    const fuente = quitarComentarios(fs.readFileSync(absoluto, "utf8"));
    censo.archivos += 1;
    const constantes = constantesDeModulo(fuente);

    for (const f of funcionesConParametroDeTransaccion(relativo, fuente)) {
      censo.funcionesConTx += 1;
      censo.violacionesA.push(
        ...concurrenciaSobre(f.cuerpo, f.cliente, f.archivo, fuente, f.desplazamiento),
      );
      censo.violacionesC.push(
        ...lecturasConRelacionesAnidadas(
          f.cuerpo,
          f.cliente,
          f.archivo,
          fuente,
          f.desplazamiento,
          constantes,
        ),
      );
    }

    for (const t of cuerposDeTransaccion(relativo, fuente)) {
      censo.cuerposDeTransaccion += 1;
      censo.violacionesB.push(
        ...concurrenciaSobre(t.cuerpo, t.cliente, t.archivo, fuente, t.desplazamiento),
      );
      censo.violacionesC.push(
        ...lecturasConRelacionesAnidadas(
          t.cuerpo,
          t.cliente,
          t.archivo,
          fuente,
          t.desplazamiento,
          constantes,
        ),
      );
    }
  }
  return censo;
}

const CENSO = censar(CARPETA_LIB);

/**
 * CENSO CONGELADO del brazo C: los archivos que HOY contienen una lectura con relaciones anidadas
 * sobre un cliente de transaccion.
 *
 * POR QUE UNA LISTA DE ARCHIVOS Y NO UN INVENTARIO DE 18 ENTRADAS MEDIDAS UNA A UNA. Porque seria
 * mentir: la ficha 450 midio UNO (el de `CierreDiaRepository`, ver abajo) y de los demas solo sabe
 * que comparten la forma. Un inventario con 18 «medido: …» copiados del primero es exactamente la
 * clase de documento que parece evidencia y no lo es. Lo que esta lista SI garantiza, y es lo que
 * la ficha necesita, es que **no aparezca un sitio nuevo sin que alguien lo mire**: cualquier
 * archivo fuera de la lista pone el gate rojo, y cualquiera de la lista que deje de tener la forma
 * obliga a borrarlo de aqui.
 *
 * ⚠️ NO SON 18 DEFECTOS. La forma solo hace dano sobre un cliente de TRANSACCION y cuando el
 * numero de relaciones hermanas llega a tres; con una o dos relaciones no hay aviso, aunque si
 * haya consultas compartiendo conexion. Esta lista es el punto de partida para medirlas, no un
 * veredicto sobre ellas.
 *
 * Sin `.ts` duplicados y en orden alfabetico, para que el diff de una alta sea de una sola linea.
 */
const ARCHIVOS_CON_RELACIONES_ANIDADAS_EN_TX: readonly string[] = [
  "lib/repositories/CierreDiaRepository.ts",
  "lib/repositories/CierresAdminRepository.ts",
  "lib/repositories/CierresBodegaAdminRepository.ts",
  "lib/repositories/IncidenteAdminRepository.ts",
  "lib/repositories/LiquidacionPagoRepository.ts",
  "lib/repositories/LiquidacionRepartoRepository.ts",
  "lib/repositories/OrdenRepository.ts",
  "lib/repositories/RechazoTiendaCobroRepository.ts",
  "lib/repositories/UserRepository.ts",
  "lib/repositories/registrar-accion.ts",
];

/**
 * EL SITIO MEDIDO: el emisor que la caza de la ficha 450 (T2) nombro, con su medicion y con el
 * test que la reproduce. Es la unica entrada de la que esta guardia afirma un numero.
 */
const EMISOR_MEDIDO = {
  archivo: "lib/repositories/CierreDiaRepository.ts",
  que:
    "`crearCierre` congela el snapshot con `SNAPSHOT_SELECT`, que anida 5 relaciones (zona, " +
    "tienda, provincia, canton, distrito). Prisma lo expande a 1+5 consultas y lanza las 5 " +
    "hermanas A LA VEZ sobre la UNICA conexion de la transaccion.",
  medido:
    "2026-09-21, contador de consultas en vuelo contra Postgres real: 5 en vuelo sobre una sola " +
    "conexion, 4 solapes y el aviso de `pg` capturado en un proceso limpio. Cuadra con donde " +
    "produccion lo lee: `crearCierre` es el unico punto por el que pasan /cierre-dia " +
    "(`solicitarCierre`) y /api/cron/corte-diario (`ejecutarCorte`).",
  estado:
    "NOMBRADO y reproducido; la secuenciacion (T2.7) queda pendiente de una decision que la " +
    "implementacion no puede tomar sola — las dos vias posibles, con su coste, estan escritas " +
    "en progress/impl_450.md.",
  medidoPor: "tests/integration/db/emisor-relaciones-anidadas.test.ts",
} as const;

describe("FICHA 450 · guardia: una consulta a la vez sobre un cliente de transaccion", () => {
  describe("anti-vacio del censo (T5.2) — la guardia se sabe LLENA", () => {
    it("el censo recorre `lib/` entero y encuentra archivos", () => {
      // Referencia medida el 2026-09-21: 764 lineas de llamada a Prisma en `lib/`. Si el censo
      // cae a cero, el detector dejo de ver el arbol y todo lo demas es un verde vacio.
      expect(CENSO.archivos).toBeGreaterThan(200);
    });

    it("encuentra las funciones con parametro de cliente de transaccion que se sabe que existen", () => {
      // Referencia medida el 2026-09-21: 276 menciones de `*TxClient`/`Prisma.TransactionClient`
      // en 74 archivos de `lib/` (cero en `app/`). El minimo es deliberadamente conservador: lo
      // que tiene que fallar es el censo VACIO o casi vacio, no un refactor honesto.
      expect(CENSO.funcionesConTx).toBeGreaterThanOrEqual(20);
      console.log(
        `[450] censo: ${CENSO.archivos} archivos · ${CENSO.funcionesConTx} funciones con ` +
          `parametro de transaccion · ${CENSO.cuerposDeTransaccion} cuerpos de \`$transaction\``,
      );
    });

    it("encuentra al menos un cuerpo de `$transaction` (T5.3)", () => {
      expect(CENSO.cuerposDeTransaccion).toBeGreaterThanOrEqual(5);
    });
  });

  describe("BRAZO A (R8) — concurrencia sobre un parametro tipado como cliente de transaccion", () => {
    it("cero violaciones en `lib/`", () => {
      expect(CENSO.violacionesA).toEqual([]);
    });
  });

  describe("BRAZO B (R9) — concurrencia sobre el `tx` inferido de un `$transaction`", () => {
    it("cero violaciones en `lib/`", () => {
      expect(CENSO.violacionesB).toEqual([]);
    });
  });

  describe("BRAZO C (R11) — lecturas con relaciones anidadas sobre un cliente de transaccion", () => {
    it("el censo NO esta vacio: el detector sigue viendo la forma en el arbol", () => {
      // Anti-vacio del propio brazo C. Si esto cae a cero, el detector se rompio y las dos
      // aserciones de abajo pasarian solas.
      expect(CENSO.violacionesC.length).toBeGreaterThanOrEqual(10);
      console.log(
        `[450] brazo C: ${CENSO.violacionesC.length} lecturas con relaciones anidadas sobre un ` +
          `cliente de transaccion, en ${new Set(CENSO.violacionesC.map((v) => v.archivo)).size} archivos`,
      );
    });

    it("ningun archivo NUEVO con lecturas de relaciones anidadas sobre un `tx`", () => {
      const declarados = new Set(ARCHIVOS_CON_RELACIONES_ANIDADAS_EN_TX);
      const sinDeclarar = [
        ...new Set(
          CENSO.violacionesC
            .filter((v) => !declarados.has(v.archivo))
            .map((v) => `${v.archivo}:${v.linea} (${v.fragmento})`),
        ),
      ];
      expect(
        sinDeclarar,
        "lectura con relaciones anidadas sobre un `tx` en un archivo que no estaba en el censo. " +
          "Prisma expande la lectura en 1+N consultas y lanza las N hermanas A LA VEZ sobre la " +
          "UNICA conexion de la transaccion (ficha 450, medido: 5 en vuelo y el aviso de `pg`). " +
          "Miralo antes de darlo por bueno: o lo aplanas, o lo anades al censo sabiendo lo que " +
          "anades.",
      ).toEqual([]);
    });

    it("ningun archivo del censo sobra (el censo no envejece solo)", () => {
      const vistos = new Set(CENSO.violacionesC.map((v) => v.archivo));
      const fantasmas = ARCHIVOS_CON_RELACIONES_ANIDADAS_EN_TX.filter((a) => !vistos.has(a));
      expect(
        fantasmas,
        "estos archivos estan en el censo pero el detector ya no les ve la forma: o se aplanaron " +
          "(entonces borralos de la lista) o el detector se rompio.",
      ).toEqual([]);
    });

    it("el emisor medido esta en el censo, con su medicion y con el test que la reproduce", () => {
      expect(ARCHIVOS_CON_RELACIONES_ANIDADAS_EN_TX).toContain(EMISOR_MEDIDO.archivo);
      expect(CENSO.violacionesC.some((v) => v.archivo === EMISOR_MEDIDO.archivo)).toBe(true);
      expect(EMISOR_MEDIDO.medido).toMatch(/5 en vuelo/);
      expect(fs.existsSync(path.join(RAIZ, EMISOR_MEDIDO.medidoPor))).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // AUTOCOMPROBACION (T5.4, R10) — los detectores se saben romper
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("autocomprobacion: los detectores se ponen rojos ante el codigo que esta ficha retira", () => {
    /** Censa una fuente sintetica sin tocar el disco. */
    function censarFuente(fuente: string): {
      a: Violacion[];
      b: Violacion[];
      c: Violacion[];
      funciones: number;
      transacciones: number;
    } {
      const limpio = quitarComentarios(fuente);
      const constantes = constantesDeModulo(limpio);
      const a: Violacion[] = [];
      const b: Violacion[] = [];
      const c: Violacion[] = [];
      const funciones = funcionesConParametroDeTransaccion("sintetico.ts", limpio);
      const transacciones = cuerposDeTransaccion("sintetico.ts", limpio);
      for (const f of funciones) {
        a.push(...concurrenciaSobre(f.cuerpo, f.cliente, f.archivo, limpio, f.desplazamiento));
        c.push(
          ...lecturasConRelacionesAnidadas(
            f.cuerpo,
            f.cliente,
            f.archivo,
            limpio,
            f.desplazamiento,
            constantes,
          ),
        );
      }
      for (const t of transacciones) {
        b.push(...concurrenciaSobre(t.cuerpo, t.cliente, t.archivo, limpio, t.desplazamiento));
        c.push(
          ...lecturasConRelacionesAnidadas(
            t.cuerpo,
            t.cliente,
            t.archivo,
            limpio,
            t.desplazamiento,
            constantes,
          ),
        );
      }
      return { a, b, c, funciones: funciones.length, transacciones: transacciones.length };
    }

    it("BRAZO A rojo: el cuerpo LITERAL de `construirMovimientosDeIngreso` antes de esta ficha", () => {
      // Copiado tal cual de `lib/services/WalletFeedService.ts` antes de T3.1.
      const antes = `
        export class WalletFeedService {
          async construirMovimientosDeIngreso(
            cierreId: string,
            tx: WalletFeedTxClient,
          ): Promise<CrearMovimientoInput[]> {
            const [byOrden, gestiones] = await Promise.all([
              leerDetallePorOrden(cierreId, tx),
              tx.gestionOrden.findMany({
                where: { cierreId },
                select: { ordenId: true, resultado: true },
              }),
            ]);
            return [];
          }
        }`;
      const r = censarFuente(antes);
      expect(r.funciones).toBe(1);
      expect(r.a).toHaveLength(1);
      expect(r.a[0].cliente).toBe("tx");
    });

    it("BRAZO A rojo tambien con `Prisma.TransactionClient`, `allSettled`, `race` y `any`", () => {
      for (const familia of ["all", "allSettled", "race", "any"]) {
        const fuente = `
          async function leer(tx: Prisma.TransactionClient) {
            return Promise.${familia}([tx.a.findMany(), tx.b.findMany()]);
          }`;
        expect(censarFuente(fuente).a, familia).toHaveLength(1);
      }
    });

    it("BRAZO A VERDE: una sola operacion sobre el `tx` dentro del `Promise.all` no es violacion", () => {
      // Legitimo: una consulta por el `tx` y otra cosa que no toca la base.
      const fuente = `
        async function leer(tx: WalletFeedTxClient, urls: Promesas) {
          return Promise.all([tx.gestionOrden.findMany({}), urls.firmar("a")]);
        }`;
      expect(censarFuente(fuente).a).toEqual([]);
    });

    it("BRAZO B rojo: `Promise.all` sobre el `tx` inferido dentro del `$transaction`", () => {
      const fuente = `
        async function aprobar(prisma: PrismaClient) {
          return prisma.$transaction(async (tx) => {
            const [a, b] = await Promise.all([tx.cierreDia.findMany(), tx.orden.findMany()]);
            return a.length + b.length;
          });
        }`;
      const r = censarFuente(fuente);
      expect(r.transacciones).toBe(1);
      expect(r.b).toHaveLength(1);
      expect(r.b[0].cliente).toBe("tx");
    });

    it("BRAZOS A y B VERDES ante el `Promise.all` sobre el cliente AGRUPADO (copiado del arbol)", () => {
      // `CorteDiarioService.ts:164` y `CierreDiaRepository.ts:1226`, literales. Son CORRECTOS: el
      // pool da una conexion por consulta. Si la guardia los senalara, seria inusable.
      const fuente = `
        class CorteDiarioService {
          async ejecutarCorte() {
            const [enReparto, ayuda, sinGestionar] = await Promise.all([
              this.ordenRepo.findEstatusIdByValue(ESTADO_EN_REPARTO),
              this.ordenRepo.findEstatusIdByValue(ESTADO_AYUDA),
              this.ordenRepo.findEstatusIdByValue(ESTADO_SIN_GESTIONAR),
            ]);
            return enReparto ?? ayuda ?? sinGestionar;
          }
        }
        class CierreDiaRepository {
          async findCierresByMensajeroPaginado(mensajeroId: string, rango: RangoPagina) {
            const where = cierresDeMensajeroWhere(mensajeroId);
            const [rows, total] = await Promise.all([
              this.prisma.cierreDia.findMany({ where, skip: rango.skip, take: rango.take }),
              this.prisma.cierreDia.count({ where }),
            ]);
            return { items: rows, total };
          }
        }`;
      const r = censarFuente(fuente);
      expect(r.a).toEqual([]);
      expect(r.b).toEqual([]);
    });

    it("VERDE ante la MENCION del patron en un comentario", () => {
      const fuente = `
        // Antes esto era: Promise.all([leerDetallePorOrden(cierreId, tx), tx.gestionOrden.findMany()])
        /* y tambien Promise.all([tx.a.findMany(), tx.b.findMany()]) */
        async function leer(tx: WalletFeedTxClient) {
          const byOrden = await leerDetallePorOrden(tx);
          const gestiones = await tx.gestionOrden.findMany({});
          return byOrden ?? gestiones;
        }`;
      const r = censarFuente(fuente);
      expect(r.funciones).toBe(1); // el censo SI la ve: lo que no ve es una violacion
      expect(r.a).toEqual([]);
    });

    it("BRAZO C rojo: el `select` LITERAL con relaciones anidadas dentro de un `$transaction`", () => {
      const fuente = `
        async function congelar(prisma: PrismaClient) {
          return prisma.$transaction(async (tx) => {
            return tx.gestionOrden.findMany({
              where: { cierreId: "c1" },
              select: {
                ordenId: true,
                orden: { select: { zona: { select: { nombre: true } } } },
              },
            });
          });
        }`;
      expect(censarFuente(fuente).c).toHaveLength(1);
    });

    it("BRAZO C rojo tambien cuando el `select` vive en una CONSTANTE del modulo", () => {
      // Es la forma real del emisor: el `select` grande no se escribe en linea.
      const fuente = `
        const SNAPSHOT_SELECT = {
          ordenId: true,
          orden: { select: { zona: { select: { nombre: true, esCentral: true } } } },
        };
        async function congelar(prisma: PrismaClient) {
          return prisma.$transaction(async (tx) => {
            return tx.gestionOrden.findMany({ where: { cierreId: "c1" }, select: SNAPSHOT_SELECT });
          });
        }`;
      expect(censarFuente(fuente).c).toHaveLength(1);
    });

    it("BRAZO C rojo ante un `include` dentro de una funcion con parametro de transaccion", () => {
      const fuente = `
        async function leer(tx: Prisma.TransactionClient) {
          return tx.orden.findMany({ where: { id: "o1" }, include: { zona: true } });
        }`;
      expect(censarFuente(fuente).c).toHaveLength(1);
    });

    it("BRAZO C VERDE: una lectura PLANA sobre el `tx` (ninguna relacion anidada)", () => {
      const fuente = `
        async function leer(tx: WalletFeedTxClient) {
          const detalle = await tx.cierreDetail.findMany({
            where: { cierreId: "c1" },
            select: { ordenId: true, tiendaId: true, montoCobrar: true },
          });
          const gestiones = await tx.gestionOrden.findMany({
            where: { cierreId: "c1" },
            select: { ordenId: true, resultado: true },
          });
          return detalle.length + gestiones.length;
        }`;
      expect(censarFuente(fuente).c).toEqual([]);
    });

    it("BRAZO C VERDE: el MISMO `select` anidado sobre el cliente AGRUPADO", () => {
      // Fuera de una transaccion la expansion reparte las consultas entre conexiones del pool:
      // medido, 3 conexiones y maximo 1 en vuelo. Por eso no se senala.
      const fuente = `
        class Repo {
          async listar() {
            return this.prisma.gestionOrden.findMany({
              select: { ordenId: true, orden: { select: { zona: { select: { nombre: true } } } } },
            });
          }
        }`;
      expect(censarFuente(fuente).c).toEqual([]);
    });
  });
});
