// FICHA 409 (T5.3 + puerta previa de la FICHA 410) — COMO SE PRESENTA UN AVISO, COMO FUNCION PURA.
//
// ⚠️ ESTE MODULO EXISTE PARA QUE LA 410 NO SE QUEDE PARADA, y por eso NO vive dentro del mapeador
// a DTO. El push al telefono lo compone el DRENADOR DE LA COLA: alli no hay sesion, no hay DTO, no
// hay React y no hay `Actor` — hay una FILA de `notificacion` y el rol de quien la va a leer. Si
// la composicion del titulo, el cuerpo y el destino solo existiera dentro de
// `NotificacionService.listar`, la 410 tendria que reimplementarla, y dos implementaciones del
// mismo texto es como la campana y el push acaban diciendo cosas distintas del mismo hecho.
//
// MODULO PURO: sin Prisma en runtime, sin React, sin `next/*`, sin `@/lib/db`, sin reloj. Lo
// importan HOY `NotificacionService.listar` (la campana) y MAÑANA el drenador de la cola de push.
//
// DE DONDE SALEN LOS TEXTOS (design §3.2). Dos casas, cada una con su proposito, ninguna
// duplicada:
//   · `lib/notificaciones/emitir.ts`         -> lo que se PERSISTE (`descripcion`, `anexo`).
//   · `lib/notificaciones/catalogo-avisos.ts` -> lo que solo se PINTA (etiqueta del boton y, en
//     los dos AGREGADOS, el titulo compuesto con la cifra VIVA). No se persiste nunca y por eso
//     no puede vivir en `emitir.ts`: se recalcula en cada lectura.
//
// POR QUE NO SE AÑADIO UNA COLUMNA `titulo` A `notificacion`: habria obligado a reescribir el
// texto de los seis emisores accionables vigentes, y dos son contrato blindado (`avisoBloqueo` se
// comparte con la pantalla del mensajero, 271/R43; el de la 403 tiene un guardia que se pone rojo
// si el texto vuelve a decir «desactivada»). Con esta regla los once emisores vigentes NO SE
// TOCAN: sus descripciones ya son una frase de titular.
import type { RolValue } from "@prisma/client";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import { accionDeAviso, esEventoAgregado } from "@/lib/notificaciones/catalogo-avisos";

/** Lo MINIMO que hace falta para presentar un aviso. Una fila y el rol de quien la lee. */
export interface FilaDeAviso {
  readonly evento: NotificacionEvento;
  /** `notificacion.descripcion` tal cual esta en la fila. */
  readonly descripcion: string;
  /** `notificacion.anexo`, o `null`. */
  readonly anexo: string | null;
  /**
   * EL ROL DE QUIEN LA VA A LEER, no la columna `destinatario_rol` de la fila.
   *
   * No son lo mismo y confundirlos rompe dos avisos: `cierre_dia_vencido` y
   * `mensajero_bloqueado_por_cierres` llegan al mensajero como fila DIRIGIDA A USUARIO, asi que su
   * `destinatario_rol` es NULL — y es justo para el mensajero para quien esos dos son accionables.
   * Quien llama resuelve el rol del lector: la campana, del actor de sesion; el drenador de la
   * 410, del usuario al que va el push.
   */
  readonly rolLector: RolValue;
  /**
   * SOLO los eventos AGREGADOS: la cifra VIVA en el instante de presentar (R57). Tres valores, y
   * los tres significan cosas distintas:
   *
   *   · un numero MAYOR QUE CERO -> el aviso esta vivo y su titulo se compone con ESA cifra;
   *   · `0` (o negativo)         -> el aviso esta APAGADO: la funcion devuelve `null` (R55). La
   *     fila no se borro ni se marco; simplemente ya no hay nada que decir;
   *   · `null` o ausente         -> LA CIFRA NO SE PUDO RESOLVER. Se presenta igual, con el texto
   *     persistido de la fila como titulo (R58: fallo hacia MOSTRAR, nunca hacia una campana en
   *     blanco). Confundir este caso con el `0` apagaria avisos vivos cada vez que una consulta
   *     fallara, que es el peor desenlace posible de esta ficha.
   *
   * En los eventos NO agregados se ignora.
   */
  readonly cifraViva?: number | null;
}

/** Lo que hace falta para pintar una tarjeta o para empujar un push. */
export interface PresentacionDeAviso {
  /** Lo que se lee en negrita / el titulo del push. */
  readonly titulo: string;
  /** La linea de contexto / el cuerpo del push. `null` cuando no hay ninguna. */
  readonly cuerpo: string | null;
  /**
   * A donde lleva. `null` cuando el aviso es informativo o cuando es accionable SIN atajo (R4) —
   * hoy solo `geocodificacion_caida`, y es deliberado: no hay pantalla de esta app que acerque a
   * arreglar una credencial en la consola del proveedor, y un boton seria una promesa falsa.
   */
  readonly destino: string | null;
}

/**
 * LA FUNCION QUE LA 410 NECESITA. Devuelve `null` cuando NO HAY NADA QUE PRESENTAR: un aviso
 * AGREGADO cuya cifra viva ya no es mayor que cero (R55). Es el caso del aviso que «se apaga
 * solo»: la fila sigue existiendo —no se borra ni se marca—, pero no hay nada que decir, asi que
 * ni se pinta, ni se cuenta, ni se empuja.
 *
 * Para todo lo demas siempre hay presentacion: un aviso sin destino es un aviso sin boton, no un
 * aviso que se calla.
 */
export function presentacionDe(fila: FilaDeAviso): PresentacionDeAviso | null {
  const accion = accionDeAviso(fila.evento, fila.rolLector);
  const destino = accion.clase === "accionable" ? (accion.atajo?.href ?? null) : null;

  const cifra = fila.cifraViva;
  if (esEventoAgregado(fila.evento) && cifra !== null && cifra !== undefined) {
    if (cifra <= 0) return null; // R55: apagado, sin que nadie lo lea, lo marque ni lo descarte
    const componer = accion.clase === "accionable" ? accion.titulo : undefined;
    return {
      // El titulo lleva la cifra VIVA (R57), no la del instante de la emision. El cuerpo es la
      // linea de contexto persistida («La mas antigua lleva 3 dias en bodega. …»).
      titulo: componer ? componer(cifra) : fila.descripcion,
      cuerpo: fila.descripcion,
      destino,
    };
  }

  // Todo lo demas —los avisos normales y el AGREGADO cuya cifra no se pudo resolver— se presenta
  // con lo que la fila ya trae persistido: el titulo es su `descripcion` (los once emisores
  // vigentes ya escriben una frase de titular) y el contexto es su `anexo`. Para el agregado sin
  // cifra esto es R58 en accion: sale, aunque sin numero, en vez de desaparecer.
  return { titulo: fila.descripcion, cuerpo: fila.anexo, destino };
}

/**
 * La etiqueta del boton del atajo para ese par (evento, rol), o `null`. Vive aqui —y no en el
 * servicio— para que quien componga una tarjeta no tenga que volver a consultar el catalogo por su
 * cuenta y arriesgarse a olvidar el `porRol`.
 */
export function etiquetaDeAtajo(evento: NotificacionEvento, rolLector: RolValue): string | null {
  const accion = accionDeAviso(evento, rolLector);
  return accion.clase === "accionable" ? (accion.atajo?.etiqueta ?? null) : null;
}
