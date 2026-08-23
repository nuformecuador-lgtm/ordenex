import { z } from "zod";
import type { TrazadoRuta } from "@/lib/interfaces/services/IOptimizacionRutaService";

export type { TrazadoRuta };

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
  /**
   * `trazado` viaja al cliente para que el mapa pinte la ruta REAL por calles en cuanto
   * termina la sincronizacion, sin esperar a nada mas. Puede venir CON `omitida: true`: con
   * una sola parada no hay orden que calcular (R35) pero si linea que dibujar. Ausente si no
   * cambio nada desde la ultima vez, si no queda ninguna parada, o si el trazado no salio.
   *
   * ⚠️ ES EFIMERO: hoy no se persiste (no hay columna en `ruta_optimizada`), asi que
   * sobrevive en el estado del cliente hasta que se recargue la pagina. Tras un F5 el mapa
   * vuelve a la linea recta hasta la siguiente sincronizacion.
   */
  | {
      status: "ok";
      omitida: boolean;
      /**
       * Feature 265 (R39, design §13.4) — QUIEN ordeno la secuencia que acaba de salir, para
       * que el feedback inmediato no diga «Ruta sincronizada.» a secas cuando el orden es
       * aproximado. Eso era una media verdad dicha en el peor momento.
       *
       * `null` cuando la ejecucion fue `omitida`: el toast habla de LO QUE ACABA DE PASAR, y
       * si no se recalculo nada no tiene nada que decir. El aviso persistente ya esta en
       * pantalla y `router.refresh()` lo trae al dia.
       *
       * A diferencia de `trazado`, esto NO es efimero: su fuente de verdad es
       * `ruta_optimizada.secuencia_fuente`, que sobrevive al F5. Este campo es solo el atajo
       * para no esperar al refresco.
       */
      secuenciaFuente: "proveedor" | "local" | null;
      trazado?: TrazadoRuta;
    }
  | { status: "conflict"; motivo: string }
  | { status: "forbidden" }
  | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };

/**
 * Entrada del TRAYECTO EN VIVO. A diferencia de la sincronizacion, aqui la ubicacion es
 * OBLIGATORIA: el trayecto es «desde donde estoy», y sin ese punto no hay nada que pedir.
 * Eso NO contradice R25 —el permiso sigue sin forzarse—: sin ubicacion la UI simplemente no
 * ofrece el boton, en vez de llamar y fallar.
 */
export const trazarTramoVivoSchema = z.object({
  ubicacion: ubicacionSchema,
  ordenId: z.string().min(1),
});

export type TrazarTramoVivoActionInput = z.infer<typeof trazarTramoVivoSchema>;

/**
 * Resultado de `trazarTramoVivo`.
 *  - `ok`       : hay trayecto. `encodedPolyline` es SOLO ese tramo, no la ruta entera.
 *  - `conflict` : intervalo minimo, o el proveedor no dio geometria. NO se distingue el uno
 *                 del otro hacia el cliente: los dos se resuelven esperando y reintentando,
 *                 y el motivo ya va en el texto.
 *  - `forbidden`: no es mensajero (R33), o la orden no es una parada suya. El MISMO valor a
 *                 proposito — separarlos convertiria la action en un oraculo para saber si
 *                 una guia ajena esta en reparto.
 */
export type TrazarTramoVivoResultUI =
  | {
      status: "ok";
      encodedPolyline: string;
      distanciaM: number | null;
      duracionS: number | null;
    }
  | { status: "conflict"; motivo: string }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
