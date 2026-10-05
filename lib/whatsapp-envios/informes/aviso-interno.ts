// Ficha 474 (design §2.3, R51/R52) — informe «Aviso de la app».
//
// Conecta los avisos internos (la campana) con el disparo por evento: cuando la app crea un aviso
// de un evento disponible, un envio configurado con ese evento manda su `titulo`, su `texto`, un
// `enlace` a la pantalla donde se atiende y la `fecha`/`hora` del aviso.
//
// LO QUE NO LLEVA (R51), y no por olvido: el `anexo`. En los avisos disponibles el anexo es el
// nombre del postulante o del mensajero; en la campana lo protege la autorizacion por rol, y un
// envio puede ir a cualquier rol permitido. Se excluye POR CONSTRUCCION: `DatosAviso` no tiene el
// campo. Tampoco es apto para `adminTienda` (enmienda del leader a R16).
import { z } from "zod";
import type { RolValue } from "@prisma/client";
import type { InformeWhatsapp, ResultadoInforme } from "@/lib/whatsapp-envios/informes/tipos";
import { fechaCRLegible, horaCRLegible } from "@/lib/whatsapp-envios/informes/formato";
import { eventosDisponibles, perfilDeEvento } from "@/lib/whatsapp-envios/eventos";
import { accionDeAviso } from "@/lib/notificaciones/catalogo-avisos";
import { baseUrlEnlace } from "@/lib/config/whatsapp-envios";
import type { NotificacionEvento } from "@/lib/types/notificacion";

const parametrosSchema = z.object({}).strict();
export type ParametrosAvisoInterno = z.infer<typeof parametrosSchema>;

export interface DepsAvisoInterno {
  /** Base de la app sin barra final; `null` si no hay ninguna configurada. */
  baseUrl: () => string | null;
}

/** Ruta de la pantalla donde se atiende el aviso para ESE rol; `/` si es informativo o sin atajo. */
export function rutaDeAviso(evento: NotificacionEvento, rol: RolValue): string {
  const accion = accionDeAviso(evento, rol);
  if (accion.clase === "accionable" && accion.atajo !== null) return accion.atajo.href;
  return "/";
}

function enlaceDe(base: string | null, ruta: string): string {
  if (base === null) return ""; // R32: vacio -> la ejecucion sale `error` nombrando `enlace`
  return `${base}${ruta.startsWith("/") ? ruta : `/${ruta}`}`;
}

/** Fabrica con dependencias (los tests fijan la base); el catalogo registra la de produccion. */
export function crearInformeAvisoInterno(
  deps: DepsAvisoInterno = { baseUrl: baseUrlEnlace },
): InformeWhatsapp<ParametrosAvisoInterno> {
  return {
    clave: "aviso_interno",
    nombre: "Aviso de la app",
    descripcion:
      "Manda por WhatsApp un aviso de la campana de la app cuando ocurre. Solo funciona con «Cuando pase algo».",
    parametros: parametrosSchema,
    parametrosPorDefecto: {},
    descriptores: [],
    variables: [
      { clave: "titulo", nombre: "Qué pasó", descripcion: "Nombre del evento.", ejemplo: "Cierre del día por aprobar" },
      {
        clave: "texto",
        nombre: "Texto del aviso",
        descripcion: "El texto del aviso tal como lo muestra la campana.",
        ejemplo: "Un mensajero envió su cierre del día para aprobación.",
      },
      {
        clave: "enlace",
        nombre: "Enlace a la app",
        descripcion: "Dirección de la pantalla donde se atiende el aviso.",
        ejemplo: "https://ordenex.co/cierres",
      },
      { clave: "fecha", nombre: "Fecha del aviso", descripcion: "Fecha del aviso (hora de Costa Rica).", ejemplo: "05/10/2026" },
      { clave: "hora", nombre: "Hora del aviso", descripcion: "Hora del aviso (hora de Costa Rica).", ejemplo: "05:00" },
    ],
    generaDocumento: false,
    aptoParaAdminTienda: false,
    eventos: eventosDisponibles().map((e) => e.clave),
    async generar(ctx): Promise<ResultadoInforme> {
      const base = deps.baseUrl();
      if (ctx.evento !== undefined) {
        const perfil = perfilDeEvento(ctx.evento.clave);
        if (perfil === null || !perfil.disponible) {
          return { tipo: "vacio", motivo: "El evento ya no está disponible como disparo." };
        }
        const creado = new Date(ctx.evento.datos.creadoAt);
        return {
          tipo: "contenido",
          valores: {
            titulo: perfil.nombre,
            texto: ctx.evento.datos.texto,
            enlace: enlaceDe(base, rutaDeAviso(ctx.evento.clave, ctx.evento.datos.rolFila)),
            fecha: fechaCRLegible(creado),
            hora: horaCRLegible(creado),
          },
        };
      }
      if (ctx.eventoDePrueba !== undefined) {
        // R52: titulo y texto del EJEMPLO del catalogo; el resto con su valor real del momento.
        const p = perfilDeEvento(ctx.eventoDePrueba);
        if (p === null || !p.disponible) {
          return { tipo: "vacio", motivo: "El evento ya no está disponible como disparo." };
        }
        return {
          tipo: "contenido",
          valores: {
            titulo: p.nombre,
            texto: p.ejemploTexto,
            enlace: enlaceDe(base, rutaDeAviso(ctx.eventoDePrueba, "maestro")),
            fecha: fechaCRLegible(ctx.ahora),
            hora: horaCRLegible(ctx.ahora),
          },
        };
      }
      // Cinturon: el service ya impide guardar un envio de hora fija con este informe.
      return { tipo: "vacio", motivo: "Este informe solo funciona por evento." };
    },
  };
}
