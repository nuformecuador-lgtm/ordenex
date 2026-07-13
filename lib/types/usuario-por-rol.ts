// Proyeccion minima de un usuario para poblar selects/listados filtrados por rol.
// Solo id/nombre: NUNCA PII (email/telefono/cedula) ni el hash de contrasena.
// Reutilizado por la estrategia generica `listByRol` (mensajeros, adminTienda, ...).
export interface UsuarioPorRolDTO {
  id: string;
  nombre: string;
}
