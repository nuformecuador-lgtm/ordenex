import { describe, it, expect } from "vitest";

import type {
  OrdenHistorialCorreccionDiaDTO,
  OrdenHistorialEntradaDTO,
  OrdenHistorialTransicionDTO,
} from "@/lib/types/orden-historial";

/**
 * ⭑ FEATURE 262 (F8/B24, R39/R42) — EL BUILD ROMPE SI ALGUIEN TRATA UNA CORRECCION COMO SI FUERA
 * UNA TRANSICION.
 *
 * ESTE ARCHIVO NO SE VERIFICA EJECUTANDOLO, SE VERIFICA COMPILANDOLO. Los `@ts-expect-error` de
 * abajo son la mitad util: cada uno afirma que la linea siguiente NO COMPILA. Si alguien
 * deshiciera la union —volviendo `estatusDestinoValue` opcional, o metiendo los campos de la
 * correccion en la misma interfaz (M-aj)— esas lineas pasarian a compilar, el
 * `@ts-expect-error` se quedaria SIN ERROR QUE SUPRIMIR y `pnpm typecheck` se pondria ROJO
 * nombrando este archivo.
 *
 * Es la unica forma de que R42 («esa comprobacion NO DEBE poder satisfacerse por omision») no
 * sea una promesa: un test de runtime no puede afirmar que algo no compila.
 *
 * Hay precedente en el repo: nueve archivos de `tests/` usan `@ts-expect-error` con este mismo
 * proposito.
 */

// --------------------------------------------------------------------------------------------
// (a) Lo que NO compila. Cada `@ts-expect-error` es una asercion.
// --------------------------------------------------------------------------------------------

function _leerSinEstrechar(entrada: OrdenHistorialEntradaDTO) {
  // R42: sobre la UNION no se puede leer un campo de transicion. Hay que preguntar por `clase`.
  // @ts-expect-error `estatusDestinoValue` no existe en `OrdenHistorialCorreccionDiaDTO`
  const destino = entrada.estatusDestinoValue;
  // @ts-expect-error `estatusOrigenValue` no existe en `OrdenHistorialCorreccionDiaDTO`
  const origen = entrada.estatusOrigenValue;
  // @ts-expect-error `origenTipo` es el censo de familias de escritura de ESTADO: la correccion
  // no escribe ningun estado y por eso no lo tiene (design §14.1, punto 5)
  const familia = entrada.origenTipo;
  // Y al reves: tampoco se leen los campos de la correccion sin estrechar.
  // @ts-expect-error `fechaNuevaISO` no existe en `OrdenHistorialTransicionDTO`
  const fecha = entrada.fechaNuevaISO;
  return { destino, origen, familia, fecha };
}

function _correccionSinEstadoDestino(correccion: OrdenHistorialCorreccionDiaDTO) {
  // R39: la entrada de correccion NO tiene estado destino. Ni nullable: NO EXISTE.
  // @ts-expect-error una correccion no tiene estado de destino
  return correccion.estatusDestinoValue;
}

function _laCorreccionNoEsUnaTransicion(correccion: OrdenHistorialCorreccionDiaDTO) {
  // @ts-expect-error las dos clases NO son asignables entre si: la union es real, no cosmetica
  const comoTransicion: OrdenHistorialTransicionDTO = correccion;
  return comoTransicion;
}

function _lasFechasNoSonDate(): OrdenHistorialCorreccionDiaDTO {
  return {
    clase: "correccion_dia",
    // Las dos fechas viajan como `YYYY-MM-DD` YA serializado, jamas como `Date` (design §14.1,
    // punto 4): un `@db.Date` formateado en el navegador devuelve el dia anterior en media
    // America. El tipo lo impide.
    // @ts-expect-error `fechaAnteriorISO` es `string`, no `Date`
    fechaAnteriorISO: new Date("2026-08-21T00:00:00.000Z"),
    fechaNuevaISO: "2026-08-22",
    actorNombre: "Ana Perez",
    motivo: "la bodega marco el lote para el dia siguiente por error",
    createdAt: new Date("2026-08-22T09:14:00.000Z"),
  };
}

void _leerSinEstrechar;
void _correccionSinEstadoDestino;
void _laCorreccionNoEsUnaTransicion;
void _lasFechasNoSonDate;

// --------------------------------------------------------------------------------------------
// (b) Lo que SI compila, y por que hace falta afirmarlo tambien.
//
// Sin esta mitad, los `@ts-expect-error` de arriba se satisfarian igual borrando el tipo entero
// o poniendo `never` en todas partes. Aqui se afirma que la union sigue SIRVIENDO para lo suyo.
// --------------------------------------------------------------------------------------------

function etiquetaDe(entrada: OrdenHistorialEntradaDTO): string {
  switch (entrada.clase) {
    case "transicion":
      // Estrechada, los seis campos de siempre se leen sin ceremonia.
      return `${entrada.estatusOrigenValue ?? "creacion"}->${entrada.estatusDestinoValue}`;
    case "correccion_dia":
      // Estrechada, las dos fechas y el motivo tambien. Y `actorNombre` es `string`, no
      // `string | null`: aqui nunca escribe un cron.
      return `${entrada.fechaAnteriorISO}->${entrada.fechaNuevaISO} por ${entrada.actorNombre}`;
    default: {
      // EXHAUSTIVIDAD DEMOSTRADA: una tercera clase sin rama rompe el build en esta linea.
      const _exhaustivo: never = entrada;
      return _exhaustivo;
    }
  }
}

describe("262/R42 — la union discriminada del historial", () => {
  it("el `switch` por `clase` estrecha a cada una de las dos formas", () => {
    const transicion: OrdenHistorialEntradaDTO = {
      clase: "transicion",
      estatusOrigenValue: "por_recoger",
      estatusDestinoValue: "en_reparto",
      origenTipo: "recoleccion",
      actorNombre: "Ana Mensajera",
      motivo: null,
      createdAt: new Date("2026-08-21T14:00:00.000Z"),
    };
    const correccion: OrdenHistorialEntradaDTO = {
      clase: "correccion_dia",
      fechaAnteriorISO: "2026-08-22",
      fechaNuevaISO: "2026-08-21",
      actorNombre: "Ana Perez",
      motivo: "la bodega marco el lote para el dia siguiente por error",
      createdAt: new Date("2026-08-22T09:14:00.000Z"),
    };

    expect(etiquetaDe(transicion)).toBe("por_recoger->en_reparto");
    expect(etiquetaDe(correccion)).toBe("2026-08-22->2026-08-21 por Ana Perez");
  });

  it("el discriminante es EXPLICITO: las dos clases se distinguen por `clase` y no por la presencia de un campo", () => {
    // design §14.1, punto 2: con `"fechaNuevaISO" in entrada` una tercera clase futura caeria
    // en el `else` en silencio. Con `clase`, TypeScript obliga a decidir.
    const clases: OrdenHistorialEntradaDTO["clase"][] = ["transicion", "correccion_dia"];
    expect(clases).toEqual(["transicion", "correccion_dia"]);
  });
});
