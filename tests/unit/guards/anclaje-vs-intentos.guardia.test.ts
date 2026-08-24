import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { ORIGEN_TIPOS_VISITA_REAL, RESULTADOS_QUE_CUENTAN_COMO_INTENTO } from "@/lib/types/orden-historial";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";

// GUARDIA DE LA FEATURE 239 (T4.4, R16) — LAS DOS DERIVACIONES QUE MIRAN «CIERRE APROBADO» Y NO
// SE PUEDEN FUSIONAR.
//
// EL RIESGO, dicho sin rodeos: dos cosas de este sistema observan el mismo hecho —que un cierre
// esta aprobado— y la tentacion de unificarlas es evidente. No se pueden unificar, y lo que las
// separa no es estilo: es que SUS ERRORES VAN EN DIRECCIONES OPUESTAS.
//
//                       | CONTEO DE INTENTOS            | ANCLAJE DE LA DEVOLUCION
//   pregunta            | ¿en cuantos cierres aprobados | ¿en que INSTANTE entro esta orden
//                       | distintos tuvo esta orden un  | en `devuelta`?
//                       | resultado contable vigente?   |
//   grano               | N cierres x 1 orden           | 1 transicion, 1 timestamp
//   fuente              | `gestion_orden` + `cierre.    | `orden_historial_estado`, familia
//                       | estado` + familia de visita   | `anclaje_devolucion`
//   vida                | monotono creciente            | se reescribe en cada vuelta del ciclo
//   direccion del error | contar de MAS cobra ANTES     | anclar TARDE retrasa el cobro
//
// Un helper compartido tipo `esCierreAprobado()` acopla dos derivaciones cuyos errores van en
// sentidos contrarios: la primera vez que alguien «optimice» una, la otra cambia de
// comportamiento en silencio y con DINERO detras. Contar un intento de mas adelanta el escalado
// del cron SLA (99) y dispara el `cobroRechazado` (56) antes de tiempo, contra la tienda.
//
// POR QUE HACE FALTA ESTA GUARDIA Y NO BASTAN LOS TESTS DE CADA UNA. Los tests de cada criterio
// afirman que cada uno da el numero correcto HOY. Todos seguirian verdes el dia en que alguien
// hiciera que el anclaje se derivara del predicado de intentos: los dos seguirian dando el mismo
// resultado en los casos ya escritos, porque hoy coinciden en el caso feliz. El agujero no vive
// dentro de ninguno de los dos modulos — vive en el ACOPLAMIENTO —, y solo un test que lea los
// dos lados a la vez lo ve. Es el mismo razonamiento que `hilo-ventana-alcanzable.guardia`.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Donde vive CADA criterio. Si un modulo se renombra, la lectura revienta (no pasa en verde). */
const RUTA_INTENTOS = "lib/repositories/OrdenHistorialRepository.ts";
const RUTA_ANCLAJE = "lib/repositories/DevolucionSlaRepository.ts";

function leer(rel: string): string {
  const file = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(file)) {
    throw new Error(
      `guardia anclaje-vs-intentos: ${rel} no existe. La guardia NO pudo leer lo que vigila; se ` +
        `detiene en ROJO en vez de dar por buena una lectura vacia. Si el modulo se movio, ` +
        `actualiza la ruta — no borres la comprobacion.`,
    );
  }
  return fs.readFileSync(file, "utf8");
}

/** Fuente SIN COMENTARIOS: los dos modulos se CITAN mutuamente en prosa, y eso es deseable. */
function codigo(rel: string): string {
  return quitarComentarios(leer(rel));
}

/* -------------------------------------------------------------------------- */
/* Los detectores, como funciones PURAS del texto (asi se pueden mutar abajo)  */
/* -------------------------------------------------------------------------- */

/** Simbolos que SOLO pertenecen al criterio de INTENTOS. */
const SIMBOLOS_DE_INTENTOS = [
  "whereIntentosVigentes",
  "RESULTADOS_QUE_CUENTAN_COMO_INTENTO",
  "ORIGEN_TIPOS_VISITA_REAL",
  "contarIntentosVigentes",
] as const;

/** Simbolos que SOLO pertenecen al criterio de ANCLAJE. */
const SIMBOLOS_DE_ANCLAJE = ["anclaje_devolucion", "ORIGEN_ANCLAJE", "origenAncla"] as const;

/** Los simbolos de la lista que aparecen en el CODIGO de `fuente`. */
export function simbolosPresentes(fuente: string, simbolos: readonly string[]): string[] {
  return simbolos.filter((s) => new RegExp(`\\b${s}\\b`).test(fuente));
}

/** `true` si `fuente` importa algo del modulo cuyo path contiene `fragmento`. */
export function importaDe(fuente: string, fragmento: string): boolean {
  const re = new RegExp(`\\bfrom\\s+["'][^"']*${fragmento}[^"']*["']`);
  return re.test(fuente);
}

/**
 * `true` si `fuente` CONSULTA por la familia del anclaje, distinguiendolo de ESCRIBIRLA.
 *
 * La diferencia importa y no es sutil: la familia se ESCRIBE al aprobar el cierre
 * (`CierresAdminRepository`, dentro de una entrada de `appendCambioEstado`) y se LEE para derivar
 * el instante del ancla (`DevolucionSlaRepository`, dentro de un `where`). Un detector que solo
 * buscara el literal confundiria al productor con el consumidor, y esta guardia diria que hay dos
 * puntos de derivacion donde hay uno.
 *
 * El discriminante es el `where` que precede: una lectura FILTRA, una escritura ASIGNA.
 */
export function consultaPorFamiliaDelAnclaje(fuente: string): boolean {
  return /where\s*:\s*\{[^}]*origenTipo\s*:\s*(ORIGEN_ANCLAJE|["']anclaje_devolucion["'])/.test(
    fuente,
  );
}

describe("239/R16 — el ANCLAJE no se deriva del conteo de intentos", () => {
  it("el modulo del anclaje NO importa nada del modulo del conteo", () => {
    const fuente = codigo(RUTA_ANCLAJE);
    expect(
      importaDe(fuente, "OrdenHistorialRepository"),
      "el repositorio del cron SLA importa del repositorio del historial: si lo que trae es el " +
        "predicado de intentos, las dos derivaciones acaban compartiendo definicion (R16).",
    ).toBe(false);
  });

  it("el modulo del anclaje NO menciona ningun simbolo del criterio de intentos", () => {
    const presentes = simbolosPresentes(codigo(RUTA_ANCLAJE), SIMBOLOS_DE_INTENTOS);
    expect(
      presentes,
      "el anclaje empezo a hablar el vocabulario del conteo de intentos. Son dos preguntas " +
        "distintas sobre el mismo hecho, y sus errores van en direcciones OPUESTAS: contar de " +
        "mas cobra antes de tiempo; anclar tarde solo retrasa el cobro.",
    ).toEqual([]);
  });

  it("el modulo del conteo NO menciona ningun simbolo del anclaje", () => {
    const presentes = simbolosPresentes(codigo(RUTA_INTENTOS), SIMBOLOS_DE_ANCLAJE);
    expect(
      presentes,
      "el conteo de intentos empezo a mirar la familia del anclaje. Si `anclaje_devolucion` " +
        "entrara en su predicado, cada aprobacion de cierre sumaria un intento de mas: el cron " +
        "SLA escalaria antes y el `cobroRechazado` (56) saldria antes de tiempo.",
    ).toEqual([]);
  });

  it("el modulo del conteo NO importa nada del modulo del anclaje", () => {
    expect(importaDe(codigo(RUTA_INTENTOS), "DevolucionSlaRepository")).toBe(false);
  });
});

describe("239/R16 — cada criterio conserva su PUNTO UNICO de definicion", () => {
  it("`whereIntentosVigentes` se declara UNA sola vez, y en el modulo del conteo", () => {
    const declaraciones = [...codigo(RUTA_INTENTOS).matchAll(/export\s+function\s+whereIntentosVigentes\b/g)];
    expect(declaraciones).toHaveLength(1);

    // Y en ningun otro modulo de produccion hay una segunda declaracion con ese nombre: una copia
    // paralela daria dos numeros distintos para la misma orden segun quien contara.
    const otras = ficherosDeProduccion().filter(
      (rel) =>
        rel !== RUTA_INTENTOS && /\b(function|const)\s+whereIntentosVigentes\b/.test(codigo(rel)),
    );
    expect(otras).toEqual([]);
  });

  it("el filtro por la familia del ANCLAJE vive en UN solo modulo de lectura", () => {
    // La familia se ESCRIBE en `CierresAdminRepository` (la aprobacion) y se LEE en el repo del
    // cron. Escribir y leer son dos cosas distintas; lo que R16 vigila es que la LECTURA que
    // deriva el instante no se multiplique ni se mezcle con la del conteo.
    const lectores = ficherosDeProduccion().filter((rel) =>
      consultaPorFamiliaDelAnclaje(codigo(rel)),
    );
    expect(lectores).toEqual([RUTA_ANCLAJE]);
  });

  it("no existe ningun helper COMPARTIDO de «cierre aprobado»", () => {
    // El acoplamiento no llega solo por un import directo: llega por un `esCierreAprobado()` que
    // los dos usan porque «es lo mismo». Comparten UNA PALABRA y nada mas.
    const sospechosos = ficherosDeProduccion().filter((rel) =>
      /\b(function|const)\s+(esCierreAprobado|cierreAprobadoWhere|whereCierreAprobado)\b/.test(
        codigo(rel),
      ),
    );
    expect(
      sospechosos,
      "apareció un helper compartido de «cierre aprobado». Es tentador y esta mal: acopla dos " +
        "derivaciones cuyos errores van en direcciones opuestas.",
    ).toEqual([]);
  });
});

describe("239/R16 — las dos listas de INCLUSION siguen separadas", () => {
  it("`anclaje_devolucion` NO esta en `ORIGEN_TIPOS_VISITA_REAL`", () => {
    // La barrera que impide que la confirmacion administrativa cuente como una visita del
    // mensajero. Si cae, cada aprobacion suma +1 y el escalado se adelanta.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("anclaje_devolucion");
    // ⚠️ 2026-08-20 (feature 237, T2.1/R6): el censo pasa de UNO a DOS miembros, a mano.
    // `gestion_tienda_ayuda` (la gestion que registra la tienda desde la pestaña de ayuda) SI es
    // visita real: es el desenlace de la visita que el mensajero si hizo. El literal se conserva
    // como literal a proposito —es el contrato— y no se sustituye por su propia fuente.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).toEqual(["gestion", "gestion_tienda_ayuda"]);
  });

  it("el criterio de intentos sigue declarandose por RESULTADO, no por instante", () => {
    expect([...RESULTADOS_QUE_CUENTAN_COMO_INTENTO]).toEqual([
      "rechazada",
      "devuelta",
      "reprogramada",
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* AUTOCOMPROBACION — la guardia se sabe poner roja                            */
/* -------------------------------------------------------------------------- */

describe("239/R16 — AUTOCOMPROBACION: la fusion se detecta de verdad", () => {
  // Sin esto, un regex mal escrito dejaria esta guardia en verde para siempre. Este repo ya tuvo
  // un arnes de mutaciones que reporto 9/9 supervivientes DOS VECES sin haber ejecutado un test.
  // Se prueban los MISMOS detectores que usan los casos de arriba, sobre el texto exacto que
  // tendria el arbol si alguien fusionara las dos derivaciones.

  it("caza el anclaje reutilizando `whereIntentosVigentes` (la fusion literal de T4.4)", () => {
    const anclajeFusionado = `
      import { whereIntentosVigentes } from "@/lib/repositories/OrdenHistorialRepository";
      export class DevolucionSlaRepository {
        async findDevueltasSla() {
          const filas = await this.prisma.gestionOrden.findMany({
            where: whereIntentosVigentes(ordenId),
          });
          return filas;
        }
      }`;
    expect(importaDe(anclajeFusionado, "OrdenHistorialRepository")).toBe(true);
    expect(simbolosPresentes(anclajeFusionado, SIMBOLOS_DE_INTENTOS)).toEqual([
      "whereIntentosVigentes",
    ]);
  });

  it("caza el anclaje reusando la lista de visita real en vez de su propia familia", () => {
    const anclajeFusionado = `
      import { ORIGEN_TIPOS_VISITA_REAL } from "@/lib/types/orden-historial";
      const where = { origenTipo: { in: [...ORIGEN_TIPOS_VISITA_REAL] } };`;
    expect(simbolosPresentes(anclajeFusionado, SIMBOLOS_DE_INTENTOS)).toContain(
      "ORIGEN_TIPOS_VISITA_REAL",
    );
  });

  it("caza el conteo mirando la familia del anclaje (la fusion en la otra direccion)", () => {
    const conteoFusionado = `
      export function whereIntentosVigentes(ordenId) {
        return {
          ordenId,
          historialEstados: { some: { origenTipo: { in: ["gestion", "anclaje_devolucion"] } } },
        };
      }`;
    expect(simbolosPresentes(conteoFusionado, SIMBOLOS_DE_ANCLAJE)).toContain("anclaje_devolucion");
  });

  it("el detector distingue LEER la familia del anclaje de ESCRIBIRLA", () => {
    // La lectura FILTRA (va dentro de un `where`): es la que deriva el instante del ancla.
    const lectura = "historialEstados: { where: { origenTipo: ORIGEN_ANCLAJE }, take: 1 }";
    expect(consultaPorFamiliaDelAnclaje(lectura)).toBe(true);
    // La escritura ASIGNA (entrada de `appendCambioEstado`): es el productor, y hay uno solo.
    const escritura = '{ ordenId, estatusOrigenId: preEstadoId, origenTipo: "anclaje_devolucion" }';
    expect(consultaPorFamiliaDelAnclaje(escritura)).toBe(false);
    // Y sobre el arbol REAL dice lo mismo: el repo del cron LEE, el de cierres ESCRIBE. Sin esta
    // pareja, un detector que solo buscara el literal contaria dos puntos de derivacion donde hay
    // uno, y la guardia estaria roja por una razon falsa.
    expect(consultaPorFamiliaDelAnclaje(codigo(RUTA_ANCLAJE))).toBe(true);
    expect(consultaPorFamiliaDelAnclaje(codigo("lib/repositories/CierresAdminRepository.ts"))).toBe(
      false,
    );
  });

  it("caza un helper compartido de «cierre aprobado»", () => {
    const helper = `export function esCierreAprobado(c) { return c.estado === "aprobado"; }`;
    expect(
      /\b(function|const)\s+(esCierreAprobado|cierreAprobadoWhere|whereCierreAprobado)\b/.test(
        helper,
      ),
    ).toBe(true);
  });

  it("NO ladra ante la PROSA que explica por que no se fusionan", () => {
    // Es el falso positivo que importa: los dos modulos se citan mutuamente en comentarios a
    // proposito, y esa cita es lo que impide que alguien los una manana por no saberlo. Si la
    // guardia censara prosa, la unica forma de pasarla seria borrar la explicacion.
    const soloProsa = `
      // El criterio de intento vive en \`whereIntentosVigentes\` y NO se mezcla con el anclaje
      // (\`anclaje_devolucion\`): son dos derivaciones distintas. Ver ORIGEN_TIPOS_VISITA_REAL.
      const ORIGEN_ANCLAJE = "anclaje_devolucion";`;
    const sinComentarios = quitarComentarios(soloProsa);
    expect(simbolosPresentes(sinComentarios, SIMBOLOS_DE_INTENTOS)).toEqual([]);
  });

  it("los detectores LEEN de verdad: sobre el arbol real encuentran cada criterio en SU sitio", () => {
    // ANTI-VACUIDAD. Si los detectores no encontraran nada, todos los casos de arriba pasarian
    // por vacio. Se exige que cada modulo SI contenga sus propios simbolos.
    expect(simbolosPresentes(codigo(RUTA_INTENTOS), SIMBOLOS_DE_INTENTOS).length).toBeGreaterThan(0);
    expect(simbolosPresentes(codigo(RUTA_ANCLAJE), SIMBOLOS_DE_ANCLAJE).length).toBeGreaterThan(0);
    expect(ficherosDeProduccion().length).toBeGreaterThan(200);
  });
});

/* -------------------------------------------------------------------------- */

/** Modulos de produccion (`lib/` + `app/`), relativos al repo y con `/`. */
function ficherosDeProduccion(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if ([".ts", ".tsx"].includes(path.extname(entry.name))) {
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(REPO_ROOT, "lib"));
  walk(path.join(REPO_ROOT, "app"));
  return out;
}

// ---------------------------------------------------------------------------------------------
// AMPLIACION DE LA FEATURE 273 (T13.3, R34) — la ficha del TOPE no fusiona las dos derivaciones.
//
// Se AMPLIA esta guardia en vez de escribir una segunda: R34 es literalmente el invariante que ya
// vive aqui («el anclaje de la devolucion y el conteo de intentos siguen siendo dos derivaciones
// separadas»), y dos guardias del mismo invariante se desincronizan.
//
// POR QUE LA 273 LO PONE EN RIESGO, que es lo que justifica ampliar: esta ficha le da al conteo de
// intentos DOS lectores nuevos —el bloque de la aprobacion del cierre (`CierresAdminRepository`) y
// el cron de SLA por la rama `wrong_*`—, y los dos viven al lado de codigo que habla de anclaje.
// La tentacion de «unificar lo que mira el cierre aprobado» sube, no baja.
// ---------------------------------------------------------------------------------------------
describe("273/R34 — el tope de intentos no acerca las dos derivaciones", () => {
  it("la familia del rechazo por tope NO entra en el criterio de intentos", () => {
    // `rechazo_tope_intentos` nace de la aprobacion de un cierre, igual que `anclaje_devolucion`, y
    // por el MISMO motivo queda fuera de la lista de visita real: contarla haria que el propio
    // rechazo sumara un intento a su orden y adelantaria el cobro de OTRAS.
    expect([...ORIGEN_TIPOS_VISITA_REAL]).not.toContain("rechazo_tope_intentos");
    expect([...RESULTADOS_QUE_CUENTAN_COMO_INTENTO]).not.toContain("sin_gestionar");
  });

  it("el repositorio del cron SLA sigue SIN nombrar el vocabulario del conteo", () => {
    // La 273 hace que el SERVICIO del cron mire el contador en la rama `wrong_*` (R28). Eso es
    // legitimo: el servicio CONSUME el numero por la interfaz. Lo que no puede pasar es que el
    // REPOSITORIO —el que deriva el instante del ancla— empiece a hablar de intentos.
    const presentes = simbolosPresentes(codigo(RUTA_ANCLAJE), SIMBOLOS_DE_INTENTOS);
    expect(
      presentes,
      "el repositorio del anclaje empezo a nombrar el criterio de intentos. Con la 273 el cron " +
        "necesita el numero, pero lo recibe por la interfaz del servicio: derivarlo aqui fundiria " +
        "las dos derivaciones.",
    ).toEqual([]);
  });

  it("el bloque de la aprobacion IMPORTA el predicado, no lo reescribe", () => {
    // La 273 anade un lector del conteo dentro de `CierresAdminRepository`. Que lo IMPORTE es la
    // forma correcta —hay un solo punto de definicion, 215/R4—; reescribirlo ahi habria creado la
    // segunda copia que esta guardia existe para impedir.
    const fuente = codigo("lib/repositories/CierresAdminRepository.ts");
    expect(fuente).toMatch(/import\s*\{[^}]*whereIntentosVigentes[^}]*\}\s*from/);
    // Y NO declara una copia con ese nombre (el censo del caso de arriba ya lo cubre para todo el
    // arbol; esto lo dice sobre el fichero concreto que la 273 toco).
    expect(fuente).not.toMatch(/\b(function|const)\s+whereIntentosVigentes\b/);
    // Ni menciona la familia del anclaje en un `where` propio: la lectura del ancla sigue viviendo
    // en un solo modulo.
    expect(consultaPorFamiliaDelAnclaje(fuente)).toBe(false);
  });
});
