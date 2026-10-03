import { describe, it, expect } from "vitest";

import { ORDEN_LIBRO } from "@/components/shared/wallet/zonas-filtros-labels";
import { OPCIONES_DIRECCION } from "@/app/(app)/ordenes/_components/ordenamiento-ordenes";

// FICHA 467 (T1; R4) — el orden del libro de las wallets va en SOLO ICONO, como `/ordenes`. Las
// etiquetas son contrato (nombre accesible y texto emergente) y se afirman como LITERAL; los iconos se
// comparan por IDENTIDAD con los de la dirección por fecha de órdenes: los mismos objetos, no unos que
// se le parezcan.

describe("467 R4 — el orden del libro: dos botones con icono, los de la fecha de /ordenes", () => {
  it("las etiquetas siguen siendo «Más recientes» y «Más antiguas», en ese orden", () => {
    expect(ORDEN_LIBRO.opciones.map((o) => [o.valor, o.etiqueta])).toEqual([
      ["desc", "Más recientes"],
      ["asc", "Más antiguas"],
    ]);
  });

  it("cada opción lleva icono, y es el MISMO objeto que la dirección por fecha de órdenes", () => {
    const [recientes, antiguas] = ORDEN_LIBRO.opciones;
    const [ordenesDesc, ordenesAsc] = OPCIONES_DIRECCION.created_at;
    expect(recientes.Icono).toBeDefined();
    expect(antiguas.Icono).toBeDefined();
    expect(recientes.Icono).toBe(ordenesDesc.Icono);
    expect(antiguas.Icono).toBe(ordenesAsc.Icono);
    // No-vacuidad: los dos iconos son distintos entre sí.
    expect(recientes.Icono).not.toBe(antiguas.Icono);
  });
});
