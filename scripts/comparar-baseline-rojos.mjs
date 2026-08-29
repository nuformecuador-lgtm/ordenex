// Compara los rojos de una corrida de vitest contra `tests/baseline-rojos.json`.
//
// EL PROBLEMA QUE RESUELVE. El gate completo son ~11 min y SIEMPRE termina en rojo, porque
// `dev` arrastra deuda ajena. Asi que no contestaba la unica pregunta que existe para
// contestar -- "¿rompi algo?" -- y alguien tenia que comparar A MANO, archivo por archivo,
// contra un numero que viajaba en un mensaje de chat. En la ficha 311 eso ocurrio OCHO veces,
// y una de ellas se concluyo mal: se dio por "rojo heredado" un archivo que en realidad era un
// flake, a partir de una sola observacion. Normalizar un rojo intermitente es como se tapan
// las regresiones de verdad.
//
// LA COMPARACION ES POR ARCHIVO, NO POR CONTEO (decision del humano, 2026-08-28). La suite
// tira 2-5 flakes de saturacion que cambian de sitio entre corridas -- medido: 30, 31 y 32
// rojos sobre el MISMO codigo --, asi que exigir conteos exactos daria falsas alarmas
// constantes, y un gate que grita en falso se ignora.
//
// COSTE ACEPTADO A SABIENDAS: si un archivo YA listado gana un rojo nuevo de verdad, esto no
// lo ve. A cambio, la pregunta que si responde -- "¿aparecio un archivo que antes no fallaba?"
// -- es robusta frente al ruido, que es lo que hace que se pueda confiar en ella.
//
// ACEPTA VARIOS REPORTES (ficha 318, 2026-08-28), y no es un capricho: el modo rapido no es
// UNA corrida de vitest, son DOS -- `--changed origin/dev` y las guardias --, cada una con su
// propio reporte. Los reportes se UNEN antes de decidir: un archivo cuenta como rojo si fallo
// en cualquiera de ellos, y como ejecutado si aparecio en cualquiera de ellos. Hacer una
// llamada por reporte seria peor de dos maneras: cada llamada veria media corrida y trataria
// como "no ejecutado" lo que la otra si corrio, y el veredicto se partiria en dos.
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";

const BASELINE = "tests/baseline-rojos.json";

/** Normaliza a ruta relativa del repo con `/`, que es como se escriben las claves del baseline. */
function aRutaDeRepo(nombre) {
  return relative(process.cwd(), resolve(nombre)).split("\\").join("/");
}

/**
 * Acumula, sobre `rojos` y `ejecutados`, los archivos de UN reporte del reporter `json` de
 * vitest (forma tipo jest).
 *
 * Los ejecutados importan para no dar una falsa alarma: un archivo del baseline que esta
 * corrida NO llego a correr no es un archivo "recuperado", es un archivo del que no sabemos
 * nada. Confundirlos hacia que una corrida parcial pidiera borrar medio baseline.
 */
function acumular(reporte, rojos, ejecutados) {
  for (const suite of reporte.testResults ?? []) {
    const ruta = aRutaDeRepo(suite.name);
    ejecutados.add(ruta);
    if (suite.status === "failed") rojos.add(ruta);
  }
}

/** Lee un reporte de vitest. Devuelve `null` y explica por STDERR si no se puede usar. */
function leerReporte(ruta) {
  // Sin reporte no se puede afirmar nada. Salir en verde aqui seria el peor desenlace
  // posible: un gate que da por bueno lo que no ha llegado a mirar. Y ojo: vitest SI escribe
  // el reporte cuando no selecciona ni un archivo (medido: `testResults: []`), asi que un
  // reporte ausente significa que la corrida se cayo, no que no habia nada que correr.
  if (!existsSync(ruta)) {
    console.error(`no existe el reporte de vitest en \`${ruta}\`: la corrida no llego a`);
    console.error("escribirlo (¿se cayo antes de terminar?). No se puede comparar nada.");
    return null;
  }
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch (e) {
    console.error(`el reporte de vitest \`${ruta}\` no es JSON valido: ${e.message}`);
    return null;
  }
}

function main() {
  const rutasReporte = process.argv.slice(2);
  if (rutasReporte.length === 0) {
    console.error("uso: node scripts/comparar-baseline-rojos.mjs <reporte-vitest.json>...");
    return 2;
  }

  const rojos = new Set();
  const ejecutados = new Set();
  for (const ruta of rutasReporte) {
    const reporte = leerReporte(ruta);
    if (reporte === null) return 1;
    acumular(reporte, rojos, ejecutados);
  }

  const conocidos = existsSync(BASELINE)
    ? new Set(Object.keys(JSON.parse(readFileSync(BASELINE, "utf8")).archivos ?? {}))
    : new Set();

  const nuevos = [...rojos].filter((f) => !conocidos.has(f)).sort();
  // Solo cuenta como "recuperado" lo que ESTA corrida ejecuto y salio verde. Un archivo del
  // baseline que no se llego a correr no dice nada, y tratarlo como recuperado hacia que una
  // corrida parcial pidiera borrar medio baseline. Con el modo rapido eso dejo de ser un caso
  // raro y paso a ser LO NORMAL: ahi solo corren las guardias y lo que toca tu diff, asi que
  // casi todo el baseline queda sin ejecutar en cada corrida.
  const recuperados = [...conocidos].filter((f) => ejecutados.has(f) && !rojos.has(f)).sort();

  // Un archivo del baseline que vuelve a verde NO es un fallo: es una buena noticia. Pero se
  // avisa siempre, porque si nadie lo borra la lista se fosiliza y deja de proteger.
  if (recuperados.length > 0) {
    console.log(
      `  ${recuperados.length} archivo(s) del baseline ya NO fallan. Borralos de ` +
        `${BASELINE} en este mismo PR:`,
    );
    for (const f of recuperados) console.log(`    - ${f}`);
  }

  if (nuevos.length > 0) {
    console.error(`ROJOS NUEVOS (${nuevos.length} archivo(s) que no estan en el baseline):`);
    for (const f of nuevos) console.error(`  - ${f}`);
    console.error("");
    console.error("Si es tuyo, arreglalo. Si de verdad es deuda ajena y esta MEDIDA, anadelo a");
    console.error(`${BASELINE} CON SU MOTIVO -- nunca solo para pasar el gate.`);
    console.error("Y antes de darlo por ajeno, corre ese archivo AISLADO: los flakes de");
    console.error("saturacion pasan solos y no son deuda de nadie.");
    return 1;
  }

  const heredados = rojos.size;
  console.log(
    `sin rojos nuevos (${heredados} archivo(s) rojo(s) sobre ${ejecutados.size} ejecutado(s), ` +
      "todos en el baseline conocido)",
  );
  return 0;
}

process.exit(main());
