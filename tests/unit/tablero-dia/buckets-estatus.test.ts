import { describe, expect, it } from "vitest";

import {
  BUCKET_POR_DEFECTO,
  BUCKET_POR_ESTATUS,
  bucketDeEstatus,
  estatusDelBucket,
  type BucketSinResultado,
} from "@/lib/types/tablero-dia";
import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";

// Feature 192 (B6.1) — R43, R44, R45. La tabla COMPLETA estatus -> bucket sobre el
// catalogo vigente (`ORDER_STATUS_SEED`, 20 values: el spec dice 19 porque se escribio
// antes de que la 157 sumara `recolectando`; aqui manda el seed, no el texto).
//
// La tabla se escribe entera y a mano A PROPOSITO: es la afirmacion de lo que el humano
// aprobo en R43, no una derivacion del mapa que se limitaria a repetir el codigo. Si
// alguien cambia `BUCKET_POR_ESTATUS`, aqui se ve exactamente que orden se reclasifico.
//
// El caso caro es R44: `por_recolectar_en_tienda` cae en `otros`, NO en `sinRecoger`. En
// ese estatus *nadie va todavia* — la asignacion es la transicion que la saca de ahi
// (feature 157) — asi que verla como "trabajo parado de este mensajero" seria atribuirle
// algo que no es de nadie.

const TABLA_APROBADA: Record<OrderStatusValue, BucketSinResultado> = {
  // --- los tres enumerados en R43 ---
  por_recoger: "sinRecoger", // tiene guia y mensajero, espera que el mensajero la acepte
  recolectando: "sinRecoger", // feature 157: alguien va en camino a la tienda
  en_reparto: "enReparto", // feature 36: FUE recogida y esta en la calle
  // --- todo lo demas: `otros` (R45) ---
  entregada: "otros",
  devuelta: "otros",
  devolviendo_a_tienda: "otros",
  reprogramada: "otros",
  en_ruta_bodega_central: "otros",
  en_bodega_central: "otros",
  en_preparacion: "otros",
  en_ruta_bodega_satelite: "otros",
  rechazada: "otros",
  en_bodega_satelite: "otros",
  devuelta_a_tienda: "otros",
  sin_gestionar: "otros",
  por_devolver: "otros",
  devolviendo_a_bodega_central: "otros",
  por_devolver_a_tienda: "otros",
  por_recolectar_en_tienda: "otros", // R44: nadie va todavia
  incidente: "otros",
  // Feature 239/R26 (2026-08-19, T1.7): `otros` POR DEFECTO, y es la clasificacion correcta, no
  // un olvido. Estos buckets solo particionan ordenes SIN gestion vigente hoy; una orden en el
  // pre-estado tiene gestion del dia (la devolucion que el mensajero acaba de registrar), asi
  // que cuenta en `devueltas` y no puede caer en `sinRecoger` ni en `enReparto`.
  devolucion_por_confirmar: "otros",
  // Feature 235 (2026-08-19): `ayuda_tienda` cae en `otros` y NO en `enReparto`. Es una decision
  // afirmada aqui porque `BUCKET_POR_ESTATUS` es PARCIAL y absorbe un value nuevo sin quejarse:
  // los buckets `sinRecoger`/`enReparto` describen el avance normal del dia, y una orden detenida
  // esperando a que la tienda conteste no es ninguno de los dos.
  ayuda_tienda: "otros",
};

describe("R43 — clasificacion de una orden sin gestion vigente en el dia", () => {
  it.each(ORDER_STATUS_SEED)("`%s` cae en el bucket aprobado por el humano", (value) => {
    expect(bucketDeEstatus(value)).toBe(TABLA_APROBADA[value]);
  });

  // Feature 239 (T1.7, R26) — CASO NEGATIVO con su razon. El mapa es parcial con default
  // `otros`, asi que absorbe un value nuevo sin quejarse: si el pre-estado tuviera que estar y
  // no estuviera, nada se pondria rojo. Aqui se afirma que NO tiene bucket explicito y POR QUE.
  it("239/R26: `devolucion_por_confirmar` NO tiene bucket explicito — cae en `otros`", () => {
    expect(BUCKET_POR_ESTATUS).not.toHaveProperty("devolucion_por_confirmar");
    expect(bucketDeEstatus("devolucion_por_confirmar")).toBe("otros");
    // La razon: estos tres buckets solo particionan ordenes SIN gestion vigente hoy. Una orden
    // en el pre-estado tiene gestion del dia (la devolucion que el mensajero acaba de registrar)
    // y cuenta en `devueltas` del primer eje; verla como "trabajo parado" seria contarla dos
    // veces y culpar al mensajero de una orden que ya gestiono.
    expect(estatusDelBucket("sinRecoger")).not.toContain("devolucion_por_confirmar");
    expect(estatusDelBucket("enReparto")).not.toContain("devolucion_por_confirmar");
  });

  // Feature 235 (T1.5, R37/R45): la MISMA clase de decision, con otra razon. `BUCKET_POR_ESTATUS`
  // es PARCIAL con default `otros`, asi que absorbe un value nuevo EN SILENCIO — la unica forma de
  // que la decision sea auditable es afirmarla, con su caso negativo al lado.
  it("235/R37: `ayuda_tienda` NO tiene bucket explicito — cae en `otros`, no en `enReparto`", () => {
    expect(Object.keys(BUCKET_POR_ESTATUS)).not.toContain("ayuda_tienda");
    expect(bucketDeEstatus("ayuda_tienda")).toBe("otros");
  });

  it("235/R45 (CASO NEGATIVO): y `en_reparto` SI lo tiene — la diferencia es la decision", () => {
    // Sin este contraste, el caso de arriba solo diria «no esta en el mapa». Lo que hay que
    // afirmar es POR QUE: `enReparto` describe el avance normal del dia, y una orden detenida
    // esperando a que la tienda conteste no es avance, es una parada.
    expect(bucketDeEstatus("en_reparto")).toBe("enReparto");
    expect(bucketDeEstatus("ayuda_tienda")).not.toBe("enReparto");
  });

  it("los tres casos nombrados en R43 son los unicos con bucket EXPLICITO", () => {
    expect(BUCKET_POR_ESTATUS).toEqual({
      por_recoger: "sinRecoger",
      recolectando: "sinRecoger",
      en_reparto: "enReparto",
    });
  });

  it("`por_recoger` y `recolectando` van a `sinRecoger`; `en_reparto` va a `enReparto`", () => {
    expect(estatusDelBucket("sinRecoger")).toEqual(["por_recoger", "recolectando"]);
    expect(estatusDelBucket("enReparto")).toEqual(["en_reparto"]);
  });

  it("la tabla de este test cubre EXACTAMENTE el catalogo vigente, sin sobrantes", () => {
    expect(Object.keys(TABLA_APROBADA).sort()).toEqual([...ORDER_STATUS_SEED].sort());
  });
});

describe("R44 — `por_recolectar_en_tienda` cae en `otros`, nunca en `sinRecoger`", () => {
  it("su bucket es `otros`", () => {
    expect(bucketDeEstatus("por_recolectar_en_tienda")).toBe("otros");
  });

  it("no aparece entre los estatus de `sinRecoger`", () => {
    expect(estatusDelBucket("sinRecoger")).not.toContain("por_recolectar_en_tienda");
  });

  it("y su vecino del mismo flujo, `recolectando`, si esta en `sinRecoger`", () => {
    // La distincion es el punto de R44: `por_recolectar_en_tienda` = nadie va todavia;
    // `recolectando` = alguien va en camino. Si esta asercion cae junto con la anterior,
    // es que el flujo de la 157 se colapso en un solo estatus.
    expect(bucketDeEstatus("recolectando")).toBe("sinRecoger");
  });
});

describe("R45 — nada no enumerado se absorbe en `sinRecoger` ni en `enReparto`", () => {
  it("los 17 values restantes del catalogo caen en `otros`", () => {
    const otros = estatusDelBucket("otros");

    expect(otros).toHaveLength(ORDER_STATUS_SEED.length - 3);
    expect(otros).not.toContain("por_recoger");
    expect(otros).not.toContain("recolectando");
    expect(otros).not.toContain("en_reparto");
  });

  it("un value FUERA del catalogo (fila huerfana, o un estatus futuro) cae en `otros`", () => {
    // No es hipotetico: la feature 155 retiro un value del seed y su fila sobrevivio
    // huerfana en la base porque el historial la referencia (su literal no se escribe
    // aqui: lo prohibe el censo de `censo-order-status-rename.test.ts`). Si un estatus
    // asi no tuviera bucket, la identidad de ocho sumandos de R25 se romperia en silencio.
    expect(bucketDeEstatus("estatus_retirado_del_catalogo")).toBe("otros");
    expect(bucketDeEstatus("")).toBe("otros");
    expect(bucketDeEstatus("estatus_que_no_existe")).toBe("otros");
  });

  it("el bucket por defecto es `otros`, no uno de los dos que hablan del mensajero", () => {
    expect(BUCKET_POR_DEFECTO).toBe("otros");
  });

  it("los tres buckets son una particion del catalogo: disjuntos y exhaustivos", () => {
    const sinRecoger = estatusDelBucket("sinRecoger");
    const enReparto = estatusDelBucket("enReparto");
    const otros = estatusDelBucket("otros");
    const union = [...sinRecoger, ...enReparto, ...otros];

    expect(union).toHaveLength(ORDER_STATUS_SEED.length);
    expect(new Set(union).size).toBe(ORDER_STATUS_SEED.length);
    expect([...union].sort()).toEqual([...ORDER_STATUS_SEED].sort());
  });
});
