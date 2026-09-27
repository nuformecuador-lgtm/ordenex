import { describe, it, expect } from "vitest";

import type {
  OrdenHistorialCorreccionDiaDTO,
  OrdenHistorialEntradaDTO,
  OrdenHistorialTransicionDTO,
  OrdenHistorialTraspasoDTO,
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
 *
 * ⭑ FICHA 427 (T20/T21) — LA TERCERA CLASE ENTRO, y este archivo la cubre con el mismo criterio:
 * un TRASPASO tampoco tiene estado de origen ni de destino (R21), no es asignable a ninguna de sus
 * dos hermanas, y el `switch` de `etiquetaDe` deja de compilar si alguien le quita su rama.
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

function _elTraspasoNoTieneEstados(traspaso: OrdenHistorialTraspasoDTO) {
  // FICHA 427/R21: un traspaso NO cambia el estado de la orden. La entrada no tiene estado de
  // destino ni de origen, y tampoco `origenTipo`: ni nullable, NO EXISTEN.
  // @ts-expect-error un traspaso no tiene estado de destino
  const destino = traspaso.estatusDestinoValue;
  // @ts-expect-error `origenTipo` es el censo de familias que ESCRIBEN `orden.estatus_id`
  const familia = traspaso.origenTipo;
  return { destino, familia };
}

function _elTraspasoNoEsUnaCorreccion(traspaso: OrdenHistorialTraspasoDTO) {
  // @ts-expect-error las tres clases NO son asignables entre si: la union es real, no cosmetica
  const comoCorreccion: OrdenHistorialCorreccionDiaDTO = traspaso;
  return comoCorreccion;
}

function _elRolDelTraspasoNoEsTextoLibre(): OrdenHistorialTraspasoDTO {
  return {
    clase: "traspaso_mensajero",
    mensajeroAnteriorNombre: "Andy Cortes",
    mensajeroNuevoNombre: "Carlos Eduardo",
    actorNombre: "Coordinadora Ana",
    // R26: el rol congelado es un valor del enum de Postgres, no una cadena cualquiera. Un texto
    // libre aqui dejaria la linea de tiempo pintando lo que nadie valido.
    // @ts-expect-error `actorRol` es `RolValue`, no `string`
    actorRol: "coordinadora",
    motivo: "Andy se reporto enfermo a media jornada",
    createdAt: new Date("2026-09-14T14:00:00.000Z"),
  };
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
void _elTraspasoNoTieneEstados;
void _elTraspasoNoEsUnaCorreccion;
void _elRolDelTraspasoNoEsTextoLibre;
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
    case "traspaso_mensajero":
      // FICHA 427: estrechada, los dos nombres, el actor y su rol CONGELADO se leen sin ceremonia.
      return `${entrada.mensajeroAnteriorNombre}->${entrada.mensajeroNuevoNombre} por ${entrada.actorNombre} (${entrada.actorRol})`;
    case "evento_orden":
      // FICHA 454 (T1.21): estrechada, el tipo del hecho, su resultado y el actor con su rol
      // CONGELADO se leen sin ceremonia. La cuarta clase llego por la trampa de este `default`.
      return `${entrada.tipo}:${entrada.resultado ?? "-"} por ${entrada.actorNombre} (${entrada.actorRol})`;
    default: {
      // EXHAUSTIVIDAD DEMOSTRADA: una tercera clase sin rama rompe el build en esta linea.
      const _exhaustivo: never = entrada;
      return _exhaustivo;
    }
  }
}

describe("262/R42 — la union discriminada del historial", () => {
  it("el `switch` por `clase` estrecha a cada una de las TRES formas", () => {
    const transicion: OrdenHistorialEntradaDTO = {
      clase: "transicion",
      estatusOrigenValue: "mensajero_recogiendo_en_bodega",
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

    const traspaso: OrdenHistorialEntradaDTO = {
      clase: "traspaso_mensajero",
      mensajeroAnteriorNombre: "Andy Cortes",
      mensajeroNuevoNombre: "Carlos Eduardo",
      actorNombre: "Coordinadora Ana",
      actorRol: "admin",
      motivo: "Andy se reporto enfermo a media jornada",
      createdAt: new Date("2026-09-14T14:00:00.000Z"),
    };

    expect(etiquetaDe(transicion)).toBe("mensajero_recogiendo_en_bodega->en_reparto");
    expect(etiquetaDe(correccion)).toBe("2026-08-22->2026-08-21 por Ana Perez");
    expect(etiquetaDe(traspaso)).toBe(
      "Andy Cortes->Carlos Eduardo por Coordinadora Ana (admin)",
    );

    // FICHA 454 (T1.21): la CUARTA forma.
    const evento: OrdenHistorialEntradaDTO = {
      clase: "evento_orden",
      tipo: "gestion_registrada",
      resultado: "entregado",
      resultadoAnterior: null,
      actorNombre: "Carlos Eduardo",
      actorRol: "mensajero",
      createdAt: new Date("2026-09-23T15:00:00.000Z"),
    };
    expect(etiquetaDe(evento)).toBe("gestion_registrada:entregado por Carlos Eduardo (mensajero)");
  });

  it("el discriminante es EXPLICITO: las dos clases se distinguen por `clase` y no por la presencia de un campo", () => {
    // design §14.1, punto 2: con `"fechaNuevaISO" in entrada` una tercera clase futura caeria
    // en el `else` en silencio. Con `clase`, TypeScript obliga a decidir.
    const clases: OrdenHistorialEntradaDTO["clase"][] = [
      "transicion",
      "correccion_dia",
      "traspaso_mensajero",
      "evento_orden", // FICHA 454 (T1.21)
    ];
    expect(clases).toEqual(["transicion", "correccion_dia", "traspaso_mensajero", "evento_orden"]);
  });
});
