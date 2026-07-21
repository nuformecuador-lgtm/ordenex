import { z } from "zod";

// Feature 92 (R22/R32/R33) — validacion de borde de la ruta del mensajero. Vive en su
// propio archivo (y no dentro de `gestion-orden.ts`) porque lo consumen DOS bordes
// distintos: las acciones existentes del mensajero y la Server Action nueva de
// sincronizacion. Un archivo compartido evita que las dos definiciones de `ubicacion`
// diverjan, que es como se cuelan los rangos incoherentes.

/**
 * R22 — ubicacion capturada por `navigator.geolocation`. Los rangos son los del sistema
 * de coordenadas, no una preferencia: fuera de ellos el valor NO es una coordenada.
 *
 * Se valida EN EL BORDE (docs/architecture.md §2) porque viene del cliente: un `lat` de
 * 1e9 llegaria hasta el proveedor y produciria una llamada facturada que solo puede
 * fallar, o peor, una ruta calculada desde un punto absurdo.
 *
 * SIEMPRE OPCIONAL en sus consumidores (R25): denegar el permiso no puede bloquear nada.
 */
export const ubicacionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type UbicacionActionInput = z.infer<typeof ubicacionSchema>;

/** R32/R33: entrada de la sincronizacion manual. Todo opcional salvo el propio objeto. */
export const sincronizarRutaSchema = z.object({
  ubicacion: ubicacionSchema.optional(),
});

export type SincronizarRutaActionInput = z.infer<typeof sincronizarRutaSchema>;

/**
 * Resultado de `sincronizarRuta`.
 *  - `ok`       : la optimizacion corrio (o se omitio por una guarda de coste, que
 *                 tambien es un desenlace correcto: `omitida` lo dice).
 *  - `conflict` : R34, se pulso dentro del intervalo minimo. NO se llamo al proveedor.
 *  - `forbidden`: R33, el actor no es mensajero. Sin efectos ni llamada.
 */
export type SincronizarRutaResult =
  | { status: "ok"; omitida: boolean }
  | { status: "conflict"; motivo: string }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
