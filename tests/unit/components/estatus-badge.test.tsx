// @vitest-environment jsdom
// FICHA 455 (T2.1; design §2.1; R2, R3, R10, R11) — el chip de estado de `/ordenes` (y de todo lo
// que lo reusa: satélite, carga masiva, línea de tiempo) pinta el NOMBRE VISIBLE exacto.
//
// Los 20 nombres van escritos A MANO (requirements §0.1): comparar contra `NOMBRE_ESTADO` sería
// comparar la fuente consigo misma. Se afirma además que el chip ya no interpola la zona (R2; se
// retira la derivación «En ruta a bodega <zona>» de la feature 30), que un código desconocido dice
// «Estado no reconocido» (R10) y que una fila histórica de un retirado lo marca (R11).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";

afterEach(() => {
  cleanup();
});

const ESPERADO: Record<string, string> = {
  entregado: "Entregado",
  novedad: "Novedad",
  devolviendo_a_tienda: "Devolviendo a tienda",
  reprogramado: "Reprogramado",
  en_ruta_bodega_central: "En ruta a bodega central",
  en_bodega_central: "En bodega central",
  en_preparacion: "En preparación",
  mensajero_recogiendo_en_bodega: "Mensajero recogiendo en la bodega",
  en_ruta_bodega_satelite: "En ruta a bodega satélite",
  en_reparto: "En reparto",
  devolucion_a_origen_por_rechazo: "Devolución a origen por rechazo",
  en_bodega_satelite: "En bodega satélite",
  devuelta_a_tienda: "Devuelta a tienda",
  novedad_interna: "Novedad interna",
  por_devolver_a_bodega_central: "Por devolver a bodega central",
  devolviendo_a_bodega_central: "Devolviendo a bodega central",
  por_devolver_a_tienda: "Por devolver a tienda",
  por_recolectar_en_tienda: "Por recolectar en tienda",
  incidente: "Incidente",
  recolectando: "Recolectando",
};

function textoDelChip(value: string): string {
  const { container } = render(<EstatusBadge value={value} />);
  const texto = container.textContent ?? "";
  cleanup();
  return texto;
}

describe("455/R2 — el chip pinta el nombre exacto de los 20, sin zona", () => {
  it.each(Object.entries(ESPERADO))("%s → «%s»", (value, nombre) => {
    expect(textoDelChip(value)).toBe(nombre);
    expect(estatusLabel(value)).toBe(nombre);
  });

  it("«En ruta a bodega satélite» no interpola la zona (la prop de la feature 30 ya no existe)", () => {
    expect(textoDelChip("en_ruta_bodega_satelite")).toBe("En ruta a bodega satélite");
  });

  it("«bodega» siempre entera: ningún nombre abrevia (R9)", () => {
    for (const nombre of Object.values(ESPERADO)) expect(nombre).not.toMatch(/\bB\.\s/);
  });
});

describe("455/R3 · R10 · R11 — lo que no es un estado vigente", () => {
  it("R10: un código desconocido dice «Estado no reconocido», nunca el código (R3)", () => {
    expect(textoDelChip("estado_del_futuro")).toBe("Estado no reconocido");
    expect(estatusLabel("estado_del_futuro")).toBe("Estado no reconocido");
  });

  it("R11: un retirado se lee con su nombre histórico y « (estado retirado)»", () => {
    expect(textoDelChip("ayuda_tienda")).toBe("Ayuda solicitada a la tienda (estado retirado)");
    expect(textoDelChip("devolucion_por_confirmar")).toBe("Devolución por confirmar (estado retirado)");
  });

  it("vacío o nulo → «—» (la celda vacía de siempre)", () => {
    expect(estatusLabel(null)).toBe("—");
    expect(estatusLabel("")).toBe("—");
    expect(textoDelChip("")).toBe("—");
  });
});
