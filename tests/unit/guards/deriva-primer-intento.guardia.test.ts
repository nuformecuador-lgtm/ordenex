import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { METRICAS } from "@/lib/analytics/metrics";

/**
 * Feature 215 (R24-a/b/c/d, R35) — GUARDIA de la DERIVA DECLARADA de `primer_intento_ok`.
 *
 * POR QUE EXISTE. `tasks.md` de la 215 (T23) le asignaba a R24-b/c/d y a R35 una «guardia de
 * prosa» que nunca se escribio, y sin ella la declaracion entera podia evaporarse sin que nada
 * se enterara. Medido sobre `dev` el 2026-08-14, ANTES de escribir este archivo:
 *
 *   - borrar las 42 lineas del bloque «DERIVA DECLARADA» de `lib/analytics/metrics.ts`
 *     -> `tests/unit/guards` + `tests/unit/analytics`: 169 archivos / 1966 tests VERDES;
 *   - borrar los 1458 caracteres de la deriva DENTRO del `descripcion` de la metrica
 *     (el dato que se EXPORTA en el catalogo) -> verde igual.
 *
 * Prosa y dato podian desaparecer los dos, en silencio. Esta guardia es su dueño ejecutable.
 *
 * EL OBJETO VIGILADO ES EL COMENTARIO — y eso es DELIBERADO, no un descuido. La regla del repo
 * («ningun censo puede anclar en una mencion dentro de un comentario») existe para que nadie
 * mida CODIGO leyendo la prosa que lo explica. Aqui no se mide codigo: R24-b exige literalmente
 * que la deriva quede DECLARADA POR ESCRITO donde la encuentre quien lea la serie «sin abrir la
 * especificacion», asi que la declaracion —tres de los cuatro sitios son comentarios; el cuarto
 * es un dato exportado— ES el objeto del requisito. Que quede dicho aqui para que nadie
 * «arregle» esta guardia despiojando comentarios: hacerlo la vacia por completo.
 *
 * COMO ANCLA. Por CONTENIDO, jamas por numero de linea ni por posicion:
 *   - el bloque de `metrics.ts` se localiza desde el marcador `id: "primer_intento_ok"` bajando
 *     a la llave que abre su objeto y recogiendo el comentario contiguo de encima;
 *   - la `descripcion` NO se lee del fuente en disco: se lee del catalogo IMPORTADO, que es
 *     exactamente el dato que viaja fuera del repo;
 *   - los dos avisos de servicio se localizan por el docblock VECINO INMEDIATO de la funcion
 *     que calcula el KPI (`contarPrimerIntento` / `completarPrimerIntentoEnCubos`). Si el
 *     docblock deja de ser su vecino, o la funcion se renombra, esto es rojo: son las dos
 *     funciones que producen el escalon de la serie y el aviso vive donde se produce.
 *
 * QUE EXIGE, y por que esto y no un `toContain` de la prosa de hoy. Una guardia que se rompiera
 * con cualquier reformulacion nadie la mantendria: acabaria relajada o borrada. Se exigen las
 * TRES AFIRMACIONES que R24 declara irrenunciables, cada una por varias señales independientes
 * y sinonimicas, de modo que reescribir una frase entera siga verde y quitar una afirmacion sea
 * rojo. Las tres:
 *
 *   (1) el criterio CAMBIO —el intento previo sale ahora de las gestiones de un cierre
 *       APROBADO— y el historico ya escrito NO se re-backfillea (R24-a);
 *   (2) el corte es por `updated_at`, NO por `fecha`, y una fila recalculada despues del corte
 *       pasa a estar calculada con el criterio nuevo (R24-c, R35);
 *   (3) el efecto INTRADIA —el KPI sube durante el dia y baja al aprobarse los cierres— es una
 *       propiedad NUEVA y PERMANENTE, no un artefacto de la migracion de criterio (R24-d).
 *
 * El ultimo `describe` es la AUTOCOMPROBACION: comprueba que los localizadores devuelven `null`
 * cuando la declaracion no esta, que un texto escrito con OTRAS palabras pasa, y que quitarle
 * una sola de las tres afirmaciones lo pone rojo. Sin eso, esta guardia solo probaria que sabe
 * leer ficheros.
 */

const RAIZ = path.resolve(__dirname, "..", "..", "..");

const METRICS = "lib/analytics/metrics.ts";
const ROLLUP = "lib/services/AnaliticaRollupService.ts";
const OPERATIVA = "lib/services/AnaliticaOperativaService.ts";

/** El id de la metrica cuya deriva se declara. Es tambien el ancla del bloque de `metrics.ts`. */
const METRICA_ID = "primer_intento_ok";
const MARCADOR_ENTRADA = `id: "${METRICA_ID}"`;

/** Las dos funciones que CALCULAN el KPI: la que persiste el rollup y la viva del dia. */
const DECLARACION_ROLLUP = "private async contarPrimerIntento(";
const DECLARACION_OPERATIVA = "export function completarPrimerIntentoEnCubos(";

function leer(rel: string): string {
  return readFileSync(path.join(RAIZ, rel), "utf8");
}

/**
 * Bloque contiguo de comentarios `//` que precede a la entrada del catalogo marcada por
 * `marcador`. Se sube desde el marcador hasta la llave que ABRE el objeto de esa entrada y de
 * ahi se recoge el comentario de encima: si el bloque desaparece, encima de la llave queda el
 * cierre de la entrada anterior y esto devuelve `null`.
 */
function comentarioDeLaEntrada(fuente: string, marcador: string): string | null {
  const lineas = fuente.split(/\r?\n/);
  const iMarcador = lineas.findIndex((l) => l.includes(marcador));
  if (iMarcador === -1) return null;
  let iLlave = iMarcador;
  while (iLlave >= 0 && lineas[iLlave].trim() !== "{") iLlave--;
  if (iLlave < 0) return null;
  const bloque: string[] = [];
  for (let j = iLlave - 1; j >= 0 && lineas[j].trim().startsWith("//"); j--) {
    bloque.unshift(lineas[j]);
  }
  return bloque.length === 0 ? null : bloque.join("\n");
}

/**
 * Docblock `/** ... *\/` VECINO INMEDIATO de `declaracion`. Que tenga que ser el vecino
 * inmediato es el punto: un aviso escrito en cualquier otra parte del archivo no cumple R24-b,
 * porque quien lea la funcion que produce el escalon no tropieza con el.
 */
function docblockVecinoDe(fuente: string, declaracion: string): string | null {
  const i = fuente.indexOf(declaracion);
  if (i === -1) return null;
  const antes = fuente.slice(0, i).trimEnd();
  if (!antes.endsWith("*/")) return null;
  const abre = antes.lastIndexOf("/**");
  return abre === -1 ? null : antes.slice(abre);
}

interface Sitio {
  id: string;
  donde: string;
  texto: () => string | null;
}

const SITIOS: readonly Sitio[] = [
  {
    id: "definicion",
    donde: `${METRICS} · comentario que precede a la entrada \`${METRICA_ID}\` del catalogo`,
    texto: () => comentarioDeLaEntrada(leer(METRICS), MARCADOR_ENTRADA),
  },
  {
    id: "catalogo",
    donde: `${METRICS} · \`descripcion\` de \`${METRICA_ID}\`, tal como se EXPORTA`,
    texto: () => METRICAS.find((m) => m.id === METRICA_ID)?.descripcion ?? null,
  },
  {
    id: "rollup",
    donde: `${ROLLUP} · docblock de \`contarPrimerIntento\` (persiste las filas)`,
    texto: () => docblockVecinoDe(leer(ROLLUP), DECLARACION_ROLLUP),
  },
  {
    id: "operativa",
    donde: `${OPERATIVA} · docblock de \`completarPrimerIntentoEnCubos\` (la viva del dia)`,
    texto: () => docblockVecinoDe(leer(OPERATIVA), DECLARACION_OPERATIVA),
  },
];

interface Senal {
  nombre: string;
  patron: RegExp;
}

interface Afirmacion {
  id: string;
  que: string;
  senales: readonly Senal[];
}

/**
 * Las tres afirmaciones, cada una por señales SINONIMICAS. `[^.]{0,N}` mantiene cada señal
 * dentro de una misma frase: dos ideas sueltas en parrafos distintos no la satisfacen.
 */
const AFIRMACIONES: readonly Afirmacion[] = [
  {
    id: "R24-a",
    que: "el criterio CAMBIO (ahora: cierre APROBADO) y el historico NO se re-backfillea",
    senales: [
      { nombre: "el criterio cambio", patron: /cambi\w*\s+de\s+criterio|criterio[^.]{0,80}cambi/i },
      { nombre: "sin re-backfill", patron: /(?:no|sin|jamas|nunca)[^.]{0,120}back-?fill/i },
      { nombre: "el criterio nuevo es el cierre aprobado", patron: /cierres?\s+(?:\w+\s+){0,3}aprobad/i },
    ],
  },
  {
    id: "R24-c/R35",
    que: "el corte va por `updated_at` y NO por `fecha`; recalcular una fila la pasa al criterio nuevo",
    senales: [
      { nombre: "hay un corte", patron: /\bcorte\b/i },
      { nombre: "el corte se sostiene en `updated_at`", patron: /updated_at/ },
      { nombre: "y NO en la `fecha` de la fila", patron: /\bno\b[^.]{0,40}\bpor\b[^.]{0,25}`?fecha`?/i },
      { nombre: "recalcular pasa la fila al criterio nuevo", patron: /recalcul\w*[^.]{0,160}criterio/i },
    ],
  },
  {
    id: "R24-d",
    que: "el efecto INTRADIA es propiedad NUEVA y PERMANENTE, no un artefacto de la migracion",
    senales: [
      { nombre: "se nombra el efecto intradia", patron: /intrad[ií]a/i },
      { nombre: "el KPI sube y luego baja", patron: /\bsube\b[^.]{0,120}\bbaja\b/i },
      { nombre: "es permanente", patron: /permanente/i },
      {
        // Negacion + la idea de «cosa pasajera», en la misma frase. Admite «NO es un artefacto»,
        // «NO UN TRANSITORIO», «no estamos ante un artefacto», «ni un efecto pasajero»…: lo que
        // no puede desaparecer es la NEGACION de que esto sea transitorio.
        nombre: "no es un artefacto ni un transitorio",
        patron: /(?:\bno\b|\bni\b|\bnada\b)[^.]{0,60}\b(?:artefacto|transitorio|pasajer\w+)/i,
      },
    ],
  },
];

/**
 * Quita los MARCADORES de comentario (`//`, `/**`, el `*` de continuacion, `*​/`) y colapsa los
 * espacios. NO quita prosa: la prosa es justo lo que se vigila. Sin esto, «un cierre\n *
 * APROBADO» no casaria por culpa del asterisco de continuacion, y la guardia dependeria de
 * DONDE parte la linea el formateador — un anclaje posicional camuflado.
 */
function normalizar(texto: string): string {
  return texto
    .replace(/\/\*\*|\*\//g, " ")
    .replace(/^[ \t]*(?:\/\/|\*)[ \t]?/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Nombres de las señales de `afirmacion` que NO aparecen en `texto`. */
function senalesQueFaltan(texto: string, afirmacion: Afirmacion): string[] {
  const plano = normalizar(texto);
  return afirmacion.senales.filter((s) => !s.patron.test(plano)).map((s) => s.nombre);
}

describe("215 · la deriva declarada de `primer_intento_ok` existe en los CUATRO sitios (R24-b)", () => {
  for (const sitio of SITIOS) {
    it(`${sitio.id}: la declaracion sigue ahi (${sitio.donde})`, () => {
      expect(
        sitio.texto(),
        `desaparecio la declaracion de la deriva en ${sitio.donde}. R24-b exige que quien lea ` +
          "la serie tropiece con el aviso SIN abrir la especificacion: no se borra, se reescribe.",
      ).not.toBeNull();
    });
  }

  it("son cuatro sitios distintos y ninguno es copia textual de otro", () => {
    const textos = SITIOS.map((s) => s.texto());
    expect(textos.every((t) => t !== null)).toBe(true);
    const normalizados = textos.map((t) => normalizar(t as string));
    expect(new Set(normalizados).size).toBe(SITIOS.length);
  });
});

describe("215 · las TRES afirmaciones irrenunciables, sitio por sitio (R24-a/c/d, R35)", () => {
  for (const sitio of SITIOS) {
    for (const afirmacion of AFIRMACIONES) {
      it(`${sitio.id} · ${afirmacion.id}: ${afirmacion.que}`, () => {
        const texto = sitio.texto();
        expect(texto, `sin declaracion en ${sitio.donde}`).not.toBeNull();
        const faltan = senalesQueFaltan(texto as string, afirmacion);
        expect(
          faltan,
          `en ${sitio.donde} ya no se afirma ${afirmacion.id} (${afirmacion.que}). ` +
            `Falta: ${faltan.join(", ")}. Reformular esta permitido; quitar la afirmacion, no.`,
        ).toEqual([]);
      });
    }
  }
});

// Texto de PRUEBA escrito a proposito con OTRAS palabras que las de los cuatro sitios: si esta
// guardia solo supiera reconocer la prosa de hoy, esto seria rojo y la guardia seria un
// `toContain` disfrazado.
const REESCRITO_CON_OTRAS_PALABRAS = [
  "Aviso: con la 215 el criterio de «intento previo» cambio —ahora se lee de las gestiones",
  "que cuelgan de un cierre aprobado— y lo ya escrito no se re-backfillea nunca.",
  "El corte no se decide por la `fecha` que mide la fila sino por su `updated_at`, de modo",
  "que una fila antigua que se recalcula hoy queda con el criterio de hoy.",
  "Ojo al efecto intradia: el numero sube a lo largo del dia y baja cuando se aprueban los",
  "cierres; no es un transitorio de la migracion, es una propiedad permanente.",
].join("\n");

describe("215 · autocomprobacion: la guardia detecta lo que dice detectar", () => {
  it("los localizadores devuelven `null` cuando la declaracion NO esta", () => {
    const catalogoSinComentario = ['const CATALOGO = [', '  {', `    ${MARCADOR_ENTRADA},`, "  },", "];"].join(
      "\n",
    );
    expect(comentarioDeLaEntrada(catalogoSinComentario, MARCADOR_ENTRADA)).toBeNull();
    expect(comentarioDeLaEntrada("const x = 1;", MARCADOR_ENTRADA)).toBeNull();
    expect(docblockVecinoDe(`  ${DECLARACION_ROLLUP}`, DECLARACION_ROLLUP)).toBeNull();
    // Un docblock que ya NO es el vecino inmediato tampoco vale.
    expect(
      docblockVecinoDe(`/** aviso huerfano */\nconst otro = 1;\n${DECLARACION_ROLLUP}`, DECLARACION_ROLLUP),
    ).toBeNull();
  });

  it("los localizadores SI devuelven el bloque cuando esta (no son un `null` perpetuo)", () => {
    const conComentario = ["  // (1) primera linea", "  // (2) segunda", "  {", `    ${MARCADOR_ENTRADA},`].join(
      "\n",
    );
    expect(comentarioDeLaEntrada(conComentario, MARCADOR_ENTRADA)).toContain("(2) segunda");
    expect(docblockVecinoDe(`/** aviso */\n${DECLARACION_ROLLUP}`, DECLARACION_ROLLUP)).toBe("/** aviso */");
  });

  it("un texto que dice las tres cosas con OTRAS palabras pasa las tres afirmaciones", () => {
    for (const afirmacion of AFIRMACIONES) {
      expect(
        senalesQueFaltan(REESCRITO_CON_OTRAS_PALABRAS, afirmacion),
        `la guardia exige la prosa literal de hoy para ${afirmacion.id}: eso la vuelve insostenible`,
      ).toEqual([]);
    }
  });

  it("quitar UNA sola de las tres afirmaciones lo pone rojo", () => {
    const parrafos = REESCRITO_CON_OTRAS_PALABRAS.split("\n");
    const sinBackfill = parrafos.slice(2).join("\n"); // se cae (1)
    const sinCorte = [...parrafos.slice(0, 2), ...parrafos.slice(4)].join("\n"); // se cae (2)
    const sinIntradia = parrafos.slice(0, 4).join("\n"); // se cae (3)
    expect(senalesQueFaltan(sinBackfill, AFIRMACIONES[0]).length).toBeGreaterThan(0);
    expect(senalesQueFaltan(sinCorte, AFIRMACIONES[1]).length).toBeGreaterThan(0);
    expect(senalesQueFaltan(sinIntradia, AFIRMACIONES[2]).length).toBeGreaterThan(0);
  });

  it("un texto vacio falla las tres (nada de verde por ausencia de dato)", () => {
    for (const afirmacion of AFIRMACIONES) {
      expect(senalesQueFaltan("", afirmacion).length).toBe(afirmacion.senales.length);
    }
  });
});
