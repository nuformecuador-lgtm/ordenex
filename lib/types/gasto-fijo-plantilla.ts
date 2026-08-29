import { z } from "zod";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import { montoPositivoSchema } from "@/lib/types/wallet";
import { esFechaCalendarioValida, fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { gastoFijoConfig } from "@/lib/config/gasto-fijo";
import type { PeriodicidadUnidad } from "@/lib/utils/periodicidad";

// Feature 45 (design §1.2/§2.3) — tipos y schemas de borde de la PLANTILLA de gasto fijo
// (configuracion recurrente que el maestro administra; el cron deriva los egresos). Money-safe
// (R12/R24): el `monto` entra/sale como STRING (nunca number). Reutiliza `montoPositivoSchema`
// de la wallet (STRING, > 0, hasta 2 decimales).

// ── Contrato I/O (frontera Server Action -> cliente). Montos SIEMPRE STRING (R12) ──
export type GastoFijoPlantillaDTO = {
  id: string;
  concepto: string;
  monto: string; // Decimal -> STRING 2 dec (R12)
  activa: boolean;
  // Feature 84 — periodicidad del ciclo (diaria = 1 dias; semanal = 1 semanas; quincenal =
  // 2 semanas; mensual = 1 meses; y cualquier otra).
  periodicidadUnidad: PeriodicidadUnidad;
  periodicidadCantidad: number;
  fechaCobro: string; // `YYYY-MM-DD`: ancla del ciclo (primer cobro). Date, NO ISO datetime.
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

// ── Schemas zod de borde ──

// Feature 84 / 85 (design §2.1) — periodicidad del ciclo: UNA declaracion de las reglas de
// campo y DOS aplicaciones de ellas, para que crear y actualizar no puedan divergir en la regla
// aunque difieran —a proposito— en la OBLIGATORIEDAD.
//
// CREAR conserva los defaults `meses`/`1`/hoy-CR (R4): una creacion no pisa ningun valor previo,
// asi que el default es el PRIMER valor del ciclo y no el borrado de otro. Es el comportamiento
// documentado desde antes de la 84 y el que uso el backfill de su migracion.
//
// ACTUALIZAR los EXIGE (R1, feature 85): sin `.default()` y sin `.optional()`. Hasta aqui los
// heredaba de crear, y por eso una edicion de `{id, concepto, monto}` —exactamente lo que mandaba
// `GastoFijoPlantillaDialog`— reescribia el ciclo a `meses`/`1` y movia el ancla `fechaCobro` al
// dia de la edicion, en silencio; y cambiar la unidad de/hacia `meses` cambia el formato del
// periodo de la clave de idempotencia (`YYYY-MM` <-> `YYYY-MM-DD`), que es el escenario de DOBLE
// COBRO que documenta `GeneracionGastosFijosService`. Con la 85 el dialogo SI envia los tres
// campos (R15) y una edicion incompleta muere en el BORDE con `validation_error`, nombrando cada
// campo ausente, sin llegar al servicio.
const periodicidadUnidadSchema = z.enum(["dias", "semanas", "meses"]);
const periodicidadCantidadSchema = z.coerce
  .number()
  .int()
  .min(1, "La cantidad debe ser al menos 1.");
// R5: el regex mide la FORMA y `2026-02-31` la cumple, pero `new Date("2026-02-31T00:00:00.000Z")`
// RUEDA al 3 de marzo sin error. `esFechaCalendarioValida` (el round-trip que el repo ya usa para
// esto) exige que el dia EXISTA: un ancla rodada es la misma familia de fallo que cierra la 85
// —el sistema guarda un dia distinto del que le pidieron, callado—.
const fechaCobroSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de cobro debe tener el formato YYYY-MM-DD.")
  .refine(esFechaCalendarioValida, "La fecha de cobro no existe en el calendario.");

// CREAR: los tres opcionales con default (R4).
const periodicidadConDefault = {
  periodicidadUnidad: periodicidadUnidadSchema.default("meses"),
  periodicidadCantidad: periodicidadCantidadSchema.default(1),
  // Default = hoy en hora CR (no `new Date()`: `fechaCalendarioCR` evita el off-by-one de UTC).
  // Se evalua por parseo, asi que no se congela al cargar el modulo.
  fechaCobro: fechaCobroSchema.default(() => fechaCalendarioCR()),
};

// ACTUALIZAR: los tres OBLIGATORIOS (R1). Mismas reglas, cero defaults.
const periodicidadRequerida = {
  periodicidadUnidad: periodicidadUnidadSchema,
  periodicidadCantidad: periodicidadCantidadSchema,
  fechaCobro: fechaCobroSchema,
};

// R24: crear plantilla = concepto no vacio + monto STRING > 0 (hasta 2 decimales). `activa`
// no se envia (arranca en true por default en la DB/repo).
export const crearGastoFijoPlantillaSchema = z.object({
  concepto: z.string().trim().min(1, "El concepto es obligatorio."),
  monto: montoPositivoSchema,
  ...periodicidadConDefault,
});

export type CrearGastoFijoPlantillaInput = z.infer<typeof crearGastoFijoPlantillaSchema>;

// R25: editar una plantilla existente (identificada por id uuid). Se DERIVA del schema de crear
// para que `concepto` y `monto` se declaren una sola vez, y redeclara SOLO lo que tiene que
// diferir: los tres campos del ciclo, en su variante sin default (R1).
export const actualizarGastoFijoPlantillaSchema = crearGastoFijoPlantillaSchema.extend({
  id: z.string().uuid(),
  ...periodicidadRequerida,
});

export type ActualizarGastoFijoPlantillaInput = z.infer<
  typeof actualizarGastoFijoPlantillaSchema
>;

// R25: activar/desactivar una plantilla (la desactivacion detiene el cron y la fila se queda).
// Desde la ficha 332 convive con el BORRADO, que **revoca** el «sin borrado» de `45/R25` con
// decision humana del 2026-08-29 (ver `specs/332-eliminar-plantilla-gasto-fijo`): desactivar es
// pausar —reversible, conserva el id—; eliminar saca la fila de la tabla.
export const setActivaPlantillaSchema = z.object({
  id: z.string().uuid(),
  activa: z.boolean(),
});

export type SetActivaPlantillaInput = z.infer<typeof setActivaPlantillaSchema>;

/**
 * Ficha 332 (R6) — entrada del BORRADO de una plantilla: solo su identificador.
 *
 * `.strict()` a proposito, y es lo unico que este schema tiene de particular: una clave
 * desconocida muere en el BORDE con `validation_error`, sin llegar al servicio. En una operacion
 * irreversible, aceptar en silencio un campo que nadie va a leer es la forma barata de que el
 * llamador crea que pidio algo que no pidio.
 *
 * Aqui NO viaja ningun monto: el unico que aparece en este camino es el que la confirmacion
 * pinta, y sale del DTO que la pantalla ya tiene (STRING, money-safe).
 */
export const eliminarPlantillaSchema = z.object({ id: z.string().uuid() }).strict();

export type EliminarPlantillaInput = z.infer<typeof eliminarPlantillaSchema>;

/**
 * Feature 170 — FASE 2 (T I.1, R40) — entrada del listado paginado de PLANTILLAS de gasto
 * fijo. Sin filtros (design §11.3, riesgo BAJO) y sin alcance: quien lo ve son los roles de
 * acceso total y lo decide el servicio. `.strict()` para que cualquier clave desconocida
 * muera en el BORDE. Tamano de pagina desde `gastoFijoConfig` (T H.1).
 */
export const listarPlantillasGastoFijoPaginadoSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .default(gastoFijoConfig.DEFAULT_PAGE_SIZE)
      .transform((n) => Math.min(n, gastoFijoConfig.MAX_PAGE_SIZE)),
  })
  .strict();

export type ListarPlantillasGastoFijoPaginadoInput = z.infer<
  typeof listarPlantillasGastoFijoPaginadoSchema
>;

/**
 * Feature 184 — Tanda G (R17) — entrada del modo SIN paginacion (el conjunto del archivo).
 *
 * DERIVADA de la de su pagina quitando `page`/`pageSize`, no reescrita: si manana este listado
 * ganara un filtro, lo ganaria en el schema de la pagina y este lo heredaria, de modo que los
 * dos caminos no puedan resolver conjuntos distintos.
 *
 * Como la pagina solo llevaba esas dos claves, la lista blanca resultante tiene CERO claves.
 * Eso no vuelve prescindible el borde: lo vuelve maximamente estricto —cualquier clave, y en
 * particular `page`/`pageSize`, muere aqui con `validation_error` sin tocar el servicio—.
 * `.strict()` se reescribe aunque `.omit()` lo herede, por el mismo motivo que en la pagina.
 */
export const listarPlantillasGastoFijoCompletoSchema = listarPlantillasGastoFijoPaginadoSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarPlantillasGastoFijoCompletoInput = z.infer<
  typeof listarPlantillasGastoFijoCompletoSchema
>;

/**
 * Resultado del modo completo en el BORDE. `limite_excedido` lleva SOLO conteos y ninguna rama
 * de error viaja con filas (R6/R7).
 */
export type ListarPlantillasCompletoResult = ListarCompletoResult<GastoFijoPlantillaDTO>;
