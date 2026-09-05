// FICHA 374 (H1 · R44) — QUE ZONAS SE QUEDARIAN SIN NINGUN DISTRITO DISPONIBLE.
//
// Es la mitad PURA del aviso de la confirmacion de retirar: se deriva del arbol que el cliente ya
// tiene y no cuesta ni una consulta. La otra mitad —el conteo de ordenes sin entregar— si necesita
// servidor y se mide en `tests/unit/components/geografia-admin.ui.test.tsx`.
//
// AVISA; NO BLOQUEA (design §9, A4). Que la lista salga con nombres no impide nada: eso lo afirma
// el test de la pantalla, comprobando que el boton de confirmar sigue habilitado.
import { describe, it, expect } from "vitest";

import { zonasQueQuedarianSinDistritos } from "@/app/(app)/configuracion/geografia/_components/zonas-sin-distritos";
import type { DistritoArbolDTO, ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

function dist(
  id: string,
  nombre: string,
  zona: { id: string; nombre: string } | null,
  activo = true,
): DistritoArbolDTO {
  return {
    id,
    nombre,
    zonaId: zona?.id ?? null,
    zonaNombre: zona?.nombre ?? null,
    zonaEspecial: false,
    activo,
  };
}

const ZONA_SUR = { id: "z-sur", nombre: "Zona Sur" };
const ZONA_GAM = { id: "z-gam", nombre: "GAM Oeste" };
const ZONA_VACIA = { id: "z-vacia", nombre: "Zona Fantasma" };

/**
 * Arbol de prueba:
 *
 *  Puntarenas (activa)
 *    Buenos Aires (activo)  → Cabagra [Zona Sur]  ·  Volcán [Zona Sur]
 *    Osa (activo)           → Puerto Cortés [GAM Oeste]
 *  Alajuela (activa)
 *    Palmares (activo)      → Zaragoza [Zona Fantasma, YA retirado]  ·  Buenos Aires [sin zona]
 *
 * «Zona Sur» tiene DOS distritos a proposito: retirar uno de los dos no la deja vacia, y sin ese
 * caso «devuelve la zona» pasaria en verde con una funcion que nombra siempre a todas.
 */
const ARBOL: ProvinciaArbolDTO[] = [
  {
    id: "p-pu",
    nombre: "Puntarenas",
    activo: true,
    cantones: [
      {
        id: "c-ba",
        nombre: "Buenos Aires",
        activo: true,
        distritos: [dist("d-cab", "Cabagra", ZONA_SUR), dist("d-vol", "Volcán", ZONA_SUR)],
      },
      {
        id: "c-osa",
        nombre: "Osa",
        activo: true,
        distritos: [dist("d-cortes", "Puerto Cortés", ZONA_GAM)],
      },
    ],
  },
  {
    id: "p-al",
    nombre: "Alajuela",
    activo: true,
    cantones: [
      {
        id: "c-pal",
        nombre: "Palmares",
        activo: true,
        distritos: [
          dist("d-zar", "Zaragoza", ZONA_VACIA, false),
          dist("d-ba", "Buenos Aires", null),
        ],
      },
    ],
  },
];

describe("374/R44 — las zonas que se quedarían sin ningún distrito disponible", () => {
  it("retirar UN distrito de una zona de dos no deja ninguna zona vacía", () => {
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "distrito", id: "d-cab" })).toEqual([]);
  });

  it("retirar el ÚNICO distrito de una zona la nombra", () => {
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "distrito", id: "d-cortes" })).toEqual([
      "GAM Oeste",
    ]);
  });

  it("retirar un CANTÓN nombra las zonas que solo se sostenían con sus distritos", () => {
    // Osa aporta el unico distrito de GAM Oeste; Buenos Aires aporta los dos de Zona Sur.
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "canton", id: "c-osa" })).toEqual([
      "GAM Oeste",
    ]);
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "canton", id: "c-ba" })).toEqual([
      "Zona Sur",
    ]);
  });

  it("retirar una PROVINCIA nombra TODAS sus zonas, en orden alfabético", () => {
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "provincia", id: "p-pu" })).toEqual([
      "GAM Oeste",
      "Zona Sur",
    ]);
  });

  it("⭑ una zona que YA estaba vacía NO se nombra: no se queda vacía por este cambio", () => {
    // «Zona Fantasma» solo tiene a Zaragoza y Zaragoza ya estaba retirada. Echarle la culpa a quien
    // retira Palmares seria un aviso falso, y un aviso falso enseña a ignorar los verdaderos.
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "canton", id: "c-pal" })).toEqual([]);
  });

  it("un distrito SIN zona utilizable no sostiene a ninguna zona", () => {
    // «Buenos Aires» (Palmares) llega con `zonaId: null` — 0 zonas, o mas de una, da igual: es lo
    // mismo que ya opina la carga masiva sobre el.
    expect(zonasQueQuedarianSinDistritos(ARBOL, { nivel: "distrito", id: "d-ba" })).toEqual([]);
  });

  it("un nodo que no está en el árbol no vacía ninguna zona", () => {
    expect(
      zonasQueQuedarianSinDistritos(ARBOL, { nivel: "distrito", id: "no-existe" }),
    ).toEqual([]);
  });

  it("⭑ la disponibilidad se mira EFECTIVA: bajo un cantón retirado, la zona ya está vacía", () => {
    const conOsaRetirado: ProvinciaArbolDTO[] = ARBOL.map((p) =>
      p.id !== "p-pu"
        ? p
        : {
            ...p,
            cantones: p.cantones.map((c) => (c.id === "c-osa" ? { ...c, activo: false } : c)),
          },
    );
    // Puerto Cortés sigue con su flag propio en `true`, pero no esta disponible: retirar la
    // provincia no le quita a GAM Oeste nada que no hubiera perdido ya.
    expect(
      zonasQueQuedarianSinDistritos(conOsaRetirado, { nivel: "provincia", id: "p-pu" }),
    ).toEqual(["Zona Sur"]);
  });
});
