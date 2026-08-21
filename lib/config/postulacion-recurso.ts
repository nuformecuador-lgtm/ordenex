// Feature 253 (T2.2, design §10) — cotas de la postulacion de vehiculo o bodega. Todas
// sobreescribibles por variable de entorno, con el defecto en codigo (patron
// `lib/config/postulacion.ts` / `lib/config/aprobacion-postulaciones.ts`, "Sin hardcode de
// contexto" de docs/architecture.md): el modulo que APLICA la cota no la escribe.
//
// El porque de cada numero esta al lado del numero, a proposito: una cota sin motivo es una cifra
// que nadie se atreve a cambiar despues.

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface PostulacionRecursoConfig {
  /**
   * Tope de `nombre` (R10). 120 caracteres: cabe cualquier nombre y apellidos compuestos con
   * holgura y corta el pegado de un texto entero en el campo equivocado.
   */
  NOMBRE_MAX_CHARS: number;
  /**
   * Tope de `telefono` (R11). 30 caracteres: D2 decidio NO endurecerlo a solo digitos —hoy la
   * landing acepta `+506 8888-8888` y rechazarlo seria un cambio de producto colado dentro de un
   * arreglo—, asi que lo unico que se hace es recortar y topar la longitud.
   */
  TELEFONO_MAX_CHARS: number;
  /**
   * Tope de `correo` (R12). 254 es la longitud maxima de una direccion de correo segun el limite
   * del `path` de RFC 5321; mas alla no hay correo valido que cortar.
   */
  CORREO_MAX_CHARS: number;
  /**
   * Tope de `mensaje` (R13). **1.000 caracteres, D3 FIRMADA.** Cabe de sobra la descripcion que el
   * placeholder del modal pide (tipo, ano, capacidad, ciudad, disponibilidad) y corta el texto
   * pegado. Referencia interna: `orden_nota` topa en 200, pero eso es una nota de hilo, no una
   * descripcion. Hoy NO hay tope, y un campo de texto libre PUBLICO sin cota es una puerta abierta.
   */
  MENSAJE_MAX_CHARS: number;
  /**
   * Postulaciones aceptadas por clave `ip|correo` dentro de la ventana (R16). **D4 FIRMADA:** los
   * defaults de la feature 21 (3 en 60 minutos). Quien tiene un vehiculo Y una bodega sigue
   * cabiendo; un bucle, no.
   */
  RATE_MAX: number;
  /** Ventana deslizante del limitador, en minutos (R16). */
  RATE_WINDOW_MINUTES: number;
  /** Tamano de pagina por defecto del panel del admin (R30). */
  PAGE_SIZE_DEFAULT: number;
  /** Cota dura del tamano de pagina: evita que el borde pida la tabla entera (R30). */
  PAGE_SIZE_MAX: number;
  /**
   * **P2 FIRMADA EN CONTRA de la recomendacion del spec:** las postulaciones ATENDIDAS se borran a
   * los 6 meses. Meses de calendario y no dias, porque eso es lo que se firmo; el corte lo calcula
   * `PurgaPostulacionRecursoService`.
   *
   * ⛔ La ventana se mide SIEMPRE sobre `atendida_at`, NUNCA sobre `created_at`: una postulacion
   * SIN ATENDER no se borra jamas, por antigua que sea. Lo ejecuta un job desatendido y borrar es
   * irreversible.
   */
  PURGA_RETENCION_MESES: number;
  /**
   * Tope de filas borradas por corrida del cron. Acota el bloqueo y el tiempo de una corrida sobre
   * un historico grande; lo que no entre lo retoma la corrida del dia siguiente (siempre lo mas
   * viejo primero).
   */
  PURGA_MAX_POR_CORRIDA: number;
}

/**
 * Resuelve la configuracion LEYENDO `process.env` en cada llamada. El borde publico y el cron la
 * invocan por corrida: es una lectura de entorno y unos parseos, y hace que cambiar un umbral no
 * exija redesplegar para que el proceso serverless vivo se entere.
 */
export function loadPostulacionRecursoConfig(): PostulacionRecursoConfig {
  return {
    NOMBRE_MAX_CHARS: readPositiveInt("POSTULACION_RECURSO_NOMBRE_MAX_CHARS", 120),
    TELEFONO_MAX_CHARS: readPositiveInt("POSTULACION_RECURSO_TELEFONO_MAX_CHARS", 30),
    CORREO_MAX_CHARS: readPositiveInt("POSTULACION_RECURSO_CORREO_MAX_CHARS", 254),
    MENSAJE_MAX_CHARS: readPositiveInt("POSTULACION_RECURSO_MENSAJE_MAX_CHARS", 1000),
    RATE_MAX: readPositiveInt("POSTULACION_RECURSO_RATE_MAX", 3),
    RATE_WINDOW_MINUTES: readPositiveInt("POSTULACION_RECURSO_RATE_WINDOW_MINUTES", 60),
    PAGE_SIZE_DEFAULT: readPositiveInt("POSTULACION_RECURSO_PAGE_SIZE_DEFAULT", 20),
    PAGE_SIZE_MAX: readPositiveInt("POSTULACION_RECURSO_PAGE_SIZE_MAX", 50),
    PURGA_RETENCION_MESES: readPositiveInt("POSTULACION_RECURSO_PURGA_RETENCION_MESES", 6),
    PURGA_MAX_POR_CORRIDA: readPositiveInt("POSTULACION_RECURSO_PURGA_MAX_POR_CORRIDA", 500),
  };
}

/**
 * Instantanea al cargar el modulo, para los consumidores que no pueden releer el entorno: el
 * schema zod se construye UNA vez al importarse, asi que sus topes salen de aqui.
 */
export const postulacionRecursoConfig: PostulacionRecursoConfig = loadPostulacionRecursoConfig();
