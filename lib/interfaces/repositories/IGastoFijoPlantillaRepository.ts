import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";
import type { PeriodicidadUnidad } from "@/lib/utils/periodicidad";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

// Feature 45 (design §2.1b) — contrato del repositorio de PLANTILLAS de gasto fijo
// (configuracion recurrente mutable). Solo queries Prisma; sin logica de negocio. Money-safe:
// el `monto` entra como STRING y sale como STRING (toFixed(2)) en el DTO.
//
// ⚠️ FICHA 332 — AQUI VIVE, ENTERA, LA REVOCACION DE `45/R25`. Fecha: 2026-08-29.
//
// Hasta esa fecha esta cabecera decia, verbatim: «NO expone `delete` (R25): la desactivacion
// (setActiva) es el mecanismo para dejar de generar». La ficha 332 **revoca** esa decision con OK
// humano del 2026-08-29, y por eso el contrato de abajo SI declara `eliminar`. No fue un descuido
// ni un atajo: se tomo a sabiendas de que existia la anterior.
//
// MOTIVO: la tabla de plantillas acumula ruido —configuracion vieja que ya no se cobra y que el
// usuario no puede sacar de su vista— y el historico NO depende de la plantilla.
// `wallet_movimiento` no declara ninguna FK a `gasto_fijo_plantilla`; la referencia es DERIVADA
// (`origen_id = '<plantillaId>:<periodo>'`, un texto, no un puntero) y la `descripcion` del
// movimiento ya lleva el concepto y el periodo, asi que la fila del libro se explica sola aunque
// la plantilla ya no exista. Lo que `45/R25` SI acertaba —el libro es INMUTABLE— sigue vigente:
// el borrado llega hasta esta tabla y se detiene ahi.
//
// PUNTERO: `specs/332-eliminar-plantilla-gasto-fijo`. Los demas sitios que afirmaban `45/R25`
// llevan una linea con este mismo puntero; la version larga es esta.

// Feature 84 — periodicidad del ciclo, comun a crear/actualizar. `fechaCobro` es el ancla
// (primer cobro) como `YYYY-MM-DD`; la impl la convierte a la columna DATE.
export interface PeriodicidadInput {
  periodicidadUnidad: PeriodicidadUnidad;
  periodicidadCantidad: number; // >= 1 (CHECK en la DB)
  fechaCobro: string; // `YYYY-MM-DD`
}

/**
 * Ficha 333 (C3, R1/R2) — EL INTERRUPTOR en la escritura.
 *
 * OPCIONAL, y con la misma forma —y por el mismo motivo— que `CrearMovimientoInput.fechaMovimiento`
 * y `.id`: la clave SOLO viaja si el llamador la trae. Ausente en `crear` ⇒ manda el
 * `DEFAULT true` de la columna (R2, «requiere aprobación» es la norma); ausente en `actualizar`
 * ⇒ la fila conserva el valor que tenía, que es lo seguro: una edición parcial NO puede cambiar
 * en silencio si un gasto se cobra solo o no. Es la familia de fallo que cerró la 85 con la
 * periodicidad.
 *
 * La tanda D (D4) es la que hace que `GastoFijoPlantillaService` lo pase SIEMPRE desde el borde
 * —donde el schema zod ya le pone su default— y quien puede, entonces, apretarlo a obligatorio.
 */
export interface InterruptorAprobacionInput {
  requiereAprobacion?: boolean;
}

export interface CrearPlantillaInput extends PeriodicidadInput, InterruptorAprobacionInput {
  concepto: string;
  monto: string; // STRING > 0 -> Prisma.Decimal en la impl
}

export interface ActualizarPlantillaInput extends PeriodicidadInput, InterruptorAprobacionInput {
  concepto: string;
  monto: string; // STRING > 0
}

export interface IGastoFijoPlantillaRepository {
  /** R24: crea la plantilla (activa=true por default). Devuelve el DTO con monto STRING. */
  crear(input: CrearPlantillaInput): Promise<GastoFijoPlantillaDTO>;
  /** R25: edita concepto/monto de una plantilla existente. Devuelve el DTO actualizado. */
  actualizar(id: string, input: ActualizarPlantillaInput): Promise<GastoFijoPlantillaDTO>;
  /**
   * R25: activa/desactiva una plantilla. Devuelve el DTO actualizado.
   *
   * Desactivar y eliminar son DOS intenciones distintas y las dos existen desde la ficha 332
   * (2026-08-29, revoca `45/R25`; ver la cabecera y `specs/332-eliminar-plantilla-gasto-fijo`):
   * desactivar es «no se cobra por ahora» —reversible, la fila se queda, conserva el id y con el
   * la clave de idempotencia del cron—; eliminar es «no se cobra nunca mas y no quiero verlo».
   */
  setActiva(id: string, activa: boolean): Promise<GastoFijoPlantillaDTO>;
  /**
   * Ficha 332 (R2/R3): borra la plantilla identificada. `true` si borro una fila, `false` si ya
   * no existia. **Revoca** la nota de `45/R25` («NO expone delete»), decision humana del
   * 2026-08-29 — ver `specs/332-eliminar-plantilla-gasto-fijo`.
   *
   * La implementacion usa `deleteMany` y no `delete` (precedente: `VehiculoRepository.delete`):
   * `delete` lanza `P2025` cuando otra pestaña ya borro la fila, y traducir esa excepcion de la
   * ORM a `not_found` en el servicio es un `catch` que mira codigos de error donde basta un
   * contador. El `count` ES la respuesta, y es atomico.
   *
   * R3: filtra por la clave primaria y por NADA mas. R8: este repositorio esta tipado
   * `Pick<PrismaClient, "gastoFijoPlantilla">`, asi que no puede tocar `wallet_movimiento`
   * aunque quisiera — el libro no se ve afectado por construccion, no por disciplina.
   */
  eliminar(id: string): Promise<boolean>;
  /** R26: lista TODAS las plantillas (activas e inactivas), mas recientes primero. */
  listar(): Promise<GastoFijoPlantillaDTO[]>;
  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): UNA PAGINA de las plantillas + el
   * TOTAL. Es `listar()` con el recorte `skip`/`take`: mismas filas (activas e inactivas,
   * R26) y mismo `orderBy createdAt desc` (R51). El `count` es la unica consulta anadida.
   */
  listarPaginado(rango: RangoPagina): Promise<PaginaRepositorio<GastoFijoPlantillaDTO>>;
  /** R27: lista solo las plantillas ACTIVAS (consumo del cron). */
  listarActivas(): Promise<GastoFijoPlantillaDTO[]>;
  /** Lee una plantilla por id; null si no existe. */
  obtenerPorId(id: string): Promise<GastoFijoPlantillaDTO | null>;
}
