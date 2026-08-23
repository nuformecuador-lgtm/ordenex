// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  EstatusBadge,
  ORDER_STATUS_LABELS,
} from "@/app/(app)/ordenes/_components/EstatusBadge";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 155 (R28/R41) — RETIRO del estado interno de fulfillment en bodega de la capa de
// presentacion, y degradacion de lo que quedo escrito en la historia.
//
// R28: el value sale de los TRES mapas del chip (`ORDER_STATUS_LABELS`,
// `ORDER_STATUS_VARIANT` y el refuerzo de acento de `ORDER_STATUS_CLASS`). El
// `Record<OrderStatusValue, ...>` rompe el build si FALTA una clave, pero un sobrante en
// `Partial<Record<...>>` es silencioso: por eso se verifica tambien sobre el DOM.
//
// R41: la migracion de esta feature NO reescribe historial (R36), asi que las filas viejas
// siguen referenciando el value retirado y la UI las tiene que seguir pintando. La
// degradacion esperada es "value crudo + estilo neutro", nunca una vista rota.
//
// El literal retirado se construye por concatenacion a proposito: escribirlo entero haria
// que este archivo apareciera como ofensor del guard de censo
// (`tests/unit/guards/censo-order-status-rename.test.ts`), que es exactamente la red que
// esta feature extiende. Mismo patron que ya usa el repo para los values pre-137.
const RETIRADO = ["en", "fulfillment"].join("_");
const LABEL_RETIRADA = ["En", "fulfillment"].join(" ");

// Estado NEUTRO de referencia: `secondary` sin entrada en `ORDER_STATUS_CLASS`. Es la
// presentacion exacta a la que debe caer cualquier value desconocido.
const NEUTRO = "en_preparacion";

afterEach(() => {
  cleanup();
});

function classesDe(value: string): string[] {
  const { container } = render(<EstatusBadge value={value} />);
  const el = container.firstElementChild as HTMLElement;
  return el.className.split(/\s+/).filter(Boolean);
}

describe("155/R28 — el estado retirado ya no esta en los mapas de presentacion", () => {
  it("no es clave del mapa de etiquetas ni del catalogo del build", () => {
    expect(Object.keys(ORDER_STATUS_LABELS)).not.toContain(RETIRADO);
    expect([...ORDER_STATUS_SEED]).not.toContain(RETIRADO);
  });

  it("ninguna etiqueta del mapa vale la etiqueta retirada", () => {
    expect(Object.values(ORDER_STATUS_LABELS)).not.toContain(LABEL_RETIRADA);
  });

  it("los 19 values vigentes SI tienen etiqueta (el retiro no se llevo a nadie mas)", () => {
    for (const value of ORDER_STATUS_SEED) {
      expect(ORDER_STATUS_LABELS[value]).toBeTruthy();
    }
    expect(Object.keys(ORDER_STATUS_LABELS)).toHaveLength(ORDER_STATUS_SEED.length);
  });

  it("ya no lleva el refuerzo de acento de marca que tenia (se fue con el value)", () => {
    expect(classesDe(RETIRADO)).not.toContain("bg-brand-soft");
  });
});

describe("155/R41 — un value fuera del catalogo del build degrada al chip neutro", () => {
  it("el value RETIRADO se pinta crudo, con la presentacion neutra EXACTA", () => {
    const retirado = classesDe(RETIRADO);
    // Texto crudo: sin etiqueta legible, se muestra el value tal cual (no "—", no vacio).
    expect(screen.getByText(RETIRADO)).toBeInTheDocument();
    expect(screen.queryByText(LABEL_RETIRADA)).toBeNull();
    cleanup();
    // Estilo neutro: mismas clases que un estado `secondary` sin acento.
    expect(retirado).toEqual(classesDe(NEUTRO));
  });

  it("un value cualquiera que el build no conoce degrada igual (no es un caso especial)", () => {
    const desconocido = classesDe("estado_que_no_existe");
    expect(screen.getByText("estado_que_no_existe")).toBeInTheDocument();
    cleanup();
    expect(desconocido).toEqual(classesDe(NEUTRO));
  });

  it("el mapa de presentacion de texto tambien cae al value crudo", () => {
    expect(estatusLabel(RETIRADO)).toBe(RETIRADO);
  });

  it("una fila de historial que referencia el value retirado NO rompe la linea de tiempo", () => {
    // La migracion de la 155 deja rastro `retirado -> en_preparacion` (R35) y NO reescribe
    // el historial previo (R36): esta fila es exactamente lo que el usuario ve despues.
    const entrada: OrdenHistorialEntradaDTO = {
      clase: "transicion",
      estatusOrigenValue: RETIRADO,
      estatusDestinoValue: "en_preparacion",
      origenTipo: "ajuste_estado",
      actorNombre: null,
      motivo: `migracion 155: retiro de ${RETIRADO}`,
      createdAt: new Date("2026-07-29T12:00:00Z"),
    };

    render(<HistorialOrdenTimeline entradas={[entrada]} />);

    // La vista se monta y la transicion es legible: origen crudo -> destino con etiqueta.
    expect(
      screen.getByRole("list", { name: "Línea de tiempo de la orden" }),
    ).toBeInTheDocument();
    expect(screen.getByText(RETIRADO)).toBeInTheDocument();
    expect(screen.getByText(ORDER_STATUS_LABELS.en_preparacion)).toBeInTheDocument();
    // Y el motivo de la migracion es visible: la orden no cambio de estado sin explicacion.
    expect(screen.getByText(new RegExp(`migracion 155`))).toBeInTheDocument();
  });
});
