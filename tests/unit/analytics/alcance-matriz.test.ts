import { describe, it, expect } from "vitest";
import { METRICAS } from "@/lib/analytics/metrics";
import { MENSAJERO_SIN_ASIGNAR, ROLES_ANALITICA } from "@/lib/analytics/types";
import type { RolAnalitica } from "@/lib/analytics/types";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica, AlcanceDatos } from "@/lib/analytics/alcance";

// Feature 122 / T5.4 — R22: MATRIZ EXHAUSTIVA.
//
// Sin RLS debajo, esta capa es la unica que separa inquilinos. Por eso R22 no se conforma
// con casos de ejemplo: recorre las 5 x 23 combinaciones de rol y metrica por las CUATRO
// formas de filtro (sin filtro, propio, ajeno, mixto) y afirma, sobre un universo
// sintetico de filas, que el conjunto ALCANZABLE es siempre un SUBCONJUNTO del alcance
// resuelto. 460 casos, ninguno sin asercion.
//
// El universo tiene, a proposito, filas de dos zonas, dos tiendas, dos mensajeros y el
// cubo sin asignar: cualquier recorte que se caiga deja de ser subconjunto y el test lo ve.

interface DimensionesFiltro {
  readonly zona_id?: readonly string[];
  readonly tienda_id?: readonly string[];
  readonly mensajero_id?: readonly string[];
}

interface FilaOrden {
  readonly id: string;
  readonly zonaId: string;
  readonly tiendaId: string;
  readonly mensajeroAsignadoId: string;
}

const UNIVERSO: readonly FilaOrden[] = [
  { id: "o1", zonaId: "z-propia", tiendaId: "tienda-propia", mensajeroAsignadoId: "m-propio" },
  { id: "o2", zonaId: "z-propia", tiendaId: "tienda-ajena", mensajeroAsignadoId: "m-ajeno" },
  { id: "o3", zonaId: "z-ajena", tiendaId: "tienda-propia", mensajeroAsignadoId: "m-ajeno" },
  { id: "o4", zonaId: "z-ajena", tiendaId: "tienda-ajena", mensajeroAsignadoId: "m-propio" },
  {
    id: "o5",
    zonaId: "z-propia",
    tiendaId: "tienda-propia",
    mensajeroAsignadoId: MENSAJERO_SIN_ASIGNAR,
  },
];

const ACTOR: Record<RolAnalitica, ActorAnalitica> = {
  maestro: { usuarioId: "u-maestro", rol: "maestro" },
  admin: { usuarioId: "u-admin", rol: "admin" },
  adminSatelite: { usuarioId: "u-sat", rol: "adminSatelite", zonaId: "z-propia" },
  adminTienda: { usuarioId: "tienda-propia", rol: "adminTienda" },
  mensajero: { usuarioId: "m-propio", rol: "mensajero" },
};

const FORMAS_DE_FILTRO = {
  sin_filtro: {},
  propio: { zona_id: ["z-propia"], tienda_id: ["tienda-propia"], mensajero_id: ["m-propio"] },
  ajeno: { zona_id: ["z-ajena"], tienda_id: ["tienda-ajena"], mensajero_id: ["m-ajeno"] },
  mixto: {
    zona_id: ["z-propia", "z-ajena"],
    tienda_id: ["tienda-propia", "tienda-ajena"],
    mensajero_id: ["m-propio", "m-ajeno", MENSAJERO_SIN_ASIGNAR],
  },
} as const;

const AHORA = new Date("2026-07-31T15:00:00.000Z");

/** Predicado del alcance resuelto: que filas PUEDE ver el actor, como maximo. */
function dentroDelAlcance(fila: FilaOrden, alcance: AlcanceDatos): boolean {
  switch (alcance.tipo) {
    case "global":
      return true;
    case "zona":
      return fila.zonaId === alcance.zonaId;
    case "tienda":
      return fila.tiendaId === alcance.tiendaId;
    case "mensajero":
      return fila.mensajeroAsignadoId === alcance.mensajeroId;
  }
}

/** Filas que el consumidor alcanzaria con el filtro YA recortado que devuelve la 122. */
function alcanzables(filtro: DimensionesFiltro): FilaOrden[] {
  const { zona_id: zona, tienda_id: tienda, mensajero_id: mensajero } = filtro;
  return UNIVERSO.filter(
    (f) =>
      (!zona || zona.includes(f.zonaId)) &&
      (!tienda || tienda.includes(f.tiendaId)) &&
      (!mensajero || mensajero.includes(f.mensajeroAsignadoId)),
  );
}

describe("R22 · toda combinacion de rol, metrica y filtro produce un subconjunto del alcance", () => {
  it("las 5 x 23 x 4 combinaciones quedan afirmadas, sin ninguna fila fuera del alcance", () => {
    let casos = 0;
    let conFilas = 0;

    for (const rol of ROLES_ANALITICA) {
      for (const metrica of METRICAS) {
        for (const [nombre, dimensiones] of Object.entries(FORMAS_DE_FILTRO)) {
          const etiqueta = `${rol}/${metrica.id}/${nombre}`;
          const r = prepararConsultaAnalitica(
            { rango: "dia", ...dimensiones },
            ACTOR[rol],
            metrica.id,
            AHORA,
          );
          casos++;

          if (r.status !== "ok") {
            // Denegar es siempre subconjunto: el conjunto alcanzable es vacio.
            expect(r.status, etiqueta).toBe("forbidden");
            continue;
          }

          const filas = alcanzables(r.consulta.filtro);
          for (const fila of filas) {
            expect(dentroDelAlcance(fila, r.consulta.alcance), `${etiqueta} filtra ${fila.id}`).toBe(
              true,
            );
          }
          if (filas.length > 0) conFilas++;
        }
      }
    }

    expect(casos).toBe(460);
    // Contrapeso: si el recorte dejara SIEMPRE cero filas, el subconjunto seria trivial y
    // el test pasaria por vacio.
    expect(conFilas).toBeGreaterThan(0);
  });

  it("el caso ajeno de un rol acotado siempre es forbidden, nunca ok con cero filas", () => {
    for (const rol of ["adminSatelite", "adminTienda", "mensajero"] as const) {
      for (const metrica of METRICAS.filter((m) => m.alcance[rol] === "acotado")) {
        const r = prepararConsultaAnalitica(
          { rango: "dia", ...FORMAS_DE_FILTRO.ajeno },
          ACTOR[rol],
          metrica.id,
          AHORA,
        );
        expect(r, `${rol}/${metrica.id}`).toEqual({
          status: "forbidden",
          motivo: "filtro_fuera_de_alcance",
        });
      }
    }
  });

  it("el caso mixto de un rol acotado conserva SOLO lo propio", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", ...FORMAS_DE_FILTRO.mixto },
      ACTOR.adminTienda,
      "entregas",
      AHORA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.filtro.tienda_id).toEqual(["tienda-propia"]);
    // o1, o3 y o5 son de su tienda (o3 en otra zona: su tienda tambien opera alli);
    // o2 y o4 son de la tienda ajena y quedan fuera pase lo que pase con el filtro.
    expect(
      alcanzables(r.consulta.filtro).map((f) => f.id),
    ).toEqual(["o1", "o3", "o5"]);
  });

  it("el universo sintetico tiene filas propias Y ajenas: el test no puede pasar por vacio", () => {
    expect(UNIVERSO.length).toBe(5);
    expect(UNIVERSO.filter((f) => f.zonaId === "z-ajena").length).toBeGreaterThan(0);
    expect(UNIVERSO.filter((f) => f.tiendaId === "tienda-ajena").length).toBeGreaterThan(0);
    expect(
      UNIVERSO.filter((f) => f.mensajeroAsignadoId === MENSAJERO_SIN_ASIGNAR).length,
    ).toBeGreaterThan(0);
  });
});
