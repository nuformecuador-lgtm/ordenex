import type { DocumentoAyuda } from "@/lib/ayuda/documento";
import { ROLES_AYUDA } from "@/lib/ayuda/documento";
import { contextoPara, documentoDePartida } from "@/lib/asistente/contexto";
import { instruccionesDelSistema, pareceNoLoSe } from "@/lib/asistente/instrucciones";
import { hrefDeDocumento } from "@/lib/asistente/citas";
import type { DocumentoAnunciado } from "@/lib/asistente/protocolo";
import type {
  IAsistenteProvider,
  TrozoProveedor,
} from "@/lib/interfaces/external/IAsistenteProvider";
import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";
import type {
  ConsultaEntrante,
  IAsistenteService,
  RespuestaDelAsistente,
} from "@/lib/interfaces/services/IAsistenteService";
import { mensajeTopeAlcanzado } from "@/lib/config/asistente";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * ⭑ FICHA 436 (design §2, T10) — EL SERVICIO. Orquesta: rol → tope → contexto → proveedor.
 *
 * ⚠️ NO CONOCE NEXT y no toca la base salvo por el contador (R3). El catálogo entra por el
 * constructor como una FUNCIÓN, no como una lista ya leída: así el servicio no importa `fs` ni
 * `lib/ayuda/catalogo`, y el único sitio del árbol que decide de dónde salen los documentos es el
 * borde (R31). Si mañana alguien le pusiera otra fuente, tendría que hacerlo donde la guardia mira.
 */

/** Cuántos caracteres del arranque se miran para decidir si dijo «no lo sé». */
const PREFIJO_PARA_LA_SENAL = 80;

export interface AsistenteServiceDeps {
  proveedor: IAsistenteProvider;
  usoRepo: IAsistenteUsoRepository;
  /** El catálogo de `docs/ayuda/**`. Inyectado: el servicio no sabe si sale de `fs` o de un doble. */
  leerCatalogo: () => Promise<DocumentoAyuda[]>;
  /** El tope diario, ya leído de la configuración por quien compone (R14/R16). */
  maxConsultasDia: number;
  /** El reloj. Inyectable para poder probar el borde de medianoche de Costa Rica. */
  ahora?: () => Date;
}

export class AsistenteService implements IAsistenteService {
  private readonly ahora: () => Date;

  constructor(private readonly deps: AsistenteServiceDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
  }

  async responder(consulta: ConsultaEntrante): Promise<RespuestaDelAsistente> {
    const { actor } = consulta;

    // ⭑ R13 — PRIMERO EL ROL, Y ANTES DE TOCAR NADA. `apiKey` es una cuenta de máquina que no
    // navega la UI y no lee documentación; un rol fuera de `ROLES_AYUDA` no tiene ningún documento
    // asignado, así que su contexto sería vacío y el asistente respondería «no lo sé» a todo
    // gastando una llamada. Se rechaza sin contar y sin llamar a nadie.
    if (!(ROLES_AYUDA as readonly string[]).includes(actor.rol)) {
      return { status: "rol_no_admitido" };
    }

    // ⭑ R15/R16 — EL TOPE SE CUENTA **ANTES** DE LLAMAR AL PROVEEDOR.
    //
    // Al revés —llamar y luego contar— una ráfaga simultánea se cuela entera antes de que nadie
    // haya contado nada, que es exactamente lo que un tope existe para impedir. El precio se dice
    // en voz alta y está escrito también en la migración: una consulta que el proveedor no llegue
    // a atender (caída, timeout, falta de credencial) TAMBIÉN gasta cupo. Con 30 al día eso es
    // ruido; que no sea una sorpresa es lo que importa.
    //
    // ⭑ R17 — **UN RECHAZO NO ES UNA CONSULTA.** El tope viaja al contador y el incremento sólo
    // ocurre por debajo de él: quien ya está en el tope y sigue insistiendo NO suma nada. Antes
    // sumaba, y como la columna `consultas` es la única telemetría que esta pieza deja (T27),
    // medir el primer día real habría dado un número inflado por los reintentos — precisamente el
    // número con el que se decide si Q2 deja de ser una pregunta.
    //
    // ⚠️ LA COMPARACIÓN SE QUEDA AQUÍ ADEMÁS DE EN EL `WHERE`, y no es duplicar por gusto: el SQL
    // decide qué se ESCRIBE (y es el único sitio donde eso se puede decidir sin una carrera), y
    // esta línea decide qué VE la persona. Con un contador que no respetara el tope —un doble, o
    // una implementación futura— el rechazo sigue saliendo de aquí.
    const fecha = fechaCalendarioCR(this.ahora());
    const consultasHoy = await this.deps.usoRepo.consumirUnaConsulta(
      actor.usuarioId,
      fecha,
      this.deps.maxConsultasDia,
    );
    if (consultasHoy === null || consultasHoy > this.deps.maxConsultasDia) {
      return {
        status: "tope_alcanzado",
        mensaje: mensajeTopeAlcanzado(this.deps.maxConsultasDia),
      };
    }

    // ⭑ R9 — EL ACOTAMIENTO POR ROL. El servicio no recibe documentos: recibe el catálogo entero y
    // el rol de la SESIÓN, y deja que el predicado del módulo de ayuda decida. Un mensajero no
    // recibe ni una línea de la ayuda de la oficina (R11).
    const catalogo = await this.deps.leerCatalogo();
    const documentos = contextoPara(catalogo, actor.rol);
    const partida = documentoDePartida(catalogo, documentos, consulta.rutaActual);

    // ⭑ R32 — EL ROL VA EN LAS INSTRUCCIONES, Y ES EL MISMO `actor.rol` QUE ACOTÓ LOS DOCUMENTOS.
    // Una sola fuente para las dos cosas: no puede pasar que el contexto sea de un rol y el texto
    // de sistema hable de otro.
    const respuesta = await this.deps.proveedor.responder({
      instrucciones: instruccionesDelSistema(actor.rol),
      documentos,
      mensajes: consulta.mensajes,
    });

    if (respuesta.status === "sin_credencial") return { status: "sin_credencial" };
    if (respuesta.status !== "ok") {
      // ⚠️ R21 — EL `detalle` SE QUEDA AQUÍ. Ya viene saneado por el adaptador (sin credencial, sin
      // URL, sin el cuerpo del proveedor), pero aun así no sube: lo que la persona ve es un mensaje
      // propio. Se registra en el servidor porque un fallo del proveedor que no deje rastro es un
      // fallo que sólo se diagnostica adivinando.
      console.error("asistente: el proveedor no atendio la consulta", {
        desenlace: respuesta.status,
        detalle: respuesta.detalle,
      });
      return { status: "proveedor_caido" };
    }

    const anunciados: DocumentoAnunciado[] = documentos.map((doc) => ({
      slug: doc.slug,
      titulo: doc.titulo,
      href: hrefDeDocumento(doc.slug),
    }));

    return {
      status: "ok",
      documentos: anunciados,
      partida,
      trozos: this.conSenalDeNoLoSe(respuesta.trozos, actor.usuarioId, fecha),
    };
  }

  /**
   * ⭑ Q5 — CUENTA LOS «no lo sé», SIN GUARDAR NI UNA LETRA.
   *
   * Pasa los trozos tal cual —no los retiene, no los reordena, no los espera: R19 sigue intacto— y
   * se queda con los primeros caracteres del arranque SÓLO EN MEMORIA. Al terminar el stream, si la
   * respuesta empezaba por «No lo sé», suma uno a un contador. Lo que se persiste es el NÚMERO; el
   * texto muere con el proceso.
   *
   * Es el único bucle de realimentación de toda la pieza: sin él nadie sabría qué documento falta
   * escribir, que es la consecuencia que Q5 puso encima de la mesa.
   */
  private async *conSenalDeNoLoSe(
    trozos: AsyncIterable<TrozoProveedor>,
    usuarioId: string,
    fecha: string,
  ): AsyncGenerator<TrozoProveedor> {
    let arranque = "";
    for await (const trozo of trozos) {
      if (trozo.tipo === "texto" && arranque.length < PREFIJO_PARA_LA_SENAL) {
        arranque = (arranque + trozo.texto).slice(0, PREFIJO_PARA_LA_SENAL);
      }
      yield trozo;
    }
    if (!pareceNoLoSe(arranque)) return;
    try {
      await this.deps.usoRepo.contarNoLoSe(usuarioId, fecha);
    } catch (error) {
      // Una señal de diagnóstico no puede tumbar una respuesta que la persona ya tiene delante.
      console.error("asistente: no se pudo anotar el «no lo se»", error);
    }
  }
}
