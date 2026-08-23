// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";
import {
  ETIQUETA_CORRECCION_DIA,
  textoCorreccionDiaReparto,
} from "@/lib/utils/dia-reparto-textos";

// R30: lo verificado es "se presenta la ETIQUETA legible del estado, nunca el value
// crudo". Se aserta contra el mapa de presentación (fuente de verdad) en vez de
// literales, para que un rebrand de etiquetas no rompa este archivo. Los literales
// del mapa los blinda `tests/components/EstatusLabel.test.ts`.
const L = ORDER_STATUS_LABELS;

// Feature 49 (T6.1) — timeline de PRESENTACION del historial. Cubre R29 (secuencia legible
// con estado destino, actor y motivo) y R30 (etiquetas legibles via `estatus-label`, NUNCA
// UUIDs/values crudos). Recibe las entradas por props (R28: no fetchea).

afterEach(() => {
  cleanup();
});

// Entradas MIXTAS y ya ordenadas cronologicamente (asc):
//  1) creacion (origen null) con actor tienda y sin motivo
//  2) gestion con actor mensajero y motivo
//  3) liberacion del cron con actor null (-> "Sistema") y sin motivo
const ENTRADAS: OrdenHistorialEntradaDTO[] = [
  {
    clase: "transicion" as const,
    estatusOrigenValue: null,
    estatusDestinoValue: "en_preparacion",
    origenTipo: "carga_masiva",
    actorNombre: "Tienda Uno",
    motivo: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
  },
  {
    clase: "transicion" as const,
    estatusOrigenValue: "en_reparto",
    estatusDestinoValue: "reprogramada",
    origenTipo: "gestion",
    actorNombre: "Ana Mensajera",
    motivo: "Cliente ausente",
    createdAt: new Date("2026-01-02T15:30:00Z"),
  },
  {
    clase: "transicion" as const,
    estatusOrigenValue: "reprogramada",
    estatusDestinoValue: "en_bodega_central",
    origenTipo: "liberacion_reprogramada",
    actorNombre: null,
    motivo: null,
    createdAt: new Date("2026-01-03T08:00:00Z"),
  },
];

describe("HistorialOrdenTimeline (feature 49, R29/R30)", () => {
  it("R30: presenta las etiquetas legibles de los estados, NUNCA los values/UUID crudos", () => {
    render(<HistorialOrdenTimeline entradas={ENTRADAS} />);

    // Etiquetas legibles (estatus-label), una por value presente en las entradas.
    expect(screen.getByText(L.en_preparacion)).toBeInTheDocument();
    expect(screen.getByText(L.en_reparto)).toBeInTheDocument();
    expect(screen.getByText(L.en_bodega_central)).toBeInTheDocument();
    // "reprogramada" aparece 2 veces (destino de la 2.ª entrada, origen de la 3.ª).
    expect(screen.getAllByText(L.reprogramada)).toHaveLength(2);

    // Los values crudos NO se muestran (R30).
    for (const value of [
      "en_preparacion",
      "en_reparto",
      "reprogramada",
      "en_bodega_central",
    ]) {
      expect(screen.queryByText(value)).toBeNull();
    }
  });

  it("R29: la creación es la primera entrada; el actor del cron se muestra como 'Sistema' y último", () => {
    render(<HistorialOrdenTimeline entradas={ENTRADAS} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // Orden cronológico: creación primero, liberación del sistema al final.
    expect(within(items[0]).getByText("Creación")).toBeInTheDocument();
    expect(within(items[0]).getByText(L.en_preparacion)).toBeInTheDocument();
    expect(within(items[1]).getByText(L.en_reparto)).toBeInTheDocument();
    expect(within(items[2]).getByText(L.en_bodega_central)).toBeInTheDocument();
    // Actor null -> "Sistema" (R21/R29), en la última entrada.
    expect(within(items[2]).getByText(/Sistema/)).toBeInTheDocument();
  });

  it("R29: muestra el actor humano y el motivo cuando existe; oculta el motivo cuando es null", () => {
    render(<HistorialOrdenTimeline entradas={ENTRADAS} />);

    // Actores humanos.
    expect(screen.getByText(/Tienda Uno/)).toBeInTheDocument();
    expect(screen.getByText(/Ana Mensajera/)).toBeInTheDocument();

    // Motivo solo en la entrada de gestión.
    expect(screen.getByText(/Cliente ausente/)).toBeInTheDocument();
    // Exactamente un bloque de "Motivo:" (las otras dos entradas tienen motivo null).
    expect(screen.getAllByText(/^Motivo:/)).toHaveLength(1);
  });

  it("estado vacío: sin entradas muestra un texto claro", () => {
    render(<HistorialOrdenTimeline entradas={[]} />);
    expect(screen.getByText(/Sin historial todavía/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  // ---------- Feature 48 (T11.1, R15) — retorno a la tienda de origen ----------

  it("R15: incluye la transición 'rechazada → devolviendo_a_tienda' como una entrada más, con su actor y timestamp", () => {
    const entradas: OrdenHistorialEntradaDTO[] = [
      {
        clase: "transicion" as const,
        estatusOrigenValue: "en_reparto",
        estatusDestinoValue: "rechazada",
        origenTipo: "gestion",
        actorNombre: "Ana Mensajera",
        motivo: null,
        createdAt: new Date("2026-01-04T09:00:00Z"),
      },
      {
        clase: "transicion" as const,
        estatusOrigenValue: "rechazada",
        estatusDestinoValue: "devolviendo_a_tienda",
        origenTipo: "ajuste_estado",
        actorNombre: "Bodega Central",
        motivo: null,
        createdAt: new Date("2026-01-05T12:30:00Z"),
      },
    ];

    render(<HistorialOrdenTimeline entradas={entradas} />);

    const items = screen.getAllByRole("listitem");
    // La última entrada es el retorno a la tienda de origen.
    const retorno = items[items.length - 1];
    // Etiqueta legible del destino (R15/R30), NUNCA el value crudo.
    expect(within(retorno).getByText(L.devolviendo_a_tienda)).toBeInTheDocument();
    expect(within(retorno).queryByText("devolviendo_a_tienda")).toBeNull();
    // Origen legible "rechazada" y actor de la bodega que ejecutó el retorno.
    expect(within(retorno).getByText(L.rechazada)).toBeInTheDocument();
    expect(within(retorno).getByText(/Bodega Central/)).toBeInTheDocument();
    // Timestamp presente como <time>.
    expect(
      within(retorno).getByText((_, el) => el?.tagName.toLowerCase() === "time"),
    ).toBeInTheDocument();
  });

  /* ---------- FEATURE 262 (F7, R38/R39) — la entrada SIN transición ---------- */

  /**
   * ⚠️ ALCANCE DE ESTAS DOS: cubren R38 (las dos fechas en palabras, quién, cuándo y el motivo)
   * y R39 (ninguna etiqueta de estado, ninguna flecha). Lo que **F8** todavía debe es el resto
   * de la pantalla: la mezcla de las dos clases en una lista larga, el «se distingue por texto y
   * no sólo por color» sobre el render, y **F6** (ver la app).
   */

  const CORRECCION: OrdenHistorialEntradaDTO = {
    clase: "correccion_dia",
    fechaAnteriorISO: "2026-08-21",
    fechaNuevaISO: "2026-08-22",
    actorNombre: "Ana Pérez",
    motivo: "la bodega marcó el lote para el día siguiente por error",
    createdAt: new Date("2026-08-22T15:14:00Z"),
  };

  it("R38: la corrección se lee con las dos fechas EN PALABRAS, su actor, su sello y su motivo", () => {
    render(<HistorialOrdenTimeline entradas={[CORRECCION]} />);

    const item = screen.getByRole("listitem");
    // La primera línea la nombra con palabras (design §14.4), no sólo con un punto de color.
    expect(within(item).getByText(ETIQUETA_CORRECCION_DIA)).toBeInTheDocument();
    // Las dos fechas, en palabras. El literal se escribe A MANO: comparar contra
    // `textoCorreccionDiaReparto(...)` sería comparar la pantalla con la función que la llena.
    expect(within(item).getByText("Del 21 de agosto al 22 de agosto")).toBeInTheDocument();
    expect(within(item).getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(
      within(item).getByText(/Motivo: la bodega marcó el lote para el día siguiente por error/),
    ).toBeInTheDocument();
    // El sello de hora sigue siendo un `<time>`, como en cualquier otra entrada.
    expect(
      within(item).getByText((_, el) => el?.tagName.toLowerCase() === "time"),
    ).toBeInTheDocument();
    // Y NINGUNA fecha en `YYYY-MM-DD` a la vista (R38).
    expect(item.textContent ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("R39: la corrección NO se pinta como una transición: ni etiqueta de estado ni flecha", () => {
    render(<HistorialOrdenTimeline entradas={[CORRECCION]} />);

    const item = screen.getByRole("listitem");
    // Ninguna de las etiquetas del catálogo aparece en esa entrada. M-ac (pintarla con
    // `estatusLabel`) muere aquí.
    for (const etiqueta of Object.values(L)) {
      expect(within(item).queryByText(etiqueta)).toBeNull();
    }
    // Ni la flecha de estados, ni la palabra «Creación» de la rama de transición.
    expect(item.textContent ?? "").not.toContain("→");
    expect(within(item).queryByText("Creación")).toBeNull();

    // CONTRAPRUEBA, sin la cual lo de arriba podría estar verde por mirar un render vacío: la
    // MISMA búsqueda sobre una transición SÍ encuentra etiqueta y flecha.
    cleanup();
    render(<HistorialOrdenTimeline entradas={[ENTRADAS[1]]} />);
    const transicion = screen.getByRole("listitem");
    expect(within(transicion).getByText(L.reprogramada)).toBeInTheDocument();
    expect(transicion.textContent ?? "").toContain("→");
  });

  it("R37/R41: mezclada con transiciones, se pinta en la posición que el servidor le dio", () => {
    // El componente NO ordena (R41): pinta el array tal cual llega. Aquí llega en el orden que
    // `fusionarLineaDeTiempo` produce y la corrección va en medio.
    render(<HistorialOrdenTimeline entradas={[ENTRADAS[0], CORRECCION, ENTRADAS[2]]} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Creación")).toBeInTheDocument();
    expect(within(items[1]).getByText(ETIQUETA_CORRECCION_DIA)).toBeInTheDocument();
    expect(within(items[2]).getByText(L.en_bodega_central)).toBeInTheDocument();
    // Y la función de textos es la que llena la línea: si el componente copiara el literal, este
    // `toContain` seguiría verde, pero el censo de `dia-reparto-textos.test.ts` (2) y la guardia
    // `historial-correccion-dia.guardia` lo cazarían.
    expect(items[1].textContent ?? "").toContain(
      textoCorreccionDiaReparto("2026-08-21", "2026-08-22"),
    );
  });

  /* ---------- FEATURE 262 (F8, R37/R38/R39/R41) — el resto de la suite de pantalla ---------- */

  /**
   * ⬛ LO QUE ESTA TANDA (F7/F8) AÑADE, y por qué cada cosa está donde está.
   *
   * Las tres de arriba las escribió la tanda de backend con el alcance mínimo. Lo que faltaba
   * —y es lo que `tasks.md > F8` enumera— son tres cosas que un render SÍ puede afirmar y las
   * de arriba no afirmaban:
   *
   *  1. **«Se distingue POR TEXTO y no sólo por color»**, sobre el render de verdad. Se afirma
   *     en las DOS mitades, porque una sola no dice nada:
   *       · leyendo **sólo `textContent`** —donde no queda ni una clase de estilo— la entrada
   *         sigue siendo identificable, y ninguna transición lo es (la palabra DISCRIMINA);
   *       · y la diferencia visual que hay **encima** de esa palabra incluye al menos una marca
   *         que **no es de color** (el filo discontinuo, el anillo hueco), con el clasificador
   *         auto-probado en las dos direcciones. Distinguir por color a secas no vale en este
   *         repo: hay guardia de contraste y una lección medida sobre el color en el navegador.
   *  2. **La lista LARGA con las dos clases mezcladas**: que dos correcciones distintas no se
   *     contaminen entre sí y que el orden que llega sea exactamente el que se pinta (**R41**).
   *  3. **El nombre accesible de la lista y el sello**, que son las dos cosas de esta pantalla
   *     que sólo existen en el DOM y nunca en el texto visible.
   *
   * Y una corrección de método sobre las tres de arriba: aquéllas afirman la etiqueta contra
   * `ETIQUETA_CORRECCION_DIA`, que es **la constante que llena la pantalla**. Eso está verde
   * pase lo que pase con el texto. Aquí el literal se escribe **a mano**, letra por letra.
   */

  /** Una SEGUNDA corrección, en el sentido contrario y con otro actor: sirve de contraprueba. */
  const CORRECCION_VUELTA: OrdenHistorialEntradaDTO = {
    clase: "correccion_dia",
    fechaAnteriorISO: "2026-08-22",
    fechaNuevaISO: "2026-08-21",
    actorNombre: "Luis Bodega",
    motivo: "el cliente pidió recibirlo el mismo día",
    createdAt: new Date("2026-08-23T11:02:00Z"),
  };

  /**
   * Los tokens de clase que deciden el ASPECTO de una entrada: los del `<li>` más los de su
   * punto decorativo. El punto es el primer hijo `span[aria-hidden]` del `<li>`; se toma con
   * `:scope >` a propósito, porque la rama de transición tiene OTRO `span[aria-hidden]` —la
   * flecha— metido dentro del `<p>`.
   */
  function clasesDeLaEntrada(li: HTMLElement): Set<string> {
    const tokens = new Set<string>(Array.from(li.classList));
    const punto = li.querySelector(":scope > span[aria-hidden='true']");
    for (const c of Array.from(punto?.classList ?? [])) tokens.add(c);
    return tokens;
  }

  /**
   * ¿El token cambia la FORMA de la marca —tamaño, grosor del filo, estilo del filo, esquinas,
   * giro— en vez de su color?
   *
   * La POSICIÓN queda fuera a propósito: mover el punto un píxel no distingue nada, y si contara
   * como «marca de forma» bastaría un `-left-` distinto para pasar la comprobación de abajo sin
   * haber distinguido nada de verdad.
   */
  const MARCAS_DE_FORMA = [
    /^size-/,
    /^w-/,
    /^h-/,
    /^rounded/,
    /^border-\d/,
    /^border-(solid|dashed|dotted|double|hidden|none)$/,
    /^rotate-/,
  ];
  const esMarcaDeForma = (token: string) => MARCAS_DE_FORMA.some((r) => r.test(token));

  it("AUTOCOMPROBACIÓN: el clasificador separa forma de color en las DOS direcciones", () => {
    // En este repo una guardia estática pasó verde con el detector roto: encontraba cero porque
    // no encontraba NADA. Antes de creerle nada al test de abajo, se le pregunta por respuestas
    // conocidas.
    for (const color of [
      "bg-primary",
      "bg-popover",
      "border-border",
      "border-primary",
      "text-muted-foreground",
    ]) {
      expect(esMarcaDeForma(color), `«${color}» es de COLOR y se contó como forma`).toBe(false);
    }
    for (const forma of ["border-dashed", "border-2", "size-2.5", "rounded-full"]) {
      expect(esMarcaDeForma(forma), `«${forma}» es de FORMA y no se contó`).toBe(true);
    }
    // La posición NO cuenta: un píxel de desplazamiento no es una marca.
    expect(esMarcaDeForma("-left-[6px]")).toBe(false);
    expect(esMarcaDeForma("top-1.5")).toBe(false);
  });

  it("R38/R39: se distingue POR TEXTO — leyendo sólo las palabras, sin una sola clase de estilo", () => {
    render(<HistorialOrdenTimeline entradas={[ENTRADAS[0], CORRECCION, ENTRADAS[1]]} />);
    const items = screen.getAllByRole("listitem");
    const textos = items.map((li) => li.textContent ?? "");

    // El literal va A MANO: contra `ETIQUETA_CORRECCION_DIA` estaría comparando la pantalla con
    // la constante que la llena, y eso está verde pase lo que pase.
    expect(textos[1]).toContain("Día de reparto");
    expect(textos[1]).toContain("Del 21 de agosto al 22 de agosto");

    // Y la palabra DISCRIMINA: ninguna transición la dice. Sin esta mitad, «se distingue por
    // texto» se cumpliría con una palabra que estuviera en todas las entradas.
    expect(textos[0]).not.toContain("Día de reparto");
    expect(textos[2]).not.toContain("Día de reparto");

    // ANTI-VACUIDAD: las transiciones no están vacías; cada una se lee por SU propio texto.
    expect(textos[0]).toContain(L.en_preparacion);
    expect(textos[2]).toContain(L.reprogramada);

    // Y el punto de la izquierda no aporta NADA a esta lectura: es decorativo y está oculto al
    // lector de pantalla, así que lo de arriba es literalmente todo lo que se oye.
    const punto = items[1].querySelector(":scope > span[aria-hidden='true']");
    expect(punto, "la entrada perdió su marca").not.toBeNull();
    expect(punto?.textContent ?? "").toBe("");
  });

  it("F7: y NO SÓLO por color — la marca de la corrección difiere en algo que no es un tono", () => {
    render(<HistorialOrdenTimeline entradas={[ENTRADAS[1], CORRECCION]} />);
    const [transicion, correccion] = screen.getAllByRole("listitem");

    const deTransicion = clasesDeLaEntrada(transicion);
    const deCorreccion = clasesDeLaEntrada(correccion);

    // (1) No se pintan igual. Antes de F7 SÍ se pintaban igual —mismo punto, mismo filo— y esta
    //     línea es la que lo impide volver a ser así.
    const diferencia = [
      ...Array.from(deCorreccion).filter((t) => !deTransicion.has(t)),
      ...Array.from(deTransicion).filter((t) => !deCorreccion.has(t)),
    ];
    expect(
      diferencia,
      "la corrección se pinta EXACTAMENTE igual que una transición",
    ).not.toHaveLength(0);

    // (2) Y lo que las diferencia no es SÓLO el tono: hay al menos una marca de forma, que es lo
    //     único que sobrevive a una captura en escala de grises o a un daltonismo.
    expect(
      diferencia.filter(esMarcaDeForma),
      `la única diferencia visual es de color: ${diferencia.join(" ")}`,
    ).not.toHaveLength(0);

    // (3) CONTRAPRUEBA, y de paso la mitad de R45 que se ve en pantalla: la transición NO ganó
    //     ninguna de esas marcas. El filo de la corrección es discontinuo y el de la transición
    //     sigue siendo continuo; el punto de la corrección es un anillo y el de la transición
    //     sigue siendo un disco lleno.
    expect(deCorreccion.has("border-dashed")).toBe(true);
    expect(deTransicion.has("border-dashed")).toBe(false);
    expect(Array.from(deCorreccion).some((t) => /^border-\d/.test(t))).toBe(true);
    expect(Array.from(deTransicion).some((t) => /^border-\d/.test(t))).toBe(false);
  });

  it("R37/R41: en una lista LARGA y mezclada, cada entrada sale en su sitio y con SUS datos", () => {
    // Siete entradas, dos de ellas correcciones EN SENTIDOS CONTRARIOS. El componente no ordena
    // (R41): pinta el array tal cual llega, que es el que fusionó el servidor.
    const entradas: OrdenHistorialEntradaDTO[] = [
      ENTRADAS[0],
      ENTRADAS[1],
      CORRECCION,
      ENTRADAS[2],
      CORRECCION_VUELTA,
      {
        clase: "transicion" as const,
        estatusOrigenValue: "en_bodega_central",
        estatusDestinoValue: "en_reparto",
        origenTipo: "asignacion_bodega",
        actorNombre: "Bodega Central",
        motivo: null,
        createdAt: new Date("2026-08-24T09:00:00Z"),
      },
      {
        clase: "transicion" as const,
        estatusOrigenValue: "en_reparto",
        estatusDestinoValue: "entregada",
        origenTipo: "gestion",
        actorNombre: "Ana Mensajera",
        motivo: null,
        createdAt: new Date("2026-08-24T17:45:00Z"),
      },
    ];

    render(<HistorialOrdenTimeline entradas={entradas} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(7);

    // Las dos correcciones están donde el servidor las puso, y NO SE CONTAMINAN: cada una lleva
    // sus fechas, su actor y su motivo. Los literales, a mano.
    expect(items[2].textContent ?? "").toContain("Del 21 de agosto al 22 de agosto");
    expect(items[2].textContent ?? "").toContain("Ana Pérez");
    expect(items[2].textContent ?? "").not.toContain("Del 22 de agosto al 21 de agosto");
    expect(items[4].textContent ?? "").toContain("Del 22 de agosto al 21 de agosto");
    expect(items[4].textContent ?? "").toContain("Luis Bodega");
    expect(items[4].textContent ?? "").toContain("Motivo: el cliente pidió recibirlo el mismo día");
    expect(items[4].textContent ?? "").not.toContain("Del 21 de agosto al 22 de agosto");

    // Exactamente DOS entradas son correcciones: ni se duplica ninguna ni se come ninguna.
    const conEtiqueta = items.filter((li) => (li.textContent ?? "").includes("Día de reparto"));
    expect(conEtiqueta).toHaveLength(2);

    // Las cinco transiciones siguen leyéndose como siempre, en su sitio (R45 en pantalla).
    expect(within(items[0]).getByText("Creación")).toBeInTheDocument();
    expect(within(items[1]).getByText(L.reprogramada)).toBeInTheDocument();
    expect(within(items[3]).getByText(L.en_bodega_central)).toBeInTheDocument();
    expect(within(items[5]).getByText(L.en_reparto)).toBeInTheDocument();
    expect(within(items[6]).getByText(L.entregada)).toBeInTheDocument();

    // R39: ninguna etiqueta del catálogo dentro de las dos correcciones, ni la flecha.
    for (const correccion of conEtiqueta) {
      for (const etiqueta of Object.values(L)) {
        expect(within(correccion).queryByText(etiqueta)).toBeNull();
      }
      expect(correccion.textContent ?? "").not.toContain("→");
    }

    // R38, sobre la lista ENTERA: ni una fecha en `YYYY-MM-DD` a la vista.
    expect(screen.getByRole("list").textContent ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("R37: dos correcciones seguidas sobre la misma orden son DOS entradas, no una", () => {
    // Lo que la puerta humana pide comprobar en la app (F6): corregir dos veces → dos entradas.
    // Aquí se afirma la mitad que sí depende de la pantalla.
    render(<HistorialOrdenTimeline entradas={[CORRECCION, CORRECCION_VUELTA]} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent ?? "").toContain("Del 21 de agosto al 22 de agosto");
    expect(items[1].textContent ?? "").toContain("Del 22 de agosto al 21 de agosto");
    // Y la ida no se lee igual que la vuelta: si la frase fuera simétrica, el rastro no serviría
    // para lo que existe.
    expect(items[0].textContent).not.toBe(items[1].textContent);
  });

  it("R39: el nombre accesible de la lista ya no la anuncia como si todo fuesen estados", () => {
    render(<HistorialOrdenTimeline entradas={[ENTRADAS[0], CORRECCION]} />);

    // Literal A MANO: es el contrato que localizan los specs de Playwright y el test de la 155.
    expect(
      screen.getByRole("list", { name: "Línea de tiempo de la orden" }),
    ).toBeInTheDocument();
    // Y ya no promete «de estados», que con la 262 dejó de ser cierto para toda la lista: hay
    // una entrada dentro que NO es un estado (R39), y a quien navega con lector de pantalla se
    // le estaba anunciando lo contrario.
    expect(screen.queryByRole("list", { name: "Línea de tiempo de estados" })).toBeNull();
  });

  it("R38/R41: el sello de la corrección es un `<time>` con el instante, en la zona FIJA del componente", () => {
    render(<HistorialOrdenTimeline entradas={[CORRECCION]} />);

    const sello = screen.getByRole("listitem").querySelector("time");
    expect(sello, "la corrección perdió su sello de hora").not.toBeNull();
    // El instante exacto queda legible por máquina, sin depender del formato visible.
    expect(sello?.getAttribute("datetime")).toBe("2026-08-22T15:14:00.000Z");
    // Y lo VISIBLE va en la zona fija de Costa Rica, no en UTC ni en la del entorno que renderiza:
    // 15:14 UTC son las 9:14 allí. Si el componente soltara el reloj del navegador, este número
    // cambiaría con la máquina.
    expect(sello?.textContent ?? "").toMatch(/9:14/);
    expect(sello?.textContent ?? "").not.toMatch(/15:14/);
    // R38: tampoco aquí se escapa un `YYYY-MM-DD`.
    expect(sello?.textContent ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
