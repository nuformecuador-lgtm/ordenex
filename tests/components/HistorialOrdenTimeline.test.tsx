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
});
