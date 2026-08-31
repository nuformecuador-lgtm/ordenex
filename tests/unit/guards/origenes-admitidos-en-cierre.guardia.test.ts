import { describe, it, expect } from "vitest";

import {
  ORDEN_HISTORIAL_ORIGEN_TIPO_SEED,
  ORIGENES_GESTION_FUERA_DEL_CIERRE,
  type OrdenHistorialOrigenTipo,
} from "@/lib/types/orden-historial";
import { ORIGENES_GESTION_DE_LA_TIENDA } from "@/lib/utils/gestion-de-la-tienda-flag";

/**
 * 💰 FICHA 337 (2026-08-31) — EL CONJUNTO DE ORIGENES ADMITIDOS EN UN CIERRE ES **CERRADO**.
 *
 * QUE PROBLEMA RESUELVE ESTE ARCHIVO, y no es hipotetico: el defecto de la 337 nacio de DOS
 * decisiones deliberadas, tomadas con meses de diferencia y cada una razonable por separado —la
 * 100 (`reprogramacion_tienda`) y la 240 (`rechazo_tienda`) crearon su gestion con `cierre_id`
 * NULL «para que la recoja el proximo cierre»—. Nadie mintio y ningun test se puso rojo: es que
 * NADIE TENIA QUE DECIDIR NADA. La pertenencia al cierre era universal por omision, asi que una
 * familia nueva entraba sola.
 *
 * Este guardia cierra esa puerta. La pertenencia deja de ser una omision y pasa a ser una
 * PARTICION declarada: cada familia del enum esta o ADMITIDA o FUERA, nunca en ninguna de las dos
 * ni en las dos a la vez. En cuanto `orden_historial_origen_tipo` gane un valor, este archivo se
 * pone ROJO y obliga a escribir en que lado cae — en voz alta, en un diff, con un nombre encima.
 *
 * POR QUE `ADMITIDOS` SE ESCRIBE A MANO AQUI y no se deriva de produccion. Derivarlo
 * (`SEED.filter((x) => !FUERA.includes(x))`) daria un test SIEMPRE VERDE: estaria comparando la
 * lista contra la funcion que la genera. Este repo ya se comio esa: una asercion contra su propia
 * fuente dejo pasar un tope que la aplicacion rechazaba. El literal de abajo es el CONTRATO —lo
 * que un humano afirmo el 2026-08-31—, no una copia de nada.
 */

/**
 * Las 31 familias que SI pueden pertenecer al cierre de un mensajero, escritas a mano.
 *
 * LA MAYORIA NI SIQUIERA PUEDE ENLAZAR UNA GESTION (`generacion_guia`, `carga_masiva`, …), y
 * estan igual: el criterio de esta lista NO es «¿produce gestiones hoy?» —que es una propiedad
 * que cambia sin avisar en cuanto alguien escribe un productor nuevo— sino «si un dia produjera
 * una, ¿esa gestion seria trabajo del mensajero?». Con el criterio estrecho, una familia inocua
 * de hoy podria ganar un productor mañana y colarse en los cierres sin que este guardia dijera
 * nada: exactamente el fallo que la ficha 337 viene a impedir.
 *
 * ⚠️ LOS TRES NOMBRES QUE HAY QUE MIRAR ANTES DE TOCAR ESTA LISTA, porque son los que hoy meten
 * gestiones sinteticas en el cierre de alguien y siguen ADMITIDOS a sabiendas:
 *   - `gestion_tienda_ayuda` (237) — DENTRO por decision humana explicita («lo que no es ayuda»):
 *     la visita la hizo el mensajero y la tienda solo la cerro por el.
 *   - `escalado_devuelta_sla` (99) — DENTRO: mueve dinero VIVO por el cierre (`cobroRechazado`,
 *     56) y sacarla sin via propia pausaria un ingreso que hoy si se emite. Alcance ajeno a la
 *     337, y por eso queda DICHO en vez de hecho en silencio.
 *   - `rechazo_tope_intentos` (276) — DENTRO por lo mismo, y ademas su gestion nace DENTRO de la
 *     transaccion que aprueba un cierre.
 */
const ORIGENES_ADMITIDOS_EN_CIERRE = [
  "carga_masiva",
  "creacion_manual",
  "generacion_guia",
  "asignacion_bodega",
  "ruteo_satelite",
  "recepcion_satelite",
  "asignacion_satelite",
  "recoleccion",
  "gestion", // la visita de calle: el caso normal, el que sostiene el cierre entero
  "liberacion_reprogramada",
  "ajuste_estado",
  "deshacer_gestion",
  "carga_api",
  "liberacion_devuelta_sla",
  "escalado_devuelta_sla", // ⚠️ sintetica y ADMITIDA a sabiendas (ver arriba)
  "recuperacion_manual",
  "cancelacion_api",
  "corte_sin_gestionar",
  "liberacion_sin_gestionar",
  "recepcion_bodega_central",
  "devolucion_rechazada",
  "recoleccion_tienda",
  "incidente",
  "deshacer_asignacion",
  "asignacion_recoleccion",
  "anclaje_devolucion",
  "solicitud_ayuda_tienda",
  "rescate_ayuda_tienda",
  "gestion_tienda_ayuda", // ⚠️ DENTRO por pedido humano explicito (ver arriba)
  "habilitacion_api",
  "rechazo_tope_intentos", // ⚠️ sintetica y ADMITIDA a sabiendas (ver arriba)
] as const satisfies readonly OrdenHistorialOrigenTipo[];

const orden = (xs: readonly string[]) => [...xs].sort();

describe("💰 337 — los origenes admitidos en un cierre son un conjunto CERRADO", () => {
  // ⭑ EL CASO QUE OBLIGA A DECIDIR. Si el enum gana una familia, no cae en ninguna de las dos
  // listas y esta union deja de cuadrar.
  it("ADMITIDOS ∪ FUERA = el enum entero: ninguna familia queda sin decidir", () => {
    expect(
      orden([...ORIGENES_ADMITIDOS_EN_CIERRE, ...ORIGENES_GESTION_FUERA_DEL_CIERRE]),
    ).toEqual(orden(ORDEN_HISTORIAL_ORIGEN_TIPO_SEED));
  });

  it("ADMITIDOS ∩ FUERA = ∅: ninguna familia esta a la vez dentro y fuera", () => {
    const fuera = new Set<string>(ORIGENES_GESTION_FUERA_DEL_CIERRE);
    expect(ORIGENES_ADMITIDOS_EN_CIERRE.filter((o) => fuera.has(o))).toEqual([]);
  });

  // ⭑ EL NUCLEO DE LA FICHA, dicho como literal y no como propiedad derivada: son ESTAS DOS y no
  // otras. Si alguien añade una tercera sin pensarlo, este caso lo dice por su nombre.
  it("las que NO entran son EXACTAMENTE las dos de escritorio", () => {
    expect(orden(ORIGENES_GESTION_FUERA_DEL_CIERRE)).toEqual([
      "rechazo_tienda",
      "reprogramacion_tienda",
    ]);
  });

  // ⭑ LA REGRESION QUE MAS DUELE, y por eso se afirma sola: la ayuda es trabajo REAL del
  // mensajero. Meterla en la lista de exclusion vaciaria de contenido los cierres de la 237.
  it("`gestion_tienda_ayuda` esta ADMITIDA (pedido humano: «lo que no es ayuda»)", () => {
    expect([...ORIGENES_GESTION_FUERA_DEL_CIERRE]).not.toContain("gestion_tienda_ayuda");
    expect([...ORIGENES_ADMITIDOS_EN_CIERRE]).toContain("gestion_tienda_ayuda");
  });

  // La gestion de calle, que es el 100 % de lo que un cierre existe para documentar.
  it("`gestion` (la visita de calle) esta ADMITIDA", () => {
    expect([...ORIGENES_GESTION_FUERA_DEL_CIERRE]).not.toContain("gestion");
    expect([...ORIGENES_ADMITIDOS_EN_CIERRE]).toContain("gestion");
  });

  // Las otras dos sinteticas que SIGUEN entrando. Se afirma su presencia para que retirarlas sea
  // un cambio visible y no un efecto lateral: cada una pausaria un ingreso que hoy SI se emite.
  it("`escalado_devuelta_sla` y `rechazo_tope_intentos` siguen ADMITIDAS (alcance ajeno, declarado)", () => {
    for (const familia of ["escalado_devuelta_sla", "rechazo_tope_intentos"] as const) {
      expect([...ORIGENES_GESTION_FUERA_DEL_CIERRE]).not.toContain(familia);
      expect([...ORIGENES_ADMITIDOS_EN_CIERRE]).toContain(familia);
    }
  });

  // ⭑ LA RELACION CON LA OTRA LISTA DE LA TIENDA, que es donde esta la trampa de lectura:
  // `ORIGENES_GESTION_DE_LA_TIENDA` (237/240) responde «¿quien la registro?» y bloquea el
  // DESHACER; esta responde «¿de quien es el trabajo?» y decide el CIERRE. Se solapan en
  // `rechazo_tienda` y NO en las otras dos, y esa asimetria es la ficha entera. Quien las funda
  // en una sola, o saca la ayuda del cierre o vuelve a meter la reprogramacion.
  it("las dos listas de la tienda NO son la misma, y se dice cual es la diferencia", () => {
    expect(orden(ORIGENES_GESTION_DE_LA_TIENDA)).toEqual([
      "gestion_tienda_ayuda",
      "rechazo_tienda",
    ]);
    expect(orden(ORIGENES_GESTION_FUERA_DEL_CIERRE)).toEqual([
      "rechazo_tienda",
      "reprogramacion_tienda",
    ]);
    // La interseccion es UNA sola familia: el rechazo de escritorio, que ni se deshace ni entra.
    const fuera = new Set<string>(ORIGENES_GESTION_FUERA_DEL_CIERRE);
    expect(ORIGENES_GESTION_DE_LA_TIENDA.filter((o) => fuera.has(o))).toEqual(["rechazo_tienda"]);
  });
});
