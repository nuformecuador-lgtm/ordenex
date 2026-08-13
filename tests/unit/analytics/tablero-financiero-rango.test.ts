import { describe, it, expect } from "vitest";
import { quitarComentarios } from "../../fixtures/sin-comentarios";
import fs from "fs";
import path from "path";

import { RANGO_PRESETS } from "@/lib/analytics/types";
import type { GranularidadVista } from "@/lib/types/analitica-financiera";
import { FILTRO_FINANCIERO_POR_DEFECTO } from "@/app/(app)/analitica/_components/financiero/rango";

// Feature 132 (T1.2) — R26: mientras no exista la barra de filtros de la 131, el
// rango de TODAS las consultas del tablero financiero sale de una sola constante
// declarada en un solo archivo.
//
// El riesgo real que cubre este archivo no es que la constante valga otra cosa
// (eso se ve leyendo una linea), sino que aparezca un SEGUNDO origen del rango:
// un panel que escriba su propio preset "porque este KPI se ve mejor por
// semana". A partir de ahi el tablero muestra cifras de ventanas distintas una
// al lado de la otra sin decirlo. Por eso la mitad de abajo es un censo del
// directorio de la feature, no una asercion sobre el valor.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const DIR_FINANCIERO = path.join(
  REPO_ROOT,
  "app",
  "(app)",
  "analitica",
  "_components",
  "financiero",
);
const RANGO_PATH = path.join(DIR_FINANCIERO, "rango.ts");

/**
 * Se censa solo el CODIGO: los comentarios de `rango.ts` estan obligados a
 * nombrar los presets que descarta y a explicar por que. Es la misma decision
 * (y la misma funcion) de `tests/unit/analytics/modulo-puro.guardia.test.ts`.
 */
function soloCodigo(fuente: string): string {
  return quitarComentarios(fuente);
}

function archivosDeLaFeature(): string[] {
  if (!fs.existsSync(DIR_FINANCIERO)) return [];
  return fs
    .readdirSync(DIR_FINANCIERO, { withFileTypes: true })
    .filter((entrada) => entrada.isFile() && /\.tsx?$/.test(entrada.name))
    .map((entrada) => path.join(DIR_FINANCIERO, entrada.name));
}

function relativa(archivo: string): string {
  return path.relative(REPO_ROOT, archivo).split(path.sep).join("/");
}

/** Un preset escrito a mano, en cualquiera de las cuatro formas del dominio cerrado. */
const RE_PRESET_LITERAL = /["'](dia|semana|mes|personalizado)["']/;

/** La clave del filtro con un literal pegado: `rango: "…"`. */
const RE_CLAVE_RANGO_LITERAL = /\brango\s*:\s*["'][^"']*["']/;

/* -------------------------------------------------------------------------- */
/* Feature 186 — la colision de vocabularios, y por que NO se relaja el censo  */
/* -------------------------------------------------------------------------- */
//
// HALLAZGO DE LA 186 (2026-08-06), que ni su `design.md` ni el de la 132 previeron: DOS de
// los cuatro presets de rango —`dia` y `semana`— son HOMONIMOS de dos de los tres valores de
// `GranularidadVista`, que es otro dominio cerrado, de otro contrato
// (`lib/types/analitica-financiera.ts`) y con otro significado: uno dice «que ventana se
// consulta» y el otro «con que grano temporal viene agregada la respuesta».
//
// Al mudar `esVistaTemporal` y el rotulador de cubos a `adaptar.ts` (⟨D1⟩), ese archivo pasa
// a nombrar los dos literales homonimos y este censo lo marcaba como si escribiera un
// preset. ES UN FALSO POSITIVO POR HOMONIMIA: `adaptar.ts` no elige ninguna ventana; no
// importa `rango.ts`, no construye ningun filtro y no nombra `mes` ni `personalizado`.
//
// LO QUE **NO** SE HACE, y es la tentacion obvia: excluir `adaptar.ts` del censo, o sacar
// `dia` y `semana` del patron. Las dos dejarian entrar un preset de verdad.
//
// Lo que se hace: partir el dominio en dos y exigir mas donde se puede.
//
//  - Los presets SIN homonimo (`mes`, `personalizado`) se marcan en CUALQUIER archivo que no
//    sea `rango.ts`. Ahi el censo queda exactamente igual de estricto que antes.
//  - La clave `rango: "…"` se marca en cualquier archivo, tambien en `adaptar.ts`: escribir
//    la clave del filtro SI es decidir una ventana, diga lo que diga el literal.
//  - Los DOS homonimos se admiten en el modulo autorizado SOLO EN LA FORMA `case "…":`, que es
//    la unica en la que un rotulador necesita nombrarlos. Cualquier otra forma —una constante,
//    un array, una comparacion— se marca tambien ahi.
//
// ESA ULTIMA VIÑETA ES UN ARREGLO, Y CONVIENE DECIR DE QUE. La primera version de esta
// particion (revision del 2026-08-06, m2) admitia los homonimos en el modulo autorizado SIN
// mas condicion, y el reviewer lo midio: `export const PRESET_DEL_TABLERO = "semana";` escrito
// dentro de `adaptar.ts` NO ponia rojo nada, cuando antes de esta feature ese mismo literal en
// ese mismo archivo si lo ponia. Era una excepcion CON COSTE descrita como si no lo tuviera.
// Acotarla a la forma `case` cierra el hueco: un preset de verdad no se escribe nunca asi.
//
// Y por si `case` fuera poco, hay un segundo cinturon INDEPENDIENTE, abajo: el modulo
// autorizado no puede importar `rango.ts` ni nombrar la constante del filtro. Un archivo que
// no puede referirse al rango no puede decidirlo, escriba el literal que escriba.
//
// El resultado es MAS estrecho que el censo original en dos puntos (la clave `rango:` ya no
// tiene excepcion posible, y el modulo autorizado no puede tocar el rango ni por import) e
// igual de estrecho en el resto.

/** Los dos presets que NO colisionan con ningun valor de `GranularidadVista`. */
const RE_PRESET_INEQUIVOCO = /["'](mes|personalizado)["']/;

/** Los dos literales que sirven a los dos dominios y por eso no distinguen por si solos. */
const RE_PRESET_HOMONIMO = /["'](dia|semana)["']/;

/**
 * La UNICA forma en que el modulo autorizado puede nombrar un homonimo: la rama de un `switch`.
 *
 * Es lo que `etiquetaDeCubo` necesita para rotular, y es una forma en la que un preset de rango
 * no se escribe jamas: un preset se asigna, se compara o se mete en un filtro, no se declara
 * como etiqueta de `case` en la region financiera.
 */
const RE_HOMONIMO_EN_CASE = /\bcase\s+["'](dia|semana)["']\s*:/g;

/**
 * El unico modulo de la region que puede nombrar los valores de `GranularidadVista`
 * (R16 / ⟨D1⟩ de la 186). Escrito como ruta y no como excepcion por archivo: si el rotulador
 * se mudara, esto se pone rojo en vez de callar.
 */
const MODULO_DE_GRANULARIDAD = "app/(app)/analitica/_components/financiero/adaptar.ts";

/**
 * Los tres valores del dominio EN RUNTIME, como registro exhaustivo sobre el tipo importado.
 *
 * Antes era un array escrito a mano (revision del 2026-08-06, m3): ahi un cuarto valor del
 * contrato NO rompia nada y el censo seguia comparando tres de cuatro. Con el registro, ese
 * cuarto valor rompe la COMPILACION de este archivo. Es la misma tecnica que ya usan el guardia
 * del tablero y el test de componente, y no habia motivo para que aqui fuera otra.
 */
const GRANULARIDADES_DEL_DOMINIO: Readonly<Record<GranularidadVista, true>> = {
  dia: true,
  semana: true,
  no_temporal: true,
};

/**
 * Los homonimos que quedan tras descontar los que estan en forma de `case`.
 *
 * Se descuentan por SUSTITUCION y no contando: asi un archivo que tenga a la vez un `case`
 * legitimo y una constante ilegitima sigue marcado, que es justo el caso que se escapaba.
 */
function homonimosFueraDeCase(codigo: string): boolean {
  return RE_PRESET_HOMONIMO.test(codigo.replace(RE_HOMONIMO_EN_CASE, ""));
}

function escribeUnPresetDeRango(codigo: string, ruta: string): boolean {
  if (RE_CLAVE_RANGO_LITERAL.test(codigo)) return true;
  if (RE_PRESET_INEQUIVOCO.test(codigo)) return true;
  if (!RE_PRESET_HOMONIMO.test(codigo)) return false;
  // Fuera del modulo autorizado, cualquier homonimo basta. Dentro, solo los que no son `case`.
  return ruta !== MODULO_DE_GRANULARIDAD || homonimosFueraDeCase(codigo);
}

describe("R26 · el rango por defecto del tablero financiero es una constante y no una decision de cada panel", () => {
  it("el filtro por defecto pide la ventana movil de treinta dias", () => {
    expect(FILTRO_FINANCIERO_POR_DEFECTO).toEqual({ rango: "mes" });
  });

  it("el preset elegido pertenece al dominio cerrado de rangos del catalogo", () => {
    // Se comprueba contra `RANGO_PRESETS` y no contra un literal repetido: si
    // manana la 135 renombrara o retirara un preset, este test tiene que caer
    // en vez de seguir afirmando un string que ya no existe.
    expect(RANGO_PRESETS).toContain(FILTRO_FINANCIERO_POR_DEFECTO.rango);
  });

  it("el filtro no se puede alterar en caliente: esta congelado", () => {
    const mutable = FILTRO_FINANCIERO_POR_DEFECTO as { rango: string };
    try {
      mutable.rango = "dia";
    } catch {
      // En modulo ES el codigo corre en modo estricto y la asignacion lanza; en
      // otros entornos falla en silencio. Las dos formas son aceptables: lo que
      // se afirma es que el valor NO cambia.
    }
    expect(FILTRO_FINANCIERO_POR_DEFECTO.rango).toBe("mes");
    expect(Object.isFrozen(FILTRO_FINANCIERO_POR_DEFECTO)).toBe(true);
  });

  it("ningun otro archivo de la region financiera escribe un preset ni la clave rango", () => {
    const infractores = archivosDeLaFeature()
      .filter((archivo) => path.resolve(archivo) !== path.resolve(RANGO_PATH))
      .filter((archivo) =>
        escribeUnPresetDeRango(soloCodigo(fs.readFileSync(archivo, "utf8")), relativa(archivo)),
      )
      .map(relativa);

    expect(
      infractores,
      "escriben un rango a mano en vez de importar FILTRO_FINANCIERO_POR_DEFECTO",
    ).toEqual([]);
  });

  it("la excepcion por homonimia es UNA sola y no tapa ningun preset de verdad (186)", () => {
    // Autocomprobacion del recorte de arriba, sobre texto sintetico. Sin esto, la excepcion
    // seria una puerta abierta de la que solo constaria la intencion.
    const OTRO = "app/(app)/analitica/_components/financiero/TableroFinanciero.tsx";

    // Los dos homonimos: admitidos en el modulo del rotulador SOLO en forma de `case`...
    expect(escribeUnPresetDeRango('case "dia": return x;', MODULO_DE_GRANULARIDAD)).toBe(false);
    expect(escribeUnPresetDeRango('case "semana": return x;', MODULO_DE_GRANULARIDAD)).toBe(false);
    // ...y marcados en cualquier otro archivo de la region, tambien en forma de `case`.
    expect(escribeUnPresetDeRango('const r = "dia";', OTRO)).toBe(true);
    expect(escribeUnPresetDeRango('const r = "semana";', OTRO)).toBe(true);
    expect(escribeUnPresetDeRango('case "semana": return x;', OTRO)).toBe(true);

    // EL HUECO QUE LA REVISION MIDIO (m2), cerrado: dentro del modulo autorizado, un homonimo
    // que NO es una rama de `switch` se marca igual. Es el ejemplo literal del reviewer.
    expect(
      escribeUnPresetDeRango('export const PRESET_DEL_TABLERO = "semana";', MODULO_DE_GRANULARIDAD),
    ).toBe(true);
    expect(escribeUnPresetDeRango('if (f.rango === "dia") return x;', MODULO_DE_GRANULARIDAD)).toBe(
      true,
    );
    expect(escribeUnPresetDeRango('const PRESETS = ["dia", "semana"];', MODULO_DE_GRANULARIDAD)).toBe(
      true,
    );
    // Y el caso mixto, que es el que se escaparia si el descuento fuera por CUENTA y no por
    // sustitucion: un `case` legitimo y una constante ilegitima en el mismo archivo.
    expect(
      escribeUnPresetDeRango(
        'case "dia": return x;\nexport const PRESET = "semana";',
        MODULO_DE_GRANULARIDAD,
      ),
    ).toBe(true);

    // Los presets SIN homonimo se marcan en TODOS, incluido el modulo excepcionado.
    for (const ruta of [MODULO_DE_GRANULARIDAD, OTRO]) {
      expect(escribeUnPresetDeRango('const r = "mes";', ruta)).toBe(true);
      expect(escribeUnPresetDeRango('const r = "personalizado";', ruta)).toBe(true);
      expect(escribeUnPresetDeRango('case "mes": return x;', ruta)).toBe(true);
      // Y la clave del filtro tampoco tiene excepcion: escribirla ES elegir una ventana.
      expect(escribeUnPresetDeRango('consultar({ rango: "dia" });', ruta)).toBe(true);
      expect(escribeUnPresetDeRango('consultar({ rango: "mes" });', ruta)).toBe(true);
    }

    // El codigo limpio no se marca en ninguno de los dos.
    for (const ruta of [MODULO_DE_GRANULARIDAD, OTRO]) {
      expect(escribeUnPresetDeRango("consultar(FILTRO_FINANCIERO_POR_DEFECTO);", ruta)).toBe(false);
    }
  });

  it("el modulo excepcionado no puede referirse al rango ni por import: segundo cinturon (186)", () => {
    // Cinturon INDEPENDIENTE del anterior, y de la revision m2. La excepcion por homonimia solo
    // es segura mientras `adaptar.ts` no tenga forma de decidir una ventana; si un dia importara
    // `rango.ts` o nombrara `RANGO_PRESETS`, el literal homonimo dejaria de ser inocente aunque
    // siguiera escrito como `case`. Un archivo que no puede referirse al rango no puede
    // decidirlo, escriba lo que escriba.
    const autorizado = archivosDeLaFeature().find(
      (archivo) => relativa(archivo) === MODULO_DE_GRANULARIDAD,
    );
    expect(autorizado, `${MODULO_DE_GRANULARIDAD} no esta en el censo`).toBeDefined();

    const codigo = soloCodigo(fs.readFileSync(autorizado!, "utf8"));
    expect(codigo, "el modulo del rotulador importa rango.ts").not.toMatch(
      /from\s+["'][^"']*\/rango["']/,
    );
    expect(codigo, "el modulo del rotulador nombra el catalogo de presets").not.toContain(
      "RANGO_PRESETS",
    );
    expect(codigo, "el modulo del rotulador nombra la constante del filtro").not.toContain(
      "FILTRO_FINANCIERO_POR_DEFECTO",
    );
    // Contrapeso: el archivo se leyo de verdad y SI contiene el vocabulario que motiva la
    // excepcion. Sin esto, mover o vaciar `adaptar.ts` dejaria este caso verde por vacio.
    expect(RE_HOMONIMO_EN_CASE.test(codigo)).toBe(true);
    RE_HOMONIMO_EN_CASE.lastIndex = 0;
  });

  it("los dos dominios comparten EXACTAMENTE dos literales: ni mas, ni menos (186)", () => {
    // El contrapeso que hace verdadera la premisa del recorte. Si manana `RANGO_PRESETS`
    // ganara un valor que tambien es una granularidad —o si `GranularidadVista` ganara uno
    // que tambien es un preset—, la particion de arriba dejaria de cubrir el dominio y este
    // caso se pone rojo antes de que el censo empiece a mentir por omision.
    const granularidades = Object.keys(GRANULARIDADES_DEL_DOMINIO);
    const compartidos = RANGO_PRESETS.filter((preset) => granularidades.includes(preset));
    expect([...compartidos].sort()).toEqual(["dia", "semana"]);

    const exclusivos = RANGO_PRESETS.filter((preset) => !granularidades.includes(preset));
    expect(exclusivos.length).toBeGreaterThan(0);
    for (const preset of exclusivos) {
      expect(RE_PRESET_INEQUIVOCO.test(`"${preset}"`), `${preset} no lo cubre el patron`).toBe(
        true,
      );
    }
    for (const preset of compartidos) {
      expect(RE_PRESET_HOMONIMO.test(`"${preset}"`), `${preset} no lo cubre el patron`).toBe(true);
    }
    // Y el patron original sigue cubriendo el dominio entero: la particion no perdio nada.
    for (const preset of RANGO_PRESETS) {
      expect(RE_PRESET_LITERAL.test(`"${preset}"`), `${preset} salio del censo`).toBe(true);
    }
  });

  it("rango.ts si contiene el preset: el censo mira donde debe", () => {
    // Contrapeso del caso anterior: sin esto, un censo roto (o un directorio
    // renombrado) haria pasar la prueba de arriba por vacio en vez de por
    // limpio.
    const codigo = soloCodigo(fs.readFileSync(RANGO_PATH, "utf8"));
    expect(RE_PRESET_LITERAL.test(codigo)).toBe(true);
    expect(RE_CLAVE_RANGO_LITERAL.test(codigo)).toBe(true);
    expect(archivosDeLaFeature().length).toBeGreaterThan(1);
  });

  it("la constante no depende del momento ni del entorno en que se importa", () => {
    // `next/headers` la ataria a una peticion, `Date` al reloj y `process.env`
    // al despliegue. Cualquiera de los tres convertiria "la constante" en un
    // valor distinto por render, que es justo lo que R26 prohibe.
    const codigo = soloCodigo(fs.readFileSync(RANGO_PATH, "utf8"));
    expect(/next\/headers/.test(codigo), "lee cabeceras de la peticion").toBe(false);
    expect(/\bnew\s+Date\b|\bDate\s*\./.test(codigo), "consulta el reloj").toBe(false);
    expect(/process\s*\.\s*env/.test(codigo), "lee el entorno").toBe(false);
    expect(/searchParams/.test(codigo), "lee la query string").toBe(false);
  });
});
