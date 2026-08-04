import { describe, it, expect } from "vitest";

import {
  coincideBusquedaMensajero,
  filtrarPorBusquedaMensajero,
  normalizarBusquedaMensajero,
  ordenarCuentasPorPagar,
  type FilaCuentaPorPagar,
} from "@/lib/utils/cuentas-por-pagar-listado";

// Chore de la deuda de la 170 (Q-L4) — la REGLA de busqueda del listado «Cuentas por pagar a
// mensajeros», probada donde vive.
//
// `lib/utils/cuentas-por-pagar-listado.ts` es el UNICO sitio donde este repo declara por que
// texto casa una fila de ese listado: lo usan el metodo paginado y el del conjunto completo del
// repositorio, asi que la tabla y el archivo no pueden discrepar por construccion. Hasta este
// chore no tenia test propio —se probaba de rebote, a traves del servicio y del repositorio—, y
// el cambio de este chore es justamente un cambio DE ESA REGLA.
//
// LA DECISION QUE ESTE ARCHIVO FIJA, y de quien es: la busqueda **ignora los acentos**. La tomo
// el LEADER en el chore de la deuda de la 170 y esta declarada en `progress/chore_deuda_170.md`.
// T L.1 la habia dejado accent-SENSIBLE a proposito, porque R45 le pedia reproducir el filtro
// que corria en el navegador; ese filtro dejo de existir cuando T M.1 (Q-L2) llevo la descarga
// al servidor, y lo que quedaba era un resultado que dependia de como se tecleara el nombre.
//
// Lo que NO cambia, y por eso hay tantos casos de abajo dedicados a ello: el recorte de extremos,
// el `includes` (subcadena en cualquier posicion, no prefijo), los espacios INTERIORES y el trato
// de `%` y `_` como texto literal. Un plegado escrito de mas —`normalizeName`, que ademas colapsa
// espacios interiores— rompe el penultimo sin que ningun otro test lo note.

/** El fixture de la bateria de T L.1, con los mismos nombres «sucios» a proposito. */
const FILAS: FilaCuentaPorPagar[] = [
  { mensajeroId: "m-01", mensajeroNombre: "Ana Mensajera" },
  { mensajeroId: "m-02", mensajeroNombre: "ana lópez" },
  { mensajeroId: "m-03", mensajeroNombre: "josé pérez" },
  { mensajeroId: "m-05", mensajeroNombre: "JOSE RAMIREZ" },
  { mensajeroId: "m-08", mensajeroNombre: "María del Carmen" },
  { mensajeroId: "m-09", mensajeroNombre: "Óscar Núñez" },
  { mensajeroId: "m-11", mensajeroNombre: "Ana_María Solís" },
  { mensajeroId: "m-13", mensajeroNombre: "  Bruno Díaz  " },
];

function ids(filas: readonly FilaCuentaPorPagar[]): string[] {
  return filas.map((f) => f.mensajeroId).sort();
}

function buscar(texto: string | undefined): string[] {
  return ids(filtrarPorBusquedaMensajero(FILAS, texto));
}

describe("normalizarBusquedaMensajero — el texto tecleado (Q-L4)", () => {
  it("pliega acentos, baja la caja y recorta los extremos", () => {
    expect(normalizarBusquedaMensajero("Ramírez")).toBe("ramirez");
    expect(normalizarBusquedaMensajero("  JOSÉ  ")).toBe("jose");
    expect(normalizarBusquedaMensajero("Núñez")).toBe("nunez");
    // Diéresis, grave y circunflejo también: no es una lista de tres tildes.
    expect(normalizarBusquedaMensajero("Müller Àgueda Ôscar")).toBe("muller agueda oscar");
  });

  it("un texto vacío, ausente o de solo espacios significa «sin filtro»", () => {
    expect(normalizarBusquedaMensajero("")).toBe("");
    expect(normalizarBusquedaMensajero("   ")).toBe("");
    expect(normalizarBusquedaMensajero(undefined)).toBe("");
  });

  it("NO colapsa los espacios interiores: es lo que el plegado de más habría roto", () => {
    // `normalizeName` (lib/utils/normalize.ts) devolvería aquí "del carmen". Se descartó por
    // esto: colapsar espacios es un segundo cambio de comportamiento que nadie pidió.
    expect(normalizarBusquedaMensajero("  del  carmen  ")).toBe("del  carmen");
  });

  it("`%` y `_` siguen siendo TEXTO, no comodines", () => {
    expect(normalizarBusquedaMensajero("%")).toBe("%");
    expect(normalizarBusquedaMensajero("a_m")).toBe("a_m");
  });
});

describe("coincideBusquedaMensajero — las DOS caras se pliegan igual (Q-L4)", () => {
  it("el nombre acentuado se encuentra tecleándolo SIN acentos", () => {
    expect(coincideBusquedaMensajero("José Pérez", normalizarBusquedaMensajero("jose"))).toBe(true);
    expect(coincideBusquedaMensajero("José Pérez", normalizarBusquedaMensajero("perez"))).toBe(true);
    expect(coincideBusquedaMensajero("Óscar Núñez", normalizarBusquedaMensajero("nunez"))).toBe(true);
  });

  it("y el nombre SIN acentos se encuentra tecleándolo CON acentos: el sentido contrario", () => {
    // Es la mitad que una implementación a medias deja fuera: si solo se plegara el texto
    // tecleado y no el nombre, «Ramírez» dejaría de encontrarse a sí mismo.
    expect(coincideBusquedaMensajero("JOSE RAMIREZ", normalizarBusquedaMensajero("ramírez"))).toBe(
      true,
    );
    expect(coincideBusquedaMensajero("José Pérez", normalizarBusquedaMensajero("pérez"))).toBe(true);
  });

  it("un texto normalizado vacío casa con cualquier nombre (sin filtro)", () => {
    expect(coincideBusquedaMensajero("Lo que sea", "")).toBe(true);
  });

  it("sigue siendo subcadena en cualquier posición, no prefijo", () => {
    expect(coincideBusquedaMensajero("Ana Mensajera", "mensajer")).toBe(true);
    expect(coincideBusquedaMensajero("Ana Mensajera", "zzz")).toBe(false);
  });
});

describe("filtrarPorBusquedaMensajero — el conjunto que ve el usuario (Q-L4)", () => {
  it("«jose» y «josé» devuelven AHORA las mismas dos filas", () => {
    // Antes de este chore: «jose» -> [m-05] y «josé» -> [m-03]. El resultado dependía de cómo se
    // tecleara, que es exactamente el defecto que el LEADER decidió cerrar.
    expect(buscar("jose")).toEqual(["m-03", "m-05"]);
    expect(buscar("josé")).toEqual(["m-03", "m-05"]);
    expect(buscar("JOSÉ")).toEqual(["m-03", "m-05"]);
    expect(buscar("JOSE")).toEqual(["m-03", "m-05"]);
  });

  it("«perez» ya no devuelve cero: encuentra a «josé pérez»", () => {
    expect(buscar("perez")).toEqual(["m-03"]);
    expect(buscar("pérez")).toEqual(["m-03"]);
  });

  it("una vocal suelta alcanza también a sus formas acentuadas", () => {
    // «o» y «ó» son ahora el mismo conjunto. Antes «ó» traía solo las dos acentuadas y «o» las
    // demás: dos búsquedas complementarias que nadie sabía que lo eran.
    const conO = buscar("o");
    expect(conO).toEqual(buscar("ó"));
    expect(conO).toEqual(buscar("Ó"));
    expect(conO).toEqual(["m-02", "m-03", "m-05", "m-09", "m-11", "m-13"]);
  });

  it("«ñ» se pliega a «n», con la consecuencia declarada", () => {
    // La contrapartida honesta de plegar: «ñ» ya no es una letra propia y trae todo lo que
    // lleve «n». Se declara aquí en vez de esconderlo — es el precio de que «Nunez» encuentre a
    // «Núñez», y en un buscador por subcadena de una sola letra el ruido ya existía («o», «z»).
    expect(buscar("ñ")).toEqual(buscar("n"));
    expect(buscar("ñ")).toContain("m-09");
    expect(buscar("nunez")).toEqual(["m-09"]);
  });

  it("lo que NO cambia: extremos, espacios interiores, comodines y caja", () => {
    expect(buscar("")).toEqual(ids(FILAS)); // sin filtro
    expect(buscar("   ")).toEqual(ids(FILAS));
    expect(buscar(undefined)).toEqual(ids(FILAS));
    expect(buscar("  ana  ")).toEqual(["m-01", "m-02", "m-11"]);
    expect(buscar("ANA")).toEqual(["m-01", "m-02", "m-11"]);
    expect(buscar("del carmen")).toEqual(["m-08"]); // espacio INTERIOR: no se recorta
    expect(buscar("%")).toEqual([]); // comodín de SQL tratado como texto
    expect(buscar("a_m")).toEqual(["m-11"]); // el `_` es texto
    expect(buscar("bruno")).toEqual(["m-13"]); // nombre con espacios al principio y al final
    expect(buscar("zzz")).toEqual([]);
  });

  it("no muta el array recibido y devuelve una copia sin filtro", () => {
    const copia = [...FILAS];
    const todas = filtrarPorBusquedaMensajero(FILAS, "");
    expect(FILAS).toEqual(copia);
    expect(todas).not.toBe(FILAS);
    expect(todas).toHaveLength(FILAS.length);
  });
});

describe("ordenarCuentasPorPagar — el orden NO se toca en este chore", () => {
  it("sigue ordenando por nombre con el id de desempate, acentos incluidos", () => {
    // El orden usa `localeCompare`, que ya trataba «á» junto a «a». Este chore cambia el FILTRO,
    // no el ORDEN: si alguien plegara también aquí, «Óscar» saltaría de sitio en la tabla.
    const ordenadas = ordenarCuentasPorPagar(FILAS).map((f) => f.mensajeroNombre);
    expect(ordenadas[0]).toBe("  Bruno Díaz  ");
    expect(ordenadas).toContain("Óscar Núñez");
    expect(ordenadas).toHaveLength(FILAS.length);
  });

  it("dos homónimos exactos se desempatan por id, de forma estable", () => {
    const homonimos: FilaCuentaPorPagar[] = [
      { mensajeroId: "m-06", mensajeroNombre: "Repetida" },
      { mensajeroId: "m-04", mensajeroNombre: "Repetida" },
    ];
    expect(ordenarCuentasPorPagar(homonimos).map((f) => f.mensajeroId)).toEqual(["m-04", "m-06"]);
  });
});
