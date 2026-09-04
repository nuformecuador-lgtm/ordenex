import { describe, it, expect } from "vitest";
import type { EstadoApiKey } from "@prisma/client";

import {
  MOTIVOS_NO_ELIMINABLE,
  motivoNoEliminable,
  type DependenciasCuentaDedicada,
  type MotivoNoEliminable,
} from "@/lib/types/api-key";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / B1 (R13) — LA PRECEDENCIA, ENTERA Y EN UNA TABLA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE SE MIDE AQUI Y POR QUE IMPORTA. `motivoNoEliminable` es la FUENTE UNICA del motivo: la usan
// el camino del LISTADO (para apagar el boton con un texto) y el del BORRADO (para responder
// `bloqueada`). Si divergieran, el usuario leeria una cosa en el boton y otra en el aviso.
//
// LA TABLA ES EXHAUSTIVA A PROPOSITO: 2 estados x 8 combinaciones de los tres booleanos = 16 casos,
// escritos UNO A UNO con su respuesta esperada. No se derivan de la funcion —comparar una lista
// contra la funcion que la produce esta siempre verde, y este repo ya se comio esa mentira—: son la
// tabla del design §4.3 tecleada aparte.
//
// ⚠️ Y LA ASIMETRIA QUE MAS CUESTA CREERSE, escrita en voz alta: los motivos de DATOS van ANTES que
// el de ESTADO, aunque desactivar sea lo primero en el tiempo. Los de datos son TERMINALES (no hay
// nada que el maestro pueda hacer desde esa pantalla) y el de estado es ACCIONABLE (el boton que lo
// resuelve esta al lado). Al reves, una key `activa` CON ordenes diria «desactivala», y despues de
// desactivarla el boton seguiria apagado por las ordenes: dos pasos y una promesa incumplida.

const ESTADOS: EstadoApiKey[] = ["activa", "inactiva"];

function dep(ordenes: boolean, dinero: boolean, tarifas: boolean): DependenciasCuentaDedicada {
  return { ordenes, dinero, tarifas };
}

/** Las 8 combinaciones de los tres booleanos, con el motivo que dicta la precedencia por DATOS. */
const POR_DATOS: [DependenciasCuentaDedicada, MotivoNoEliminable | null][] = [
  [dep(false, false, false), null],
  [dep(false, false, true), "tarifas"],
  [dep(false, true, false), "dinero"],
  [dep(false, true, true), "dinero"], // dinero > tarifas
  [dep(true, false, false), "ordenes"],
  [dep(true, false, true), "ordenes"], // ordenes > tarifas
  [dep(true, true, false), "ordenes"], // ordenes > dinero
  [dep(true, true, true), "ordenes"], // ordenes gana a todo
];

describe("373/R13 — el vocabulario de motivos es cerrado y tiene los CINCO", () => {
  it("son exactamente estos cinco, en este orden, sin repetidos", () => {
    expect([...MOTIVOS_NO_ELIMINABLE]).toEqual([
      "ordenes",
      "dinero",
      "tarifas",
      "activa",
      "otros_datos",
    ]);
    expect(new Set(MOTIVOS_NO_ELIMINABLE).size).toBe(5);
  });
});

describe("373/R13 — las 16 combinaciones, una a una", () => {
  it.each(
    ESTADOS.flatMap((estado) =>
      POR_DATOS.map(([dependencias, porDatos]) => {
        // La regla completa: si hay motivo por datos, gana; si no, el estado decide.
        const esperado = porDatos ?? (estado === "activa" ? "activa" : null);
        const firma = `o=${dependencias.ordenes} d=${dependencias.dinero} t=${dependencias.tarifas}`;
        return [`${estado} · ${firma}`, estado, dependencias, esperado] as const;
      }),
    ),
  )("%s -> %s", (_nombre, estado, dependencias, esperado) => {
    expect(motivoNoEliminable(estado, dependencias)).toBe(esperado);
  });

  it("las 16 combinaciones se cubrieron de verdad (anti-vacuidad de la tabla)", () => {
    expect(ESTADOS.length * POR_DATOS.length).toBe(16);
  });
});

describe("373/R13 — la precedencia, dicha caso a caso", () => {
  it("⭑ ordenes + dinero + tarifas + activa a la vez -> `ordenes`", () => {
    // El caso que R13 nombra: con TODO concurriendo, el motivo es siempre el mismo.
    expect(motivoNoEliminable("activa", dep(true, true, true))).toBe("ordenes");
  });

  it("dinero + tarifas + activa -> `dinero`", () => {
    expect(motivoNoEliminable("activa", dep(false, true, true))).toBe("dinero");
  });

  it("tarifas + activa -> `tarifas`, NO `activa`", () => {
    // La mutacion que este caso caza: poner la comprobacion de `estado` la PRIMERA. Con ella, esta
    // key diria «desactivala» y, tras desactivarla, el boton seguiria apagado por las tarifas.
    expect(motivoNoEliminable("activa", dep(false, false, true))).toBe("tarifas");
  });

  it("⭑ R11: `activa` sin ningun dato -> `activa` (el caso literal de «API Nuform»)", () => {
    // 0 ordenes, 0 dinero, 0 tarifas y AUN ASI no borrable. Sin R11, el guard por datos daria por
    // eliminable una key recien creada y EN USO.
    expect(motivoNoEliminable("activa", dep(false, false, false))).toBe("activa");
  });

  it("⭑ la MISMA key, desactivada y sin datos -> `null` (eliminable)", () => {
    expect(motivoNoEliminable("inactiva", dep(false, false, false))).toBeNull();
  });

  it("`inactiva` NO borra los motivos de datos: siguen bloqueando", () => {
    expect(motivoNoEliminable("inactiva", dep(true, false, false))).toBe("ordenes");
    expect(motivoNoEliminable("inactiva", dep(false, true, false))).toBe("dinero");
    expect(motivoNoEliminable("inactiva", dep(false, false, true))).toBe("tarifas");
  });
});

describe("373 — `otros_datos` NO lo produce nunca esta funcion", () => {
  it("ninguna de las 16 combinaciones devuelve `otros_datos`", () => {
    // Lo emite SOLO la red de las FK `Restrict` (una P2003 inesperada), y por eso el listado no lo
    // muestra jamas: si apareciera aqui, el boton podria quedar apagado con «Tiene datos
    // asociados», que es justo el mensaje que no explica nada.
    const producidos = ESTADOS.flatMap((estado) =>
      POR_DATOS.map(([dependencias]) => motivoNoEliminable(estado, dependencias)),
    );
    expect(producidos).toHaveLength(16);
    expect(producidos).not.toContain("otros_datos");
  });
});

describe("373 — el modulo es PURO", () => {
  it("la funcion no toca la base ni depende de nada asincrono", () => {
    // Es una funcion sincrona sobre dos valores: si algun dia devolviera una promesa, el listado
    // tendria que esperarla POR FILA y R38 se caeria sin que ningun otro test se entere.
    const salida = motivoNoEliminable("inactiva", dep(false, false, false));
    expect(salida).not.toBeInstanceOf(Promise);
    expect(motivoNoEliminable.length).toBe(2);
  });
});
