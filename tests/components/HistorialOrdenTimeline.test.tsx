// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

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
    estatusOrigenValue: "en_reparto",
    estatusDestinoValue: "reprogramada",
    origenTipo: "gestion",
    actorNombre: "Ana Mensajera",
    motivo: "Cliente ausente",
    createdAt: new Date("2026-01-02T15:30:00Z"),
  },
  {
    estatusOrigenValue: "reprogramada",
    estatusDestinoValue: "en_bodega",
    origenTipo: "liberacion_reprogramada",
    actorNombre: null,
    motivo: null,
    createdAt: new Date("2026-01-03T08:00:00Z"),
  },
];

describe("HistorialOrdenTimeline (feature 49, R29/R30)", () => {
  it("R30: presenta las etiquetas legibles de los estados, NUNCA los values/UUID crudos", () => {
    render(<HistorialOrdenTimeline entradas={ENTRADAS} />);

    // Etiquetas legibles (estatus-label): en_preparacion -> "En preparación", etc.
    expect(screen.getByText("En preparación")).toBeInTheDocument();
    expect(screen.getByText("En reparto")).toBeInTheDocument();
    expect(screen.getByText("En bodega")).toBeInTheDocument();
    // "reprogramada" aparece 2 veces (destino de la 2.ª entrada, origen de la 3.ª).
    expect(screen.getAllByText("Reprogramada")).toHaveLength(2);

    // Los values crudos NO se muestran (R30).
    for (const value of [
      "en_preparacion",
      "en_reparto",
      "reprogramada",
      "en_bodega",
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
    expect(within(items[0]).getByText("En preparación")).toBeInTheDocument();
    expect(within(items[1]).getByText("En reparto")).toBeInTheDocument();
    expect(within(items[2]).getByText("En bodega")).toBeInTheDocument();
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
});
