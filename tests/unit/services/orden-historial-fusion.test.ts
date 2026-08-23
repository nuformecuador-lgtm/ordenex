import { describe, it, expect, vi } from "vitest";

import {
  OrdenHistorialService,
  fusionarLineaDeTiempo,
} from "@/lib/services/OrdenHistorialService";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IOrdenHistorialRepository } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import type { IOrdenDiaRepartoCambioRepository } from "@/lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenDTO } from "@/lib/types/orden";
import type {
  OrdenHistorialCorreccionDiaDTO,
  OrdenHistorialTransicionDTO,
} from "@/lib/types/orden-historial";

/**
 * ⭑ FEATURE 262 (B27, R37/R40/R41/R44/R45) — LA LINEA DE TIEMPO SE ARMA DE DOS FUENTES.
 *
 * Dos niveles, y hacen falta los dos:
 *
 *  - la funcion PURA `fusionarLineaDeTiempo`, donde vive la REGLA DE ORDEN. Se prueba sin repos
 *    y sin reloj, que es lo que permite afirmar el empate exacto sin depender de como se sembro
 *    nada;
 *  - el SERVICIO, donde vive la AUTORIZACION. R44 no dice «la fusion respeta los permisos»: dice
 *    que no se añade NINGUNA regla de visibilidad nueva. Eso solo es afirmable comprobando que la
 *    segunda lectura NI SIQUIERA SE EMITE cuando la primera no estaba autorizada.
 *
 * Lo que este archivo NO puede probar, dicho para que nadie lo confunda con cobertura: el `WHERE`
 * por `orden_id` y el `ORDER BY ... , id ASC` del repositorio. Los dobles no ven el SQL — medido
 * cuatro veces en este repo. Eso vive en
 * `tests/integration/db/correccion-dia-reparto-historial.int.test.ts` (B28).
 */

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN: Actor = { usuarioId: "u-admin", rol: "admin" };
const TIENDA: Actor = { usuarioId: "u-tienda", rol: "adminTienda" };
const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const SATELITE: Actor = { usuarioId: "as1", rol: "adminSatelite" };

const ZONA = "z-limon";

// --------------------------------------------------------------------------------------------
// Fixtures. Los instantes se eligen a mano y DESORDENADOS: si el orden saliera de como se
// escribieron las listas en vez de del comparador, estas mismas aserciones se pondrian rojas.
// --------------------------------------------------------------------------------------------

function transicion(
  iso: string,
  overrides: Partial<OrdenHistorialTransicionDTO> = {},
): OrdenHistorialTransicionDTO {
  return {
    clase: "transicion",
    estatusOrigenValue: null,
    estatusDestinoValue: "en_preparacion",
    origenTipo: "carga_masiva",
    actorNombre: "Tienda X",
    motivo: null,
    createdAt: new Date(iso),
    ...overrides,
  };
}

function correccion(
  iso: string,
  overrides: Partial<OrdenHistorialCorreccionDiaDTO> = {},
): OrdenHistorialCorreccionDiaDTO {
  return {
    clase: "correccion_dia",
    fechaAnteriorISO: "2026-08-22",
    fechaNuevaISO: "2026-08-21",
    actorNombre: "Ana Perez",
    motivo: "la bodega marco el lote para el dia siguiente por error",
    createdAt: new Date(iso),
    ...overrides,
  };
}

/** Etiqueta corta de una entrada, para leer el ORDEN de un vistazo en la asercion. */
function marcas(entradas: readonly { clase: string; createdAt: Date }[]): string[] {
  return entradas.map((e) => `${e.clase}@${e.createdAt.toISOString()}`);
}

/* ============================================================================================ */
/* (a) R37 + R40 — la regla de orden, en la funcion pura                                        */
/* ============================================================================================ */

describe("fusionarLineaDeTiempo — R37: las correcciones ESTAN en la linea de tiempo", () => {
  it("una orden con dos transiciones y dos correcciones devuelve las CUATRO, intercaladas por instante", () => {
    const t1 = transicion("2026-08-20T10:00:00.000Z");
    const t2 = transicion("2026-08-22T16:00:00.000Z", {
      estatusOrigenValue: "por_recoger",
      estatusDestinoValue: "en_reparto",
      origenTipo: "recoleccion",
    });
    const c1 = correccion("2026-08-21T09:14:00.000Z");
    const c2 = correccion("2026-08-23T11:00:00.000Z", {
      fechaAnteriorISO: "2026-08-21",
      fechaNuevaISO: "2026-08-22",
    });

    // M-y (devolver solo las transiciones) muere aqui: `toEqual` compara la lista ENTERA, asi
    // que descartar las correcciones deja dos elementos donde el contrato exige cuatro.
    expect(fusionarLineaDeTiempo([t1, t2], [c1, c2])).toEqual([t1, c1, t2, c2]);
  });

  it("una orden con SOLO correcciones y ninguna transicion las devuelve todas, en orden", () => {
    const c1 = correccion("2026-08-21T09:14:00.000Z");
    const c2 = correccion("2026-08-21T09:15:00.000Z");
    expect(fusionarLineaDeTiempo([], [c1, c2])).toEqual([c1, c2]);
  });

  it("CONTROL DE NO-VACUIDAD: las dos clases llegan de verdad al resultado", () => {
    // Sin esto, un `toEqual` sobre listas mal construidas podria estar comparando vacio con
    // vacio y las tres aserciones de arriba pasarian sin decir nada.
    const salida = fusionarLineaDeTiempo(
      [transicion("2026-08-20T10:00:00.000Z")],
      [correccion("2026-08-21T09:14:00.000Z")],
    );
    expect(salida.map((e) => e.clase).sort()).toEqual(["correccion_dia", "transicion"]);
  });
});

describe("fusionarLineaDeTiempo — R40: ascendente sobre las DOS fuentes, y determinista", () => {
  it("ordena ascendente aunque cada fuente llegue del reves", () => {
    // Que salga ordenado con la entrada INVERTIDA es lo que demuestra que el orden lo pone el
    // COMPARADOR y no la concatenacion. M-z (concatenar sin ordenar) muere justo aqui.
    const t = [
      transicion("2026-08-22T16:00:00.000Z"),
      transicion("2026-08-20T10:00:00.000Z"),
    ];
    const c = [
      correccion("2026-08-23T11:00:00.000Z"),
      correccion("2026-08-21T09:14:00.000Z"),
    ];

    expect(marcas(fusionarLineaDeTiempo(t, c))).toEqual([
      "transicion@2026-08-20T10:00:00.000Z",
      "correccion_dia@2026-08-21T09:14:00.000Z",
      "transicion@2026-08-22T16:00:00.000Z",
      "correccion_dia@2026-08-23T11:00:00.000Z",
    ]);
  });

  it("el resultado NO depende del orden en que venia cada lista: invertir las dos da lo mismo", () => {
    const t = [
      transicion("2026-08-20T10:00:00.000Z"),
      transicion("2026-08-22T16:00:00.000Z"),
    ];
    const c = [
      correccion("2026-08-21T09:14:00.000Z"),
      correccion("2026-08-23T11:00:00.000Z"),
    ];

    const derecho = marcas(fusionarLineaDeTiempo(t, c));
    const alReves = marcas(fusionarLineaDeTiempo([...t].reverse(), [...c].reverse()));

    expect(alReves).toEqual(derecho);
    // Y el orden es el que se espera, no «el mismo desorden dos veces».
    expect(derecho).toEqual([
      "transicion@2026-08-20T10:00:00.000Z",
      "correccion_dia@2026-08-21T09:14:00.000Z",
      "transicion@2026-08-22T16:00:00.000Z",
      "correccion_dia@2026-08-23T11:00:00.000Z",
    ]);
  });

  it("EMPATE EXACTO de instante: primero la TRANSICION, despues la correccion", () => {
    // La regla es arbitraria y por eso esta DECLARADA (design §14.3). Invertir el desempate
    // —la otra mitad de M-z— pone rojo este test y solo este.
    const MISMO = "2026-08-21T09:14:00.000Z";
    const t = transicion(MISMO);
    const c = correccion(MISMO);

    expect(fusionarLineaDeTiempo([t], [c])).toEqual([t, c]);
  });

  it("el empate se resuelve IGUAL aunque la correccion llegue con mas compania", () => {
    // Un lote corregido de golpe escribe N filas con el MISMO `CURRENT_TIMESTAMP`; si ademas
    // coincide con una transicion, el desempate tiene que seguir valiendo para todas.
    const MISMO = "2026-08-21T09:14:00.000Z";
    const t = transicion(MISMO);
    const c1 = correccion(MISMO, { motivo: "primera del lote" });
    const c2 = correccion(MISMO, { motivo: "segunda del lote" });

    expect(fusionarLineaDeTiempo([t], [c1, c2])).toEqual([t, c1, c2]);
  });

  it("dentro de la misma fuente se preserva el orden que la fuente entrego", () => {
    // El repositorio de correcciones desempata por `id ASC`; la fusion NO puede deshacer ese
    // trabajo reordenando dos filas del mismo instante.
    const MISMO = "2026-08-21T09:14:00.000Z";
    const primera = correccion(MISMO, { motivo: "la que el repo puso primera" });
    const segunda = correccion(MISMO, { motivo: "la que el repo puso segunda" });

    expect(fusionarLineaDeTiempo([], [primera, segunda])).toEqual([primera, segunda]);
    expect(fusionarLineaDeTiempo([], [segunda, primera])).toEqual([segunda, primera]);
  });
});

/* ============================================================================================ */
/* (b) R45 — sin correcciones, la linea de tiempo es EXACTAMENTE la de antes                     */
/* ============================================================================================ */

describe("fusionarLineaDeTiempo — R45: una orden SIN correcciones se lee igual que antes de la 262", () => {
  it("con la lista de correcciones vacia devuelve las transiciones, mismas entradas y mismo orden", () => {
    const t1 = transicion("2026-08-20T10:00:00.000Z");
    const t2 = transicion("2026-08-20T15:00:00.000Z", {
      estatusOrigenValue: "en_preparacion",
      estatusDestinoValue: "por_recoger",
      origenTipo: "asignacion_bodega",
      actorNombre: "Bodega Central",
    });
    const t3 = transicion("2026-08-21T08:00:00.000Z", {
      estatusOrigenValue: "por_recoger",
      estatusDestinoValue: "en_reparto",
      origenTipo: "recoleccion",
      actorNombre: null,
    });

    // El literal se escribe A MANO y campo a campo: es EL CONTRATO de lo que el drawer recibe.
    // Compararlo contra `[t1, t2, t3]` seria compararlo contra su propia fuente.
    expect(fusionarLineaDeTiempo([t1, t2, t3], [])).toEqual([
      {
        clase: "transicion",
        estatusOrigenValue: null,
        estatusDestinoValue: "en_preparacion",
        origenTipo: "carga_masiva",
        actorNombre: "Tienda X",
        motivo: null,
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
      },
      {
        clase: "transicion",
        estatusOrigenValue: "en_preparacion",
        estatusDestinoValue: "por_recoger",
        origenTipo: "asignacion_bodega",
        actorNombre: "Bodega Central",
        motivo: null,
        createdAt: new Date("2026-08-20T15:00:00.000Z"),
      },
      {
        clase: "transicion",
        estatusOrigenValue: "por_recoger",
        estatusDestinoValue: "en_reparto",
        origenTipo: "recoleccion",
        actorNombre: null,
        motivo: null,
        createdAt: new Date("2026-08-21T08:00:00.000Z"),
      },
    ]);
  });

  it("con dos transiciones del MISMO instante conserva el orden que trajo el repositorio", () => {
    // `findHistorialByOrden` ordena por `created_at asc` A SECAS: hoy tampoco desempata, y esta
    // ficha NO lo cambia (design §14.3, punto 3). Lo que la fusion tiene prohibido es EMPEORARLO.
    const MISMO = "2026-08-20T10:00:00.000Z";
    const a = transicion(MISMO, { estatusDestinoValue: "en_preparacion" });
    const b = transicion(MISMO, {
      estatusOrigenValue: "en_preparacion",
      estatusDestinoValue: "por_recoger",
    });

    expect(fusionarLineaDeTiempo([a, b], [])).toEqual([a, b]);
    expect(fusionarLineaDeTiempo([b, a], [])).toEqual([b, a]);
  });

  it("lista vacia y lista vacia -> lista vacia (el drawer pinta su estado vacio)", () => {
    expect(fusionarLineaDeTiempo([], [])).toEqual([]);
  });
});

/* ============================================================================================ */
/* (c) R41 + R44 — la fusion la hace el SERVIDOR, y la autorizacion no gana ninguna regla        */
/* ============================================================================================ */

function ordenDTO(overrides: Partial<OrdenDTO> = {}): OrdenDTO {
  return {
    id: "o1",
    numGuia: 10,
    numRemision: "R-1",
    estatusId: "s-reparto",
    destinatario: "Ana",
    telefonoDest: "099",
    tiendaId: "u-tienda",
    zonaId: ZONA,
    provinciaId: "p1",
    cantonId: "c1",
    distritoId: null,
    producto: "caja",
    peso: null,
    notas: null,
    mensajeroAsignadoId: "m1",
    createdAt: new Date("2026-08-20T09:00:00.000Z"),
    updatedAt: new Date("2026-08-20T09:00:00.000Z"),
    ...overrides,
  };
}

const T_UNICA = transicion("2026-08-20T10:00:00.000Z");
const C_UNICA = correccion("2026-08-21T09:14:00.000Z");

interface Dobles {
  ordenRepo: Pick<IOrdenRepository, "findById" | "findUsuarioZonaId">;
  historialRepo: Pick<
    IOrdenHistorialRepository,
    "findHistorialByOrden" | "existeActuacionDe" | "contarIntentosVigentes"
  >;
  correccionRepo: IOrdenDiaRepartoCambioRepository;
}

function dobles(overrides: Partial<OrdenDTO> = {}, actuo = false): Dobles {
  return {
    ordenRepo: {
      findById: vi.fn(async () => ordenDTO(overrides)),
      findUsuarioZonaId: vi.fn(async () => ZONA),
    },
    historialRepo: {
      findHistorialByOrden: vi.fn(async () => [T_UNICA]),
      existeActuacionDe: vi.fn(async () => actuo),
      contarIntentosVigentes: vi.fn(async () => 0),
    },
    correccionRepo: { findCorreccionesByOrden: vi.fn(async () => [C_UNICA]) },
  };
}

function servicio(d: Dobles): OrdenHistorialService {
  return new OrdenHistorialService(
    d.ordenRepo as unknown as IOrdenRepository,
    d.historialRepo as unknown as IOrdenHistorialRepository,
    d.correccionRepo,
  );
}

describe("OrdenHistorialService — R41: la fusion y el orden viven en el SERVIDOR", () => {
  it("el `ok` trae YA fusionadas y ordenadas las entradas de las DOS fuentes", async () => {
    const d = dobles();
    const r = await servicio(d).obtenerHistorial("o1", MAESTRO);

    if (r.status !== "ok") throw new Error(`esperaba ok, llego ${r.status}`);
    expect(r.entradas).toEqual([T_UNICA, C_UNICA]);
    expect(d.correccionRepo.findCorreccionesByOrden).toHaveBeenCalledWith("o1");
  });

  it("ordena en el servidor aunque los repos devuelvan sus filas al reves del orden final", async () => {
    // Aqui la correccion es ANTERIOR a la transicion. La pantalla recibe ya el orden bueno: si
    // el servicio se limitara a concatenar (M-z) o delegara el orden al componente (M-aa), esta
    // asercion se pondria roja.
    const tTarde = transicion("2026-08-22T16:00:00.000Z");
    const cPronto = correccion("2026-08-21T09:14:00.000Z");
    const d = dobles();
    d.historialRepo.findHistorialByOrden = vi.fn(async () => [tTarde]);
    d.correccionRepo.findCorreccionesByOrden = vi.fn(async () => [cPronto]);

    const r = await servicio(d).obtenerHistorial("o1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(marcas(r.entradas)).toEqual([
      "correccion_dia@2026-08-21T09:14:00.000Z",
      "transicion@2026-08-22T16:00:00.000Z",
    ]);
  });

  it("`intentos` y `umbral` siguen viniendo con la linea de tiempo (47/R15 intacto)", async () => {
    const d = dobles();
    d.historialRepo.contarIntentosVigentes = vi.fn(async () => 2);
    const r = await servicio(d).obtenerHistorial("o1", MAESTRO);
    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.intentos).toBe(2);
    expect(r.umbral).toBeGreaterThan(0);
  });
});

describe("OrdenHistorialService — R44: MISMA autorizacion, sin ninguna regla nueva", () => {
  const CON_VISIBILIDAD: { nombre: string; actor: Actor; orden?: Partial<OrdenDTO>; actuo?: boolean }[] =
    [
      { nombre: "maestro", actor: MAESTRO },
      { nombre: "admin", actor: ADMIN },
      { nombre: "adminTienda de SU tienda", actor: TIENDA },
      { nombre: "mensajero asignado", actor: MENSAJERO },
      { nombre: "adminSatelite de SU zona", actor: SATELITE },
    ];

  for (const caso of CON_VISIBILIDAD) {
    it(`${caso.nombre} ve la correccion, con su motivo y sus dos fechas`, async () => {
      const d = dobles(caso.orden, caso.actuo);
      const r = await servicio(d).obtenerHistorial("o1", caso.actor);

      if (r.status !== "ok") throw new Error(`${caso.nombre}: esperaba ok, llego ${r.status}`);
      const correcciones = r.entradas.filter((e) => e.clase === "correccion_dia");
      expect(correcciones).toEqual([C_UNICA]);
      // El motivo escrito por quien corrigio se LEE (limite 8: es transparencia, no fuga).
      expect(correcciones[0].motivo).toBe(
        "la bodega marco el lote para el dia siguiente por error",
      );
    });
  }

  const SIN_VISIBILIDAD: {
    nombre: string;
    actor: Actor;
    orden?: Partial<OrdenDTO>;
    zonaActor?: string | null;
    esperado: "forbidden" | "not_found";
  }[] = [
    {
      nombre: "adminTienda de OTRA tienda",
      actor: TIENDA,
      orden: { tiendaId: "u-otra-tienda" },
      esperado: "not_found",
    },
    {
      nombre: "mensajero que ni la tiene ni la actuo",
      actor: MENSAJERO,
      orden: { mensajeroAsignadoId: "m9" },
      esperado: "forbidden",
    },
    {
      nombre: "adminSatelite de OTRA zona",
      actor: SATELITE,
      zonaActor: "z-cartago",
      esperado: "forbidden",
    },
    {
      nombre: "adminSatelite SIN zona",
      actor: SATELITE,
      zonaActor: null,
      esperado: "forbidden",
    },
  ];

  for (const caso of SIN_VISIBILIDAD) {
    it(`${caso.nombre} -> ${caso.esperado}, y el rastro NI SE LEE`, async () => {
      const d = dobles(caso.orden, false);
      if (caso.zonaActor !== undefined) {
        d.ordenRepo.findUsuarioZonaId = vi.fn(async () => caso.zonaActor ?? null);
      }
      const r = await servicio(d).obtenerHistorial("o1", caso.actor);

      expect(r.status).toBe(caso.esperado);
      // R44 no es «la fusion respeta los permisos»: es que la lectura del rastro NO SE EMITE
      // cuando la de transiciones tampoco se habria emitido. Un `select` que se manda y luego
      // se descarta ya seria una regla nueva —y una lectura de mas contra la base—.
      expect(d.correccionRepo.findCorreccionesByOrden).not.toHaveBeenCalled();
      expect(d.historialRepo.findHistorialByOrden).not.toHaveBeenCalled();
    });
  }

  it("rol desconocido -> forbidden sin leer NADA, ni la orden", async () => {
    const d = dobles();
    const r = await servicio(d).obtenerHistorial("o1", {
      usuarioId: "x",
      rol: "rol_que_no_existe" as Actor["rol"],
    });
    expect(r.status).toBe("forbidden");
    expect(d.ordenRepo.findById).not.toHaveBeenCalled();
    expect(d.correccionRepo.findCorreccionesByOrden).not.toHaveBeenCalled();
  });

  it("orden inexistente/borrada -> not_found, y tampoco se lee el rastro", async () => {
    const d = dobles();
    d.ordenRepo.findById = vi.fn(async () => null);
    const r = await servicio(d).obtenerHistorial("o1", MAESTRO);
    expect(r.status).toBe("not_found");
    expect(d.correccionRepo.findCorreccionesByOrden).not.toHaveBeenCalled();
  });
});

describe("OrdenHistorialService — R45 por la via del servicio", () => {
  it("sin correcciones, el `ok` es exactamente el de antes de la 262", async () => {
    const d = dobles();
    d.correccionRepo.findCorreccionesByOrden = vi.fn(async () => []);
    const r = await servicio(d).obtenerHistorial("o1", MAESTRO);

    if (r.status !== "ok") throw new Error("esperaba ok");
    expect(r.entradas).toEqual([
      {
        clase: "transicion",
        estatusOrigenValue: null,
        estatusDestinoValue: "en_preparacion",
        origenTipo: "carga_masiva",
        actorNombre: "Tienda X",
        motivo: null,
        createdAt: new Date("2026-08-20T10:00:00.000Z"),
      },
    ]);
  });
});
