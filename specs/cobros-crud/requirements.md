# Requisitos — cobros (CRUD backend)

> Alcance: tabla nueva `cobro` con las 8 columnas monetarias/tasa listadas en la
> feature 18 (`valor_flete`, `valor_flete_devuelto`, `valor_flete_gam`,
> `valor_flete_devuelto_gam`, `fulfillment`, `comision_cod`, `iva_flete`,
> `iva_comision_cod`) más las columnas estándar (`id`, `created_at`, `updated_at`,
> `deleted_at`), su migración Prisma reversible con RLS, y el CRUD (crear,
> obtener, listar, actualizar, borrar lógico) expuesto como Server Actions con
> validación zod, manejo de errores común (feature 10) y **autorización por rol**.
> NO incluye UI ni relación con zonas/órdenes (esa relación es de la feature 24,
> aún inexistente; ver "Decisiones cerradas" D1).
>
> Se replica EXACTAMENTE el patrón por capas del CRUD de órdenes (feature 6):
> Server Action (`withErrorHandler` + `toActionError` + `resolveActorFromSession`)
> → `CobroService` (autorización + validación de dominio) → `CobroRepository`
> (solo Prisma) → tipos/zod en `lib/types/cobro.ts`. Complejidad: `medium`
> (feature_list.json id 18).
>
> **Nota de semántica de negocio:** la feature solo listaba nombres de columnas,
> sin definir si `iva_*`/`comision_cod`/`fulfillment` son montos o porcentajes, ni
> la cardinalidad de la tabla. Esas ambigüedades fueron **resueltas por el humano
> (2026-07-10)** y se detallan al final en "Decisiones cerradas (humano,
> 2026-07-10)". Los requisitos R1–R27 reflejan esas decisiones.

## Modelo `cobro` y tipos de columna

- **R1 (ubicuo):** El sistema DEBE persistir cada cobro con: `id` (uuid TEXT),
  `nombre` (TEXT, para distinguir tarifas; D1), las 8 columnas de la feature
  (`valor_flete`, `valor_flete_devuelto`, `valor_flete_gam`,
  `valor_flete_devuelto_gam`, `fulfillment`, `comision_cod`, `iva_flete`,
  `iva_comision_cod`), `deleted_at`, `created_at` y `updated_at`. NO DEBE agregar
  columnas de negocio fuera de `nombre` + esas 8 (ni FK a `zona`/`orden`/`tienda`;
  la relación por zona es la feature 24, D1).
- **R2 (ubicuo):** El sistema DEBE almacenar las columnas de **monto**
  (`valor_flete`, `valor_flete_devuelto`, `valor_flete_gam`,
  `valor_flete_devuelto_gam`, `fulfillment`) como tipo numérico de **precisión
  fija** (`Decimal @db.Decimal(12,2)`, consistente con `orden.monto_cobrar`),
  nunca punto flotante ni texto (D3: `fulfillment` es un monto).
- **R3 (ubicuo):** El sistema DEBE almacenar las columnas de **porcentaje**
  (`comision_cod`, `iva_flete`, `iva_comision_cod`) como decimal de precisión fija
  que represente un **porcentaje en el rango 0..100** (`Decimal @db.Decimal(5,2)`;
  p.ej. `15.00` = 15%), nunca punto flotante ni texto (D2: IVA como porcentaje;
  D3: `comision_cod` es porcentaje).
- **R4 (ubicuo):** El sistema DEBE mapear cada columna a `snake_case` en la base de
  datos vía `@map`/`@@map` (tabla `cobro`), normalizando `GAM` a minúsculas:
  `valor_flete_gam`, `valor_flete_devuelto_gam`. Los campos TS son `camelCase`
  (`nombre`, `valorFleteGam`, `valorFleteDevueltoGam`, etc.).
- **R5 (ubicuo):** El sistema DEBE definir `nombre` y las 8 columnas numéricas como
  **NOT NULL** (una tarifa incompleta no es válida); DEBE rechazar `nombre` vacío,
  valores **negativos** en las 8 numéricas, y valores **> 100** en los porcentajes
  (`comision_cod`, `iva_flete`, `iva_comision_cod`) (D5).
- **R6 (ubicuo):** El sistema DEBE crear la tabla `cobro` (con `nombre` y las 8
  columnas numéricas) mediante una migración Prisma versionada con `migration.sql`
  (UP) y `down.sql` (DOWN); el `down.sql` DEBE eliminar **únicamente** la tabla
  `cobro`, sin afectar tablas preexistentes.
- **R7 (ubicuo):** El sistema DEBE habilitar Row Level Security
  (`ENABLE ROW LEVEL SECURITY`) sobre `cobro`, **sin policies** para
  `anon`/`authenticated` (acceso solo por service role; defensa en profundidad,
  patrón del repo). La autorización fina por rol vive en `CobroService`, no en
  policies.

## Autenticación y autorización por rol

- **R8 (condicional):** SI una Server Action de CRUD de cobros se invoca sin sesión
  válida (cookie `session` ausente o expirada), ENTONCES el sistema DEBE rechazar
  con error de no autenticado (`unauthenticated`), sin tocar la base de datos.
- **R9 (ubicuo):** El sistema DEBE resolver el rol del actor desde su usuario de
  sesión (`resolveActorFromSession`) y autorizar cada operación según la matriz
  rol→operación siguiente.
- **R10 (condicional):** SI el actor tiene rol `maestro`, ENTONCES el sistema DEBE
  permitirle crear, obtener, listar, actualizar y borrar cobros.
- **R11 (condicional):** SI el actor tiene rol `admin`, ENTONCES el sistema DEBE
  permitirle **obtener y listar** cobros y DEBE rechazar crear/actualizar/borrar
  con `forbidden` (D4: solo `maestro` escribe).
- **R12 (condicional):** SI el actor tiene rol `adminTienda` o `mensajero`,
  ENTONCES el sistema DEBE rechazar **toda** operación de cobros con `forbidden`.
- **R13 (condicional):** SI el actor no está autorizado para la operación (según la
  matriz) o su rol no es reconocido, ENTONCES el sistema DEBE rechazar con
  `forbidden`, sin modificar datos.

### Matriz rol → operación (propuesta por defecto)

| Rol           | crear | obtener/listar | actualizar | borrar |
| ------------- | ----- | -------------- | ---------- | ------ |
| `maestro`     | Sí    | Sí             | Sí         | Sí     |
| `admin`       | No    | Sí             | No         | No     |
| `adminTienda` | No    | No             | No         | No     |
| `mensajero`   | No    | No             | No         | No     |

(Solo `maestro` escribe; `admin` solo lee/lista — D4.)

## Crear cobro

- **R14 (por evento):** CUANDO se recibe una solicitud de creación, el sistema DEBE
  validar la entrada con un schema zod en el borde (`nombre` no vacío; las 8
  columnas numéricas presentes y no negativas; los porcentajes `comision_cod`/
  `iva_flete`/`iva_comision_cod` en 0..100 según R3) antes de llamar al servicio.
- **R15 (condicional):** SI la entrada de creación no cumple el schema (`nombre`
  vacío/ausente, columna numérica ausente, no numérica, negativa, o un porcentaje
  fuera de 0..100), ENTONCES el sistema DEBE rechazar con error de validación por
  campo (`validation_error` con `fieldErrors`), sin crear el cobro.
- **R16 (por evento):** CUANDO la entrada es válida y el actor está autorizado, el
  sistema DEBE crear el cobro persistiendo `nombre`, las 8 columnas numéricas y
  `created_at`/`updated_at`, y DEBE devolver el DTO del cobro creado.

## Obtener / listar

- **R17 (por evento):** CUANDO se solicita un cobro por `id`, el sistema DEBE
  devolverlo si existe, no está borrado y el actor está autorizado; en caso
  contrario DEBE responder `not_found`.
- **R18 (por evento):** CUANDO se solicita el listado, el sistema DEBE devolver los
  cobros en una estructura paginada que incluya como mínimo la página de resultados
  y el total de elementos (`{ items, page, pageSize, total }`), aplicando un límite
  máximo configurable al tamaño de página.
- **R19 (ubicuo):** El sistema NUNCA DEBE incluir cobros borrados lógicamente
  (`deleted_at IS NOT NULL`) en lecturas ni listados por defecto.

## Actualizar

- **R20 (por evento):** CUANDO se recibe una actualización por `id`, el sistema
  DEBE validar la entrada con zod (todos los campos opcionales, incluido `nombre`;
  mismas reglas de no negatividad / rango 0..100 de porcentajes / `nombre` no vacío
  que en creación, `strict` sin campos desconocidos) y verificar autorización antes
  de modificar datos.
- **R21 (condicional):** SI el cobro objetivo no existe o está borrado, ENTONCES el
  sistema DEBE responder `not_found`.
- **R22 (por evento):** CUANDO la actualización es válida y autorizada, el sistema
  DEBE aplicar solo los campos provistos, no tocar `id`/`created_at`, actualizar
  `updated_at` y devolver el DTO actualizado.
- **R23 (condicional):** SI la actualización incluye un campo con valor inválido
  (`nombre` vacío, monto/porcentaje negativo, no numérico, o un porcentaje fuera de
  0..100), ENTONCES el sistema DEBE rechazar con error de validación por campo, sin
  modificar el cobro.

## Borrar (lógico)

- **R24 (por evento):** CUANDO se recibe un borrado por `id` de un actor autorizado
  (`maestro`), el sistema DEBE marcar el cobro como borrado de forma **lógica**
  (fijar `deleted_at`) y excluirlo de lecturas/listados por defecto (R19).
- **R25 (condicional):** SI el cobro objetivo no existe o ya está borrado, ENTONCES
  el sistema DEBE responder `not_found`.

## Manejo de errores y contrato de salida (transversal)

- **R26 (ubicuo):** El sistema DEBE devolver desde cada Server Action un resultado
  **tipado y discriminado** por estado (`ok` con datos; `validation_error` con
  `fieldErrors`; `unauthenticated`; `forbidden`; `not_found`), reutilizando
  `withErrorHandler` + `toActionError` (feature 10/16) sin lanzar excepciones sin
  envolver ni filtrar detalles internos.
- **R27 (ubicuo):** El sistema DEBE serializar cada columna `Decimal` a `number` en
  el DTO expuesto (nunca `Decimal` crudo) y NUNCA DEBE exponer `deleted_at` en el
  DTO.

## Criterios de aceptación verificables

Cada requisito se considera cumplido solo si existe un test que lo ejercita
(unitario de validación zod / service con repo mockeado / repo con Prisma
mockeado, o integración de la Server Action), según el mapa de `tasks.md`. Un
requisito sin test es un fallo de la feature (docs/verification.md).

## Decisiones cerradas (humano, 2026-07-10)

Las ambigüedades de **negocio** de esta feature fueron resueltas por el humano el
2026-07-10. Los requisitos R1–R27 ya reflejan estas decisiones (no quedan
[ABIERTO]).

- **D1 (antes [ABIERTO-1] + [ABIERTO-6]) — Varias tarifas CON NOMBRE.** La tabla
  `cobro` es **multi-fila** con CRUD completo (crear/listar/obtener/actualizar/
  borrar lógico). Se añade la columna **`nombre`** (TEXT, NOT NULL) para distinguir
  tarifas. **NO** se agrega FK a `zona`/`orden`/`tienda` en esta feature; la
  relación por zona corresponde a la feature 24 (se alineará al implementarla). La
  unicidad de `nombre` se decide en `design.md` (default: requerido, no
  necesariamente único).

- **D2 (antes [ABIERTO-2]) — IVA como PORCENTAJE 0..100.** `iva_flete` e
  `iva_comision_cod` se almacenan como **porcentaje** (p.ej. `15.00` = 15%),
  `Decimal(5,2)`, rango 0..100 (no fracción 0..1). Ver R3.

- **D3 (antes [ABIERTO-3]) — Mixto.** `fulfillment` es un **monto**
  `Decimal(12,2)` (grupo de montos, R2). `comision_cod` es un **porcentaje** 0..100
  `Decimal(5,2)` (grupo de porcentajes junto a `iva_*`, R3).
  - Montos `Decimal(12,2)`: `valor_flete`, `valor_flete_devuelto`,
    `valor_flete_gam`, `valor_flete_devuelto_gam`, `fulfillment`.
  - Porcentajes 0..100 `Decimal(5,2)`: `comision_cod`, `iva_flete`,
    `iva_comision_cod`.

- **D4 (antes [ABIERTO-4]) — Solo `maestro` escribe.** `maestro` hace CRUD
  completo; `admin` solo lee/lista; `adminTienda`/`mensajero` → `forbidden`. Ver
  R10/R11/R12 y la matriz.

- **D5 (antes [ABIERTO-5]) — Nullabilidad y rangos.** `nombre` + las 8 columnas
  numéricas son **NOT NULL**; montos y porcentajes ≥ 0; los 3 porcentajes
  (`comision_cod`, `iva_flete`, `iva_comision_cod`) además ≤ 100. Ver R5.
