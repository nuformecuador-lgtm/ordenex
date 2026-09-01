import { describe, it, expect } from "vitest";

import {
  claveDeCicloVida,
  claveDeConteoCargadasPorDia,
  claveDeConteoDevoluciones,
  claveDeConteoEntregas,
  claveDeConteoPorStatus,
  prepararConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import {
  claveDeConteoProductos,
  prepararConsultaProductos,
  TAG_CONTEO_PRODUCTOS,
} from "@/lib/analytics/productos-consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";

// Ficha 345 / T2.5 — LA CONSULTA PREPARADA (R7, R8, R53, R58).
//
// El orden de los cuatro pasos ES el contrato: parsear -> resolver rango -> resolver alcance ->
// intersecar. Si el parseo falla NO se pregunta por el alcance y no se toca la base, para que una
// entrada malformada no sirva para sondear permisos.

const AHORA = new Date("2026-09-01T12:00:00.000Z");

const ACTOR = (rol: string, usuarioId = "u-propio"): ActorAnalitica =>
  ({ usuarioId, rol }) as unknown as ActorAnalitica;

function consultaDe(raw: object, rol = "maestro", usuarioId = "u-propio"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, ACTOR(rol, usuarioId), AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

describe("R8 · el alcance NO entra por la entrada del cliente", () => {
  it("una clave desconocida es `validation_error`", () => {
    const res = prepararConsultaProductos({ rol: "maestro" }, ACTOR("adminTienda"), AHORA);
    expect(res.status).toBe("validation_error");
  });

  it("intentar colar el alcance por el filtro es un RECHAZO, no un extra inocuo", () => {
    for (const raw of [
      { alcance: "global" },
      { usuario_id: ["u9"] },
      { tienda_id_real: ["t9"] },
      { producto: ["Base C"] },
    ]) {
      const res = prepararConsultaProductos(raw, ACTOR("adminTienda"), AHORA);
      expect(res.status, JSON.stringify(raw)).toBe("validation_error");
    }
  });

  it("el rechazo llega con los campos que fallaron", () => {
    const res = prepararConsultaProductos({ zona_id: [] }, ACTOR("maestro"), AHORA);
    expect(res.status).toBe("validation_error");
    if (res.status !== "validation_error") throw new Error("imposible");
    expect(Object.keys(res.fieldErrors)).toContain("zona_id");
  });

  it("un rango invalido es `validation_error` y no una ventana inventada", () => {
    for (const raw of [
      { rango: "milenio" },
      { rango: "personalizado" },
      { desde: "2026-09-01" },
      { rango: "personalizado", desde: "2026-09-02", hasta: "2026-09-01" },
      { rango: "personalizado", desde: "2020-01-01", hasta: "2026-09-01" },
    ]) {
      expect(
        prepararConsultaProductos(raw, ACTOR("maestro"), AHORA).status,
        JSON.stringify(raw),
      ).toBe("validation_error");
    }
  });
});

describe("R53 · si la entrada no valida, NO se resuelve el alcance", () => {
  it("un filtro malformado es `validation_error` AUNQUE el actor no exista", () => {
    // La prueba del ORDEN sin espia: con actor `null`, resolver el alcance primero daria
    // `forbidden`/`sin_sesion`. Que salga `validation_error` demuestra que el parseo fue antes.
    const res = prepararConsultaProductos({ clave_inventada: 1 }, null, AHORA);
    expect(res.status).toBe("validation_error");
  });

  it("un filtro malformado es `validation_error` aunque el rol este PROHIBIDO", () => {
    const res = prepararConsultaProductos({ clave_inventada: 1 }, ACTOR("mensajero"), AHORA);
    expect(res.status).toBe("validation_error");
  });

  it("con filtro valido y sin actor, si es `forbidden` por `sin_sesion`", () => {
    const res = prepararConsultaProductos({}, null, AHORA);
    expect(res).toEqual({ status: "forbidden", motivo: "sin_sesion" });
  });
});

describe("R7 · pedir una tienda ajena se DENIEGA, no se devuelve vacio", () => {
  it("un adminTienda que pide OTRA tienda es `filtro_fuera_de_alcance`", () => {
    const res = prepararConsultaProductos(
      { tienda_id: ["t-ajena"] },
      ACTOR("adminTienda", "t-propia"),
      AHORA,
    );
    // Nunca `ok` con cero filas: un tablero vacio se reporta como bug de datos y esconde el
    // intento, y el id ajeno lo aporto el propio solicitante.
    expect(res).toEqual({ status: "forbidden", motivo: "filtro_fuera_de_alcance" });
  });

  it("pedir la propia y una ajena deja SOLO la propia", () => {
    const consulta = consultaDe(
      { tienda_id: ["t-propia", "t-ajena"] },
      "adminTienda",
      "t-propia",
    );
    expect(consulta.filtro.tienda_id).toEqual(["t-propia"]);
  });

  it("sin nombrar la tienda, el recorte se ESCRIBE igualmente en el filtro", () => {
    // Cinturon y tirantes: aunque el repositorio ignorase `alcance`, el filtro ya viene acotado.
    const consulta = consultaDe({}, "adminTienda", "t-propia");
    expect(consulta.filtro.tienda_id).toEqual(["t-propia"]);
    expect(consulta.alcance).toEqual({ tipo: "tienda", tiendaId: "t-propia" });
  });

  it("`global` no toca el filtro del cliente", () => {
    const consulta = consultaDe({ tienda_id: ["t1", "t2"] }, "maestro");
    expect(consulta.filtro.tienda_id).toEqual(["t1", "t2"]);
    expect(consulta.alcance).toEqual({ tipo: "global" });
  });

  it("un rol PROHIBIDO no llega ni a mirar el filtro", () => {
    for (const rol of ["adminSatelite", "mensajero"]) {
      expect(
        prepararConsultaProductos({ tienda_id: ["t1"] }, ACTOR(rol), AHORA),
        rol,
      ).toEqual({ status: "forbidden", motivo: "metrica_prohibida" });
    }
  });
});

describe("El rango: ausencia significa SIN FILTRO DE FECHA", () => {
  it("sin `rango`, `consulta.rango` es `null` y no una ventana por defecto", () => {
    expect(consultaDe({}).rango).toBeNull();
  });

  it("con `rango`, la ventana viene RESUELTA (fechas, no preset)", () => {
    const consulta = consultaDe({ rango: "dia" });
    expect(consulta.rango).not.toBeNull();
    expect(consulta.rango?.desdeFecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("es determinista con el mismo `now`", () => {
    const uno = prepararConsultaProductos({ rango: "semana" }, ACTOR("maestro"), AHORA);
    const dos = prepararConsultaProductos({ rango: "semana" }, ACTOR("maestro"), AHORA);
    expect(dos).toEqual(uno);
  });

  it("acepta las seis facetas a la vez", () => {
    const consulta = consultaDe({
      zona_id: ["z1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
      mensajero_id: ["m1"],
    });
    expect(consulta.filtro).toEqual({
      zona_id: ["z1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
      mensajero_id: ["m1"],
    });
  });
});

describe("R58 · la clave de cache lleva PREFIJO propio y no colisiona", () => {
  it("empieza por el tag de productos", () => {
    expect(claveDeConteoProductos(consultaDe({}))).toContain(TAG_CONTEO_PRODUCTOS);
    expect(claveDeConteoProductos(consultaDe({})).startsWith(TAG_CONTEO_PRODUCTOS)).toBe(true);
  });

  it("con el MISMO filtro, no coincide con ninguna de las otras seis lecturas de la seccion", () => {
    // Las siete comparten `ConsultaConteoEntregas`/`ConsultaProductos` con el mismo filtro a
    // proposito (la barra las mueve a la vez). Sin prefijo propio producirian LA MISMA CLAVE con
    // valores de FORMA DISTINTA, y quien pidiera los productos recibiria el desglose del anillo.
    const raw = { rango: "dia" as const, tienda_id: ["t1"] };
    const productos = claveDeConteoProductos(consultaDe(raw));

    const entregas = prepararConteoEntregas(raw, ACTOR("maestro"), AHORA);
    if (entregas.status !== "ok") throw new Error("filtro de prueba invalido");

    const otras = [
      claveDeConteoEntregas(entregas.consulta),
      claveDeConteoPorStatus(entregas.consulta),
      claveDeConteoCargadasPorDia(entregas.consulta),
      claveDeConteoDevoluciones(entregas.consulta),
      claveDeCicloVida(entregas.consulta),
    ];
    for (const clave of otras) expect(productos).not.toBe(clave);
    expect(new Set([...otras, productos]).size).toBe(otras.length + 1);
  });

  it("EL ALCANCE VA EN LA CLAVE: dos actores distintos no comparten entrada", () => {
    // No es higiene: una clave que no distingue el alcance no da una cifra equivocada, FILTRA
    // DATOS ENTRE ROLES. Aqui el filtro RECORTADO ya coincide (`tienda_id: ["t1"]` los dos) y
    // aun asi las claves tienen que diferir.
    const maestro = claveDeConteoProductos(consultaDe({ tienda_id: ["t1"] }, "maestro"));
    const tienda = claveDeConteoProductos(consultaDe({}, "adminTienda", "t1"));
    expect(maestro).not.toBe(tienda);
  });

  it("el filtro entra en la clave: cambiarlo cambia la clave", () => {
    expect(claveDeConteoProductos(consultaDe({ zona_id: ["z1"] }))).not.toBe(
      claveDeConteoProductos(consultaDe({ zona_id: ["z2"] })),
    );
  });

  it("la clave es insensible al ORDEN de los ids y sensible a su contenido", () => {
    expect(claveDeConteoProductos(consultaDe({ zona_id: ["z1", "z2"] }))).toBe(
      claveDeConteoProductos(consultaDe({ zona_id: ["z2", "z1"] })),
    );
  });

  it("«sin ventana» tiene entrada propia, distinta de cualquier ventana concreta", () => {
    expect(claveDeConteoProductos(consultaDe({}))).not.toBe(
      claveDeConteoProductos(consultaDe({ rango: "dia" })),
    );
  });
});
