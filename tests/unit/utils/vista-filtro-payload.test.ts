import { describe, it, expect } from "vitest";
import {
  MAX_VISTAS_POR_SUPERFICIE,
  NOMBRE_VISTA_MAX,
  SUPERFICIES_VISTA,
  VISTA_FILTRO_VERSION,
  leerPayloadGuardado,
  payloadVacio,
  superficieVistaSchema,
  versionDeclarada,
  vistaFiltroPayloadSchema,
  type VistaFiltroPayload,
} from "@/lib/types/vista-filtro";

// FICHA 453 (T1.1) — EL FORMATO PERSISTIDO DEL FILTRO: R5, R7 y la mitad de R8 que se puede
// afirmar sin base de datos (un documento que no se puede leer NO se interpreta a medias).
//
// ⚠️ Lo que este archivo vigila de verdad es que el formato sea PROPIO Y CERRADO: `.strict()` y
// `v` literal son lo que hace que un documento escrito por otro despliegue —o por una version
// futura del formato— se reporte ilegible en vez de aplicarse «lo que se entienda». Sin eso, el
// campo de version seria decoracion.

const PAYLOAD: VistaFiltroPayload = {
  v: VISTA_FILTRO_VERSION,
  termino: "san jose",
  activos: ["zona", "distrito", "created"],
  seleccion: {
    zona: ["z-1"],
    distrito: ["d-1", "d-2"],
    created: ["30d", "", ""],
  },
};

describe("453/R5 · el filtro guardado lleva LAS TRES PIEZAS de la barra", () => {
  it("⭑ un payload con termino, controles montados y seleccion parsea entero", () => {
    const leido = vistaFiltroPayloadSchema.parse(PAYLOAD);
    expect(leido.termino).toBe("san jose");
    expect(leido.activos).toEqual(["zona", "distrito", "created"]);
    expect(leido.seleccion.distrito).toEqual(["d-1", "d-2"]);
  });

  it("⭑ falta cualquiera de las tres y el documento NO es valido", () => {
    // R5 dice «las tres piezas y no solo una parte»: que las tres sean OBLIGATORIAS es lo que
    // impide guardar media barra y creer que se guardo entera.
    for (const pieza of ["termino", "activos", "seleccion"] as const) {
      const incompleto: Record<string, unknown> = { ...PAYLOAD };
      delete incompleto[pieza];
      expect(
        vistaFiltroPayloadSchema.safeParse(incompleto).success,
        `sin ${pieza} deberia fallar`,
      ).toBe(false);
    }
  });

  it("⭑ `activos` NO se deriva de `seleccion`: un control montado y vacio se guarda igual", () => {
    // Es el caso que justifica guardar la tercera pieza aparte. Si alguien «optimizara» derivando
    // los activos de las claves de la seleccion, este control desapareceria al aplicar la vista.
    const conControlVacio: VistaFiltroPayload = {
      v: VISTA_FILTRO_VERSION,
      termino: "",
      activos: ["tienda"],
      seleccion: {},
    };
    const leido = vistaFiltroPayloadSchema.parse(conControlVacio);
    expect(leido.activos).toEqual(["tienda"]);
    expect(Object.keys(leido.seleccion)).toEqual([]);
    // Y no es «vacio»: hay un control puesto, asi que hay algo que guardar (R12).
    expect(payloadVacio(leido)).toBe(false);
  });

  it("⭑ una clave de `seleccion` cuyo valor no es una lista de textos FALLA", () => {
    const roto = { ...PAYLOAD, seleccion: { zona: "z-1" } };
    expect(vistaFiltroPayloadSchema.safeParse(roto).success).toBe(false);
    const rotoNumerico = { ...PAYLOAD, seleccion: { zona: [1, 2] } };
    expect(vistaFiltroPayloadSchema.safeParse(rotoNumerico).success).toBe(false);
  });

  it("⭑ una clave DE MAS revienta: `.strict()` (el formato es cerrado)", () => {
    const conExtra = { ...PAYLOAD, sortBy: "num_remision" };
    expect(vistaFiltroPayloadSchema.safeParse(conExtra).success).toBe(false);
    // ⚠️ Es el caso que hace que el ORDEN del listado NO entre por la puerta de atras
    // (requirements.md > P1): si alguien lo añade, hay que subir la version del formato.
  });
});

describe("453/R12 · «no hay nada que guardar»", () => {
  it("⭑ sin termino, sin controles y sin valores: vacio", () => {
    expect(payloadVacio({ v: VISTA_FILTRO_VERSION, termino: "", activos: [], seleccion: {} })).toBe(
      true,
    );
    // Solo espacios tampoco es un termino.
    expect(
      payloadVacio({ v: VISTA_FILTRO_VERSION, termino: "   ", activos: [], seleccion: {} }),
    ).toBe(true);
    // Una clave con lista vacia no es un filtro puesto.
    expect(
      payloadVacio({ v: VISTA_FILTRO_VERSION, termino: "", activos: [], seleccion: { zona: [] } }),
    ).toBe(true);
  });

  it("⭑ cualquiera de las tres piezas con algo dentro basta para NO estar vacio", () => {
    expect(
      payloadVacio({ v: VISTA_FILTRO_VERSION, termino: "abc", activos: [], seleccion: {} }),
    ).toBe(false);
    expect(
      payloadVacio({ v: VISTA_FILTRO_VERSION, termino: "", activos: ["zona"], seleccion: {} }),
    ).toBe(false);
    expect(
      payloadVacio({
        v: VISTA_FILTRO_VERSION,
        termino: "",
        activos: [],
        seleccion: { zona: ["z-1"] },
      }),
    ).toBe(false);
  });
});

describe("453/R7 · la version del formato, y que sirva para algo", () => {
  it("⭑ un documento sin `v`, o con una `v` distinta de la conocida, NO parsea", () => {
    const sinVersion: Record<string, unknown> = { ...PAYLOAD };
    delete sinVersion.v;
    expect(vistaFiltroPayloadSchema.safeParse(sinVersion).success).toBe(false);
    expect(vistaFiltroPayloadSchema.safeParse({ ...PAYLOAD, v: 2 }).success).toBe(false);
    expect(vistaFiltroPayloadSchema.safeParse({ ...PAYLOAD, v: 0 }).success).toBe(false);
  });

  it("⭑ `versionDeclarada` lee la version SIN interpretar el documento", () => {
    // Es lo que deja distinguir «guardada con un formato mas nuevo» de «documento roto»: las dos
    // se niegan a aplicarse, pero no significan lo mismo para quien lo lee.
    expect(versionDeclarada({ v: 7, cualquier: "cosa" })).toBe(7);
    expect(versionDeclarada(PAYLOAD)).toBe(VISTA_FILTRO_VERSION);
    expect(versionDeclarada({ sinVersion: true })).toBeNull();
    expect(versionDeclarada("una cadena")).toBeNull();
    expect(versionDeclarada(null)).toBeNull();
    expect(versionDeclarada([{ v: 1 }])).toBeNull();
  });
});

describe("453/R8 · un documento que no se puede leer se reporta ilegible, no se adivina", () => {
  it("⭑ `leerPayloadGuardado` devuelve el payload cuando la version es conocida", () => {
    expect(leerPayloadGuardado(PAYLOAD)).toEqual(PAYLOAD);
    // Un JSON venido de la base es un objeto plano: el mismo camino.
    expect(leerPayloadGuardado(JSON.parse(JSON.stringify(PAYLOAD)))).toEqual(PAYLOAD);
  });

  it("⭑ una version DESCONOCIDA devuelve `null` — y no una lectura parcial", () => {
    const delFuturo = { v: 2, termino: "san jose", activos: ["zona"], seleccion: { zona: ["z-1"] } };
    const leido = leerPayloadGuardado(delFuturo);
    expect(leido).toBeNull();
    // ⚠️ La mutacion que este caso mata: leer «lo que se entienda» de un formato futuro. Si
    // alguien hiciera `return {...delFuturo, v: 1}`, esto se pone rojo. Aplicar un filtro que
    // nadie guardo es peor que no aplicar ninguno.
  });

  it("⭑ un documento roto, o que no es un objeto, tambien devuelve `null`", () => {
    expect(leerPayloadGuardado(null)).toBeNull();
    expect(leerPayloadGuardado("{}")).toBeNull();
    expect(leerPayloadGuardado({ v: 1 })).toBeNull();
    expect(leerPayloadGuardado({ ...PAYLOAD, seleccion: { zona: [1] } })).toBeNull();
    expect(leerPayloadGuardado({ ...PAYLOAD, sobra: true })).toBeNull();
  });
});

describe("453 · los numeros y la lista de superficies que el resto de la ficha da por ciertos", () => {
  it("⭑ el tope es 20 por superficie y el nombre llega a 60 (decisiones firmadas)", () => {
    // Literales a proposito: son el contrato con el humano (requirements.md > P2) y con la
    // columna `@db.VarChar(60)`. Compararlos con su propia constante estaria verde siempre.
    expect(MAX_VISTAS_POR_SUPERFICIE).toBe(20);
    expect(NOMBRE_VISTA_MAX).toBe(60);
  });

  it("⭑ R33: `ordenes` es superficie declarada; cualquier otra cadena se RECHAZA", () => {
    expect(SUPERFICIES_VISTA).toEqual(["ordenes"]);
    expect(superficieVistaSchema.safeParse("ordenes").success).toBe(true);
    expect(superficieVistaSchema.safeParse("cierres-admin").success).toBe(false);
    expect(superficieVistaSchema.safeParse("").success).toBe(false);
  });
});
