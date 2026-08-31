// Nombre COMPLETO de una persona de `usuario` (nombre + primer apellido + segundo apellido).
//
// POR QUE EXISTE. La identidad de un mensajero vive en TRES columnas desde la feature 21
// (`nombre`, `primer_apellido`, `segundo_apellido`), pero casi toda la aplicacion pintaba solo
// `nombre`. Con dos «Carlos» en la misma zona, el cierre, el manifiesto, la asignacion y el
// tablero del dia mostraban el mismo texto para dos personas distintas: quien firma la entrega
// y a quien se le paga dejaban de ser distinguibles. Componer los tres campos a mano en cada
// repositorio es como se llego a esa mezcla, asi que la composicion vive AQUI y hay una sola.
//
// Los apellidos son NULLABLE a proposito (`db/schema.prisma`): los usuarios que no son personas
// —tiendas, cuentas de API key— solo tienen `nombre`. Por eso se filtran los vacios en vez de
// asumirlos presentes: para esas cuentas el resultado es exactamente el `nombre` de siempre.

/** Proyeccion Prisma minima para componer el nombre completo. Usar en cada `select`. */
export const NOMBRE_USUARIO_SELECT = {
  nombre: true,
  primerApellido: true,
  segundoApellido: true,
} as const;

/** Las tres columnas de identidad, ya en su forma de Prisma. */
export interface NombreUsuarioFuente {
  nombre: string;
  primerApellido?: string | null;
  segundoApellido?: string | null;
}

/**
 * `"Carlos Jimenez Mora"`. Los apellidos ausentes o en blanco no dejan huella (ni espacios
 * dobles ni cola sobrante), asi que una cuenta sin apellidos devuelve solo su `nombre`.
 */
export function nombreCompletoUsuario(usuario: NombreUsuarioFuente): string {
  return [usuario.nombre, usuario.primerApellido, usuario.segundoApellido]
    .map((parte) => parte?.trim() ?? "")
    .filter((parte) => parte !== "")
    .join(" ");
}

/**
 * Gemelo EN SQL de `nombreCompletoUsuario`, para las consultas crudas. `alias` es un
 * IDENTIFICADOR SQL y se interpola sin escapar: los llamantes DEBEN pasar un literal del
 * codigo (el alias de la tabla `usuario` en su propia query), nunca dato de fuera.
 *
 * `concat_ws` ya omite los NULL; el `trim` cubre el caso de un apellido guardado como cadena
 * vacia, que dejaria un espacio de cola.
 */
export function nombreCompletoUsuarioSql(alias: string): string {
  return `trim(concat_ws(' ', ${alias}.nombre, ${alias}.primer_apellido, ${alias}.segundo_apellido))`;
}
