import { describe, it, expect } from "vitest";

import {
  claveDeConteoEntregas,
  parseFiltroConteoEntregas,
  prepararConteoEntregas,
  recortarFiltroConteoEntregas,
  resolverAlcanceConteoEntregas,
  type ConsultaConteoEntregas,
  type FiltroConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { RANGO_TOPE_DIAS } from "@/lib/analytics/types";

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function actor(rol: string, extra: Record<string, unknown> = {}) {
  return { usuarioId: "u1", rol, ...extra } as never;
}

/* -------------------------------------------------------------------------- */
/* El esquema                                                                  */
/* -------------------------------------------------------------------------- */

// Decisión del 2026-08-18: la pantalla NO arranca con ninguna ventana puesta. Un filtro sin
// `rango` es válido y significa «sin filtro de fecha», no «rango inválido» ni «pon el preset
// de siempre».
describe("Filtro del conteo — sin rango es SIN VENTANA, no un preset por defecto", () => {
  it("el objeto vacío es un filtro válido", () => {
    expect(parseFiltroConteoEntregas({}).status).toBe("ok");
  });

  it("preparar sin rango deja `rango: null`, y no una ventana inventada", () => {
    const preparada = prepararConteoEntregas({}, actor("maestro"), AHORA);

    expect(preparada.status).toBe("ok");
    if (preparada.status !== "ok") return;
    expect(preparada.consulta.rango).toBeNull();
  });

  // Las demás facetas siguen viajando: «sin fecha» no es «sin filtros».
  it("se puede filtrar por las seis dimensiones sin dar ninguna fecha", () => {
    const preparada = prepararConteoEntregas(
      { zona_id: ["z1"], distrito_id: ["d1"], mensajero_id: ["m1"] },
      actor("maestro"),
      AHORA,
    );

    expect(preparada.status).toBe("ok");
    if (preparada.status !== "ok") return;
    expect(preparada.consulta.rango).toBeNull();
    expect(preparada.consulta.filtro).toMatchObject({ zona_id: ["z1"], distrito_id: ["d1"] });
  });

  // Y sin rango, las fechas sueltas siguen PROHIBIDAS: media terna no describe una ventana, y
  // aceptarlas obligaría a inventar qué preset las acompaña.
  it.each([
    ["sólo desde", { desde: "2026-08-01" }],
    ["sólo hasta", { hasta: "2026-08-16" }],
    ["las dos, sin rango", { desde: "2026-08-01", hasta: "2026-08-16" }],
  ])("rechaza «%s»", (_caso, raw) => {
    expect(parseFiltroConteoEntregas(raw).status).toBe("validation_error");
  });
});

describe("Filtro del conteo de entregas — qué acepta el borde", () => {
  it("acepta las siete facetas, incluida la cadena geográfica", () => {
    const parseado = parseFiltroConteoEntregas({
      rango: "personalizado",
      desde: "2026-08-01",
      hasta: "2026-08-16",
      zona_id: ["z1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
      mensajero_id: ["m1"],
    });

    expect(parseado.status).toBe("ok");
  });

  // `.strict()`. Es lo que impide que el alcance entre por el filtro: si `rol` colara, un
  // cliente podría proponer el suyo. No es cosmética de validación, es la puerta.
  it.each([
    ["rol", { rol: "maestro" }],
    ["usuario_id", { usuario_id: "u9" }],
    ["alcance", { alcance: "global" }],
  ])("rechaza la clave desconocida «%s»", (_nombre, extra) => {
    expect(parseFiltroConteoEntregas({ rango: "semana", ...extra }).status).toBe(
      "validation_error",
    );
  });

  // Una lista vacía degradaría a "sin filtro" si el repositorio la descartara. Falla cerrado.
  it.each(["zona_id", "provincia_id", "canton_id", "distrito_id", "tienda_id", "mensajero_id"])(
    "rechaza la lista vacía en «%s»",
    (clave) => {
      expect(parseFiltroConteoEntregas({ rango: "semana", [clave]: [] }).status).toBe(
        "validation_error",
      );
    },
  );

  it.each([
    ["preset inventado", { rango: "trimestre" }],
    ["personalizado sin fechas", { rango: "personalizado" }],
    ["preset con fechas", { rango: "semana", desde: "2026-08-01", hasta: "2026-08-02" }],
    ["rango invertido", { rango: "personalizado", desde: "2026-08-16", hasta: "2026-08-01" }],
    ["fecha con hora", { rango: "personalizado", desde: "2026-08-01T00:00:00Z", hasta: "2026-08-02" }],
    ["fecha de ancho variable", { rango: "personalizado", desde: "2026-8-1", hasta: "2026-08-02" }],
  ])("rechaza «%s»", (_caso, raw) => {
    expect(parseFiltroConteoEntregas(raw).status).toBe("validation_error");
  });

  // El tope vive en `RANGO_TOPE_DIAS` y se lee de ahí: si alguien lo ajusta, este caso lo
  // sigue en vez de quedarse defendiendo un número que ya no rige.
  it("rechaza una ventana que supera el tope y acepta la que lo iguala", () => {
    const desde = "2026-01-01";
    const enElTope = new Date(Date.UTC(2026, 0, 1) + (RANGO_TOPE_DIAS - 1) * 86_400_000);
    const pasado = new Date(Date.UTC(2026, 0, 1) + RANGO_TOPE_DIAS * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    expect(
      parseFiltroConteoEntregas({ rango: "personalizado", desde, hasta: iso(enElTope) }).status,
    ).toBe("ok");
    expect(
      parseFiltroConteoEntregas({ rango: "personalizado", desde, hasta: iso(pasado) }).status,
    ).toBe("validation_error");
  });

  // TOTAL: no lanza con basura. Una frontera que revienta con `null` no es una frontera.
  it.each([null, undefined, 42, "semana", [], () => {}])("no lanza con %s", (raw) => {
    expect(() => parseFiltroConteoEntregas(raw)).not.toThrow();
    expect(parseFiltroConteoEntregas(raw).status).toBe("validation_error");
  });
});

/* -------------------------------------------------------------------------- */
/* El alcance                                                                  */
/* -------------------------------------------------------------------------- */

describe("Alcance del conteo — quién ve qué", () => {
  // La decisión humana del 2026-08-17, caso por caso.
  it("maestro y admin ven todo", () => {
    for (const rol of ["maestro", "admin"]) {
      expect(resolverAlcanceConteoEntregas(actor(rol))).toEqual({
        estado: "ok",
        alcance: { tipo: "global" },
      });
    }
  });

  // Y no por una lista escrita aquí: los dos roles totales son los de `esAccesoTotal`, que
  // es la fuente única del repo. Si esa fuente cambiara, este caso lo dice.
  it("los roles totales son EXACTAMENTE los de `esAccesoTotal`", () => {
    for (const rol of ["maestro", "admin", "adminSatelite", "adminTienda", "mensajero"]) {
      const resolucion = resolverAlcanceConteoEntregas(actor(rol, { zonaId: "z1" }));
      const esGlobal = resolucion.estado === "ok" && resolucion.alcance.tipo === "global";
      expect(esGlobal, rol).toBe(esAccesoTotal(rol as never));
    }
  });

  it("adminTienda queda acotado a SU cuenta, no a la que pida", () => {
    expect(resolverAlcanceConteoEntregas(actor("adminTienda"))).toEqual({
      estado: "ok",
      alcance: { tipo: "tienda", tiendaId: "u1" },
    });
  });

  it("adminSatelite queda acotado a SU zona", () => {
    expect(resolverAlcanceConteoEntregas(actor("adminSatelite", { zonaId: "z7" }))).toEqual({
      estado: "ok",
      alcance: { tipo: "zona", zonaId: "z7" },
    });
  });

  // `usuario.zona_id` es NULLABLE en el esquema: el `null` es real. Conceder `global` ahí
  // sería una escalada y `zona: ""` un recorte vacío silencioso.
  it.each([null, undefined, ""])("adminSatelite sin zona (%s) es DENEGADO, no global", (zonaId) => {
    expect(resolverAlcanceConteoEntregas(actor("adminSatelite", { zonaId }))).toEqual({
      estado: "denegado",
      motivo: "sin_zona_asignada",
    });
  });

  // La instrucción explícita del humano: el mensajero no tiene sección de analítica y no debe
  // ver nada relacionado. Prohibido NO es "acotado a lo suyo" ni "ok con ceros".
  it("el mensajero está PROHIBIDO, no acotado", () => {
    expect(resolverAlcanceConteoEntregas(actor("mensajero"))).toEqual({
      estado: "denegado",
      motivo: "metrica_prohibida",
    });
  });

  it("apiKey y cualquier rol inventado están denegados", () => {
    for (const rol of ["apiKey", "root", "Admin Tienda", ""]) {
      expect(resolverAlcanceConteoEntregas(actor(rol)).estado, rol).toBe("denegado");
    }
  });

  // TOTAL y falla CERRADO: entrada basura no lanza y no concede.
  it.each([null, undefined, {}, { rol: "maestro" }, { usuarioId: "" , rol: "maestro" }, 7])(
    "con el actor %s deniega sin lanzar",
    (malo) => {
      expect(() => resolverAlcanceConteoEntregas(malo as never)).not.toThrow();
      expect(resolverAlcanceConteoEntregas(malo as never).estado).toBe("denegado");
    },
  );

  it("un rol que no es cadena no se compara con nada", () => {
    expect(resolverAlcanceConteoEntregas({ usuarioId: "u1", rol: 3 } as never)).toEqual({
      estado: "denegado",
      motivo: "rol_desconocido",
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Precedencia del alcance sobre el filtro                                     */
/* -------------------------------------------------------------------------- */

const BASE: FiltroConteoEntregas = { rango: "semana" };

describe("El filtro NO puede ampliar el alcance", () => {
  it("sin nombrar la dimensión, el recorte se ESCRIBE igualmente en el filtro", () => {
    expect(recortarFiltroConteoEntregas(BASE, { tipo: "tienda", tiendaId: "t1" })).toMatchObject({
      tienda_id: ["t1"],
    });
    expect(recortarFiltroConteoEntregas(BASE, { tipo: "zona", zonaId: "z1" })).toMatchObject({
      zona_id: ["z1"],
    });
  });

  it("pedir la propia y una ajena deja SOLO la propia", () => {
    expect(
      recortarFiltroConteoEntregas(
        { ...BASE, tienda_id: ["t1", "t2"] },
        { tipo: "tienda", tiendaId: "t1" },
      ),
    ).toMatchObject({ tienda_id: ["t1"] });
  });

  // Falla CERRADO y no con conjunto vacío: un tablero vacío se reporta como bug de datos y
  // esconde el intento. Y el id ajeno lo aportó el propio solicitante.
  it("pedir SOLO lo ajeno es `null` (403), nunca un resultado vacío", () => {
    expect(
      recortarFiltroConteoEntregas({ ...BASE, tienda_id: ["t9"] }, { tipo: "tienda", tiendaId: "t1" }),
    ).toBeNull();
    expect(
      recortarFiltroConteoEntregas({ ...BASE, zona_id: ["z9"] }, { tipo: "zona", zonaId: "z1" }),
    ).toBeNull();
  });

  // La geografía no tiene alcance por rol: nadie es "dueño" de un cantón, así que no hay
  // nada que intersecar y las tres claves pasan tal cual.
  it("provincia, cantón y distrito no se recortan por alcance", () => {
    const filtro = { ...BASE, provincia_id: ["p1"], canton_id: ["c1"], distrito_id: ["d1"] };
    expect(recortarFiltroConteoEntregas(filtro, { tipo: "zona", zonaId: "z1" })).toMatchObject({
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
    });
  });

  it("`global` no toca el filtro", () => {
    const filtro = { ...BASE, tienda_id: ["t1", "t2"] };
    expect(recortarFiltroConteoEntregas(filtro, { tipo: "global" })).toEqual(filtro);
  });
});

/* -------------------------------------------------------------------------- */
/* El punto de entrada                                                         */
/* -------------------------------------------------------------------------- */

describe("prepararConteoEntregas — el orden de los pasos ES el contrato", () => {
  // Si el parseo fallara DESPUÉS del alcance, un filtro malformado serviría para sondear qué
  // puede ver un rol. Por eso un filtro roto es `validation_error` incluso sin sesión.
  it("un filtro malformado es `validation_error` aunque el actor no exista", () => {
    expect(prepararConteoEntregas({ rango: "trimestre" }, null, AHORA).status).toBe(
      "validation_error",
    );
  });

  it("sin actor y con filtro válido es `forbidden` por `sin_sesion`", () => {
    expect(prepararConteoEntregas({ rango: "semana" }, null, AHORA)).toMatchObject({
      status: "forbidden",
      motivo: "sin_sesion",
    });
  });

  it("pedir datos ajenos es `forbidden` por `filtro_fuera_de_alcance`", () => {
    expect(
      prepararConteoEntregas({ rango: "semana", tienda_id: ["t9"] }, actor("adminTienda"), AHORA),
    ).toMatchObject({ status: "forbidden", motivo: "filtro_fuera_de_alcance" });
  });

  it("el camino feliz devuelve filtro recortado, rango resuelto y alcance", () => {
    const preparada = prepararConteoEntregas({ rango: "dia" }, actor("adminTienda"), AHORA);

    expect(preparada.status).toBe("ok");
    if (preparada.status !== "ok") return;
    expect(preparada.consulta.filtro.tienda_id).toEqual(["u1"]);
    expect(preparada.consulta.alcance).toEqual({ tipo: "tienda", tiendaId: "u1" });
    // El rango se RESUELVE a fechas: el preset no llega al repositorio.
    expect(preparada.consulta.rango?.desdeFecha).toBe("2026-08-17");
    expect(preparada.consulta.rango?.hastaFecha).toBe("2026-08-17");
  });

  // Reloj inyectable: mismo `now`, mismo resultado. Sin esto, un test de esta función
  // dependería del día en que se ejecute.
  it("es determinista con el mismo `now`", () => {
    const a = prepararConteoEntregas({ rango: "mes" }, actor("maestro"), AHORA);
    const b = prepararConteoEntregas({ rango: "mes" }, actor("maestro"), AHORA);
    expect(a).toEqual(b);
  });
});

/* -------------------------------------------------------------------------- */
/* La clave de caché                                                           */
/* -------------------------------------------------------------------------- */

function consulta(
  filtro: FiltroConteoEntregas,
  alcance: ConsultaConteoEntregas["alcance"] = { tipo: "global" },
  now: Date = AHORA,
): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(filtro, actor("maestro"), now);
  if (preparada.status !== "ok") throw new Error("filtro de prueba inválido");
  return { ...preparada.consulta, filtro, alcance };
}

describe("Clave de caché del conteo", () => {
  // LA MÁS IMPORTANTE DEL ARCHIVO. Sin el alcance en la clave, la entrada que se cacheó para
  // un admin la sirve un adminTienda: no es una cifra equivocada, es una FUGA entre roles.
  it("dos alcances distintos NO comparten entrada", () => {
    const a = claveDeConteoEntregas(consulta(BASE, { tipo: "global" }));
    const b = claveDeConteoEntregas(consulta(BASE, { tipo: "tienda", tiendaId: "t1" }));
    const c = claveDeConteoEntregas(consulta(BASE, { tipo: "tienda", tiendaId: "t2" }));

    expect(new Set([a, b, c]).size).toBe(3);
  });

  // El preset NO entra, las fechas RESUELTAS sí: si `rango: "dia"` fuera la clave, durante
  // los 15 min del TTL la consulta de hoy devolvería el conteo de ayer.
  it("el mismo preset en dos días distintos da claves distintas", () => {
    const hoy = claveDeConteoEntregas(consulta({ rango: "dia" }, { tipo: "global" }, AHORA));
    const manana = claveDeConteoEntregas(
      consulta({ rango: "dia" }, { tipo: "global" }, new Date("2026-08-18T12:00:00.000Z")),
    );
    expect(hoy).not.toBe(manana);
  });

  // «Sin ventana» tiene entrada PROPIA. Si compartiera la de un rango concreto, la primera
  // visita sin filtrar serviría —durante 15 min— la cifra recortada de quien filtró antes.
  it("«sin rango» no comparte entrada con ninguna ventana concreta", () => {
    const sinVentana = claveDeConteoEntregas(consulta({}));
    const dia = claveDeConteoEntregas(consulta({ rango: "dia" }));
    // `mes` y no `semana`: `AHORA` cae en lunes, así que la semana CR y el día CR resuelven
    // a las MISMAS fechas y compartir clave sería lo correcto. Se compara contra una ventana
    // que de verdad es distinta.
    const mes = claveDeConteoEntregas(consulta({ rango: "mes" }));

    expect(new Set([sinVentana, dia, mes]).size).toBe(3);
  });

  // Y es ESTABLE en el tiempo, al revés que la de un preset: sin ventana no hay fecha que
  // resolver, así que la entrada de hoy sirve mañana.
  it("la clave sin rango no cambia de un día para otro", () => {
    const hoy = claveDeConteoEntregas(consulta({}, { tipo: "global" }, AHORA));
    const manana = claveDeConteoEntregas(
      consulta({}, { tipo: "global" }, new Date("2026-08-18T12:00:00.000Z")),
    );
    expect(hoy).toBe(manana);
  });

  it("es insensible al ORDEN de una lista y a sus repetidos", () => {
    const a = claveDeConteoEntregas(consulta({ ...BASE, zona_id: ["z2", "z1", "z2"] }));
    const b = claveDeConteoEntregas(consulta({ ...BASE, zona_id: ["z1", "z2"] }));
    expect(a).toBe(b);
  });

  it("distingue «sin filtrar» de cualquier filtro concreto en las seis dimensiones", () => {
    const base = claveDeConteoEntregas(consulta(BASE));
    for (const clave of [
      "zona_id",
      "provincia_id",
      "canton_id",
      "distrito_id",
      "tienda_id",
      "mensajero_id",
    ] as const) {
      const conFiltro = claveDeConteoEntregas(consulta({ ...BASE, [clave]: ["x1"] }));
      expect(conFiltro, clave).not.toBe(base);
    }
  });

  // La mutación que mata: concatenar sin separador. `{zona:["a"],provincia:["b"]}` y
  // `{zona:["ab"]}` acabarían en la misma entrada.
  it("dos repartos distintos de los mismos ids no colapsan en una clave", () => {
    const a = claveDeConteoEntregas(consulta({ ...BASE, zona_id: ["a"], provincia_id: ["b"] }));
    const b = claveDeConteoEntregas(consulta({ ...BASE, zona_id: ["ab"] }));
    expect(a).not.toBe(b);
  });
});
