/**
 * FICHA 374 (design §3) — LA DISPONIBILIDAD EFECTIVA DEL CATALOGO GEOGRAFICO, EN UN SOLO SITIO.
 *
 * El flag `activo` de cada fila es una decision SOBRE ESA FILA. Lo que decide si un nodo se puede
 * USAR es la conjuncion con sus ascendientes, y se evalua AL LEER — nunca se guarda en una
 * columna (R7).
 *
 * POR QUE VIVE AQUI Y NO COMO PRIVADO DE `GeoRepository`. Es el mismo argumento, literal, que ya
 * justifica a su hermano `_shared/zona-colapso.ts`: dos copias son dos reglas que un dia divergen,
 * y la que divergiera dejaria fuera —o dentro— filas del catalogo SIN romper ningun test. Aqui
 * ademas hay cinco consumidores en tres capas distintas (`GeoRepository`, `OrdenRepository`,
 * `ConteosPublicosRepository`, `geo-resolucion` y la pantalla de administracion).
 *
 * ⚠️ ESTE MODULO NO IMPORTA NADA DE `@prisma/client`, y no es casualidad: los fragmentos `where`
 * son literales que Prisma acepta ESTRUCTURALMENTE, y asi lo puede importar tambien
 * `lib/services/geo-resolucion.ts`, que es logica pura y no conoce Prisma.
 *
 * ⚠️ Y LA REGLA QUE HAY QUE ESCRIBIR EN VOZ ALTA, porque sin ella alguien escribe un `updateMany`
 * de limpieza (R10):
 *
 *     «Un distrito ACTIVO bajo un canton INACTIVO» es un estado REPRESENTABLE y NO es un bug.
 *     Significa «el distrito esta bien; su canton se retiro». No hay nada que reparar.
 *
 * Materializar la cascada —apagar los hijos al desactivar el padre— romperia R9: al reactivar el
 * canton no habria forma de saber que distritos estaban ya inactivos POR SU CUENTA, y la
 * reactivacion encenderia territorio que alguien retiro a proposito.
 *
 * Lo vigila `tests/unit/guards/geografia-predicado-unico.guardia.test.ts`.
 */

/**
 * Los flags PROPIOS de la cadena de un nodo, de la raiz a la hoja.
 *
 * `distrito` es opcional porque la cadena de un CANTON no tiene ese eslabon; `undefined` en un
 * nivel significa «ese nivel no participa», que no es lo mismo que `false`.
 */
export interface FlagsGeograficos {
  provincia: boolean;
  canton?: boolean;
  distrito?: boolean;
}

/**
 * La conjuncion de la cadena. Un nivel ausente (`undefined`) no resta.
 *
 * Es la MISMA definicion que expresan los tres `WHERE_*_DISPONIBLE` de abajo, solo que evaluada
 * en memoria en vez de en SQL: la usan el arbol de la pantalla y el filtro de estado, que ya
 * tienen los tres flags delante y no van a volver a la base para preguntarlo.
 */
export function estaDisponible(flags: FlagsGeograficos): boolean {
  return flags.provincia && flags.canton !== false && flags.distrito !== false;
}

/**
 * `where` de Prisma para las lecturas que SI recortan por disponibilidad. Son exactamente dos en
 * todo el arbol (design §4): los conteos publicos de la landing y nada mas. Todo lo demas
 * PROYECTA la bandera y deja filtrar al consumidor, porque en geografia el desplegable es la
 * unica via —nadie teclea un uuid— y ocultar un distrito retirado dejaria INFILTRABLES las
 * ordenes historicas de ese distrito.
 */
export const WHERE_PROVINCIA_DISPONIBLE = { activo: true } as const;

export const WHERE_CANTON_DISPONIBLE = {
  activo: true,
  provincia: { activo: true },
} as const;

export const WHERE_DISTRITO_DISPONIBLE = {
  activo: true,
  canton: { activo: true, provincia: { activo: true } },
} as const;

// ── Los `select` de las lecturas que NO recortan ─────────────────────────────────────────────
//
// Proyectar es lo NORMAL en este arbol; recortar es la excepcion (§4 del design). Con estos
// fragmentos, quien lee puede componer `estaDisponible` sin una segunda consulta.

/**
 * Proyeccion del flag PROPIO de una fila. Es un `select`, NO un filtro — y por eso tiene nombre
 * propio aunque su valor coincida con `WHERE_PROVINCIA_DISPONIBLE`: quien lo lea en un repositorio
 * tiene que ver de un vistazo si esa consulta RECORTA o solo PROYECTA. Sirve para los tres
 * niveles: una provincia no tiene ascendiente, asi que su flag propio ES su disponibilidad.
 *
 * Existe ademas por una razon mecanica: la guardia de R11 prohibe el literal `activo: true` en
 * todo `lib/` fuera de este modulo, asi que hasta las proyecciones pasan por aqui. Sin eso, la
 * guardia tendria que adivinar si un `activo: true` suelto era un `where` o un `select`, y una
 * guardia que adivina acaba callandose.
 */
export const SELECT_FLAG_PROPIO = { activo: true } as const;

export const SELECT_CADENA_CANTON = {
  activo: true,
  provincia: { select: { activo: true } },
} as const;

export const SELECT_CADENA_DISTRITO = {
  activo: true,
  canton: { select: { activo: true, provincia: { select: { activo: true } } } },
} as const;

/** La forma que `SELECT_CADENA_CANTON` devuelve, para tipar sin repetirla. */
export interface CadenaCantonProyectada {
  activo: boolean;
  provincia: { activo: boolean };
}

/** La forma que `SELECT_CADENA_DISTRITO` devuelve, para tipar sin repetirla. */
export interface CadenaDistritoProyectada {
  activo: boolean;
  canton: { activo: boolean; provincia: { activo: boolean } };
}

/** La disponibilidad efectiva de un canton a partir de la cadena proyectada. */
export function disponibleDesdeCadenaCanton(fila: CadenaCantonProyectada): boolean {
  return estaDisponible({ provincia: fila.provincia.activo, canton: fila.activo });
}

/** La disponibilidad efectiva de un distrito a partir de la cadena proyectada. */
export function disponibleDesdeCadena(fila: CadenaDistritoProyectada): boolean {
  return estaDisponible({
    provincia: fila.canton.provincia.activo,
    canton: fila.canton.activo,
    distrito: fila.activo,
  });
}
