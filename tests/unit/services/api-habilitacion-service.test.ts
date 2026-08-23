import { describe, it, expect, vi } from "vitest";
import { ApiHabilitacionService } from "@/lib/services/ApiHabilitacionService";
import type { OrdenRepoParaHabilitacionApi } from "@/lib/services/ApiHabilitacionService";
import type {
  IOrdenHabilitacionApiRepository,
  RegistrarHabilitacionApiInput,
} from "@/lib/interfaces/repositories/IOrdenHabilitacionApiRepository";
import type {
  OrdenParaHabilitacionApi,
  TransicionAyudaInput,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { FilaHabilitacionInput } from "@/lib/interfaces/services/IApiHabilitacionService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { TOPE_CARACTERES_NOTA_HABILITAR } from "@/lib/config/habilitacion-api";

// Feature 266 (T4.2/T4.3) — el service de HABILITACION POR LOTE del canal por API key, con repos
// falsos. Aqui vive la mayor parte de la trazabilidad de la ficha.
//
// ⚠️ D1 (puerta del 2026-08-23): los estados habilitables son `ayuda_tienda` y `devuelta`, y
// `reprogramada` QUEDA FUERA. Y como una `devuelta` esta SIEMPRE desasignada, **el unico estado
// que puede volver a `en_reparto` es `ayuda_tienda`**: ni un solo caso de abajo espera que una
// `devuelta` transicione, y eso no es una laguna de cobertura sino la verdad fisica del paquete.

const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };
const ID_AYUDA = "os-ayuda_tienda";
const ID_EN_REPARTO = "os-en_reparto";

/** Una orden tal como la devuelve `findParaHabilitacionApi` (los cuatro campos del discriminador). */
function orden(
  estatusValue: string,
  mensajeroAsignadoId: string | null,
  id = "o1",
): OrdenParaHabilitacionApi {
  return { id, estatusId: `os-${estatusValue}`, estatusValue, mensajeroAsignadoId };
}

function fila(num_guia: unknown, nota: unknown = "el cliente pidio reintento"): FilaHabilitacionInput {
  return { num_guia, nota };
}

/**
 * Los dos dobles. El del repo de ordenes esta TIPADO como el `Pick` del constructor (design
 * §4.4): declararle un cuarto metodo de escritura no compilaria, que es la mitad estructural del
 * assert de T4.3.
 */
function build(ordenes: (OrdenParaHabilitacionApi | null)[] = []) {
  const findParaHabilitacionApi = vi.fn(async (numGuia: number, ownerId: string) => {
    void numGuia;
    void ownerId;
    return ordenes.shift() ?? null;
  });
  const findEstatusIdByValue = vi.fn(
    async (value: string): Promise<string | null> =>
      value === "ayuda_tienda" ? ID_AYUDA : value === "en_reparto" ? ID_EN_REPARTO : null,
  );
  const transicionarAyuda = vi.fn(async (input: TransicionAyudaInput) => {
    void input;
    return true;
  });
  const ordenRepo: OrdenRepoParaHabilitacionApi = {
    findParaHabilitacionApi,
    findEstatusIdByValue,
    transicionarAyuda,
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
    findEstatusIdByValue,
    transicionarAyuda,
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
    const { service, transicionarAyuda, registrar } = build([null]);
    const res = await service.habilitarLote(ACTOR, [fila(999999)]);
    expect(res.resultados[0]).toEqual({
      numGuia: 999999,
      resultado: "error",
      estado: null,
      error: { codigo: "no_encontrada", mensaje: expect.any(String) },
    });
    expect(transicionarAyuda).not.toHaveBeenCalled(); // R4: cero escrituras
    expect(registrar).not.toHaveBeenCalled();
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
    const { service } = build([orden("devuelta", null), null, orden("ayuda_tienda", "m1", "o3")]);
    const res = await service.habilitarLote(ACTOR, [fila(11), fila(22), fila(33)]);
    expect(res.resultados).toHaveLength(3);
    expect(res.resultados.map((r) => r.numGuia)).toEqual([11, 22, 33]);
    expect(res.resultados.map((r) => r.resultado)).toEqual([
      "habilitada_sin_cambio_de_estado",
      "error",
      "habilitada",
    ]);
  });
});

describe("266/R9-R10 — el resumen cuadra y el estado viaja en los dos desenlaces de exito", () => {
  it("total = habilitadas + habilitadasSinCambioDeEstado + conError, con un lote de los tres tipos", async () => {
    const { service } = build([orden("ayuda_tienda", "m1"), orden("devuelta", null, "o2"), null]);
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
    const { service } = build([orden("ayuda_tienda", "m1"), orden("devuelta", null, "o2"), null]);
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
describe("266/R12-R16 — rama A: `ayuda_tienda` CON mensajero vuelve a `en_reparto`", () => {
  it("transiciona una sola vez, por el punto unico, con la familia propia de esta feature", async () => {
    const { service, transicionarAyuda } = build([orden("ayuda_tienda", "m1")]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(transicionarAyuda).toHaveBeenCalledTimes(1);
    expect(transicionarAyuda).toHaveBeenCalledWith({
      ordenId: "o1",
      estatusOrigenId: ID_AYUDA, // origen `ayuda_tienda`
      estatusDestinoId: ID_EN_REPARTO, // destino `en_reparto`
      actorUsuarioId: "store-1", // R3: el owner de la key
      origenTipo: "habilitacion_api", // R16: familia propia, distinta del rescate
    });
    expect(res.resultados[0]).toEqual({
      numGuia: 100234,
      resultado: "habilitada",
      estado: "en_reparto",
      error: null,
    });
  });

  it("D6: la entrada de la transicion NO lleva `motivo` — la nota vive SOLO en la bitacora", async () => {
    // Firmado en la puerta: la nota no se copia al historial. Si alguien la anadiera «para que se
    // vea en la linea de tiempo», el dato tendria dos hogares y este assert lo delata.
    const { service, transicionarAyuda, registrar } = build([orden("ayuda_tienda", "m1")]);
    await service.habilitarLote(ACTOR, [fila(100234, "el cliente pidio reintento")]);
    const entrada = transicionarAyuda.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(entrada)).not.toContain("motivo");
    expect(JSON.stringify(entrada)).not.toContain("reintento");
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ nota: "el cliente pidio reintento" }),
    );
  });
});

describe("266/R12-R22 — rama B: el paquete ya esta en bodega, solo se deja log", () => {
  it("`ayuda_tienda` SIN mensajero asignado no transiciona: es rama B (defensa)", async () => {
    const { service, transicionarAyuda, registrar } = build([orden("ayuda_tienda", null)]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(transicionarAyuda).not.toHaveBeenCalled(); // R20
    expect(res.resultados[0].resultado).toBe("habilitada_sin_cambio_de_estado");
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ cambioDeEstado: false, estadoResultante: "ayuda_tienda" }),
    );
  });

  it("R14-b: una `devuelta` cae SIEMPRE en rama B y NUNCA se manda a `en_reparto`", async () => {
    // La verdad fisica del paquete: los cuatro caminos que devuelven una orden ponen
    // `mensajero_asignado_id` a NULL. Mandarla a `en_reparto` seria publicar una mentira.
    const { service, transicionarAyuda, registrar } = build([orden("devuelta", null)]);
    const res = await service.habilitarLote(ACTOR, [fila(100234, "reintento pactado")]);
    expect(transicionarAyuda).not.toHaveBeenCalled();
    expect(res.resultados[0]).toEqual({
      numGuia: 100234,
      resultado: "habilitada_sin_cambio_de_estado",
      estado: "devuelta",
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

  it("la rama B no consulta siquiera el catalogo de estados: no hay nada que transicionar", async () => {
    const { service, findEstatusIdByValue } = build([orden("devuelta", null)]);
    await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(findEstatusIdByValue).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// LA GUARDA DE ESTADO, ATACADA DIRECTAMENTE (R13/R13-b/R14/R31)
// =================================================================================================
describe("266/R13-R14 — la guarda de estado del llamador rechaza lo que no es habilitable", () => {
  it("R13-b: `reprogramada` NO es habilitable — ni transiciona ni deja registro", async () => {
    // Se ataca aparte y no como un caso mas de la tabla: `reprogramada` SI es novedad para el
    // integrador y estuvo propuesta como habilitable hasta la puerta del 2026-08-23. Si alguien la
    // «anade por simetria», este `it` se pone rojo con su nombre.
    const { service, transicionarAyuda, registrar } = build([orden("reprogramada", "m1")]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(res.resultados[0]).toMatchObject({
      resultado: "error",
      estado: null,
      error: { codigo: "estado_no_habilitable" },
    });
    expect(transicionarAyuda).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it.each(["entregada", "rechazada", "en_reparto", "incidente", "sin_gestionar"])(
    "una orden en `%s` devuelve estado_no_habilitable sin escribir ni estado ni bitacora",
    async (estado) => {
      // ATAQUE DIRECTO a la guarda: es la PRIMERA red y vive en este service, no en el `WHERE`
      // del repo. Con mensajero asignado a proposito, para que ni siquiera el discriminador de
      // rama pueda salvarla.
      const { service, transicionarAyuda, registrar } = build([orden(estado, "m1")]);
      const res = await service.habilitarLote(ACTOR, [fila(100234)]);
      expect(res.resultados[0].error?.codigo).toBe("estado_no_habilitable");
      expect(transicionarAyuda).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    },
  );

  it("R31/D3: habilitar por segunda vez una orden ya en `en_reparto` devuelve error, JAMAS `habilitada`", async () => {
    // Un acuse falso es peor que un error honesto. El assert es sobre el `resultado` devuelto,
    // ademas del cero-escrituras: si alguien implementara la idempotencia «amable», el primer
    // expect caeria.
    const { service, transicionarAyuda, registrar } = build([orden("en_reparto", "m1")]);
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(res.resultados[0].resultado).toBe("error");
    expect(res.resultados[0].resultado).not.toBe("habilitada");
    expect(res.resultados[0].error?.codigo).toBe("estado_no_habilitable");
    expect(res.resumen).toEqual({
      total: 1,
      habilitadas: 0,
      habilitadasSinCambioDeEstado: 0,
      conError: 1,
    });
    expect(transicionarAyuda).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// FALLO CERRADO Y CARRERA (R18/R19/R25)
// =================================================================================================
describe("266/R19 — si el catalogo no resuelve, la fila se rechaza sin escribir nada", () => {
  it.each(["ayuda_tienda", "en_reparto"])(
    "cuando `%s` no resuelve, no se transiciona ni se registra",
    async (valueAusente) => {
      const { service, findEstatusIdByValue, transicionarAyuda, registrar } = build([
        orden("ayuda_tienda", "m1"),
      ]);
      findEstatusIdByValue.mockImplementation(async (value: string) =>
        value === valueAusente ? null : `os-${value}`,
      );
      const res = await service.habilitarLote(ACTOR, [fila(100234)]);
      expect(res.resultados[0].resultado).toBe("error");
      expect(transicionarAyuda).not.toHaveBeenCalled();
      expect(registrar).not.toHaveBeenCalled();
    },
  );
});

describe("266/R18-R25 — si la orden se movio entre la lectura y la escritura, no queda nada a medias", () => {
  it("`transicionarAyuda` que devuelve false da estado_no_habilitable y NO deja bitacora", async () => {
    const { service, transicionarAyuda, registrar } = build([orden("ayuda_tienda", "m1")]);
    transicionarAyuda.mockResolvedValue(false); // el `updateMany` guardado afecto 0 filas
    const res = await service.habilitarLote(ACTOR, [fila(100234)]);
    expect(res.resultados[0].error?.codigo).toBe("estado_no_habilitable");
    expect(registrar).not.toHaveBeenCalled(); // R25: sin transicion confirmada, sin registro
  });
});

describe("266/R23-R25 — la bitacora se escribe DESPUES de la transicion, nunca antes", () => {
  it("en la rama A, `registrar` ocurre despues de `transicionarAyuda` y con cambioDeEstado true", async () => {
    // El ORDEN es el que garantiza que nunca exista una fila de bitacora que afirme un cambio de
    // estado que no ocurrio (design §8, riesgo 1). Se afirma con el orden real de invocacion.
    const { service, transicionarAyuda, registrar } = build([orden("ayuda_tienda", "m1")]);
    await service.habilitarLote(ACTOR, [fila(100234, "reintento")]);
    expect(transicionarAyuda.mock.invocationCallOrder[0]).toBeLessThan(
      registrar.mock.invocationCallOrder[0],
    );
    expect(registrar).toHaveBeenCalledWith({
      ordenId: "o1",
      actorUsuarioId: "store-1",
      nota: "reintento",
      cambioDeEstado: true, // R23
      estadoResultante: "en_reparto",
    });
  });
});

// =================================================================================================
// T4.3 — EL PUNTO UNICO DE ESCRITURA, AFIRMADO POR TIPOS + LLAMADA (nunca por un `grep`)
// =================================================================================================
describe("266/R15 (T4.3) — toda escritura de estado pasa por `transicionarAyuda`, una por fila", () => {
  it("un lote de 3 filas de rama A invoca `transicionarAyuda` exactamente 3 veces", async () => {
    const { service, transicionarAyuda, registrar } = build([
      orden("ayuda_tienda", "m1", "o1"),
      orden("ayuda_tienda", "m2", "o2"),
      orden("ayuda_tienda", "m3", "o3"),
    ]);
    const res = await service.habilitarLote(ACTOR, [fila(11), fila(22), fila(33)]);
    expect(res.resumen.habilitadas).toBe(3);
    expect(transicionarAyuda).toHaveBeenCalledTimes(3);
    expect(transicionarAyuda.mock.calls.map((c) => (c[0] as { ordenId: string }).ordenId)).toEqual([
      "o1",
      "o2",
      "o3",
    ]);
    expect(registrar).toHaveBeenCalledTimes(3);
  });

  it("el repo que el service recibe NO expone ningun otro metodo: solo los tres del `Pick`", async () => {
    // La otra mitad del assert es de TIPOS y la hace el compilador: el constructor pide
    // `Pick<IOrdenRepository, "findParaHabilitacionApi" | "findEstatusIdByValue" |
    // "transicionarAyuda">`, asi que un segundo `updateMany` sobre `orden.estatus_id` no es que
    // este prohibido por convencion — no compila. Esto afirma la mitad de runtime.
    const { ordenRepo } = build();
    expect(Object.keys(ordenRepo).sort()).toEqual([
      "findEstatusIdByValue",
      "findParaHabilitacionApi",
      "transicionarAyuda",
    ]);
  });
});
