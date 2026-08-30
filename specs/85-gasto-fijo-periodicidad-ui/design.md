# Ficha 85 — Periodicidad y día de cobro del gasto fijo en la UI · diseño

> Requisitos en `requirements.md`. Este documento decide el CÓMO. Todo lo que se afirma aquí
> sobre el código actual se leyó en el archivo real el 2026-08-29 (el índice del grafo se usó
> para localizar, no para concluir).

## 0. Lo que ya existe y NO se rehace

| Pieza | Estado verificado |
| --- | --- |
| `GastoFijoPlantilla.periodicidadUnidad / periodicidadCantidad / fechaCobro` | Existen (`db/schema.prisma:1836-1849`), con enum `PeriodicidadUnidad {dias, semanas, meses}` (`:1807-1811`), `CHECK >= 1` en la migración y `fecha_cobro @db.Date` como ancla del primer cobro. Los entregó la ficha 84. |
| `aplicaHoy(plantilla, now)` y `periodoDe(plantilla, now)` | Existen y son puras (`lib/utils/periodicidad.ts`), con reloj inyectable, aritmética en UTC sobre el día calendario CR (`startOfDayCR`) y clamping de fin de mes. |
| `GastoFijoPlantillaDTO` | Ya lleva los tres campos (`lib/types/gasto-fijo-plantilla.ts:14-26`); el repositorio los mapea (`GastoFijoPlantillaRepository.ts:28-40`). **La UI ya los tiene en la mano y no los usa.** |
| Servicio y repositorio de plantillas | `ActualizarPlantillaInput` ya exige los tres campos (`lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts:12-26`). **No se tocan en esta ficha.** |
| Cron, clave de idempotencia, agenda `0 6 * * *` | No se tocan. |

**Decisión estructural: esta ficha no crea ninguna migración, ninguna columna, ningún enum y
ninguna tabla.** El repo ya descartó dos specs por proponer modelo nuevo donde hacía falta el
arreglo mínimo. Aquí el arreglo mínimo son dos líneas de contrato en el borde, una función pura y
la pantalla que enseña lo que la tabla ya guarda.

---

## 1. Modelo de datos

**Sin cambios.** Ni DDL, ni RLS, ni índices. `gasto_fijo_plantilla` mantiene su RLS habilitada
sin policies (solo service role), que es el patrón de la tabla desde la 45.

Consecuencia para el gate: el diff de esta ficha **no debe** contener `db/migrations/**` ni
`db/schema.prisma`. Si aparecen, la ficha se salió de su alcance.

---

## 2. Backend A — cerrar el reset silencioso (borde zod)

### 2.1 El cambio

`lib/types/gasto-fijo-plantilla.ts` pasa de **un** fragmento con defaults compartido por crear y
actualizar, a **una** declaración de reglas y **dos** aplicaciones de ellas:

```ts
// Reglas de campo, declaradas UNA vez (para que crear y actualizar no puedan divergir).
const periodicidadUnidadSchema = z.enum(["dias", "semanas", "meses"]);
const periodicidadCantidadSchema = z.coerce.number().int().min(1, "La cantidad debe ser al menos 1.");
const fechaCobroSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de cobro debe tener el formato YYYY-MM-DD.")
  .refine(esFechaCalendarioValida, "La fecha de cobro no existe en el calendario.");

// CREAR conserva los defaults (ver §2.3).
const periodicidadConDefault = {
  periodicidadUnidad: periodicidadUnidadSchema.default("meses"),
  periodicidadCantidad: periodicidadCantidadSchema.default(1),
  fechaCobro: fechaCobroSchema.default(() => fechaCalendarioCR()),
};

// ACTUALIZAR los EXIGE: sin default, sin optional.
const periodicidadRequerida = {
  periodicidadUnidad: periodicidadUnidadSchema,
  periodicidadCantidad: periodicidadCantidadSchema,
  fechaCobro: fechaCobroSchema,
};

export const crearGastoFijoPlantillaSchema = z.object({
  concepto: z.string().trim().min(1, "El concepto es obligatorio."),
  monto: montoPositivoSchema,
  ...periodicidadConDefault,
});

export const actualizarGastoFijoPlantillaSchema = crearGastoFijoPlantillaSchema.extend({
  id: z.string().uuid(),
  ...periodicidadRequerida, // pisa los tres campos con la variante SIN default
});
```

`.extend()` sobre el schema de crear (y no un objeto escrito de cero) conserva la propiedad que
ya tenía el archivo: `concepto` y `monto` se declaran una sola vez. Lo único que actualizar
redeclara es lo que tiene que diferir.

### 2.2 Qué pasa entonces con una edición incompleta

`actualizarPlantillaAction` ya parsea con ese schema y `withErrorHandler` traduce el `ZodError` a
`{ status: "validation_error", fieldErrors }` (`lib/actions/gasto-fijo-plantilla.ts:104-116` y
`toPlantillaActionError`). Con los defaults fuera, una edición sin ciclo **muere en el borde**
antes de tocar el servicio, con `fieldErrors` en las tres claves (R1). Hoy pasa entera y mueve el
ancla en silencio.

**El servicio y el repositorio no cambian**: `actualizarPlantilla` ya pasa los tres campos y
`actualizar` ya los escribe. Lo que estaba roto no era el escritor, era el contrato que le
entregaba valores inventados.

### 2.3 Por qué CREAR conserva sus defaults (asimetría deliberada, R4)

Tres razones, en orden de peso:

1. **Crear no pisa nada.** El daño medido es la **sobrescritura silenciosa de un valor que ya
   existía**. En una creación no hay valor previo: el default es un primer valor, no un borrado.
2. **No hay evidencia de fallo en el camino de crear.** Quitarle los defaults sería endurecer un
   camino que hoy funciona, y esta ficha arregla lo evidenciado.
3. **El default de crear es además el comportamiento documentado**: `meses`/`1`/hoy es
   exactamente lo que hacía el sistema antes de la 84 y lo que la migración usó como backfill.

Riesgo aceptado y declarado: cuando la UI empiece a mandar siempre los tres campos (R15), los
defaults de crear quedan como red de un solo consumidor —la propia acción, si alguien la llama
desde un script—. No se retiran por 1 y 2, y R4 los fija con un test para que nadie los borre por
«código muerto» sin leer esto.

### 2.4 `fechaCobro` tiene que ser un día que exista (R5)

`lib/utils/fecha-cr.ts:56-77` ya documenta la trampa: el regex mide la FORMA y `2026-02-31` la
cumple; `new Date("2026-02-31T00:00:00.000Z")` **rueda al 3 de marzo** sin error. Un ancla rodada
es la misma familia de fallo que esta ficha cierra —el sistema guarda un día distinto del que le
pidieron, callado—, así que el borde añade `.refine(esFechaCalendarioValida)`, que es la pieza que
el repo ya usa para esto. Es la única regla nueva de validación; si el humano prefiere superficie
cero, se puede quitar sin afectar a nada más (Pregunta abierta implícita, se declara aquí).

### 2.5 Contratos I/O (no cambian de forma, sí de obligatoriedad)

```
actualizarPlantillaAction(input)
  input  = { id: uuid, concepto: string, monto: string,
             periodicidadUnidad: "dias"|"semanas"|"meses",
             periodicidadCantidad: number >= 1,
             fechaCobro: "YYYY-MM-DD" }        // los tres, OBLIGATORIOS (antes: opcionales)
  salida = { status: "ok", plantilla: GastoFijoPlantillaDTO }
         | { status: "validation_error", fieldErrors }
         | { status: "not_found" } | { status: "forbidden" } | { status: "unauthenticated" }

crearPlantillaAction(input)
  input  = { concepto, monto } + los tres del ciclo OPCIONALES (defaults meses/1/hoy-CR)
```

Money-safe: `monto` sigue siendo `montoPositivoSchema` (STRING, > 0, hasta 2 decimales) de punta
a punta. `periodicidadCantidad` **no es dinero**: es un contador, viaja como número entero.

---

## 3. Backend B — la lógica pura del próximo cobro

### 3.1 Firma

En `lib/utils/periodicidad.ts` (único archivo nuevo de lógica que esta ficha permite), junto a sus
dos hermanas y con la misma convención:

```ts
/** Fecha calendario CR (`YYYY-MM-DD`) del PRÓXIMO cobro: la primera >= hoy en que la plantilla cobra. */
export function proximoCobro(plantilla: PlantillaPeriodica, now: Date): string
```

- Reloj **inyectado** (`now`), como `aplicaHoy`/`periodoDe`. Sin Prisma, sin HTTP, sin `Date.now()`.
- Trabaja sobre `startOfDayCR(now)` y el ancla a medianoche UTC, la misma escala que ya usa el
  módulo: ambos lados de toda comparación viven en la misma convención (R12).
- Devuelve `YYYY-MM-DD`, no `Date`: es lo que la pantalla pinta y lo que el archivo escribe.

### 3.2 Regla, en cerrado (sin barrido de días)

Sea `hoy = startOfDayCR(now)` y `ancla = fechaCobro`:

- `hoy < ancla` → devuelve `ancla` (R8).
- `dias` / `semanas`: `paso = cantidad` (o `7 * cantidad`);
  `k = ceil(diffEnDias(hoy, ancla) / paso)`; resultado `= ancla + k * paso` días.
  Con `hoy` justo sobre un disparo, `diff % paso === 0` y `k` no avanza → devuelve **hoy** (R9).
- `meses`: `k = ceil(diffEnMeses(hoy, ancla) / cantidad)`; candidato = día
  `min(ancla.dia, ultimoDiaDelMes(mesDestino))` del mes `ancla.mes + k * cantidad` (R10, el mismo
  clamping que `aplicaHoy` ya aplica). Si el candidato cae **antes** que `hoy` (p. ej. el ancla es
  día 5 y hoy es 20), se recalcula con `k + 1`. Un solo reintento basta: el siguiente periodo
  siempre cae en un mes posterior al de `hoy`.

`diffEnDias`, `diffEnMeses` y `ultimoDiaDelMes` ya existen en el módulo como funciones privadas;
se reutilizan tal cual, no se duplican.

### 3.3 Cómo se prueba que no miente (R11)

El test no se conforma con fechas esperadas a mano: hace un **barrido diferencial** contra
`aplicaHoy`, que es una implementación independiente de la misma regla. Para un juego de
plantillas (las cuatro del pedido + `cada 3 dias` + `cada 6 meses` + anclas 29/30/31) y 400 días
consecutivos de reloj:

- `aplicaHoy(p, proximoCobro(p, now))` es `true`, y
- ningún día entre `hoy` (incluido) y esa fecha (excluida) cumple `aplicaHoy`.

Esto es un oráculo real —dos funciones distintas—, no una aserción contra la propia fuente. Se
complementa con casos literales (bisiesto 2028, ancla 31 → 28/feb y 30/abr) para que un fallo diga
qué día está mal, y no solo que algo lo está.

### 3.4 Lo que `proximoCobro` NO sabe

No sabe si la plantilla está **activa**: `PlantillaPeriodica` no tiene ese campo y no se le añade.
Una plantilla inactiva no se cobra, pero eso es una decisión de presentación (R19) que vive en las
etiquetas, no en la aritmética del ciclo. Meter `activa` aquí obligaría al cron —que ya filtra por
activa en el repositorio— a razonar dos veces sobre lo mismo.

---

## 4. Frontend C — diálogo, listado, etiquetas y archivo

### 4.1 De dónde sale «hoy» (R23)

El instante se resuelve **en el servidor** y baja por props:

```
app/(app)/wallet/page.tsx          → ahoraIso = new Date().toISOString()
  → WalletModule (cliente)         → prop `ahoraIso: string`, la pasa tal cual
    → GastosFijosPlantillasPanel   → prop `ahoraIso: string` (REQUERIDA)
      → const ahora = useMemo(() => new Date(ahoraIso), [ahoraIso])
```

La prop es **obligatoria** a propósito: este repo ya se comió un composition root que importaba
una dependencia y nunca la pasaba, con la suite en verde. Una prop requerida convierte ese fallo
en un error de `tsc`. Cadena de cuatro archivos, y los tres montajes de test que ya existen del
panel tendrán que pasarla (§6.2).

### 4.2 Etiquetas (`app/(app)/wallet/_components/wallet-labels.ts`, módulo puro)

Se añaden, sin React y sin leer ningún reloj (mismo criterio que `lib/utils/dia-reparto-textos.ts`):

```ts
export const PERIODICIDAD_PRESETS = [
  { id: "diaria",   label: "Diaria",    unidad: "dias",    cantidad: 1 },
  { id: "semanal",  label: "Semanal",   unidad: "semanas", cantidad: 1 },
  { id: "quincenal",label: "Quincenal", unidad: "semanas", cantidad: 2 },
  { id: "mensual",  label: "Mensual",   unidad: "meses",   cantidad: 1 },
] as const;                                            // equivalencias del pedido literal

export function periodicidadLegible(unidad: PeriodicidadUnidad, cantidad: number): string
export function presetDePeriodicidad(unidad, cantidad): PeriodicidadPresetId | "personalizada"
export function proximoCobroTexto(plantilla: GastoFijoPlantillaDTO, ahora: Date): string
```

- `periodicidadLegible` devuelve la etiqueta del preset cuando el par coincide, y si no
  «Cada 3 días» / «Cada 6 meses» (unidad en singular cuando `cantidad === 1`, caso que en la
  práctica ya cubre un preset). El test la fija con **literales**, no contra la tabla de presets.
- `proximoCobroTexto` es lo único de este módulo que recibe un `Date`, y lo recibe por parámetro:
  devuelve `"No se cobra"` si `!plantilla.activa` (R19), y si no `fechaLegible(fecha) + " de " + año`
  → «14 de septiembre de 2026». Se reutiliza `fechaLegible` de `lib/utils/dia-reparto-textos.ts`
  (tabla de meses, sin `Intl`, sin zona horaria del navegador). **Con año siempre**: un ciclo de 6
  meses cruza el año y «14 de mayo» a secas sería ambiguo.

### 4.3 Diálogo (`GastoFijoPlantillaDialog.tsx`)

Campos, en orden: **Concepto** · **Monto** · **Cada cuánto se cobra** · [**Cada** N + **unidad**,
solo si «Personalizada»] · **Día del primer cobro**.

- «Cada cuánto se cobra»: `Select` de `components/ui/select` (patrón de
  `RegistrarEgresoAdministrativoDialog`) con los cuatro presets + «Personalizada».
- «Cada N» = `Input` numérico validado en cliente con `/^[1-9]\d*$/`; «unidad» = `Select`
  {Días, Semanas, Meses}.
- «Día del primer cobro» = `Input type="date"` (patrón de `DescargarGestionesDialog` y
  `GestionarDesdeAyudaModal`), sembrado con `fechaCalendarioCR()` al crear.
- Al **editar**, los tres se siembran desde el DTO (R14) en el mismo bloque que hoy re-siembra
  concepto y monto cuando cambia `plantilla?.id`.
- Al confirmar se envían **siempre** los cinco campos (R15). El payload de edición se arma con el
  estado del formulario, que en una edición donde solo cambió el monto contiene el ciclo tal cual
  vino del DTO (R3).
- `fieldErrors` del servidor se mapean a los campos nuevos además de concepto/monto (R17).
- Textos: la descripción del diálogo deja de decir «cada mes» (R22); la etiqueta del monto pasa a
  **«Monto»** con ayuda «Es lo que se cobra cada vez».

### 4.4 Listado (`GastosFijosPlantillasPanel.tsx`)

Columnas: `Concepto | Monto | Periodicidad | Próximo cobro | Estado | Acciones`.

- «Periodicidad» → `periodicidadLegible(p.periodicidadUnidad, p.periodicidadCantidad)`.
- «Próximo cobro» → `proximoCobroTexto(p, ahora)`.
- «Monto mensual» → **«Monto»** (R22). Esta decisión estaba **dirigida por escrito a esta ficha**
  en `progress/impl_189.md §8`: «dos plantillas de ₡50.000, una semanal y una mensual, saldrán
  como filas idénticas bajo esa etiqueta, y el test seguirá VERDE afirmando que está bien».
- Descripción de la tarjeta y avisos de activar/desactivar: dejan de prometer «cada mes». Se
  redactan en términos del ciclo de cada plantilla («según la periodicidad que tenga cada una»).
  Sin siglas y sin nombres de columna, la regla de vocabulario del repo.
- La tabla ya está dentro de `overflow-x-auto`: dos columnas más no rompen el ancho.

### 4.5 Archivo descargable (`gastos-fijos-descarga-columnas.ts`)

**Sí entran las dos columnas nuevas** (R21). El criterio vigente del propio módulo es que el
archivo refleja lo que la tabla enseña (su comentario cita R24 de la 170: no emitir lo que el
listado no muestra); dejar fuera «Próximo cobro» obligaría a explicar por qué falta en el Excel
justo la columna por la que se abre el panel.

```ts
export const COLUMNAS_DESCARGA_GASTOS_FIJOS = [
  { clave: "concepto",    encabezado: "Concepto" },
  { clave: "monto",       encabezado: "Monto" },
  { clave: "periodicidad",encabezado: "Periodicidad" },
  { clave: "proximoCobro",encabezado: "Próximo cobro" },
  { clave: "estado",      encabezado: "Estado" },
];

export function filaDescargaGastoFijo(p: GastoFijoPlantillaDTO, ahora: Date): DescargaFila
```

- El mapper gana un **segundo parámetro** (`ahora`), no una fábrica: el punto de llamada del panel
  cierra sobre el mismo `ahora` que pinta la tabla
  (`obtenerFilas: () => filasDesdeResultado(listarPlantillasCompletoAction(), (p) => filaDescargaGastoFijo(p, ahora))`),
  así que archivo y pantalla no pueden discrepar de fecha.
- Valores: `monto` **crudo** (STRING, sin símbolo, R24); `periodicidad` con la MISMA etiqueta
  legible que la tabla; `proximoCobro` como `YYYY-MM-DD` (ordenable en Excel) y `"No se cobra"` en
  las inactivas, mismo criterio con el que `estado` ya sale como etiqueta y no como booleano.

### 4.6 La regla del pedido, visible (R25)

`RegistrarEgresoAdministrativoDialog` (gasto variable / sueldo) **no gana nada**: sigue sin ofrecer
periodicidad, que es justamente la regla «un variable no puede ser periódico». Se fija con un caso
de regresión en su test existente, no con código nuevo. La contraparte visible es la descripción
de la tarjeta de gastos fijos, que dice que ahí y solo ahí se configura lo que se cobra solo.

---

## 5. Alternativas descartadas

**A1. Semántica de parche en `actualizar` (campos opcionales que preservan lo existente).**
El servicio leería la plantilla (ya la lee, para el `not_found`) y rellenaría los campos ausentes
con los guardados. *Descartada:* hace indistinguibles «no lo mandé» y «no lo quiero cambiar», mete
lógica de merge en el servicio para un formulario que **tiene los tres valores en la mano** (el DTO
ya los trae), y sobre todo deja el fallo original a un descuido de distancia: si mañana alguien
manda `periodicidadUnidad: "meses"` por error, el parche lo escribe igual de callado. El humano
pidió explícitamente que una edición incompleta muera con `validation_error` en el borde.

**A2. Calcular `proximoCobro` en el servidor y añadirlo al `GastoFijoPlantillaDTO`.**
*Descartada:* mete un reloj en la capa de datos (el DTO lo construye el repositorio, que hoy es un
mapeo puro de fila a DTO), y contamina un contrato que consumen el cron, la paginación y la
descarga completa —tres consumidores que no necesitan esa fecha—. El cálculo es una derivación de
presentación de datos que el DTO **ya trae**; su sitio es la capa que presenta.

**A3. Que la pantalla lea `new Date()` del navegador.**
*Descartada:* el panel se renderiza también en el servidor, así que un cambio de día entre SSR e
hidratación produce divergencia de hidratación; y deja el valor a merced del reloj de la máquina
del usuario. El repo ya tiene esta decisión escrita en `lib/utils/dia-reparto-textos.ts` («aquí no
se lee ningún reloj… un portátil con la hora corrida no puede etiquetar mal una opción») y el
precedente de `wallet/mensajeros/page.tsx`, que resuelve su fecha en el Server Component.

**A4. Quitar los defaults también al schema de CREAR, por simetría.**
*Descartada:* ver §2.3. No hay fallo evidenciado en crear y el default de crear no sobrescribe
nada. La asimetría es la decisión, y por eso lleva su propio test (R4) en vez de quedar como
descuido.

**A5. Modelar la periodicidad como un enum cerrado de presets (`diaria|semanal|quincenal|mensual`)
en la base.** *Descartada de plano:* el humano decidió el modelo unidad+cantidad+fecha en la 84
precisamente para admitir «cada 3 días» y «cada 6 meses», las columnas ya existen y esta ficha no
toca el modelo. Los cuatro presets viven donde son verdad —en la etiqueta de un selector—, no en
la base.

**A6. Un selector con solo cantidad + unidad, sin presets.** *Descartada como propuesta, pero
abierta a la puerta humana* (pregunta 1 de `requirements.md`): es más simple, pero el pedido
literal nombra «quincenal» y nadie va a deducir que eso es «2 semanas» leyendo un selector de
unidades.

---

## 6. Riesgos y efectos colaterales

### 6.1 Riesgo alto: idempotencia y doble cobro

Cambiar `periodicidadUnidad` de/hacia `meses` cambia el **formato** del periodo de la clave
`origen_id = "<plantillaId>:<periodo>"` (`YYYY-MM` ↔ `YYYY-MM-DD`), y ese es el escenario de doble
cobro que `GeneracionGastosFijosService` documenta en su cabecera. Esta ficha **no cambia esa
regla**; lo que hace es que ese cambio deje de ocurrir **sin que nadie lo pida**. Un maestro que
cambie la periodicidad a propósito sigue pudiendo mover la clave: es su decisión, y el aviso de
ayuda del campo de fecha lo enuncia en palabras.

Estado en producción medido el 2026-08-29: 2 plantillas, ambas inactivas, cero movimientos
`egreso_gasto_fijo` emitidos jamás. El despliegue de esta ficha no puede provocar un cobro
duplicado sobre datos que no existen; el valor es preventivo.

### 6.2 Tests existentes que esta ficha DEBE tocar (y por qué no es opcional)

| Test | Qué se rompe | Acción |
| --- | --- | --- |
| `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts:130-137` | «not_found se propaga» llama a `actualizarPlantillaAction({id, concepto, monto})`; con R1 muere antes en `validation_error` | completar el payload con el ciclo |
| `tests/unit/descarga/gastos-fijos-descarga-columnas.test.ts:18-27` | Fija las 3 columnas y el encabezado «Monto mensual» con `toEqual` literal | actualizar: ese literal **ES** el contrato (por eso se actualiza a mano, no se cambia por su propia fuente) |
| `tests/unit/components/wallet-gastos-fijos-panel.test.tsx` | `getByLabelText("Monto mensual")` (4 usos), `/automáticamente cada mes/`, y el montaje sin `ahoraIso` | actualizar etiquetas y montaje |
| `tests/components/paginacion/BajoRiesgoPaginacion.test.tsx:666` | Monta el panel sin `ahoraIso` | pasar la prop |
| `tests/components/descarga/WalletPropsDescarga.test.tsx:223` | Monta el panel sin `ahoraIso` | pasar la prop |

Ninguno de estos cambios es «arreglar un test para que pase»: los cinco fijan textos o firmas que
esta ficha cambia a propósito, y tres de ellos son exactamente la deuda que `progress/impl_189.md`
dejó dirigida aquí.

### 6.3 Superficie que NO cambia

Servicio, repositorio, interfaces, cron, acciones de listado, paginación, RLS, `vercel.json`.
Si el diff los toca, hay que justificarlo o revertirlo.

---

## 7. Verificación

- `pnpm typecheck` y `pnpm lint` en verde (los cambios de prop requerida se ven aquí primero).
- `pnpm exec vitest related --run <archivos tocados>` por cada tanda (subagentes), y
  `./init.sh --rapido` al cerrar cada tanda / antes del PR (leader), según la regla del gate.
- El gate rápido se niega solo si el diff toca `lib/types/` —y **este diff lo toca**
  (`lib/types/gasto-fijo-plantilla.ts`)—: cuenta con la corrida **completa** de `./init.sh` antes
  del PR. No es sorpresa, es el camino previsto.
- **E2E: se declara inaplicable, con evidencia.** `docs/verification.md` pide un E2E para features
  con UI; el repo tiene `e2e/*.spec.ts` (incluido `e2e/wallet.spec.ts`), pero esos ficheros están
  **escritos y NO ejecutados** —lo dicen ellos mismos: «WRITTEN but NOT EXECUTED… They do NOT run
  under `pnpm test`» (`e2e/wallet.spec.ts:36-39`)—, así que añadir uno aquí no aportaría
  verificación, solo texto. El riesgo de esta ficha lo cubren la guardia del fallo mudo (R3), el
  barrido diferencial contra `aplicaHoy` (R11) y las pruebas de pantalla en jsdom (R13-R19). Si el
  humano quiere además una pasada manual por `/wallet` antes de desplegar, es la vía que este repo
  ya ha usado con éxito para cazar textos rotos.
