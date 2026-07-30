import { describe, it, expect } from "vitest";

import {
  coincideBusqueda,
  filtrarAsignaciones,
  textoBuscable,
} from "@/app/(app)/mis-asignaciones/_components/mis-asignaciones-buscador";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 114 — tests de la función PURA de filtrado del buscador de guías (sin DOM).
// Cubre R3 (parcial + insensible a mayúsculas/acentos), R4 (numGuia null / numérico como
// texto) y R5 (query vacío o solo-espacios ⇒ lista completa). Cada test nombrado por
// comportamiento, no por función.

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    peso: 1,
    montoCobrar: 100,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: null,
    ...over,
  };
}

describe("mis-asignaciones-buscador", () => {
  it("R3: la coincidencia es PARCIAL e insensible a mayúsculas y acentos", () => {
    const orden = makeAsignacion({
      id: "g1",
      numRemision: "REM-001",
      destinatario: "Ana Pérez",
    });

    // `filtrarAsignaciones` normaliza el query CRUDO: mayúsculas y acentos coinciden
    // (PÉREZ / perez ↔ "Ana Pérez") y la subcadena parcial de la remisión (rem-0 ↔ REM-001).
    expect(filtrarAsignaciones([orden], "PÉREZ").map((o) => o.id)).toEqual(["g1"]);
    expect(filtrarAsignaciones([orden], "perez").map((o) => o.id)).toEqual(["g1"]);
    expect(filtrarAsignaciones([orden], "rem-0").map((o) => o.id)).toEqual(["g1"]);
    // Texto que no aparece en ningún campo → no coincide.
    expect(filtrarAsignaciones([orden], "gonzalez")).toEqual([]);
    // `coincideBusqueda` espera el query YA normalizado (contrato: el llamador normaliza).
    expect(coincideBusqueda(orden, "perez")).toBe(true);
  });

  it("R3: filtrarAsignaciones conserva solo las coincidentes y respeta el orden de entrada", () => {
    const ordenes = [
      makeAsignacion({ id: "g1", destinatario: "Ana Pérez" }),
      makeAsignacion({ id: "g2", destinatario: "Beto Ruiz" }),
      makeAsignacion({ id: "g3", destinatario: "Carla Pérez" }),
    ];

    const resultado = filtrarAsignaciones(ordenes, "PEREZ");

    expect(resultado.map((o) => o.id)).toEqual(["g1", "g3"]);
  });

  it("R4: numGuia null NO coincide por guía pero sí por remisión o destinatario", () => {
    const orden = makeAsignacion({
      id: "g1",
      numGuia: null,
      numRemision: "REM-777",
      destinatario: "Dora Solís",
      telefonoDest: "88880000",
    });

    // El texto buscable no incluye la guía (aporta "") pero sí remisión, destinatario
    // y teléfono.
    expect(textoBuscable(orden)).toBe("rem-777 dora solis 88880000");
    // No coincide por un número de guía inexistente...
    expect(coincideBusqueda(orden, "1001")).toBe(false);
    // ...pero sí por su remisión y su destinatario.
    expect(coincideBusqueda(orden, "777")).toBe(true);
    expect(coincideBusqueda(orden, "dora")).toBe(true);
  });

  it("R4: numGuia numérico se compara como TEXTO (subcadena, 10 ↔ 1001)", () => {
    const orden = makeAsignacion({ id: "g1", numGuia: 1001 });

    expect(coincideBusqueda(orden, "10")).toBe(true);
    expect(coincideBusqueda(orden, "1001")).toBe(true);
    // No es coincidencia numérica: 20 no es subcadena de "1001".
    expect(coincideBusqueda(orden, "20")).toBe(false);
  });

  it("filtra por teléfono del destinatario (parcial)", () => {
    const orden = makeAsignacion({ id: "g1", telefonoDest: "88887777" });

    expect(filtrarAsignaciones([orden], "8888777").map((o) => o.id)).toEqual(["g1"]);
    expect(coincideBusqueda(orden, "88887777")).toBe(true);
    expect(coincideBusqueda(orden, "60001111")).toBe(false);
  });

  it("el teléfono se encuentra con o sin separadores en ambos lados", () => {
    // Guardado CON separadores: se busca tecleando solo dígitos.
    const conSeparadores = makeAsignacion({ id: "g1", telefonoDest: "8888-7777" });
    expect(coincideBusqueda(conSeparadores, "88887777")).toBe(true);
    expect(coincideBusqueda(conSeparadores, "8888-7777")).toBe(true);

    // Guardado SIN separadores: se busca tecleándolos.
    const sinSeparadores = makeAsignacion({ id: "g2", telefonoDest: "88887777" });
    expect(coincideBusqueda(sinSeparadores, "8888-7777")).toBe(true);
    expect(coincideBusqueda(sinSeparadores, "8888 7777")).toBe(true);
  });

  it("el reintento en solo-dígitos NO convierte un query de texto en comodín", () => {
    // "rem-0" no coincide con esta orden; sin acotar el reintento, su parte numérica
    // ("0") coincidiría con casi cualquier guía/teléfono.
    const orden = makeAsignacion({
      id: "g1",
      numGuia: 2050,
      numRemision: "REM-999",
      destinatario: "Ana",
      telefonoDest: "60001111",
    });

    expect(coincideBusqueda(orden, "rem-0")).toBe(false);
  });

  it("R5: query vacío o solo-espacios devuelve la lista completa sin filtrar", () => {
    const ordenes = [
      makeAsignacion({ id: "g1", destinatario: "Ana" }),
      makeAsignacion({ id: "g2", destinatario: "Beto" }),
    ];

    // Query vacío → misma referencia (no recorre).
    expect(filtrarAsignaciones(ordenes, "")).toBe(ordenes);
    // Solo espacios → también sin filtrar (normalizeName colapsa a "").
    expect(filtrarAsignaciones(ordenes, "   ")).toBe(ordenes);
    // Y coincideBusqueda con query normalizado vacío acepta cualquier orden.
    expect(coincideBusqueda(ordenes[0], "")).toBe(true);
  });
});
