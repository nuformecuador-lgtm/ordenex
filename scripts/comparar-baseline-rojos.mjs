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
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";

const BASELINE = "tests/baseline-rojos.json";

/** Normaliza a ruta relativa del repo con `/`, que es como se escriben las claves del baseline. */
function aRutaDeRepo(nombre) {
  return relative(process.cwd(), resolve(nombre)).split("\\").join("/");
}

/**
 * Archivos con al menos un caso rojo y archivos EJECUTADOS, segun el reporter `json` de vitest
 * (forma tipo jest).
 *
 * Los ejecutados importan para no dar una falsa alarma: un archivo del baseline que esta
 * corrida NO llego a correr no es un archivo "recuperado", es un archivo del que no sabemos
 * nada. Confundirlos hacia que una corrida parcial pidiera borrar medio baseline.
 */
function clasificar(reporte) {
  const rojos = new Set();
  const ejecutados = new Set();
  for (const suite of reporte.testResults ?? []) {
    const ruta = aRutaDeRepo(suite.name);
    ejecutados.add(ruta);
    if (suite.status === "failed") rojos.add(ruta);
  }
  return { rojos, ejecutados };
}

function main() {
  const rutaReporte = process.argv[2];
  if (!rutaReporte) {
    console.error("uso: node scripts/comparar-baseline-rojos.mjs <reporte-vitest.json>");
    return 2;
  }
  // Sin reporte no se puede afirmar nada. Salir en verde aqui seria el peor desenlace
  // posible: un gate que da por bueno lo que no ha llegado a mirar.
  if (!existsSync(rutaReporte)) {
    console.error(`no existe el reporte de vitest en \`${rutaReporte}\`: la corrida no llego a`);
    console.error("escribirlo (¿se cayo antes de terminar?). No se puede comparar nada.");
    return 1;
  }

  let reporte;
  try {
    reporte = JSON.parse(readFileSync(rutaReporte, "utf8"));
  } catch (e) {
    console.error(`el reporte de vitest no es JSON valido: ${e.message}`);
    return 1;
  }

  const conocidos = existsSync(BASELINE)
    ? new Set(Object.keys(JSON.parse(readFileSync(BASELINE, "utf8")).archivos ?? {}))
    : new Set();
  const { rojos, ejecutados } = clasificar(reporte);

  const nuevos = [...rojos].filter((f) => !conocidos.has(f)).sort();
  // Solo cuenta como "recuperado" lo que ESTA corrida ejecuto y salio verde. Un archivo del
  // baseline que no se llego a correr no dice nada, y tratarlo como recuperado hacia que una
  // corrida parcial pidiera borrar medio baseline.
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
    `sin rojos nuevos (${heredados} archivo(s) rojo(s), todos en el baseline conocido)`,
  );
  return 0;
}

process.exit(main());
