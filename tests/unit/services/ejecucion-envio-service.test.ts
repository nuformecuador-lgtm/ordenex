import { describe, expect, it, vi } from "vitest";
import { EjecucionEnvioService, MOTIVOS, type MetaEnvios } from "@/lib/services/EjecucionEnvioService";
import { WhatsappNoConfiguradoError } from "@/lib/config/whatsapp";
import type { WhatsappEnvioOutcome } from "@/lib/clients/whatsapp-cloud";
import type { InformeWhatsapp } from "@/lib/whatsapp-envios/informes/tipos";
import { informePruebaEnvio } from "@/lib/whatsapp-envios/informes/prueba-envio";
import { z } from "zod";
import {
  destinatario,
  ejecucionFila,
  ejecucionesRepo,
  envio,
  enviosRepo,
  plantilla,
} from "./_dobles-envios-474";

// Ficha 474 (T7.2) — EL MOTOR con dobles: R28-R37 y R53. La idempotencia SQL (R23/R27/R37) la
// prueban los tests de integracion; aqui, las decisiones del motor.

const AHORA = new Date("2026-10-05T11:00:00.000Z"); // 05:00 CR

function meta(salidas: (WhatsappEnvioOutcome | Error)[] = []) {
  const cola = [...salidas];
  const enviarPlantilla = vi.fn(async (_d: string, _n: string, _i: string, _c?: unknown[]): Promise<WhatsappEnvioOutcome> => {
    const s = cola.shift() ?? { status: "ok", mensajeId: `wamid.${Math.random()}` };
    if (s instanceof Error) throw s;
    return s;
  });
  const subir = vi.fn(async () => ({ status: "ok" as const, mediaId: "MEDIA-1" }));
  const m: MetaEnvios = { enviador: { enviarPlantilla }, subidor: { subir }, idioma: "es" };
  return { m, enviarPlantilla, subir };
}

function montar(o: {
  envio?: ReturnType<typeof envio>;
  plantilla?: ReturnType<typeof plantilla> | null;
  destinatarios?: ReturnType<typeof destinatario>[];
  fila?: Partial<ReturnType<typeof ejecucionFila>>;
  meta?: ReturnType<typeof meta>;
  metaLanza?: Error;
  informe?: InformeWhatsapp<unknown>;
} = {}) {
  const envios = enviosRepo({
    obtener: vi.fn(async () => o.envio ?? envio({ encendido: true })),
    resolverDestinatarios: vi.fn(async () => o.destinatarios ?? [destinatario()]),
  });
  const ej = ejecucionesRepo(ejecucionFila(o.fila ?? {}));
  const plantillas = { findEnviableDeInformeById: vi.fn(async () => (o.plantilla === undefined ? plantilla() : o.plantilla)) };
  const almacen = {
    guardar: vi.fn(async (e: string, x: string) => ({ ruta: `${e}/${x}.pdf` })),
    leer: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
    firmar: vi.fn(),
    borrar: vi.fn(),
  };
  const cola = { enqueue: vi.fn(async () => null) };
  const mt = o.meta ?? meta();
  const logs: string[] = [];
  const s = new EjecucionEnvioService({
    envios,
    ejecuciones: ej.repo,
    plantillas,
    almacen,
    cola,
    meta: () => {
      if (o.metaLanza) throw o.metaLanza;
      return mt.m;
    },
    now: () => AHORA,
    ...(o.informe ? { informe: () => o.informe as InformeWhatsapp<unknown> } : {}),
    logger: { warn: (m) => logs.push(m) },
  });
  return { s, envios, ej, plantillas, almacen, cola, mt, logs };
}

describe("474/R28/R30 — destinatarios", () => {
  it("R28: resuelve AHORA los destinatarios guardados del envio", async () => {
    const { s, envios } = montar();
    await s.ejecutar("ej-1");
    expect(envios.resolverDestinatarios).toHaveBeenCalledWith("env-1", ["maestro", "admin", "adminSatelite", "adminTienda", "mensajero"]);
  });

  it("R30: sin destinatarios -> sin_destinatarios y el informe NO se genera", async () => {
    const generar = vi.fn();
    const informe = { ...informePruebaEnvio, generar } as unknown as InformeWhatsapp<unknown>;
    const { s, ej } = montar({ destinatarios: [], informe });
    const r = await s.ejecutar("ej-1");
    expect(r.estado).toBe("sin_destinatarios");
    expect(ej.fila().estado).toBe("sin_destinatarios");
    expect(generar).not.toHaveBeenCalled();
  });
});

describe("474/R29 — telefono invalido", () => {
  it("no se intenta enviar y la entrega queda telefono_invalido", async () => {
    const { s, ej, mt } = montar({
      destinatarios: [destinatario({ usuarioId: "u1", telefono: "123" }), destinatario({ usuarioId: "u2", nombre: "Ana", telefono: "88881111" })],
    });
    await s.ejecutar("ej-1");
    expect(ej.entregas().map((e) => [e.usuarioId, e.estado])).toEqual([
      ["u1", "telefono_invalido"],
      ["u2", "aceptada"],
    ]);
    expect(mt.enviarPlantilla).toHaveBeenCalledTimes(1);
    expect(mt.enviarPlantilla.mock.calls[0][0]).toBe("50688881111");
  });
});

describe("474/R16 enmienda (m4) — adminTienda excluido AL EJECUTAR si el informe no es apto", () => {
  const noApto = { ...informePruebaEnvio, aptoParaAdminTienda: false } as unknown as InformeWhatsapp<unknown>;

  it("el adminTienda no recibe nada y queda VISIBLE como rechazo con motivo; el resto se envia", async () => {
    const { s, ej, mt } = montar({
      informe: noApto,
      destinatarios: [
        destinatario({ usuarioId: "u1", nombre: "Ana", telefono: "88881111", rol: "admin" }),
        destinatario({ usuarioId: "u2", nombre: "Tienda", telefono: "88882222", rol: "adminTienda" }),
      ],
    });
    const r = await s.ejecutar("ej-1");
    expect(r.estado).toBe("completada");
    expect(ej.entregas().map((e) => [e.usuarioId, e.estado, e.motivo])).toEqual([
      ["u2", "rechazo_permanente", MOTIVOS.adminTienda],
      ["u1", "aceptada", null],
    ]);
    expect(mt.enviarPlantilla).toHaveBeenCalledTimes(1);
    expect(mt.enviarPlantilla.mock.calls[0][0]).toBe("50688881111");
  });

  it("si TODOS son adminTienda: sin_destinatarios con motivo, una entrada por excluido, sin generar ni enviar", async () => {
    const generar = vi.fn();
    const informe = { ...informePruebaEnvio, aptoParaAdminTienda: false, generar } as unknown as InformeWhatsapp<unknown>;
    const { s, ej, mt } = montar({
      informe,
      destinatarios: [
        destinatario({ usuarioId: "t1", nombre: "T1", rol: "adminTienda" }),
        destinatario({ usuarioId: "t2", nombre: "T2", rol: "adminTienda" }),
      ],
    });
    const r = await s.ejecutar("ej-1");
    expect(r).toMatchObject({ estado: "sin_destinatarios", motivo: MOTIVOS.todosAdminTienda });
    expect(ej.fila().motivo).toBe(MOTIVOS.todosAdminTienda);
    expect(ej.entregas().map((e) => [e.usuarioId, e.estado])).toEqual([
      ["t1", "rechazo_permanente"],
      ["t2", "rechazo_permanente"],
    ]);
    expect(generar).not.toHaveBeenCalled();
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
  });

  it("informe APTO: el adminTienda SI recibe (la regla no sobre-filtra)", async () => {
    const { s, ej, mt } = montar({
      destinatarios: [destinatario({ usuarioId: "u2", nombre: "Tienda", telefono: "88882222", rol: "adminTienda" })],
    });
    await s.ejecutar("ej-1");
    expect(ej.entregas().map((e) => [e.usuarioId, e.estado])).toEqual([["u2", "aceptada"]]);
    expect(mt.enviarPlantilla).toHaveBeenCalledTimes(1);
  });
});

describe("474/R31 — vacio", () => {
  it("el informe responde vacio -> vacia con su motivo y no se envia nada", async () => {
    const { s, ej, mt } = montar({ envio: envio({ encendido: true, parametros: { simularVacio: true } }) });
    const r = await s.ejecutar("ej-1");
    expect(r).toMatchObject({ estado: "vacia", motivo: "Prueba con «simular vacío» activado." });
    expect(ej.fila().estado).toBe("vacia");
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
  });
});

describe("474/R32 — variables", () => {
  it("una variable de la plantilla sin valor -> error nombrandola, sin enviar", async () => {
    const { s, ej, mt } = montar({ plantilla: plantilla({ variables: ["fecha", "zona"] }) });
    const r = await s.ejecutar("ej-1");
    expect(r).toMatchObject({ estado: "error", motivo: MOTIVOS.faltaVariable("zona") });
    expect(ej.fila().estado).toBe("error");
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
  });

  it("valores saneados y en el ORDEN de la plantilla", async () => {
    const informe: InformeWhatsapp<unknown> = {
      ...(informePruebaEnvio as unknown as InformeWhatsapp<unknown>),
      parametros: z.unknown(),
      generar: async () => ({ tipo: "contenido", valores: { hora: "05:00", fecha: "lunes\n\n5   de  octubre" } }),
    };
    const { s, mt } = montar({ informe, plantilla: plantilla({ variables: ["hora", "destinatario_nombre", "fecha"] }) });
    await s.ejecutar("ej-1");
    const componentes = mt.enviarPlantilla.mock.calls[0][3] as { parameters: { text: string }[] }[];
    expect(componentes[0].parameters.map((p) => p.text)).toEqual(["05:00", "Daniel", "lunes 5 de octubre"]);
  });
});

describe("474/R33 — documento", () => {
  it("guarda el PDF, lo sube UNA vez y lo manda como cabecera a todos los destinatarios", async () => {
    const { s, almacen, mt, ej } = montar({
      plantilla: plantilla({ llevaDocumento: true }),
      destinatarios: [destinatario({ usuarioId: "u1", nombre: "Ana" }), destinatario({ usuarioId: "u2", nombre: "Beto", telefono: "88882222" })],
    });
    await s.ejecutar("ej-1");
    expect(almacen.guardar).toHaveBeenCalledTimes(1);
    expect(mt.subir).toHaveBeenCalledTimes(1);
    expect(ej.fila()).toMatchObject({ mediaId: "MEDIA-1", pdfRuta: "env-1/ej-1.pdf", pdfNombre: "prueba-2026-10-05.pdf" });
    for (const call of mt.enviarPlantilla.mock.calls) {
      const comps = call[3] as { type: string; parameters: unknown[] }[];
      expect(comps[0]).toEqual({
        type: "header",
        parameters: [{ type: "document", document: { id: "MEDIA-1", filename: "prueba-2026-10-05.pdf" } }],
      });
    }
    expect(mt.enviarPlantilla).toHaveBeenCalledTimes(2);
  });

  it("plantilla con documento y el informe no da PDF -> error", async () => {
    const informe = {
      ...informePruebaEnvio,
      generar: async () => ({ tipo: "contenido", valores: { fecha: "f", hora: "h" } }),
    } as unknown as InformeWhatsapp<unknown>;
    const { s } = montar({ informe, plantilla: plantilla({ llevaDocumento: true }) });
    expect((await s.ejecutar("ej-1")).motivo).toBe(MOTIVOS.sinPdf);
  });

  it("Meta rechaza el PDF -> error con el texto fijo del codigo", async () => {
    const mt = meta();
    mt.subir.mockResolvedValueOnce({ status: "rechazado", detalle: "HTTP 400", codigoMeta: 131053 } as never);
    const { s } = montar({ meta: mt, plantilla: plantilla({ llevaDocumento: true }) });
    const r = await s.ejecutar("ej-1");
    expect(r).toMatchObject({ estado: "error", motivo: "Meta rechazó el PDF: Meta no pudo procesar el PDF." });
  });

  it("error transitorio al subir (programada) -> LANZA para la cola, con el PDF ya guardado", async () => {
    const mt = meta();
    mt.subir.mockResolvedValueOnce({ status: "error", detalle: "HTTP 503" } as never);
    const { s, ej } = montar({ meta: mt, plantilla: plantilla({ llevaDocumento: true }) });
    await expect(s.ejecutar("ej-1")).rejects.toThrow(/subida del PDF/);
    expect(ej.fila().pdfRuta).toBe("env-1/ej-1.pdf");
  });
});

describe("474/R34 — re-validacion al ejecutar", () => {
  it("plantilla ya no compatible -> error con que corregir, sin enviar", async () => {
    const { s, mt } = montar({ plantilla: null });
    expect(await s.ejecutar("ej-1")).toMatchObject({ estado: "error", motivo: MOTIVOS.plantilla });
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
  });

  it("parametros guardados invalidos -> error «revisa los parametros»", async () => {
    const { s } = montar({ envio: envio({ encendido: true, parametros: { simularVacio: "x" } }) });
    expect(await s.ejecutar("ej-1")).toMatchObject({ estado: "error", motivo: MOTIVOS.parametros });
  });
});

describe("474/R35 — contenido fijado una vez", () => {
  it("un reintento reutiliza valores y PDF y NO regenera el informe", async () => {
    const generar = vi.fn();
    const informe = { ...informePruebaEnvio, generar } as unknown as InformeWhatsapp<unknown>;
    const { s, almacen, mt } = montar({
      informe,
      plantilla: plantilla({ llevaDocumento: true }),
      fila: { estado: "enviando", valores: { fecha: "01/10/2026", hora: "05:00" }, pdfRuta: "env-1/ej-1.pdf", pdfNombre: "p.pdf" },
    });
    await s.ejecutar("ej-1");
    expect(generar).not.toHaveBeenCalled();
    expect(almacen.guardar).not.toHaveBeenCalled();
    expect(almacen.leer).toHaveBeenCalledWith("env-1/ej-1.pdf"); // sin media_id: se sube el guardado
    const comps = mt.enviarPlantilla.mock.calls[0][3] as { type: string; parameters: { text?: string }[] }[];
    expect(comps[1].parameters.map((p) => p.text)).toEqual(["Daniel", "01/10/2026", "05:00"]);
  });

  it("un estado terminal no hace nada", async () => {
    const { s, mt, envios } = montar({ fila: { estado: "completada" } });
    expect((await s.ejecutar("ej-1")).estado).toBe("completada");
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
    expect(envios.obtener).not.toHaveBeenCalled();
  });
});

describe("474/R36/R37 — desenlace de Meta", () => {
  it("ok -> aceptada; permanente -> rechazo_permanente con motivo fijo; transitorio -> pendiente + reintento", async () => {
    const mt = meta([
      { status: "ok", mensajeId: "wamid.1" },
      { status: "permanente", detalle: "HTTP 400 (Meta 131026): to 50688882222", codigoMeta: 131026 },
      { status: "transitorio", detalle: "HTTP 503" },
    ]);
    const { s, ej, cola } = montar({
      meta: mt,
      destinatarios: [
        destinatario({ usuarioId: "a", nombre: "A" }),
        destinatario({ usuarioId: "b", nombre: "B", telefono: "88882222" }),
        destinatario({ usuarioId: "c", nombre: "C", telefono: "88883333" }),
      ],
    });
    const r = await s.ejecutar("ej-1");
    expect(ej.entregas().map((e) => [e.usuarioId, e.estado, e.motivo])).toEqual([
      ["a", "aceptada", null],
      ["b", "rechazo_permanente", "El número no tiene WhatsApp o no puede recibir mensajes."],
      ["c", "pendiente", "Error temporal de Meta: se reintentará."],
    ]);
    expect(cola.enqueue).toHaveBeenCalledWith("whatsapp_envio_reintento", { entregaId: "ent-3" }, {
      dedupeKey: "wa_envio_reintento:ent-3",
      maxIntentos: 5,
    });
    expect(r.estado).toBe("completada");
  });

  it("⭑ R37: una excepcion del cliente deja la entrega en_curso y NUNCA se reenvia", async () => {
    const mt = meta([new Error("respuesta con forma inesperada")]);
    const { s, ej } = montar({ meta: mt });
    await s.ejecutar("ej-1");
    expect(ej.entregas()[0].estado).toBe("en_curso");
    // Una segunda corrida de la MISMA ejecucion (re-claim de la cola): no la reclama otra vez.
    ej.fijar({ estado: "enviando" });
    await s.ejecutar("ej-1");
    expect(mt.enviarPlantilla).toHaveBeenCalledTimes(1);
  });
});

describe("474/R53 — destinatario_nombre por entrega", () => {
  it("dos destinatarios: cada componente lleva SU nombre", async () => {
    const { s, mt } = montar({
      destinatarios: [destinatario({ usuarioId: "a", nombre: "Ana" }), destinatario({ usuarioId: "b", nombre: "Beto", telefono: "88882222" })],
    });
    await s.ejecutar("ej-1");
    const nombres = mt.enviarPlantilla.mock.calls.map((c) => (c[3] as { parameters: { text: string }[] }[])[0].parameters[0].text);
    expect(nombres).toEqual(["Ana", "Beto"]);
  });

  it("nombre vacio tras sanear -> error en ESA entrega, las demas salen", async () => {
    const { s, ej, mt } = montar({
      destinatarios: [destinatario({ usuarioId: "a", nombre: " \n " }), destinatario({ usuarioId: "b", nombre: "Beto", telefono: "88882222" })],
    });
    await s.ejecutar("ej-1");
    expect(ej.entregas().map((e) => [e.usuarioId, e.estado, e.motivo])).toEqual([
      ["a", "rechazo_permanente", MOTIVOS.sinNombre],
      ["b", "aceptada", null],
    ]);
    expect(mt.enviarPlantilla).toHaveBeenCalledTimes(1);
  });
});

describe("474/R19 — apagado al ejecutar y credenciales", () => {
  it("envio apagado o borrado al llegar su turno -> omitida, sin enviar", async () => {
    const { s, mt } = montar({ envio: envio({ encendido: false }) });
    expect(await s.ejecutar("ej-1")).toMatchObject({ estado: "omitida", motivo: MOTIVOS.apagado });
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
  });

  it("sin credencial de WhatsApp -> error visible «WhatsApp no está configurado» y el job registra el motivo", async () => {
    const { s, ej } = montar({ metaLanza: new WhatsappNoConfiguradoError("WHATSAPP_CLOUD_TOKEN") });
    await expect(s.ejecutar("ej-1")).rejects.toThrow(/WHATSAPP_CLOUD_TOKEN/);
    expect(ej.fila()).toMatchObject({ estado: "error", motivo: MOTIVOS.noConfigurado("WHATSAPP_CLOUD_TOKEN") });
  });
});

describe("474/R36 — reintento de una entrega", () => {
  async function conPendiente(mt: ReturnType<typeof meta>) {
    const m = montar({ meta: mt });
    await m.ej.repo.insertarEntregas("ej-1", [
      { usuarioId: "u1", destinatarioNombre: "Daniel", telefono: "50688887777", estado: "pendiente", motivo: null },
    ]);
    m.ej.fijar({ valores: { fecha: "05/10/2026", hora: "05:00" }, plantillaId: "pl-1", estado: "completada" });
    return m;
  }

  it("ok -> aceptada", async () => {
    const m = await conPendiente(meta([{ status: "ok", mensajeId: "wamid.r" }]));
    await m.s.reintentar("ent-1", { intentos: 2, maxIntentos: 5 });
    expect(m.ej.entregas()[0].estado).toBe("aceptada");
  });

  it("transitorio con intentos restantes -> pendiente y LANZA (backoff)", async () => {
    const m = await conPendiente(meta([{ status: "transitorio", detalle: "503" }]));
    await expect(m.s.reintentar("ent-1", { intentos: 2, maxIntentos: 5 })).rejects.toThrow(/transitorio/);
    expect(m.ej.entregas()[0].estado).toBe("pendiente");
  });

  it("transitorio agotado (5/5) -> fallida y no lanza", async () => {
    const m = await conPendiente(meta([{ status: "transitorio", detalle: "503" }]));
    await m.s.reintentar("ent-1", { intentos: 5, maxIntentos: 5 });
    expect(m.ej.entregas()[0]).toMatchObject({ estado: "fallida", motivo: "Meta no respondió tras varios intentos (error temporal)." });
  });

  it("una entrega que ya no esta pendiente (en_curso / aceptada) no se reenvia", async () => {
    const mt = meta();
    const m = await conPendiente(mt);
    await m.ej.repo.reclamarEntrega("ent-1"); // en_curso
    await m.s.reintentar("ent-1", { intentos: 2, maxIntentos: 5 });
    expect(mt.enviarPlantilla).not.toHaveBeenCalled();
  });
});
