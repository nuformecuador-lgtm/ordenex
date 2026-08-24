import fs from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  contadorNuevasAsignadas,
  punteroALaOtraPestana,
  separarPorDia,
  SIN_RESULTADOS_RECOGER,
  VACIO_GRUPO_HOY,
  VACIO_GRUPO_OTRO_DIA,
} from "@/app/(app)/mis-asignaciones/_components/recoger-grupos";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import {
  PESTANA_PARA_OTRO_DIA,
  PESTANA_PARA_RECOGER_HOY,
} from "@/lib/utils/dia-reparto-textos";

// FEATURE 277 (B1) — tests de la pieza PURA que parte «Por recoger» en dos grupos y de los textos
// que esa partición obliga a decir. Sin DOM y sin jsdom: la composición de la pantalla se prueba
// en `tests/components/RecogerModule.test.tsx`.
//
// Cubre R2 (la partición), R3 (el DTO sin el campo), R4 (no se lee ningún reloj), R5 (el orden de
// entrada), R11 (el texto del puntero), R25/R26 (lenguaje claro y sin afirmar un día concreto) y
// R29 (concordancia de singular y plural).
//
// ⚠️ LOS LITERALES VAN ESCRITOS A MANO, nunca recompuestos con la plantilla que los produce: una
// aserción contra su propia fuente está SIEMPRE VERDE y este repo ya lo ha pagado. Estos textos
// SON el contrato con el mensajero.

function makeAsignacion(
  over: Partial<MiAsignacionDTO> & { id: string },
): MiAsignacionDTO {
  return {
    numGuia: 1001,
    numRemision: "REM-001",
    estatusValue: "por_recoger",
    destinatario: "Ana Pérez",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja",
    peso: 1.5,
    montoCobrar: 150,
    latitud: null,
    longitud: null,
    notas: null,
    tiendaNombre: "Tienda X",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    secuenciaRuta: null,
    ...over,
  };
}

describe("separarPorDia — los dos grupos de «Por recoger» (277/R2-R5)", () => {
  it("R2: separa marcadas y no marcadas, sin perder ni duplicar ninguna", () => {
    const ordenes = [
      makeAsignacion({ id: "a", esParaManana: false }),
      makeAsignacion({ id: "b", esParaManana: true }),
      makeAsignacion({ id: "c", esParaManana: true }),
      makeAsignacion({ id: "d", esParaManana: false }),
    ];

    const { hoy, otroDia } = separarPorDia(ordenes);

    expect(hoy.map((o) => o.id)).toEqual(["a", "d"]);
    expect(otroDia.map((o) => o.id)).toEqual(["b", "c"]);
    // Ninguna se pierde y ninguna está en los dos: la suma de los grupos es la entrada entera.
    expect(hoy.length + otroDia.length).toBe(ordenes.length);
    expect([...hoy, ...otroDia].map((o) => o.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("R3: una orden SIN el campo (DTO anterior a la feature) cuenta como de hoy", () => {
    // El caso que decide dónde vive una orden servida por un despliegue anterior: `undefined` NO
    // es «para otro día». Emparejado con la marcada para que una partición que lo mandara TODO a
    // `hoy` no pasara igual.
    const { hoy, otroDia } = separarPorDia([
      makeAsignacion({ id: "vieja" }),
      makeAsignacion({ id: "marcada", esParaManana: true }),
    ]);

    expect(hoy.map((o) => o.id)).toEqual(["vieja"]);
    expect(otroDia.map((o) => o.id)).toEqual(["marcada"]);
  });

  it("R3: `esParaManana: false` cuenta como de hoy", () => {
    const { hoy, otroDia } = separarPorDia([
      makeAsignacion({ id: "hoy", esParaManana: false }),
    ]);

    expect(hoy.map((o) => o.id)).toEqual(["hoy"]);
    expect(otroDia).toEqual([]);
  });

  it("R5: conserva el orden de entrada dentro de cada grupo", () => {
    // Entrada intercalada a propósito: si la partición reordenara (por id, o sacando las marcadas
    // al final), estos dos arrays no saldrían así.
    const ordenes = [
      makeAsignacion({ id: "3", esParaManana: false }),
      makeAsignacion({ id: "9", esParaManana: true }),
      makeAsignacion({ id: "1", esParaManana: false }),
      makeAsignacion({ id: "5", esParaManana: true }),
      makeAsignacion({ id: "2", esParaManana: false }),
    ];

    const { hoy, otroDia } = separarPorDia(ordenes);

    expect(hoy.map((o) => o.id)).toEqual(["3", "1", "2"]);
    expect(otroDia.map((o) => o.id)).toEqual(["9", "5"]);
  });

  it("sin órdenes devuelve los dos grupos vacíos (y no `undefined`)", () => {
    expect(separarPorDia([])).toEqual({ hoy: [], otroDia: [] });
  });

  it("R4: la partición no lee ningún reloj — el módulo no importa la fecha del navegador", () => {
    // Se comprueba SOBRE EL FUENTE y no de palabra: la marca llega ya derivada del servidor
    // (246/R26) y un portátil con la hora corrida no puede mandar una orden al grupo equivocado.
    // Mismo criterio con el que `lib/utils/dia-reparto-textos.ts` declara que no importa ninguna
    // de las dos.
    const fuente = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "app",
        "(app)",
        "mis-asignaciones",
        "_components",
        "recoger-grupos.ts",
      ),
      "utf8",
    );

    // Anti-vacuidad: si el archivo se hubiera movido, `readFileSync` habría reventado; si se
    // vaciara, esto lo caza.
    expect(fuente).toContain("separarPorDia");
    expect(fuente).not.toMatch(/\bDate\b/);
    expect(fuente).not.toMatch(/\bIntl\b/);
    expect(fuente).not.toMatch(/toLocale/);
  });
});

describe("Los textos de la partición (277/R10/R11/R25/R26/R29)", () => {
  it("los vacíos, literales a mano, y distintos entre sí", () => {
    expect(VACIO_GRUPO_HOY).toBe("No hay órdenes por recoger hoy.");
    expect(VACIO_GRUPO_OTRO_DIA).toBe("No hay órdenes para otro día.");
    expect(SIN_RESULTADOS_RECOGER).toBe(
      "Ninguna guía por recoger coincide con la búsqueda.",
    );
    // R10: el vacío por no tener órdenes y el vacío por una búsqueda sin coincidencias no pueden
    // leerse igual, o el mensajero no sabría si le falta trabajo o le sobra filtro.
    expect(
      new Set([VACIO_GRUPO_HOY, VACIO_GRUPO_OTRO_DIA, SIN_RESULTADOS_RECOGER])
        .size,
    ).toBe(3);
  });

  it("R29: el contador concuerda — «1 orden nueva asignada» / «2 órdenes nuevas asignadas»", () => {
    expect(contadorNuevasAsignadas(1)).toBe("1 orden nueva asignada");
    expect(contadorNuevasAsignadas(2)).toBe("2 órdenes nuevas asignadas");
    expect(contadorNuevasAsignadas(7)).toBe("7 órdenes nuevas asignadas");
  });

  it("R11/R29: el puntero sin búsqueda cuenta ÓRDENES, y concuerda", () => {
    expect(punteroALaOtraPestana(1, "Para otro día", false)).toBe(
      "Hay 1 orden en «Para otro día».",
    );
    expect(punteroALaOtraPestana(2, "Para otro día", false)).toBe(
      "Hay 2 órdenes en «Para otro día».",
    );
  });

  it("R11/R29: el puntero con búsqueda cuenta COINCIDENCIAS, y concuerda", () => {
    // La palabra cambia a propósito: con filtro, «2 órdenes» sería un número que no corresponde a
    // nada que el mensajero pueda ver.
    expect(punteroALaOtraPestana(1, "Para recoger hoy", true)).toBe(
      "Hay 1 coincidencia en «Para recoger hoy».",
    );
    expect(punteroALaOtraPestana(2, "Para recoger hoy", true)).toBe(
      "Hay 2 coincidencias en «Para recoger hoy».",
    );
  });

  it("sin nada al otro lado no hay puntero (un «Hay 0» sería ruido)", () => {
    expect(punteroALaOtraPestana(0, "Para otro día", false)).toBeNull();
    expect(punteroALaOtraPestana(0, "Para recoger hoy", true)).toBeNull();
  });

  it("R25/R26: ningún texto visible dice «reserva», «mañana», el nombre de la columna ni una fecha de máquina", () => {
    const visibles = [
      PESTANA_PARA_RECOGER_HOY,
      PESTANA_PARA_OTRO_DIA,
      VACIO_GRUPO_HOY,
      VACIO_GRUPO_OTRO_DIA,
      SIN_RESULTADOS_RECOGER,
      contadorNuevasAsignadas(1),
      contadorNuevasAsignadas(2),
      punteroALaOtraPestana(1, PESTANA_PARA_OTRO_DIA, false) ?? "",
      punteroALaOtraPestana(2, PESTANA_PARA_RECOGER_HOY, true) ?? "",
    ];

    // Anti-vacuidad: la lista tiene lo que dice tener y ninguna entrada quedó en blanco.
    expect(visibles).toHaveLength(9);
    for (const texto of visibles) expect(texto.length).toBeGreaterThan(0);

    for (const texto of visibles) {
      // «reserva» y «corte» son jerga interna que este repo retiró del texto visible a propósito.
      expect(texto).not.toMatch(/reserv/i);
      expect(texto).not.toMatch(/corte/i);
      // R26: nada afirma «mañana». El día de reparto admite +2 (guía 17496963, 2026-08-21) y un
      // grupo mixto no tiene otro nombre honesto que «otro día».
      expect(texto).not.toMatch(/mañana/i);
      // Ni nombres de columna ni fechas en formato de máquina.
      expect(texto).not.toMatch(/fecha_reparto/i);
      expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("R26: los dos nombres de pestaña, literales a mano y paralelos", () => {
    expect(PESTANA_PARA_RECOGER_HOY).toBe("Para recoger hoy");
    expect(PESTANA_PARA_OTRO_DIA).toBe("Para otro día");
  });
});
