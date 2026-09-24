import { describe, it, expect, vi } from "vitest";
import { ApiHabilitacionService } from "@/lib/services/ApiHabilitacionService";
import type { OrdenRepoParaHabilitacionApi } from "@/lib/services/ApiHabilitacionService";
import type {
  IOrdenHabilitacionApiRepository,
  RegistrarHabilitacionApiInput,
} from "@/lib/interfaces/repositories/IOrdenHabilitacionApiRepository";
import type { OrdenParaHabilitacionApi } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { FilaHabilitacionInput } from "@/lib/interfaces/services/IApiHabilitacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { TOPE_CARACTERES_NOTA_HABILITAR } from "@/lib/config/habilitacion-api";

// Feature 266 (T4.2/T4.3) — el service de HABILITACION POR LOTE del canal por API key, con repos
// falsos. Aqui vive la mayor parte de la trazabilidad de la ficha.
//
// ⚠️ D1 (puerta del 2026-08-23): los estados habilitables son `ayuda_tienda` y `devuelta`, y
// `reprogramada` QUEDA FUERA. Y como una `devuelta` esta SIEMPRE desasignada, el unico caso que
// podia volver a `en_reparto` era `ayuda_tienda`.
//
// ⏳ 2026-09-23 (FICHA 454, T1.15, R24) — LA AYUDA DEJA DE SER ESTADO. «En ayuda» es ahora la
// derivacion `ayudaAbierta` sobre una orden que SIGUE `en_reparto`. La rama A ya no transiciona:
// registra el hecho `ayuda_habilitada_api` (`registrarAyudaResuelta`, guardado por «ayuda abierta»
// bajo candado) y la fila de bitacora con `cambioDeEstado: false`, y responde como hasta hoy
// —`habilitada` + `estado: en_reparto`, el discriminador que el integrador ya lee y que la
// caracterizacion C22 fija como invariante— GANANDO la clave `ayudaCerrada: true` (design §4.2,
// R24/R36). Sin catalogo que resolver, el fallo cerrado de R19 (266) desaparece. Lo que NO cambia: el owner opaco, R7/R8, la guarda del
// llamador, el orden hecho -> bitacora y el punto unico de escritura.

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

/** Una orden tal como la devuelve `findParaHabilitacionApi` (los campos del discriminador). */
function orden(
  estatusValue: string,
  mensajeroAsignadoId: string | null,
  id = "o1",
  ayudaAbierta = false,
): OrdenParaHabilitacionApi {
  return { id, estatusValue, mensajeroAsignadoId, ayudaAbierta };
}

/** FICHA 454: la orden «en ayuda» — `en_reparto` con la ayuda ABIERTA. */
function enAyuda(mensajeroAsignadoId: string | null, id = "o1"): OrdenParaHabilitacionApi {
  return orden("en_reparto", mensajeroAsignadoId, id, true);
}

function fila(num_guia: unknown, nota: unknown = "el cliente pidio reintento"): FilaHabilitacionInput {
  return { num_guia, nota };
}

interface ResueltaInput {
  ordenId: string;
  tipo: "ayuda_rescatada" | "ayuda_habilitada_api";
  actorUsuarioId: string;
  actorRol: string;
}

/**
 * Los dos dobles. El del repo de ordenes esta TIPADO como el `Pick` del constructor (design
 * §4.4): declararle otro metodo de escritura no compilaria, que es la mitad estructural del
 * assert de T4.3.
 */
function build(ordenes: (OrdenParaHabilitacionApi | null)[] = []) {
  const findParaHabilitacionApi = vi.fn(async (numGuia: number, ownerId: string) => {
    void numGuia;
    void ownerId;
    return ordenes.shift() ?? null;
  });
  const registrarAyudaResuelta = vi.fn(async (input: ResueltaInput) => {
    void input;
    return true;
  });
  const ordenRepo: OrdenRepoParaHabilitacionApi = {
    findParaHabilitacionApi,
    registrarAyudaResuelta,
  };
  const registrar = vi.fn(async (input: RegistrarHabilitacionApiInput) => {
    void input;
  });
  const logRepo: IOrdenHabilitacionApiRepository = { registrar };
  const service = new ApiHabilitacionService(ordenRepo, logRepo);
  return {
    service,
    ordenRepo,
    findParaHabilitacionApi,
    registrarAyudaResuelta,
    registrar,
  };
}

// =================================================================================================
// OWNER Y ALCANCE
// =================================================================================================
describe("266/R3-R4 — el owner sale del actor y una guia ajena es opaca", () => {
  it("busca la orden con el usuario de la key como owner, y no con ningun id del cuerpo", async () => {
    const { service, findParaHabilitacionApi } = build([orden("devuelta", null)]);
    await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(findParaHabilitacionApi).toHaveBeenCalledWith(100234, "store-1"); // R3
  });

  it("cuando no hay orden viva del owner con esa guia, la fila falla y no se escribe nada", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([null]);
    const res = await service.habilitarLote(ACTOR, [fila(999999)]);
    expect(res.resultados[0]).toEqual({
      numGuia: 999999,
      resultado: "error",
      estado: null,
      ayudaCerrada: false,
      error: { codigo: "no_encontrada", mensaje: expect.any(String) },
    });
    expect(registrarAyudaResuelta).not.toHaveBeenCalled(); // R4: cero escrituras
    expect(registrar).not.toHaveBeenCalled();
  });

  it("R4: MISMA GUIA, OTRA TIENDA — responde `no_encontrada`, igual que si la guia no existiera", async () => {
    // La OPACIDAD es deliberada: si «no existe» y «es de otra tienda» se distinguieran, el endpoint
    // seria un oraculo con el que barrer el rango de guias. El scope va en el `where` del repo, asi
    // que la orden ajena NUNCA llega al service.
    const ajena = build([null]); // el repo, scoped por owner, no la ve
    const inexistente = build([null]);
    const resAjena = await ajena.service.habilitarLote(ACTOR, [fila(100234)]);
    const resInexistente = await inexistente.service.habilitarLote(ACTOR, [fila(999999)]);

    expect(ajena.findParaHabilitacionApi).toHaveBeenCalledWith(100234, "store-1");
    expect(resAjena.resultados[0]).toEqual({
      numGuia: 100234,
      resultado: "error",
      estado: null,
      ayudaCerrada: false,
      error: { codigo: "no_encontrada", mensaje: expect.any(String) },
    });
    expect(resAjena.resultados[0].error).toEqual(resInexistente.resultados[0].error);
    expect(resAjena.resultados[0].error?.mensaje).not.toMatch(/tienda|otro|ajen|permiso|autoriz/i);
    expect(ajena.registrarAyudaResuelta).not.toHaveBeenCalled();
    expect(ajena.registrar).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// VALIDACION POR FILA (R7) Y DUPLICADOS (R8)
// =================================================================================================
describe("266/R7 — una fila mal formada se marca sola y no tumba el lote", () => {
  it.each([
    ["num_guia no entero", fila(12.5)],
    ["num_guia negativo", fila(-3)],
    ["num_guia como texto", fila("100234")],
    ["num_guia ausente", fila(undefined)],
    ["nota vacia tras recortar espacios", fila(100234, "   ")],
    ["nota que no es texto", fila(100234, 42)],
    ["nota de 201 caracteres", fila(100234, "x".repeat(TOPE_CARACTERES_NOTA_HABILITAR + 1))],
  ])("%s -> error/fila_invalida sin tocar la base", async (_caso, mala) => {
    const { service, findParaHabilitacionApi, registrar } = build();
    const res = await service.habilitarLote(ACTOR, [mala]);
    expect(res.resultados[0].resultado).toBe("error");
    expect(res.resultados[0].error?.codigo).toBe("fila_invalida");
    expect(findParaHabilitacionApi).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it("una nota de exactamente 200 caracteres SI se acepta (el tope es inclusivo)", async () => {
    const { service, registrar } = build([orden("devuelta", null)]);
    const nota = "x".repeat(TOPE_CARACTERES_NOTA_HABILITAR);
    const res = await service.habilitarLote(ACTOR, [fila(100234, nota)]);
    expect(res.resultados[0].resultado).toBe("habilitada_sin_cambio_de_estado");
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ nota }));
  });

  it("la nota se persiste RECORTADA, no como llego", async () => {
    const { service, registrar } = build([orden("devuelta", null)]);
    await service.habilitarLote(ACTOR, [fila(100234, "  direccion corregida  ")]);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ nota: "direccion corregida" }),
    );
  });

  it("las filas SANAS del mismo lote se procesan igual que si la mala no existiera", async () => {
    // R7 + R9: la promesa de «nunca un 4xx global que tire el lote entero», afirmada.
    const { service, registrar } = build([orden("devuelta", null), orden("devuelta", null, "o3")]);
    const res = await service.habilitarLote(ACTOR, [fila(1), fila(0), fila(3)]);
    expect(res.resultados.map((r) => r.resultado)).toEqual([
      "habilitada_sin_cambio_de_estado",
      "error",
      "habilitada_sin_cambio_de_estado",
    ]);
    expect(registrar).toHaveBeenCalledTimes(2);
  });
});

describe("266/R8 — la misma guia repetida en el lote solo se procesa la primera vez", () => {
  it("la segunda aparicion devuelve duplicada_en_lote y no vuelve a registrar nada", async () => {
    const { service, registrar, findParaHabilitacionApi } = build([orden("devuelta", null)]);
    const res = await service.habilitarLote(ACTOR, [fila(100234, "una"), fila(100234, "otra")]);
    expect(res.resultados[0].resultado).toBe("habilitada_sin_cambio_de_estado");
    expect(res.resultados[1]).toMatchObject({
      resultado: "error",
      error: { codigo: "duplicada_en_lote" },
    });
    expect(registrar).toHaveBeenCalledTimes(1); // R8: una sola escritura
    expect(findParaHabilitacionApi).toHaveBeenCalledTimes(1); // ni siquiera se relee
  });
});

// =================================================================================================
// FORMA DE LA RESPUESTA (R9/R10/R11)
// =================================================================================================
describe("266/R11 — la salida conserva orden y cardinalidad de la entrada", () => {
  it("tres filas de entrada devuelven tres resultados, en el mismo orden y con su guia", async () => {
    const { service } = build([orden("devuelta", null), null, enAyuda("m1", "o3")]);
    const res = await service.habilitarLote(ACTOR, [fila(11), fila(22), fila(33)]);
    expect(res.resultados).toHaveLength(3);
    expect(res.resultados.map((r) => r.numGuia)).toEqual([11, 22, 33]);
    expect(res.resultados.map((r) => r.resultado)).toEqual([
      "habilitada_sin_cambio_de_estado",
      "error",
      "habilitada",
    ]);
    expect(res.resultados.map((r) => r.ayudaCerrada)).toEqual([false, false, true]);
  });
});

describe("266/R9-R10 — el resumen cuadra y el estado viaja en los dos desenlaces de exito", () => {
  it("total = habilitadas + habilitadasSinCambioDeEstado + conError, con un lote de los tres tipos", async () => {
    const { service } = build([enAyuda("m1"), orden("devuelta", null, "o2"), null]);
    const res = await service.habilitarLote(ACTOR, [fila(11), fila(22), fila(33)]);
    expect(res.resumen).toEqual({
      total: 3,
      habilitadas: 1,
      habilitadasSinCambioDeEstado: 1,
      conError: 1,
    });
    const { total, habilitadas, habilitadasSinCambioDeEstado, conError } = res.resumen;
    expect(total).toBe(habilitadas + habilitadasSinCambioDeEstado + conError);
  });

  it("las dos filas de exito llevan `estado` poblado y la fila con error lo lleva en null", async () => {
    const { service } = build([enAyuda("m1"), orden("devuelta", null, "o2"), null]);
    const res = await service.habilitarLote(ACTOR, [fila(11), fila(22), fila(33)]);
    expect(res.resultados[0].estado).toBe("en_reparto");
    expect(res.resultados[1].estado).toBe("devuelta");
    expect(res.resultados[2].estado).toBeNull();
    expect(res.resultados[2].error).not.toBeNull();
  });
});

// =================================================================================================
// EL DISCRIMINADOR (R12) Y LAS DOS RAMAS
// =================================================================================================
describe("266/R12-R16 → 454/R24 — rama A: ayuda ABIERTA con mensajero: se cierra la ayuda", () => {
  it("registra UNA vez el cierre de la ayuda, por el punto unico, y responde `habilitada` + `ayudaCerrada`", async () => {
    const { service, registrarAyudaResuelta } = build([enAyuda("m1")]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(registrarAyudaResuelta).toHaveBeenCalledTimes(1);
    expect(registrarAyudaResuelta).toHaveBeenCalledWith({
      ordenId: "o1",
      tipo: "ayuda_habilitada_api", // R24: su propio tipo de evento, distinto del rescate
      actorUsuarioId: "store-1", // R3: el owner de la key
      actorRol: "apiKey",
    });
    expect(res.resultados[0]).toEqual({
      numGuia: 100234,
      resultado: "habilitada",
      estado: "en_reparto",
      ayudaCerrada: true,
      error: null,
    });
  });

  it("D6: la entrada del registro NO lleva `motivo` — la nota vive SOLO en la bitacora", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([enAyuda("m1")]);
    await service.habilitarLote(ACTOR, [fila(100234, "el cliente pidio reintento")]);
    const entrada = registrarAyudaResuelta.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(entrada)).not.toContain("motivo");
    expect(JSON.stringify(entrada)).not.toContain("reintento");
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ nota: "el cliente pidio reintento" }),
    );
  });
});

describe("266/R12-R22 — rama B: el paquete ya esta en bodega, solo se deja log", () => {
  it("ayuda abierta SIN mensajero asignado no cierra la ayuda: es rama B (defensa)", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([enAyuda(null)]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(registrarAyudaResuelta).not.toHaveBeenCalled(); // R20
    expect(res.resultados[0].resultado).toBe("habilitada_sin_cambio_de_estado");
    expect(res.resultados[0].ayudaCerrada).toBe(false);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ cambioDeEstado: false, estadoResultante: "en_reparto" }),
    );
  });

  it("R14-b: una `devuelta` cae SIEMPRE en rama B y NUNCA se manda a `en_reparto`", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([orden("devuelta", null)]);
    const res = await service.habilitarLote(ACTOR, [fila(100234, "reintento pactado")]);
    expect(registrarAyudaResuelta).not.toHaveBeenCalled();
    expect(res.resultados[0]).toEqual({
      numGuia: 100234,
      resultado: "habilitada_sin_cambio_de_estado",
      estado: "devuelta",
      ayudaCerrada: false,
      error: null,
    });
    expect(registrar).toHaveBeenCalledWith({
      ordenId: "o1",
      actorUsuarioId: "store-1",
      nota: "reintento pactado",
      cambioDeEstado: false, // R21
      estadoResultante: "devuelta",
    });
  });
});

// =================================================================================================
// LA GUARDA DE ESTADO, ATACADA DIRECTAMENTE (R13/R13-b/R14/R31)
// =================================================================================================
describe("266/R13-R14 — la guarda de estado del llamador rechaza lo que no es habilitable", () => {
  it("R13-b: `reprogramada` NO es habilitable — ni escribe nada ni deja registro", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([orden("reprogramada", "m1")]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(res.resultados[0]).toMatchObject({
      resultado: "error",
      estado: null,
      error: { codigo: "estado_no_habilitable" },
    });
    expect(registrarAyudaResuelta).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it.each(["entregada", "rechazada", "en_reparto", "incidente", "sin_gestionar"])(
    "una orden en `%s` SIN ayuda abierta devuelve estado_no_habilitable sin escribir nada",
    async (estado) => {
      // ATAQUE DIRECTO a la guarda: es la PRIMERA red y vive en este service. Con mensajero
      // asignado a proposito, para que ni siquiera el discriminador de rama pueda salvarla.
      const { service, registrarAyudaResuelta, registrar } = build([orden(estado, "m1")]);
      const res = await service.habilitarLote(ACTOR, [fila(100234)]);
      expect(res.resultados[0].error?.codigo).toBe("estado_no_habilitable");
      expect(registrarAyudaResuelta).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    },
  );

  it("R31/D3: habilitar por segunda vez (ayuda ya cerrada) devuelve error, JAMAS un exito", async () => {
    // Un acuse falso es peor que un error honesto. Tras la primera habilitacion la orden sigue
    // `en_reparto` y la ayuda esta CERRADA: la guarda la rechaza.
    const { service, registrarAyudaResuelta, registrar } = build([orden("en_reparto", "m1")]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(res.resultados[0].resultado).toBe("error");
    expect(res.resultados[0].error?.codigo).toBe("estado_no_habilitable");
    expect(res.resumen).toEqual({
      total: 1,
      habilitadas: 0,
      habilitadasSinCambioDeEstado: 0,
      conError: 1,
    });
    expect(registrarAyudaResuelta).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// CARRERA (R18/R25)
// =================================================================================================
describe("266/R18-R25 — si la ayuda se cerro entre la lectura y la escritura, no queda nada a medias", () => {
  it("`registrarAyudaResuelta` que devuelve false da estado_no_habilitable y NO deja bitacora", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([enAyuda("m1")]);
    registrarAyudaResuelta.mockResolvedValue(false); // la re-lectura bajo candado no la vio abierta
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(res.resultados[0].error?.codigo).toBe("estado_no_habilitable");
    expect(res.resultados[0].ayudaCerrada).toBe(false);
    expect(registrar).not.toHaveBeenCalled(); // R25: sin hecho confirmado, sin registro
  });
});

describe("266/R23-R25 — la bitacora se escribe DESPUES del hecho, nunca antes", () => {
  it("en la rama A, `registrar` ocurre despues del cierre de la ayuda y con cambioDeEstado false", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([enAyuda("m1")]);
    await service.habilitarLote(ACTOR, [fila(100234, "reintento")]);
    expect(registrarAyudaResuelta.mock.invocationCallOrder[0]).toBeLessThan(
      registrar.mock.invocationCallOrder[0],
    );
    // ⏳ 2026-09-23 (FICHA 454, R24): antes `cambioDeEstado: true` (la orden volvia a `en_reparto`).
    expect(registrar).toHaveBeenCalledWith({
      ordenId: "o1",
      actorUsuarioId: "store-1",
      nota: "reintento",
      cambioDeEstado: false,
      estadoResultante: "en_reparto",
    });
  });
});

// =================================================================================================
// T4.3 — EL PUNTO UNICO DE ESCRITURA, AFIRMADO POR TIPOS + LLAMADA (nunca por un `grep`)
// =================================================================================================
describe("266/R15 (T4.3) — toda escritura pasa por `registrarAyudaResuelta`, una por fila", () => {
  it("un lote de 3 filas de rama A invoca `registrarAyudaResuelta` exactamente 3 veces", async () => {
    const { service, registrarAyudaResuelta, registrar } = build([
      enAyuda("m1", "o1"),
      enAyuda("m2", "o2"),
      enAyuda("m3", "o3"),
    ]);
    const res = await service.habilitarLote(ACTOR, [fila(11), fila(22), fila(33)]);
    expect(res.resumen.habilitadas).toBe(3);
    expect(registrarAyudaResuelta).toHaveBeenCalledTimes(3);
    expect(
      registrarAyudaResuelta.mock.calls.map((c) => (c[0] as { ordenId: string }).ordenId),
    ).toEqual(["o1", "o2", "o3"]);
    expect(registrar).toHaveBeenCalledTimes(3);
  });

  it("el repo que el service recibe NO expone ningun otro metodo: solo los dos del `Pick`", async () => {
    // La otra mitad del assert es de TIPOS y la hace el compilador. Esto afirma la mitad de runtime.
    const { ordenRepo } = build();
    expect(Object.keys(ordenRepo).sort()).toEqual([
      "findParaHabilitacionApi",
      "registrarAyudaResuelta",
    ]);
  });
});
