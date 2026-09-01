import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { openApiSpec } from "@/lib/api/openapi-spec";
import { CAUSA_DEVOLUCION_SEED } from "@/lib/types/causa-devolucion";
import { CAUSA_INCIDENTE_SEED } from "@/lib/types/causa-incidente";
import { EVENTOS_PUBLICOS } from "@/lib/types/webhook-eventos";

// Feature 256/R24 — el evento saliente `orden.estado_actualizado` ESTA PUBLICADO en el contrato.
//
// Este test es AFIRMATIVO, no de no-regresion: las dos guardias hermanas
// (`openapi-contrato-en-reparto.test.ts`, `openapi-177-paths-pdf-y-carga-id.test.ts`) pasarian
// igual si la seccion `webhooks` no existiera. Aqui se afirma que existe, donde vive, que forma
// tiene y que el `.yaml` publicado la refleja con la misma estructura.
//
// ⏳ 2026-08-22 (FEATURE 268/R18/R28/R29) — ESTA GUARDIA SE ACTUALIZA, NO SE RELAJA NI SE BORRA.
// Cuatro de sus asertos se pusieron rojos a proposito porque la 268 AMPLIA el contrato que la 256
// congelo. Cada uno se reescribe abajo conservando el razonamiento de la 256 y anotando al lado
// que cambio y por que (patron «AQUI DECIA X, y ya no es cierto»). La alternativa A6 del design
// 268 —degradarlos a un aserto de tamaño— esta DESCARTADA por escrito: un `size` no detecta un
// intercambio (un value entra y otro sale) y convierte la puerta humana en un contador. Donde
// aparece un `toHaveLength` aqui es ACOMPAÑANDO a una igualdad de contenido, nunca en su lugar.
//
// ⏳ AQUI DECIA (feature 256), y ya no es cierto: «Ojo con el punto de `data.estado` SIN `enum`:
// no es un detalle de estilo. Enumerar el catalogo de estados aqui añadiria un 5.º bloque y
// pondria ROJA `openapi-contrato-en-reparto.test.ts`, que exige exactamente 4 (design 256 §5.2)».
// El design 268 §7.5 declara ese miedo INFUNDADO y lo revierte a proposito: la guardia hermana no
// cuenta «enums», cuenta enums DE ESTADO con el predicado `esEnumDeEstado`, que exige `entregada`
// **Y** `por_recoger`. El enum que la 268 documenta se DERIVA de `EVENTOS_PUBLICOS` (12 values,
// R29) y NO contiene `por_recoger`, asi que no entra en el recuento y los bloques siguen siendo
// CUATRO (R28). Lo que sigue protegido —y por eso el bucle se INVIERTE en su criterio en vez de
// borrarse— es que `webhooks` no introduzca un 5.º catalogo de ESTADOS.

const YAML_PATH = path.join(__dirname, "..", "..", "..", "docs", "api", "api-key-openapi.yaml");
const yamlTexto = fs.readFileSync(YAML_PATH, "utf8");

const EVENTO = "orden.estado_actualizado";
/** Nombre del schema que publica la FORMA del cuerpo del evento, desde el 2026-09-01. */
const NOMBRE_SCHEMA = "WebhookOrdenEstadoActualizado";

// ---------------------------------------------------------------------------------------------
// Parseo del .yaml. js-yaml NO es resoluble desde la raiz del proyecto (vive solo en el store
// oculto de pnpm), y el resto de los tests de openapi leen el archivo como TEXTO. Se mantiene ese
// molde y se parsea SOLO el bloque `webhooks:` con un lector del subconjunto YAML que ese bloque
// usa: mapas, secuencias, escalares planos/entrecomillados y bloques `|-`. Cualquier construccion
// fuera de ese subconjunto lanza en vez de devolver un objeto a medias.
// ---------------------------------------------------------------------------------------------

const RE_CLAVE = /^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_./$-]+):(?:\s+(.*))?$/;

function sangria(linea: string): number {
  return linea.length - linea.trimStart().length;
}

function esIgnorable(linea: string): boolean {
  return linea.trim() === "" || linea.trimStart().startsWith("#");
}

function escalar(crudo: string): unknown {
  const s = crudo.trim();
  if (s.startsWith('"')) return JSON.parse(s) as string;
  if (s === "[]") return [];
  if (s === "{}") return {};
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

/** Lee un escalar de bloque (`|-` / `|`) que empieza en `i`. Devuelve el texto y el indice siguiente. */
function leerBloque(lineas: string[], i: number, indClave: number, strip: boolean): [string, number] {
  const crudas: string[] = [];
  while (i < lineas.length) {
    const linea = lineas[i];
    if (linea.trim() === "") {
      crudas.push("");
      i++;
      continue;
    }
    if (sangria(linea) <= indClave) break;
    crudas.push(linea);
    i++;
  }
  while (crudas.length > 0 && crudas[crudas.length - 1] === "") crudas.pop();
  const utiles = crudas.filter((l) => l !== "");
  const base = utiles.length > 0 ? Math.min(...utiles.map(sangria)) : 0;
  const texto = crudas.map((l) => (l === "" ? "" : l.slice(base))).join("\n");
  return [strip ? texto : `${texto}\n`, i];
}

function parseNodo(lineas: string[], i: number, ind: number): [unknown, number] {
  if (lineas[i].trimStart().startsWith("- ")) {
    const arr: unknown[] = [];
    while (i < lineas.length) {
      const linea = lineas[i];
      if (esIgnorable(linea)) {
        i++;
        continue;
      }
      if (sangria(linea) !== ind || !linea.trimStart().startsWith("- ")) break;
      const resto = linea.trimStart().slice(2).trim();
      if (RE_CLAVE.test(resto)) {
        const hijoInd = ind + 2;
        const sub = [" ".repeat(hijoInd) + resto, ...lineas.slice(i + 1)];
        const [valor, consumidas] = parseNodo(sub, 0, hijoInd);
        arr.push(valor);
        i += consumidas;
      } else {
        arr.push(escalar(resto));
        i++;
      }
    }
    return [arr, i];
  }

  const mapa: Record<string, unknown> = {};
  while (i < lineas.length) {
    const linea = lineas[i];
    if (esIgnorable(linea)) {
      i++;
      continue;
    }
    const actual = sangria(linea);
    if (actual < ind) break;
    if (actual > ind) throw new Error(`sangria inesperada en el .yaml: ${linea}`);
    const m = RE_CLAVE.exec(linea.trim());
    if (!m) throw new Error(`linea del .yaml no reconocida: ${linea}`);
    const clave = m[1].startsWith('"') ? (JSON.parse(m[1]) as string) : m[1];
    const resto = (m[2] ?? "").trim();
    i++;
    if (resto === "|-" || resto === "|") {
      const [texto, j] = leerBloque(lineas, i, ind, resto === "|-");
      mapa[clave] = texto;
      i = j;
    } else if (resto === "") {
      let j = i;
      while (j < lineas.length && esIgnorable(lineas[j])) j++;
      if (j >= lineas.length || sangria(lineas[j]) <= ind) {
        mapa[clave] = null;
      } else {
        const [valor, k] = parseNodo(lineas, j, sangria(lineas[j]));
        mapa[clave] = valor;
        i = k;
      }
    } else {
      mapa[clave] = escalar(resto);
    }
  }
  return [mapa, i];
}

/**
 * ⏳ 2026-09-01 — el evento dejo de publicarse como seccion `webhooks:` de NIVEL SUPERIOR. Esa
 * seccion Swagger UI la pinta como un endpoint mas, y este evento no es algo que el integrador
 * LLAME: lo entrega Ordenex a su callback. Se publica ahora solo la FORMA del cuerpo, como el
 * schema `WebhookOrdenEstadoActualizado` de `components.schemas`. Este lector lo aisla del .yaml
 * y lo parsea con el MISMO subconjunto de YAML de antes.
 */
function schemaWebhookDelYaml(): Record<string, unknown> {
  const lineas = yamlTexto.split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l === `    ${NOMBRE_SCHEMA}:`);
  if (inicio === -1) throw new Error(`el .yaml no declara el schema ${NOMBRE_SCHEMA}`);
  const bloque: string[] = [];
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (lineas[i].trim() !== "" && sangria(lineas[i]) <= 4) break;
    bloque.push(lineas[i]);
  }
  const primera = bloque.findIndex((l) => !esIgnorable(l));
  if (primera === -1) throw new Error(`el schema ${NOMBRE_SCHEMA} del .yaml esta vacio`);
  const [nodo] = parseNodo(bloque, primera, sangria(bloque[primera]));
  return nodo as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Accesos al objeto TS (fuente de verdad) y a su espejo publicado.
// ---------------------------------------------------------------------------------------------

const bodySchemaTs = openApiSpec.components.schemas[NOMBRE_SCHEMA];
const dataTs = bodySchemaTs.properties.data;
const schemaYaml = schemaWebhookDelYaml();

/** Navega un objeto plano parseado del .yaml, lanzando si el camino no existe. */
function porCamino(raiz: unknown, ...camino: string[]): Record<string, unknown> {
  let actual: unknown = raiz;
  for (const paso of camino) {
    if (actual === null || typeof actual !== "object") {
      throw new Error(`el .yaml no tiene el camino ${camino.join(" > ")} (corta en ${paso})`);
    }
    actual = (actual as Record<string, unknown>)[paso];
  }
  if (actual === null || typeof actual !== "object") {
    throw new Error(`el .yaml no tiene el camino ${camino.join(" > ")}`);
  }
  return actual as Record<string, unknown>;
}

const dataYaml = porCamino(schemaYaml, "properties", "data");

/** Recolecta todos los arrays `enum` de un subarbol del contrato. */
function todosLosEnums(nodo: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(nodo)) {
    for (const item of nodo) todosLosEnums(item, out);
    return out;
  }
  if (nodo && typeof nodo === "object") {
    for (const [clave, valor] of Object.entries(nodo as Record<string, unknown>)) {
      if (clave === "enum" && Array.isArray(valor)) out.push(valor);
      todosLosEnums(valor, out);
    }
  }
  return out;
}

/**
 * ¿Es este `enum` el catalogo de ESTADOS de orden? Se exige `entregada` Y `por_recoger`, igual
 * que `enum: ["entregada", "rechazada"]` (resultado de gestion) tambien cita `entregada` y NO es
 * el catalogo de estados.
 *
 * DUPLICADO A PROPOSITO de `tests/unit/api/openapi-contrato-en-reparto.test.ts`, donde el
 * predicado es privado (no exportado) y donde debe seguir siendolo: ese archivo es la guardia
 * que CUENTA los cuatro bloques, y exportar su criterio para reusarlo desde aqui acoplaria las
 * dos guardias de modo que un cambio en una moviera la otra en silencio. La copia es de tres
 * lineas y su divergencia se nota: si alguien cambia el criterio alli sin cambiarlo aqui, este
 * archivo dejaria de proteger exactamente lo que el otro cuenta, y eso es justo el escenario que
 * el bucle de abajo vigila.
 */
function esEnumDeEstado(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string") &&
    (value as string[]).includes("entregada") &&
    (value as string[]).includes("por_recoger")
  );
}

describe("256/R24 — el webhook orden.estado_actualizado esta publicado en el contrato", () => {
  // ⏳ 2026-09-01 — AQUI se exigia lo contrario de lo que se exige ahora, y el cambio es
  // DELIBERADO: el evento se publicaba como seccion `webhooks:` de nivel superior (256/R24) y hoy
  // se publica SOLO como el schema `WebhookOrdenEstadoActualizado`. Motivo: Swagger UI pinta la
  // seccion `webhooks` como un endpoint mas, y este evento no es algo que el integrador LLAME —lo
  // entrega Ordenex a su callback—. Lo que se conserva es lo que el integrador necesita tipar: la
  // FORMA del cuerpo. Lo que se pierde, y conviene que conste, son las dos cabeceras de firma
  // (`X-Ordenex-Signature`, `X-Ordenex-Timestamp`), que ya no estan declaradas en ninguna parte
  // del contrato.
  it("2026-09-01: el evento se publica como SCHEMA, y no como operacion ni como ruta", () => {
    // TS: existe el schema, y NO existe la seccion `webhooks`.
    expect(Object.keys(openApiSpec.components.schemas)).toContain(NOMBRE_SCHEMA);
    expect(Object.keys(openApiSpec)).not.toContain("webhooks");
    // Y el nombre del evento no se ha colado en `paths` por la puerta de atras.
    expect(Object.keys(openApiSpec.paths)).not.toContain(EVENTO);
    expect(JSON.stringify(openApiSpec.paths)).not.toContain(EVENTO);

    // .yaml: el espejo dice lo mismo. `webhooks:` empezaba en la columna 0; ya no esta.
    expect(yamlTexto).not.toMatch(/^webhooks:$/m);
    expect(yamlTexto).toContain(`    ${NOMBRE_SCHEMA}:`);
    // El `const` del schema conserva el nombre del evento: es lo que identifica el cuerpo.
    expect(porCamino(schemaYaml, "properties", "evento").const).toBe(EVENTO);
    expect(bodySchemaTs.properties.evento.const).toBe(EVENTO);
  });

  it("256/R24 + 268/R24: el schema de `data` tiene EXACTAMENTE cinco claves y las required siguen siendo las MISMAS cuatro", () => {
    // ⏳ 2026-08-22 — AQUI DECIA (feature 256), y ya no es cierto: «el schema de `data` tiene
    // EXACTAMENTE numGuia, numRemision, estado, motivo, y las cuatro son required». La 268/R24
    // añade una QUINTA propiedad, `evidenciasUrl`.
    //
    // Lo que la 256 fijaba —la «forma UNICA: las cuatro claves SIEMPRE presentes», para que el
    // consumidor no ramifique por estado para saber si existen— SE CONSERVA INTACTO: esas cuatro
    // siguen siendo exactamente las de `required`. `evidenciasUrl` es la UNICA opcional, nace
    // ADITIVA y se OMITE salvo en los eventos de `incidente`, asi que ningun consumidor escrito
    // contra el contrato de la 256 se rompe. Por eso el aserto no se relaja a un tamaño: se parte
    // en dos igualdades de contenido, una por cada mitad de la afirmacion.
    const CINCO = ["numGuia", "numRemision", "estado", "motivo", "evidenciasUrl"];
    const CUATRO_REQUIRED = ["numGuia", "numRemision", "estado", "motivo"];

    // (1) Las CINCO propiedades, en el orden real del objeto. Un intercambio se ve.
    expect(Object.keys(dataTs.properties)).toEqual(CINCO);
    expect(Object.keys(porCamino(dataYaml, "properties"))).toEqual(CINCO);

    // (2) `required` sigue siendo el CUATRO de la 256: `evidenciasUrl` esta FUERA, las otras DENTRO.
    expect(dataTs.required).toEqual(CUATRO_REQUIRED);
    expect(dataYaml.required as string[]).toEqual(CUATRO_REQUIRED);
    for (const required of [dataTs.required as readonly string[], dataYaml.required as string[]]) {
      expect(required).not.toContain("evidenciasUrl");
    }
  });

  it("256/R24 + 268/R20: el `enum` de `motivo` son los SEIS values de los DOS SEED de causa (mas null)", () => {
    // ⏳ 2026-08-22 — AQUI DECIA (feature 256), y ya no es cierto: «el `enum` de `motivo` son los
    // tres values de CAUSA_DEVOLUCION_SEED (mas null)». La 268/R20 hace que `data.motivo`
    // transporte las causas de las DOS transiciones tipificadas, no de una: la devolucion (73) y
    // el incidente (158). Son SEIS values + `null`.
    //
    // Lo que la 256 fijaba se conserva y se extiende: el enum se DERIVA de los SEED importados y
    // NUNCA se copia como literal, para que un cuarto value de CUALQUIERA de los dos catalogos
    // ponga esto rojo y obligue a pasar por aqui.
    //
    // ⚠️ La ASIMETRIA DE IDIOMA es decision consciente y firmada (73/F1.4-g y 158/Q-B), no un
    // error que corregir: las causas de devolucion van en INGLES y las de incidente en ESPAÑOL
    // (`danado` sin eñe, `perdido`, `robado`). Cada enum se publico con el value crudo de su
    // catalogo interno y renombrar cualquiera romperia a los integradores que ya lo consumen. El
    // ultimo aserto de este bloque existe para que un «arreglo de consistencia» se estrelle aqui.
    const ESPERADO = [...CAUSA_DEVOLUCION_SEED, ...CAUSA_INCIDENTE_SEED, null];

    const enumTs: readonly unknown[] = dataTs.properties.motivo.enum;
    const enumYaml = porCamino(dataYaml, "properties", "motivo").enum as unknown[];

    for (const lista of [enumTs, enumYaml]) {
      // Igualdad de CONTENIDO y de ORDEN, derivada de los dos SEED. El `toHaveLength` viene
      // DESPUES y solo acompaña: no sustituye a la igualdad (design 268 §8, A6 descartada).
      expect(lista).toEqual(ESPERADO);
      // `null` esta escrito en el enum: es un value legitimo del campo, no una omision.
      expect(lista).toContain(null);
      expect(lista).toHaveLength(
        CAUSA_DEVOLUCION_SEED.length + CAUSA_INCIDENTE_SEED.length + 1,
      );
      // Ninguna causa de incidente viaja TRADUCIDA al ingles (158/Q-B): el value es el crudo.
      for (const traduccion of ["damaged", "lost", "stolen"]) {
        expect(lista).not.toContain(traduccion);
      }
    }

    // El tipo acompaña: string|null, nunca solo string.
    expect(dataTs.properties.motivo.type).toEqual(["string", "null"]);
    expect(porCamino(dataYaml, "properties", "motivo").type).toEqual(["string", "null"]);
  });

  it("268/R29: `estado` se documenta CON el `enum` derivado de EVENTOS_PUBLICOS, y `webhooks` NO introduce un 5.º catalogo de estados", () => {
    // ⏳ 2026-08-22 — AQUI DECIA (feature 256), y ya no es cierto: «`estado` se documenta SIN
    // `enum` (design §5.2: un 5.º catalogo pondria roja openapi-contrato-en-reparto)». El design
    // 268 §7.5 declara esa creencia INFUNDADA y la revierte a proposito.
    //
    // Por que era infundada: `openapi-contrato-en-reparto.test.ts` no cuenta enums, cuenta enums
    // DE ESTADO con `esEnumDeEstado`, que exige `entregada` **Y** `por_recoger`. El enum del
    // webhook son los 12 values PUBLICOS de `EVENTOS_PUBLICOS`, que es un SUBCONJUNTO del
    // catalogo y NO contiene `por_recoger` (es uno de los internos que el webhook jamas emite),
    // asi que no entra en el recuento y los cuatro bloques SIGUEN SIENDO CUATRO (R28). Documentar
    // el catalogo ENTERO es lo que si habria añadido un quinto bloque y provocado churn en un
    // guard que protege otra cosa; no documentar nada, en cambio, dejaba al integrador sin saber
    // que values puede recibir.
    //
    // Y por eso el bucle de la 256 NO se borra: se INVIERTE EN SU CRITERIO. Lo que sigue habiendo
    // que proteger es que la seccion `webhooks` no introduzca un 5.º catalogo de ESTADOS, y eso
    // se afirma con el MISMO predicado que usa el guard hermano para contar.
    const estadoTs: Record<string, unknown> = dataTs.properties.estado;
    const estadoYaml = porCamino(dataYaml, "properties", "estado");

    // (1) El enum existe y se DERIVA de la politica, no se copia: si `EVENTOS_PUBLICOS` gana o
    //     pierde un value, esto se pone rojo en el TS y en el YAML a la vez.
    const ESPERADO = [...EVENTOS_PUBLICOS].sort();
    expect(estadoTs.enum).toEqual(ESPERADO);
    expect(estadoYaml.enum).toEqual(ESPERADO);
    expect(estadoTs.type).toBe("string");
    expect(estadoYaml.type).toBe("string");

    // (2) Ese enum es un SUBCONJUNTO del catalogo: no trae `por_recoger` ni los otros internos.
    //
    // ⏳ 2026-08-31 — `en_preparacion` SALE de la lista de ausentes y pasa a la de presentes: desde
    // el parche de hoy SI se emite, como evento de NACIMIENTO de la rama de fulfillment. El aserto
    // se INVIERTE en vez de borrarse, para que el subconjunto siga estando afirmado en las dos
    // direcciones. Los tres internos de ruteo satelite siguen ausentes.
    for (const lista of [estadoTs.enum as string[], estadoYaml.enum as string[]]) {
      expect(lista).toContain("entregada");
      expect(lista).toContain("en_preparacion");
      expect(lista).not.toContain("por_recoger");
      expect(lista).not.toContain("en_bodega_satelite");
      expect(lista).not.toContain("en_ruta_bodega_satelite");
    }

    // (3) NINGUN enum del subarbol `webhooks` es el catalogo de ESTADOS. Este es el bucle de la
    //     256 con el criterio invertido: ya no prohibe `entregada`, prohibe ser un 5.º catalogo.
    for (const lista of [...todosLosEnums(bodySchemaTs), ...todosLosEnums(schemaYaml)]) {
      expect(esEnumDeEstado(lista)).toBe(false);
    }

    // La prosa sigue remitiendo al catalogo publicado en vez de repetirlo.
    expect(estadoTs.description).toContain("OrdenListItem.estado");
  });

  it("256/R24 (+R15): la prosa de `motivo` documenta el caso `null` y que la causa es la VIGENTE al entregar", () => {
    const descripcionTs: string = dataTs.properties.motivo.description;
    const descripcionYaml = porCamino(dataYaml, "properties", "motivo").description as string;

    // ⏳ 2026-08-22 — AQUI DECIA (feature 256) `expect(descripcion).toContain("`devuelta` sin
    // causa registrada")`, y ese literal ya no aparece: la prosa de la 268 dice «una `devuelta`
    // (o un `incidente`) sin causa registrada», porque el campo transporta ahora DOS enums.
    //
    // Se actualiza EL ASERTO, no la prosa. Retocar el texto del OpenAPI para que encaje con este
    // `toContain` seria exactamente el «cumplir criterios de grep» que la cabecera de `tasks.md`
    // prohibe: el contrato publicado no se escribe para satisfacer a su test. Y como el caso
    // `null` tiene ahora DOS ramas, el aserto cubre las dos por separado en vez de una.
    for (const descripcion of [descripcionTs, descripcionYaml]) {
      // Rama A: el estado no es NINGUNO de los dos tipificados -> `null`.
      expect(descripcion).toContain(
        "Es `null` en todo evento cuyo `estado` NO sea `devuelta` ni `incidente`",
      );
      // Rama B: el estado SI es uno de los dos, pero no hay causa registrada -> `null` igual.
      expect(descripcion).toContain("una `devuelta` (o un `incidente`) sin causa registrada");
      // En las dos ramas la clave viaja: `null` es un value, no una omision.
      expect(descripcion).toContain("el campo NUNCA se omite");
      // R15: motivo vigente al entregar, no una foto del instante del cambio de estado.
      expect(descripcion).toContain("**Es el motivo VIGENTE EN EL MOMENTO DE LA ENTREGA**");
      expect(descripcion).toContain("no una foto del instante del");
    }

    // ⏳ 2026-08-22 — AQUI DECIA `toContain("las cuatro claves están SIEMPRE presentes")`, y la
    // frase suelta ya no describe el objeto entero: hay una quinta clave. La 268 la conserva
    // NOMBRANDO las cuatro y diciendo cual es la opcional, y el aserto afirma las dos mitades.
    expect(dataTs.description).toContain(
      "Las cuatro claves `numGuia`, `numRemision`, `estado` y `motivo` están SIEMPRE presentes",
    );
    expect(dataTs.description).toContain("UNA clave OPCIONAL, `evidenciasUrl`");
  });

  // ⏳ 2026-09-01 — AQUI VIVIA «se documentan las cabeceras de firma X-Ordenex-Signature y
  // X-Ordenex-Timestamp», y antes que eso, dentro del mismo test, la comprobacion de que la prosa
  // decia sobre QUE se calcula el HMAC. Las dos cosas se fueron, en dos pasos del mismo dia: la
  // prosa con las descripciones de nivel operacion, y las cabeceras al dejar de publicarse el
  // evento como operacion (solo una operacion puede declarar `parameters`).
  //
  // ESTA ES LA BAJA MAS CARA DE TODO EL CAMBIO y por eso queda escrita aqui: el contrato ya no
  // dice NI que la entrega va firmada NI como verificarla. La firma se sigue enviando igual; lo
  // que no existe es su documentacion publicada. Si se quiere recuperar sin volver a `webhooks`,
  // el sitio natural es la descripcion del propio schema.

  it("2026-09-01: paridad TS↔YAML — el schema publicado es espejo EXACTO del objeto TS", () => {
    expect(JSON.stringify(schemaYaml)).toEqual(
      JSON.stringify(openApiSpec.components.schemas[NOMBRE_SCHEMA]),
    );
  });
});
