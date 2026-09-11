// FICHA 409 (T1.4, design §2) — EL CATALOGO: DONDE VIVE EL CRITERIO DE «QUE HAY QUE HACER».
//
// Hasta hoy la campana era un BUZON: lista plana, contador de NO LEIDAS y una X. Esta ficha la
// convierte en una COLA DE TRABAJO, y todo el criterio nuevo vive AQUI —declarado y exhaustivo—,
// no repartido por el componente que lo pinta.
//
// MODULO PURO: sin Prisma en runtime (solo el `type` del enum, borrado en compilacion), sin React,
// sin `next/*`, sin `@/lib/db`. Es un REQUISITO y no una comodidad: lo importan el servicio de
// listado, la guardia de rutas, el drenador de la cola de push (ficha 410) y —manana— cualquier
// otra superficie que tenga que decidir si un aviso pide accion.
//
// ---------------------------------------------------------------------------------------------
// DEFINICION NORMATIVA DE **ACCIONABLE** (de `design-notificaciones/PorRol.dc.html`)
// ---------------------------------------------------------------------------------------------
// Un aviso es accionable si y solo si (a) pide una accion, (b) tiene consecuencia si no se hace y
// (c) quien lo recibe puede resolverla. Si falla una de las tres, es INFORMATIVO. La clasificacion
// es una propiedad DECLARADA del par (evento, rol destinatario), no una intuicion del codigo que
// lo pinta.
//
// ---------------------------------------------------------------------------------------------
// DEFINICION NORMATIVA DE **ATAJO** (design §2.1bis, decision del humano del 2026-09-10)
// ---------------------------------------------------------------------------------------------
// Un aviso lleva atajo si y solo si existe UNA PANTALLA DE ESTA APP QUE ACERQUE A ESA PERSONA A
// RESOLVERLO — el sitio donde empieza su accion real, ejecute ella la transicion o no. No basta
// con que la pantalla ENSEÑE el problema: tiene que ser el INSUMO de lo que esa persona va a hacer
// a continuacion.
//
// ⚠️ EL CRITERIO NO ES «¿puede ejecutar la transicion?». Se probo esa version estrecha y se
// descarto con los dos casos enfrentados:
//
//   · `geocodificacion_caida` (maestro, admin) -> lo siguiente que hace esa persona es revisar la
//     credencial y la facturacion EN LA CONSOLA DEL PROVEEDOR. Ninguna pantalla de la app es el
//     insumo de eso: mirar la lista de direcciones sin ubicar no acerca nada a arreglar una
//     credencial de Google. **SIN BOTON** — seria una promesa falsa. Es EL UNICO accionable sin
//     atajo del catalogo, y esa singularidad es la señal correcta: cuando aparezca el segundo,
//     habra que defenderlo con esta misma tabla.
//   · `devoluciones_represadas` (maestro, admin) -> `EnvioDevolucionCentralService` declara
//     `ROL_AUTORIZADO = "adminSatelite"` (linea 19) y corta con `forbidden` a cualquier otro, asi
//     que ellos NO mueven las ordenes: LLAMAN A LA BODEGA para coordinar. Para esa llamada
//     necesitan saber CUALES son y DE QUE BODEGA, y eso es exactamente `/ordenes`. La lista es el
//     insumo de su accion, no un mirador. **CON BOTON**.
//
// Accionable y con-atajo son EJES INDEPENDIENTES: hay accionables sin atajo (uno), y nunca hay
// informativos con atajo (R19).
//
// ---------------------------------------------------------------------------------------------
// POR QUE `Record` Y NO `Partial<Record>`
// ---------------------------------------------------------------------------------------------
// Un valor NUEVO del enum **no compila** hasta que alguien decida su clase (R1). Es el mismo
// mecanismo con el que la 236 obligo a declarar el estado de cada grupo de `/novedades`, y el
// motivo por el que el inventario de eventos es cerrado desde la 146.
//
// POR QUE `porRol` Y NO UNA ENTRADA POR PAR (evento, rol): 13 eventos x 6 roles son 78 celdas, de
// las que 73 dirian lo mismo. Con `porDefecto` + excepcion, LA EXCEPCION SE LEE COMO LA DECISION
// QUE ES. Solo hay tres: `cierre_dia_vencido`, `mensajero_bloqueado_por_cierres` y
// `devoluciones_represadas`.
import type { RolValue } from "@prisma/client";
import type { NotificacionEvento } from "@/lib/types/notificacion";

/** A donde lleva el boton de un aviso, y como se llama ese boton. */
export interface AtajoDeAviso {
  /** Ruta de la app. Puede llevar `?parametro=valor`; la pagina de destino DEBE leerlo (R6). */
  readonly href: string;
  /** Nombre accesible del boton. Propio y descriptivo («Gestionar novedades», nunca «Ver»). */
  readonly etiqueta: string;
}

/**
 * Que pide un aviso a quien lo recibe. Union DISCRIMINADA a proposito: un informativo no puede
 * tener atajo ni por accidente (R19), porque su rama del tipo ni siquiera tiene el campo.
 */
export type AccionDeAviso =
  | { readonly clase: "informativa" }
  | {
      readonly clase: "accionable";
      /** `null` EXPLICITO cuando no hay pantalla que acerque a resolverlo (R3/R4). */
      readonly atajo: AtajoDeAviso | null;
      /**
       * SOLO los AGREGADOS (`novedades_sin_gestionar`, `devoluciones_represadas`): compone el
       * titulo con la cifra VIVA en el instante de la consulta (R57), no con la del instante de
       * la emision. Por eso vive en el catalogo y no en `emitir.ts`: no se persiste nunca, se
       * recalcula en cada lectura.
       */
      readonly titulo?: (n: number) => string;
    };

/** La decision para un evento: la de por defecto, y las excepciones por rol si las hay. */
export interface EntradaCatalogo {
  readonly porDefecto: AccionDeAviso;
  /** Solo cuando un mismo evento pide cosas distintas a roles distintos. Hoy son TRES. */
  readonly porRol?: Partial<Record<RolValue, AccionDeAviso>>;
  /**
   * Los roles que RECIBEN este aviso hoy, leidos de `lib/notificaciones/emitir.ts`.
   *
   * NO es decoracion y no estaba en el boceto del design: es lo que la guardia de R5 RECORRE para
   * poder afirmar «este destino existe Y ese rol lo ve». Sin el, la guardia tendria que probar los
   * seis roles contra cada destino y se pondria roja en falso (`/dashboard` no lo ve un
   * `mensajero`, y no tiene por que: no le llega ese aviso).
   */
  readonly destinatarios: readonly RolValue[];
}

/** Los dos eventos AGREGADOS: su titulo lleva una cifra VIVA y se apagan solos cuando es 0 (R55). */
export const EVENTOS_AGREGADOS = [
  "novedades_sin_gestionar",
  "devoluciones_represadas",
] as const satisfies readonly NotificacionEvento[];

export type EventoAgregado = (typeof EVENTOS_AGREGADOS)[number];

/** `true` si el aviso lleva una cifra viva que hay que resolver al leer (design §5). */
export function esEventoAgregado(evento: NotificacionEvento): evento is EventoAgregado {
  return (EVENTOS_AGREGADOS as readonly NotificacionEvento[]).includes(evento);
}

const ADMINISTRACION_CENTRAL: readonly RolValue[] = ["maestro", "admin"];

/**
 * EL CATALOGO, evento por evento. La columna «por que» de cada entrada es la decision, no un
 * adorno: es lo que hay que releer antes de cambiarla.
 */
export const CATALOGO_AVISOS: Record<NotificacionEvento, EntradaCatalogo> = {
  // 1 — Es UNA NOTIFICACION POR ORDEN. `PorRol.dc.html` la pone en «Nunca» para la tienda («cada
  // cambio de estado») y para la administracion («una notificacion por orden»). En el momento del
  // rechazo nadie decide nada; lo que si hay que hacer lo cubren los dos AGREGADOS de abajo.
  orden_rechazada: {
    porDefecto: { clase: "informativa" },
    destinatarios: ["maestro", "admin", "adminTienda", "adminSatelite"],
  },
  // 2 — Acuse de recibo. `Main.dc.html` la pinta entre las informativas.
  carga_masiva_terminada: {
    porDefecto: { clase: "informativa" },
    // El destinatario es SIEMPRE el actor que cargo: los tres roles que ven el boton de carga en
    // `/ordenes`, mas la cuenta dedicada de la API key (`app/api/ordenes/api-key/carga`).
    destinatarios: ["maestro", "admin", "adminTienda", "apiKey"],
  },
  // 3 — `PostulacionesPendientesPanel` se monta en `AdminMaestroDashboard`, que es lo que renderiza
  // `/dashboard`, visible a maestro y admin.
  postulacion_mensajero_pendiente: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/dashboard", etiqueta: "Revisar postulaciones" },
    },
    destinatarios: ADMINISTRACION_CENTRAL,
  },
  // 4 — `PostulacionRecursoPanel`, el mismo tablero.
  postulacion_recurso_pendiente: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/dashboard", etiqueta: "Revisar postulaciones" },
    },
    destinatarios: ADMINISTRACION_CENTRAL,
  },
  // 5 — Los tres roles ven ese item del menu y es donde se aprueba.
  cierre_dia_por_aprobar: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/cierres-admin", etiqueta: "Revisar cierre" },
    },
    destinatarios: ["maestro", "admin", "adminSatelite"],
  },
  // 6 — ⚠️ Q4, DECISION DEL HUMANO DEL 2026-09-10: el mockup lo pintaba como informativo y ESTABA
  // MAL. Tiene consecuencia real y personal —si el mensajero no se entera, se presenta el dia
  // equivocado—, asi que cumple las tres condiciones. `/mis-asignaciones` esta en `SIDEBAR_ITEMS`
  // para `mensajero` y redirige a `/mis-asignaciones/reparto`.
  dia_reparto_corregido: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/mis-asignaciones", etiqueta: "Ver mi reparto" },
    },
    destinatarios: ["mensajero"],
  },
  // 7 — LA PRIMERA EXCEPCION POR ROL, y es la que mejor explica por que existe `porRol`. Con un
  // cierre `vencido` la pelota esta en el tejado DEL MENSAJERO (su propio texto ya dice «hasta que
  // lo envies»): para el es accionable. La bodega NO PUEDE APROBAR LO QUE NO SE HA ENVIADO —lo
  // escribio la 271—, asi que para ella es informativo. Mismo evento, dos tejados.
  cierre_dia_vencido: {
    porDefecto: { clase: "informativa" },
    porRol: {
      mensajero: {
        clase: "accionable",
        atajo: { href: "/cierre-dia", etiqueta: "Ver mi cierre" },
      },
    },
    destinatarios: ["mensajero", "maestro", "admin", "adminSatelite"],
  },
  // 8 — LA SEGUNDA EXCEPCION. Aqui los DOS lados son accionables, pero en pantallas distintas: el
  // mensajero resuelve su cierre (`avisoBloqueo(..., { conCta: true })` ya le dice donde ir) y la
  // administracion aprueba el mas antiguo para desbloquearlo («Aprueba el mas antiguo para que
  // pueda volver a trabajar», 271). Accionable para la bodega A PROPOSITO y por decision humana
  // registrada.
  mensajero_bloqueado_por_cierres: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/cierres-admin", etiqueta: "Revisar cierres" },
    },
    porRol: {
      mensajero: {
        clase: "accionable",
        atajo: { href: "/cierre-dia", etiqueta: "Ver mi cierre" },
      },
    },
    destinatarios: ["mensajero", "maestro", "admin", "adminSatelite"],
  },
  // 9 — La 333: el maestro DECIDE la cola de cobros; el `admin` la VE pero no la decide, y por eso
  // no lo recibe. `/wallet` es maestro+admin en el menu, y el destinatario es solo el maestro.
  gasto_fijo_cobro_pendiente: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/wallet", etiqueta: "Revisar cobros" },
    },
    destinatarios: ["maestro"],
  },
  // 10 — El texto ya dice «Revisa Configuracion > API», y `/configuracion` es maestro-only.
  webhook_suscripcion_pausada: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/configuracion/api", etiqueta: "Ver suscripción" },
    },
    destinatarios: ["maestro"],
  },
  // 11 — ⚠️ EL UNICO ACCIONABLE SIN ATAJO DE TODO EL CATALOGO, Q5 confirmada por el humano. El
  // texto pide revisar la credencial y la facturacion de la cuenta del proveedor: eso se hace en
  // la consola de Google. NO HAY PANTALLA. El boton «Ver el diagnostico» del mockup es un error y
  // el humano lo corrige: un boton aqui seria una promesa falsa. Ver §2.1bis en la cabecera.
  geocodificacion_caida: {
    porDefecto: { clase: "accionable", atajo: null },
    destinatarios: ADMINISTRACION_CENTRAL,
  },
  // 12 — AGREGADO (nuevo). La pestaña se fija por URL: sin `?superficie=devolucion` el boton
  // abriria «Ayuda» —la primera pestaña de `/novedades` desde la 236— y el aviso hablaria de la
  // OTRA. El destino es el minimo que R7 exige, no un filtro completo.
  novedades_sin_gestionar: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/novedades?superficie=devolucion", etiqueta: "Gestionar novedades" },
      titulo: tituloNovedadesSinGestionar,
    },
    destinatarios: ["adminTienda"],
  },
  // 13 — AGREGADO (nuevo) Y LA TERCERA EXCEPCION POR ROL, con DOS DESTINOS PROBADOS, no
  // accidentales: el `adminSatelite` va a donde EJECUTA (`RecepcionSateliteModule` ofrece el envio
  // a central en `/recepcion-satelite/en-bodega`, y es el unico rol que el servicio autoriza a
  // hacerlo) y la administracion central a donde EMPIEZA A COORDINAR (`/ordenes`). Un solo destino
  // para los dos habria mandado a uno de ellos a una pantalla que su rol ni siquiera ve —`/ordenes`
  // hace `notFound()` al `adminSatelite`— y la guardia de R5 lo habria cazado.
  devoluciones_represadas: {
    porDefecto: {
      clase: "accionable",
      atajo: { href: "/ordenes", etiqueta: "Ver devoluciones" },
      titulo: tituloDevolucionesRepresadas,
    },
    porRol: {
      adminSatelite: {
        clase: "accionable",
        atajo: { href: "/recepcion-satelite/en-bodega", etiqueta: "Enviar a central" },
        titulo: tituloDevolucionesRepresadas,
      },
    },
    destinatarios: ["maestro", "admin", "adminSatelite"],
  },
};

/**
 * R1/R2 — que pide ESTE aviso a ESTE rol. La excepcion por rol manda; si no la hay, la de por
 * defecto. Es el UNICO punto por el que se consulta el catalogo: nadie lee `CATALOGO_AVISOS[x]` a
 * mano y se olvida del `porRol`.
 */
export function accionDeAviso(evento: NotificacionEvento, rol: RolValue): AccionDeAviso {
  const entrada = CATALOGO_AVISOS[evento];
  return entrada.porRol?.[rol] ?? entrada.porDefecto;
}

/** R8 — atajo corto: `true` si el par (evento, rol) esta declarado ACCIONABLE. */
export function esAccionable(evento: NotificacionEvento, rol: RolValue): boolean {
  return accionDeAviso(evento, rol).clase === "accionable";
}

/**
 * Titulo del aviso agregado de novedades, con la cifra VIVA. Singular y plural EXPLICITOS, como
 * `textoCargaMasivaTerminada` y `textoCobrosGastoFijoPendientes`: «1 novedades» es el texto roto
 * que ninguna suite ve y que un humano lee todos los dias.
 */
function tituloNovedadesSinGestionar(n: number): string {
  return n === 1 ? "1 novedad espera tu decisión" : `${n} novedades esperan tu decisión`;
}

/** Titulo del aviso agregado de represadas, con la cifra VIVA. Singular y plural explicitos. */
function tituloDevolucionesRepresadas(n: number): string {
  return n === 1
    ? "1 orden espera volver a su tienda"
    : `${n} órdenes esperan volver a su tienda`;
}
