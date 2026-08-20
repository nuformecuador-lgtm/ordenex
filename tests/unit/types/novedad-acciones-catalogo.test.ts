import { describe, it, expect } from "vitest";

import {
  ACCIONES_POR_GRUPO,
  ACCIONES_SIN_GRUPO,
  type AccionNovedad,
} from "@/app/(app)/novedades/_components/novedad-acciones-catalogo";
import {
  ESTATUS_POR_GRUPO,
  GRUPOS_NOVEDAD,
  type GrupoNovedad,
} from "@/lib/types/novedad-grupo";

// Feature 236 (T5.1, design §6.2 — R6/R18/R20) — EL PUNTO ÚNICO de los botones de `/novedades`.
//
// Lo que este archivo vigila es una propiedad de ACOPLE, no de contenido: que **lo que el servidor
// lista y lo que la pantalla ofrece describan LOS MISMOS grupos** (R6). Hasta el 2026-08-19 no
// había ningún sitio donde eso se pudiera afirmar, porque la pantalla decidía con condiciones
// sueltas repartidas por un componente y el servidor con un `OR` en el repositorio: dos verdades
// sin nada que las atara.
//
// ⚠️ EL JUEGO DE CADA GRUPO SE ESCRIBE AQUÍ A MANO, y es deliberado. Derivarlo de
// `ACCIONES_POR_GRUPO` sería compararla contra su propia fuente: estaría verde con cualquier
// contenido, incluido el día que alguien añada «Reprogramar» a la ayuda —que es justo la mutación
// que este caso tiene que matar—. La tabla del test y la de producción son dos copias a propósito;
// que discrepen es la señal.
const JUEGO_ESPERADO: Record<GrupoNovedad, AccionNovedad[]> = {
  // R22: llamar, WhatsApp, devolver la orden a la ruta, abrir la conversación y registrar un
  // intento de contacto. R23: NADA que presuponga una devolución.
  ayuda: ["contacto", "habilitar", "conversacion", "intentoContacto"],
  // `habilitar` está aquí por TRADUCCIÓN LITERAL del estado de hoy (el punto 12 del pedido humano,
  // al revés de lo que pedía). No es un descuido de esta ficha: su dueño es la 240, y este test es
  // el sitio donde esa deuda queda escrita y medida. Cuando la 240 la corrija, este literal cambia
  // con ella — y ese es el punto de tenerlo aquí.
  devolucion: ["contacto", "reprogramar", "habilitar", "rechazar"],
};

/** Toda acción que la unión declara. Escrita a mano por el mismo motivo que el juego de arriba. */
const ACCIONES_DECLARADAS: AccionNovedad[] = [
  "contacto",
  "reprogramar",
  "habilitar",
  "rechazar",
  "intentoContacto",
  "conversacion",
];

describe("236/R18 — la tabla es el censo EXACTO de lo que ofrece cada grupo", () => {
  it.each(Object.keys(JUEGO_ESPERADO) as GrupoNovedad[])(
    "grupo %s: ni una acción de más ni una de menos, y en su orden",
    (grupo) => {
      // El ORDEN también se fija: es el de pintado, y es lo que pone «+1 intento de contacto» al
      // final de la fila (no resuelve la orden, sólo deja constancia) y el contacto al principio.
      expect([...ACCIONES_POR_GRUPO[grupo]]).toEqual(JUEGO_ESPERADO[grupo]);
    },
  );

  it("R23: el grupo de ayuda NO ofrece nada que presuponga una devolución", () => {
    // Dicho como negativo aparte del censo, para que siga siendo legible cuando el censo crezca:
    // `ReprogramacionTiendaService` rechaza con `conflict` toda orden fuera de `devuelta`, así que
    // el botón sólo conseguiría que la tienda descubriera el límite pulsándolo. Gestionar DESDE
    // ayuda es la ficha 237.
    expect(ACCIONES_POR_GRUPO.ayuda).not.toContain("reprogramar");
    expect(ACCIONES_POR_GRUPO.ayuda).not.toContain("rechazar");
    // CONTROL POSITIVO de las dos ausencias: el grupo de devolución SÍ las tiene. Sin él, las dos
    // negativas pasarían igual con la tabla vacía.
    expect(ACCIONES_POR_GRUPO.devolucion).toContain("reprogramar");
    expect(ACCIONES_POR_GRUPO.devolucion).toContain("rechazar");
  });

  it("R27: la conversación existe, y sólo en el grupo de ayuda", () => {
    // Es lo NUEVO de esta ficha y el motivo por el que existe: sin ella la tienda ve que le piden
    // ayuda y no puede leer el motivo, que el mensajero publica como nota del hilo.
    expect(ACCIONES_POR_GRUPO.ayuda).toContain("conversacion");
    // No es un botón «Notas» de vuelta en las cards de devolución (eso lo vigila además la 240).
    expect(ACCIONES_POR_GRUPO.devolucion).not.toContain("conversacion");
  });

  it("`contacto` está en la tabla de los DOS grupos, y no fuera de ella", () => {
    // Si se quedara fuera «porque siempre está», la tabla dejaría de ser el censo de lo que la fila
    // ofrece y volvería a haber una decisión fuera de ella. La tabla es TODO el panel o no sirve.
    for (const grupo of GRUPOS_NOVEDAD) {
      expect(ACCIONES_POR_GRUPO[grupo], grupo).toContain("contacto");
    }
  });
});

describe("236/R6 — la tabla se indexa por el MISMO grupo que usa el servidor", () => {
  it("cubre TODOS los grupos declarados, ni uno más ni uno menos", () => {
    // La mitad ejecutable de R6: si el servidor ganara un grupo en `ESTATUS_POR_GRUPO`, el
    // `satisfies` de la tabla rompería el TYPECHECK; y si alguien lo silenciara, esto cae. Lo que
    // no puede pasar es que el servidor liste una población para la que la pantalla no sepa qué
    // botones ofrecer.
    expect(Object.keys(ACCIONES_POR_GRUPO).sort()).toEqual(
      Object.keys(ESTATUS_POR_GRUPO).sort(),
    );
    expect(Object.keys(ACCIONES_POR_GRUPO).sort()).toEqual([...GRUPOS_NOVEDAD].sort());
  });

  it("y el juego escrito en este test cubre exactamente esos mismos grupos", () => {
    // Anti-vacuidad del `it.each` de arriba: si `JUEGO_ESPERADO` perdiera un grupo, aquel caso
    // dejaría de ejercerlo y nadie lo notaría — un `it.each` sobre una lista vacía pasa.
    expect(Object.keys(JUEGO_ESPERADO).sort()).toEqual([...GRUPOS_NOVEDAD].sort());
  });
});

describe("236/R20 — ninguna acción declarada se queda sin grupo, y ninguna se inventa", () => {
  it("toda acción de la unión aparece en al menos un grupo", () => {
    const enAlgunGrupo = new Set<string>(
      GRUPOS_NOVEDAD.flatMap((grupo) => [...ACCIONES_POR_GRUPO[grupo]]),
    );
    const huerfanas = ACCIONES_DECLARADAS.filter((a) => !enAlgunGrupo.has(a));
    expect(
      huerfanas,
      "una acción declarada y sin grupo es código que nadie puede alcanzar desde la pantalla: o " +
        "entra en la tabla o sale de la unión",
    ).toEqual([]);
  });

  it("y ninguna acción de la tabla está fuera de la unión declarada", () => {
    const declaradas = new Set<string>(ACCIONES_DECLARADAS);
    for (const grupo of GRUPOS_NOVEDAD) {
      for (const accion of ACCIONES_POR_GRUPO[grupo]) {
        expect(declaradas, `\`${accion}\` (grupo ${grupo})`).toContain(accion);
      }
    }
  });
});

describe("236/R21 — fallo cerrado: un estado sin grupo no ofrece nada que resuelva la orden", () => {
  it("sólo queda el contacto", () => {
    expect([...ACCIONES_SIN_GRUPO]).toEqual(["contacto"]);
  });

  it("ninguna acción de RESOLUCIÓN sobrevive ahí", () => {
    // Dicho una a una y no como igualdad, para que siga siendo cierto si mañana entra una acción
    // nueva que tampoco resuelva nada (un «Ver historial», por ejemplo).
    for (const accion of [
      "reprogramar",
      "habilitar",
      "rechazar",
      "conversacion",
      "intentoContacto",
    ] as const) {
      expect(ACCIONES_SIN_GRUPO, accion).not.toContain(accion);
    }
    // CONTROL POSITIVO: esas cinco SÍ existen en algún grupo, así que las cinco ausencias de
    // arriba dicen algo. Sin esto pasarían igual con la unión vacía.
    const enAlgunGrupo = new Set<string>(
      GRUPOS_NOVEDAD.flatMap((grupo) => [...ACCIONES_POR_GRUPO[grupo]]),
    );
    for (const accion of ["reprogramar", "habilitar", "rechazar", "conversacion", "intentoContacto"]) {
      expect([...enAlgunGrupo], accion).toContain(accion);
    }
  });
});
