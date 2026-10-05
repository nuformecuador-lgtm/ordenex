import { vi, type Mock } from "vitest";
import type { RolValue } from "@prisma/client";
import type {
  DestinatarioResuelto,
  EnvioDetalle,
  IWhatsappEnvioRepository,
} from "@/lib/interfaces/repositories/IWhatsappEnvioRepository";
import type {
  EjecucionFila,
  EntregaFila,
  IWhatsappEjecucionRepository,
} from "@/lib/interfaces/repositories/IWhatsappEjecucionRepository";
import type { PlantillaEnviableDeInforme } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

// Ficha 474 — dobles de los tests unitarios de los services de envios. NO es un archivo de test.

export const MAESTRO = { usuarioId: "m1", rol: "maestro" as const };

export function envio(o: Partial<EnvioDetalle> = {}): EnvioDetalle {
  return {
    id: "env-1",
    nombre: "Informe 05:00",
    informeClave: "prueba_envio",
    plantillaId: "pl-1",
    plantillaNombre: "prueba_doc",
    parametros: { simularVacio: false },
    disparo: "hora_fija",
    diasSemana: [1, 2, 3, 4, 5],
    hora: "05:00",
    eventoClave: null,
    encendido: false,
    destinatarios: { roles: ["admin"], usuarioIds: [] },
    createdAt: new Date("2026-10-01"),
    updatedAt: new Date("2026-10-01"),
    deletedAt: null,
    ...o,
  };
}

export function plantilla(o: Partial<PlantillaEnviableDeInforme> = {}): PlantillaEnviableDeInforme {
  return {
    id: "pl-1",
    nombre: "prueba_doc",
    cuerpo: "Buenos días {{destinatario_nombre}}, {{fecha}} {{hora}}",
    variables: ["destinatario_nombre", "fecha", "hora"],
    templateId: "tpl",
    templateIdioma: "es",
    informeClave: "prueba_envio",
    llevaDocumento: false,
    ...o,
  };
}

export function destinatario(o: Partial<DestinatarioResuelto> = {}): DestinatarioResuelto {
  return { usuarioId: "u1", nombre: "Daniel", telefono: "88887777", rol: "admin", ...o };
}

/** Cada metodo del repositorio como `Mock` de su propia firma (los tests leen `.mock.calls`). */
export type EnviosRepoDoble = { [K in keyof IWhatsappEnvioRepository]: Mock<IWhatsappEnvioRepository[K]> };

export function enviosRepo(o: Partial<Record<keyof IWhatsappEnvioRepository, unknown>> = {}): EnviosRepoDoble {
  const base = {
    crear: vi.fn(async () => envio()),
    actualizar: vi.fn(async () => envio()),
    obtener: vi.fn(async () => envio()),
    listar: vi.fn(async () => [envio()]),
    cambiarEncendido: vi.fn(async () => true),
    borrar: vi.fn(async () => true),
    resolverDestinatariosDe: vi.fn(async () => [destinatario()]),
    resolverDestinatarios: vi.fn(async () => [destinatario()]),
    rolesDeUsuarios: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, rol: "admin" as RolValue }))),
    contactoDeUsuario: vi.fn(async (id: string) => ({ id, nombre: "Carlos", telefono: "88881111" })),
    nombresEncendidosConPlantilla: vi.fn(async () => []),
    hayEncendidosConEvento: vi.fn(async () => false),
    encendidosConEvento: vi.fn(async () => []),
    encendidosHoraFijaSinJobPendiente: vi.fn(async () => []),
    jobsProgramadosPendientes: vi.fn(async () => []),
    ...o,
  };
  return base as unknown as EnviosRepoDoble;
}

export function ejecucionFila(o: Partial<EjecucionFila> = {}): EjecucionFila {
  return {
    id: "ej-1",
    envioId: "env-1",
    origen: "programado",
    fechaCr: "2026-10-05",
    instanteProgramado: new Date("2026-10-05T11:00:00Z"),
    eventoClave: null,
    eventoReferencia: null,
    eventoDatos: null,
    notificacionId: null,
    solicitadaPor: null,
    estado: "pendiente",
    motivo: null,
    plantillaId: null,
    plantillaNombre: null,
    valores: null,
    pdfRuta: null,
    pdfNombre: null,
    mediaId: null,
    createdAt: new Date("2026-10-05T11:00:00Z"),
    ...o,
  };
}

/**
 * Doble de ejecuciones CON ESTADO: guarda la ejecucion y sus entregas en memoria y aplica las
 * mismas reglas condicionales que el SQL real (reclamo solo desde `pendiente`, desenlace solo desde
 * `en_curso`, contenido fijado una vez). El SQL de verdad lo prueban los tests de integracion.
 */
export function ejecucionesRepo(inicial: EjecucionFila = ejecucionFila()) {
  let fila: EjecucionFila = { ...inicial };
  const entregas = new Map<string, EntregaFila & { waMessageId?: string; codigoMeta?: number | null }>();
  let n = 0;
  const base = {
    insertarProgramada: vi.fn(async () => ({ id: fila.id, creada: true })),
    insertarEvento: vi.fn(async () => ({ id: fila.id, creada: true })),
    insertarPrueba: vi.fn(async (d: { envioId: string; solicitadaPor: string }) => {
      fila = { ...ejecucionFila({ id: "ej-prueba", origen: "prueba", envioId: d.envioId, solicitadaPor: d.solicitadaPor, fechaCr: null }) };
      return fila.id;
    }),
    obtener: vi.fn(async () => ({ ...fila })),
    cambiarEstado: vi.fn(async (_id: string, estado: EjecucionFila["estado"], opts?: { motivo?: string | null }) => {
      fila = { ...fila, estado, ...(opts?.motivo !== undefined ? { motivo: opts.motivo } : {}) };
    }),
    fijarContenido: vi.fn(async (_id: string, d: { valores: Record<string, string>; plantillaId: string; plantillaNombre: string; pdf: { ruta: string; nombre: string } | null }) => {
      if (fila.valores !== null) return false;
      fila = { ...fila, valores: d.valores, plantillaId: d.plantillaId, plantillaNombre: d.plantillaNombre, pdfRuta: d.pdf?.ruta ?? null, pdfNombre: d.pdf?.nombre ?? null };
      return true;
    }),
    fijarMediaId: vi.fn(async (_id: string, mediaId: string) => {
      fila = { ...fila, mediaId };
    }),
    insertarEntregas: vi.fn(async (_id: string, nuevas: { usuarioId: string; destinatarioNombre: string; telefono: string; estado: "pendiente" | "telefono_invalido"; motivo: string | null }[]) => {
      for (const e of nuevas) {
        if ([...entregas.values()].some((x) => x.usuarioId === e.usuarioId)) continue; // ON CONFLICT
        n += 1;
        const id = `ent-${n}`;
        entregas.set(id, { id, ejecucionId: fila.id, usuarioId: e.usuarioId, destinatarioNombre: e.destinatarioNombre, telefono: e.telefono, estado: e.estado, motivo: e.motivo, intentos: 0 });
      }
    }),
    entregasPendientes: vi.fn(async () => [...entregas.values()].filter((e) => e.estado === "pendiente").map((e) => ({ ...e }))),
    obtenerEntrega: vi.fn(async (id: string) => (entregas.has(id) ? { ...(entregas.get(id) as EntregaFila) } : null)),
    reclamarEntrega: vi.fn(async (id: string) => {
      const e = entregas.get(id);
      if (!e || e.estado !== "pendiente") return false;
      e.estado = "en_curso";
      e.intentos += 1;
      return true;
    }),
    resolverEntrega: vi.fn(async (id: string, d: { estado: EntregaFila["estado"]; motivo?: string; waMessageId?: string; codigoMeta?: number | null }) => {
      const e = entregas.get(id);
      if (!e || e.estado !== "en_curso") return false;
      e.estado = d.estado;
      e.motivo = d.motivo ?? null;
      if (d.waMessageId) e.waMessageId = d.waMessageId;
      if (d.codigoMeta !== undefined) e.codigoMeta = d.codigoMeta;
      return true;
    }),
    aplicarEstadoWebhook: vi.fn(async () => 0),
    ultimaPruebaDe: vi.fn(async (): Promise<Date | null> => null),
    historial: vi.fn(async () => ({ items: [], total: 0 })),
    detalle: vi.fn(async () => ({
      ejecucion: {} as never,
      entregas: [...entregas.values()].map((e) => ({ id: e.id, destinatarioNombre: e.destinatarioNombre, telefonoEnmascarado: "••••", estado: e.estado, motivo: e.motivo, instante: new Date() })),
    })),
    seleccionarPurga: vi.fn(async () => []),
    marcarPurgadas: vi.fn(async () => {}),
    ultimaPorEnvio: vi.fn(async () => new Map()),
    pdfDe: vi.fn(async () => null),
  };
  return {
    repo: base as unknown as IWhatsappEjecucionRepository & typeof base,
    fila: () => fila,
    entregas: () => [...entregas.values()],
    fijar: (o: Partial<EjecucionFila>) => {
      fila = { ...fila, ...o };
    },
  };
}
