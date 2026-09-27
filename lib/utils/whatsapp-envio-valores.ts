// Integracion WhatsApp — resolver PURO (cliente-safe) de los valores de las variables de una
// plantilla. Lo usan el envio server-side (Graph API) y el flujo wa.me del panel del mensajero,
// para que ambos rendericen el MISMO texto.
//
// EL MAPEO YA NO VIVE AQUI. Hasta hoy este archivo tenia un objeto literal de 15 entradas
// —clave -> campo de la orden, sin nombre legible, sin descripcion y sin formato— y una nota
// que decia "ampliar/ajustar aqui si el negocio define otras claves". Eso se mudo a
// `lib/types/plantilla-datos.ts`, que ademas de resolver DESCRIBE cada campo (nombre para el
// usuario, que es, ejemplo y como se formatea) y cubre la orden y el mensajero completos.
// Aqui solo quedan los dos ADAPTADORES que llevan lo que cada superficie tiene en la mano
// hasta la forma que el catalogo espera.
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { OrdenEnvioData } from "@/lib/types/whatsapp-envio";
import type { SinpeBodega } from "@/lib/utils/sinpe-bodega";
import {
  MENSAJERO_PLANTILLA_VACIO,
  resolverValoresPlantilla,
  type DatosPlantilla,
  type MensajeroPlantillaDatos,
  type OrdenPlantillaDatos,
} from "@/lib/types/plantilla-datos";

/**
 * ⭑ FICHA 429 (T12) — EL BLOQUE `negocio`, CON EL SINPE DE LA BODEGA QUE COBRA ESTA ORDEN.
 *
 * ⚠️ AQUI VIVIA `negocioDesdeEnv()`, y su desaparicion ES la garantia. Aquella leia las dos
 * variables de entorno y devolvia `""` cuando faltaban: un llamador nuevo que se olvidara de la
 * configuracion obtenia un mensaje mudo —«…al numero  a nombre de »— y nadie se enteraba, porque
 * un SINPE ausente no produce ningun error. A partir de ahora el par es un PARAMETRO OBLIGATORIO
 * y SIN DEFAULT: quien no lo aporte NO COMPILA. Esa es toda la diferencia, y es estructural.
 *
 * `urlBase` SIGUE leyendo el entorno, y no es una inconsistencia: es la unica URL que el negocio
 * publica de si mismo (el mismo origen que usa `app/layout.tsx` para el `metadataBase`) y esta
 * FUERA del alcance de esta ficha por su limite declarado nº 7. Sin ella `{{url_guia}}` sale
 * vacia, que es preferible a un enlace relativo que WhatsApp no puede abrir.
 */
export function negocioConSinpe(sinpe: SinpeBodega): DatosPlantilla["negocio"] {
  return {
    sinpeNumero: sinpe.numero,
    sinpeNombre: sinpe.nombre,
    urlBase: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };
}

/** Orden "vacia" salvo lo que la tabla exige. Base para los adaptadores parciales. */
function ordenVacia(): OrdenPlantillaDatos {
  return {
    id: "",
    numGuia: null,
    numRemision: "",
    estatusValue: null,
    destinatario: "",
    telefonoDest: "",
    direccion: null,
    producto: "",
    peso: null,
    notas: null,
    montoCobrar: null,
    cobraComision: null,
    prioridad: null,
    intentosContacto: null,
    fechaReparto: null,
    asignadoAt: null,
    createdAt: null,
    latitud: null,
    longitud: null,
    downloadUrl: null,
    tiendaNombre: null,
    zonaNombre: null,
    provinciaNombre: null,
    cantonNombre: null,
    distritoNombre: null,
  };
}

/**
 * VISTA PREVIA EN EL CLIENTE. Arma los datos con lo que la pantalla del mensajero YA tiene
 * cargado (`MiAsignacionDTO`), sin ninguna peticion.
 *
 * ES UNA APROXIMACION Y ESTA DECLARADO: el DTO del listado no lleva fechas, banderas internas
 * ni nada del mensajero, asi que esas claves se ven VACIAS en el composer y llegan RELLENAS en
 * el mensaje que recibe el cliente (el servidor las lee de la base). Quien manda es el
 * servidor. Antes esta divergencia existia igual pero solo para `{{mensajero}}` y estaba
 * escrita a mano en dos componentes; ahora es una sola funcion y se ve entera de un vistazo.
 */
export function datosPlantillaDesdeAsignacion(orden: MiAsignacionDTO): DatosPlantilla {
  return {
    orden: {
      ...ordenVacia(),
      id: orden.id,
      numGuia: orden.numGuia,
      numRemision: orden.numRemision,
      estatusValue: orden.estatusValue,
      destinatario: orden.destinatario,
      telefonoDest: orden.telefonoDest,
      direccion: orden.direccion,
      producto: orden.producto,
      peso: orden.peso,
      notas: orden.notas,
      montoCobrar: orden.montoCobrar,
      latitud: orden.latitud,
      longitud: orden.longitud,
      tiendaNombre: orden.tiendaNombre,
      zonaNombre: orden.zonaNombre,
      provinciaNombre: orden.provinciaNombre,
      cantonNombre: orden.cantonNombre,
      distritoNombre: orden.distritoNombre,
    },
    mensajero: MENSAJERO_PLANTILLA_VACIO,
    // ⭑ FICHA 429 (R13/R14/R18) — el par sale del DTO, que el SERVIDOR ya resolvio con
    // `resolverSinpeBodega`. NO se lee del entorno y NO se acepta del dispositivo: los dos campos
    // son REQUERIDOS en `MiAsignacionDTO`, asi que esta linea no puede quedarse sin dato.
    negocio: negocioConSinpe({ numero: orden.sinpeNumero, nombre: orden.sinpeNombre }),
  };
}

/**
 * Adaptador del tipo ESTRECHO heredado (`OrdenEnvioData`, 8 campos) al catalogo.
 *
 * ⚠️ HALLAZGO MEDIDO Y ANOTADO (ficha 429, design §3.1): hoy NO tiene ningun consumidor de
 * produccion —solo `tests/unit/utils/whatsapp-envio-valores.test.ts`—, aunque el comentario
 * anterior decia que lo usaba el boton wa.me. NO se borra en esta ficha (arreglar lo evidenciado,
 * no rediseñar): se le añade el parametro obligatorio y el hallazgo queda escrito aqui.
 */
export function datosPlantillaDesdeOrdenEnvio(
  orden: OrdenEnvioData,
  sinpe: SinpeBodega,
): DatosPlantilla {
  const mensajero: MensajeroPlantillaDatos =
    orden.mensajeroNombre.trim() === ""
      ? MENSAJERO_PLANTILLA_VACIO
      : { ...MENSAJERO_PLANTILLA_VACIO, nombre: orden.mensajeroNombre };
  return {
    orden: {
      ...ordenVacia(),
      destinatario: orden.destinatario,
      telefonoDest: orden.telefonoDest,
      numGuia: orden.numGuia,
      numRemision: orden.numRemision,
      producto: orden.producto,
      direccion: orden.direccion,
      montoCobrar: orden.montoCobrar,
    },
    mensajero,
    negocio: negocioConSinpe(sinpe),
  };
}

/**
 * Mapea cada variable NOMBRADA de la plantilla a su valor desde la orden.
 *
 * CAMBIO DE SALIDA (2026-08-26): `{{monto}}` y `{{total}}` ya no emiten el numero crudo
 * (`25000`) sino el importe formateado con la moneda configurada (`₡25.000`), porque ahora
 * pasan por el `transform` del catalogo. Quien necesite el crudo tiene `{{monto_crudo}}`.
 */
export function resolverValoresOrden(
  variables: string[],
  orden: OrdenEnvioData,
  sinpe: SinpeBodega,
): Record<string, string> {
  return resolverValoresPlantilla(variables, datosPlantillaDesdeOrdenEnvio(orden, sinpe));
}
