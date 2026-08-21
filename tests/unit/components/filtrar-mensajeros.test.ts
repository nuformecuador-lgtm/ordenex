// Feature 258 (F4.1) — el filtro por nombre y las iniciales del avatar, probados SIN DOM.
// Mapea: R40, R41, R71.
//
// Se prueban aquí y no sólo a través del componente porque es donde de verdad se equivoca un
// filtro: los acentos y las mayúsculas. Un test que sólo escribiera en el `Input` mediría el
// cableado y daría por buena una normalización a medias.

import { describe, expect, it } from "vitest";

import {
  filtrarFilas,
  hayFiltroActivo,
  iniciales,
  normalizarNombre,
} from "@/app/(app)/monitoreo/_components/filtrar-mensajeros";
import type { FilaTableroDia } from "@/lib/types/tablero-dia";

const fila = (mensajeroId: string, mensajeroNombre: string): FilaTableroDia => ({
  mensajeroId,
  mensajeroNombre,
  asignadas: 0,
  entregadas: 0,
  reprogramadas: 0,
  devueltas: 0,
  rechazadas: 0,
  incidentes: 0,
  sinRecoger: 0,
  enReparto: 0,
  otros: 0,
});

const FILAS: readonly FilaTableroDia[] = [
  fila("m-1", "Ángela Jiménez"),
  fila("m-2", "Bruno Díaz"),
  fila("m-3", "Ana Rojas"),
  fila("m-4", "Muñoz Vargas"),
];

describe("Feature 258 · R41 — encuentra un nombre con acentos escribiéndolo sin acentos", () => {
  it("«jimenez» encuentra «Jiménez», sin distinguir mayúsculas", () => {
    expect(filtrarFilas(FILAS, "jimenez").map((f) => f.mensajeroId)).toEqual(["m-1"]);
    expect(filtrarFilas(FILAS, "JIMENEZ").map((f) => f.mensajeroId)).toEqual(["m-1"]);
    expect(filtrarFilas(FILAS, "Jiménez").map((f) => f.mensajeroId)).toEqual(["m-1"]);
  });

  it("también al revés: «Ángela» se encuentra escribiendo «angela»", () => {
    expect(filtrarFilas(FILAS, "angela").map((f) => f.mensajeroId)).toEqual(["m-1"]);
  });

  it("la eñe también: «munoz» encuentra «Muñoz»", () => {
    expect(filtrarFilas(FILAS, "munoz").map((f) => f.mensajeroId)).toEqual(["m-4"]);
  });

  it("la normalización quita acentos y baja a minúsculas", () => {
    expect(normalizarNombre("  ÁNGELA Jiménez  ")).toBe("angela jimenez");
  });
});

describe("Feature 258 · R40 — el filtro recorta y NADA más", () => {
  it("conserva el orden de entrada de las que quedan", () => {
    // El orden lo pone `ordenarFilasTablero` ANTES; el filtro no puede reordenar nada.
    expect(filtrarFilas(FILAS, "a").map((f) => f.mensajeroId)).toEqual([
      "m-1",
      "m-2",
      "m-3",
      "m-4",
    ]);
  });

  it("con la consulta vacía (o sólo espacios) devuelve las filas TAL CUAL", () => {
    expect(filtrarFilas(FILAS, "")).toBe(FILAS);
    expect(filtrarFilas(FILAS, "   ")).toBe(FILAS);
    expect(hayFiltroActivo("")).toBe(false);
    expect(hayFiltroActivo("   ")).toBe(false);
    expect(hayFiltroActivo("a")).toBe(true);
  });

  it("no muta el array recibido", () => {
    const entrada = [...FILAS];
    filtrarFilas(entrada, "ana");
    expect(entrada.map((f) => f.mensajeroId)).toEqual(["m-1", "m-2", "m-3", "m-4"]);
  });

  it("sin coincidencias devuelve la lista vacía, no todas", () => {
    expect(filtrarFilas(FILAS, "zzz")).toEqual([]);
  });
});

describe("Feature 258 · R71 — las iniciales del avatar", () => {
  it("toma la primera del nombre y la del primer apellido, CON su acento", () => {
    expect(iniciales("Ana Rojas")).toBe("AR");
    expect(iniciales("Ángela Jiménez")).toBe("ÁJ");
  });

  it("con un solo nombre da una sola letra", () => {
    expect(iniciales("Ana")).toBe("A");
  });

  it("con nombre compuesto usa la primera y la última palabra", () => {
    expect(iniciales("María José Vargas")).toBe("MV");
  });

  it("aguanta espacios de más y la cadena vacía sin reventar", () => {
    expect(iniciales("   Ana   Rojas  ")).toBe("AR");
    expect(iniciales("")).toBe("");
    expect(iniciales("   ")).toBe("");
  });
});
