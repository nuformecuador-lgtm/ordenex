// Ficha 474 (design §4.3/§4.4, T7.2) — EL MOTOR de los envios automaticos por WhatsApp.
//
// Ejecuta UNA ejecucion: re-valida (R34), resuelve destinatarios (R28-R30), fija el contenido UNA
// vez (R31-R35), sube el PDF a Meta una vez (R33), crea las entregas idempotentes (R23/R27/R29) y
// envia cada una tras RECLAMARLA (R36/R37). Service puro: todo por constructor, sin Prisma ni Next.
//
// LA REGLA QUE MANDA: «como mucho una vez». Una entrega reclamada (`en_curso`) cuyo envio a Meta
// lanzo una excepcion (respuesta 2xx con forma rara) se queda `en_curso` = «resultado desconocido»
// (R37) y NUNCA se reenvia: preferimos perder un mensaje a duplicarlo, que era el fallo del sistema
// de referencia (alternativa G del design).
//
// R45: ni el token ni un telefono completo salen de aqui: los motivos son textos fijos
// (`motivoMeta`) y el log solo lleva ids y estados.
import type { RolValue } from "@prisma/client";
import type { IWhatsappEnvioRepository } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import type {
  EjecucionFila,
  IWhatsappEjecucionRepository,
} from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type {
  ILectorPlantillaDeInforme,
  PlantillaEnviableDeInforme,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import {
  PdfYaGuardadoError,
  type IAlmacenEnviosWhatsapp,
} from "@/lib/interfaces/external/IAlmacenEnviosWhatsapp";
import type { IJobRepository, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  DestinatarioPrueba,
  IEjecucionEnvioService,
  ResultadoEjecucion,
} from "@/lib/interfaces/services/IEjecucionEnvioService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ProbarEnvioResultado } from "@/lib/types/envios-whatsapp";
import { ROLES_DESTINATARIO } from "@/lib/types/envios-whatsapp";
import type { WhatsappEnvioOutcome } from "@/lib/clients/whatsapp-cloud";
import type { WhatsappMediaSubidor } from "@/lib/clients/whatsapp-media-upload";
import { WhatsappNoConfiguradoError } from "@/lib/config/whatsapp";
import type { InformeWhatsapp } from "@/lib/whatsapp-envios/informes/tipos";
import { CLAVE_DESTINATARIO_NOMBRE, informePorClave } from "@/lib/whatsapp-envios/informes/catalogo";
import { sanearValor } from "@/lib/whatsapp-envios/sanear-valor";
import { MOTIVO_TRANSITORIO_AGOTADO, acotarMotivo, motivoMeta } from "@/lib/whatsapp-envios/motivo-meta";
import { telefonoValido } from "@/lib/whatsapp-envios/telefono";
import { dedupeKeyReintento, MAX_INTENTOS_REINTENTO } from "@/lib/whatsapp-envios/encolar";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";
import { construirComponentsEnvio } from "@/lib/utils/whatsapp-template";
import { retencionDiasPdf, VENTANA_PRUEBA_MS } from "@/lib/config/whatsapp-envios";
import type { NotificacionEvento } from "@/lib/types/notificacion";

const ALLOWED_ROLES = new Set<string>(["maestro"]);
const ROLES_PERMITIDOS: readonly RolValue[] = ROLES_DESTINATARIO;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
const TERMINALES = new Set(["completada", "vacia", "sin_destinatarios", "omitida", "error"]);

export const MOTIVOS = {
  apagado: "El envío se apagó o se borró antes de ejecutarse.",
  plantilla:
    "La plantilla ya no está aprobada o activa en Meta, o es de otro informe: elige otra plantilla en el envío.",
  parametros: "Los parámetros del envío ya no son válidos: revisa los parámetros del envío.",
  informe: "El informe del envío ya no existe.",
  sinPdf: "El informe no generó el PDF.",
  sinNombre: "El destinatario no tiene nombre.",
  telefonoInvalido: "Teléfono inválido: no se intentó enviar.",
  desconocido: "Resultado desconocido: Meta respondió algo inesperado. No se reenvía para no duplicar.",
  noConfigurado: (pieza: string) => `WhatsApp no está configurado (falta ${pieza}).`,
  faltaVariable: (clave: string) => `Falta el valor de la variable «${clave}».`,
  pdfRechazado: (codigo: number | null) => `Meta rechazó el PDF: ${motivoMeta(codigo)}`,
} as const;

/** Lo que hace falta de Meta para enviar. Se construye PEREZOSAMENTE: sin credencial, lanza. */
export interface MetaEnvios {
  enviador: { enviarPlantilla(destino: string, nombre: string, idioma: string, componentes?: unknown[]): Promise<WhatsappEnvioOutcome> };
  subidor: WhatsappMediaSubidor;
  /** Idioma por defecto si la plantilla no trae el suyo. */
  idioma: string;
}

export interface LoggerEnvios {
  warn(mensaje: string): void;
}

export interface EjecucionEnvioServiceDeps {
  envios: Pick<IWhatsappEnvioRepository, "obtener" | "resolverDestinatarios" | "contactoDeUsuario">;
  ejecuciones: IWhatsappEjecucionRepository;
  plantillas: ILectorPlantillaDeInforme;
  almacen: IAlmacenEnviosWhatsapp;
  cola: Pick<IJobRepository, "enqueue">;
  /** Lanza `WhatsappNoConfiguradoError` si falta una credencial. */
  meta: () => MetaEnvios;
  now?: () => Date;
  informe?: (clave: string) => InformeWhatsapp<unknown> | null;
  logger?: LoggerEnvios;
}

/** Error que la cola debe reintentar (la ejecucion NO queda terminal). */
export class FalloReintentableEnvio extends Error {
  constructor(detalle: string) {
    super(`envio whatsapp: ${detalle}`);
    this.name = "FalloReintentableEnvio";
  }
}

export class EjecucionEnvioService implements IEjecucionEnvioService {
  private readonly now: () => Date;
  private readonly informe: (clave: string) => InformeWhatsapp<unknown> | null;
  private readonly logger: LoggerEnvios;

  constructor(private readonly deps: EjecucionEnvioServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.informe = deps.informe ?? informePorClave;
    this.logger = deps.logger ?? { warn: (m) => console.warn(m) };
  }

  async ejecutar(ejecucionId: string, opts: { destinatarioPrueba?: DestinatarioPrueba } = {}): Promise<ResultadoEjecucion> {
    const e = await this.deps.ejecuciones.obtener(ejecucionId);
    if (e === null) throw new Error(`ejecucion inexistente: ${ejecucionId}`);
    if (TERMINALES.has(e.estado)) return { estado: e.estado, motivo: e.motivo, entregas: [] };

    const envio = await this.deps.envios.obtener(e.envioId, { incluirBorrados: true });
    // R19/R21: apagado o borrado entre la creacion de la ejecucion y su turno -> no envia. La
    // prueba (R39) funciona apagado; uno borrado no se prueba (la accion ya lo filtra).
    if (envio === null || envio.deletedAt !== null || (e.origen !== "prueba" && !envio.encendido)) {
      return this.terminar(e.id, "omitida", MOTIVOS.apagado);
    }
    await this.deps.ejecuciones.cambiarEstado(e.id, "generando");

    // R34: la configuracion guardada se re-valida AL EJECUTAR.
    const informe = this.informe(envio.informeClave);
    if (informe === null) return this.terminar(e.id, "error", MOTIVOS.informe);
    const plantilla = await this.deps.plantillas.findEnviableDeInformeById(envio.plantillaId, envio.informeClave);
    if (plantilla === null) return this.terminar(e.id, "error", MOTIVOS.plantilla);
    const params = informe.parametros.safeParse(envio.parametros);
    if (!params.success) return this.terminar(e.id, "error", MOTIVOS.parametros);

    // R28/R30/R39: destinatarios resueltos AHORA; prueba -> solo quien pulsa.
    const destinatarios =
      e.origen === "prueba"
        ? opts.destinatarioPrueba !== undefined
          ? [opts.destinatarioPrueba]
          : []
        : await this.deps.envios.resolverDestinatarios(envio.id, ROLES_PERMITIDOS);
    if (destinatarios.length === 0) return this.terminar(e.id, "sin_destinatarios", null);

    // R31/R32/R33/R35: el contenido se fija UNA vez; un reintento lo reutiliza.
    let fila: EjecucionFila = e;
    let pdfBytes: Uint8Array | null = null;
    if (fila.valores === null) {
      const r = await informe.generar({
        parametros: params.data,
        ahora: this.now(),
        conDocumento: plantilla.llevaDocumento,
        ...(e.origen === "evento" && e.eventoClave !== null && e.eventoDatos !== null
          ? {
              evento: {
                clave: e.eventoClave as NotificacionEvento,
                referencia: e.eventoReferencia ?? "",
                datos: e.eventoDatos,
              },
            }
          : {}),
        ...(e.origen === "prueba" && envio.disparo === "evento" && envio.eventoClave !== null
          ? { eventoDePrueba: envio.eventoClave as NotificacionEvento }
          : {}),
      });
      if (r.tipo === "vacio") return this.terminar(e.id, "vacia", r.motivo);

      const valores: Record<string, string> = {};
      for (const clave of plantilla.variables) {
        if (clave === CLAVE_DESTINATARIO_NOMBRE) continue; // R53: por entrega
        const v = sanearValor(r.valores[clave] ?? "");
        if (v === "") return this.terminar(e.id, "error", MOTIVOS.faltaVariable(clave));
        valores[clave] = v;
      }
      if (plantilla.llevaDocumento && r.documento === undefined) {
        return this.terminar(e.id, "error", MOTIVOS.sinPdf);
      }
      let pdf: { ruta: string; nombre: string; bytes: number; caducaAt: Date } | null = null;
      if (plantilla.llevaDocumento && r.documento !== undefined) {
        // R43: ruta unica por ejecucion; si ya existe (reintento tras guardar), se reutiliza.
        const guardado = await this.guardarPdf(envio.id, e.id, r.documento.bytes);
        pdf = {
          ruta: guardado,
          nombre: r.documento.nombreArchivo,
          bytes: r.documento.bytes.byteLength,
          caducaAt: new Date(this.now().getTime() + retencionDiasPdf() * UN_DIA_MS),
        };
        pdfBytes = r.documento.bytes;
      }
      await this.deps.ejecuciones.fijarContenido(e.id, {
        valores,
        plantillaId: plantilla.id,
        plantillaNombre: plantilla.nombre,
        parametros: params.data,
        pdf,
      });
      // Si otra corrida fijo antes (carrera), manda SU contenido: se relee.
      fila = (await this.deps.ejecuciones.obtener(e.id)) ?? fila;
    }
    const valoresFijados = fila.valores ?? {};

    // Meta (perezoso): sin credencial la ejecucion queda `error` visible y el job registra el motivo.
    let meta: MetaEnvios;
    try {
      meta = this.deps.meta();
    } catch (error) {
      if (error instanceof WhatsappNoConfiguradoError) {
        const pieza = /falta ([A-Z_]+)/.exec(error.message)?.[1] ?? "credencial";
        await this.terminar(e.id, "error", MOTIVOS.noConfigurado(pieza));
        if (e.origen === "prueba") return this.resultado(e.id);
      }
      throw error;
    }

    // R33: el PDF se sube a Meta UNA vez por ejecucion (mismo PDF para todos).
    let mediaId = fila.mediaId;
    if (plantilla.llevaDocumento && mediaId === null) {
      if (fila.pdfRuta === null) return this.terminar(e.id, "error", MOTIVOS.sinPdf);
      const bytes = pdfBytes ?? (await this.deps.almacen.leer(fila.pdfRuta));
      const sub = await meta.subidor.subir({
        mime: "application/pdf",
        nombre: fila.pdfNombre ?? "documento.pdf",
        cuerpo: new Blob([bytes as BlobPart], { type: "application/pdf" }),
      });
      if (sub.status === "rechazado") return this.terminar(e.id, "error", MOTIVOS.pdfRechazado(sub.codigoMeta));
      if (sub.status === "error") {
        if (e.origen === "prueba") return this.terminar(e.id, "error", "Meta no respondió al subir el PDF. Prueba de nuevo.");
        throw new FalloReintentableEnvio("subida del PDF a Meta"); // el PDF guardado se reutiliza
      }
      mediaId = sub.mediaId;
      await this.deps.ejecuciones.fijarMediaId(e.id, mediaId);
    }

    // R23/R27/R29: entregas idempotentes por (ejecucion, usuario).
    await this.deps.ejecuciones.insertarEntregas(
      e.id,
      destinatarios.map((d) => {
        const valido = telefonoValido(d.telefono);
        return {
          usuarioId: d.usuarioId,
          destinatarioNombre: d.nombre,
          telefono: normalizarTelefonoWa(d.telefono),
          estado: valido ? "pendiente" : "telefono_invalido",
          motivo: valido ? null : MOTIVOS.telefonoInvalido,
        };
      }),
    );
    await this.deps.ejecuciones.cambiarEstado(e.id, "enviando");

    const contexto: ContextoEnvio = {
      plantilla,
      valores: valoresFijados,
      documento: plantilla.llevaDocumento && mediaId !== null ? { mediaId, nombreArchivo: fila.pdfNombre ?? "documento.pdf" } : null,
      meta,
    };
    for (const entrega of await this.deps.ejecuciones.entregasPendientes(e.id)) {
      if (!(await this.deps.ejecuciones.reclamarEntrega(entrega.id))) continue; // otra la tiene
      await this.enviarReclamada(entrega.id, entrega.destinatarioNombre, entrega.telefono, contexto, null);
    }

    await this.deps.ejecuciones.cambiarEstado(e.id, "completada", { terminada: true });
    return this.resultado(e.id);
  }

  async reintentar(entregaId: string, job: Pick<JobDTO, "intentos" | "maxIntentos">): Promise<void> {
    const entrega = await this.deps.ejecuciones.obtenerEntrega(entregaId);
    if (entrega === null || entrega.estado !== "pendiente") return;
    const e = await this.deps.ejecuciones.obtener(entrega.ejecucionId);
    if (e === null || e.valores === null) return;
    const envio = await this.deps.envios.obtener(e.envioId, { incluirBorrados: true });
    if (envio === null) return;
    const plantilla = await this.deps.plantillas.findEnviableDeInformeById(e.plantillaId ?? envio.plantillaId, envio.informeClave);
    if (!(await this.deps.ejecuciones.reclamarEntrega(entregaId))) return;
    if (plantilla === null) {
      await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "rechazo_permanente", codigoMeta: null, motivo: MOTIVOS.plantilla });
      return;
    }
    let meta: MetaEnvios;
    try {
      meta = this.deps.meta();
    } catch (error) {
      await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "pendiente", motivo: "WhatsApp no está configurado." });
      throw error;
    }
    const documento =
      plantilla.llevaDocumento && e.mediaId !== null ? { mediaId: e.mediaId, nombreArchivo: e.pdfNombre ?? "documento.pdf" } : null;
    await this.enviarReclamada(
      entregaId,
      entrega.destinatarioNombre,
      entrega.telefono,
      { plantilla, valores: e.valores, documento, meta },
      job,
    );
  }

  async probar(
    envioId: string,
    actor: Actor,
  ): Promise<ProbarEnvioResultado | { status: "forbidden" } | { status: "not_found" }> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" }; // R1
    const envio = await this.deps.envios.obtener(envioId);
    if (envio === null) return { status: "not_found" };

    // R41: ventana anti doble clic, por (usuario, envio), ANTES de crear nada.
    const ultima = await this.deps.ejecuciones.ultimaPruebaDe(actor.usuarioId, envioId);
    if (ultima !== null) {
      const transcurrido = this.now().getTime() - ultima.getTime();
      if (transcurrido < VENTANA_PRUEBA_MS) {
        return { status: "demasiado_pronto", segundosRestantes: Math.ceil((VENTANA_PRUEBA_MS - transcurrido) / 1000) };
      }
    }
    // R40: el telefono de quien pulsa, validado ANTES de crear nada.
    const yo = await this.deps.envios.contactoDeUsuario(actor.usuarioId);
    if (yo === null || !telefonoValido(yo.telefono)) {
      return {
        status: "telefono_invalido",
        mensaje: "Tu teléfono no es válido para WhatsApp: corrígelo en tu perfil antes de probar.",
      };
    }
    const ejecucionId = await this.deps.ejecuciones.insertarPrueba({ envioId, solicitadaPor: actor.usuarioId });
    let r: ResultadoEjecucion;
    try {
      r = await this.ejecutar(ejecucionId, {
        destinatarioPrueba: { usuarioId: yo.id, nombre: yo.nombre, telefono: yo.telefono },
      });
    } catch (error) {
      // En linea no hay cola que reintente: el fallo queda VISIBLE en la respuesta y el historial.
      this.logger.warn(`[envios-whatsapp] prueba ${ejecucionId}: ${error instanceof Error ? error.name : "error"}`);
      await this.deps.ejecuciones.cambiarEstado(ejecucionId, "error", {
        motivo: "La prueba falló por un error temporal. Prueba de nuevo.",
        terminada: true,
      });
      r = await this.resultado(ejecucionId);
    }
    const entrega = r.entregas[0] ?? null;
    return {
      status: "ok",
      ejecucionId,
      estado: r.estado,
      motivo: r.motivo,
      entrega: entrega === null ? null : { estado: entrega.estado, motivo: entrega.motivo },
    };
  }

  // -------------------------------------------------------------------------------------------

  /** Envia UNA entrega YA RECLAMADA y registra su desenlace (R36/R37/R53). */
  private async enviarReclamada(
    entregaId: string,
    destinatarioNombre: string,
    telefono: string,
    c: ContextoEnvio,
    job: Pick<JobDTO, "intentos" | "maxIntentos"> | null,
  ): Promise<void> {
    const nombre = sanearValor(destinatarioNombre);
    if (nombre === "" && c.plantilla.variables.includes(CLAVE_DESTINATARIO_NOMBRE)) {
      await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "rechazo_permanente", codigoMeta: null, motivo: MOTIVOS.sinNombre });
      return;
    }
    const componentes = construirComponentsEnvio(
      c.plantilla.variables,
      { ...c.valores, [CLAVE_DESTINATARIO_NOMBRE]: nombre },
      c.documento !== null ? { documento: c.documento } : undefined,
    );
    let out: WhatsappEnvioOutcome;
    try {
      out = await c.meta.enviador.enviarPlantilla(
        telefono,
        c.plantilla.nombre,
        c.plantilla.templateIdioma || c.meta.idioma,
        componentes,
      );
    } catch (error) {
      // R37: resultado desconocido. Se queda `en_curso` y NO se reenvia nunca.
      this.logger.warn(`[envios-whatsapp] entrega ${entregaId}: resultado desconocido (${error instanceof Error ? error.name : "error"})`);
      return;
    }
    if (out.status === "ok") {
      await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "aceptada", waMessageId: out.mensajeId, ahora: this.now() });
      return;
    }
    if (out.status === "permanente") {
      await this.deps.ejecuciones.resolverEntrega(entregaId, {
        estado: "rechazo_permanente",
        codigoMeta: out.codigoMeta,
        motivo: acotarMotivo(motivoMeta(out.codigoMeta)),
      });
      return;
    }
    // Transitorio (R36).
    if (job !== null) {
      if (job.intentos >= job.maxIntentos) {
        await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "fallida", motivo: MOTIVO_TRANSITORIO_AGOTADO });
        return;
      }
      await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "pendiente", motivo: "Error temporal de Meta: se reintentará." });
      throw new FalloReintentableEnvio("transitorio de Meta"); // backoff de la cola
    }
    await this.deps.ejecuciones.resolverEntrega(entregaId, { estado: "pendiente", motivo: "Error temporal de Meta: se reintentará." });
    await this.deps.cola.enqueue("whatsapp_envio_reintento", { entregaId }, {
      dedupeKey: dedupeKeyReintento(entregaId),
      maxIntentos: MAX_INTENTOS_REINTENTO,
    });
  }

  /**
   * Guarda el PDF. Si la ruta ya existe —una corrida anterior lo guardo y murio antes de fijar el
   * contenido— NO se sobrescribe (R43): se reutiliza el objeto guardado.
   */
  private async guardarPdf(envioId: string, ejecucionId: string, bytes: Uint8Array): Promise<string> {
    try {
      const { ruta } = await this.deps.almacen.guardar(envioId, ejecucionId, bytes);
      return ruta;
    } catch (error) {
      if (error instanceof PdfYaGuardadoError) return error.ruta;
      throw error;
    }
  }

  private async terminar(id: string, estado: "omitida" | "error" | "vacia" | "sin_destinatarios", motivo: string | null): Promise<ResultadoEjecucion> {
    await this.deps.ejecuciones.cambiarEstado(id, estado, {
      motivo: motivo === null ? null : acotarMotivo(motivo),
      terminada: true,
    });
    return { estado, motivo, entregas: [] };
  }

  private async resultado(id: string): Promise<ResultadoEjecucion> {
    const e = await this.deps.ejecuciones.obtener(id);
    const det = await this.deps.ejecuciones.detalle(id);
    return {
      estado: e?.estado ?? "error",
      motivo: e?.motivo ?? null,
      entregas: (det?.entregas ?? []).map((x) => ({ usuarioId: null, estado: x.estado, motivo: x.motivo })),
    };
  }
}

interface ContextoEnvio {
  plantilla: PlantillaEnviableDeInforme;
  valores: Record<string, string>;
  documento: { mediaId: string; nombreArchivo: string } | null;
  meta: MetaEnvios;
}
