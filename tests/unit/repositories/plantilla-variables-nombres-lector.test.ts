import { describe, it, expect } from "vitest";
import { leerVariablesNombres } from "@/lib/repositories/PlantillaMensajeRepository";

// Feature 282 (T13) — el lector defensivo del `JsonValue` de Prisma.
//
// `variables_nombres` es una columna JSONB: Prisma la tipa como `JsonValue`, asi que en tiempo
// de ejecucion puede llegar cualquier JSON. Es PRESENTACION (nadie la envia a Meta), asi que la
// politica es degradar a `{}` y dejar que la UI derive el nombre del catalogo (R21), NUNCA
// lanzar: una sola fila rara no puede tumbar el listado de plantillas del maestro.

describe("leerVariablesNombres — degrada a {} todo lo que no sea un mapa clave -> nombre", () => {
  it("null (columna sin valor / JSON null) cae a {}", () => {
    expect(leerVariablesNombres(null)).toEqual({});
  });

  it("una cadena suelta cae a {}", () => {
    expect(leerVariablesNombres("texto")).toEqual({});
  });

  it("un array cae a {} (un array TAMBIEN es typeof 'object': el caso que se olvida)", () => {
    expect(leerVariablesNombres([1, 2])).toEqual({});
  });

  it("un objeto con un valor no-string cae a {} entero, no a medias", () => {
    // Media etiqueta es peor que ninguna: con `{}` la UI cae al catalogo y pinta algo
    // coherente; con un mapa mutilado pintaria unas claves con nombre y otras crudas.
    expect(leerVariablesNombres({ a: 1 })).toEqual({});
    expect(leerVariablesNombres({ monto: "Monto a cobrar", guia: 10432 })).toEqual({});
  });

  it("otros no-objetos (undefined, numero, booleano) caen a {}", () => {
    expect(leerVariablesNombres(undefined)).toEqual({});
    expect(leerVariablesNombres(12500)).toEqual({});
    expect(leerVariablesNombres(true)).toEqual({});
  });
});

describe("leerVariablesNombres — deja pasar el mapa valido tal cual", () => {
  it("un objeto plano string -> string se devuelve igual", () => {
    expect(leerVariablesNombres({ monto: "Monto a cobrar" })).toEqual({
      monto: "Monto a cobrar",
    });
  });

  it("conserva TODAS las claves y sus nombres, sin inventar ni perder ninguna", () => {
    const snapshot = { cliente: "Cliente", monto: "Monto a cobrar", guia: "Numero de guia" };
    expect(leerVariablesNombres(snapshot)).toEqual(snapshot);
  });

  it("el objeto vacio (fila anterior a la feature 282) es un valor VALIDO, no un fallo", () => {
    expect(leerVariablesNombres({})).toEqual({});
  });

  it("devuelve una copia: mutar el resultado no toca el valor leido de la fila", () => {
    const origen: Record<string, unknown> = { monto: "Monto a cobrar" };
    const salida = leerVariablesNombres(origen);
    salida.monto = "OTRA COSA";
    expect(origen.monto).toBe("Monto a cobrar");
  });
});
