import { describe, it, expect } from "vitest";

import {
  MSG_CANTON_RETIRADO,
  MSG_PROVINCIA_RETIRADA,
  indexBy,
  msgDistritoRetirado,
  normalize,
  resolveGeo,
} from "@/lib/services/geo-resolucion";
import type {
  CantonRow,
  DistritoRow,
  ProvinciaRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";

// FICHA 374 (R6/R32/R33) — el rechazo por NODO RETIRADO en `resolveGeo`.
//
// POR QUE EL RECHAZO VIVE AQUI Y NO EN EL `WHERE`. Si la lectura recortara los retirados, la fila
// caeria en «distrito no encontrado en el canton»: un mensaje que MIENTE sobre un distrito que
// existe y que manda al integrador a revisar la ortografia de una direccion correcta. Este archivo
// afirma que el mensaje es PROPIO y que NO es ninguno de los otros dos.
//
// `resolveGeo` lo comparten la carga masiva por sesion Y la cotizacion por API key, asi que esto
// es tambien el contrato publico del canal.

function provincia(nombre: string, disponible: boolean): ProvinciaRow {
  return { id: `p-${normalize(nombre)}`, nombre, disponible };
}

function canton(nombre: string, provinciaId: string, disponible: boolean): CantonRow {
  return { id: `c-${normalize(nombre)}`, nombre, provinciaId, disponible };
}

function distrito(
  nombre: string,
  cantonId: string,
  disponible: boolean,
  zonaId: string | null = "z1",
): DistritoRow {
  return {
    id: `d-${normalize(nombre)}`,
    nombre,
    cantonId,
    zonaId,
    esCentral: false,
    esZonaEspecial: false,
    disponible,
  };
}

/** Los tres indices, con las MISMAS claves que arma la carga real. */
function indices(provincias: ProvinciaRow[], cantones: CantonRow[], distritos: DistritoRow[]) {
  return [
    indexBy(provincias, (p) => normalize(p.nombre)),
    indexBy(cantones, (c) => `${c.provinciaId}::${normalize(c.nombre)}`),
    indexBy(distritos, (d) => `${d.cantonId}::${normalize(d.nombre)}`),
  ] as const;
}

const TERNA = { provincia: "Puntarenas", canton: "Buenos Aires", distrito: "Cabagra" };

/** Monta el mundo con los tres flags que se le pidan. */
function mundo(flags: { provincia: boolean; canton: boolean; distrito: boolean }) {
  const p = provincia("Puntarenas", flags.provincia);
  const c = canton("Buenos Aires", p.id, flags.canton);
  const d = distrito("Cabagra", c.id, flags.distrito);
  return indices([p], [c], [d]);
}

// =================================================================================================
// R6 — con todo disponible, el comportamiento es EXACTAMENTE el de antes
// =================================================================================================

describe("374/R6 — con todo el catalogo disponible, nada cambia", () => {
  it("la terna resuelve igual que siempre", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: true, canton: true, distrito: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("una terna disponible fue rechazada");
    expect(r.geo.zonaId).toBe("z1");
    expect(r.geo.distritoId).toBe("d-cabagra");
  });
});

// =================================================================================================
// R32 — un caso por nivel, con su mensaje propio
// =================================================================================================

describe("374/R32 — un nodo retirado se rechaza con mensaje PROPIO, no con «no encontrado»", () => {
  it("provincia retirada", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: false, canton: true, distrito: true }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("la provincia retirada paso");
    expect(r.fieldErrors).toEqual({ provincia: [MSG_PROVINCIA_RETIRADA] });
    // Literal, porque el literal ES el contrato publicado del canal.
    expect(MSG_PROVINCIA_RETIRADA).toBe("la provincia esta retirada del catalogo");
  });

  it("canton retirado", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: true, canton: false, distrito: true }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("el canton retirado paso");
    expect(r.fieldErrors).toEqual({ canton: [MSG_CANTON_RETIRADO] });
    expect(MSG_CANTON_RETIRADO).toBe("el canton esta retirado del catalogo");
  });

  it("distrito retirado, y el mensaje lo NOMBRA", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: true, canton: true, distrito: false }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("el distrito retirado paso");
    expect(r.fieldErrors).toEqual({ distrito: ["el distrito 'Cabagra' esta retirado del catalogo"] });
    expect(msgDistritoRetirado("Cabagra")).toBe("el distrito 'Cabagra' esta retirado del catalogo");
  });

  it("los tres mensajes NO son «no encontrado» ni «ambiguo»", () => {
    // Es la afirmacion central de R32: distinguirlos es lo que evita que el integrador salga a
    // corregir una direccion que esta bien escrita.
    const mensajes = [
      MSG_PROVINCIA_RETIRADA,
      MSG_CANTON_RETIRADO,
      msgDistritoRetirado("Cabagra"),
    ];
    for (const m of mensajes) {
      expect(m).not.toMatch(/no encontrad/i);
      expect(m).not.toMatch(/ambigu/i);
      expect(m).toMatch(/retirad/i);
    }
  });

  it("CONTRAPRUEBA: «no encontrado» sigue existiendo para lo que de verdad no existe", () => {
    // Sin esto, un cambio que sustituyera TODOS los mensajes por el de retirada pasaria en verde.
    const r = resolveGeo(
      { ...TERNA, distrito: "Fantasma" },
      ...mundo({ provincia: true, canton: true, distrito: true }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("un distrito inexistente paso");
    expect(r.fieldErrors.distrito).toEqual(["distrito no encontrado en el canton"]);
  });
});

// =================================================================================================
// R33 — la precedencia, y sale del orden en que la funcion ya resuelve
// =================================================================================================

describe("374/R33 — precedencia declarada: provincia, luego canton, luego distrito", () => {
  it("con los TRES retirados a la vez, el mensaje es el de la PROVINCIA", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: false, canton: false, distrito: false }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("una terna retirada entera paso");
    expect(Object.keys(r.fieldErrors)).toEqual(["provincia"]);
  });

  it("con canton y distrito retirados (provincia viva), gana el CANTON", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: true, canton: false, distrito: false }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("paso");
    expect(Object.keys(r.fieldErrors)).toEqual(["canton"]);
  });

  it("con provincia y distrito retirados (canton vivo), gana la PROVINCIA", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: false, canton: true, distrito: false }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("paso");
    expect(Object.keys(r.fieldErrors)).toEqual(["provincia"]);
  });

  it("el error va SIEMPRE en UN solo campo: nunca se devuelven dos motivos a la vez", () => {
    const r = resolveGeo(TERNA, ...mundo({ provincia: false, canton: false, distrito: false }));
    if (r.ok) throw new Error("paso");
    expect(Object.keys(r.fieldErrors)).toHaveLength(1);
  });
});

// =================================================================================================
// El orden con el chequeo de zona: «retirado» es mas concreto que «sin zona»
// =================================================================================================

describe("374 — «retirado» se dice ANTES que «no tiene zona asignada»", () => {
  it("un distrito retirado Y sin zona dice que esta RETIRADO", () => {
    // Un distrito retirado suele ademas quedarse sin zona. Decir «no tiene zona asignada» manda al
    // integrador a pedir que le configuren una tarifa en vez de a corregir la direccion.
    const p = provincia("Puntarenas", true);
    const c = canton("Buenos Aires", p.id, true);
    const d = distrito("Cabagra", c.id, false, null);
    const r = resolveGeo(TERNA, ...indices([p], [c], [d]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("paso");
    expect(r.fieldErrors.distrito).toEqual([msgDistritoRetirado("Cabagra")]);
  });

  it("CONTRAPRUEBA: disponible pero SIN zona sigue diciendo «no tiene zona asignada»", () => {
    const p = provincia("Puntarenas", true);
    const c = canton("Buenos Aires", p.id, true);
    const d = distrito("Cabagra", c.id, true, null);
    const r = resolveGeo(TERNA, ...indices([p], [c], [d]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("paso");
    expect(r.fieldErrors.distrito).toEqual(["el distrito 'Cabagra' no tiene zona asignada"]);
  });
});

// =================================================================================================
// La comparacion sigue siendo por forma normalizada
// =================================================================================================

describe("374 — el rechazo por retirada respeta la normalizacion de siempre", () => {
  it("«san jose» sin acentos encuentra el distrito retirado y lo rechaza como tal", () => {
    const p = provincia("San José", true);
    const c = canton("Central", p.id, true);
    const d = distrito("San José", c.id, false);
    const r = resolveGeo(
      { provincia: "san jose", canton: "CENTRAL", distrito: "san  jose" },
      ...indices([p], [c], [d]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("paso");
    // El mensaje lleva el nombre TAL COMO LLEGO en la fila, recortado: es lo que el integrador
    // escribio y lo que puede buscar en su archivo.
    expect(r.fieldErrors.distrito).toEqual([msgDistritoRetirado("san  jose")]);
  });
});
