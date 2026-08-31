import { describe, it, expect, vi } from "vitest";
import {
  dedupeKeyWebhookEstado,
  emitirWebhooksEstado,
  MAX_INTENTOS_WEBHOOK,
  type WebhookEmisorTx,
} from "@/lib/services/jobs/webhook-estado-encolado";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";

// Feature 99 (R13/R14/R15/R27) — helper de emision. Fake `tx.$queryRaw` con semantica: la
// 1.a consulta (§5) resuelve las ordenes con owner suscrito activo y rol apiKey; la 2.a
// resuelve el `value` del estatus destino. `repo.enqueue` va espiado.

/** Mapa estatusDestinoId -> value del catalogo. */
const VALUE_POR_ID: Record<string, string> = {
  "s-entregada": "entregada", // publico
  "s-en-reparto": "en_reparto", // publico
  // ⏳ 2026-08-31 — `s-fulfillment` era el ejemplo de estado NO publico, y ya no sirve como tal:
  // `en_preparacion` pasa a ser publico (evento de NACIMIENTO de la rama de fulfillment). Se anade
  // un interno de RUTEO SATELITE, que sigue sin emitir, y los casos que necesitaban «un estado
  // fuera de la politica» pasan a usarlo.
  "s-satelite": "en_bodega_satelite", // NO publico (interno de ruteo satelite)
  "s-fulfillment": "en_preparacion", // publico desde el 2026-08-31 (nacimiento con fulfillment)
  // Feature 268: los dos values que la 268 hace publicos, y uno que sigue NO siendolo.
  "s-ayuda-tienda": "ayuda_tienda", // publico desde la 268/R1
  "s-incidente": "incidente", // publico desde la 268/R2
  "s-sin-gestionar": "sin_gestionar", // NO publico (corte de la noche, 268/R13)
};

function buildTx(ordenesElegibles: Set<string>): WebhookEmisorTx {
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join(" ");
    const args = values.flatMap((v) => {
      const inner = (v as { values?: unknown[] })?.values;
      return Array.isArray(inner) ? inner : [v];
    });
    if (sql.includes("webhook_suscripcion")) {
      // §5: solo las ordenes elegibles (owner suscrito activo Y rol apiKey).
      return args.filter((id) => ordenesElegibles.has(id as string)).map((id) => ({ orden_id: id }));
    }
    if (sql.includes("order_status")) {
      return args
        .filter((id) => VALUE_POR_ID[id as string] !== undefined)
        .map((id) => ({ id, value: VALUE_POR_ID[id as string] }));
    }
    return [];
  });
  return { $queryRaw, $executeRaw: vi.fn() } as unknown as WebhookEmisorTx;
}

function buildRepo() {
  const enqueue = vi.fn(async () => null);
  const repo = { enqueue } as unknown as IJobRepository;
  return { repo, enqueue };
}

function entrada(
  ordenId: string,
  estatusDestinoId: string,
  // Feature 235 (P4): la FAMILIA entra en la decision de emitir, asi que el helper la admite. El
  // default es el de siempre, para que ningun caso previo cambie de significado.
  origenTipo: CambioEstadoEntrada["origenTipo"] = "gestion",
): CambioEstadoEntrada {
  return {
    ordenId,
    estatusOrigenId: "s-previo",
    estatusDestinoId,
    actorUsuarioId: "u1",
    origenTipo,
  };
}

describe("R14 — dedupeKey por evento unico", () => {
  it("dos transiciones distintas (incluida la repeticion del mismo estado) producen claves distintas", () => {
    // Dos ordenes distintas al mismo estado -> distinto.
    expect(dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T00:00:00.000Z")).not.toBe(
      dedupeKeyWebhookEstado("o2", "s-entregada", "2026-07-21T00:00:00.000Z"),
    );
    // Misma orden que REINGRESA al mismo estado en dos instantes -> distinto (el instante
    // desambigua; sin el, el ON CONFLICT descartaria el 2.o evento en silencio).
    expect(dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T00:00:00.000Z")).not.toBe(
      dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T01:00:00.000Z"),
    );
    // Determinista: misma entrada -> misma clave.
    expect(dedupeKeyWebhookEstado("o1", "s1", "t")).toBe(dedupeKeyWebhookEstado("o1", "s1", "t"));
  });
});

describe("R13/R27 — payload minimo y maxIntentos=5", () => {
  it("el payload lleva ordenId/estatusDestinoId/ocurridoAt y NO lleva secreto; maxIntentos=5", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));
    const now = () => new Date("2026-07-21T10:00:00.000Z");

    await emitirWebhooksEstado(tx, [entrada("o1", "s-entregada")], repo, now);

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload, opts, txArg] = enqueue.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      { maxIntentos: number; dedupeKey: string },
      unknown,
    ];
    expect(tipo).toBe("webhook_estado");
    expect(payload).toEqual({
      ordenId: "o1",
      estatusDestinoId: "s-entregada",
      ocurridoAt: "2026-07-21T10:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret/i); // R13: sin secreto
    expect(opts.maxIntentos).toBe(MAX_INTENTOS_WEBHOOK);
    expect(opts.maxIntentos).toBe(5); // R27/D5
    expect(opts.dedupeKey).toBe(
      dedupeKeyWebhookEstado("o1", "s-entregada", "2026-07-21T10:00:00.000Z"),
    );
    expect(txArg).toBe(tx); // outbox: encola DENTRO de la misma tx (R11)
  });
});

describe("R15 — politica EVENTOS_PUBLICOS", () => {
  it("un estado dentro de EVENTOS_PUBLICOS emite y uno fuera de ella no", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1", "o2"]));

    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-en-reparto"), entrada("o2", "s-satelite")],
      repo,
    );

    // Solo la transicion publica (en_reparto) encola; la interna (en_bodega_satelite) no.
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0] as unknown as unknown[])[1]).toMatchObject({ ordenId: "o1" });
  });

  it("2026-08-31: el NACIMIENTO en `en_preparacion` SI encola — se acabo el silencio de fulfillment", () => {
    // El caso que justifica el parche entero, afirmado en el emisor y no solo en la politica: una
    // orden de fulfillment nace en `en_preparacion` y, hasta hoy, el integrador no recibia NADA
    // hasta que avanzaba a `en_bodega_central` al emitirse la guia. Si alguien saca el value de
    // `EVENTOS_PUBLICOS`, este caso —no solo el congelador de la lista— se pone rojo.
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));

    return emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-fulfillment", "carga_api")],
      repo,
      () => new Date("2026-08-31T10:00:00.000Z"),
    ).then(() => {
      expect(enqueue).toHaveBeenCalledTimes(1);
      const [tipo, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(tipo).toBe("webhook_estado");
      expect(payload).toMatchObject({ ordenId: "o1", estatusDestinoId: "s-fulfillment" });
    });
  });
});

describe("R12 — solo ordenes elegibles (owner suscrito activo y rol apiKey)", () => {
  it("no encola nada si ninguna orden del lote es elegible", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set()); // sin suscripciones -> §5 vacio
    await emitirWebhooksEstado(tx, [entrada("o1", "s-entregada")], repo);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// FEATURE 235 (T1.5, P4 FIRMADA EN CONTRA DE LA RECOMENDACION, 2026-08-19).
//
// ⏳ 2026-08-22 (FEATURE 268/R8/R9) — AQUI DECIA, y ya no es cierto: «el ciclo de AYUDA no se emite,
// y la excepcion es POR FAMILIA DE ORIGEN. El humano no acepta que un integrador reciba
// `en_reparto` dos veces sobre la misma orden. La IDA (`-> ayuda_tienda`) no se emite porque ese
// value no es publico; la VUELTA si lo seria (...) — de ahi la excepcion».
//
// La 268 revierte 235/P4 y las dos mitades del ciclo emiten: la IDA porque `ayuda_tienda` entra en
// la politica (R8) y la VUELTA porque la exencion por familia queda vacia (R9). Emitir solo la ida
// era la MEDIA feature: el integrador veria entrar la orden en ayuda y no la veria salir nunca.
//
// ⚠️ LO QUE HAY QUE SEGUIR MIRANDO. Los reingresos LEGITIMOS a `en_reparto` (R12) siguen encolando,
// igual que antes: si alguien reimplementara una exencion POR ESTADO destino sobre `en_reparto`,
// esos casos caerian, y eso SI seria una regresion. Y el emisor sigue PREGUNTANDO a
// `esTransicionEmitible` sin re-derivar la politica (R14): estos casos se mueven al cambiar la
// politica, no al cambiar el emisor.
// =================================================================================================
describe("268 — el ciclo de AYUDA emite en sus DOS mitades, y los reingresos legitimos siguen", () => {
  it("268/R8: la IDA `en_reparto -> ayuda_tienda` via `solicitud_ayuda_tienda` SI encola", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"])); // la orden SI tiene integrador suscrito
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-ayuda-tienda", "solicitud_ayuda_tienda")],
      repo,
      () => new Date("2026-08-22T10:00:00.000Z"),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(tipo).toBe("webhook_estado");
    expect(payload.estatusDestinoId).toBe("s-ayuda-tienda");
  });

  // ⏳ 2026-08-22 — AQUI DECIA, y ya no es cierto: «`ayuda_tienda -> en_reparto` via
  // `rescate_ayuda_tienda`: NO encola nada». El caso se INVIERTE (268/R9), no se borra: es el
  // rastro de que 235/P4 se revirtio a proposito.
  it("268/R9 (invierte 235/P4): el RESCATE `ayuda_tienda -> en_reparto` SI encola", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-en-reparto", "rescate_ayuda_tienda")],
      repo,
      () => new Date("2026-08-22T10:00:00.000Z"),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(tipo).toBe("webhook_estado");
    expect(payload.estatusDestinoId).toBe("s-en-reparto");
  });

  it("268/R13: `ayuda_tienda -> sin_gestionar` via `corte_sin_gestionar` NO encola", async () => {
    // El corte de la noche sigue en silencio, y por la razon de siempre: el estado DESTINO no es
    // publico. No hace falta ninguna exencion por familia para eso — que es justo por lo que la
    // exencion pudo quedar vacia sin perder este comportamiento.
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-sin-gestionar", "corte_sin_gestionar")],
      repo,
      () => new Date("2026-08-22T23:59:00.000Z"),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("MISMA orden, MISMO estado destino, OTRA familia: `liberacion_reprogramada` SI encola", async () => {
    // El control que impide que una exencion futura se implemente por estado. Es literalmente el
    // mismo `enqueue`, el mismo `tx` y el mismo `s-en-reparto` del caso de arriba: lo unico que
    // cambia es la familia.
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-en-reparto", "liberacion_reprogramada")],
      repo,
      () => new Date("2026-08-19T10:00:00.000Z"),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(tipo).toBe("webhook_estado");
    expect(payload.estatusDestinoId).toBe("s-en-reparto");
  });

  // ⏳ 2026-08-22 — AQUI DECIA, y ya no es cierto: «en un LOTE mixto, solo cae la del rescate: la
  // excepcion no contamina a sus vecinas», con `["o2", "o3"]`. Sin exencion no cae ninguna; el caso
  // se conserva invertido porque sigue siendo el que detecta una exencion reintroducida a escondidas
  // en el emisor (R14) o por estado destino.
  it("268/R9/R12: en un LOTE mixto no cae NINGUNA — ya no hay familia exceptuada", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1", "o2", "o3", "o4"]));
    await emitirWebhooksEstado(
      tx,
      [
        entrada("o1", "s-en-reparto", "rescate_ayuda_tienda"), // antes exceptuada (235/P4)
        entrada("o2", "s-en-reparto", "recoleccion"), // la entrada NORMAL a reparto
        entrada("o3", "s-entregada", "gestion"), // otro estado publico
        entrada("o4", "s-satelite", "gestion"), // estado interno de ruteo satelite: sigue sin emitir
      ],
      repo,
      () => new Date("2026-08-22T10:00:00.000Z"),
    );
    const ordenesEncoladas = (
      enqueue.mock.calls as unknown as [string, Record<string, unknown>][]
    ).map((c) => c[1].ordenId);
    expect(ordenesEncoladas.sort()).toEqual(["o1", "o2", "o3"]);
  });
});

// =================================================================================================
// FEATURE 268/R11 — el INCIDENTE avisa, y se llega a el por DOS caminos con familias distintas.
//
// No es un detalle de cobertura: la arista #44 la produce el MENSAJERO (familia `gestion`, desde
// `en_reparto`) y las #48-#52 las produce el ADMIN (familia `incidente`, desde los estados de
// bodega/ruta). Si la politica se hubiera escrito por familia en vez de por estado destino, uno de
// los dos caminos se quedaria en silencio: por eso se afirman los dos.
// =================================================================================================
describe("268/R11 — la transicion a `incidente` encola, por cualquiera de sus dos caminos", () => {
  it("via familia `gestion` desde `en_reparto` (arista #44, el camino del MENSAJERO)", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-incidente", "gestion")],
      repo,
      () => new Date("2026-08-22T11:00:00.000Z"),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [tipo, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(tipo).toBe("webhook_estado");
    expect(payload.estatusDestinoId).toBe("s-incidente");
  });

  it("via familia `incidente` desde `en_bodega_central` (arista #48, el camino del ADMIN)", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o2"]));
    await emitirWebhooksEstado(
      tx,
      [entrada("o2", "s-incidente", "incidente")],
      repo,
      () => new Date("2026-08-22T11:05:00.000Z"),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [, payload] = enqueue.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload.estatusDestinoId).toBe("s-incidente");
    expect(payload.ordenId).toBe("o2");
  });
});

// =================================================================================================
// FEATURE 268/R10 — LA PREMISA QUE HACE ACEPTABLE REVERTIR 235/P4.
//
// Con la 268, una orden que pasa por el ciclo de ayuda emite `en_reparto` DOS VECES (la entrada
// normal y el rescate). Eso solo es admisible si los dos eventos son DISTINGUIBLES: la `dedupeKey`
// —que ES el `eventoId` que ve el integrador— lleva el INSTANTE (features 47 y 99), asi que el
// segundo evento no choca con la fila `done` del primero ni lo descarta el `ON CONFLICT DO NOTHING`
// en silencio, y el consumidor puede deduplicar por ese id.
//
// ⚠️ ESTE CASO ES EL QUE SE PONE ROJO SI ALGUIEN QUITA EL INSTANTE DE LA CLAVE. Comprobado a mano:
// pasando el MISMO `now()` a las dos invocaciones, las dos claves coinciden y el aserto cae.
// =================================================================================================
describe("268/R10 — dos `en_reparto` sobre la MISMA orden producen dedupeKey DISTINTA", () => {
  it("misma orden y mismo estatusDestinoId, dos instantes: dos claves distintas", async () => {
    const { repo, enqueue } = buildRepo();
    const tx = buildTx(new Set(["o1"]));

    // 1.a mitad: la entrada NORMAL a reparto (la recoleccion del mensajero).
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-en-reparto", "recoleccion")],
      repo,
      () => new Date("2026-08-22T09:00:00.000Z"),
    );
    // 2.a mitad: el RESCATE del ciclo de ayuda, horas despues, sobre la MISMA orden y el MISMO
    // estado destino. Antes de la 268 esta no se emitia (235/P4); ahora si.
    await emitirWebhooksEstado(
      tx,
      [entrada("o1", "s-en-reparto", "rescate_ayuda_tienda")],
      repo,
      () => new Date("2026-08-22T14:30:00.000Z"),
    );

    expect(enqueue).toHaveBeenCalledTimes(2);
    const calls = enqueue.mock.calls as unknown as [
      string,
      Record<string, unknown>,
      { dedupeKey: string },
    ][];
    // Misma orden, mismo estado destino: lo unico que las separa es el instante.
    expect(calls[0][1].ordenId).toBe("o1");
    expect(calls[1][1].ordenId).toBe("o1");
    expect(calls[0][1].estatusDestinoId).toBe("s-en-reparto");
    expect(calls[1][1].estatusDestinoId).toBe("s-en-reparto");
    expect(calls[0][1].ocurridoAt).not.toBe(calls[1][1].ocurridoAt);
    // Y las claves son DISTINTAS, que es lo que impide el descarte en silencio.
    expect(calls[0][2].dedupeKey).not.toBe(calls[1][2].dedupeKey);
    expect(calls[0][2].dedupeKey).toBe(
      dedupeKeyWebhookEstado("o1", "s-en-reparto", "2026-08-22T09:00:00.000Z"),
    );
    expect(calls[1][2].dedupeKey).toBe(
      dedupeKeyWebhookEstado("o1", "s-en-reparto", "2026-08-22T14:30:00.000Z"),
    );
  });
});
