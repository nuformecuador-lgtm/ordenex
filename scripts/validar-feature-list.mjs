// Validaciones de `feature_list.json` para el gate del arnes (`init.sh`).
//
// POR QUE EN NODE Y NO EN jq. Antes esto vivia dentro de `init.sh` colgando de
// `if command -v jq`, y `jq` es OPCIONAL en este repo: su ausencia era un `warn`, no un
// `fail`. En una maquina sin `jq` el bloque ENTERO se saltaba EN SILENCIO y el gate seguia
// en verde, asi que no se comprobaba ni la regla 1 de CLAUDE.md (max 2 `in_progress` por
// zona, marcada como NO NEGOCIABLE) ni la correspondencia ficha<->spec. Un check que no
// corre es peor que uno que no existe, porque crees que te cubre.
//
// `node` SI es requisito duro del arnes (`init.sh` lo comprueba con `fail`), asi que aqui
// las validaciones corren SIEMPRE.
//
// QUE DESTAPO ESTO. La ficha 311 (chat: media y reacciones) se renumero TRES veces
// -294 -> 299 -> 308 -> 311- porque otra sesion tomo cada id mientras se trabajaba. Ninguna
// la detecto el gate: los ids duplicados no se comprobaban NI CON jq. Las tres las cazo una
// lectura humana, y cada una costo renombrar decenas de archivos. Coste medido: ~75 min.
import { readFileSync, existsSync, readdirSync } from "node:fs";

const ARCHIVO = "feature_list.json";
/** Zonas con cupo. Debe coincidir con CLAUDE.md regla 1 y AGENTS.md > Paralelismo. */
const MAX_IN_PROGRESS_POR_ZONA = 2;
/** Estados en los que una ficha `sdd` ya tiene que tener su carpeta de specs escrita. */
const EN_VUELO = ["spec_ready", "in_progress"];

/**
 * Ids repetidos. Es la comprobacion mas barata del arnes y no existia. Dos fichas con el
 * mismo id se mergean sin que nada chille y a partir de ahi el numero deja de identificar
 * nada: los specs, las bitacoras y los mensajes de commit apuntan a dos cosas distintas.
 */
function idsDuplicados(features) {
  const vistos = new Map();
  const errores = [];
  for (const f of features) {
    const id = Number(f.id);
    const previo = vistos.get(id);
    if (previo !== undefined) {
      errores.push(`id ${id} DUPLICADO: "${previo}" y "${f.title}"`);
    } else {
      vistos.set(id, f.title);
    }
  }
  return errores;
}

/** Regla 1 de CLAUDE.md: como mucho 2 features `in_progress` por zona. */
function cupoPorZona(features) {
  const porZona = new Map();
  for (const f of features) {
    if (f.status !== "in_progress" || !f.zone) continue;
    const ids = porZona.get(f.zone) ?? [];
    ids.push(f.id);
    porZona.set(f.zone, ids);
  }
  const errores = [];
  for (const [zona, ids] of porZona) {
    if (ids.length > MAX_IN_PROGRESS_POR_ZONA) {
      errores.push(
        `${zona}: ${ids.join(", ")} (${ids.length} in_progress, max ${MAX_IN_PROGRESS_POR_ZONA})`,
      );
    }
  }
  return errores;
}

/**
 * Toda ficha `sdd` EN VUELO debe tener su carpeta de specs. Se acota a "en vuelo" a
 * proposito: las `done` tempranas (1-16) son previas a la convencion y no tienen carpeta,
 * e incluirlas dejaba el gate permanentemente rojo; `pending`/`cancelled` no la necesitan.
 *
 * La carpeta se resuelve por `spec_path` explicito o, si no, por prefijo `specs/<id>-`
 * (convencion real `<id>-<slug>`). NUNCA por `.name`: ese fue un bug previo, porque el
 * nombre no casa con el slug de la carpeta ("login" vs `specs/1-login`).
 */
function specsPresentes(features) {
  const carpetas = existsSync("specs") ? readdirSync("specs") : [];
  const errores = [];
  for (const f of features) {
    if (f.sdd !== true || !EN_VUELO.includes(f.status)) continue;
    if (f.spec_path && existsSync(`${f.spec_path}/requirements.md`)) continue;
    const prefijo = `${f.id}-`;
    const hallada = carpetas.some(
      (d) => d.startsWith(prefijo) && existsSync(`specs/${d}/requirements.md`),
    );
    if (!hallada) errores.push(`falta la carpeta de specs de la ficha ${f.id} ("${f.title}")`);
  }
  return errores;
}

function main() {
  if (!existsSync(ARCHIVO)) return 0; // repo recien inicializado: nada que validar
  let features;
  try {
    ({ features } = JSON.parse(readFileSync(ARCHIVO, "utf8")));
  } catch (e) {
    console.error(`${ARCHIVO} no es JSON valido: ${e.message}`);
    return 1;
  }
  if (!Array.isArray(features)) {
    console.error(`${ARCHIVO} no tiene un array \`features\``);
    return 1;
  }

  const errores = [
    ...idsDuplicados(features),
    ...cupoPorZona(features),
    ...specsPresentes(features),
  ];
  if (errores.length > 0) {
    for (const e of errores) console.error(`  - ${e}`);
    return 1;
  }

  const enVuelo = features.filter((f) => f.status === "in_progress").length;
  console.log(
    `sin ids duplicados (${features.length} fichas), cupo por zona respetado ` +
      `(in_progress=${enVuelo}) y specs en su sitio`,
  );
  return 0;
}

process.exit(main());
