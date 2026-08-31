import { describe, expect, it } from "vitest";

import {
  CLAVE_CANTON,
  CLAVE_CAUSA,
  CLAVE_MENSAJERO,
  CLAVE_PROVINCIA,
  CLAVE_SIN_CONTACTO,
  CLAVE_ZONA,
  ETIQUETA_SIN_CAUSA,
  ETIQUETA_SIN_MENSAJERO,
  SIN_CAUSA,
  SIN_MENSAJERO,
  coincideBusqueda,
  construirFiltrosNovedades,
  filtrarNovedades,
  hayValoresSeleccionados,
} from "@/app/(app)/novedades/_components/novedades-filtros";
import type { FilterSelection } from "@/components/shared/FilterComponent";
import type { NovedadDTO } from "@/lib/types/novedad";

// FICHA 325 — la mitad PURA de la barra de `/novedades`: que se ofrece en cada pestaña y como
// acota lo elegido. Los casos estan escritos para MORDER: cada uno compara contra un literal
// escrito a mano y contra el conjunto SIN filtrar, de modo que un filtro que dejara de filtrar
// —devolviendo todo— no pueda pasar por verde.

const base: NovedadDTO = {
  id: "o1",
  numGuia: 17496963,
  numRemision: "REM-2026-0912",
  estatusValue: "devuelta",
  intentosContacto: 0,
  mensajeroNombre: "Marta Mensajera",
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  producto: "Zapatos deportivos",
  peso: 1.5,
  direccion: "Av. Central 120, portón verde",
  montoCobrar: 24500,
  latitud: 9.9281,
  longitud: -84.0907,
  notas: "Llamar antes de llegar",
  tiendaNombre: "Tienda Demo",
  zonaNombre: "GAM Oeste",
  provinciaNombre: "San José",
  cantonNombre: "Escazú",
  distritoNombre: "San Rafael",
  secuenciaRuta: null,
};

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({ ...base, ...over });

/** Ids de un resultado, para comparar contra una lista escrita a mano. */
const ids = (items: readonly NovedadDTO[]): string[] => items.map((n) => n.id);

describe("buscador de novedades", () => {
  const uno = novedad({ id: "uno", numGuia: 1001, destinatario: "Ana Cliente" });
  const dos = novedad({
    id: "dos",
    numGuia: 2002,
    numRemision: "REM-2026-0555",
    destinatario: "Benito Ramírez",
    telefonoDest: "70001111",
    producto: "Licuadora",
  });
  const lista = [uno, dos];

  it("acota la lista: un término que solo casa con una orden deja esa y nada más", () => {
    expect(ids(filtrarNovedades(lista, "Benito", {}))).toEqual(["dos"]);
  });

  it("un término que no casa con ninguna deja la lista VACÍA, no la lista entera", () => {
    expect(filtrarNovedades(lista, "Pancracio", {})).toEqual([]);
  });

  it("sin término no acota nada: devuelve las dos, en el mismo orden", () => {
    expect(ids(filtrarNovedades(lista, "", {}))).toEqual(["uno", "dos"]);
    expect(ids(filtrarNovedades(lista, "   ", {}))).toEqual(["uno", "dos"]);
  });

  it("alcanza los CINCO campos que la pantalla enseña", () => {
    expect(coincideBusqueda(dos, "2002")).toBe(true); // guía
    expect(coincideBusqueda(dos, "REM-2026-0555")).toBe(true); // remisión
    expect(coincideBusqueda(dos, "Benito")).toBe(true); // destinatario
    expect(coincideBusqueda(dos, "70001111")).toBe(true); // teléfono
    expect(coincideBusqueda(dos, "Licuadora")).toBe(true); // producto
  });

  it("NO alcanza dirección ni notas: son textos largos y generarían coincidencias inexplicables", () => {
    expect(coincideBusqueda(uno, "portón verde")).toBe(false);
    expect(coincideBusqueda(uno, "Llamar antes")).toBe(false);
  });

  it("ignora acentos y mayúsculas en los dos lados", () => {
    expect(coincideBusqueda(dos, "ramirez")).toBe(true);
    expect(coincideBusqueda(dos, "RAMÍREZ")).toBe(true);
  });

  it("el teléfono se encuentra tecleado con separadores", () => {
    expect(coincideBusqueda(dos, "7000-1111")).toBe(true);
  });

  it("una orden sin guía no rompe la búsqueda ni casa con cualquier cosa", () => {
    const sinGuia = novedad({ id: "sinGuia", numGuia: null });
    expect(coincideBusqueda(sinGuia, "1001")).toBe(false);
    expect(coincideBusqueda(sinGuia, "Ana")).toBe(true);
  });
});

describe("filtros de novedades: cada campo acota de verdad", () => {
  const marta = novedad({
    id: "marta",
    mensajeroNombre: "Marta Mensajera",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    causa: "not_found",
    intentosContacto: 0,
  });
  const pedro = novedad({
    id: "pedro",
    mensajeroNombre: "Pedro Motorizado",
    zonaNombre: "GAM Este",
    provinciaNombre: "Cartago",
    cantonNombre: "Oreamuno",
    causa: "wrong_address",
    intentosContacto: 3,
  });
  const huerfana = novedad({
    id: "huerfana",
    mensajeroNombre: null,
    zonaNombre: "GAM Norte",
    provinciaNombre: "Heredia",
    cantonNombre: "Belén",
    causa: null,
    intentosContacto: 1,
  });
  const lista = [marta, pedro, huerfana];

  it("mensajero", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_MENSAJERO]: ["Pedro Motorizado"] }))).toEqual([
      "pedro",
    ]);
  });

  it("mensajero: «sin asignar» alcanza la orden que no tiene ninguno", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_MENSAJERO]: [SIN_MENSAJERO] }))).toEqual([
      "huerfana",
    ]);
  });

  it("zona", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_ZONA]: ["GAM Este"] }))).toEqual(["pedro"]);
  });

  it("provincia", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_PROVINCIA]: ["Heredia"] }))).toEqual([
      "huerfana",
    ]);
  });

  it("cantón", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_CANTON]: ["Escazú"] }))).toEqual(["marta"]);
  });

  it("causa: por su SLUG, nunca por la etiqueta que se pinta", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_CAUSA]: ["wrong_address"] }))).toEqual([
      "pedro",
    ]);
  });

  it("causa: «sin causa registrada» alcanza la orden sin causa vigente", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_CAUSA]: [SIN_CAUSA] }))).toEqual(["huerfana"]);
  });

  it("sin intentos de contacto: interruptor, deja solo las de contador en cero", () => {
    expect(ids(filtrarNovedades(lista, "", { [CLAVE_SIN_CONTACTO]: ["true"] }))).toEqual(["marta"]);
  });

  it("varios valores de una misma clave se combinan en O", () => {
    expect(
      ids(filtrarNovedades(lista, "", { [CLAVE_ZONA]: ["GAM Este", "GAM Norte"] })),
    ).toEqual(["pedro", "huerfana"]);
  });

  it("dos claves distintas se combinan en Y: incompatibles dejan la lista vacía", () => {
    expect(
      filtrarNovedades(lista, "", {
        [CLAVE_ZONA]: ["GAM Este"],
        [CLAVE_PROVINCIA]: ["Heredia"],
      }),
    ).toEqual([]);
  });

  it("el término y los filtros también se combinan en Y", () => {
    expect(
      ids(
        filtrarNovedades([marta, pedro], "Ana", {
          [CLAVE_MENSAJERO]: ["Marta Mensajera"],
        }),
      ),
    ).toEqual(["marta"]);
  });

  it("un control PEDIDO pero sin marcar no acota nada: la lista sigue entera", () => {
    const vacia: FilterSelection = { [CLAVE_MENSAJERO]: [], [CLAVE_ZONA]: [] };
    expect(hayValoresSeleccionados(vacia)).toBe(false);
    expect(ids(filtrarNovedades(lista, "", vacia))).toEqual(["marta", "pedro", "huerfana"]);
  });

  it("filtrar conserva el ORDEN de entrada: filtrar no es reordenar", () => {
    const alReves = [huerfana, pedro, marta];
    expect(
      ids(filtrarNovedades(alReves, "", { [CLAVE_ZONA]: ["GAM Norte", "GAM Oeste"] })),
    ).toEqual(["huerfana", "marta"]);
  });
});

describe("qué ofrece cada pestaña", () => {
  const items = [
    novedad({ id: "a", mensajeroNombre: "Zoraida", causa: "not_found", intentosContacto: 0 }),
    novedad({
      id: "b",
      mensajeroNombre: "Aurelio",
      causa: null,
      zonaNombre: "GAM Este",
      provinciaNombre: "Cartago",
      cantonNombre: "Oreamuno",
    }),
  ];
  const claves = (grupo: "ayuda" | "devolucion") =>
    construirFiltrosNovedades(grupo, items).map((f) => f.key);

  it("las cuatro compartidas están en LAS DOS pestañas", () => {
    for (const grupo of ["ayuda", "devolucion"] as const) {
      expect(claves(grupo)).toEqual(
        expect.arrayContaining([CLAVE_MENSAJERO, CLAVE_ZONA, CLAVE_PROVINCIA, CLAVE_CANTON]),
      );
    }
  });

  it("la CAUSA solo en devolución: en ayuda es siempre null por contrato (R26)", () => {
    expect(claves("devolucion")).toContain(CLAVE_CAUSA);
    expect(claves("ayuda")).not.toContain(CLAVE_CAUSA);
  });

  it("«sin intentos de contacto» solo en ayuda: es la columna propia de esa pestaña", () => {
    expect(claves("ayuda")).toContain(CLAVE_SIN_CONTACTO);
    expect(claves("devolucion")).not.toContain(CLAVE_SIN_CONTACTO);
  });

  it("no se declara ningún filtro de FECHA: el DTO no trae ni una", () => {
    for (const grupo of ["ayuda", "devolucion"] as const) {
      expect(
        construirFiltrosNovedades(grupo, items).some((f) => f.kind === "dateRange"),
      ).toBe(false);
    }
  });

  it("las opciones salen del CONJUNTO, ordenadas por su etiqueta en español", () => {
    const mensajero = construirFiltrosNovedades("devolucion", items).find(
      (f) => f.key === CLAVE_MENSAJERO,
    );
    expect(mensajero?.options?.map((o) => o.label)).toEqual(["Aurelio", "Zoraida"]);
  });

  it("una opción que no está en el conjunto NO se ofrece: ninguna lleva a una lista vacía", () => {
    const zona = construirFiltrosNovedades("devolucion", items).find((f) => f.key === CLAVE_ZONA);
    expect(zona?.options?.map((o) => o.value)).toEqual(["GAM Este", "GAM Oeste"]);
  });

  it("«sin mensajero» solo se ofrece si alguna orden lo está", () => {
    const conTodos = construirFiltrosNovedades("devolucion", items).find(
      (f) => f.key === CLAVE_MENSAJERO,
    );
    expect(conTodos?.options?.map((o) => o.label)).not.toContain(ETIQUETA_SIN_MENSAJERO);

    const conHuerfana = construirFiltrosNovedades("devolucion", [
      ...items,
      novedad({ id: "c", mensajeroNombre: null }),
    ]).find((f) => f.key === CLAVE_MENSAJERO);
    expect(conHuerfana?.options?.map((o) => o.label)).toContain(ETIQUETA_SIN_MENSAJERO);
  });

  it("la causa se ofrece con su etiqueta ES y su slug como valor, más «sin causa»", () => {
    const causa = construirFiltrosNovedades("devolucion", items).find(
      (f) => f.key === CLAVE_CAUSA,
    );
    expect(causa?.options).toEqual([
      { value: "not_found", label: "Cliente no localizado" },
      { value: SIN_CAUSA, label: ETIQUETA_SIN_CAUSA },
    ]);
  });

  it("el cantón cuelga de su provincia: la cadena se declara, no se programa", () => {
    const canton = construirFiltrosNovedades("devolucion", items).find(
      (f) => f.key === CLAVE_CANTON,
    );
    expect(canton?.dependsOn).toBe(CLAVE_PROVINCIA);
    expect(canton?.options).toEqual([
      { value: "Escazú", label: "Escazú", parentValue: "San José" },
      { value: "Oreamuno", label: "Oreamuno", parentValue: "Cartago" },
    ]);
  });

  it("sin conjunto cargado se ofrecen LOS MISMOS filtros, deshabilitados y sin opciones", () => {
    const sinConjunto = construirFiltrosNovedades("devolucion", null);
    expect(sinConjunto.map((f) => f.key)).toEqual(claves("devolucion"));
    expect(sinConjunto.every((f) => f.disabled === true)).toBe(true);
    expect(sinConjunto.every((f) => (f.options ?? []).length === 0)).toBe(true);
  });

  /**
   * GUARDIA — TODA clave declarada tiene que ACOTAR. El modo de fallo que cierra no es teórico:
   * un control que se pinta, se marca y no filtra nada es indistinguible de uno roto, y ningún
   * otro caso de este archivo lo vería (todos nombran su clave a mano).
   *
   * Se ejerce con un valor REAL sacado de las opciones que el propio filtro ofrece, y se exige
   * que el resultado sea ESTRICTAMENTE menor que el conjunto: devolver todo es el fallo.
   */
  it("guardia: cada filtro declarado en cada grupo acota el conjunto", () => {
    const conjunto = [
      novedad({
        id: "x",
        mensajeroNombre: "Zoraida",
        zonaNombre: "GAM Oeste",
        provinciaNombre: "San José",
        cantonNombre: "Escazú",
        causa: "not_found",
        intentosContacto: 0,
      }),
      novedad({
        id: "y",
        mensajeroNombre: "Aurelio",
        zonaNombre: "GAM Este",
        provinciaNombre: "Cartago",
        cantonNombre: "Oreamuno",
        causa: "wrong_address",
        intentosContacto: 4,
      }),
    ];

    for (const grupo of ["ayuda", "devolucion"] as const) {
      for (const filtro of construirFiltrosNovedades(grupo, conjunto)) {
        // Un `boolean` no tiene opciones: su único valor es el de marcado.
        const valor = filtro.kind === "boolean" ? "true" : filtro.options?.[0]?.value;
        expect(valor, `el filtro ${filtro.key} no ofrece ningún valor con el que ejercerse`)
          .toBeDefined();
        const acotado = filtrarNovedades(conjunto, "", { [filtro.key]: [valor as string] });
        expect(
          acotado.length,
          `el filtro «${filtro.label}» (${filtro.key}) del grupo ${grupo} no acota nada`,
        ).toBeLessThan(conjunto.length);
      }
    }
  });
});
