import { describe, it, expect } from "vitest";
import type { ApiMensajeroDTO, ApiOrdenListItemDTO, ApiOrdenDetalleDTO } from "@/lib/types/api-orden";

// ⏳ 2026-09-09 — Feature 404 (T1): la FORMA del campo `mensajero` del canal publico.
//
// R1 dice «EXACTAMENTE dos claves, `id` y `nombre`, y ninguna otra». Aqui se afirma por los dos
// lados que puede fallar:
//   · en TIEMPO DE EJECUCION, sobre las claves reales de un valor del tipo;
//   · en TIEMPO DE COMPILACION, con `@ts-expect-error`, porque una tercera clave no llega a
//     ejecutarse nunca: la deja pasar el compilador o no la deja, y `pnpm typecheck` es quien lo
//     dice. Un `@ts-expect-error` que dejara de ser un error PONE ROJO el typecheck, asi que este
//     aserto tampoco puede quedarse verde por vacio.

const MENSAJERO: ApiMensajeroDTO = {
  id: "018f2c31-0000-4000-8000-0000000000aa",
  nombre: "Carlos Jimenez Mora",
};

describe("404/R1 — `ApiMensajeroDTO` tiene exactamente `id` y `nombre`", () => {
  it("un valor del tipo tiene EXACTAMENTE las claves ['id','nombre'], en ese orden", () => {
    expect(Object.keys(MENSAJERO)).toEqual(["id", "nombre"]);
  });

  it("los dos campos son strings, y el `id` es el UUID en TEXTO (Q1: no un entero)", () => {
    expect(typeof MENSAJERO.id).toBe("string");
    expect(typeof MENSAJERO.nombre).toBe("string");
    // El ejemplo de la peticion del integrador usaba `123`; ese entero no existe en el modelo.
    expect(Number.isInteger(MENSAJERO.id as unknown as number)).toBe(false);
  });

  it("un objeto con una TERCERA clave no compila (R6: ni telefono, ni zona, ni estado interno)", () => {
    const conDeMas: ApiMensajeroDTO = {
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos Jimenez Mora",
      // @ts-expect-error 404/R6 — `telefono` NO es parte del contrato publico del mensajero.
      telefono: "0991234567",
    };
    expect(conDeMas.nombre).toBe("Carlos Jimenez Mora");
  });

  it("un objeto al que le falta una clave tampoco compila", () => {
    // @ts-expect-error 404/R1 — sin `nombre` no es un `ApiMensajeroDTO`.
    const incompleto: ApiMensajeroDTO = { id: "018f2c31-0000-4000-8000-0000000000aa" };
    expect(incompleto.id).toBe("018f2c31-0000-4000-8000-0000000000aa");
  });
});

describe("404/R2+R5 — la convencion de ausencia y la herencia del detalle", () => {
  it("`mensajero` es un campo REQUERIDO del item: omitirlo no compila", () => {
    // @ts-expect-error 404/R2 — la clave viaja SIEMPRE; `null` es un valor, no una omision.
    const sinMensajero: ApiOrdenListItemDTO = {
      numGuia: 10234,
      numRemision: "REM-1",
      estado: "en_reparto",
      destinatario: "Ana",
      telefonoDest: "0991234567",
      producto: "Caja",
      direccion: "Calle 1",
      montoCobrar: 1500,
      createdAt: new Date("2026-09-09T10:00:00.000Z"),
    };
    expect(sinMensajero.numRemision).toBe("REM-1");
  });

  it("`null` SI es un valor valido del campo (R2/R23)", () => {
    const item: ApiOrdenListItemDTO = {
      numGuia: 10234,
      numRemision: "REM-1",
      estado: "en_reparto",
      destinatario: "Ana",
      telefonoDest: "0991234567",
      producto: "Caja",
      direccion: "Calle 1",
      montoCobrar: 1500,
      createdAt: new Date("2026-09-09T10:00:00.000Z"),
      mensajero: null,
    };
    expect("mensajero" in item).toBe(true);
    expect(item.mensajero).toBeNull();
    expect(JSON.stringify(item)).toContain('"mensajero":null');
  });

  it("R5: el detalle HEREDA el campo del item (misma forma, no una copia paralela)", () => {
    const detalle: ApiOrdenDetalleDTO = {
      numGuia: 10234,
      numRemision: "REM-1",
      estado: "en_reparto",
      destinatario: "Ana",
      telefonoDest: "0991234567",
      producto: "Caja",
      direccion: "Calle 1",
      montoCobrar: 1500,
      createdAt: new Date("2026-09-09T10:00:00.000Z"),
      mensajero: MENSAJERO,
      evidencias: [],
      // ⏳ 2026-09-10 (feature 405): campo REQUERIDO del detalle. Este caso mide la HERENCIA del
      // `mensajero` del item, no el historial.
      gestiones: [],
    };
    // La asignacion cruzada solo compila si los dos campos son el MISMO tipo.
    const comoDelItem: ApiOrdenListItemDTO["mensajero"] = detalle.mensajero;
    expect(comoDelItem).toEqual({
      id: "018f2c31-0000-4000-8000-0000000000aa",
      nombre: "Carlos Jimenez Mora",
    });
    expect(Object.keys(detalle.mensajero!)).toEqual(["id", "nombre"]);
  });
});
