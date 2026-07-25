// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

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
    estatusOrigenValue: null,
    estatusDestinoValue: "en_preparacion",
    origenTipo: "carga_masiva",
    actorNombre: "Tienda Uno",
    motivo: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
  },
  {
    estatusOrigenValue: "en_ruta",
    estatusDestinoValue: "reprogramada",
    origenTipo: "gestion",
    actorNombre: "Ana Mensajera",
    motivo: "Cliente ausente",
    createdAt: new Date("2026-01-02T15:30:00Z"),
  },
  {
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
    expect(screen.getByText(L.en_ruta)).toBeInTheDocument();
    expect(screen.getByText(L.en_bodega_central)).toBeInTheDocument();
    // "reprogramada" aparece 2 veces (destino de la 2.ª entrada, origen de la 3.ª).
    expect(screen.getAllByText(L.reprogramada)).toHaveLength(2);

    // Los values crudos NO se muestran (R30).
    for (const value of [
      "en_preparacion",
      "en_ruta",
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
    expect(within(items[1]).getByText(L.en_ruta)).toBeInTheDocument();
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
        estatusOrigenValue: "en_ruta",
        estatusDestinoValue: "rechazada",
        origenTipo: "gestion",
        actorNombre: "Ana Mensajera",
        motivo: null,
        createdAt: new Date("2026-01-04T09:00:00Z"),
      },
      {
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
});
