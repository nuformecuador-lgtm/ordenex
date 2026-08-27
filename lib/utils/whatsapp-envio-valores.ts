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
import {
  MENSAJERO_PLANTILLA_VACIO,
  resolverValoresPlantilla,
  type DatosPlantilla,
  type MensajeroPlantillaDatos,
  type OrdenPlantillaDatos,
} from "@/lib/types/plantilla-datos";

/**
 * SINPE del negocio: datos de CONFIGURACION, no de la orden. Viven en
 * `NEXT_PUBLIC_SINPE_NUMERO` / `NEXT_PUBLIC_SINPE_NOMBRE`, con `NEXT_PUBLIC_` para que se
 * resuelvan igual server-side (envio real) que client-side (flujo wa.me). Ausentes -> "".
 */
export function negocioDesdeEnv(): DatosPlantilla["negocio"] {
  return {
    sinpeNumero: process.env.NEXT_PUBLIC_SINPE_NUMERO ?? "",
    sinpeNombre: process.env.NEXT_PUBLIC_SINPE_NOMBRE ?? "",
    // Mismo origen publico que usa `app/layout.tsx` para el `metadataBase`, y por la misma
    // razon: es la unica URL que el negocio publica de si mismo. Sin ella `{{url_guia}}` sale
    // vacia — un enlace relativo no se puede abrir desde WhatsApp.
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
    negocio: negocioDesdeEnv(),
  };
}

/**
 * Adaptador del tipo ESTRECHO heredado (`OrdenEnvioData`, 8 campos) al catalogo. Sigue vivo
 * porque lo usa el boton wa.me, que no tiene mas datos que esos.
 */
export function datosPlantillaDesdeOrdenEnvio(orden: OrdenEnvioData): DatosPlantilla {
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
    negocio: negocioDesdeEnv(),
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
): Record<string, string> {
  return resolverValoresPlantilla(variables, datosPlantillaDesdeOrdenEnvio(orden));
}
