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
// **De dónde salen los dos conjuntos, y por qué se leen del FUENTE.** La ventana se importa como
// valor (`VENTANA_ESCRITURA`, exportada `as const` precisamente para esto). Los cortes de pantalla
// NO se pueden importar: `ESTATUS_DEVUELTA` (`OrdenRepository`) y `ORIGEN_RECOGER` /
// `ESTADO_EN_REPARTO` (`MisAsignacionesService`) son `const` privados de módulo. Copiarlos a mano
// aquí convertiría la guardia en un espejo de sí misma: seguiría verde después de que alguien
// moviera el corte de verdad, que es EXACTAMENTE el fallo que vino a cerrar. Así que se leen del
// texto fuente, como hacen las demás guardias de escaneo de este repo.
//
// **Y si el fuente deja de encontrarse, esto se pone ROJO.** Cada paso de la extracción falla con
// un mensaje que dice qué patrón dejó de casar y en qué archivo. Una guardia estática que no
// encuentra nada y lo reporta como «no hay infracciones» es peor que no tenerla.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
import { describe, it, expect } from "vitest";

import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
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
 * Lo que `/novedades` lista POR ESTATUS: TODOS los `estatus: { value: … }` del predicado central
 * `OrdenRepository.novedadWhere`. Hoy es uno solo, y que sea uno solo es parte de la afirmación
 * (la comprobación vive abajo, en el bloque 0).
 *
 * ⚠️ 2026-08-18 — `novedadWhere` DEJÓ DE SER UN SOLO PREDICADO DE ESTATUS. Con la solicitud de
 * ayuda pasó a un `OR` de dos ramas: la de siempre (`estatus = devuelta`) y una que NO mira el
 * estatus (`ayuda: true`), por la que entran órdenes que siguen en reparto.
 *
 * Esa segunda rama no puede participar de la intersección que hace esta guardia —no aporta ningún
 * estatus con el que cruzar la ventana—, así que se deja fuera A PROPÓSITO y no por descuido: R38
 * sigue sosteniéndose sobre `devuelta`, que es donde el adminTienda escribe.
 *
 * Lo que SÍ cambió es la extracción: antes tomaba la PRIMERA coincidencia y se quedaba tan
 * tranquila. Con un `OR` de por medio, eso significa que añadir una segunda rama con OTRO estatus
 * habría pasado inadvertido —la guardia habría seguido verde afirmando un universo incompleto—.
 * Ahora se recogen TODAS y el bloque 0 exige que siga habiendo exactamente una: el día que alguien
 * añada otra, esto se pone rojo y hay que venir a decidir qué significa para la ventana.
 */
export function estatusDeNovedades(fuente: string, ruta = RUTA_ORDEN_REPO): string[] {
  const cuerpo = cuerpoDeMiembro(
    fuente,
    ruta,
    /private\s+novedadWhere\s*\(/,
    "la declaración de `novedadWhere`",
  );
  const encontrados = [
    ...cuerpo.matchAll(/estatus\s*:\s*\{\s*value\s*:\s*([^,}]+?)\s*\}/g),
  ];
  if (encontrados.length === 0) {
    reventar(`${ruta}: \`novedadWhere\` ya no acota \`estatus: { value: … }\``);
  }
  return encontrados.map((m) => valorDe(fuente, ruta, m[1]));
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

const ESTATUS_DE_NOVEDADES = estatusDeNovedades(FUENTE_ORDEN_REPO);
const ESTATUS_DEL_PANEL_MENSAJERO = estatusDelPanelMensajero(FUENTE_MIS_ASIGNACIONES);

/**
 * La pantalla de CADA rol. El mapeo rol → pantalla se escribe aquí (es la premisa del spec: la
 * tienda ve el hilo en `/novedades`, el mensajero en su panel); los ESTATUS de cada una salen del
 * fuente, que es lo que puede moverse sin que nadie se entere.
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
    // 2026-08-19 (feature 239/R22): pasan de UNO a DOS. La rama de ayuda dejo de ser «la que no
    // mira el estatus» — ahora exige `en_reparto`, para que una solicitud vieja no sostenga la
    // fila despues de que la orden salga de reparto (la fuga permanente de la auditoria §2.1).
    expect(ESTATUS_DE_NOVEDADES.length).toBe(2);
    expect(ESTATUS_DEL_PANEL_MENSAJERO.length).toBeGreaterThan(0);
  });

  // 2026-08-18 — la rama de AYUDA de `novedadWhere`, vigilada explícitamente para que el
  // comentario de `estatusDeNovedades` no se vuelva folclore. Si la solicitud de ayuda se
  // retirara algún día, esto se pone rojo y obliga a releer aquel razonamiento en vez de dejarlo
  // describiendo un código que ya no existe.
  //
  // INVERTIDO el 2026-08-19 (feature 239/R22), y la inversión es una MEJORA del cruce, no un
  // apaño. Esta guardia estaba escrita para ponerse roja «el día que alguien añada otra rama con
  // estatus», y eso es exactamente lo que pasó: la rama de ayuda dejó de ser la que no mira el
  // estatus. Lo que significa para la ventana:
  //
  //   - la tienda ya no ve una orden por una solicitud de ayuda ANTIGUA sobre algo que salió de
  //     reparto (era la fuga permanente: el corte nocturno la barría a `sin_gestionar` sin apagar
  //     el flag, y ahí se quedaba para siempre);
  //   - y el estatus que aporta esa rama, `en_reparto`, es JUSTO la ventana del mensajero. Así
  //     que ahora las dos ramas de la pantalla de la tienda cruzan con una ventana real: la suya
  //     por `devuelta` y la del mensajero por `en_reparto`. R38 se sostiene por dos sitios en vez
  //     de por uno.
  it("la rama de AYUDA de `novedadWhere` existe y está ACOTADA a reparto (R22)", () => {
    const cuerpo = FUENTE_ORDEN_REPO.slice(
      FUENTE_ORDEN_REPO.indexOf("novedadWhere"),
    );
    const cierre = cuerpo.indexOf("],\n    };");
    const predicado = cuerpo.slice(0, cierre);
    expect(predicado).toMatch(/ayuda\s*:\s*true/);
    // Y la rama de ayuda YA NO viaja sola: lleva su estatus pegado en la misma clave hermana.
    expect(predicado).toMatch(/ayuda\s*:\s*true,\s*estatus\s*:\s*\{\s*value\s*:/);
    expect([...ESTATUS_DE_NOVEDADES].sort()).toEqual(["devuelta", "en_reparto"]);
  });

  it("la extracción REVIENTA si el patrón deja de encontrarse (nunca «nada → verde»)", () => {
    expect(() => estatusDeNovedades("export class X {}", "falso.ts")).toThrow(
      /no se encontró la declaración de `novedadWhere`/,
    );
    expect(() => estatusDelPanelMensajero("export class X {}", "falso.ts")).toThrow(
      /no se encontró la declaración de `listarMisAsignaciones`/,
    );
    // Y si el método sigue ahí pero ya no dice lo que decía:
    expect(() =>
      estatusDeNovedades("class R { private novedadWhere(t: string) { return { tiendaId: t }; } }", "falso.ts"),
    ).toThrow(/ya no acota/);
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

  it("CONTRAPRUEBA: sobre un fuente MUTADO, el detector devuelve lo mutado", () => {
    // Lo que prueba que la extracción LEE el archivo en vez de repetir una respuesta fija.
    const repoMutado = `
      const ESTATUS_DEVUELTA = "entregada";
      class OrdenRepository {
        private novedadWhere(tiendaId: string): Prisma.OrdenWhereInput {
          return { tiendaId, deletedAt: null, estatus: { value: ESTATUS_DEVUELTA } };
        }
      }`;
    expect(estatusDeNovedades(repoMutado, "falso.ts")).toEqual(["entregada"]);

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
    const sinDondeEscribir: string[] = [];

    for (const rol of ROLES_CON_HILO) {
      const ventana = VENTANA_ESCRITURA[rol];
      const pantalla = PANTALLA_POR_ROL[rol];
      const interseccion = pantalla.estatus.filter((estatus) => estatus === ventana);
      if (interseccion.length === 0) {
        sinDondeEscribir.push(
          `${rol}: su ventana de escritura es \`${ventana}\`, pero su pantalla ` +
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
});

// =============================================================================================
// R36 — el corte de la feature 167/R34 no se toca
// =============================================================================================

describe("227 / R36 — el panel del mensajero sigue leyendo lo que leía", () => {
  it("listarMisAsignaciones sigue leyendo exactamente por_recoger y en_reparto", () => {
    // Censo CERRADO, y a propósito: ni uno más ni uno menos. Uno menos rompería R38 (el
    // mensajero se quedaría sin la orden en la que publica); uno más sería la feature 227
    // ensanchando el corte de la 167 por la puerta de atrás — lo que la 167 aisló fue
    // precisamente que `recolectando` NO se lea desde aquí.
    expect([...ESTATUS_DEL_PANEL_MENSAJERO].sort()).toEqual(["en_reparto", "por_recoger"]);
    expect(ESTATUS_DEL_PANEL_MENSAJERO).toHaveLength(2);
  });

  it("y `/novedades` lista exactamente `devuelta` (devolución) y `en_reparto` (ayuda)", () => {
    // La otra mitad del cruce, dicha también como valor: si el predicado central de novedades
    // cambiara de estatus, la ventana del adminTienda tendría que moverse con él.
    //
    // 2026-08-19 (feature 239/R22): son DOS. `devuelta` es la devolución anclada —donde la tienda
    // escribe— y `en_reparto` es la orden con solicitud de ayuda viva, que además coincide con la
    // ventana del mensajero: por esa rama los dos roles miran la MISMA orden a la vez, que es
    // literalmente lo que el hilo bidireccional necesita para servir de algo.
    expect([...ESTATUS_DE_NOVEDADES].sort()).toEqual(["devuelta", "en_reparto"]);
    expect(ESTATUS_DE_NOVEDADES).toHaveLength(2);
  });
});
