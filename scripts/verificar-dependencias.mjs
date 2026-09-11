// Comprueba que TODAS las dependencias declaradas en `package.json` estan de verdad en el arbol.
//
// EL DEFECTO QUE CIERRA (ficha 420, medido el 2026-09-11). El paso 2 de `init.sh` preguntaba si
// existia el DIRECTORIO `node_modules` y, si existia, imprimia `✓ dependencias presentes` sin
// haber abierto `package.json`. Esa condicion es verdadera en cuanto se ha instalado UNA vez,
// para siempre. Tras mergear la ficha 410 -que anade `web-push` y `@types/web-push`- el gate
// completo sobre `dev` dio ese visto bueno EN VERDE y dos pasos mas tarde:
//
//     lib/push/web-push-sender.ts(11,21): error TS2307: Cannot find module 'web-push'
//
// Parecia un error de codigo y era un `pnpm install` que faltaba: se arreglo en 1,3 s. Es la
// familia de fallo que este repo persigue -el sistema no falla, APARENTA-, y engana en la peor
// direccion: afirma que algo esta bien justo en el paso que existe para avisarte de lo contrario.
//
// Y EL AGUJERO ERA MAS GRANDE DE LO QUE PARECIA. Medido tambien el 2026-09-11: si falta SOLO el
// paquete de runtime (`node_modules/web-push`) y siguen estando sus tipos
// (`node_modules/@types/web-push`), el TYPECHECK PASA EN VERDE -TypeScript resuelve las
// declaraciones desde `@types/`- y el fallo sale en EJECUCION. O sea que el typecheck no es red
// de seguridad de esto: solo lo caza cuando faltan los dos. Este paso es estrictamente mas fuerte.
//
// POR QUE NO SE INSTALA Y YA (alternativa A1, descartada CON medicion; ver
// `specs/420-gate-dependencias-presentes/design.md`). `pnpm install --frozen-lockfile` es
// idempotente y cuesta 1,6-1,8 s sobre arbol completo (3 corridas medidas), asi que el precio no
// era el problema. Se descarto porque REPARA en silencio: el paso saldria verde y nadie llegaria
// a enterarse de que el arbol estaba mal -cambiar un fallo mudo por otro mas callado todavia-. Y
// porque un paso que MIDE no debe ESCRIBIR en lo medido: el gate corre en el worktree de cada
// agente, sobre un arbol que otros pasos preparan.
//
// SOLO `node:fs` Y `node:path`: ni un import de `node_modules`, ni `child_process`, ni red. Un
// verificador de dependencias que necesita una dependencia para arrancar se cae justo el dia que
// tiene que hablar.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Secciones que se exigen presentes. `optionalDependencies` queda FUERA por definicion: puede
 * faltar legitimamente (por eso es opcional), y exigirla daria rojos falsos, que es lo peor que
 * puede hacer un gate.
 */
const SECCIONES_EXIGIDAS = ["dependencies", "devDependencies"];

/** El comando exacto de reparacion. Va en el mensaje de error a proposito: lo caro de este fallo
 *  nunca fue arreglarlo -1,3 s medidos en el incidente- sino averiguar que era. */
const COMANDO_DE_REPARACION = "pnpm install --frozen-lockfile";

/**
 * Nombres declarados en `package.json`, en orden de aparicion y sin repetir.
 * @param {string} raiz
 * @returns {string[]}
 */
function dependenciasDeclaradas(raiz) {
  const manifiesto = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
  const nombres = [];
  for (const seccion of SECCIONES_EXIGIDAS) {
    for (const nombre of Object.keys(manifiesto[seccion] ?? {})) {
      if (!nombres.includes(nombre)) nombres.push(nombre);
    }
  }
  return nombres;
}

/**
 * Un paquete cuenta como presente cuando su MANIFIESTO se puede leer, no cuando su carpeta
 * existe. En pnpm `node_modules/<nombre>` es un ENLACE SIMBOLICO al store virtual
 * (`node_modules/.pnpm/...`), y un enlace roto -un store purgado a medias, un worktree copiado-
 * es justo el caso que hay que cazar: supera una comprobacion de existencia del directorio en
 * algunos escenarios y no supera la lectura del manifiesto, que es lo que hace el resolvedor de
 * Node y el de TypeScript.
 * @param {string} raiz
 * @param {string} nombre
 */
function estaPresente(raiz, nombre) {
  try {
    const manifiesto = JSON.parse(
      readFileSync(join(raiz, "node_modules", nombre, "package.json"), "utf8"),
    );
    return typeof manifiesto?.name === "string";
  } catch {
    return false;
  }
}

/**
 * @param {string} raiz
 * @returns {{ declaradas: number, faltantes: string[], sinArbol: boolean }}
 */
function verificar(raiz) {
  const declaradas = dependenciasDeclaradas(raiz);
  const faltantes = declaradas.filter((nombre) => !estaPresente(raiz, nombre));
  // "No hay arbol" y "faltan paquetes" no son el mismo diagnostico y no merecen el mismo mensaje:
  // listar 58 ausencias cuando lo que pasa es que nadie ha instalado nunca es ruido que tapa el
  // titular. `init.sh` distingue los dos casos: el arbol vacio lo INSTALA (es un arranque), el
  // arbol incompleto lo REPORTA (es una discrepancia que alguien debe ver).
  //
  // SE MIRA EL DISCO, NO SE DEDUCE DE QUE FALTEN TODAS. La primera version decia "sin arbol"
  // cuando `faltantes.length === declaradas.length`, y eso miente en el caso de un repo con UNA
  // sola dependencia declarada: si esa una falta, el arbol existe y el mensaje aseguraba que no.
  // Un diagnostico deducido se equivoca justo en los arboles mas pequenos, que son los de prueba.
  const sinArbol = !existsSync(join(raiz, "node_modules"));
  return { declaradas: declaradas.length, faltantes, sinArbol };
}

/**
 * Las lineas del veredicto. Se devuelven en vez de imprimirse para que los tests puedan
 * afirmar sobre el TEXTO -que un rojo nombre el paquete es un requisito (R2), no un adorno-.
 * @param {{ declaradas: number, faltantes: string[], sinArbol: boolean }} resultado
 * @returns {{ ok: boolean, salida: string[] }}
 */
function veredicto(resultado) {
  if (resultado.faltantes.length === 0) {
    return { ok: true, salida: [`${resultado.declaradas} declaradas, todas presentes`] };
  }
  const salida = [];
  if (resultado.sinArbol) {
    salida.push(
      `node_modules no tiene NINGUNA de las ${resultado.declaradas} dependencias declaradas: el arbol esta sin instalar.`,
    );
  } else {
    const verbo = resultado.faltantes.length === 1 ? "falta" : "faltan";
    salida.push(
      `${verbo} ${resultado.faltantes.length} de las ${resultado.declaradas} dependencias declaradas en package.json:`,
    );
    for (const nombre of resultado.faltantes) salida.push(`    - ${nombre}`);
  }
  salida.push(`  Reparalo con: ${COMANDO_DE_REPARACION}`);
  salida.push("  (medido el 2026-09-11: ~1,7 s sobre un arbol ya instalado)");
  return { ok: false, salida };
}

// Punto de entrada del gate. El argumento -la raiz a comprobar- existe PARA LOS TESTS: sin el, la
// unica forma de probar el caso rojo seria romper el arbol real de quien corre la suite.
//
// NADA SE EXPORTA, A PROPOSITO. Este archivo se EJECUTA; importarlo correria la comprobacion como
// efecto de importar y podria dejar `process.exitCode = 1` puesto en el proceso de vitest, que es
// como se fabrica una suite roja sin un solo test rojo. Los tests lo lanzan con `node`, que ademas
// es exactamente lo que hace `init.sh`: se prueba la cosa, no una copia de la cosa.
const raiz = process.argv[2] ?? process.cwd();
const resultado = verificar(raiz);
const { ok, salida } = veredicto(resultado);

// Mismo reparto que `validar-feature-list.mjs` y `comparar-baseline-rojos.mjs`: el detalle del
// rojo va a STDERR (que ya se ve en la consola del gate) y el resumen del verde a STDOUT, que es
// lo que `init.sh` captura con `$(...)` para pegarlo en su propia linea.
if (ok) {
  console.log(salida.join("\n"));
} else {
  console.error(salida.join("\n"));
  process.exitCode = 1;
}
