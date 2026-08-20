// GUARDIA DEL ARNÉS — EL HILO ES BIDIRECCIONAL DE HECHO, NO SOLO DE PERMISO (FEATURE 227).
//
// Cubre **R38** (cada rol tiene al menos un estado ALCANZABLE en su propia pantalla donde puede
// publicar) y **R36** (el corte de la feature 167/R34 —los dos estatus que lee el panel del
// mensajero— no se toca).
//
// **Qué contradicción impide que vuelva.** La primera vuelta del spec dio a los dos roles la MISMA
// ventana de escritura, `devuelta`. Compilaba, pasaba sus tests y era falso: `/novedades` lista
// exactamente `devuelta` —así que la tienda sí podía escribir—, pero el panel del mensajero lee
// exactamente `por_recoger` y `en_reparto`, así que al mensajero NUNCA se le aparecía delante una
// orden en la que pudiera publicar. Tenía el permiso de R11 y no tenía dónde ejercerlo: el hilo
// «bidireccional» habría salido de una sola dirección. La decisión D1 lo cerró haciendo la ventana
// ASIMÉTRICA POR ROL; esta guardia es quien impide que se reabra.
//
// **Por qué no basta con los tests del service.** Los tests del service afirman «con la orden en
// `en_reparto` el mensajero publica». Todos seguirían verdes el día en que alguien quitara
// `en_reparto` del corte de `listarMisAsignaciones`, o moviera la ventana del mensajero a
// `entregada`: la regla seguiría siendo coherente consigo misma y habría dejado de ser alcanzable.
// El agujero no vive en ninguno de los dos módulos, vive EN EL CRUCE — y solo un test que lea los
// dos lados a la vez lo ve.
//
// **De dónde salen los dos conjuntos.** La ventana se importa como valor (`VENTANA_ESCRITURA`,
// exportada `as const` precisamente para esto). Los cortes de pantalla, hasta el 2026-08-19, NO se
// podían importar: `ESTATUS_DEVUELTA` (`OrdenRepository`) y `ORIGEN_RECOGER` / `ESTADO_EN_REPARTO`
// (`MisAsignacionesService`) eran `const` privados de módulo. Copiarlos a mano aquí habría
// convertido la guardia en un espejo de sí misma: seguiría verde después de que alguien moviera el
// corte de verdad, que es EXACTAMENTE el fallo que vino a cerrar. Así que se leían del texto fuente.
//
// ⚠️ **2026-08-19 (FEATURE 236, design §2.4) — el lado de la TIENDA cambió de fuente, y sigue sin
// ser un espejo.** Su predicado dejó de escribir el estatus y pasa a indexar un `Record` importable
// (`ESTATUS_POR_GRUPO`), así que el conjunto se lee de ese VALOR — y se **ATA** al predicado real
// con dos aserciones del bloque 0: que `novedadWhere` lo usa, y que su cuerpo no contiene ningún
// literal de estatus. Con las dos, leer el mapa ES leer el predicado. El lado del MENSAJERO no
// cambió: sus estatus se siguen leyendo del texto fuente, porque siguen siendo `const` privados.
// El detalle entero, en la cabecera de `estatusDeNovedades`.
//
// **Y si el fuente deja de encontrarse, esto se pone ROJO.** Cada paso de la extracción falla con
// un mensaje que dice qué patrón dejó de casar y en qué archivo. Una guardia estática que no
// encuentra nada y lo reporta como «no hay infracciones» es peor que no tenerla.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { describe, it, expect } from "vitest";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
// Feature 236 (T2.7): la pantalla de la tienda ya no declara sus estatus en el fuente del
// repositorio — los toma de este mapa, y el bloque 0 ATA el predicado a él.
import { ESTATUS_POR_GRUPO, GRUPOS_NOVEDAD } from "@/lib/types/novedad-grupo";
import {
  ROLES_CON_HILO,
  VENTANA_ESCRITURA,
  type RolConHilo,
} from "@/lib/types/ventana-hilo-notas";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

const RUTA_ORDEN_REPO = "lib/repositories/OrdenRepository.ts";
const RUTA_MIS_ASIGNACIONES = "lib/services/MisAsignacionesService.ts";

// =============================================================================================
// Extracción — cada fallo REVIENTA con nombre y apellido
// =============================================================================================

/** Corta en seco. Ningún camino de esta guardia devuelve «no encontré nada» como si fuera «no hay
 *  infracciones»: si la guardia no puede leer lo que vigila, se detiene en rojo. */
function reventar(que: string): never {
  throw new Error(
    `guardia hilo-ventana-alcanzable: ${que}. La guardia NO pudo leer lo que vigila; se detiene ` +
      `en ROJO en vez de dar por buena una lectura vacía. Si el código se reorganizó, actualiza ` +
      `la extracción — no borres la comprobación.`,
  );
}

/** Índice del delimitador que cierra el abierto en `apertura`, contando anidamiento. */
function cierreDe(fuente: string, apertura: number, abre: string, cierra: string, ruta: string): number {
  let nivel = 0;
  for (let i = apertura; i < fuente.length; i += 1) {
    if (fuente[i] === abre) nivel += 1;
    else if (fuente[i] === cierra) {
      nivel -= 1;
      if (nivel === 0) return i;
    }
  }
  return reventar(`${ruta}: el \`${abre}\` abierto en la posición ${apertura} nunca se cierra`);
}

function posicionDe(fuente: string, patron: RegExp, ruta: string, que: string): number {
  const m = patron.exec(fuente);
  if (!m) reventar(`${ruta}: no se encontró ${que} (patrón /${patron.source}/)`);
  return m.index;
}

/**
 * El cuerpo `{ … }` del miembro cuya CABECERA casa `patronCabecera`: se salta la lista de
 * argumentos (con anidamiento, para no cortar en un `)` interior) y abre en la primera llave
 * posterior. El patrón lleva `\s+` en vez de espacios para sobrevivir a un reformateo.
 */
function cuerpoDeMiembro(fuente: string, ruta: string, patronCabecera: RegExp, que: string): string {
  const inicio = posicionDe(fuente, patronCabecera, ruta, que);
  const abrePar = fuente.indexOf("(", inicio);
  if (abrePar < 0) reventar(`${ruta}: ${que} no tiene lista de argumentos`);
  const cierraPar = cierreDe(fuente, abrePar, "(", ")", ruta);
  const abreLlave = fuente.indexOf("{", cierraPar);
  if (abreLlave < 0) reventar(`${ruta}: ${que} no tiene cuerpo`);
  return fuente.slice(abreLlave, cierreDe(fuente, abreLlave, "{", "}", ruta) + 1);
}

/** Los argumentos, en crudo, de la primera llamada a `nombre(` dentro de `fuente`. */
function argumentosDeLlamada(fuente: string, ruta: string, nombre: string): string {
  const inicio = posicionDe(
    fuente,
    new RegExp(`\\b${nombre}\\s*\\(`),
    ruta,
    `la llamada a \`${nombre}(…)\``,
  );
  const abrePar = fuente.indexOf("(", inicio);
  return fuente.slice(abrePar + 1, cierreDe(fuente, abrePar, "(", ")", ruta));
}

/**
 * El VALOR de una expresión que, en estos dos módulos, es o un literal de texto o el nombre de un
 * `const` de módulo declarado con un literal (`const ESTATUS_DEVUELTA = "devuelta";`). Cualquier
 * otra cosa —una expresión calculada, un import— revienta: preferimos que alguien tenga que venir
 * a enseñarle a la guardia a leer su refactor antes que dejarla adivinando.
 */
function valorDe(fuenteModulo: string, ruta: string, expresion: string): string {
  const literal = /^["'`]([^"'`]*)["'`]$/.exec(expresion.trim());
  if (literal) return literal[1];

  const identificador = expresion.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(identificador)) {
    reventar(`${ruta}: \`${identificador}\` no es ni un literal ni un identificador simple`);
  }
  const declaracion = new RegExp(
    `\\b(?:const|let|var)\\s+${identificador}\\s*(?::[^=]*)?=\\s*["']([^"']+)["']`,
  ).exec(fuenteModulo);
  if (!declaracion) {
    reventar(`${ruta}: \`${identificador}\` no se declara con un literal de texto en este módulo`);
  }
  return declaracion[1];
}

// ---------------------------------------------------------------------------------------------
// Los dos cortes de pantalla, como funciones PURAS del texto fuente (así se les puede dar un
// fuente sintético en la contraprueba y comprobar que de verdad leen).
// ---------------------------------------------------------------------------------------------

/**
 * Lo que `/novedades` lista POR ESTATUS.
 *
 * ⚠️ 2026-08-19 (FEATURE 236, design §2.4) — ESTA EXTRACCIÓN CAMBIÓ DE FUENTE, Y HAY QUE CONTAR
 * POR QUÉ, porque el cambio parece un debilitamiento y es lo contrario.
 *
 * **Qué había.** `novedadWhere` era un `OR` de dos igualdades y esta guardia leía sus estatus DEL
 * TEXTO FUENTE con `/estatus\s*:\s*\{\s*value\s*:\s*([^,}]+?)\s*\}/`, resolviendo lo capturado con
 * `valorDe`. Funcionaba porque lo capturado era siempre un identificador simple
 * (`ESTATUS_DEVUELTA`, `ESTATUS_AYUDA`), declarado con un literal en el mismo módulo.
 *
 * **Qué pasó.** La 236 parte el predicado en dos superficies y el valor pasa a salir de un `Record`
 * indexado: `{ estatus: { value: ESTATUS_POR_GRUPO[grupo] } }`. Eso NO es «ni un literal ni un
 * identificador simple», así que `valorDe` **reventó** — y reventar era lo correcto: su contrato
 * dice que se detiene antes que adivinar. Lo que NO se podía hacer era relajarlo para que tragase
 * expresiones, ni borrar el bloque: eso habría convertido una guardia en un adorno.
 *
 * **Qué se hace en su lugar, y por qué es MÁS fuerte.** Los estatus de la pantalla de la tienda
 * pasan a leerse del **valor importado** `ESTATUS_POR_GRUPO` —igual que la ventana, exportada
 * `as const` precisamente para esto—, y para que la guardia siga siguiendo AL PREDICADO REAL y no a
 * un espejo, se **ata** el predicado al mapa con dos comprobaciones sobre el fuente:
 *
 *   1. el cuerpo de `novedadWhere` **usa** `ESTATUS_POR_GRUPO` (si deja de usarlo, ROJO);
 *   2. el cuerpo de `novedadWhere` **no contiene ningún literal de estatus**, ni directo ni a través
 *      de un `const` del módulo (si alguien vuelve a escribir `{ estatus: { value: "devuelta" } }` a
 *      mano, ROJO).
 *
 * Con las dos, el único origen posible de los estatus de esa pantalla es el mapa — así que leer el
 * mapa ES leer el predicado. Y encima permite afirmar algo más fuerte que la intersección no vacía
 * de antes: **igualdad exacta** con la ventana del `adminTienda` (ver R36 abajo).
 */
export function estatusDeNovedades(): string[] {
  // De `GRUPOS_NOVEDAD` y no de `Object.values`, para que el conjunto sea el de los grupos
  // DECLARADOS: un grupo que estuviera en el mapa y no en la lista de pestañas no se lista, y esta
  // guardia mide lo que la pantalla lista.
  return GRUPOS_NOVEDAD.map((grupo) => ESTATUS_POR_GRUPO[grupo]);
}

/**
 * Los estatus del catálogo que aparecen ESCRITOS dentro del cuerpo de `novedadWhere`, sea como
 * literal (`"devuelta"`) o a través de un `const` del módulo (`ESTATUS_DEVUELTA`). Debe salir VACÍO:
 * el único origen admisible es el mapa.
 *
 * Es la mitad que sustituye a la lectura de estatus del fuente. Sin ella, esta guardia mediría un
 * `Record` que nadie garantiza que el predicado use — el espejo de sí misma que su cabecera dice
 * que no quiere ser.
 */
export function literalesDeEstatusEnNovedadWhere(
  fuente: string,
  ruta = RUTA_ORDEN_REPO,
): string[] {
  const cuerpo = cuerpoDeMiembro(
    fuente,
    ruta,
    /private\s+novedadWhere\s*\(/,
    "la declaración de `novedadWhere`",
  );
  const catalogo = new Set<string>(ORDER_STATUS_SEED as readonly string[]);
  const encontrados = new Set<string>();

  // (a) literales de texto escritos dentro del cuerpo.
  for (const m of cuerpo.matchAll(/["'`]([^"'`]*)["'`]/g)) {
    if (catalogo.has(m[1])) encontrados.add(m[1]);
  }
  // (b) identificadores del cuerpo que resuelven a un literal de estatus en el módulo: un `const`
  //     con el estatus dentro es el MISMO segundo literal, solo que con un nombre delante.
  for (const m of cuerpo.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
    const declaracion = new RegExp(
      `\\b(?:const|let|var)\\s+${m[0]}\\s*(?::[^=]*)?=\\s*["']([^"']+)["']`,
    ).exec(fuente);
    if (declaracion && catalogo.has(declaracion[1])) encontrados.add(declaracion[1]);
  }
  return [...encontrados].sort();
}

/** `true` si el cuerpo de `novedadWhere` toma su estatus del mapa. Si no, la guardia REVIENTA. */
export function novedadWhereUsaElMapa(fuente: string, ruta = RUTA_ORDEN_REPO): boolean {
  const cuerpo = cuerpoDeMiembro(
    fuente,
    ruta,
    /private\s+novedadWhere\s*\(/,
    "la declaración de `novedadWhere`",
  );
  return /\bESTATUS_POR_GRUPO\s*\[/.test(cuerpo);
}

/**
 * Lo que lee el panel del mensajero: la lista de estatus que
 * `MisAsignacionesService.listarMisAsignaciones` pasa a `findMisAsignaciones` (corte de la
 * feature 167/R34).
 */
export function estatusDelPanelMensajero(fuente: string, ruta = RUTA_MIS_ASIGNACIONES): string[] {
  const cuerpo = cuerpoDeMiembro(
    fuente,
    ruta,
    /async\s+listarMisAsignaciones\s*\(/,
    "la declaración de `listarMisAsignaciones`",
  );
  const argumentos = argumentosDeLlamada(cuerpo, ruta, "findMisAsignaciones");
  const arreglo = /\[([^\]]*)\]/.exec(argumentos);
  if (!arreglo) {
    reventar(`${ruta}: \`findMisAsignaciones\` ya no recibe una lista literal de estatus`);
  }
  const elementos = arreglo[1]
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (elementos.length === 0) reventar(`${ruta}: la lista de estatus del panel salió vacía`);
  return elementos.map((e) => valorDe(fuente, ruta, e));
}

const FUENTE_ORDEN_REPO = codigoSinComentarios(RUTA_ORDEN_REPO);
const FUENTE_MIS_ASIGNACIONES = codigoSinComentarios(RUTA_MIS_ASIGNACIONES);

const ESTATUS_DE_NOVEDADES = estatusDeNovedades();
const ESTATUS_DEL_PANEL_MENSAJERO = estatusDelPanelMensajero(FUENTE_MIS_ASIGNACIONES);

/**
 * La pantalla de CADA rol. El mapeo rol → pantalla se escribe aquí (es la premisa del spec: la
 * tienda ve el hilo en `/novedades`, el mensajero en su panel).
 *
 * De dónde salen los ESTATUS de cada una, tras la 236: los del mensajero, del TEXTO FUENTE de su
 * servicio (siguen siendo `const` privados de módulo, no hay otra forma de leerlos); los de la
 * tienda, del VALOR importado `ESTATUS_POR_GRUPO`, ATADO a su predicado por las dos aserciones del
 * bloque 0. En los dos casos lo que se mide es lo que la pantalla lista de verdad, que es lo que
 * puede moverse sin que nadie se entere.
 */
const PANTALLA_POR_ROL: Record<RolConHilo, { donde: string; estatus: string[] }> = {
  adminTienda: {
    donde: `/novedades — \`${RUTA_ORDEN_REPO}\` (novedadWhere)`,
    estatus: ESTATUS_DE_NOVEDADES,
  },
  mensajero: {
    donde: `/mis-asignaciones — \`${RUTA_MIS_ASIGNACIONES}\` (listarMisAsignaciones)`,
    estatus: ESTATUS_DEL_PANEL_MENSAJERO,
  },
};

// =============================================================================================
// 0 — El detector, probado contra respuestas conocidas
// =============================================================================================

describe("0 — el detector de esta guardia no está roto", () => {
  it("los dos fuentes que lee existen, son grandes y son los que dice ser", () => {
    expect(FUENTE_ORDEN_REPO.length).toBeGreaterThan(10_000);
    expect(FUENTE_MIS_ASIGNACIONES.length).toBeGreaterThan(5_000);
    expect(FUENTE_ORDEN_REPO).toContain("novedadWhere");
    expect(FUENTE_MIS_ASIGNACIONES).toContain("findMisAsignaciones");
  });

  it("lo extraído son ESTATUS REALES del catálogo, no texto cualquiera", () => {
    // Non-vacuidad fuerte: si la extracción devolviera basura (un nombre de variable, un trozo
    // de sintaxis), esto la caza antes de que ninguna intersección diga nada.
    const catalogo = ORDER_STATUS_SEED as readonly string[];
    for (const valor of [...ESTATUS_DE_NOVEDADES, ...ESTATUS_DEL_PANEL_MENSAJERO]) {
      expect(catalogo, `\`${valor}\` no es un estatus del catálogo`).toContain(valor);
    }
    // 2026-08-19 (feature 236): siguen siendo DOS, y ahora son DOS PESTAÑAS en vez de dos ramas
    // de un `OR`. El número se conserva a propósito: el día que la pantalla gane un tercer grupo,
    // esto se pone rojo y hay que venir a decidir qué significa para la ventana de escritura — que
    // es exactamente lo que pasó las dos veces anteriores.
    expect(ESTATUS_DE_NOVEDADES.length).toBe(2);
    expect(ESTATUS_DEL_PANEL_MENSAJERO.length).toBeGreaterThan(0);
  });

  // =========================================================================================
  // LA ATADURA (feature 236, design §2.4) — lo que impide que esta guardia sea un espejo.
  //
  // Los estatus de la tienda ya no se leen del fuente: se leen del mapa. Eso, solo, dejaría a la
  // guardia midiendo un `Record` que nadie garantiza que el predicado use — y seguiría VERDE
  // después de que alguien moviera el corte de verdad, que es EXACTAMENTE el fallo que esta
  // guardia vino a cerrar. Los dos casos de aquí abajo son los que lo impiden.
  // =========================================================================================

  it("236/R5: `novedadWhere` TOMA su estatus del mapa (si deja de hacerlo, esto cae)", () => {
    expect(
      novedadWhereUsaElMapa(FUENTE_ORDEN_REPO),
      "el predicado central de `/novedades` dejó de indexar `ESTATUS_POR_GRUPO`. Si su estatus " +
        "sale ahora de otro sitio, esta guardia está midiendo un mapa que ya no manda: enséñale a " +
        "leer la fuente nueva — no la dejes verde.",
    ).toBe(true);
  });

  it("236/R3: el cuerpo de `novedadWhere` NO contiene NINGÚN literal de estatus", () => {
    // Ni directo (`{ estatus: { value: "devuelta" } }`) ni a través de un `const` del módulo
    // (`ESTATUS_DEVUELTA`), que es el mismo segundo literal con un nombre delante. Con esto, el
    // único origen posible de los estatus de esa pantalla es el mapa: leer el mapa ES leer el
    // predicado.
    expect(
      literalesDeEstatusEnNovedadWhere(FUENTE_ORDEN_REPO),
      "alguien escribió un estatus a mano dentro del predicado de `/novedades`. Ese es el " +
        "principio de las dos verdades: el servidor listaría una cosa y la pantalla ofrecería los " +
        "botones de otra. El valor sale de `ESTATUS_POR_GRUPO` y de ningún otro sitio.",
    ).toEqual([]);
  });

  // 2026-08-18 → 2026-08-19: la rama de AYUDA de `novedadWhere`, vigilada en cada una de sus
  // CUATRO formas, para que el comentario de `estatusDeNovedades` no se vuelva folclore.
  //
  //   (1) `{ ayuda: true }`                                → la fuga permanente (auditoría §2.1)
  //   (2) `{ ayuda: true, estatus: { value: en_reparto } }` → el tapón CON DUEÑO de la 239
  //   (3) `{ estatus: { value: ayuda_tienda } }` en un `OR` → feature 235/R30
  //   (4) su PROPIO predicado, tomado del mapa                → feature 236/R3, hoy
  //
  // Esta guardia estaba escrita para ponerse roja «el día que alguien añada otra rama», y se puso
  // roja las tres veces. La forma (4) es la que cierra el círculo: sin marca persistida Y sin
  // literal en el predicado, no queda ningún sitio donde una segunda verdad pueda esconderse.
  it("236/R3: no queda ninguna marca persistida en el predicado, y la ayuda tiene el suyo", () => {
    const cuerpo = FUENTE_ORDEN_REPO.slice(FUENTE_ORDEN_REPO.indexOf("private novedadWhere"));
    const predicado = cuerpo.slice(0, cuerpo.indexOf("};"));
    // El `not` que se pondría rojo si alguien repusiera «un booleano pequeño» al lado del estado.
    // Los dos nombres se construyen por CONCATENACIÓN y no como literal: los censos de
    // `ayuda-columna-retirada` y `gestion-aprobada-retirada` barren el árbol buscándolos, y un
    // literal aquí los pondría rojos por una aserción que comprueba justamente su ausencia. Es la
    // misma convención que usa el test de repositorio.
    expect(predicado).not.toMatch(new RegExp(["ayu", "da"].join("") + "\\s*:\\s*true"));
    expect(predicado).not.toMatch(new RegExp(["gestion", "Aprobada"].join("")));
    // Y el conjunto de la pantalla sigue siendo el par de siempre.
    expect([...ESTATUS_DE_NOVEDADES].sort()).toEqual(["ayuda_tienda", "devuelta"]);
  });

  it("la extracción REVIENTA si el patrón deja de encontrarse (nunca «nada → verde»)", () => {
    expect(() => literalesDeEstatusEnNovedadWhere("export class X {}", "falso.ts")).toThrow(
      /no se encontró la declaración de `novedadWhere`/,
    );
    expect(() => novedadWhereUsaElMapa("export class X {}", "falso.ts")).toThrow(
      /no se encontró la declaración de `novedadWhere`/,
    );
    expect(() => estatusDelPanelMensajero("export class X {}", "falso.ts")).toThrow(
      /no se encontró la declaración de `listarMisAsignaciones`/,
    );
    // Y si el método sigue ahí pero ya no dice lo que decía:
    expect(() =>
      estatusDelPanelMensajero(
        "class S { async listarMisAsignaciones(a: A) { this.repo.findMisAsignaciones(a.id); } }",
        "falso.ts",
      ),
    ).toThrow(/ya no recibe una lista literal/);
    // Un estatus que no se puede resolver a un literal tampoco pasa en silencio:
    expect(() =>
      estatusDelPanelMensajero(
        "class S { async listarMisAsignaciones(a: A) { this.repo.findMisAsignaciones(a.id, [DESCONOCIDO]); } }",
        "falso.ts",
      ),
    ).toThrow(/no se declara con un literal/);
  });

  it("CONTRAPRUEBA: sobre un fuente MUTADO, los detectores devuelven lo mutado", () => {
    // Lo que prueba que la extracción LEE el archivo en vez de repetir una respuesta fija.

    // (a) El predicado de HOY: sin literales y tomando del mapa.
    const repoSano = `
      class OrdenRepository {
        private novedadWhere(tiendaId: string, grupo: GrupoNovedad): Prisma.OrdenWhereInput {
          return { tiendaId, deletedAt: null, estatus: { value: ESTATUS_POR_GRUPO[grupo] } };
        }
      }`;
    expect(literalesDeEstatusEnNovedadWhere(repoSano, "falso.ts")).toEqual([]);
    expect(novedadWhereUsaElMapa(repoSano, "falso.ts")).toBe(true);

    // (b) Un literal plantado a mano: el detector lo VE, y lo ve con su nombre.
    const repoConLiteral = `
      class OrdenRepository {
        private novedadWhere(tiendaId: string, grupo: GrupoNovedad): Prisma.OrdenWhereInput {
          return { tiendaId, deletedAt: null, estatus: { value: "devuelta" } };
        }
      }`;
    expect(literalesDeEstatusEnNovedadWhere(repoConLiteral, "falso.ts")).toEqual(["devuelta"]);
    expect(novedadWhereUsaElMapa(repoConLiteral, "falso.ts")).toBe(false);

    // (c) El literal escondido detrás de un `const` del módulo — la forma que tenía este archivo
    //     hasta la 236. Sigue siendo un segundo literal, y se ve igual.
    const repoConConst = `
      const ESTATUS_DEVUELTA = "devuelta";
      class OrdenRepository {
        private novedadWhere(tiendaId: string): Prisma.OrdenWhereInput {
          return { tiendaId, deletedAt: null, estatus: { value: ESTATUS_DEVUELTA } };
        }
      }`;
    expect(literalesDeEstatusEnNovedadWhere(repoConConst, "falso.ts")).toEqual(["devuelta"]);

    // (d) Y el `OR` de ayer, con sus dos ramas: las DOS se ven.
    const repoConOr = `
      class OrdenRepository {
        private novedadWhere(tiendaId: string): Prisma.OrdenWhereInput {
          return { tiendaId, deletedAt: null, OR: [
            { estatus: { value: "devuelta" } },
            { estatus: { value: "ayuda_tienda" } },
          ] };
        }
      }`;
    expect(literalesDeEstatusEnNovedadWhere(repoConOr, "falso.ts")).toEqual([
      "ayuda_tienda",
      "devuelta",
    ]);

    const servicioMutado = `
      const ORIGEN_RECOGER = "por_recoger";
      const ESTADO_EN_REPARTO = "en_reparto";
      class MisAsignacionesService {
        async listarMisAsignaciones(actor: Actor): Promise<R> {
          const [rows] = await Promise.all([
            this.repo.findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOGER, ESTADO_EN_REPARTO, "recolectando"]),
          ]);
        }
      }`;
    expect(estatusDelPanelMensajero(servicioMutado, "falso.ts")).toEqual([
      "por_recoger",
      "en_reparto",
      "recolectando",
    ]);
  });

  it("236: la lista de pestañas y el mapa de grupos no pueden separarse", () => {
    // `estatusDeNovedades` recorre `GRUPOS_NOVEDAD`. Si un grupo estuviera en el mapa y no en la
    // lista, su estatus desaparecería del cruce de abajo sin que nada lo dijera: la tienda tendría
    // ventana de escritura sobre un estado cuya pestaña esta guardia habría dejado de ver.
    expect([...GRUPOS_NOVEDAD].sort()).toEqual(Object.keys(ESTATUS_POR_GRUPO).sort());
  });
});

// =============================================================================================
// R38 — ningún rol se queda con permiso y sin sitio donde ejercerlo
// =============================================================================================

describe("227 / R38 — el hilo es bidireccional de hecho", () => {
  it("la tabla de ventanas y el mapa de pantallas cubren EXACTAMENTE los mismos roles", () => {
    // Sin esto, un tercer rol con hilo entraría en `VENTANA_ESCRITURA` y saldría del cruce de
    // abajo sin que nadie lo notara: tendría permiso y nadie habría comprobado dónde ejercerlo.
    const conVentana = Object.keys(VENTANA_ESCRITURA).sort();
    expect([...ROLES_CON_HILO].sort()).toEqual(conVentana);
    expect(Object.keys(PANTALLA_POR_ROL).sort()).toEqual(conVentana);
  });

  it("cada rol tiene al menos un estatus alcanzable en su pantalla donde puede publicar", () => {
    // 2026-08-19 (feature 235/T5.2): la ventana pasó de UN valor por rol a una LISTA por rol, así
    // que el cruce pasa de una comparación a una INTERSECCIÓN de conjuntos. La propiedad que
    // protege es la misma, palabra por palabra: intersección no vacía para los DOS roles.
    const sinDondeEscribir: string[] = [];

    for (const rol of ROLES_CON_HILO) {
      const ventana = VENTANA_ESCRITURA[rol] as readonly string[];
      const pantalla = PANTALLA_POR_ROL[rol];
      const interseccion = pantalla.estatus.filter((estatus) => ventana.includes(estatus));
      if (interseccion.length === 0) {
        sinDondeEscribir.push(
          `${rol}: su ventana de escritura es [${ventana.join(", ")}], pero su pantalla ` +
            `(${pantalla.donde}) solo lista [${pantalla.estatus.join(", ")}] — el permiso existe ` +
            `y es INEJERCITABLE`,
        );
      }
    }

    expect(
      sinDondeEscribir,
      "es el agujero que cerró la decisión D1: un rol con permiso de escritura y sin ningún " +
        "estado alcanzable en su propia pantalla donde ejercerlo convierte el hilo bidireccional " +
        "en unidireccional de hecho (R38). Si de verdad hay que mover una ventana o un corte de " +
        "pantalla, muévelos JUNTOS.",
    ).toEqual([]);
  });

  // ===========================================================================================
  // 236/R36 — LA PROPIEDAD SUBE: de «intersección no vacía» a «IGUALDAD EXACTA», para la tienda.
  //
  // Por qué se puede afirmar ahora y no antes. Hasta la 236, los estatus de `/novedades` salían de
  // una regex sobre el fuente y lo único honesto que se podía cruzar con la ventana era una
  // intersección: bastaba con que UNO de los estados listados estuviera en la ventana. Eso dejaba
  // pasar el caso feo —la pantalla lista un estado en el que la tienda NO puede escribir, así que
  // ve una fila y no puede contestar en su hilo— que es exactamente el defecto que la 236 cierra:
  // durante un día, `/novedades` listó órdenes en ayuda y la tienda no tenía dónde leer el motivo.
  //
  // Con el mapa como fuente única, se puede exigir lo de verdad: **el conjunto de estados que la
  // tienda alcanza es EXACTAMENTE su ventana de escritura**. Ni uno de más (una fila muda) ni uno
  // de menos (una ventana abierta sin pantalla donde ejercerla). Es la forma ejecutable de la
  // enmienda de R35 de la 235: *cada estado en el que un rol puede escribir tiene una pantalla
  // donde ejercerlo, y cada estado que su pantalla lista es uno en el que puede escribir*.
  //
  // ⚠️ Se afirma SOLO para el `adminTienda`, y a propósito. El panel del mensajero lista TRES
  // estatus (`por_recoger`, `en_reparto`, `ayuda_tienda`) y su ventana son DOS: `por_recoger` NO
  // abre ventana deliberadamente (la orden aún no salió a reparto, feature 227 design §2.2). Ahí
  // la propiedad correcta sigue siendo la inclusión, no la igualdad.
  // ===========================================================================================
  it("236/R36: los estatus que la TIENDA alcanza son EXACTAMENTE su ventana de escritura", () => {
    const ventana = [...(VENTANA_ESCRITURA.adminTienda as readonly string[])].sort();
    const pantalla = [...PANTALLA_POR_ROL.adminTienda.estatus].sort();
    expect(
      pantalla,
      "la pantalla de la tienda y su ventana de escritura se han separado. Si sobra un estado, " +
        "la tienda ve una fila sobre la que no puede contestar en el hilo — el defecto que la 236 " +
        "vino a cerrar. Si falta, tiene permiso y ningún sitio donde ejercerlo (R36). Se mueven " +
        "JUNTOS: `ESTATUS_POR_GRUPO` y `VENTANA_ESCRITURA.adminTienda`.",
    ).toEqual(ventana);
  });

  it("227/R38: para el MENSAJERO la propiedad sigue siendo inclusión, y `por_recoger` sobra", () => {
    // El complemento del caso de arriba, dicho para que su asimetría no se lea como un olvido.
    const ventana = VENTANA_ESCRITURA.mensajero as readonly string[];
    for (const estatus of ventana) {
      expect(PANTALLA_POR_ROL.mensajero.estatus, estatus).toContain(estatus);
    }
    // Y el que su pantalla lista sin ventana, nombrado: la orden aún no salió a reparto.
    expect(PANTALLA_POR_ROL.mensajero.estatus).toContain("por_recoger");
    expect(ventana).not.toContain("por_recoger");
  });
});

// =============================================================================================
// R36 — el corte de la feature 167/R34 no se toca
// =============================================================================================

describe("227 / R36 — el panel del mensajero sigue leyendo lo que leía", () => {
  it("listarMisAsignaciones lee exactamente por_recoger, en_reparto y ayuda_tienda", () => {
    // Censo CERRADO, y a propósito: ni uno más ni uno menos. Uno menos rompería R38 (el
    // mensajero se quedaría sin la orden en la que publica); uno de más sería una feature
    // ensanchando el corte de la 167 por la puerta de atrás.
    //
    // 2026-08-19 (feature 235/T3.1, R18/R19) — EL CENSO PASA DE 2 A 3, y entra por la puerta:
    // `ayuda_tienda` se lee porque el portal tiene que ENTREGAR esas órdenes YA SEPARADAS desde el
    // servidor (R18); antes la separación era un `useMemo` de cliente sobre una bandera y la orden
    // seguía siendo parada del mapa y gestionable. La propiedad que este censo protege se
    // conserva: sigue siendo CERRADO y `recolectando` SIGUE FUERA, que es exactamente lo que la
    // 167 aisló.
    expect([...ESTATUS_DEL_PANEL_MENSAJERO].sort()).toEqual([
      "ayuda_tienda",
      "en_reparto",
      "por_recoger",
    ]);
    expect(ESTATUS_DEL_PANEL_MENSAJERO).toHaveLength(3);
    // Lo que la 167 aisló, dicho como negativo para que no se pierda al crecer el censo.
    expect(ESTATUS_DEL_PANEL_MENSAJERO).not.toContain("recolectando");
  });

  it("y `/novedades` lista exactamente `devuelta` (devolución) y `ayuda_tienda` (ayuda)", () => {
    // La otra mitad del cruce, dicha también como valor: si el predicado central de novedades
    // cambiara de estatus, la ventana del adminTienda tendría que moverse con él.
    //
    // 2026-08-19 (feature 235/R30): siguen siendo DOS y las dos son igualdades de estado.
    // `devuelta` es la devolución anclada; `ayuda_tienda` es la solicitud de ayuda viva, y ese
    // segundo value está TAMBIÉN en la ventana del mensajero: por esa rama los dos roles miran la
    // MISMA orden a la vez, que es literalmente lo que el hilo bidireccional necesita para servir
    // de algo (R34).
    //
    // 2026-08-19 (feature 236/R1): siguen siendo esos DOS, pero ya no son dos ramas de un `OR`
    // bajo una sola pestaña — son DOS PESTAÑAS, cada una con su predicado. El conjunto que este
    // caso fija es el mismo; lo que cambió es que ahora una orden vive en exactamente una de las
    // dos, por construcción (una orden tiene un `estatus_id` y solo uno).
    expect([...ESTATUS_DE_NOVEDADES].sort()).toEqual(["ayuda_tienda", "devuelta"]);
    expect(ESTATUS_DE_NOVEDADES).toHaveLength(2);
  });

  // 2026-08-19 (feature 235/R34/R35) — EL SOLAPE, afirmado por sí mismo. Es lo que convierte el
  // hilo en una conversación y no en dos monólogos: hay UN estado en el que los dos roles pueden
  // escribir sobre la misma orden, y los dos lo tienen en su pantalla.
  it("235/R34: `ayuda_tienda` es el ÚNICO estado en el que los dos roles pueden escribir", () => {
    const tienda = VENTANA_ESCRITURA.adminTienda as readonly string[];
    const mensajero = VENTANA_ESCRITURA.mensajero as readonly string[];
    const solape = tienda.filter((e) => mensajero.includes(e));
    expect(solape).toEqual(["ayuda_tienda"]);
    // Y ese estado está en las DOS pantallas: sin eso, el permiso sería inejercitable para uno de
    // los dos (R35) y el hilo volvería a ser unidireccional de hecho.
    expect(PANTALLA_POR_ROL.adminTienda.estatus).toContain("ayuda_tienda");
    expect(PANTALLA_POR_ROL.mensajero.estatus).toContain("ayuda_tienda");
  });
});

// =============================================================================================
// 236/R36 (T6.6) — LA ENMIENDA DE R35 DE LA 235, CERRADA: EL PERMISO TIENE SUPERFICIE MONTADA.
//
// **Qué le faltaba a todo lo de arriba.** Los cruces anteriores comparan la ventana de escritura de
// cada rol con los estatus que su pantalla LISTA. Es necesario y no es suficiente: durante un día
// entero `/novedades` listó las órdenes en `ayuda_tienda` —la intersección con la ventana del
// `adminTienda` no estaba vacía y todo esto seguía verde— y la tienda **no tenía dónde leer ni
// contestar el hilo**, porque el 2026-08-18 se retiró el botón «Notas» y con él el único montaje de
// `HiloNotasNovedadModal`. El permiso existía, el estado era alcanzable, y la superficie no estaba.
//
// La 235 lo dejó escrito como deuda con dueño («RECONCILIACIÓN DE R35»: *para el `adminTienda` es
// la pestaña de la ficha 236, que monta la card y su hilo… Dueño y fecha de muerte: ficha 236*).
// Este bloque es su forma ejecutable, y por eso vive aquí y no en un test de componente: es un
// cruce entre una TABLA DE PERMISOS y unos MONTAJES, y ninguno de los dos lados lo ve solo.
//
// **Se pone rojo si se desmonta cualquiera de los dos.** Es exactamente la mutación que hay que
// impedir: quitar un botón «porque estorba» sin mirar quién era el único que llegaba a él.
// =============================================================================================

/** Los dos montajes del hilo, uno por rol, leídos del fuente de la pantalla que los monta. */
const MONTAJE_DEL_HILO: Record<RolConHilo, { pantalla: string; modal: string }> = {
  adminTienda: {
    pantalla: "app/(app)/novedades/_components/NovedadesModule.tsx",
    modal: "HiloNotasNovedadModal",
  },
  mensajero: {
    pantalla: "app/(app)/mis-asignaciones/_components/RepartoModule.tsx",
    modal: "HiloNotasAyudaModal",
  },
};

/** El estatus en el que los dos roles se cruzan: la solicitud de ayuda viva. */
const ESTATUS_AYUDA = "ayuda_tienda";

/**
 * `true` si `fuente` MONTA el componente (`<Modal …`), no si sólo lo importa. Importarlo y no
 * renderizarlo es exactamente el estado en el que quedó el modal de la tienda entre el 2026-08-18 y
 * el 2026-08-19 (`@sin-superficie`), y la suite entera no lo vio.
 *
 * ⚠️ El `\\b` va DOBLE: `\b` dentro de un template literal de JS es el carácter BACKSPACE, no la
 * frontera de palabra del regex. Es la misma clase de fallo que el spec advierte para `node -e`, y
 * se cazó en la primera corrida de esta guardia: denunciaba los DOS montajes —incluido el del
 * mensajero, que lleva un día montado— porque buscaba un backspace. Un censo con el escape mal
 * puesto no falla ruidosamente: afirma de más o de menos, y las dos veces en verde. Por eso la
 * construcción vive en esta función y la CONTRAPRUEBA de abajo la ejerce a ella y no a un regex
 * literal escrito aparte — un regex literal correcto al lado de una plantilla rota es justo lo que
 * dejó pasar el fallo.
 */
export function montaEl(fuente: string, modal: string): boolean {
  return new RegExp(`<${modal}\\b`).test(fuente);
}

describe("236 / R36 — ningún rol con ventana sobre la ayuda se queda sin dónde escribir", () => {
  it("los DOS roles con ventana sobre `ayuda_tienda` tienen su hilo MONTADO", () => {
    const conVentanaSobreAyuda = ROLES_CON_HILO.filter((rol) =>
      (VENTANA_ESCRITURA[rol] as readonly string[]).includes(ESTATUS_AYUDA),
    );
    // Anti-vacuidad: si nadie tuviera ventana sobre la ayuda, el bucle de abajo no ejercería nada
    // y este bloque pasaría diciendo cero.
    expect([...conVentanaSobreAyuda].sort()).toEqual(["adminTienda", "mensajero"]);

    const sinSuperficie: string[] = [];
    for (const rol of conVentanaSobreAyuda) {
      const { pantalla, modal } = MONTAJE_DEL_HILO[rol];
      const fuente = codigoSinComentarios(pantalla);
      if (!montaEl(fuente, modal)) {
        sinSuperficie.push(
          `${rol}: su ventana incluye \`${ESTATUS_AYUDA}\` pero ${pantalla} ya no monta ` +
            `<${modal}>. Tiene el permiso y NINGÚN sitio donde ejercerlo`,
        );
      }
    }

    expect(
      sinSuperficie,
      "es la enmienda de R35 de la 235, y su historia está medida: entre el 2026-08-18 y el " +
        "2026-08-19 la tienda tuvo la ventana abierta sobre las órdenes en ayuda y ninguna forma " +
        "de leer el motivo que el mensajero escribía —una nota OBLIGATORIA— porque alguien quitó " +
        "el botón que abría el hilo. Si hay que retirar un montaje, hay que estrechar la ventana " +
        "CON él.",
    ).toEqual([]);
  });

  it("y cada montaje se abre desde una ACCIÓN de la fila, no desde ningún sitio", () => {
    // La mitad que el censo de arriba no ve: el componente puede estar en el JSX y su estado no
    // tener quien lo encienda —el cable suelto—. Se comprueba que el modal se monta condicionado a
    // un estado que ALGUIEN pone: `ordenConHilo` en la tienda, `hiloOrden` en el mensajero.
    const tienda = codigoSinComentarios(MONTAJE_DEL_HILO.adminTienda.pantalla);
    expect(tienda).toMatch(/setOrdenConHilo\b/);
    expect(tienda).toMatch(/ordenConHilo\s*\?/);
    const mensajero = codigoSinComentarios(MONTAJE_DEL_HILO.mensajero.pantalla);
    expect(mensajero).toMatch(/setHiloOrden\b/);
    expect(mensajero).toMatch(/hiloOrden\s*!==\s*null\s*\?/);
  });

  it("CONTRAPRUEBA: el detector de montaje distingue montar de sólo importar", () => {
    // Sin esto, el caso de arriba podría estar leyendo la línea del `import` y seguiría verde con
    // el modal desmontado — que es literalmente el estado que vino a impedir.
    //
    // Se ejerce `montaEl`, LA MISMA función que usa el caso real. Ejercer aquí un regex literal
    // escrito aparte es lo que dejó pasar el fallo del escape en la primera corrida: el literal
    // estaba bien y la plantilla del censo, rota.
    const soloImporta = `import { HiloNotasNovedadModal } from "./HiloNotasNovedadModal";
      export function M() { return <div />; }`;
    expect(montaEl(soloImporta, "HiloNotasNovedadModal")).toBe(false);
    const montado = `${soloImporta}
      const x = <HiloNotasNovedadModal key={o.id} orden={o} onOpenChange={f} />;`;
    expect(montaEl(montado, "HiloNotasNovedadModal")).toBe(true);
    // Y no confunde un componente con otro cuyo nombre lo contenga como prefijo: sin la frontera
    // de palabra, `<HiloNotasNovedadModalViejo>` contaría como el montaje bueno.
    expect(
      montaEl(`<HiloNotasNovedadModalViejo />`, "HiloNotasNovedadModal"),
      "la frontera de palabra del detector no está haciendo su trabajo",
    ).toBe(false);
  });
});
