import { describe, it, expect } from "vitest";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import {
  derivarCantones,
  derivarDistritos,
  filtrarAsignaciones,
} from "@/lib/utils/filtro-canton-distrito";

// Feature 117 — lógica PURA del filtro cantón/distrito. Cubre R2, R4, R6, R7 y R13.
// Solo se rellenan los campos que el filtro lee; el resto es relleno estable.
function orden(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "en_ruta",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    peso: 1,
    montoCobrar: 0,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: null,
    ...over,
  };
}

describe("derivarCantones (R2/R13)", () => {
  it("R2: una opción por cantón único, etiqueta 'Cantón (Provincia)', ordenadas alfabéticamente", () => {
    const cantones = derivarCantones([
      orden({ id: "a", cantonNombre: "Escazú", provinciaNombre: "San José" }),
      orden({ id: "b", cantonNombre: "Alajuela", provinciaNombre: "Alajuela" }),
      orden({ id: "c", cantonNombre: "Escazú", provinciaNombre: "San José" }),
    ]);

    // Deduplicado (Escazú una sola vez) y ordenado alfabéticamente por etiqueta.
    expect(cantones).toEqual([
      { value: "Alajuela", label: "Alajuela (Alajuela)" },
      { value: "Escazú", label: "Escazú (San José)" },
    ]);
  });

  it("R2: dedup insensible a mayúsculas/acentos/espacios (misma clave cantón+provincia)", () => {
    const cantones = derivarCantones([
      orden({ id: "a", cantonNombre: "Pérez Zeledón", provinciaNombre: "San José" }),
      orden({ id: "b", cantonNombre: "  perez  zeledon ", provinciaNombre: "SAN JOSÉ" }),
    ]);

    // Una sola opción; conserva el PRIMER nombre original visto.
    expect(cantones).toEqual([
      { value: "Pérez Zeledón", label: "Pérez Zeledón (San José)" },
    ]);
  });

  it("R2: cantones HOMÓNIMOS en distinta provincia son DOS opciones (misma value, label distinto)", () => {
    const cantones = derivarCantones([
      orden({ id: "a", cantonNombre: "Central", provinciaNombre: "San José" }),
      orden({ id: "b", cantonNombre: "Central", provinciaNombre: "Alajuela" }),
    ]);

    expect(cantones).toEqual([
      { value: "Central", label: "Central (Alajuela)" },
      { value: "Central", label: "Central (San José)" },
    ]);
  });
});

describe("derivarDistritos (R4)", () => {
  it("R4: distritos del cantón dado, deduplicados, sin nulos y ordenados", () => {
    const ordenes = [
      orden({ id: "a", cantonNombre: "Central", distritoNombre: "Merced" }),
      orden({ id: "b", cantonNombre: "Central", distritoNombre: "Carmen" }),
      orden({ id: "c", cantonNombre: "Central", distritoNombre: "Carmen" }),
      orden({ id: "d", cantonNombre: "Central", distritoNombre: null }),
      // Otro cantón: no debe aparecer.
      orden({ id: "e", cantonNombre: "Escazú", distritoNombre: "San Rafael" }),
    ];

    expect(derivarDistritos(ordenes, "Central")).toEqual([
      { value: "Carmen", label: "Carmen" },
      { value: "Merced", label: "Merced" },
    ]);
  });

  it("R4: el cantón se compara normalizado (tolera acentos/caso)", () => {
    const ordenes = [
      orden({ id: "a", cantonNombre: "Pérez Zeledón", distritoNombre: "San Isidro" }),
    ];

    expect(derivarDistritos(ordenes, "perez zeledon")).toEqual([
      { value: "San Isidro", label: "San Isidro" },
    ]);
  });
});

describe("filtrarAsignaciones (R6/R7)", () => {
  const ordenes = [
    orden({ id: "a", cantonNombre: "Central", distritoNombre: "Carmen" }),
    orden({ id: "b", cantonNombre: "Central", distritoNombre: "Merced" }),
    orden({ id: "c", cantonNombre: "Central", distritoNombre: null }),
    orden({ id: "d", cantonNombre: "Escazú", distritoNombre: "San Rafael" }),
  ];

  it("R7: sin cantón devuelve la MISMA lista sin filtrar", () => {
    const out = filtrarAsignaciones(ordenes, { canton: "", distrito: "" });
    expect(out).toBe(ordenes); // misma referencia (no recorre).
  });

  it("R6: solo cantón muestra todas las de ese cantón (incluidas las de distrito nulo)", () => {
    const out = filtrarAsignaciones(ordenes, { canton: "Central", distrito: "" });
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("R6: cantón+distrito muestra solo las coincidentes y EXCLUYE distrito nulo", () => {
    const out = filtrarAsignaciones(ordenes, {
      canton: "Central",
      distrito: "Carmen",
    });
    expect(out.map((o) => o.id)).toEqual(["a"]);
  });

  it("R6: la comparación de cantón y distrito es insensible a acentos/caso", () => {
    const out = filtrarAsignaciones(ordenes, {
      canton: "central",
      distrito: "MERCED",
    });
    expect(out.map((o) => o.id)).toEqual(["b"]);
  });

  it("R6: distrito inexistente en el cantón produce lista vacía", () => {
    const out = filtrarAsignaciones(ordenes, {
      canton: "Central",
      distrito: "Hospital",
    });
    expect(out).toEqual([]);
  });
});

describe("estabilidad de opciones (R13)", () => {
  it("las opciones de cantón salen del conjunto COMPLETO, no del ya filtrado", () => {
    const todas = [
      orden({ id: "a", cantonNombre: "Central", provinciaNombre: "San José" }),
      orden({ id: "b", cantonNombre: "Escazú", provinciaNombre: "San José" }),
    ];
    // Aunque ya se haya filtrado por un cantón, derivar sobre el conjunto completo
    // sigue ofreciendo TODOS los cantones (la selección no borra opciones).
    const opcionesCompletas = derivarCantones(todas);
    const soloFiltrado = filtrarAsignaciones(todas, {
      canton: "Central",
      distrito: "",
    });

    expect(opcionesCompletas.map((o) => o.value)).toEqual(["Central", "Escazú"]);
    // El subconjunto filtrado tiene un solo cantón, pero eso NO es de donde salen
    // las opciones: derivar de él perdería "Escazú".
    expect(derivarCantones(soloFiltrado).map((o) => o.value)).toEqual(["Central"]);
    expect(opcionesCompletas.length).toBeGreaterThan(
      derivarCantones(soloFiltrado).length,
    );
  });
});
