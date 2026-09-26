// Ficha 458-A (TA.1, R33, P5 de la auditoria de la wallet) — el NOMBRE de una cuenta de la wallet.
//
// POR QUE EXISTE. La misma tienda se leia «Tania» en las tablas de `/wallet/tiendas` (se leia solo
// `usuario.nombre`) y «Tania Tienda» en los avisos, el historial y la linea de caja del cobro
// (`etiquetaDePersona`: nombre + primer apellido). Los mensajeros, a su vez, salian con el nombre
// COMPLETO (`nombreCompletoUsuario`). Tres composiciones para la misma pregunta —«¿de quien es esta
// cuenta?»— hacen que una persona lea dos cuentas donde hay una.
//
// Desde esta ficha TODA superficie de la wallet (tablas, tarjetas, avisos, historial, origen, «A
// quien», selector de cierres) nombra una tienda, un mensajero o una bodega con ESTA funcion, y la
// composicion elegida es la que el repo ya declara unica para personas: `nombreCompletoUsuario`
// (nombre + apellidos presentes, sin huecos). Para una tienda sin apellidos es su `nombre` de
// siempre; para una bodega satelite es el nombre de su zona.
//
// La guardia `wallet-etiqueta-cuenta.guardia` prohibe otra composicion del nombre en las carpetas de
// la wallet y en sus repositorios de lectura.

import { nombreCompletoUsuario, type NombreUsuarioFuente } from "@/lib/utils/nombre-usuario";

/** Lo que se pinta cuando la cuenta no se pudo resolver (fila huerfana, carrera). Nunca un id (R4). */
export const CUENTA_SIN_NOMBRE = "Cuenta sin nombre";

/** Proyeccion Prisma minima de `usuario` para nombrar una cuenta de tienda o de mensajero. */
export const CUENTA_USUARIO_SELECT = {
  nombre: true,
  primerApellido: true,
  segundoApellido: true,
} as const;

/** Una tienda o un mensajero (filas de `usuario`) o una bodega satelite (fila de `zona`). */
export type FuenteCuenta = NombreUsuarioFuente | { nombre: string };

/**
 * El nombre de una cuenta de la wallet. `null`/`undefined` o todo en blanco → `CUENTA_SIN_NOMBRE`:
 * un texto legible, nunca vacio y nunca un identificador interno (R4).
 */
export function etiquetaDeCuenta(fuente: FuenteCuenta | null | undefined): string {
  if (fuente == null) return CUENTA_SIN_NOMBRE;
  const texto = nombreCompletoUsuario(fuente).replace(/\s+/g, " ");
  return texto === "" ? CUENTA_SIN_NOMBRE : texto;
}
