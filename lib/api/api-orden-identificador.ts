// Feature 177 (design §5.1/§5.2) — identificador libre `{id}` del canal integrador, compartido
// por `GET /api/ordenes/api-key/orden/{id}` y `POST .../orden/{id}/generate`.
//
// Vive en `lib/` (no en un module de ruta) porque R19 exige que AMBOS endpoints apliquen
// EXACTAMENTE las mismas reglas: un route handler no debe importar a su hermano, y duplicar el
// schema abriria la puerta a que las dos rutas divergieran. Se separa de `api-key-request.ts`
// porque aquel modulo cubre otra responsabilidad (leer el `Authorization` de la Request y armar
// el autenticador), mientras que esto es validacion de entrada del path, sin HTTP.
import { z } from "zod";

/**
 * R13 — cota del BORDE (no regla de negocio): `num_remision` no declara longitud maxima en el
 * esquema, pero un path arbitrariamente largo no puede entrar. Vacio o solo espacios tambien
 * es invalido, y se rechaza ANTES de tocar la base (lo garantiza el orden de los pasos).
 */
export const idOrdenApiSchema = z.string().trim().min(1).max(128);
