// FICHA 374 (H1) — EL FILTRO DEL ARBOL GEOGRAFICO: TEXTO (R39) Y ESTADO (R58/R59).
//
// Modulo PURO, sin React: por eso este archivo no monta nada y puede recorrer el arbol entero caso
// a caso. Lo que la pantalla añade encima —que mover el conmutador no dispare ninguna llamada al
// servidor— lo mide `tests/unit/components/geografia-admin.ui.test.tsx`.
//
// EL ARBOL DE PRUEBA TIENE CUATRO PROVINCIAS y las cuatro combinaciones que importan: una rama
// entera sana, un canton retirado con un distrito ACTIVO POR SU CUENTA debajo (el estado que R10
// declara legitimo), un distrito retirado por su cuenta bajo un canton sano, y una provincia
// retirada. Con una sola rama, «retirados deja solo los no disponibles» pasaria en verde con una
// funcion que no filtra nada.
import { describe, it, expect } from "vitest";

import {
  filtrarArbolGeografico,
  type FiltroEstadoGeografico,
} from "@/app/(app)/configuracion/_shared/filtrar-arbol-geografico";
import type { ProvinciaArbolDTO } from "@/lib/types/geografia-nodo";

function distrito(
  id: string,
  nombre: string,
  activo = true,
): ProvinciaArbolDTO["cantones"][number]["distritos"][number] {
  return { id, nombre, zonaId: "z1", zonaNombre: "Zona 1", zonaEspecial: false, activo };
}

const ARBOL: ProvinciaArbolDTO[] = [
  {
    id: "p-sj",
    nombre: "San José",
    activo: true,
    cantones: [
      {
        id: "c-pz",
        nombre: "Pérez Zeledón",
        activo: true,
        distritos: [
          distrito("d-sig", "San Isidro de El General"),
          // Retirado POR SU CUENTA bajo un canton sano.
          distrito("d-rivas", "Rivas", false),
        ],
      },
    ],
  },
  {
    id: "p-pu",
    nombre: "Puntarenas",
    activo: true,
    cantones: [
      {
        id: "c-ba",
        nombre: "Buenos Aires",
        activo: true,
        distritos: [distrito("d-cab", "Cabagra")],
      },
      {
        // Canton RETIRADO con un distrito cuyo flag propio sigue encendido (R10).
        id: "c-osa",
        nombre: "Osa",
        activo: false,
        distritos: [distrito("d-cortes", "Puerto Cortés")],
      },
    ],
  },
  {
    // Provincia RETIRADA: todo lo que cuelga de ella esta retirado por herencia.
    id: "p-al",
    nombre: "Alajuela",
    activo: false,
    cantones: [
      {
        id: "c-palmares",
        nombre: "Palmares",
        activo: true,
        distritos: [distrito("d-ba", "Buenos Aires")],
      },
    ],
  },
  {
    id: "p-li",
    nombre: "Limón",
    activo: true,
    cantones: [
      {
        id: "c-guacimo",
        nombre: "Guácimo",
        activo: true,
        distritos: [distrito("d-mercedes", "Mercedes")],
      },
    ],
  },
];

/** Todos los nombres que sobreviven al filtro, en los tres niveles, aplanados. */
function nombres(
  texto: string,
  estado: FiltroEstadoGeografico = "todos",
): string[] {
  const salida: string[] = [];
  for (const provincia of filtrarArbolGeografico(ARBOL, { texto, estado })) {
    salida.push(provincia.nombre);
    for (const canton of provincia.cantones) {
      salida.push(canton.nombre);
      for (const dist of canton.distritos) salida.push(dist.nombre);
    }
  }
  return salida;
}

/** Los IDs de todo lo que sobrevive, en orden de recorrido. */
function ids(texto: string, estado: FiltroEstadoGeografico = "todos"): string[] {
  const salida: string[] = [];
  for (const provincia of filtrarArbolGeografico(ARBOL, { texto, estado })) {
    salida.push(provincia.id);
    for (const canton of provincia.cantones) {
      salida.push(canton.id);
      for (const dist of canton.distritos) salida.push(dist.id);
    }
  }
  return salida;
}

/** Solo los distritos que sobreviven. */
function distritos(texto: string, estado: FiltroEstadoGeografico = "todos"): string[] {
  return filtrarArbolGeografico(ARBOL, { texto, estado }).flatMap((p) =>
    p.cantones.flatMap((c) => c.distritos.map((d) => d.nombre)),
  );
}

describe("374/R39 — el buscador encuentra sin distinguir mayúsculas, acentos ni espacios", () => {
  it("«perez zeledon» encuentra «Pérez Zeledón» (sin acentos y en minúsculas)", () => {
    expect(nombres("perez zeledon")).toEqual([
      "San José",
      "Pérez Zeledón",
      "San Isidro de El General",
      "Rivas",
    ]);
  });

  it("⭑ «san  jose» con DOS espacios encuentra «San José»", () => {
    // Es el arreglo concreto de la ficha: el `norm()` que vivia en `GeografiaSelector` NO colapsaba
    // los espacios internos, asi que este caso devolvia CERO resultados.
    expect(nombres("san  jose")).toEqual([
      "San José",
      "Pérez Zeledón",
      "San Isidro de El General",
      "Rivas",
    ]);
  });

  it("  Un texto que casa con la PROVINCIA arrastra su rama entera", () => {
    expect(nombres("puntarenas")).toEqual([
      "Puntarenas",
      "Buenos Aires",
      "Cabagra",
      "Osa",
      "Puerto Cortés",
    ]);
  });

  it("un texto que casa solo con un DISTRITO conserva a sus padres como camino", () => {
    expect(nombres("cabagra")).toEqual(["Puntarenas", "Buenos Aires", "Cabagra"]);
  });

  it("un texto que no casa con nada devuelve la lista vacía", () => {
    expect(filtrarArbolGeografico(ARBOL, { texto: "zzz", estado: "todos" })).toEqual([]);
  });

  it("sin texto y sin filtro de estado devuelve el árbol completo", () => {
    expect(filtrarArbolGeografico(ARBOL, { texto: "", estado: "todos" })).toEqual(ARBOL);
  });
});

describe("374/R58 — el filtro de estado, sobre la disponibilidad EFECTIVA", () => {
  it("«activos» deja solo los disponibles: fuera Rivas, Osa, Puerto Cortés y toda Alajuela", () => {
    expect(nombres("", "activos")).toEqual([
      "San José",
      "Pérez Zeledón",
      "San Isidro de El General",
      "Puntarenas",
      "Buenos Aires",
      "Cabagra",
      "Limón",
      "Guácimo",
      "Mercedes",
    ]);
  });

  it("⭑ «retirados» incluye al distrito caído POR SU CANTÓN, no solo a los de flag propio", () => {
    // «Puerto Cortés» tiene `activo: true`: si el filtro mirase el flag PROPIO en vez de la
    // disponibilidad efectiva, este distrito quedaria escondido bajo su canton retirado —
    // exactamente en el unico filtro desde el que alguien iria a buscarlo.
    expect(distritos("", "retirados")).toEqual([
      "Rivas",
      "Puerto Cortés",
      "Buenos Aires",
    ]);
  });

  it("«retirados» conserva a los padres SANOS como camino hacia un hijo retirado", () => {
    // San José y Pérez Zeledón están los dos disponibles y aun así sobreviven: sin esta regla,
    // «Rivas» no habria forma de encontrarlo.
    expect(nombres("", "retirados")).toEqual([
      "San José",
      "Pérez Zeledón",
      "Rivas",
      "Puntarenas",
      "Osa",
      "Puerto Cortés",
      "Alajuela",
      "Palmares",
      "Buenos Aires",
    ]);
  });

  it("⭑ cada nodo del árbol cae en «activos» o en «retirados», y en uno solo", () => {
    // Se cuenta por ID y no por nombre: «Buenos Aires» existe DOS veces en este arbol (canton de
    // Puntarenas y distrito de Palmares) y contar nombres los fundiria en uno.
    const activos = ids("", "activos");
    const retirados = ids("", "retirados");
    const todos = ids("", "todos");

    expect(todos.length).toBe(15); // 4 provincias + 5 cantones + 6 distritos
    // Un padre sano sobrevive como CAMINO hacia un hijo retirado, asi que aparece en los dos
    // listados. Lo que no puede repetirse es su clasificacion: se mide sobre los nodos que casan
    // POR SI MISMOS, que es lo que el filtro decide.
    const casanPorSiMismos = (lista: string[], contrario: string[]) =>
      lista.filter((id) => !contrario.includes(id));
    const soloActivos = casanPorSiMismos(activos, retirados);
    const soloRetirados = casanPorSiMismos(retirados, activos);
    expect(soloActivos).toEqual([
      "d-sig",
      "c-ba",
      "d-cab",
      "p-li",
      "c-guacimo",
      "d-mercedes",
    ]);
    expect(soloRetirados).toEqual([
      "d-rivas",
      "c-osa",
      "d-cortes",
      "p-al",
      "c-palmares",
      "d-ba",
    ]);
    // Los tres que quedan son los caminos compartidos: San José, Pérez Zeledón y Puntarenas.
    expect(activos.filter((id) => retirados.includes(id))).toEqual([
      "p-sj",
      "c-pz",
      "p-pu",
    ]);
  });
});

describe("374/R59 — texto y estado se componen con AND", () => {
  it("«cabagra» + «retirados» no devuelve nada mientras Cabagra esté disponible", () => {
    expect(filtrarArbolGeografico(ARBOL, { texto: "cabagra", estado: "retirados" })).toEqual([]);
  });

  it("⭑ el MISMO texto con Cabagra retirada sí la devuelve", () => {
    const conCabagraRetirada: ProvinciaArbolDTO[] = ARBOL.map((p) =>
      p.id !== "p-pu"
        ? p
        : {
            ...p,
            cantones: p.cantones.map((c) =>
              c.id !== "c-ba"
                ? c
                : { ...c, distritos: c.distritos.map((d) => ({ ...d, activo: false })) },
            ),
          },
    );
    const salida = filtrarArbolGeografico(conCabagraRetirada, {
      texto: "cabagra",
      estado: "retirados",
    });
    expect(salida.map((p) => p.nombre)).toEqual(["Puntarenas"]);
    expect(salida[0].cantones.flatMap((c) => c.distritos.map((d) => d.nombre))).toEqual([
      "Cabagra",
    ]);
  });

  it("«buenos aires» + «activos» deja el de Puntarenas y descarta el de Alajuela (retirada)", () => {
    // El mismo nombre en dos ramas: una disponible y otra caida por su provincia. Es el caso que
    // demuestra que el AND se evalua POR NODO y no por rama.
    expect(nombres("buenos aires", "activos")).toEqual([
      "Puntarenas",
      "Buenos Aires",
      "Cabagra",
    ]);
  });

  it("«buenos aires» + «retirados» deja el de Alajuela y descarta el de Puntarenas", () => {
    expect(nombres("buenos aires", "retirados")).toEqual([
      "Alajuela",
      "Palmares",
      "Buenos Aires",
    ]);
  });
});
