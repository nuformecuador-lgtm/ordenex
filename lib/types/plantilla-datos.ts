// Catalogo de CAMPOS disponibles para las plantillas de WhatsApp: TODA la informacion de la
// orden y del mensajero asignado, descrita en un solo sitio.
//
// POR QUE UN CATALOGO Y NO UN ACCESO GENERICO AL ROW. Hasta hoy el mapeo `{{clave}} -> valor`
// era un objeto literal de 15 entradas dentro de `lib/utils/whatsapp-envio-valores.ts`, sin
// nombre legible, sin descripcion y sin formato: `{{monto}}` emitia `String(montoCobrar)`, o
// sea `12500`, y `{{fecha_reparto}}` no existia. Lo que NO se hace —y es deliberado— es
// exponer el row de Prisma tal cual (`valores[clave] = row[clave]`): eso convertiria cualquier
// columna interna (uuids, `download_storage_path`, `busqueda_texto`) en un dato enviable a un
// cliente por WhatsApp con solo escribir su nombre, y ataria el texto de las plantillas —ya
// aprobadas por Meta— a los nombres de columna de Prisma. La lista blanca ES la frontera de
// privacidad del envio; ampliarla es agregar una fila aqui.
//
// CLIENT-SAFE. Este modulo lo importan Client Components (el chat del mensajero y el boton
// wa.me) para la vista previa, asi que NO puede importar `@prisma/client`, `@/lib/db` ni nada
// de `repositories/`. Sus dos dependencias estan elegidas por eso: `lib/config/moneda` (ya lo
// importa `pos-format.ts` desde el cliente) y `lib/types/rastreo-publico` (declara en su
// cabecera que es tipos puros justamente para poder cruzar esa frontera).

import { formatMonto } from "@/lib/config/moneda";
import { ETIQUETA_POR_HITO, hitoDeEstatus } from "@/lib/types/rastreo-publico";
import { PARAM_GUIA } from "@/app/_landing/guia-en-url";

/* -------------------------------------------------------------------------- */
/* 1. Los datos                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Datos de la ORDEN disponibles para una plantilla. Los nombres son los de Prisma —no los de
 * la columna SQL— para que `campo` en el catalogo se pueda cotejar de un vistazo contra
 * `db/schema.prisma`.
 *
 * TODO es nullable salvo lo que la tabla declara NOT NULL: la vista previa del cliente arma
 * este objeto con lo que tenga en pantalla (`MiAsignacionDTO` no lleva fechas ni banderas) y
 * el servidor lo arma completo desde la base. Un campo ausente se pinta vacio, nunca revienta.
 */
export interface OrdenPlantillaDatos {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string | null;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  peso: number | null;
  notas: string | null;
  montoCobrar: number | null;
  cobraComision: boolean | null;
  prioridad: boolean | null;
  intentosContacto: number | null;
  fechaReparto: Date | null;
  asignadoAt: Date | null;
  createdAt: Date | null;
  latitud: number | null;
  longitud: number | null;
  downloadUrl: string | null;
  tiendaNombre: string | null;
  zonaNombre: string | null;
  provinciaNombre: string | null;
  cantonNombre: string | null;
  distritoNombre: string | null;
}

/**
 * Datos del MENSAJERO asignado a la orden.
 *
 * `passwordHash` NO esta y no debe estar: es la unica columna de `usuario` excluida a
 * proposito de "toda la info del mensajero". Ninguna plantilla puede necesitarla y basta con
 * que exista en el tipo para que un `{{...}}` la vuelva enviable.
 *
 * `null` en TODOS los campos = la orden no tiene mensajero asignado, o el flujo no lo aporta
 * (la vista previa del cliente, que no conoce al mensajero: ver `datosPlantillaVacios`).
 */
export interface MensajeroPlantillaDatos {
  id: string | null;
  nombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  email: string | null;
  telefono: string | null;
  cedula: string | null;
  placa: string | null;
  vehiculoNombre: string | null;
  zonaNombre: string | null;
  estado: string | null;
}

/** Los dos bloques que alimentan una plantilla, mas lo que no sale de ninguno de los dos. */
export interface DatosPlantilla {
  orden: OrdenPlantillaDatos;
  mensajero: MensajeroPlantillaDatos;
  /**
   * Datos del NEGOCIO, no de la orden: hoy el SINPE al que el cliente transfiere. Vienen de
   * `NEXT_PUBLIC_SINPE_*` y se resuelven en el borde (server o cliente) en vez de leerse aqui,
   * para que este modulo siga siendo puro y testeable sin tocar `process.env`.
   */
  negocio: {
    sinpeNumero: string;
    sinpeNombre: string;
    /**
     * Origen publico de la app (`https://ordenex.co`), para armar enlaces que el cliente pueda
     * abrir. OPCIONAL de hecho: cadena vacia cuando `NEXT_PUBLIC_SITE_URL` no esta puesta, y
     * entonces `{{url_guia}}` sale vacia en vez de emitir un enlace roto tipo `/?guia=4321`.
     */
    urlBase: string;
  };
}

/** Mensajero "vacio": todos los campos a `null`. Para los flujos que no lo conocen. */
export const MENSAJERO_PLANTILLA_VACIO: MensajeroPlantillaDatos = {
  id: null,
  nombre: null,
  primerApellido: null,
  segundoApellido: null,
  email: null,
  telefono: null,
  cedula: null,
  placa: null,
  vehiculoNombre: null,
  zonaNombre: null,
  estado: null,
};

/* -------------------------------------------------------------------------- */
/* 2. Formateadores                                                            */
/* -------------------------------------------------------------------------- */

// Una clave sin dato se pinta SIEMPRE como cadena vacia, nunca como "null", "-" o "undefined".
// El mensaje lo lee un cliente final: un hueco pasa desapercibido, un `null` no.
const VACIO = "";

const texto = (v: string | null): string => (v === null ? VACIO : v.trim());
const numero = (v: number | null): string => (v === null ? VACIO : String(v));
const siNo = (v: boolean | null): string => (v === null ? VACIO : v ? "Sí" : "No");

/**
 * Dinero con el formato UNICO del repo (`lib/config/moneda.ts`): simbolo configurable, miles
 * con punto y SIN centimos — `₡12.500`, no `12500` ni `₡12,500.00`. Un `null` no se pinta como
 * la raya de las pantallas: en un WhatsApp esa raya no significa nada.
 */
const dinero = (v: number | null): string => (v === null ? VACIO : formatMonto(v));

/** Kilogramos, con la unidad pegada: `1.5 kg`. Mismo criterio que `pos-format.formatPeso`. */
const peso = (v: number | null): string => (v === null ? VACIO : `${v} kg`);

// Costa Rica es UTC-6 fijo (sin horario de verano), la misma constante que usa
// `lib/utils/fecha-cr.ts`. Se repite aqui —no se importa— porque aquel modulo es del camino
// de negocio y este tiene que poder correr en el navegador sin arrastrarlo.
const CR_OFFSET_MS = 6 * 60 * 60 * 1000;

const dosDigitos = (n: number): string => String(n).padStart(2, "0");

/**
 * Fecha de una columna `@db.Date` (`fecha_reparto`): se guarda a MEDIANOCHE UTC de la fecha
 * calendario de CR, asi que se leen las partes UTC TAL CUAL. Restarle las seis horas seria el
 * off-by-one que documenta `fecha-cr.ts`: el dia de reparto retrocederia uno.
 */
const fecha = (v: Date | null): string =>
  v === null
    ? VACIO
    : `${dosDigitos(v.getUTCDate())}/${dosDigitos(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;

/**
 * Fecha y hora de una columna `timestamp` (`asignado_at`, `created_at`): son INSTANTES, asi
 * que hay que traerlos a hora de Costa Rica antes de leer las partes.
 */
const fechaHora = (v: Date | null): string => {
  if (v === null) return VACIO;
  const cr = new Date(v.getTime() - CR_OFFSET_MS);
  return `${fecha(cr)} ${dosDigitos(cr.getUTCHours())}:${dosDigitos(cr.getUTCMinutes())}`;
};

/* -------------------------------------------------------------------------- */
/* 3. La forma de un campo                                                     */
/* -------------------------------------------------------------------------- */

export interface CampoPlantilla {
  /** Lo que se escribe entre llaves en el cuerpo: `{{clave}}`. Formato `[a-z0-9_]+`. */
  clave: string;
  /**
   * De DONDE sale el dato, con el nombre exacto que trae: `orden.montoCobrar`,
   * `mensajero.placa`, `env NEXT_PUBLIC_SINPE_NUMERO`. Es documentacion —lo que se cotejaria
   * contra `schema.prisma`—; el acceso real lo hace `leer`.
   */
  campo: string;
  /** Nombre claro para el usuario que arma la plantilla: `destinatario` -> "Cliente". */
  nombre: string;
  /** Que ES ese valor, en una frase. Se muestra junto al nombre en el selector. */
  descripcion: string;
  /** Un valor real, YA FORMATEADO (lo que se veria en el mensaje). Para la vista previa. */
  ejemplo: string;
  /**
   * `true` = dato personal o interno que casi nunca deberia viajar a un cliente final. No
   * bloquea nada (el catalogo describe, no decide): existe para que la UI lo marque y para
   * que una revision de privacidad pueda listarlos con un `filter`.
   */
  sensible?: boolean;
  /** Clave del campo BASE si esta entrada es un alias del mismo dato. `undefined` = campo propio. */
  aliasDe?: string;
  /** El valor CRUDO, tal como viene en `DatosPlantilla`. */
  leer(datos: DatosPlantilla): unknown;
  /** Convierte ese crudo en el texto que se envia. Puro: mismo valor -> mismo texto. */
  transform(valor: unknown): string;
}

/**
 * Constructor con inferencia: `leer` fija el tipo `V` y `transform` lo recibe ya tipado, de
 * modo que pasarle `dinero` a un campo de texto no compila. Hacia fuera el generico se borra
 * (`CampoPlantilla`) para que el catalogo sea un array homogeneo.
 */
function definir<V>(def: {
  clave: string;
  campo: string;
  nombre: string;
  descripcion: string;
  ejemplo: string;
  sensible?: boolean;
  leer: (datos: DatosPlantilla) => V;
  transform: (valor: V) => string;
}): CampoPlantilla {
  return {
    clave: def.clave,
    campo: def.campo,
    nombre: def.nombre,
    descripcion: def.descripcion,
    ejemplo: def.ejemplo,
    ...(def.sensible === true ? { sensible: true } : {}),
    leer: def.leer,
    transform: (valor: unknown) => def.transform(valor as V),
  };
}

/**
 * Alias: MISMO dato con otra clave. Conserva `campo`/`ejemplo`/`leer`/`transform` y solo cambia
 * la clave y el nombre.
 *
 * El `nombre` queda LIMPIO —sin « (alias de {{...}})»—: quien necesita saber que una entrada es
 * un alias lee `aliasDe`, que es declarativo, en vez de buscar una subcadena dentro de una
 * etiqueta de UI (feature 282, design §5.5). Colgar comportamiento de esa subcadena se rompia
 * con una coma o una traduccion; el selector filtra hoy por `c.aliasDe === undefined`.
 */
function alias(base: CampoPlantilla, clave: string, nombre: string): CampoPlantilla {
  return { ...base, clave, nombre, aliasDe: base.clave };
}

/* -------------------------------------------------------------------------- */
/* 4. El catalogo                                                              */
/* -------------------------------------------------------------------------- */

const CLIENTE = definir({
  clave: "cliente",
  campo: "orden.destinatario",
  nombre: "Cliente",
  descripcion: "Nombre de la persona que recibe el envío.",
  ejemplo: "María Rodríguez",
  leer: (d) => d.orden.destinatario,
  transform: texto,
});

const GUIA = definir({
  clave: "guia",
  campo: "orden.numGuia",
  nombre: "Número de guía",
  descripcion: "Número de guía de Ordenex. Vacío mientras la orden no la tenga asignada.",
  ejemplo: "10432",
  leer: (d) => d.orden.numGuia,
  transform: numero,
});

const REMISION = definir({
  clave: "remision",
  campo: "orden.numRemision",
  nombre: "Número de remisión",
  descripcion: "Número con el que la tienda identifica el pedido en su propio sistema.",
  ejemplo: "F-2026-0087",
  leer: (d) => d.orden.numRemision,
  transform: texto,
});

const MONTO = definir({
  clave: "monto",
  campo: "orden.montoCobrar",
  nombre: "Monto a cobrar",
  descripcion: "Lo que el cliente paga contra entrega, con símbolo y separador de miles.",
  ejemplo: "₡12.500",
  leer: (d) => d.orden.montoCobrar,
  transform: dinero,
});

const MENSAJERO = definir({
  clave: "mensajero",
  campo: "mensajero.nombre + primerApellido + segundoApellido",
  nombre: "Mensajero",
  descripcion: "Nombre completo del mensajero asignado a la orden.",
  ejemplo: "Carlos Jiménez Mora",
  leer: (d) => d.mensajero,
  transform: (m) =>
    [m.nombre, m.primerApellido, m.segundoApellido]
      .filter((parte): parte is string => Boolean(parte && parte.trim()))
      .join(" ")
      .trim(),
});

/**
 * TODOS los campos que una plantilla puede usar. El orden es el de presentacion en el
 * selector: primero lo que identifica el envio, luego el destino, el contenido, el dinero, el
 * estado, el mensajero y por ultimo los datos del negocio.
 *
 * AMPLIARLO ES AGREGAR UNA FILA, pero la fila sola no basta: el dato tiene que llegar en
 * `DatosPlantilla`, asi que hay que tocar tambien el `select` de `OrdenEnvioReader` (servidor)
 * y el armado de la vista previa (cliente). Si te saltas el segundo, la clave sale rellena en
 * el mensaje real y VACIA en el composer, que es exactamente lo que le pasaba a `{{mensajero}}`.
 */
export const CAMPOS_PLANTILLA: CampoPlantilla[] = [
  /* --- Identificacion del envio ------------------------------------------- */
  GUIA,
  alias(GUIA, "num_guia", "Número de guía"),
  REMISION,
  alias(REMISION, "num_remision", "Número de remisión"),
  definir({
    clave: "url_guia",
    campo: "orden.numGuia + env NEXT_PUBLIC_SITE_URL",
    nombre: "Enlace de rastreo",
    descripcion:
      "Enlace a la web con la guía ya escrita en el formulario de rastreo. Vacío si la orden aún no tiene guía.",
    ejemplo: "https://ordenex.co/?guia=10432",
    leer: (d) => ({ numGuia: d.orden.numGuia, base: d.negocio.urlBase }),
    // El enlace PRECARGA el primer campo del rastreo, no lo resuelve: el destinatario sigue
    // tecleando los 4 ultimos digitos de su telefono y el servidor los sigue exigiendo. Por eso
    // se puede mandar por WhatsApp sin abrir ningun oraculo. El nombre del parametro se importa
    // de `PARAM_GUIA` y no se escribe aqui: dos sitios que lo declaren son dos que pueden
    // divergir, y el que manda es el que lo LEE en la landing.
    transform: ({ numGuia, base }) => {
      if (numGuia === null || base === "") return VACIO;
      return `${base.replace(/\/+$/, "")}/?${PARAM_GUIA}=${numGuia}`;
    },
  }),

  /* --- Destinatario y destino --------------------------------------------- */
  CLIENTE,
  alias(CLIENTE, "nombre", "Cliente"),
  alias(CLIENTE, "destinatario", "Cliente"),
  definir({
    clave: "telefono",
    campo: "orden.telefonoDest",
    nombre: "Teléfono del cliente",
    descripcion: "Teléfono al que se entrega el envío (el mismo al que llega este mensaje).",
    ejemplo: "88887777",
    leer: (d) => d.orden.telefonoDest,
    transform: texto,
  }),
  definir({
    clave: "direccion",
    campo: "orden.direccion",
    nombre: "Dirección",
    descripcion: "Dirección de entrega tal como la escribió la tienda, sin la geografía.",
    ejemplo: "200 m norte de la iglesia, casa verde",
    leer: (d) => d.orden.direccion,
    transform: texto,
  }),
  definir({
    clave: "direccion_completa",
    campo: "orden.direccion + distritoNombre + cantonNombre + provinciaNombre",
    nombre: "Dirección completa",
    descripcion: "La dirección con distrito, cantón y provincia, separados por comas.",
    ejemplo: "200 m norte de la iglesia, casa verde, Carmen, San José, San José",
    leer: (d) => d.orden,
    transform: (o) =>
      [o.direccion, o.distritoNombre, o.cantonNombre, o.provinciaNombre]
        .filter((parte): parte is string => Boolean(parte && parte.trim()))
        .join(", "),
  }),
  definir({
    clave: "provincia",
    campo: "orden.provinciaNombre",
    nombre: "Provincia",
    descripcion: "Provincia de la dirección de entrega.",
    ejemplo: "San José",
    leer: (d) => d.orden.provinciaNombre,
    transform: texto,
  }),
  definir({
    clave: "canton",
    campo: "orden.cantonNombre",
    nombre: "Cantón",
    descripcion: "Cantón de la dirección de entrega.",
    ejemplo: "San José",
    leer: (d) => d.orden.cantonNombre,
    transform: texto,
  }),
  definir({
    clave: "distrito",
    campo: "orden.distritoNombre",
    nombre: "Distrito",
    descripcion: "Distrito de la dirección de entrega. Es el único opcional de la geografía.",
    ejemplo: "Carmen",
    leer: (d) => d.orden.distritoNombre,
    transform: texto,
  }),
  definir({
    clave: "zona",
    campo: "orden.zonaNombre",
    nombre: "Zona",
    descripcion: "Zona de reparto de Ordenex a la que pertenece la dirección.",
    ejemplo: "GAM Norte",
    leer: (d) => d.orden.zonaNombre,
    transform: texto,
  }),
  definir({
    clave: "mapa",
    campo: "orden.latitud + orden.longitud",
    nombre: "Enlace de ubicación",
    descripcion:
      "Enlace de Google Maps a la ubicación geocodificada. Vacío si la orden aún no se geocodificó.",
    ejemplo: "https://maps.google.com/?q=9.9333,-84.0833",
    leer: (d) => d.orden,
    transform: (o) =>
      o.latitud === null || o.longitud === null
        ? VACIO
        : `https://maps.google.com/?q=${o.latitud},${o.longitud}`,
  }),

  /* --- Contenido del envio ------------------------------------------------ */
  definir({
    clave: "producto",
    campo: "orden.producto",
    nombre: "Producto",
    descripcion: "Descripción del contenido del paquete.",
    ejemplo: "2 pares de zapatos",
    leer: (d) => d.orden.producto,
    transform: texto,
  }),
  definir({
    clave: "peso",
    campo: "orden.peso",
    nombre: "Peso",
    descripcion: "Peso declarado del paquete, en kilogramos. Vacío si la tienda no lo indicó.",
    ejemplo: "1.5 kg",
    leer: (d) => d.orden.peso,
    transform: peso,
  }),
  definir({
    clave: "notas",
    campo: "orden.notas",
    nombre: "Notas de la tienda",
    descripcion:
      "Texto libre que escribió la tienda al crear la orden. Es interno: revísalo antes de enviarlo.",
    ejemplo: "Entregar después de las 3 p.m.",
    sensible: true,
    leer: (d) => d.orden.notas,
    transform: texto,
  }),
  definir({
    clave: "tienda",
    campo: "orden.tiendaNombre",
    nombre: "Tienda",
    descripcion: "Nombre de la tienda que envía el pedido.",
    ejemplo: "Boutique Luna",
    leer: (d) => d.orden.tiendaNombre,
    transform: texto,
  }),
  definir({
    clave: "etiqueta_pdf",
    campo: "orden.downloadUrl",
    nombre: "PDF de la etiqueta",
    descripcion:
      "Enlace firmado al PDF de la etiqueta. Caduca, y solo existe en órdenes creadas por API con etiqueta individual.",
    ejemplo: "https://…/etiquetas/10432.pdf",
    sensible: true,
    leer: (d) => d.orden.downloadUrl,
    transform: texto,
  }),

  /* --- Dinero -------------------------------------------------------------- */
  MONTO,
  alias(MONTO, "total", "Monto a cobrar"),
  definir({
    clave: "monto_crudo",
    campo: "orden.montoCobrar",
    nombre: "Monto sin formato",
    descripcion:
      "El mismo monto, en crudo y sin símbolo (12500). Es lo que emitía {{monto}} antes del catálogo.",
    ejemplo: "12500",
    leer: (d) => d.orden.montoCobrar,
    transform: numero,
  }),
  definir({
    clave: "cobra_comision",
    campo: "orden.cobraComision",
    nombre: "¿Cobra comisión?",
    descripcion: "Si la orden lleva cobro de comisión COD. Dato interno de facturación.",
    ejemplo: "Sí",
    sensible: true,
    leer: (d) => d.orden.cobraComision,
    transform: siNo,
  }),

  /* --- Estado y tiempos ---------------------------------------------------- */
  definir({
    clave: "estatus",
    campo: "orden.estatusValue",
    nombre: "Estado del envío",
    descripcion:
      "Estado en el vocabulario PÚBLICO del rastreo («En reparto»), nunca el value interno de la base.",
    ejemplo: "En reparto",
    leer: (d) => d.orden.estatusValue,
    transform: (v) => (v === null ? VACIO : ETIQUETA_POR_HITO[hitoDeEstatus(v)]),
  }),
  definir({
    clave: "fecha_reparto",
    campo: "orden.fechaReparto",
    nombre: "Día de reparto",
    descripcion:
      "Día para el que está reservada la entrega. Vacío si no está reservada para un día futuro.",
    ejemplo: "26/08/2026",
    leer: (d) => d.orden.fechaReparto,
    transform: fecha,
  }),
  definir({
    clave: "fecha_asignacion",
    campo: "orden.asignadoAt",
    nombre: "Fecha de asignación",
    descripcion: "Cuándo se asignó por última vez el mensajero, en hora de Costa Rica.",
    ejemplo: "26/08/2026 08:15",
    leer: (d) => d.orden.asignadoAt,
    transform: fechaHora,
  }),
  definir({
    clave: "fecha_creacion",
    campo: "orden.createdAt",
    nombre: "Fecha de creación",
    descripcion: "Cuándo se registró la orden en Ordenex, en hora de Costa Rica.",
    ejemplo: "25/08/2026 16:40",
    leer: (d) => d.orden.createdAt,
    transform: fechaHora,
  }),
  definir({
    clave: "intentos_contacto",
    campo: "orden.intentosContacto",
    nombre: "Intentos de contacto",
    descripcion: "Cuántas veces la tienda registró un intento de contacto sobre esta orden.",
    ejemplo: "2",
    leer: (d) => d.orden.intentosContacto,
    transform: numero,
  }),
  definir({
    clave: "prioridad",
    campo: "orden.prioridad",
    nombre: "¿Es prioritaria?",
    descripcion: "Marca interna de reasignación prioritaria.",
    ejemplo: "No",
    sensible: true,
    leer: (d) => d.orden.prioridad,
    transform: siNo,
  }),
  definir({
    clave: "orden_id",
    campo: "orden.id",
    nombre: "ID interno de la orden",
    descripcion: "El uuid de la orden. No significa nada para el cliente; úsalo solo en enlaces.",
    ejemplo: "3f9a…",
    sensible: true,
    leer: (d) => d.orden.id,
    transform: texto,
  }),

  /* --- Mensajero ----------------------------------------------------------- */
  MENSAJERO,
  definir({
    clave: "mensajero_nombre",
    campo: "mensajero.nombre",
    nombre: "Nombre del mensajero",
    descripcion: "Solo el nombre de pila, sin apellidos.",
    ejemplo: "Carlos",
    leer: (d) => d.mensajero.nombre,
    transform: texto,
  }),
  definir({
    clave: "mensajero_apellidos",
    campo: "mensajero.primerApellido + segundoApellido",
    nombre: "Apellidos del mensajero",
    descripcion: "Los apellidos que tenga registrados; el segundo es opcional.",
    ejemplo: "Jiménez Mora",
    leer: (d) => d.mensajero,
    transform: (m) =>
      [m.primerApellido, m.segundoApellido]
        .filter((parte): parte is string => Boolean(parte && parte.trim()))
        .join(" ")
        .trim(),
  }),
  definir({
    clave: "mensajero_telefono",
    campo: "mensajero.telefono",
    nombre: "Teléfono del mensajero",
    descripcion: "Teléfono personal del mensajero. Dárselo al cliente es una decisión, no un detalle.",
    ejemplo: "87776655",
    sensible: true,
    leer: (d) => d.mensajero.telefono,
    transform: texto,
  }),
  definir({
    clave: "mensajero_placa",
    campo: "mensajero.placa",
    nombre: "Placa del mensajero",
    descripcion: "Placa del vehículo declarado, para que el cliente lo reconozca al llegar.",
    ejemplo: "SJB-123",
    leer: (d) => d.mensajero.placa,
    transform: texto,
  }),
  definir({
    clave: "mensajero_vehiculo",
    campo: "mensajero.vehiculoNombre",
    nombre: "Vehículo del mensajero",
    descripcion: "Tipo de vehículo declarado en la postulación.",
    ejemplo: "Motocicleta",
    leer: (d) => d.mensajero.vehiculoNombre,
    transform: texto,
  }),
  definir({
    clave: "mensajero_zona",
    campo: "mensajero.zonaNombre",
    nombre: "Zona del mensajero",
    descripcion: "Zona a la que está adscrito el mensajero.",
    ejemplo: "GAM Norte",
    leer: (d) => d.mensajero.zonaNombre,
    transform: texto,
  }),
  definir({
    clave: "mensajero_email",
    campo: "mensajero.email",
    nombre: "Correo del mensajero",
    descripcion: "Correo con el que el mensajero entra a Ordenex. Es una credencial: no lo envíes.",
    ejemplo: "carlos@ejemplo.com",
    sensible: true,
    leer: (d) => d.mensajero.email,
    transform: texto,
  }),
  definir({
    clave: "mensajero_cedula",
    campo: "mensajero.cedula",
    nombre: "Cédula del mensajero",
    descripcion: "Identificación del mensajero. Dato personal: no debería salir en un mensaje.",
    ejemplo: "1-1234-5678",
    sensible: true,
    leer: (d) => d.mensajero.cedula,
    transform: texto,
  }),
  definir({
    clave: "mensajero_estado",
    campo: "mensajero.estado",
    nombre: "Estado del mensajero",
    descripcion: "Estado de la cuenta del mensajero (activo, pendiente…). Dato interno.",
    ejemplo: "activo",
    sensible: true,
    leer: (d) => d.mensajero.estado,
    transform: texto,
  }),
  definir({
    clave: "mensajero_id",
    campo: "mensajero.id",
    nombre: "ID interno del mensajero",
    descripcion: "El uuid del usuario mensajero. No significa nada para el cliente.",
    ejemplo: "8c21…",
    sensible: true,
    leer: (d) => d.mensajero.id,
    transform: texto,
  }),

  /* --- Negocio ------------------------------------------------------------- */
  definir({
    clave: "sinpe",
    campo: "env NEXT_PUBLIC_SINPE_NUMERO",
    nombre: "SINPE del negocio",
    descripcion: "Número SINPE al que el cliente transfiere. Es configuración, no un dato de la orden.",
    ejemplo: "88881111",
    leer: (d) => d.negocio.sinpeNumero,
    transform: texto,
  }),
  definir({
    clave: "sinpe_nombre",
    campo: "env NEXT_PUBLIC_SINPE_NOMBRE",
    nombre: "Titular del SINPE",
    descripcion: "Nombre a cuyo favor está el SINPE, para que el cliente confirme antes de pagar.",
    ejemplo: "Ordenex S.A.",
    leer: (d) => d.negocio.sinpeNombre,
    transform: texto,
  }),
];

/** Indice `clave -> campo`, para resolver en O(1) y para que la UI busque por clave. */
export const CAMPOS_PLANTILLA_POR_CLAVE: ReadonlyMap<string, CampoPlantilla> = new Map(
  CAMPOS_PLANTILLA.map((campo) => [campo.clave, campo]),
);

/**
 * Un `DatosPlantilla` completo y CRUDO cuya resolucion produce, campo a campo, el `ejemplo`
 * que cada entrada del catalogo declara. Ver el test de coherencia (feature 282, R12).
 *
 * CRUDO, NO FORMATEADO, y esa es toda la gracia: lleva `montoCobrar: 12500` y no `"₡12.500"`,
 * `peso: 1.5` y no `"1.5 kg"`, `Date` y no `"26/08/2026"`. Los valores entran por `leer()` y
 * salen por `transform()`, el MISMO par que usa el envio real; si el fixture ya viniera
 * formateado, la vista previa seria una maqueta que no ejercita el formateador (design §4.1).
 *
 * El test de R12 exige igualdad ESTRICTA para TODAS las entradas, asi que este objeto y el campo
 * `ejemplo` del catalogo no pueden divergir: anadir una fila al catalogo sin extender el
 * fixture pone la suite roja. Cuando toque alinear se ajusta uno de los dos, nunca la asercion.
 *
 * Los instantes van en UTC y se leen en hora de Costa Rica (UTC-6): `14:15Z` se pinta `08:15`.
 * `fechaReparto` es `@db.Date` y se lee en UTC crudo, por eso va a medianoche Z.
 */
export const DATOS_PLANTILLA_EJEMPLO: DatosPlantilla = {
  orden: {
    id: "3f9a…",
    numGuia: 10432,
    numRemision: "F-2026-0087",
    estatusValue: "en_reparto",
    destinatario: "María Rodríguez",
    telefonoDest: "88887777",
    direccion: "200 m norte de la iglesia, casa verde",
    producto: "2 pares de zapatos",
    peso: 1.5,
    notas: "Entregar después de las 3 p.m.",
    montoCobrar: 12500,
    cobraComision: true,
    prioridad: false,
    intentosContacto: 2,
    fechaReparto: new Date("2026-08-26T00:00:00.000Z"),
    asignadoAt: new Date("2026-08-26T14:15:00.000Z"),
    createdAt: new Date("2026-08-25T22:40:00.000Z"),
    latitud: 9.9333,
    longitud: -84.0833,
    downloadUrl: "https://…/etiquetas/10432.pdf",
    tiendaNombre: "Boutique Luna",
    zonaNombre: "GAM Norte",
    provinciaNombre: "San José",
    cantonNombre: "San José",
    distritoNombre: "Carmen",
  },
  mensajero: {
    id: "8c21…",
    nombre: "Carlos",
    primerApellido: "Jiménez",
    segundoApellido: "Mora",
    email: "carlos@ejemplo.com",
    telefono: "87776655",
    cedula: "1-1234-5678",
    placa: "SJB-123",
    vehiculoNombre: "Motocicleta",
    zonaNombre: "GAM Norte",
    estado: "activo",
  },
  negocio: {
    sinpeNumero: "88881111",
    sinpeNombre: "Ordenex S.A.",
    urlBase: "https://ordenex.co",
  },
};

/* -------------------------------------------------------------------------- */
/* 5. Resolucion                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Valor YA FORMATEADO de una clave. Una clave fuera del catalogo devuelve cadena vacia: el
 * modelo de plantillas es abierto (se acepta cualquier `{{clave}}` bien formada) y una clave
 * desconocida no puede romper un envio.
 */
export function valorDeCampo(clave: string, datos: DatosPlantilla): string {
  const campo = CAMPOS_PLANTILLA_POR_CLAVE.get(clave);
  if (campo === undefined) return VACIO;
  return campo.transform(campo.leer(datos));
}

/**
 * Mapa `clave -> texto` para las variables que la plantilla DECLARA, y solo para esas. Es el
 * filtro que mantiene la promesa del envio: se leen muchos campos, pero a Meta solo viaja lo
 * que el cuerpo de la plantilla escribe.
 */
export function resolverValoresPlantilla(
  variables: string[],
  datos: DatosPlantilla,
): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const clave of variables) {
    valores[clave] = valorDeCampo(clave, datos);
  }
  return valores;
}

/** Vista previa del catalogo: cada clave con su ejemplo. Para el selector y la ayuda. */
export const EJEMPLOS_POR_CLAVE: Record<string, string> = Object.fromEntries(
  CAMPOS_PLANTILLA.map((campo) => [campo.clave, campo.ejemplo]),
);
