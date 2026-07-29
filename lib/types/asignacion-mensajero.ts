// Proyeccion publica de un usuario con rol mensajero. Nacio con la feature 16
// ("carga masiva - etapa 2") y sobrevive a ella: la feature 159 retiro ese flujo
// entero, pero el DTO sigue siendo el contrato de `IUserRepository.listMensajeros`,
// que hoy consume el ranking de mensajeros.

// Usuario con rol mensajero, proyectado SOLO a id/nombre (sin PII) mas su zona
// (feature 24/R6: nullable). `zonaNombre` es el nombre legible de esa zona, null
// si el mensajero no tiene zona asignada.
export interface MensajeroDTO {
  id: string;
  nombre: string;
  zonaId: string | null;
  zonaNombre: string | null;
}
