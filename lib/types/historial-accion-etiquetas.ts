import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

import type { HistorialAccionEntidad } from "@/lib/types/historial-accion";

// FICHA 362 (design §1.3-b, R4/R5) — LA FUENTE UNICA de `entidad_etiqueta`.
//
// La etiqueta se CONGELA en la fila y no se resuelve por join al leer, por tres motivos y en este
// orden de importancia:
//   1. en `tarifa_borrada` y `zona_borrada` NO HAY A QUIEN PREGUNTAR (borrado FISICO): la fila es
//      el unico sitio donde queda de que se trataba;
//   2. resolverla al leer serian hasta 17 consultas por pagina (25 filas de 17 entidades
//      distintas);
//   3. mandaria uuid a la descarga, y `columnas-sensibles.guardia` prohibe la forma uuid en una
//      celda (R38).
//
// ⚠️ Y LA REGLA QUE SOSTIENE R5: NINGUNA de estas fuentes es un dato del DESTINATARIO de una
// orden, ni texto libre tecleado por una persona. Ni `destinatario`, ni `telefono_dest`, ni
// `direccion`, ni `notas`, ni `motivo`, ni `descripcion`, ni `concepto`. `num_guia` es un
// identificador de envio de Ordenex, no un dato personal; los nombres que si entran son los de
// OPERADORES (mensajero, tienda, actor), que es justo lo que la fila viene a registrar. Lo vigila
// `tests/unit/guards/historial-accion-sin-datos-cliente.guardia.test.ts`.
//
// Modulo PURO: sin Prisma, sin React, sin `lib/services`.

/** Anchura de la columna `entidad_etiqueta`. Se trunca AQUI, en la fuente. */
export const ETIQUETA_MAX_CHARS = 120;

/** Lo que se pinta cuando una orden no tiene ni guia ni remision. Nunca cadena vacia. */
export const ETIQUETA_ORDEN_SIN_GUIA = "(sin guía)";

/** Lo que se pinta cuando la fuente de la etiqueta no da nada legible. Nunca cadena vacia. */
export const ETIQUETA_DESCONOCIDA = "(sin identificar)";

/**
 * Una orden, una gestion, un incidente y un cobro por rechazo se etiquetan por su envio.
 *
 * `numGuia` es `Int?` en la base (se asigna al generar la guia) y `numRemision` es `String` NOT
 * NULL, pero aqui se admite nulo en las dos: hay lecturas que no traen la remision, y una etiqueta
 * que no puede expresar «no lo se» acaba escribiendo `"null"` en una celda.
 */
export interface FuenteEnvio {
  numGuia: number | string | null;
  numRemision: string | null;
}

/** Una persona del sistema: operador, mensajero o tienda. Nunca el destinatario de una orden. */
export interface FuentePersona {
  nombre: string;
  primerApellido?: string | null;
}

/**
 * La fuente de la etiqueta, POR TIPO DE ENTIDAD. El mapa es exhaustivo sobre
 * `HistorialAccionEntidad` y por eso el compilador obliga a declarar la fuente de una entidad
 * nueva antes de poder escribirla.
 */
export interface FuentesEtiqueta {
  orden: FuenteEnvio;
  usuario: FuentePersona;
  /** Una tarifa se identifica por a QUIEN aplica, no por sus diez importes. */
  tarifa: { zonaNombre: string | null; tiendaNombre: string | null };
  zona: { nombre: string };
  vehiculo: { nombre: string };
  plantilla_mensaje: { nombre: string };
  cierre_dia: { mensajeroNombre: string | null; fecha: Date };
  cierre_bodega: { zonaNombre: string | null; fecha: Date };
  gestion_orden: FuenteEnvio;
  liquidacion_pago: { beneficiarioNombre: string | null };
  liquidacion_reparto: { beneficiarioNombre: string | null };
  /**
   * El movimiento de caja se etiqueta por su CATEGORIA (un enum), no por su `descripcion`: esa
   * columna es texto libre y R5 la deja fuera.
   */
  wallet_movimiento: { categoria: string };
  orden_incidente: FuenteEnvio;
  /**
   * El cobro de gasto fijo se etiqueta por su CONCEPTO y su PERIODO («Alquiler bodega · 2026-09»).
   *
   * ⚠️ EL `concepto` ENTRA, Y HAY QUE JUSTIFICARLO CONTRA R5. Es una etiqueta de CATALOGO copiada
   * de la plantilla del gasto recurrente —del mismo genero que el nombre de una zona o de un
   * vehiculo—, no un texto por transaccion como el `motivo` de un rechazo. Por construccion no
   * puede contener datos de un destinatario: la plantilla se crea una vez, para un gasto fijo de
   * la casa, y no la toca nadie al cobrar. Sin el, la fila diria «2026-09» y no serviria para lo
   * unico que existe: saber QUE se aprobo.
   */
  gasto_fijo_cobro: { concepto: string; periodo: string };
  rechazo_tienda_cobro: FuenteEnvio;
  ranking_snapshot_fila: { mensajeroNombre: string; puesto: number };
  /**
   * ⚠️ El identificador VISIBLE de la key y nada mas. NUNCA el secreto, ni `key_hash`, ni
   * `key_prefix`: un prefijo es media credencial y no tiene por que vivir en un registro que se
   * descarga a un archivo.
   */
  api_key: { identificador: string };
}

/**
 * Recorta y garantiza que nunca sale una etiqueta vacia.
 *
 * Admite `null`/`undefined` A PROPOSITO aunque el tipo de entrada sea `string`: la etiqueta se
 * compone de columnas que en la base son NOT NULL, pero se leen por relaciones que una carrera
 * —o una fila huerfana de una migracion vieja— puede dejar sin resolver. Una etiqueta ilegible es
 * un defecto menor; que la falta de etiqueta TUMBE el borrado de una orden es un defecto grave, y
 * es la clase de fallo que esta ficha viene a evitar, no a introducir.
 */
function limpiar(texto: string | null | undefined): string {
  const recortado = (texto ?? "").trim().replace(/\s+/g, " ");
  return recortado === "" ? ETIQUETA_DESCONOCIDA : recortado.slice(0, ETIQUETA_MAX_CHARS);
}

/** Une las partes que existen con el separador de la casa, saltandose las vacias. */
function unir(...partes: (string | null | undefined)[]): string {
  return limpiar(partes.filter((p): p is string => p != null && p.trim() !== "").join(" · "));
}

/** Guia, y si no hay, remision, y si no hay ninguna, el respaldo declarado. */
function etiquetaDeEnvio(fila: FuenteEnvio | null | undefined): string {
  const identificador = fila?.numGuia ?? fila?.numRemision ?? null;
  const texto = identificador == null ? "" : String(identificador).trim();
  return texto === "" ? ETIQUETA_ORDEN_SIN_GUIA : limpiar(texto);
}

/**
 * Nombre y primer apellido de un OPERADOR. Nunca de un destinatario.
 *
 * Se une con un ESPACIO y no con el separador de la casa: «Ana · Torres» no es un nombre, y este
 * texto es el mismo que la fila congela en `actor_nombre` — donde `resolverActorCongelado` tambien
 * une con espacio. Dos formas del mismo nombre en la misma tabla serian dos personas al buscar.
 */
export function etiquetaDePersona(persona: FuentePersona | null | undefined): string {
  return limpiar(
    [persona?.nombre, persona?.primerApellido]
      .filter((p) => p != null && p.trim() !== "")
      .join(" "),
  );
}

/** Un caso por entidad; el mapa es exhaustivo por construccion del tipo. */
const CONSTRUCTORES: {
  [E in HistorialAccionEntidad]: (fila: FuentesEtiqueta[E]) => string;
} = {
  orden: etiquetaDeEnvio,
  usuario: etiquetaDePersona,
  tarifa: (f) =>
    f?.zonaNombre == null && f?.tiendaNombre == null
      ? "Tarifa general"
      : unir(f.zonaNombre, f.tiendaNombre),
  zona: (f) => limpiar(f?.nombre),
  vehiculo: (f) => limpiar(f?.nombre),
  plantilla_mensaje: (f) => limpiar(f?.nombre),
  cierre_dia: (f) => unir(f?.mensajeroNombre, f?.fecha ? fechaCalendarioCR(f.fecha) : null),
  cierre_bodega: (f) => unir(f?.zonaNombre, f?.fecha ? fechaCalendarioCR(f.fecha) : null),
  gestion_orden: etiquetaDeEnvio,
  liquidacion_pago: (f) => unir(f?.beneficiarioNombre),
  liquidacion_reparto: (f) => unir(f?.beneficiarioNombre),
  wallet_movimiento: (f) => limpiar(f?.categoria),
  orden_incidente: etiquetaDeEnvio,
  gasto_fijo_cobro: (f) => unir(f?.concepto, f?.periodo),
  rechazo_tienda_cobro: etiquetaDeEnvio,
  ranking_snapshot_fila: (f) => unir(f?.mensajeroNombre, f?.puesto == null ? null : `puesto ${f.puesto}`),
  api_key: (f) => limpiar(f?.identificador),
};

/**
 * La etiqueta legible y CONGELADA de una entidad afectada (R4). Truncada a
 * `ETIQUETA_MAX_CHARS` y nunca vacia: una celda en blanco en un registro de auditoria es
 * indistinguible de un dato perdido.
 */
export function etiquetaDeEntidad<E extends HistorialAccionEntidad>(
  tipo: E,
  fila: FuentesEtiqueta[E],
): string {
  return CONSTRUCTORES[tipo](fila);
}
