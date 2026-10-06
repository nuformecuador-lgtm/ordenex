// Ficha 474 (design §4.1/§7, T7.1) — ENVIOS AUTOMATICOS POR WHATSAPP: configuracion.
//
// Reglas R1 y R11-R21. Service puro: repositorios, lector de plantillas, cola y reloj por
// constructor; ni Prisma ni Next. El motor que EJECUTA vive en `EjecucionEnvioService`.
import type { RolValue } from "@prisma/client";
import type {
  EnvioDetalle,
  GuardarEnvioData,
  IWhatsappEnvioRepository,
} from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import { EnvioNombreDuplicadoError } from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import type { IWhatsappEjecucionRepository } from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { ILectorPlantillaDeInforme } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";
import type { IJobRepository } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  Actor,
  BorrarEnvioServiceResult,
  CambioSimpleServiceResult,
  EncenderEnvioServiceResult,
  GuardarEnvioServiceResult,
  IWhatsappEnvioService,
  ListarEnviosServiceResult,
  ObtenerEnvioServiceResult,
  PreviewServiceResult,
} from "@/lib/interfaces/services/IWhatsappEnvioService";
import {
  ROLES_DESTINATARIO,
  type EnvioDetalleDTO,
  type EnvioListItemDTO,
  type EventoDisponibleDTO,
  type GuardarEnvioInput,
  type PreviewDestinatariosDTO,
  type SeleccionDestinatariosInput,
} from "@/lib/types/envios-whatsapp";
import type { InformeWhatsapp } from "@/lib/whatsapp-envios/informes/tipos";
import {
  INFORMES_WHATSAPP,
  informePorClave,
  resumenDeInforme,
  type InformeResumen,
} from "@/lib/whatsapp-envios/informes/catalogo";
import { esEventoDisponible, eventosDisponibles, perfilDeEvento } from "@/lib/whatsapp-envios/eventos";
import { encolarProximaOcurrencia } from "@/lib/whatsapp-envios/encolar";
import { diaIsoDe } from "@/lib/whatsapp-envios/proxima-ocurrencia";
import { enmascararTelefono, telefonoValido } from "@/lib/whatsapp-envios/telefono";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";
import { MAX_DESTINATARIOS } from "@/lib/config/whatsapp-envios";

// R1 (D1): SOLO `maestro`, el patron de `/configuracion` y de las plantillas.
const ALLOWED_ROLES = new Set<string>(["maestro"]);
const ROLES_PERMITIDOS: readonly RolValue[] = ROLES_DESTINATARIO;

export const MSG = {
  nombreVacio: "El nombre es obligatorio",
  informe: "Ese informe no existe",
  plantilla: "La plantilla no está aprobada, no está activa o es de otro informe",
  dias: "Elige al menos un día de la semana",
  hora: "La hora debe tener el formato HH:mm",
  soloPorEvento: "Este informe solo funciona con «Cuando pase algo»",
  evento: "Ese evento no está disponible para este informe",
  rolNoPermitido: "Ese rol no puede recibir envíos",
  usuarioNoPermitido: "Ese usuario no existe o su rol no puede recibir envíos",
  tope: `El envío supera ${MAX_DESTINATARIOS} destinatarios`,
  adminTienda: "Este informe no se puede enviar a un admin de tienda",
  sinDestinatarios: "Elige al menos un destinatario",
  noEncendibleSinTelefono: "Ningún destinatario activo tiene un teléfono válido",
} as const;

export interface WhatsappEnvioServiceDeps {
  envios: IWhatsappEnvioRepository;
  ejecuciones: Pick<IWhatsappEjecucionRepository, "ultimaPorEnvio">;
  plantillas: ILectorPlantillaDeInforme;
  cola: Pick<IJobRepository, "enqueue">;
  now?: () => Date;
  /** Catalogo inyectable (tests); por defecto el real. */
  informe?: (clave: string) => InformeWhatsapp<unknown> | null;
}

type Errores = Record<string, string[]>;

function agregar(e: Errores, campo: string, msg: string): void {
  (e[campo] ??= []).push(msg);
}

export class WhatsappEnvioService implements IWhatsappEnvioService {
  private readonly now: () => Date;
  private readonly informe: (clave: string) => InformeWhatsapp<unknown> | null;

  constructor(private readonly deps: WhatsappEnvioServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.informe = deps.informe ?? informePorClave;
  }

  async listar(actor: Actor): Promise<ListarEnviosServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const envios = await this.deps.envios.listar();
    return { status: "ok", items: await this.aListItems(envios) };
  }

  async obtener(id: string, actor: Actor): Promise<ObtenerEnvioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const envio = await this.deps.envios.obtener(id);
    if (envio === null) return { status: "not_found" };
    return { status: "ok", envio: await this.aDetalle(envio) };
  }

  async crear(input: GuardarEnvioInput, actor: Actor): Promise<GuardarEnvioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    // R13: al CREAR se precargan los defaults del informe para lo que no llegue.
    const informe = this.informe(input.informeClave);
    const conDefaults: GuardarEnvioInput =
      informe === null
        ? input
        : { ...input, parametros: { ...(informe.parametrosPorDefecto as Record<string, unknown>), ...input.parametros } };
    const validado = await this.validar(conDefaults);
    if (validado.errores !== null) return { status: "validation_error", fieldErrors: validado.errores };
    try {
      // R15: el repositorio NO escribe `activo`: nace apagado.
      const envio = await this.deps.envios.crear(this.aDatos(validado.datos, actor));
      return { status: "ok", envio: await this.aDetalle(envio) };
    } catch (error) {
      if (error instanceof EnvioNombreDuplicadoError) return { status: "conflict", campo: "nombre" };
      throw error;
    }
  }

  async actualizar(id: string, input: GuardarEnvioInput, actor: Actor): Promise<GuardarEnvioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const actual = await this.deps.envios.obtener(id);
    if (actual === null) return { status: "not_found" };
    const validado = await this.validar(input);
    if (validado.errores !== null) return { status: "validation_error", fieldErrors: validado.errores };
    let envio: EnvioDetalle | null;
    try {
      envio = await this.deps.envios.actualizar(id, this.aDatos(validado.datos, actor));
    } catch (error) {
      if (error instanceof EnvioNombreDuplicadoError) return { status: "conflict", campo: "nombre" };
      throw error;
    }
    if (envio === null) return { status: "not_found" };
    // R20: un envio ENCENDIDO a hora fija aplica la nueva programacion desde la siguiente
    // ocurrencia FUTURA. Los jobs de la hora vieja quedan obsoletos y el handler los descarta.
    if (envio.encendido) await this.encolar(envio);
    return { status: "ok", envio: await this.aDetalle(envio) };
  }

  async encender(id: string, actor: Actor): Promise<EncenderEnvioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const envio = await this.deps.envios.obtener(id);
    if (envio === null) return { status: "not_found" };

    // R18: la configuracion GUARDADA tiene que seguir siendo valida HOY (la plantilla pudo dejar
    // de estar aprobada; el esquema del informe pudo cambiar) y alguien tiene que poder recibir.
    const motivos: string[] = [];
    const v = await this.validar(this.aInput(envio));
    if (v.errores !== null) {
      for (const [campo, msgs] of Object.entries(v.errores)) for (const m of msgs) motivos.push(`${campo}: ${m}`);
    }
    const resueltos = await this.deps.envios.resolverDestinatarios(id, ROLES_PERMITIDOS);
    if (!resueltos.some((d) => telefonoValido(d.telefono))) motivos.push(MSG.noEncendibleSinTelefono);
    if (motivos.length > 0) return { status: "no_encendible", motivos };

    const ok = await this.deps.envios.cambiarEncendido(id, true, actor.usuarioId);
    if (!ok) return { status: "not_found" };
    const encendido = { ...envio, encendido: true };
    await this.encolar(encendido); // R22
    return { status: "ok", envio: await this.aDetalle(encendido) };
  }

  async apagar(id: string, actor: Actor): Promise<CambioSimpleServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    // R19: apagar NO borra los jobs ya encolados: el handler relee `activo` y no envia.
    const ok = await this.deps.envios.cambiarEncendido(id, false, actor.usuarioId);
    if (!ok) return { status: "not_found" };
    const envio = await this.deps.envios.obtener(id);
    if (envio === null) return { status: "not_found" };
    return { status: "ok", envio: await this.aDetalle(envio) };
  }

  async reprogramar(id: string, actor: Actor): Promise<CambioSimpleServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const envio = await this.deps.envios.obtener(id);
    if (envio === null) return { status: "not_found" };
    if (envio.encendido) await this.encolar(envio);
    return { status: "ok", envio: await this.aDetalle(envio) };
  }

  async borrar(id: string, actor: Actor): Promise<BorrarEnvioServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    // R21: soft delete + apagado; el historial (ejecuciones) se conserva: FK RESTRICT.
    const ok = await this.deps.envios.borrar(id, actor.usuarioId);
    return ok ? { status: "ok" } : { status: "not_found" };
  }

  async previsualizarDestinatarios(sel: SeleccionDestinatariosInput, actor: Actor): Promise<PreviewServiceResult> {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    const roles = sel.roles.filter((r) => ROLES_PERMITIDOS.includes(r));
    const resueltos = await this.deps.envios.resolverDestinatariosDe({ roles, usuarioIds: sel.usuarioIds }, ROLES_PERMITIDOS);
    return { status: "ok", preview: construirPreview(resueltos) };
  }

  listarEventosDisponibles(actor: Actor): { status: "ok"; eventos: EventoDisponibleDTO[] } | { status: "forbidden" } {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    return { status: "ok", eventos: eventosDisponibles() };
  }

  listarInformes(actor: Actor): { status: "ok"; informes: InformeResumen[] } | { status: "forbidden" } {
    if (!ALLOWED_ROLES.has(actor.rol)) return { status: "forbidden" };
    return { status: "ok", informes: [...INFORMES_WHATSAPP.values()].map(resumenDeInforme) };
  }

  // -------------------------------------------------------------------------------------------

  /** R11-R16: un error por campo. Devuelve los datos normalizados si todo es valido. */
  private async validar(
    input: GuardarEnvioInput,
  ): Promise<{ errores: Errores; datos: null } | { errores: null; datos: GuardarEnvioInput }> {
    const e: Errores = {};
    if (input.nombre.trim() === "") agregar(e, "nombre", MSG.nombreVacio);

    const informe = this.informe(input.informeClave);
    if (informe === null) {
      agregar(e, "informeClave", MSG.informe);
    } else {
      // R12: vigente, activa, con template en Meta y de ESTE informe.
      const plantilla = await this.deps.plantillas.findEnviableDeInformeById(input.plantillaId, input.informeClave);
      if (plantilla === null) agregar(e, "plantillaId", MSG.plantilla);
      if (plantilla !== null && plantilla.llevaDocumento && !informe.generaDocumento) {
        agregar(e, "plantillaId", MSG.plantilla);
      }
      // R13: un error por campo invalido.
      const p = informe.parametros.safeParse(input.parametros);
      if (!p.success) {
        for (const issue of p.error.issues) {
          const campo = issue.path.length > 0 ? `parametros.${issue.path.join(".")}` : "parametros";
          agregar(e, campo, issue.message);
        }
      }
    }

    // R11/R14: forma del disparo.
    if (input.disparo === "hora_fija") {
      const dias = [...new Set(input.diasSemana)];
      if (dias.length === 0 || dias.length !== input.diasSemana.length) agregar(e, "diasSemana", MSG.dias);
      if (input.hora === null) agregar(e, "hora", MSG.hora);
      if (informe?.soloPorEvento) agregar(e, "disparo", MSG.soloPorEvento);
    } else {
      const ev = input.eventoClave;
      if (ev === null || !esEventoDisponible(ev) || informe === null || !informe.eventos.includes(ev)) {
        agregar(e, "eventoClave", MSG.evento);
      }
    }

    // R16: roles permitidos, usuarios con rol permitido, tope, y la enmienda de adminTienda.
    const sel = input.destinatarios;
    if (sel.roles.length === 0 && sel.usuarioIds.length === 0) agregar(e, "destinatarios", MSG.sinDestinatarios);
    for (const rol of sel.roles) {
      if (!ROLES_PERMITIDOS.includes(rol)) agregar(e, "destinatarios", `${MSG.rolNoPermitido}: ${rol}`);
    }
    const usuarios = await this.deps.envios.rolesDeUsuarios([...new Set(sel.usuarioIds)]);
    const rolDe = new Map(usuarios.map((u) => [u.id, u.rol]));
    for (const id of new Set(sel.usuarioIds)) {
      const rol = rolDe.get(id);
      if (rol === undefined || !ROLES_PERMITIDOS.includes(rol)) agregar(e, "destinatarios", MSG.usuarioNoPermitido);
    }
    if (informe !== null && !informe.aptoParaAdminTienda) {
      const hayAdminTienda =
        sel.roles.includes("adminTienda") || usuarios.some((u) => u.rol === "adminTienda");
      if (hayAdminTienda) agregar(e, "destinatarios", MSG.adminTienda);
    }
    const permitidosSel = { roles: sel.roles.filter((r) => ROLES_PERMITIDOS.includes(r)), usuarioIds: sel.usuarioIds };
    const resueltos = await this.deps.envios.resolverDestinatariosDe(permitidosSel, ROLES_PERMITIDOS);
    if (resueltos.length > MAX_DESTINATARIOS) agregar(e, "destinatarios", MSG.tope);

    if (Object.keys(e).length > 0) return { errores: e, datos: null };
    // Normaliza: un disparo no arrastra los campos del otro (los CHECK de la base lo exigen).
    const datos: GuardarEnvioInput =
      input.disparo === "hora_fija"
        ? { ...input, nombre: input.nombre.trim(), diasSemana: [...input.diasSemana].sort((a, b) => a - b), eventoClave: null }
        : { ...input, nombre: input.nombre.trim(), diasSemana: [], hora: null };
    return { errores: null, datos };
  }

  private aDatos(input: GuardarEnvioInput, actor: Actor): GuardarEnvioData {
    return {
      nombre: input.nombre,
      informeClave: input.informeClave,
      plantillaId: input.plantillaId,
      parametros: input.parametros,
      disparo: input.disparo,
      diasSemana: input.diasSemana,
      hora: input.hora,
      eventoClave: input.eventoClave,
      destinatarios: { roles: input.destinatarios.roles, usuarioIds: input.destinatarios.usuarioIds },
      actorId: actor.usuarioId,
    };
  }

  private aInput(envio: EnvioDetalle): GuardarEnvioInput {
    return {
      nombre: envio.nombre,
      informeClave: envio.informeClave,
      plantillaId: envio.plantillaId,
      parametros: (envio.parametros ?? {}) as Record<string, unknown>,
      disparo: envio.disparo,
      diasSemana: envio.diasSemana,
      hora: envio.hora,
      eventoClave: envio.eventoClave,
      destinatarios: envio.destinatarios,
    };
  }

  /** R20/R22: encola la proxima ocurrencia de un envio encendido a hora fija. */
  private async encolar(envio: EnvioDetalle): Promise<void> {
    if (envio.disparo !== "hora_fija" || envio.hora === null) return;
    await encolarProximaOcurrencia(this.deps.cola, { id: envio.id, diasSemana: envio.diasSemana, hora: envio.hora }, this.now());
  }

  private async aDetalle(envio: EnvioDetalle): Promise<EnvioDetalleDTO> {
    const [item] = await this.aListItems([envio]);
    return {
      ...item,
      parametros: (envio.parametros ?? {}) as Record<string, unknown>,
      destinatarios: envio.destinatarios,
    };
  }

  /** R25: proximo envio programado (descartando jobs obsoletos) y ultima ejecucion. */
  private async aListItems(envios: EnvioDetalle[]): Promise<EnvioListItemDTO[]> {
    const ids = envios.map((e) => e.id);
    const [jobs, ultimas] = await Promise.all([
      this.deps.envios.jobsProgramadosPendientes(ids),
      this.deps.ejecuciones.ultimaPorEnvio(ids),
    ]);
    return envios.map((e) => {
      const vigentes = jobs.filter(
        (j) =>
          j.envioId === e.id &&
          j.hora === e.hora &&
          e.diasSemana.includes(diaIsoDe(j.fechaCr)),
      );
      const proxima = e.encendido && e.disparo === "hora_fija" && vigentes.length > 0 ? vigentes[0].runAfter : null;
      const perfil = e.eventoClave === null ? null : perfilDeEvento(e.eventoClave);
      return {
        id: e.id,
        nombre: e.nombre,
        informeClave: e.informeClave,
        informeNombre: this.informe(e.informeClave)?.nombre ?? e.informeClave,
        plantillaId: e.plantillaId,
        plantillaNombre: e.plantillaNombre,
        disparo: e.disparo,
        diasSemana: e.diasSemana,
        hora: e.hora,
        eventoClave: e.eventoClave,
        eventoNombre: perfil !== null && perfil.disponible ? perfil.nombre : e.eventoClave,
        activo: e.encendido,
        proximaEjecucion: proxima,
        avisoSinProxima: e.encendido && e.disparo === "hora_fija" && proxima === null,
        ultimaEjecucion: ultimas.get(e.id) ?? null,
      };
    });
  }
}

/** R17: lista deduplicada por usuario con avisos de telefono invalido y de telefono compartido. */
export function construirPreview(
  resueltos: { usuarioId: string; nombre: string; telefono: string; rol: RolValue }[],
): PreviewDestinatariosDTO {
  const normal = new Map(resueltos.map((d) => [d.usuarioId, normalizarTelefonoWa(d.telefono)]));
  const cuenta = new Map<string, number>();
  for (const d of resueltos) {
    if (!telefonoValido(d.telefono)) continue;
    const n = normal.get(d.usuarioId) as string;
    cuenta.set(n, (cuenta.get(n) ?? 0) + 1);
  }
  const avisos: string[] = [];
  const destinatarios = resueltos.map((d) => {
    const valido = telefonoValido(d.telefono);
    const n = normal.get(d.usuarioId) as string;
    const compartido = valido && (cuenta.get(n) ?? 0) > 1;
    if (!valido) avisos.push(`${d.nombre} no tiene un teléfono válido: no recibirá el mensaje.`);
    if (compartido) avisos.push(`${d.nombre} comparte teléfono con otro destinatario: ese número recibirá un mensaje por cada uno.`);
    return {
      usuarioId: d.usuarioId,
      nombre: d.nombre,
      rol: d.rol,
      telefonoEnmascarado: enmascararTelefono(n),
      telefonoValido: valido,
      telefonoCompartido: compartido,
    };
  });
  return {
    destinatarios,
    total: destinatarios.length,
    avisos,
    excedeTope: destinatarios.length > MAX_DESTINATARIOS,
    tope: MAX_DESTINATARIOS,
  };
}
