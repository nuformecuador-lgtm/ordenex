import { describe, it, expect } from "vitest";

import { ALCANCE_PRODUCTOS, ALCANCE_PRODUCTOS_DINERO } from "@/lib/analytics/metrics";
import {
  claveDeConteoProductos,
  prepararConsultaProductos,
  resolverAlcanceProductos,
  resolverAlcanceProductosDinero,
  TAG_CONTEO_PRODUCTOS,
} from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { ROLES_ANALITICA } from "@/lib/analytics/types";

// FICHA 347 / B2.3 — QUIEN VE EL DINERO. Cubre R1, R2, R3, R4, R5, R8, R9, R10, R73, R77.
//
// El alcance de DATOS no se vuelve a probar aqui (lo cubre `productos-alcance.test.ts` de la
// 345): lo que se prueba es la CONCESION de dinero, la invariante que la ata al volumen, y que
// la clave de cache la distingue.

const AHORA = new Date("2026-09-01T12:00:00.000Z");

function actor(rol: string, usuarioId = "u1") {
  return { usuarioId, rol } as never;
}

function consultaDe(raw: object, rol: string, usuarioId = "u1"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, actor(rol, usuarioId), AHORA);
  if (preparada.status !== "ok") throw new Error(`salio ${preparada.status}`);
  return preparada.consulta;
}

describe("R1 · la tabla del dinero es PROPIA y EXHAUSTIVA sobre los cinco roles lectores", () => {
  it("declara los cinco roles y ninguno mas", () => {
    // Escrito a mano: es el contrato. Omitir un rol no compila (`satisfies Record<...>`), pero
    // eso no impide anadir uno de mas ni renombrar; esto si.
    expect(Object.keys(ALCANCE_PRODUCTOS_DINERO).sort()).toEqual([
      "admin",
      "adminSatelite",
      "adminTienda",
      "maestro",
      "mensajero",
    ]);
    expect([...ROLES_ANALITICA].sort()).toEqual(Object.keys(ALCANCE_PRODUCTOS_DINERO).sort());
  });

  it("es una tabla DISTINTA de la del volumen, aunque hoy coincidan valor a valor", () => {
    // Que sean dos objetos distintos es lo que permite cerrar el dinero a un rol con UNA linea
    // sin tocar el recorte de datos. Si alguien las fusionara, esta comprobacion lo dice.
    expect(ALCANCE_PRODUCTOS_DINERO).not.toBe(ALCANCE_PRODUCTOS);
  });
});

describe("R2 · LA INVARIANTE DE ATADURA — prohibido, o exactamente el alcance del volumen", () => {
  it("se cumple para los CINCO roles, recorriendo `ROLES_ANALITICA`", () => {
    // ⚠ Se recorre el catalogo de roles, NO una lista escrita en el test: un sexto rol de
    // analitica entra aqui solo y hay que decidir su dinero.
    expect(ROLES_ANALITICA.length).toBe(5);
    for (const rol of ROLES_ANALITICA) {
      const dinero = ALCANCE_PRODUCTOS_DINERO[rol];
      const volumen = ALCANCE_PRODUCTOS[rol];
      expect(
        dinero === "prohibido" || dinero === volumen,
        `${rol}: dinero=${dinero} volumen=${volumen} — el dinero NO puede tener un recorte propio`,
      ).toBe(true);
    }
  });

  it("autocomprobacion: una tabla que viola R2 se detecta", () => {
    // El dinero MAS ancho que el volumen: `adminSatelite` no ve productos y veria su dinero.
    const infractora = { ...ALCANCE_PRODUCTOS_DINERO, adminSatelite: "acotado" } as Record<
      string,
      string
    >;
    const violaciones = ROLES_ANALITICA.filter(
      (rol) => infractora[rol] !== "prohibido" && infractora[rol] !== ALCANCE_PRODUCTOS[rol],
    );
    expect(violaciones).toEqual(["adminSatelite"]);
  });

  it("autocomprobacion: tambien detecta un recorte PROPIO (acotado donde el volumen es total)", () => {
    const infractora = { ...ALCANCE_PRODUCTOS_DINERO, maestro: "acotado" } as Record<string, string>;
    const violaciones = ROLES_ANALITICA.filter(
      (rol) => infractora[rol] !== "prohibido" && infractora[rol] !== ALCANCE_PRODUCTOS[rol],
    );
    expect(violaciones).toEqual(["maestro"]);
  });
});

describe("R3 / R4 / R5 · quien lo tiene concedido", () => {
  it("maestro y admin: concedido y con alcance GLOBAL (todas las tiendas)", () => {
    for (const rol of ["maestro", "admin"]) {
      expect(resolverAlcanceProductosDinero(actor(rol)), rol).toBe("concedido");
      const consulta = consultaDe({}, rol);
      expect(consulta.dinero, rol).toBe("concedido");
      expect(consulta.alcance, rol).toEqual({ tipo: "global" });
    }
  });

  it("R4 · adminTienda: concedido y ACOTADO a su propia tienda, en el alcance de la consulta", () => {
    expect(resolverAlcanceProductosDinero(actor("adminTienda", "t-9"))).toBe("concedido");
    const consulta = consultaDe({}, "adminTienda", "t-9");
    expect(consulta.dinero).toBe("concedido");
    // El recorte del dinero es EL MISMO objeto de alcance que el del volumen: no hay un segundo
    // criterio en ninguna parte.
    expect(consulta.alcance).toEqual({ tipo: "tienda", tiendaId: "t-9" });
    expect(consulta.filtro.tienda_id).toEqual(["t-9"]);
  });

  it("R5 · adminSatelite y mensajero: DENEGADO", () => {
    for (const rol of ["adminSatelite", "mensajero"]) {
      expect(resolverAlcanceProductosDinero(actor(rol)), rol).toBe("denegado");
    }
  });

  it("falla CERRADO: sin sesion, con rol basura o con actor no-objeto", () => {
    expect(resolverAlcanceProductosDinero(null)).toBe("denegado");
    expect(resolverAlcanceProductosDinero(undefined)).toBe("denegado");
    expect(resolverAlcanceProductosDinero({ usuarioId: "", rol: "maestro" } as never)).toBe(
      "denegado",
    );
    expect(resolverAlcanceProductosDinero({ usuarioId: "u1" } as never)).toBe("denegado");
    expect(resolverAlcanceProductosDinero({ usuarioId: "u1", rol: "apiKey" } as never)).toBe(
      "denegado",
    );
    expect(resolverAlcanceProductosDinero("maestro" as never)).toBe("denegado");
    expect(resolverAlcanceProductosDinero(42 as never)).toBe("denegado");
  });
});

describe("R6 · un `denegado` de dinero NO deniega la lectura: la APAGA", () => {
  it("los roles con volumen concedido y dinero denegado no existen HOY, y por eso se prueba el mecanismo", () => {
    // Con la tabla vigente no hay ningun rol en esa casilla (los dos prohibidos del dinero lo
    // estan tambien en el volumen). Lo que se prueba es el MECANISMO: la preparacion no muere
    // por un dinero denegado, porque `resolverAlcanceProductosDinero` no participa en la
    // decision de denegar.
    const casilla = ROLES_ANALITICA.filter(
      (rol) => ALCANCE_PRODUCTOS[rol] !== "prohibido" && ALCANCE_PRODUCTOS_DINERO[rol] === "prohibido",
    );
    expect(casilla).toEqual([]);

    // Y el mecanismo: para un rol con las dos concedidas, la preparacion sale `ok` y el campo
    // `dinero` es un valor mas de la consulta, no un estado de la resolucion.
    const preparada = prepararConsultaProductos({}, actor("maestro"), AHORA);
    expect(preparada.status).toBe("ok");
  });

  it("un rol con el VOLUMEN prohibido sigue siendo `forbidden`, no una tabla sin dinero", () => {
    for (const rol of ["adminSatelite", "mensajero"]) {
      const preparada = prepararConsultaProductos({}, actor(rol), AHORA);
      expect(preparada.status, rol).toBe("forbidden");
    }
  });
});

describe("R8 / R73 · la concesion NUNCA entra por el filtro del cliente", () => {
  it("una clave que pretenda concederla es un `validation_error`", () => {
    for (const intento of [
      { dinero: "concedido" },
      { dinero: "denegado" },
      { rol: "maestro" },
      { alcance: "global" },
      { productos_dinero: "concedido" },
    ]) {
      const preparada = prepararConsultaProductos(intento, actor("adminTienda", "t-9"), AHORA);
      expect(preparada.status, JSON.stringify(intento)).toBe("validation_error");
    }
  });

  it("R73 · si no valida, NO se resuelve el alcance ni se toca nada mas", () => {
    // Se comprueba por la FORMA de la respuesta: un `validation_error` no lleva alcance ni
    // consulta, asi que no hubo resolucion que reportar. Un `forbidden` si la habria tenido.
    const preparada = prepararConsultaProductos({ dinero: "concedido" }, null, AHORA);
    expect(preparada.status).toBe("validation_error");
    expect(preparada).not.toHaveProperty("consulta");
    expect(preparada).not.toHaveProperty("motivo");
  });

  it("un filtro con clave desconocida no se cuela ni siquiera para un maestro", () => {
    expect(prepararConsultaProductos({ tienda_id_real: ["x"] }, actor("maestro"), AHORA).status).toBe(
      "validation_error",
    );
  });
});

describe("R9 / R77 · la clave de cache distingue la CONCESION DE DINERO", () => {
  it("lleva el prefijo propio de la vertical", () => {
    expect(claveDeConteoProductos(consultaDe({}, "maestro")).startsWith(TAG_CONTEO_PRODUCTOS)).toBe(
      true,
    );
  });

  it("⚠ MUTACION M5 · dos consultas IGUALES salvo la concesion NO comparten entrada", () => {
    // Se construyen dos consultas con el MISMO filtro, el MISMO rango y el MISMO alcance de
    // datos, y solo distinta concesion. Sin el sufijo `$=` de `claveDeConteoProductos`, las dos
    // claves son IDENTICAS: el primero que sea maestro deja el dinero en cache y el siguiente
    // actor lo recibe. Eso no es una cifra equivocada, es una FUGA.
    const base = consultaDe({}, "maestro");
    const conDinero = { ...base, dinero: "concedido" } as ConsultaProductos;
    const sinDinero = { ...base, dinero: "denegado" } as ConsultaProductos;

    // Mismo alcance, mismo filtro, mismo rango: lo unico distinto es la concesion.
    expect(sinDinero.alcance).toEqual(conDinero.alcance);
    expect(sinDinero.filtro).toEqual(conDinero.filtro);
    expect(sinDinero.rango).toEqual(conDinero.rango);

    expect(claveDeConteoProductos(conDinero)).not.toBe(claveDeConteoProductos(sinDinero));
    // Y el componente que las distingue es EXACTAMENTE el sufijo, no otra cosa que cambiara de
    // paso: la clave del concedido termina en `$=concedido`.
    expect(claveDeConteoProductos(conDinero).endsWith("$=concedido")).toBe(true);
    expect(claveDeConteoProductos(sinDinero).endsWith("$=denegado")).toBe(true);
  });

  it("y sigue distinguiendo el ALCANCE de datos, que es lo que ya protegia la 345", () => {
    const maestro = consultaDe({ tienda_id: ["t-9"] }, "maestro");
    const tienda = consultaDe({}, "adminTienda", "t-9");
    expect(claveDeConteoProductos(maestro)).not.toBe(claveDeConteoProductos(tienda));
  });

  it("la misma consulta produce SIEMPRE la misma clave (R25)", () => {
    const a = consultaDe({ rango: "semana", zona_id: ["z1", "z2"] }, "maestro");
    const b = consultaDe({ rango: "semana", zona_id: ["z2", "z1"] }, "maestro");
    expect(claveDeConteoProductos(a)).toBe(claveDeConteoProductos(b));
  });
});

describe("R10 · el campo `dinero` viaja DENTRO del tipo opaco, no al lado", () => {
  it("la consulta preparada lo trae, y por tanto no se puede olvidar al pasarla al repositorio", () => {
    const consulta = consultaDe({}, "maestro");
    expect(Object.keys(consulta).sort()).toEqual(["alcance", "dinero", "filtro", "rango"]);
  });
});
