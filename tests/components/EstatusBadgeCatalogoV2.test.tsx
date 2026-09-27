// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { EstatusBadge, ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Feature 154 (R29/R30/R31) — presentacion de los DOS estados nuevos.
// `ORDER_STATUS_VARIANT` y `ORDER_STATUS_CLASS` son privados del modulo, asi que la VARIANTE se
// verifica sobre el DOM renderizado y POR COMPARACION con el estado que el gate uso de criterio
// (Q5, confirmada por el humano el 2026-07-29):
//   - `por_recolectar_en_tienda` es un estado de ESPERA -> mismo chip que `por_devolver` (warning)
//   - `incidente` es un cierre en error       -> mismo chip que `rechazada` (danger)
// Ninguno lleva refuerzo de acento de marca, asi que la igualdad de clases con su gemelo debe
// ser EXACTA (si alguien le añadiera un `ORDER_STATUS_CLASS`, este test lo caza).

afterEach(() => {
  cleanup();
});

function classesDe(value: string): string[] {
  const { container } = render(<EstatusBadge value={value} />);
  // FICHA 456 (2026-09-24, T2.3): el chip ya no es el primer hijo: va dentro de `EstadoConInfo`,
  // junto a su botón de información. Se localiza por su `data-slot`; las aserciones de clase no cambian.
  const el = container.querySelector('[data-slot="badge"]') as HTMLElement;
  return el.className.split(/\s+/).filter(Boolean);
}

describe("154/R29 — por_recolectar_en_tienda se presenta con etiqueta y variante propias", () => {
  it("la etiqueta legible en español es “Por recolectar en tienda”", () => {
    expect(ORDER_STATUS_LABELS.por_recolectar_en_tienda).toBe("Por recolectar en tienda");
    render(<EstatusBadge value="por_recolectar_en_tienda" />);
    expect(screen.getByText("Por recolectar en tienda")).toBeInTheDocument();
  });

  it("usa la variante de ESPERA: mismo chip que `por_devolver_a_bodega_central` (warning), sin acento de marca", () => {
    const nuevo = classesDe("por_recolectar_en_tienda");
    cleanup();
    const espera = classesDe("por_devolver_a_bodega_central");
    expect(nuevo).toEqual(espera);
    expect(nuevo).not.toContain("bg-brand-soft");
  });

  it("NO comparte chip con un cierre en error (`rechazada`)", () => {
    const nuevo = classesDe("por_recolectar_en_tienda");
    cleanup();
    const error = classesDe("devolucion_a_origen_por_rechazo");
    expect(nuevo).not.toEqual(error);
  });
});

describe("154/R30 — incidente se presenta con etiqueta y variante propias", () => {
  it("la etiqueta legible en español es “Incidente”", () => {
    expect(ORDER_STATUS_LABELS.incidente).toBe("Incidente");
    render(<EstatusBadge value="incidente" />);
    expect(screen.getByText("Incidente")).toBeInTheDocument();
  });

  it("usa la variante de ERROR: mismo chip que `rechazada` (danger), sin acento de marca", () => {
    const nuevo = classesDe("incidente");
    cleanup();
    const rechazada = classesDe("devolucion_a_origen_por_rechazo");
    expect(nuevo).toEqual(rechazada);
    expect(nuevo).not.toContain("bg-brand-soft");
  });
});

// ⏳ 2026-09-24 (FICHA 455, T2.1; R3/R10): el chip ya no enseña el value CRUDO de un estatus fuera
// del catálogo (R3 lo prohíbe): dice «Estado no reconocido». La variante neutra no cambia.
describe("154/R31 · 455/R10 — un estatus fuera del catalogo del build no rompe la vista", () => {
  it("dice «Estado no reconocido» (nunca el código) con la variante neutra", () => {
    const desconocido = classesDe("estado_del_futuro");
    expect(screen.getByText("Estado no reconocido")).toBeInTheDocument();
    expect(screen.queryByText("estado_del_futuro")).toBeNull();
    cleanup();
    // Neutro = ni el chip de espera ni el de error; y sin refuerzo de marca.
    const espera = classesDe("por_recolectar_en_tienda");
    cleanup();
    const error = classesDe("incidente");
    expect(desconocido).not.toEqual(espera);
    expect(desconocido).not.toEqual(error);
    expect(desconocido).not.toContain("bg-brand-soft");
  });
});

// Feature 235 (T1.4, R37) — la etiqueta y la variante del estatus de la AYUDA, EXACTAS y escritas
// a mano. No se derivan del mapa: si se derivaran, este bloque diria que el mapa coincide consigo
// mismo (el fallo «aserción contra su propia fuente» que ya costo un tope mal validado en el repo).
//
// ⏳ 2026-09-23 (FICHA 454, R37/R40): el estado sale del catalogo, asi que ya no esta en
// `ORDER_STATUS_LABELS`. Sus filas HISTORICAS se siguen leyendo igual —misma etiqueta y misma
// variante— por `ORDER_STATUS_LABELS_RETIRADOS`: los tres casos de este bloque se conservan y
// ahora afirman esa lectura historica (R40). El primero cambia su fuente, no su literal.
//
// ⏳ 2026-09-24 (FICHA 455, T2.1; R11): el mapa `ORDER_STATUS_LABELS_RETIRADOS` se absorbe en la
// fuente única (`ESTADO_RETIRADO`, `lib/types/order-status.ts`) y una fila histórica de un estado
// retirado se lee «<nombre histórico> (estado retirado)». La variante (`warning`) no cambia.
describe("235/R37 -> 454/R40 -> 455/R11 — `ayuda_tienda` historico: etiqueta y variante", () => {
  it("la etiqueta dice A QUIEN se le pidio la ayuda, y que es un estado retirado", () => {
    expect(Object.keys(ORDER_STATUS_LABELS)).not.toContain("ayuda_tienda");
    render(<EstatusBadge value="ayuda_tienda" />);
    expect(screen.getByText("Ayuda solicitada a la tienda (estado retirado)")).toBeInTheDocument();
  });

  // (El retirado de la 155 lo cubre `EstatusBadgeRetiroFulfillment.test.tsx`.)
  it("los otros retirados también se leen con su nombre histórico marcado", () => {
    render(<EstatusBadge value="devolucion_por_confirmar" />);
    expect(screen.getByText("Devolución por confirmar (estado retirado)")).toBeInTheDocument();
    cleanup();
    render(<EstatusBadge value="pendiente" />);
    expect(screen.getByText("Pendiente (estado retirado)")).toBeInTheDocument();
  });

  it("usa la variante de ESPERA (`warning`): mismo chip que `novedad_interna`, sin acento de marca", () => {
    // `ORDER_STATUS_VARIANT` es privado del modulo, asi que la variante se verifica sobre el DOM
    // y POR COMPARACION con su gemelo semantico — el mismo metodo que usa el resto del archivo.
    // Que comparta chip con `sin_gestionar` es la afirmacion: `danger` diria que algo se rompio y
    // `info` que la orden avanza, y lo que hay es una parada esperando a alguien.
    const ayuda = classesDe("ayuda_tienda");
    cleanup();
    const espera = classesDe("novedad_interna");
    expect(ayuda).toEqual(espera);
    expect(ayuda).not.toContain("bg-brand-soft");
  });

  it("NO comparte chip con un estado de error: `rechazada` se ve distinto", () => {
    // El caso negativo. Sin el, la igualdad de arriba pasaria igual si TODOS los chips fueran
    // iguales.
    const ayuda = classesDe("ayuda_tienda");
    cleanup();
    const error = classesDe("devolucion_a_origen_por_rechazo");
    expect(ayuda).not.toEqual(error);
  });
});

describe("154 — el mapa de presentacion sigue cubriendo el catalogo EXACTO", () => {
  // Feature 155/R28: el catalogo baja de 20 a 19 values (primera BAJA de su historia:
  // se retira el estado interno de fulfillment en bodega). El conteo se mantiene escrito
  // a mano a proposito: es la red que caza un sobrante en el mapa de presentacion, que el
  // `Record<OrderStatusValue, ...>` solo caza si FALTA una clave, no si sobra en runtime.
  it("tiene una etiqueta por cada uno de los 20 values, sin sobrantes", () => {
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual([...ORDER_STATUS_SEED].sort());
    expect(Object.keys(ORDER_STATUS_LABELS)).toHaveLength(20); // +1: 157 (recolectando); +1: 239 (devolucion_por_confirmar); +1: 235 (ayuda_tienda, 2026-08-19); -2: 454 (2026-09-23, los dos retirados)
  });
});
