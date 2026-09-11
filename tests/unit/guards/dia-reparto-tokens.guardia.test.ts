import { describe, it, expect } from "vitest";
import { DIA_REPARTO } from "@/lib/types/dia-reparto";
import { accionDeAviso } from "@/lib/notificaciones/catalogo-avisos";

// GUARDIA DEL ARNÉS — FICHA 413 (T1.3, design §2) — LA PALABRA «MAÑANA» DEL TÍTULO TIENE UN
// SUPUESTO DEBAJO, Y ESTE ES EL ASERTO QUE SE PONE ROJO CUANDO ALGUIEN LO ROMPA.
//
// El aviso de la 413 cuenta «las órdenes reservadas para un día CR **posterior** al día en curso»
// y las llama «mañana» en el título. Las dos cosas coinciden HOY por un hecho del producto, no por
// una propiedad del código:
//
//     DIA_REPARTO = ["hoy", "manana"]      (lib/types/dia-reparto.ts)
//
// Tanto la asignación (bodega central y satélite) como la corrección de la 262 pasan por
// `resolverFechaReparto(dia)`, así que «posterior a hoy» y «mañana» son el MISMO conjunto. El día
// que alguien añada «pasado mañana» al selector, el predicado seguiría siendo correcto —cuenta lo
// posterior— pero **el título empezaría a mentir**: diría «Tenés 5 órdenes para mañana» sobre un
// lote que incluye las de pasado mañana.
//
// ⚠️ NO ES UN CASO HIPOTÉTICO DE LABORATORIO. `lib/utils/dia-reparto-textos.ts` deja escrito que
// `fecha_reparto` es un `DATE` libre y que **un `UPDATE` a mano puede dejarlo en +2**: pasó en
// producción el 2026-08-21 con la guía 17496963, y por eso la pestaña del portal se llama «Para
// otro día» y no «Para mañana». Esta guardia vigila la otra mitad: que el SELECTOR no gane un
// token nuevo sin que nadie revise el texto del aviso.
//
// SE DECLARA COMO GUARDIA (`*.guardia.test.ts`) PORQUE VIGILA UN SUPUESTO, no una función: un
// cambio en `lib/types/dia-reparto.ts` no tiene por qué arrastrar a este archivo por el grafo de
// imports, y las guardias corren SIEMPRE.

describe("413/§2 — `DIA_REPARTO` es exactamente `[\"hoy\",\"manana\"]`", () => {
  it("⭑ los dos tokens, en ese orden y sin ninguno más", () => {
    // Literal escrito A MANO: comparar contra la propia constante estaría siempre verde.
    // Añadir un tercer token («pasado_manana», «en_dos_dias», lo que sea) pone esto ROJO y obliga
    // a pasar por el título del aviso ANTES de que la app mienta.
    expect([...DIA_REPARTO]).toEqual(["hoy", "manana"]);
  });

  it("y son DOS, no «al menos dos»: un token de más también lo caza", () => {
    // El `toEqual` de arriba ya lo cubre; esto lo dice con el número delante para que el mensaje
    // de fallo sea legible cuando llegue.
    expect(DIA_REPARTO).toHaveLength(2);
  });

  it("⭑ y el título del aviso SÍ dice «mañana» — que es lo que este supuesto sostiene", () => {
    // La otra mitad de la guardia: sin esto, alguien podría cambiar el título a algo neutro y esta
    // guardia seguiría vigilando un supuesto que ya no sostiene nada (y al revés: si el título
    // dejara de decir «mañana», este archivo habría que revisarlo, no borrarlo).
    //
    // ⚠️ La palabra es segura HOY por dos razones independientes, y las dos hacen falta:
    //   1. `DIA_REPARTO` sólo tiene «hoy» y «manana» — lo de arriba;
    //   2. el aviso NO PUEDE SOBREVIVIR A SU PROPIO DÍA: al pasar la medianoche CR la cifra viva
    //      cae a 0 y el aviso se apaga solo (R21, con reloj fijo a las 00:01 CR).
    const accion = accionDeAviso("reparto_manana", "mensajero");
    if (accion.clase !== "accionable" || !accion.titulo) {
      throw new Error("`reparto_manana` dejó de ser accionable o perdió su compositor de título");
    }
    // Literal a mano, no derivado del compositor.
    expect(accion.titulo(5)).toBe("Tenés 5 órdenes para mañana");
    expect(accion.titulo(5)).toContain("mañana");
  });
});
