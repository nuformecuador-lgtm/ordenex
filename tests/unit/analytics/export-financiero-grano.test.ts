import { describe, it, expect } from "vitest";

import {
  CIFRA_FLUJO,
  CIFRA_SALDO_AL_CORTE,
  LIMITACION_ULTIMO_CUBO_EN_CURSO,
} from "@/app/(app)/analitica/_components/export-financiero/analitica-financiera-descarga-columnas";
import { filasDeVistaFinanciera } from "@/app/(app)/analitica/_components/export-financiero/export-financiero";
import { RANGO_TABLERO } from "@/tests/fixtures/dto-financiero-servido";

import {
  dtoTemporalAcumulado,
  dtoTemporalConNeto,
  granoDe,
  RANGO_LARGO,
} from "./_fake-financiera-export";

// Feature 184 — analitica financiera: export de la serie (T2.3). R15, R16 y R30.
//
// ⚠ AVISO DE NUMERACION: «184» en los comentarios de este arbol suele referirse a la ficha
// renumerada a la 188. Esta feature se rotula con nombre, no solo con numero.
//
// LAS TRES COLUMNAS QUE IMPIDEN LEER MAL EL ARCHIVO:
//
//  - `grano` (R15). Sin ella, una serie SEMANAL descargada se lee como diaria y afirma SIETE
//    VECES MAS DINERO POR PUNTO. Es el defecto que la 186 documenta en `adaptar.ts`, trasladado
//    a un fichero que ademas se reenvia y se abre seis meses despues.
//  - `cifra` (R16). Sin ella, el saldo al corte de una cuenta por pagar se descarga
//    indistinguible de un flujo del periodo, y quien lo abra lo sumara entre fechas.
//  - `limitacion_conocida` (R30 / D3). Sin ella, el archivo circula con su ultimo punto por
//    debajo de la realidad y nada lo advierte.
//
// El grano de las fixtures NO se escribe: sale de `granularidadDe`, la misma funcion pura que el
// servidor usa. Los dos rangos estan elegidos para caer a lados distintos de `TOPE_PUNTOS_SERIE`.

describe("Feature 184 — analitica financiera: export de la serie (R15) · cada fila declara su grano", () => {
  it("cada fila declara el grano del cubo y una serie semanal no se escribe como diaria", () => {
    const diaria = dtoTemporalConNeto(RANGO_TABLERO);
    const semanal = dtoTemporalConNeto(RANGO_LARGO);

    // SANIDAD: los dos rangos producen granos DISTINTOS. Sin esto, el caso pasaria en verde con
    // las dos series declarando lo mismo y no mediria nada.
    expect(granoDe(RANGO_TABLERO)).toBe("dia");
    expect(granoDe(RANGO_LARGO)).toBe("semana");

    const filasDiarias = filasDeVistaFinanciera(diaria, diaria.vistas[0]!);
    const filasSemanales = filasDeVistaFinanciera(semanal, semanal.vistas[0]!);

    expect(filasDiarias.length).toBeGreaterThan(0);
    expect(filasSemanales.length).toBeGreaterThan(0);
    for (const fila of filasDiarias) expect(fila.grano).toBe("dia");
    for (const fila of filasSemanales) expect(fila.grano).toBe("semana");

    // Y el grano se COPIA del DTO, fila a fila: no se deduce del tamaño del rango en el cliente.
    expect(filasSemanales.every((fila) => fila.grano === semanal.vistas[0]!.granularidad)).toBe(
      true,
    );
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R16) · flujo o saldo al corte", () => {
  it("la fila de una metrica acumulada se declara saldo al corte y no movimiento del periodo", () => {
    const acumulada = dtoTemporalAcumulado();
    const deFlujo = dtoTemporalConNeto();

    // SANIDAD: las dos fixtures difieren en `esAcumulado`, y ese campo lo deriva el mismo
    // `esMetricaAcumulada` del contrato que el servicio usa en su cabecera.
    expect(acumulada.esAcumulado).toBe(true);
    expect(deFlujo.esAcumulado).toBe(false);

    const filasAcumuladas = filasDeVistaFinanciera(acumulada, acumulada.vistas[0]!);
    const filasDeFlujo = filasDeVistaFinanciera(deFlujo, deFlujo.vistas[0]!);

    expect(filasAcumuladas.length).toBeGreaterThan(0);
    for (const fila of filasAcumuladas) expect(fila.cifra).toBe(CIFRA_SALDO_AL_CORTE);
    for (const fila of filasDeFlujo) expect(fila.cifra).toBe(CIFRA_FLUJO);

    // Los dos valores son DISTINGUIBLES: si el vocabulario colapsara, la columna dejaria de
    // decir nada y las dos clases de cifra volverian a ser indistinguibles en la hoja.
    expect(CIFRA_SALDO_AL_CORTE).not.toBe(CIFRA_FLUJO);
  });
});

describe("Feature 184 — analitica financiera: export de la serie (R30/D3) · la limitacion declarada", () => {
  it("todas las filas declaran la limitacion del ultimo cubo, con el mismo texto y sin estimarla", () => {
    const datos = dtoTemporalConNeto();
    const filas = filasDeVistaFinanciera(datos, datos.vistas[0]!);

    expect(filas.length).toBeGreaterThan(1);

    // (1) TODAS las filas la llevan: no solo la ultima. El servicio no marca cual esta en curso
    // (Q2 de la 180: marcarlo exigiria inyectarle un reloj y romper su determinismo), asi que la
    // columna declara la limitacion del ARCHIVO, no una propiedad de cada fila.
    const valores = new Set(filas.map((fila) => fila.limitacion_conocida));
    expect(valores.size, "la limitacion cambia entre filas: alguien la esta ESTIMANDO").toBe(1);
    expect([...valores]).toEqual([LIMITACION_ULTIMO_CUBO_EN_CURSO]);

    // (2) NO es un numero ni un booleano disfrazado: es el texto constante declarado.
    expect(typeof filas[0]!.limitacion_conocida).toBe("string");
    expect(String(filas[0]!.limitacion_conocida)).toMatch(/en curso/i);

    // (3) Y no depende del cubo: proyectar la MISMA vista sobre otro rango da el mismo texto. Si
    // alguien calculara en el cliente cual es el cubo en curso, este valor cambiaria.
    const otro = dtoTemporalConNeto(RANGO_LARGO);
    const otrasFilas = filasDeVistaFinanciera(otro, otro.vistas[0]!);
    expect(new Set(otrasFilas.map((fila) => fila.limitacion_conocida))).toEqual(
      new Set([LIMITACION_ULTIMO_CUBO_EN_CURSO]),
    );
  });
});
