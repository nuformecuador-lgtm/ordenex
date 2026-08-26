/**
 * Feature 170 (T B.3, design §3/§7) — columnas de EXPORT del listado de usuarios.
 *
 * Módulo PURO: sin React ni DOM. Las columnas del export se declaran APARTE de
 * `buildUsuariosColumns` (`Column<UsuarioListItemDTO>`) porque el `render` de aquéllas
 * devuelve `ReactNode` (insignias, botones) y una hoja de cálculo solo admite valores
 * crudos (R7). Aquí cada celda es `string | number | null` y nada más.
 *
 * Las columnas se enumeran A MANO (R5/R6): si el DTO del listado crece —y lo hará: hoy ya
 * trae `id`, mañana traerá otra cosa—, el archivo NO publica el campo nuevo en silencio.
 *
 * Lo que NO sale, y por qué:
 *  - `passwordHash`: `UsuarioListItemDTO` ni siquiera lo declara (invariante R24 de la 25),
 *    pero la guardia de datos sensibles lo vuelve a comprobar sobre la fila proyectada (R21).
 *  - `id`: es el uuid interno de la fila. El listado no lo muestra y no es identificador de
 *    negocio de nada (R23).
 *  - `createdAt`: el DTO lo trae, pero la TABLA no lo muestra. R24 es explícito: nada que el
 *    listado no enseñe en pantalla.
 */
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import { ESTADO_LABELS, SIN_ZONA } from "./usuario-estado-label";

/**
 * Columnas emitidas por la descarga del listado de usuarios, en su orden. Son exactamente
 * las cuatro columnas de datos que la tabla pinta (la quinta, "Acciones", son botones: no
 * es un dato). Los encabezados son las etiquetas que el usuario ve en pantalla.
 */
export const COLUMNAS_DESCARGA_USUARIOS: DescargaColumna[] = [
  { clave: "nombre", encabezado: "Nombre" },
  { clave: "email", encabezado: "Email" },
  { clave: "rol", encabezado: "Rol" },
  { clave: "estado", encabezado: "Estado" },
  // 2026-08-26: entra con la columna de la tabla. R24 manda que el archivo enseñe lo que la
  // pantalla enseña, así que se añade en el MISMO cambio, no en uno posterior.
  { clave: "zona", encabezado: "Zona" },
];

/**
 * Proyecta un usuario del listado a una fila de export con valores CRUDOS (R7).
 *
 * `rol` y `estado` salen como su ETIQUETA LEGIBLE (R8), la MISMA que pinta la tabla
 * (`ROL_LABELS`, `ESTADO_LABELS`), no como el valor interno del enum: un archivo que dijera
 * `adminTienda` obligaría a quien lo abre a traducir a mano. El `??` cae al valor crudo si
 * el enum ganara un valor sin etiqueta — preferible a una celda vacía, que se leería como
 * "este usuario no tiene rol".
 */
export function filaDescargaUsuario(usuario: UsuarioListItemDTO): DescargaFila {
  return {
    nombre: usuario.nombre,
    email: usuario.email,
    rol: ROL_LABELS[usuario.rolValue] ?? usuario.rolValue,
    estado: ESTADO_LABELS[usuario.estado] ?? usuario.estado,
    // El MISMO guion que pinta la tabla, no una celda vacía: en una hoja de cálculo el vacío se
    // lee como dato perdido, y «sin zona» es el estado normal de casi todos los usuarios.
    zona: usuario.zonaNombre ?? SIN_ZONA,
  };
}
