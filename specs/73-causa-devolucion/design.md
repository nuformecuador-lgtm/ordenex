# Feature 73 — Causa tipificada de la devolución — design.md

> **Estado: gate F1.4 APROBADA (2026-07-15).** Todas las decisiones abiertas están resueltas;
> el registro completo (qué se decidió y por qué) vive en `requirements.md §F1.4`.
> Las rutas y líneas citadas están VERIFICADAS contra el código en la rama `flow`
> (2026-07-15); si al implementar difieren, se re-verifica antes de tocar nada.

## 0. Alcance en una frase

Añadir UN campo estructurado (`causaDevolucion`) a la rama `devuelta` del flujo de gestión de
la feature 36, atravesando las capas que ya existen: **UI → zod (borde) → Server Action →
Service → Repository → columna enum**. No hay endpoint nuevo, no hay tabla nueva, no hay
regla de negocio nueva.

**Sólo CAPTURA (F1.4-c, decisión del humano).** La causa se escribe y nadie la lee: la columna
nace de SOLO ESCRITURA por decisión consciente y aprobada. NO se toca el DTO del historial ni
la línea de tiempo; mostrarla/agruparla es follow-up. Ver el aviso de alcance en
`requirements.md`.

## 1. Modelo de datos

### 1.1 Enum Postgres + columna

Espejo EXACTO del enum hermano `gestion_resultado`/`GestionResultado`
(`db/schema.prisma:374`) y de la columna `metodoPago` (`:389`), que ya es un enum nullable
por rama.

```prisma
enum GestionCausaDevolucion {
  not_found     // Cliente no localizado
  wrong_number  // Número de celular errado
  wrong_address // Dirección errada

  @@map("gestion_causa_devolucion")
}

model GestionOrden {
  // …campos existentes intactos…
  causaDevolucion GestionCausaDevolucion? @map("causa_devolucion") // feature 73: DEVOLUCION
}
```

**Nullable** (F1.4-a): `gestion_orden` es una tabla con discriminador `resultado` y campos
nullable por rama —`monto_recibido`, `metodo_pago`, `evidencia_storage_path`,
`fecha_reprogramacion`, `motivo` ya lo son (`:388-393`)—. `NULL` = gestión no-`devuelta`, o
`devuelta` anterior a esta feature. La obligatoriedad vive en el borde (R6), como TODAS las
obligatoriedades por rama de la feature 36.

**Sin índice**: no hay consulta declarada sobre esta columna en este ciclo (R17 la lee por
`ordenId`, que YA tiene índice: `@@index([ordenId])`, `:409`). Añadir un índice para un
reporte agregado que no existe (F1.4-c, alternativa 2) sería especulativo; cuando ese reporte
se pida, se dimensiona con su query real.

### 1.2 Migración `db/migrations/<ts>_gestion_orden_causa_devolucion/`

`migration.sql` (UP) — aditiva, dos sentencias:

```sql
CREATE TYPE "gestion_causa_devolucion" AS ENUM ('not_found', 'wrong_number', 'wrong_address');
ALTER TABLE "gestion_orden" ADD COLUMN "causa_devolucion" "gestion_causa_devolucion";
```

`down.sql` (DOWN, OBLIGATORIO — `docs/architecture.md`) — orden inverso:

```sql
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "causa_devolucion";
DROP TYPE IF EXISTS "gestion_causa_devolucion";
```

Notas:
- **RLS (R15):** NO hay tabla nueva → NO hay superficie RLS nueva. `gestion_orden` ya tiene
  RLS habilitada sin policies (solo service role) desde `20260711150000`; la migración no la
  toca. Precedente idéntico y verificado: `20260714160000_gestion_orden_anulacion` documenta
  exactamente esta situación.
- **Reversibilidad limpia (a diferencia de la 67):** aquí el enum es NUEVO y su ÚNICA columna
  usuaria se suelta en el mismo `down.sql` → basta `DROP TYPE`, sin el rodeo
  `RENAME TO …_old` + `CREATE TYPE` + `USING cast` que exigió la 67 (que añadía un valor a un
  enum preexistente). El DOWN pierde las causas capturadas: es el reverso EXACTO (la feature
  deja de existir), igual que el DOWN de la 67 pierde el rastro de anulaciones.
- **Round-trip (R14):** `pnpm run db:migrate:create` (solo crea) → escribir `down.sql` a mano
  → `db:migrate` → `db:rollback` (`scripts/db-rollback.ts`) → `db:migrate`.

## 2. Fuente única de verdad valor→etiqueta (R2/R3, F1.4-d)

Se parte en DOS módulos, replicando la separación que el repo YA tiene entre
`lib/types/metodo-pago.ts` (SEED, dominio) y
`app/(app)/ordenes/_components/estatus-label.ts` (labels, presentación):

**`lib/types/causa-devolucion.ts`** — dominio. Consumido por zod (servidor) y por la UI.

```ts
import type { GestionCausaDevolucion } from "@prisma/client";

export const CAUSA_DEVOLUCION_SEED = [
  "not_found",
  "wrong_number",
  "wrong_address",
] as const satisfies readonly GestionCausaDevolucion[];

export type CausaDevolucion = (typeof CAUSA_DEVOLUCION_SEED)[number];

// Rompe el build si el enum Prisma gana un valor que el SEED no lista (patrón
// METODO_PAGO_SEED, lib/types/metodo-pago.ts:17-21).
type _EnsureExhaustive = Exclude<GestionCausaDevolucion, CausaDevolucion> extends never ? true : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;
```

El doble candado (R2) es el mismo del metodo-pago: `satisfies` rompe si el SEED inventa un
valor que el enum no tiene; `_EnsureExhaustive` rompe si el enum gana uno que el SEED no
lista. Prisma/zod/UI no pueden divergir en silencio.

**`app/(app)/mis-asignaciones/_components/causa-devolucion-options.ts`** — presentación.
**Espejo EXACTO del precedente hermano `metodo-pago-options.ts`** (misma carpeta), que hace
justo esto para el otro campo enum del mismo panel: SEED en `lib/types/`, labels colocados
junto a la página que los usa, `Record` tipado anclado al SEED → añadir/quitar una causa rompe
el build (no silencioso).

```ts
import { CAUSA_DEVOLUCION_SEED, type CausaDevolucion } from "@/lib/types/causa-devolucion";

export const CAUSA_DEVOLUCION_LABEL: Record<CausaDevolucion, string> = {
  not_found: "Cliente no localizado",
  wrong_number: "Número de celular errado",
  wrong_address: "Dirección errada",
};

export const CAUSA_DEVOLUCION_OPTIONS = CAUSA_DEVOLUCION_SEED.map(
  (value) => ({ value, label: CAUSA_DEVOLUCION_LABEL[value] }),
);
```

**Por qué aquí y no junto a `estatus-label.ts`:** al caer la visualización en el historial
(F1.4-c), el ÚNICO consumidor de estas etiquetas es el panel del mensajero →
`docs/architecture.md` §"sin sobre-ingeniería": *"si un componente se usa en UN SOLO lugar…
vive junto a la página que lo usa"*. `metodo-pago-options.ts` es el precedente literal. Si el
follow-up de F1.4-c añade un segundo consumidor (el timeline), ENTONCES se promueve — no
antes.

## 3. Contrato de borde (zod)

`lib/types/gestion-orden.ts` — SÓLO la variante `devuelta` de la unión discriminada
(`:112-116`) gana un campo. Las otras tres variantes NO se tocan (R10/R19): al ser una
`discriminatedUnion`, dejar la causa fuera de ellas hace que un cliente que la envíe en la
rama `entregada` simplemente no la pueda persistir — el campo no existe en el tipo parseado.

```ts
const causaDevolucionSchema = z.enum(CAUSA_DEVOLUCION_SEED, { message: "causa requerida" });

// rama devuelta (única que cambia):
z.object({
  ordenId: z.string().min(1),
  resultado: z.literal("devuelta"),
  causaDevolucion: causaDevolucionSchema, // feature 73
  motivo: motivoSchema,                   // feature 36: se CONSERVA obligatorio (R7)
}),
```

`motivoSchema` (`:93`) NO se toca: ya es `z.string().trim().min(1, "motivo requerido")`. La
obligatoriedad del textarea del pedido literal **ya existe**; esta feature la conserva (R7),
y su test de no-regresión lo demuestra.

R8 (ambos errores a la vez) sale gratis: `error.flatten().fieldErrors` de zod reporta todos
los campos fallidos de la variante, y el panel ya pinta errores por campo
(`firstError`, `:112-117`).

## 4. Server Action (`lib/actions/mis-asignaciones.ts`)

Dos cambios mecánicos, sin lógica:

1. `rawFromFormData` (`:185-190`): añadir `"causaDevolucion"` a la lista de campos leídos del
   FormData (`["ordenId", "resultado", "metodoPago", "fechaReprogramacion", "motivo"]`). Es
   un campo de texto → entra por el bucle existente, sin coerción (a diferencia de
   `montoRecibido`).
2. `toGestionarInput` (`:216-217`): la rama `devuelta` pasa a
   `{ ordenId, resultado: "devuelta", causaDevolucion: data.causaDevolucion, motivo: data.motivo }`.

El manejo de errores no cambia: un valor fuera del catálogo produce un `ZodError` que
`toMisAsignacionesActionError` ya normaliza a `validation_error` + `fieldErrors` (`:49-51`).

## 5. Service y Repository

**`IMisAsignacionesService.GestionarInput`** (`:93`): la variante `devuelta` pasa de
`{ ordenId; resultado: "devuelta"; motivo: string }` a
`{ …; causaDevolucion: CausaDevolucion; motivo: string }`. Las otras tres variantes intactas.

**`IGestionOrdenRepository.GestionOrdenData`** (`:52-61`): añadir
`causaDevolucion?: GestionCausaDevolucion | null`, junto a los demás campos nullable por rama.

**`MisAsignacionesService.buildGestionData`** (`:372-373`): la rama `devuelta` pasa de
`return { resultado: "devuelta", motivo: input.motivo }` a
`return { resultado: "devuelta", causaDevolucion: input.causaDevolucion, motivo: input.motivo }`.

**`crearGestionYTransicionar`** (`IGestionOrdenRepository.ts:133-139`): **NO cambia su
firma**. Recibe `gestion: GestionOrdenData` y hace el INSERT; el campo nuevo viaja dentro de
ese objeto. La atomicidad de R13 (gestión + `orden.update` + transición de seguimiento de la
47 + limpiar puntero, todo bajo `$transaction`) ya está y no se toca.

**La regla de la 47 NO se toca (R17/R18; decisión F1.4-e).** `MisAsignacionesService.gestionar`
decide reintento vs escalado en `resolverSeguimientoDevuelta` (`:211-214`, `:303-316`) leyendo
`contarIntentos` de la 49 y el umbral de `lib/config/reintentos.ts`. Esa decisión se toma
ANTES de la tx y **no lee la causa**. Que la causa no aparezca en esa ruta ES el diseño: la
verificación de R17 es un test que corre la misma orden con las 3 causas y afirma el MISMO
destino de seguimiento.

## 6. UI (`GestionarOrdenPanel.tsx`)

Cambios acotados a la rama `devuelta`:

- Estado local `const [causaDevolucion, setCausaDevolucion] = useState<CausaDevolucion | "">("")`,
  reseteado en `elegirResultado` (`:212-220`) junto a los demás campos → cambiar de resultado
  y volver no arrastra una causa fantasma.
- `buildRaw()` (`:165`): la rama `devuelta` pasa a
  `{ ...base, causaDevolucion: causaDevolucion || undefined, motivo }` (el `|| undefined`
  reproduce el patrón de `metodoPago`, `:159`, para que zod diga "requerido" y no
  "valor inválido" cuando no se eligió nada).
- `buildFormData()` (`:183-184`): la rama `devuelta` añade
  `fd.set("causaDevolucion", causaDevolucion)`.
- Render (`:437-439`): la rama `devuelta` pasa de `<MotivoField …/>` a un `<CausaField …/>`
  seguido del `<MotivoField …/>` sin cambios. `MotivoField` (`:494-522`) NO se modifica → las
  ramas `reprogramada` y `rechazada`, que lo comparten, quedan intactas por construcción
  (R19).
- `const causaError = firstError(fieldErrors, "causaDevolucion")` junto a los demás (`:261-264`).

`CausaField` (colocado en el mismo archivo, como `MotivoField`: un solo consumidor →
`docs/architecture.md` §"sin sobre-ingeniería") renderiza las opciones desde
`CAUSA_DEVOLUCION_OPTIONS` (nunca literales duplicados), con el error en `role="alert"` y
`aria-invalid` — mismo contrato accesible que `MotivoField`.

### 6.1 El control: RADIOS (F1.4-f resuelta) — y una corrección al design original

**Decisión aprobada: radios.** Verificación hecha tras la aprobación, contra el repo:

- `components/ui/` **NO tiene `radio-group`** (inventario verificado: alert, badge, button,
  card, checkbox, collapsible, input, label, select, separator, sheet, sidebar, skeleton,
  switch, tabs, tooltip). **Hay que añadirlo** → task **T5.0** explícita en `tasks.md`.
- **Corrección importante:** este repo **NO usa Radix**. `package.json` no declara ninguna
  dependencia `@radix-ui/*`; las primitivas se construyen sobre **`@base-ui/react` v1.6**
  (`package.json:23`) — ver `components/ui/select.tsx:4`
  (`import { Select as SelectPrimitive } from "@base-ui/react/select"`) y `checkbox.tsx:3`,
  ambos con el precedente documentado de `Modal`/`Toast`. Por tanto
  **`npx shadcn add radio-group` (Radix) es la instrucción EQUIVOCADA** para este repo y no
  debe ejecutarse: metería un árbol de dependencias paralelo al que ya se usa. (El paquete
  `shadcn` sí está en `package.json:41`, pero las primitivas resultantes se han portado a Base
  UI; el inventario de `components/ui/` lo confirma.)
- **Camino correcto:** crear `components/ui/radio-group.tsx` como primitiva sobre
  `@base-ui/react`, siguiendo el patrón EXACTO de `Select`/`Checkbox` (headless de Base UI +
  `cn()` + `data-slot`, exponiendo `value`/`onValueChange`/`options` y el nombre accesible por
  `aria-label`). Base UI aporta el rol `radiogroup`, la navegación por teclado y el manejo de
  foco, igual que aporta `combobox` en `Select`.
- **A VERIFICAR en T5.0 antes de escribir el componente:** el nombre y la superficie exactos
  del export de radio en `@base-ui/react` v1.6 (`@base-ui/react/radio` y/o
  `@base-ui/react/radio-group`). NO se pudo comprobar contra `node_modules` desde el entorno
  del spec_author (no está instalado en este worktree) → se comprueba contra los tipos
  instalados, no de memoria. **SI Base UI v1.6 no ofreciera una primitiva de radio**, la salida
  aprobada es el fallback del punto siguiente, anotándolo en `progress/impl_73-*.md`.
- **Fallback sin componente nuevo (sólo si lo anterior no existe):** `<input type="radio">`
  nativos dentro de un `<fieldset>`/`<legend>`, estilados con Tailwind, como hace el propio
  panel con `<input type="file">` (`:393-401`) y con el `<textarea>` de `MotivoField`
  (`:506-514`) — el panel ya usa controles nativos donde no hay primitiva. Cumple R4 y la
  accesibilidad sin dependencia nueva.

## 8. Alternativas descartadas

**8.1 Concatenar la causa en el `motivo` de texto libre.** *(Descartada por decisión (a) del
humano; se documenta el porqué técnico.)* Cero migración y cero cambio de esquema, pero: el
texto libre no se agrupa de forma fiable (`GROUP BY` sobre un `LIKE '%dirección%'` es un
heurístico, no un dato), rompe R12 (el motivo dejaría de ser lo que el mensajero escribió) y
hace imposible el reporte "devoluciones por causa" que MOTIVA la feature.

**8.2 Tabla de catálogo `causa_devolucion` + FK (patrón `order_status`).** Permitiría al
maestro editar las causas sin deploy y traería labels desde la BD. Se descarta: el pedido es
una lista CERRADA de 3 sin "Otro" (decisión (c)) → no hay caso de uso de edición en runtime;
añadiría una tabla (y su RLS, y su seed, y un JOIN en una ruta caliente) para un dato que no
cambia. El repo YA distingue estos dos casos y esta feature cae del lado del enum: enum
nativo para lo cerrado por diseño (`metodo_pago_value`, `gestion_resultado`, `rol_value`),
tabla de catálogo para lo que se administra (`order_status`).

**8.3 Columna `TEXT` libre + CHECK con la lista.** Sin `CREATE TYPE`, y ampliar la lista es un
`ALTER CONSTRAINT`. Se descarta: pierde el tipo generado por Prisma (`GestionCausaDevolucion`)
y con él el candado de exhaustividad de R2 —que es exactamente lo que impide que Prisma, zod
y la UI diverjan— a cambio de una flexibilidad que R1 no quiere.

**8.4 Reutilizar el enum `gestion_resultado` añadiéndole las causas.** Se descarta de plano:
mezcla dos dominios (el QUÉ pasó vs el POR QUÉ), rompería el `_EnsureExhaustive` de todo el
código que hoy hace switch sobre `resultado`, y exigiría recrear un enum en uso.

**8.5 Columna materializada `orden.causa_ultima_devolucion`.** Ahorraría el JOIN en un futuro
reporte. Se descarta: segunda fuente de verdad sobre un dato que ya vive en la gestión
(mismo motivo por el que 47/F1.4-a descartó `orden.intentos`), y pierde el histórico por
intento — que es justo el grano que hace útil la métrica.

**8.6 Mostrar la causa en la línea de tiempo del historial (49).** Era la RECOMENDACIÓN del
spec_author; **el humano la descartó en F1.4-c** a favor de "sólo capturar". Se documenta el
camino por si el follow-up la retoma: `OrdenHistorialEntradaDTO`
(`lib/types/orden-historial.ts:57-64`) ya expone `motivo: string | null` resuelto desde la
gestión enlazada → bastaría añadir `causaDevolucion` al DTO y a esa proyección, y una línea
condicional hermana de la de `motivo` en `HistorialOrdenTimeline` (`:69-71`). La autorización
saldría gratis (el DTO sólo se emite tras la visibilidad por rol de 49/R27). **En este ciclo
NO se toca nada de eso.**

## 9. Riesgos

- **Baseline (R21):** `dev` viene de estar en rojo (feature 72) y el typecheck baseline NO es
  0. Se MIDE en worktree limpio antes de tocar nada y se cita el número medido. No repetir el
  precedente 72 (baseline falso).
- **Enum Prisma nuevo ⇒ `prisma generate`:** `CAUSA_DEVOLUCION_SEED` importa
  `GestionCausaDevolucion` de `@prisma/client`; hasta que el cliente se regenere, el
  typecheck falla con un error que NO es del código. Orden obligatorio: schema → generate →
  resto (ver `tasks.md` B1).
- **`gestion_orden.motivo` es compartido** por reprogramar/devolución/rechazo: cualquier
  cambio a `motivoSchema` o a `MotivoField` toca 3 ramas. Por eso el diseño NO los toca — el
  campo nuevo es aditivo y separado.
- **Primitiva de radio (F1.4-f):** no hay `radio-group` en `components/ui/` y el repo va sobre
  Base UI, no Radix → T5.0 debe verificar la superficie de radio en `@base-ui/react` v1.6
  contra los tipos INSTALADOS (no de memoria, no con `npx shadcn add`) y, si no existe, tomar
  el fallback nativo de §6.1. Riesgo acotado: en el peor caso son `<input type="radio">` con
  `<fieldset>`.
- **Columna sin lector (F1.4-c):** por decisión aprobada, nada consume `causa_devolucion` en
  este ciclo. El riesgo real es que un lint/reviewer futuro la lea como código muerto → por eso
  queda registrada como decisión consciente en `requirements.md` (aviso de alcance + §F1.4-c) y
  en el comentario de la columna en `schema.prisma` (T1.1).
