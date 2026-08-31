import { describe, it, expect, vi, beforeEach } from "vitest";
import * as filtros from "@/lib/analytics/filters";
import * as rangos from "@/lib/analytics/ranges";
import * as alcances from "@/lib/analytics/alcance";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica, PreparacionAnalitica } from "@/lib/analytics/consulta";
import type { AnaliticaFiltroInput } from "@/lib/analytics/filters";
import type { ActorAnalitica } from "@/lib/analytics/alcance";

// Feature 122 / T4.1-T4.5 — EL PUNTO DE ENTRADA: R15, R16, R17, R19, R20, R21, R32, R41.
//
// Aqui se prueba la garantia entera: que el orden no se puede invertir, que el filtro del
// cliente no puede ampliar el alcance, que pedir datos ajenos es un 403 explicito y que el
// valor consultable no se puede fabricar sin pasar por aqui.

vi.mock("@/lib/analytics/filters", async (importOriginal) => {
  const original = await importOriginal<typeof filtros>();
  return { ...original, parseAnaliticaFiltro: vi.fn(original.parseAnaliticaFiltro) };
});
vi.mock("@/lib/analytics/ranges", async (importOriginal) => {
  const original = await importOriginal<typeof rangos>();
  return { ...original, resolverRango: vi.fn(original.resolverRango) };
});
vi.mock("@/lib/analytics/alcance", async (importOriginal) => {
  const original = await importOriginal<typeof alcances>();
  return { ...original, resolverAlcance: vi.fn(original.resolverAlcance) };
});

const parseEspia = vi.mocked(filtros.parseAnaliticaFiltro);
const rangoEspia = vi.mocked(rangos.resolverRango);
const alcanceEspia = vi.mocked(alcances.resolverAlcance);

const AHORA = new Date("2026-07-31T15:00:00.000Z");
const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const TIENDA: ActorAnalitica = { usuarioId: "tienda-propia", rol: "adminTienda" };
const SATELITE: ActorAnalitica = { usuarioId: "u-sat", rol: "adminSatelite", zonaId: "z-propia" };
const MENSAJERO: ActorAnalitica = { usuarioId: "m-propio", rol: "mensajero" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("R15 · un unico punto de entrada con orden fijo: parsear -> rango -> alcance", () => {
  it("parsea antes de resolver el rango y el rango antes que el alcance", () => {
    const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "entregas", AHORA);

    expect(r.status).toBe("ok");
    expect(parseEspia).toHaveBeenCalledTimes(1);
    expect(rangoEspia).toHaveBeenCalledTimes(1);
    expect(alcanceEspia).toHaveBeenCalledTimes(1);

    const [orden1] = parseEspia.mock.invocationCallOrder;
    const [orden2] = rangoEspia.mock.invocationCallOrder;
    const [orden3] = alcanceEspia.mock.invocationCallOrder;
    expect(orden1).toBeLessThan(orden2);
    expect(orden2).toBeLessThan(orden3);
  });

  it("el resolutor recibe el actor, el id de metrica y el canal, nunca el filtro crudo", () => {
    prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "entregas", AHORA);
    // Feature 267: el quinto parametro `canal` se REENVIA tal cual y su default es
    // `"interno"`, de modo que el canal de sesion llama exactamente como antes (267/R43).
    // Lo que este caso protege sigue siendo lo mismo: el filtro crudo NO viaja al resolutor.
    expect(alcanceEspia).toHaveBeenCalledWith(MAESTRO, "entregas", "interno");
  });

  it("el canal que se le pasa a prepararConsultaAnalitica llega intacto al resolutor (267/R6)", () => {
    prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "entregas", AHORA, "api_key");
    expect(alcanceEspia).toHaveBeenCalledWith(MAESTRO, "entregas", "api_key");
  });

  it("no existe funcion publica que devuelva un filtro parseado sin alcance resuelto", async () => {
    const modulo = await import("@/lib/analytics/consulta");
    expect(Object.keys(modulo)).toEqual(["prepararConsultaAnalitica"]);
  });
});

describe("R19 · filtro invalido => validation_error, y el alcance NI SE PREGUNTA", () => {
  it("una clave desconocida devuelve validation_error con fieldErrors bajo su propio nombre", () => {
    const r = prepararConsultaAnalitica({ rango: "dia", rol: "maestro" }, TIENDA, "entregas", AHORA);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("rol");
    expect(alcanceEspia).not.toHaveBeenCalled();
  });

  it("un rango invalido devuelve validation_error y tampoco resuelve alcance", () => {
    const r = prepararConsultaAnalitica(
      { rango: "personalizado", desde: "2026-07-31" },
      TIENDA,
      "entregas",
      AHORA,
    );
    expect(r.status).toBe("validation_error");
    expect(alcanceEspia).not.toHaveBeenCalled();
  });

  it("una entrada invalida NO revela si la metrica existe ni que ve el rol", () => {
    const inexistente = prepararConsultaAnalitica({ rango: "no_valido" }, TIENDA, "no_existe", AHORA);
    const prohibida = prepararConsultaAnalitica({ rango: "no_valido" }, TIENDA, "egresos", AHORA);
    expect(inexistente.status).toBe("validation_error");
    expect(prohibida.status).toBe("validation_error");
    expect(JSON.stringify(inexistente)).toBe(JSON.stringify(prohibida));
  });
});

describe("R20 · el alcance interseca el filtro del cliente; el filtro no puede ampliarlo", () => {
  it("adminTienda con [propia, ajena] conserva SOLO la propia", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", tienda_id: ["tienda-propia", "tienda-ajena"] },
      TIENDA,
      "entregas",
      AHORA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.filtro.tienda_id).toEqual(["tienda-propia"]);
  });

  it("sin filtro de la dimension recortada, el recorte se ESCRIBE igualmente en el filtro", () => {
    const r = prepararConsultaAnalitica({ rango: "dia" }, SATELITE, "entregas", AHORA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.filtro.zona_id).toEqual(["z-propia"]);
    expect(r.consulta.alcance).toEqual({ tipo: "zona", zonaId: "z-propia" });
  });

  it("un maestro (alcance global) conserva su filtro tal cual, sin recorte inventado", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", tienda_id: ["t1", "t2"] },
      MAESTRO,
      "entregas",
      AHORA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.filtro.tienda_id).toEqual(["t1", "t2"]);
    expect(r.consulta.alcance).toEqual({ tipo: "global" });
  });

  it("el filtro de OTRAS dimensiones no se toca: el recorte es de una sola dimension", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", zona_id: ["z1", "z2"] },
      TIENDA,
      "entregas",
      AHORA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.filtro.zona_id).toEqual(["z1", "z2"]);
    expect(r.consulta.filtro.tienda_id).toEqual(["tienda-propia"]);
  });
});

describe("R21 · pedir datos ajenos es 403 explicito, no un conjunto vacio (D1)", () => {
  it("adminTienda que pide SOLO una tienda ajena => forbidden/filtro_fuera_de_alcance", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", tienda_id: ["tienda-ajena"] },
      TIENDA,
      "entregas",
      AHORA,
    );
    expect(r).toEqual({ status: "forbidden", motivo: "filtro_fuera_de_alcance" });
  });

  it("adminSatelite que pide una zona ajena => forbidden, nunca ok con lista vacia", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", zona_id: ["z-ajena"] },
      SATELITE,
      "entregas",
      AHORA,
    );
    expect(r.status).toBe("forbidden");
    expect(JSON.stringify(r)).not.toContain('"consulta"');
  });

  it("mensajero que pide las ordenes de otro mensajero => forbidden", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", mensajero_id: ["m-ajeno"] },
      MENSAJERO,
      "entregas",
      AHORA,
    );
    expect(r).toEqual({ status: "forbidden", motivo: "filtro_fuera_de_alcance" });
  });

  it("mensajero que pide el cubo sin_asignar => forbidden: esas ordenes no son suyas (R28)", () => {
    const r = prepararConsultaAnalitica(
      { rango: "dia", mensajero_id: ["sin_asignar"] },
      MENSAJERO,
      "entregas",
      AHORA,
    );
    expect(r).toEqual({ status: "forbidden", motivo: "filtro_fuera_de_alcance" });
  });
});

describe("R41 · el denegado es un estado propio, nunca ok con datos vacios (D7)", () => {
  it("la union de PreparacionAnalitica incluye forbidden con motivo y no un ok vacio", () => {
    const denegado = prepararConsultaAnalitica({ rango: "dia" }, TIENDA, "egresos", AHORA);
    expect(denegado).toEqual({ status: "forbidden", motivo: "metrica_prohibida" });

    // La forma del resultado no admite `data`, `items` ni `filas`: no hay donde devolver
    // una lista vacia disfrazada de exito.
    const estados = new Set<PreparacionAnalitica["status"]>(["ok", "validation_error", "forbidden"]);
    expect(estados.has(denegado.status)).toBe(true);
    expect(Object.keys(denegado).sort()).toEqual(["motivo", "status"]);
  });

  it("cada motivo de denegacion llega intacto al borde para que pueda distinguirlos", () => {
    const casos: [ActorAnalitica | null, string, string][] = [
      [null, "entregas", "sin_sesion"],
      [{ usuarioId: "u", rol: "apiKey" }, "entregas", "rol_sin_analitica"],
      [{ usuarioId: "u", rol: "inventado" }, "entregas", "rol_desconocido"],
      [{ usuarioId: "u", rol: "adminSatelite", zonaId: null }, "entregas", "sin_zona_asignada"],
      [MAESTRO, "no_existe", "metrica_desconocida"],
      [TIENDA, "egresos", "metrica_prohibida"],
    ];
    for (const [actor, metricaId, motivo] of casos) {
      const r = prepararConsultaAnalitica({ rango: "dia" }, actor, metricaId, AHORA);
      expect(r, `${String(actor?.rol)}/${metricaId}`).toEqual({ status: "forbidden", motivo });
    }
  });
});

describe("R32 · determinismo: mismo `now`, mismo resultado", () => {
  it("dos invocaciones con el mismo now dan un resultado identico", () => {
    const entrada = { rango: "mes" as const, tienda_id: ["tienda-propia"] };
    const a = prepararConsultaAnalitica(entrada, TIENDA, "entregas", AHORA);
    const b = prepararConsultaAnalitica(entrada, TIENDA, "entregas", AHORA);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("el instante se inyecta: dos `now` distintos dan rangos distintos", () => {
    const otro = new Date("2026-06-15T15:00:00.000Z");
    const a = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "entregas", AHORA);
    const b = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "entregas", otro);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(a.consulta.rango.desdeFecha).not.toBe(b.consulta.rango.desdeFecha);
  });
});

describe("R16/R17 · el valor consultable no se puede fabricar ni sustituir (tests de tipos)", () => {
  it("un literal con los cuatro campos NO es asignable a ConsultaAnalitica", () => {
    const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, "entregas", AHORA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;

    // @ts-expect-error — falta la marca (`unique symbol` no exportado): nadie fuera del
    // modulo puede construir una consulta preparada a mano.
    const falsificada: ConsultaAnalitica = {
      metrica: r.consulta.metrica,
      filtro: r.consulta.filtro,
      rango: r.consulta.rango,
      alcance: r.consulta.alcance,
      politicaIdentidad: r.consulta.politicaIdentidad,
    };
    expect(falsificada.alcance).toEqual({ tipo: "global" });
  });

  it("una firma de repositorio no acepta el filtro parseado suelto en vez de la consulta", () => {
    const repositorioSimulado = (consulta: ConsultaAnalitica): string => consulta.metrica.id;
    const filtroSuelto = { rango: "dia" } as AnaliticaFiltroInput;

    // @ts-expect-error — R17: omitir el recorte es un error de COMPILACION, no un olvido
    // silencioso; el filtro suelto no tiene de donde sacar el alcance.
    expect(() => repositorioSimulado(filtroSuelto)).toThrow();
  });

  it("el unico camino legitimo produce el valor opaco con su alcance dentro", () => {
    const r = prepararConsultaAnalitica({ rango: "dia" }, TIENDA, "entregas", AHORA);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const consulta: ConsultaAnalitica = r.consulta;
    expect(consulta.alcance).toEqual({ tipo: "tienda", tiendaId: "tienda-propia" });
    expect(consulta.metrica.id).toBe("entregas");
    expect(consulta.rango.preset).toBe("dia");
  });
});

// ---------------------------------------------------------------------------
// Feature 267 (T4) — LA POLITICA DE IDENTIDAD FALLA CERRADO.
//
// Hasta hoy el fallback de `politicaIdentidadDe` devolvia `"real"` y se documentaba como
// inalcanzable, porque el unico camino hasta ahi eran los cinco roles lectores. Con la
// concesion al canal por API key ese camino deja de ser hipotetico: un rol que el modulo no
// sepa clasificar acabaria repartiendo identidades reales de mensajero por un canal EXTERNO.
// Estos dos casos son los que se pondrian rojos si alguien devolviera el fallback a `"real"`.
// ---------------------------------------------------------------------------

describe("267/R35 · el canal por API key consulta siempre con politica seudonima", () => {
  const INTEGRADOR: ActorAnalitica = { usuarioId: "u-integrador", rol: "apiKey" };

  it("una consulta preparada para un actor apiKey lleva politicaIdentidad seudonima", () => {
    const r = prepararConsultaAnalitica({ rango: "dia" }, INTEGRADOR, "entregas", AHORA, "api_key");

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.politicaIdentidad).toBe("seudonima");
    // Y su recorte sigue siendo el de SU propia tienda: la politica no sustituye al alcance.
    expect(r.consulta.alcance).toEqual({ tipo: "tienda", tiendaId: "u-integrador" });
  });

  it("el mismo actor por el canal interno ni siquiera produce consulta (267/R6)", () => {
    const r = prepararConsultaAnalitica({ rango: "dia" }, INTEGRADOR, "entregas", AHORA);
    expect(r.status).toBe("forbidden");
  });
});

describe("267/R38 · el fallback de politica de identidad es seudonima, no real", () => {
  it("un actor con rol basura al que se le concediera alcance NO obtiene politica real", () => {
    // El rol basura lo deniega `resolverAlcance` antes de llegar al fallback, asi que se
    // fuerza la concesion sobre el espia que este archivo ya monta: lo que se prueba es
    // EXACTAMENTE la rama que quedaria expuesta si esa denegacion cambiara o se saltara.
    alcanceEspia.mockReturnValueOnce({ estado: "ok", alcance: { tipo: "global" } });
    const basura: ActorAnalitica = { usuarioId: "u-x", rol: "rol-que-nadie-mapeo" };

    const r = prepararConsultaAnalitica({ rango: "dia" }, basura, "entregas", AHORA);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.politicaIdentidad).not.toBe("real");
    expect(r.consulta.politicaIdentidad).toBe("seudonima");
  });

  it("sin actor, tampoco: la ausencia de actor es el caso menos clasificable de todos", () => {
    alcanceEspia.mockReturnValueOnce({ estado: "ok", alcance: { tipo: "global" } });

    const r = prepararConsultaAnalitica({ rango: "dia" }, null, "entregas", AHORA);

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.politicaIdentidad).toBe("seudonima");
  });

  it("los cinco roles lectores conservan su politica de siempre (267/R43)", () => {
    const casos: ReadonlyArray<readonly [ActorAnalitica, string]> = [
      [MAESTRO, "real"],
      [SATELITE, "real"],
      [MENSAJERO, "real"],
      [TIENDA, "seudonima"],
      [{ usuarioId: "u-admin", rol: "admin" }, "real"],
    ];

    for (const [actor, esperada] of casos) {
      const r = prepararConsultaAnalitica({ rango: "dia" }, actor, "entregas", AHORA);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") continue;
      expect(r.consulta.politicaIdentidad).toBe(esperada);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2026-08-31 — EL TOPE DE VENTANA (`RANGO_TOPE_DIAS`) DEPENDE DEL CANAL, y es la UNICA
// diferencia de validacion entre los dos. El canal interno lo conserva porque su consumidor es
// una grafica con techo de puntos; el canal por API key lo pierde porque publica el HISTORICO
// COMPLETO, que deja de caber en 366 dias en cuanto la operacion pasa del anio.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("el tope de ventana es del canal interno, no del canal por API key", () => {
  const LARGO = { rango: "personalizado", desde: "2024-01-01", hasta: "2026-08-01" } as const;
  /** La cuenta dedicada de una key: el UNICO actor al que el canal `api_key` concede (267/R1). */
  const INTEGRADOR: ActorAnalitica = { usuarioId: "u-integrador", rol: "apiKey" };

  it("canal interno (el default): una ventana de mas de 366 dias es validation_error", () => {
    const r = prepararConsultaAnalitica(LARGO, MAESTRO, "entregas", AHORA);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("hasta");
  });

  it("canal api_key: la MISMA ventana se acepta", () => {
    const r = prepararConsultaAnalitica(LARGO, INTEGRADOR, "entregas", AHORA, "api_key");

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.consulta.rango.desdeFecha).toBe("2024-01-01");
    expect(r.consulta.rango.hastaFecha).toBe("2026-08-01");
  });

  it("y en api_key el rango INVERTIDO sigue siendo validation_error: cae el techo, no la coherencia", () => {
    const r = prepararConsultaAnalitica(
      { rango: "personalizado", desde: "2026-08-10", hasta: "2024-01-01" },
      INTEGRADOR,
      "entregas",
      AHORA,
      "api_key",
    );

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("hasta");
  });
});
