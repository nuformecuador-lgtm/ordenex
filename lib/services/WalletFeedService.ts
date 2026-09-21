import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService, WalletFeedTxClient } from "@/lib/interfaces/services/IWalletFeedService";
import {
  detalleDe,
  leerDetallePorOrden,
  tarifaDe,
} from "@/lib/utils/cierre-detalle";
import {
  agregarIngresosPorConcepto,
  type OrdenIngresoInput,
} from "@/lib/utils/ingreso-ordenex";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

/**
 * Feature 42 (design §2.2) — construye los movimientos de INGRESO de un cierre aprobado.
 * Se ejecuta DENTRO de la transaccion de aprobacion y devuelve las filas a insertar (origen =
 * cierre_dia), OMITIENDO conceptos con total 0.00 (R10). NO persiste; el repo las inserta
 * idempotentemente en la tx. Money-safe: montos STRING.
 *
 * Feature 69 (R12/R14/R21) — EL CAMBIO MONEY-CRITICAL: deriva desde el SNAPSHOT
 * (`cierre_detail`) y NO lee `orden`, `zona` ni `tarifas` VIVAS. Antes leia
 * `g.orden.{montoCobrar, cobraComision, zona.esCentral}` y resolvia la tarifa VIGENTE aqui
 * mismo, dentro de la tx de aprobacion: editar la orden o cambiar la tarifa entre SOLICITAR y
 * APROBAR descuadraba en silencio los `total_*` del cierre (37/R14) contra los movimientos, en
 * un libro append-only. Ahora el cierre no PREGUNTA: RECUERDA lo que habia al solicitarse.
 *
 * Por eso el service ya NO recibe el resolver de tarifa ni cachea por tienda: la tarifa viene
 * congelada POR FILA. La FORMULA no cambia (`agregarIngresosPorConcepto`/`derivarIngresoOrden`
 * intactos, R21): mismas entradas, misma salida, distinta PROCEDENCIA.
 */
export class WalletFeedService implements IWalletFeedService {
  async construirMovimientosDeIngreso(
    cierreId: string,
    tx: WalletFeedTxClient,
  ): Promise<CrearMovimientoInput[]> {
    // El GRANO se respeta: `cierre_detail` aporta lo de la ORDEN (congelado) y `gestion_orden`
    // el `resultado`, que es de la GESTION. Una orden con 2 gestiones vigentes en el cierre
    // aporta 2 entradas que comparten la misma fila congelada (design §4.1).
    //
    // ⚠️ FICHA 450 (R3) — LAS DOS LECTURAS VAN EN SERIE, Y NO PUEDEN VOLVER A UN `Promise.all`.
    //
    // `tx` es el cliente de la transaccion de aprobacion, y una transaccion tiene UNA sola
    // conexion (`pg.PoolClient`) durante toda su vida. Escribir `Promise.all` sobre el dice «estas
    // dos pueden ir a la vez», y sobre una conexion unica eso es falso.
    //
    // ⚠️ LO QUE ESTE COMENTARIO **NO** DICE, porque se midio y no es verdad: con
    // `@prisma/client@7.8.0` estas dos consultas NO llegaban a estar en vuelo a la vez. Prisma
    // serializa por su cuenta las peticiones de una transaccion interactiva —medido contra
    // Postgres real en `tests/integration/db/aprobacion-consultas-en-serie.test.ts`: 1 consulta
    // simultanea, 0 solapes, antes y despues de este cambio—. O sea que el `Promise.all` de aqui
    // no era el emisor del aviso de `pg`; ese vivia en otro sitio y esta nombrado en
    // `progress/impl_450.md`.
    //
    // ENTONCES, ¿POR QUE SE ARREGLA? Por tres razones que no dependen de la version de turno:
    //   1. la serializacion es un detalle interno de Prisma, no un contrato — el dia que cambie,
    //      este codigo vuelve a pedir dos consultas a la vez sobre una conexion unica;
    //   2. el propio aviso de `pg` dice «will be removed in pg@9.0», o sea que el salto de version
    //      convierte esto en error en vez de en advertencia;
    //   3. y lo que el patron afirma —«son independientes»— es lo contrario de lo que la
    //      transaccion garantiza, asi que quien lo lea manana lo copiara a un sitio donde si haga
    //      dano: para el `25P02` que la ficha 440 midio como 27 respuestas 500 en una hora bastan
    //      DOS consultas compartiendo conexion.
    //
    // Vigilado por `tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts`.
    //
    // El orden se conserva (snapshot primero, gestiones despues) para que el diff sea minimo:
    // las dos leen dentro del mismo snapshot transaccional, asi que es indiferente.
    const byOrden = await leerDetallePorOrden(cierreId, tx);
    const gestiones = await tx.gestionOrden.findMany({
      where: { cierreId },
      select: { ordenId: true, resultado: true },
    });

    const entradas: Array<{ input: OrdenIngresoInput; tarifa: TarifaVigente | null }> = [];
    for (const g of gestiones) {
      // R14: sin fallback a datos vivos. El backfill (R26/R27) garantiza que la fila existe;
      // si falta, la aprobacion ABORTA en vez de descuadrar en silencio.
      const d = detalleDe(byOrden, cierreId, g.ordenId);
      entradas.push({
        input: {
          resultado: g.resultado,
          esCentral: d.esCentral, // el flag de la zona AL SOLICITAR (elige la columna GAM, R21)
          // La marca del DISTRITO AL SOLICITAR: elige el pacto especial si la tarifa lo trae.
          esZonaEspecial: d.esZonaEspecial,
          // Money-safe: Decimal -> STRING escala 2, nunca number (R11).
          montoCobrar: d.montoCobrar === null ? null : d.montoCobrar.toFixed(2),
          cobraComision: d.cobraComision,
        },
        // R9 preservado: `tarifa_id` NULL -> null -> conceptos 0.00, sin bloquear.
        tarifa: tarifaDe(d),
      });
    }

    // R10: 1 movimiento por concepto agregado, omitiendo los que quedan en 0.00.
    const conceptos = agregarIngresosPorConcepto(entradas);
    return conceptos.map((c) => ({
      tipo: "ingreso" as const,
      categoria: c.categoria,
      monto: c.monto,
      origenTipo: "cierre_dia" as const,
      origenId: cierreId,
      descripcion: null,
      registradoPor: null,
    }));
  }
}
