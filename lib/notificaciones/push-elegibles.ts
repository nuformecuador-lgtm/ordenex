// FICHA 410 (design §3, T2.5) — QUE MERECE SACARLE EL TELEFONO DEL BOLSILLO A ALGUIEN.
//
// Fuente: `design-notificaciones/Push.dc.html`, aprobado por el humano —«Solo la merece lo que
// tiene PLAZO o DINERO, y siempre agregada: una al dia por tipo, con el numero dentro»—.
//
// MODULO PURO: sin Prisma en runtime (solo el `type` del enum, borrado al compilar), sin React,
// sin `next/*`, sin reloj y sin DB. Lo importan el decorador del repositorio y el drenador de la
// cola.
//
// ---------------------------------------------------------------------------------------------
// LA CLAVE ES EL PAR (EVENTO, ROL DEL LECTOR), NO EL EVENTO (R4)
// ---------------------------------------------------------------------------------------------
// `cierre_dia_vencido` produce UNA fila `alert` dirigida al mensajero y TRES `warning` a bodega.
// Solo la primera se pushea: la pelota esta en el tejado del mensajero (su propio texto dice «hasta
// que lo envies») y la bodega NO PUEDE APROBAR LO QUE NO SE HA ENVIADO. Mismo evento, dos tejados,
// y solo uno merece una interrupcion.
//
// ⚠️ `rolLector` ES EL ROL DE QUIEN LEE, NO `destinatario_rol`. Los avisos del mensajero llegan
// como fila DIRIGIDA A USUARIO, con esa columna en NULL. Resolver la elegibilidad contra
// `destinatario_rol` dejaria sin push a los tres avisos del mensajero — que son justo los que
// tienen plazo.
//
// ---------------------------------------------------------------------------------------------
// POR QUE `Record` CON `satisfies` Y NO `Partial<Record>` (R2)
// ---------------------------------------------------------------------------------------------
// Un valor NUEVO del enum **no compila** hasta que alguien decida si se pushea. NO hay `default`,
// no hay `?? "no"`. Un catalogo con valor por defecto es exactamente el fallo mudo que esta familia
// de errores produce en este repositorio: el evento nuevo se queda sin push y nadie se entera. Es
// el mismo mecanismo con el que la 409 cerro su catalogo de avisos.
import type { RolValue } from "@prisma/client";
import type { NotificacionEvento } from "@/lib/types/notificacion";

/**
 * Que hace este evento en el canal de push. Union DISCRIMINADA a proposito: un evento marcado
 * «no» no puede llevar roles ni por accidente, y uno marcado «si» no puede quedarse sin ellos.
 *
 * `porQue` en la rama negativa NO es decoracion: es lo que hay que releer antes de cambiarla, y es
 * lo que convierte una ausencia en una DECISION en vez de en un olvido.
 */
export type PerfilPush =
  | { readonly push: "no"; readonly porQue: string }
  | { readonly push: "si"; readonly roles: readonly RolValue[] };

/**
 * EL CATALOGO, evento por evento y con su porque. CATORCE entradas: las once de siempre, las dos
 * que anadio la 409 y `cierre_dia_rechazado` de la 412. NUEVE son elegibles.
 */
export const PUSH_ELEGIBLE = {
  // -------------------------------------------------------------------------------------------
  // ELEGIBLES — los ocho que tienen PLAZO o DINERO
  // -------------------------------------------------------------------------------------------

  // TIENDA. El aviso AGREGADO de la 409: «5 novedades esperan tu decision». Tiene plazo (a los 5
  // dias se rechaza sola) y dinero (el flete de la devolucion), y la tienda es quien lo resuelve.
  // Solo el `adminTienda`, y el predicado de visibilidad ya lo acota A SU tienda.
  novedades_sin_gestionar: { push: "si", roles: ["adminTienda"] },

  // ADMIN Y BODEGA SATELITE. El otro agregado de la 409: ordenes represadas esperando volver.
  // ⚠️ EL `maestro` NO ESTA, Y NO ES UN OLVIDO: la tabla aprobada de `Push.dc.html` dice
  // «Para admin y bodega satelite». El maestro lo sigue viendo en su campana exactamente como hoy
  // —la 409 le emite su fila y esta ficha no la toca—; lo que no se hace es interrumpirle por una
  // cola que coordinan el admin y la bodega.
  devoluciones_represadas: { push: "si", roles: ["admin", "adminSatelite"] },

  // ADMIN Y BODEGA SATELITE. Un cierre del dia esperando aprobacion: es DINERO parado, y el
  // mensajero no vuelve a ruta hasta que alguien lo mire.
  // ⚠️ El `maestro` NO esta, y esta escrito en la lista negativa del design §3: la copia a maestro
  // de este evento es explicitamente NO elegible.
  cierre_dia_por_aprobar: { push: "si", roles: ["admin", "adminSatelite"] },

  // MENSAJERO. Quedo BLOQUEADO: no puede trabajar hasta resolverlo. Plazo y dinero a la vez.
  // Las copias a bodega de este mismo evento NO son elegibles (lista negativa del design §3).
  mensajero_bloqueado_por_cierres: { push: "si", roles: ["mensajero"] },

  // MENSAJERO. Su cierre vencio (D2, decision del humano del 2026-09-10): SI entra, y SOLO para la
  // fila dirigida a el. Las tres copias a bodega, no.
  cierre_dia_vencido: { push: "si", roles: ["mensajero"] },

  // MENSAJERO (FICHA 412, R23). Le RECHAZARON el cierre: tiene las DOS cosas que el criterio pide,
  // y no por analogia.
  //   · DINERO: el cierre es su liquidacion. Rechazado, no se le paga hasta que lo corrija, lo
  //     reenvie y se lo aprueben.
  //   · PLAZO, y de los caros: mientras siga sin aprobar, el servidor le rechaza entregar, cobrar
  //     y recibir trabajo nuevo (`estaBloqueadoPorCierres`). Cada hora que tarda en enterarse es
  //     una hora en la que no puede trabajar.
  // Es el mismo argumento con el que entraron `cierre_dia_vencido` y
  // `mensajero_bloqueado_por_cierres`.
  //
  // ⚠️ NO LLEVA NINGUN ROL, y no es un olvido: este evento NO CREA FILA DE ROL (412/R2). Su unico
  // destinatario es el mensajero, como fila dirigida a USUARIO. Y no hay riesgo de doble push por
  // el mismo hecho: en la rama del rechazo la fila de `mensajero_bloqueado_por_cierres` dirigida
  // al mensajero YA NO SE CREA (412/R17), y las copias a bodega de ese evento estan aqui arriba
  // declaradas no elegibles.
  cierre_dia_rechazado: { push: "si", roles: ["mensajero"] },

  // MENSAJERO. Le cambiaron el dia de reparto de una orden suya. Si no se entera, se presenta el
  // dia equivocado: consecuencia real, personal y con fecha.
  dia_reparto_corregido: { push: "si", roles: ["mensajero"] },

  // ⚠️⚠️ MAESTRO Y SOLO EL, Y ESTO NO ES UNA OMISION (D4, design §3.1).
  //
  // El aviso de la 401 crea DOS filas con el mismo texto, una para `maestro` y otra para `admin`.
  // Aqui solo se pushea la del maestro. A primera vista parece que falta media linea de codigo,
  // asi que queda escrito por que NO falta:
  //
  //   LA REGLA QUE GOBIERNA TODA ESTA FICHA ES QUE SE INTERRUMPE A QUIEN PUEDE RESOLVERLO.
  //
  // Lo que ese aviso pide es revisar la credencial y la facturacion de la cuenta del proveedor de
  // mapas, y eso lo hace el maestro. La 401 incluyo al `admin` en la CAMPANA con un argumento
  // distinto y tambien valido —«el admin no toca la facturacion, pero ESCALA, y para escalar
  // necesita enterarse»—, y ese aviso NO se toca: el admin lo sigue viendo al abrir la app. Lo que
  // no se hace es sacarle el telefono del bolsillo por algo que no puede arreglar.
  //
  // Anadir "admin" aqui pone ROJO un test que existe para esto. No lo «arregles».
  geocodificacion_caida: { push: "si", roles: ["maestro"] },

  // MAESTRO. Una suscripcion de webhook lleva fallando en racha y sus reintentos se espaciaron:
  // un integrador dejando de recibir es dinero que no se factura, y `/configuracion/api` es suya.
  webhook_suscripcion_pausada: { push: "si", roles: ["maestro"] },

  // -------------------------------------------------------------------------------------------
  // NO ELEGIBLES — y esta escrito para que la ausencia sea DECISION y no olvido (R3)
  // -------------------------------------------------------------------------------------------

  orden_rechazada: {
    push: "no",
    porQue:
      "UN AVISO POR ORDEN. Es exactamente lo que R3 prohibe: cuarenta rechazos serian cuarenta " +
      "interrupciones. Lo que si hay que hacer con ellas lo cubre el agregado `novedades_sin_gestionar`.",
  },
  carga_masiva_terminada: {
    push: "no",
    porQue:
      "Quien lanzo la carga esta mirando la pantalla: ya lo sabe. Un push no le adelanta nada.",
  },
  postulacion_mensajero_pendiente: {
    push: "no",
    porQue: "Cola de trabajo normal, sin plazo que venza esa noche. Se atiende al abrir la app.",
  },
  postulacion_recurso_pendiente: {
    push: "no",
    porQue: "Lo mismo: alguien ofrecio un vehiculo o una bodega. No caduca hoy.",
  },
  gasto_fijo_cobro_pendiente: {
    push: "no",
    porQue:
      "Es dinero, pero SIN PLAZO: la cola de cobros espera la decision del maestro el tiempo que " +
      "haga falta y el aviso se repite cada dia en la campana. Interrumpir por esto seria gastar " +
      "el canal en lo que no vence.",
  },
} satisfies Record<NotificacionEvento, PerfilPush>;

/**
 * R1/R4 — ¿este aviso, leido por ALGUIEN CON ESTE ROL, merece push? Es el UNICO punto por el que se
 * consulta el catalogo: nadie lee `PUSH_ELEGIBLE[x]` a mano y se olvida de mirar el rol.
 */
export function esElegiblePush(evento: NotificacionEvento, rolLector: RolValue): boolean {
  const entrada: PerfilPush = PUSH_ELEGIBLE[evento];
  return entrada.push === "si" && entrada.roles.includes(rolLector);
}

/**
 * ¿Este evento puede llegar a empujar A ALGUIEN? Puerta BARATA del decorador: sirve para no gastar
 * una sola consulta resolviendo destinatarios de `orden_rechazada`, que es el evento mas frecuente
 * del sistema y nunca se pushea.
 *
 * NO sustituye a `esElegiblePush`: decir «si» aqui solo significa «merece la pena preguntar».
 */
export function eventoPuedeEmpujar(evento: NotificacionEvento): boolean {
  return PUSH_ELEGIBLE[evento].push === "si";
}
