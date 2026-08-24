import { z } from "zod";

// Los tres tipos con que nacio el catalogo (feature 50). Sigue siendo la lista que
// SIEMBRA la base, pero ya NO es la lista de valores posibles: desde
// `20260824160000_vehiculo_name_texto` la columna es TEXT y el catalogo se administra
// por CRUD. Antes esta constante se derivaba de `Object.values(VehiculoValue)`; con la
// columna en texto ese enum ya no describe el dominio, asi que la semilla se declara.
export const VEHICULOS_SEED: string[] = ["moto", "carro", "camion"];

// Cotas del nombre. Un catalogo administrable necesita un minimo (nada de nombres
// vacios o de un caracter accidental) y un maximo (la columna es TEXT, sin tope
// propio, y sin cota un pegado accidental entraria entero).
export const VEHICULO_NOMBRE_MIN = 2;
export const VEHICULO_NOMBRE_MAX = 40;

/**
 * Normaliza el nombre de un tipo de vehiculo: recorta y colapsa espacios internos.
 *
 * POR QUE EXISTE, Y POR QUE AQUI. Con la columna en enum, "Moto " era imposible de
 * teclear; con TEXT es una fila distinta de "Moto", y el UNIQUE de la base NO las
 * distingue. La migracion declara explicitamente que este plegado es responsabilidad
 * del codigo, no de la base. NO se baja a minusculas: un tipo puede legitimamente
 * llevar mayusculas ("Furgon 3/4"), y forzarlas seria decidir por el usuario.
 */
export function normalizarNombreVehiculo(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

const nombreSchema = z
  .string()
  .transform(normalizarNombreVehiculo)
  .pipe(
    z
      .string()
      .min(VEHICULO_NOMBRE_MIN, `El nombre debe tener al menos ${VEHICULO_NOMBRE_MIN} caracteres.`)
      .max(VEHICULO_NOMBRE_MAX, `El nombre no puede superar los ${VEHICULO_NOMBRE_MAX} caracteres.`),
  );

// Validacion en el borde. `strict` rechaza campos desconocidos (patron tarifas).
export const crearVehiculoSchema = z.object({ name: nombreSchema }).strict();
export type CrearVehiculoInput = z.infer<typeof crearVehiculoSchema>;

export const actualizarVehiculoSchema = z.object({ name: nombreSchema }).strict();
export type ActualizarVehiculoInput = z.infer<typeof actualizarVehiculoSchema>;

// DTO expuesto por la capa de lectura: id (uuid PK estable) + name. No expone
// campos internos (R11).
export interface VehiculoDTO {
  id: string;
  name: string;
}

/**
 * Resultado discriminado de las Server Actions del catalogo.
 *
 * `conflict` SI existe aqui, al contrario que en tarifas: `vehiculos.name` es UNIQUE,
 * asi que dar de alta un nombre repetido es un desenlace normal del dominio y tiene
 * que poder contarse como tal en vez de escapar como error crudo de Postgres.
 * `in_use` distingue el borrado bloqueado por las FKs (`usuario.vehiculo_id`,
 * `tarifa_zona_mensajero.vehiculo_id`) de un "no se pudo" generico: el usuario
 * necesita saber que el tipo esta EN USO, no que fallo algo.
 */
export type VehiculoActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict" }
  | { status: "in_use" }
  | { status: "error" };
