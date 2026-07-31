import { describe, it, expect } from "vitest";
import {
  ETIQUETA_MENSAJERO,
  politicaIdentidadMensajero,
  seudonimizarMensajeros,
} from "@/lib/analytics/identidad";
import { MENSAJERO_SIN_ASIGNAR, ROLES_ANALITICA } from "@/lib/analytics/types";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";

// Feature 122 / T3.5-T3.6 — D5: el adminTienda ve la DISTRIBUCION, no a la PERSONA.
//
// R38 (positivo): politica seudonima para el `adminTienda`, etiquetas ordinales
// deterministas; `real` para los otros cuatro roles.
// R39 (negativo, y es el que importa): el payload que cruza al cliente no contiene el uuid
// real, ni nombre, ni telefono, ni correo, ni el mapa inverso. Se prueba sobre la CADENA
// SERIALIZADA COMPLETA y no sobre los campos que la UI usa, porque en el App Router lo que
// un Server Component no pinta igualmente viaja.

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

interface FilaFixture {
  readonly mensajeroId: string;
  readonly entregas: number;
  readonly nombre?: string;
  readonly telefono?: string;
  readonly correo?: string;
}

const FILAS: readonly FilaFixture[] = [
  { mensajeroId: UUID_A, entregas: 12 },
  { mensajeroId: UUID_B, entregas: 7 },
  { mensajeroId: UUID_A, entregas: 3 },
  { mensajeroId: UUID_C, entregas: 1 },
];

describe("R38 · politica de identidad por rol", () => {
  it("adminTienda => seudonima; los otros cuatro roles => real", () => {
    expect(politicaIdentidadMensajero("adminTienda")).toBe("seudonima");
    for (const rol of ROLES_ANALITICA.filter((r) => r !== "adminTienda")) {
      expect(politicaIdentidadMensajero(rol), rol).toBe("real");
    }
  });

  it("la consulta preparada expone la politica resuelta del actor", () => {
    const filtro = { rango: "dia" as const };
    const tienda = prepararConsultaAnalitica(
      filtro,
      { usuarioId: "u-tienda", rol: "adminTienda" },
      "entregas",
    );
    const maestro = prepararConsultaAnalitica(
      filtro,
      { usuarioId: "u-maestro", rol: "maestro" },
      "entregas",
    );
    expect(tienda.status).toBe("ok");
    expect(maestro.status).toBe("ok");
    if (tienda.status !== "ok" || maestro.status !== "ok") return;
    expect(tienda.consulta.politicaIdentidad).toBe("seudonima");
    expect(maestro.consulta.politicaIdentidad).toBe("real");
  });
});

describe("R38 · etiquetas ordinales estables dentro de la respuesta", () => {
  it("asigna Mensajero 1..N por orden de primera aparicion y repite la etiqueta del mismo id", () => {
    const salida = seudonimizarMensajeros(FILAS, "seudonima");
    expect(salida.map((f) => f.mensajero)).toEqual([
      `${ETIQUETA_MENSAJERO} 1`,
      `${ETIQUETA_MENSAJERO} 2`,
      `${ETIQUETA_MENSAJERO} 1`,
      `${ETIQUETA_MENSAJERO} 3`,
    ]);
    expect(salida.map((f) => f.entregas)).toEqual([12, 7, 3, 1]);
  });

  it("dos invocaciones con la misma entrada dan exactamente las mismas etiquetas (R32)", () => {
    expect(seudonimizarMensajeros(FILAS, "seudonima")).toEqual(
      seudonimizarMensajeros(FILAS, "seudonima"),
    );
  });

  it("la etiqueta NO se deriva del uuid: cambiar el uuid sin cambiar la posicion no la cambia", () => {
    const otras: readonly FilaFixture[] = [
      { mensajeroId: "99999999-9999-4999-8999-999999999999", entregas: 12 },
      { mensajeroId: UUID_B, entregas: 7 },
      { mensajeroId: "99999999-9999-4999-8999-999999999999", entregas: 3 },
      { mensajeroId: UUID_C, entregas: 1 },
    ];
    expect(seudonimizarMensajeros(otras, "seudonima").map((f) => f.mensajero)).toEqual(
      seudonimizarMensajeros(FILAS, "seudonima").map((f) => f.mensajero),
    );
  });

  it("con politica real devuelve el id tal cual: la seudonimizacion no se aplica a todos", () => {
    expect(seudonimizarMensajeros(FILAS, "real").map((f) => f.mensajero)).toEqual([
      UUID_A,
      UUID_B,
      UUID_A,
      UUID_C,
    ]);
  });

  it("el cubo sin_asignar se conserva: no es una persona a la que seudonimizar", () => {
    const conCubo: readonly FilaFixture[] = [
      { mensajeroId: MENSAJERO_SIN_ASIGNAR, entregas: 5 },
      { mensajeroId: UUID_A, entregas: 2 },
    ];
    expect(seudonimizarMensajeros(conCubo, "seudonima").map((f) => f.mensajero)).toEqual([
      MENSAJERO_SIN_ASIGNAR,
      `${ETIQUETA_MENSAJERO} 1`,
    ]);
  });
});

describe("R39 · el payload seudonimizado no lleva el identificador real, ni el mapa inverso", () => {
  it("JSON.stringify del resultado completo no contiene ningun uuid de la fixture", () => {
    const conPii: readonly FilaFixture[] = FILAS.map((f) => ({
      ...f,
      nombre: "Juan Perez",
      telefono: "88887777",
      correo: "juan@example.com",
    }));

    const salida = seudonimizarMensajeros(
      conPii.map(({ mensajeroId, entregas }) => ({ mensajeroId, entregas })),
      "seudonima",
    );
    const serializado = JSON.stringify(salida);

    for (const uuid of [UUID_A, UUID_B, UUID_C]) {
      expect(serializado, `el uuid ${uuid} cruzo al cliente`).not.toContain(uuid);
    }
    expect(serializado).not.toContain("Juan Perez");
    expect(serializado).not.toContain("88887777");
    expect(serializado).not.toContain("juan@example.com");
    // Ni siquiera un fragmento del uuid (un hash truncado seria correlacionable).
    expect(serializado).not.toContain(UUID_A.slice(0, 8));
  });

  it("la funcion no devuelve la correspondencia seudonimo -> id real: no hay forma de pedirla", () => {
    const salida = seudonimizarMensajeros(FILAS, "seudonima");
    expect(Array.isArray(salida)).toBe(true);
    for (const fila of salida) {
      expect(Object.keys(fila).sort()).toEqual(["entregas", "mensajero"]);
      expect(Object.keys(fila)).not.toContain("mensajeroId");
    }
    // El resultado es una lista plana: no hay `mapa`, `correspondencia` ni `original`.
    expect(JSON.stringify(salida)).not.toMatch(/mapa|correspondencia|original|mensajeroId/);
  });

  it("el id real desaparece del TIPO, no solo del valor", () => {
    const salida = seudonimizarMensajeros(FILAS, "seudonima");
    // @ts-expect-error — `mensajeroId` ya no existe en la fila de salida (Omit).
    void salida[0].mensajeroId;
  });
});
