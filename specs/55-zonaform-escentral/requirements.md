# Feature 55 — Completar ZonaForm: setear `esCentral` + reconciliar drift `provincia.zonaId`

> **F1.4 APROBADA por el humano el 2026-07-12** (SUPERSEDE la sección "Preguntas abiertas"):
> - **(A) UX al marcar central existiendo otra:** REASIGNAR con confirmación — el service desmarca
>   la central previa en la MISMA transacción antes de marcar la nueva (manejar ANTES del índice
>   único para no lanzar `P2002`/500). Estado: `in_progress`.
> - **(B) Alcance de ZonaForm:** RECONSTRUCCIÓN COMPLETA — nombre + selección provincia/cantón/
>   distritos (N:M `ZonaDistrito`) + `cobroVehiculo` + toggle `esCentral`; restaura crear/editar zona.
> - **(C) Drift `provincia.zonaId`:** RECONCILIACIÓN SOLO-SCHEMA (sin migración ni `down.sql`) —
>   borrar los símbolos huérfanos `Provincia.zonaId`/`Provincia.zona`/`Zona.provincias` del
>   `schema.prisma` (la columna ya no existe en la DB).
> - **(D) Seed de central:** 100% POR LA UI — el seed NO toca `es_central`; el maestro la marca
>   desde configuración.

> FOLLOW-UP de la feature 54 (deuda del PR #40). Spec en notación EARS. El QUÉ, sin
> detalles de implementación (esos van en `design.md`).
>
> **Contexto verificado en código (baseline `feature/55-zonaform-escentral` ← `dev` a3af913):**
> - `app/(app)/configuracion/_components/ZonaForm.tsx` está STUBBEADO por el #40: sólo
>   captura `nombre`; su `submit()` es un stub que devuelve `validation_error`
>   ("Formulario de zonas en reconstrucción"). El resto (pagos viejos, toggle, selector
>   de distritos) está comentado y referencia símbolos inexistentes.
> - El modelo YA soporta `esCentral` (feature 54): `Zona.esCentral @map("es_central")`
>   con índice único parcial `zona_es_central_unico ON zona(es_central) WHERE es_central = true`
>   (≤ 1 central a nivel DB); `crearZonaSchema`/`actualizarZonaSchema` incluyen
>   `esCentral: z.boolean().default(false)`; `ZonaDTO.esCentral`; `ZonaService.crear/actualizar`
>   lo propagan; `ZonaRepository` lo persiste; `IZonaRepository.findCentralZonaId()` existe.
> - `zonas-columns.tsx` ya muestra el badge `Central / GAM` (`row.esCentral`).
> - **NO hay UI para setear `esCentral`** → el maestro no puede marcar la zona central →
>   `findCentralZonaId()` devuelve `null` → guardia R4 de la feature 30 ("no hay zona
>   central") bloquea asignación/ruteo y el runtime de 34/37 (ver `progress/review_54`).
> - El CRUD de zonas es **reemplazo completo**: `actualizarZonaSchema === crearZonaSchema`
>   y ambos exigen `distritoIds.min(1)`. No existe hoy un camino de actualización parcial.
> - El catálogo geográfico global existe a nivel repo (`GeoRepository.listProvincias/
>   listCantones/listDistritos`, `IGeoRepository`) pero **NO está expuesto por ninguna
>   Server Action** (las `listarProvincias/listarCantones/listarDistritos` que el ZonaForm
>   viejo importaba NO existen). La única acción de lectura de zonas es `arbolZonas`
>   (árbol de distritos YA asignados, no sirve para elegir distritos libres).

## Convenciones EARS
Ubicuo: "El sistema DEBE…". Evento: "CUANDO … el sistema DEBE…". Estado: "MIENTRAS …".
Condicional: "SI … ENTONCES el sistema DEBE…". Opcional: "DONDE …".

---

## Requisitos

### Autorización y seguridad

**R1 (Ubicuo).** El sistema DEBE permitir crear y editar zonas ÚNICAMENTE al rol
`maestro`. SI el actor no está autenticado, ENTONCES el sistema DEBE responder
`unauthenticated`; SI está autenticado pero no es `maestro`, ENTONCES DEBE responder
`forbidden`. (Testeable: acción con actor `null`/no-maestro/maestro.)

**R2 (Ubicuo).** El sistema DEBE ejecutar toda mutación de zona en el servidor
(Server Action), validando la entrada con zod en el borde antes de tocar la capa de
servicio, sin exponer una ruta API interna que el cliente fetchee para mutar.
(Testeable: la acción parsea con `crearZonaSchema`/`actualizarZonaSchema`; entrada
malformada → `validation_error`.)

### Setear `esCentral` (núcleo de la feature)

**R3 (Evento).** CUANDO el maestro guarda una zona con el control "zona central"
activado, el sistema DEBE persistir `esCentral = true` para esa zona. (Testeable:
crear/editar con `esCentral: true` → `ZonaDTO.esCentral === true` y
`findCentralZonaId()` devuelve su `id`.)

**R4 (Evento).** CUANDO el maestro guarda una zona con el control "zona central"
desactivado, el sistema DEBE persistir `esCentral = false`. (Testeable: DTO
resultante `esCentral === false`.)

**R5 (Ubicuo — invariante).** El sistema DEBE garantizar que a lo sumo UNA zona tenga
`esCentral = true` en todo momento. (Testeable: índice único parcial
`zona_es_central_unico` presente; intentar dos centrales por caminos independientes
no deja dos filas `es_central = true`.)

**R6 (Condicional — UX de reasignación, sujeta a F1.4-A).** SI el maestro marca como
central una zona MIENTRAS ya existe OTRA zona central, ENTONCES el sistema DEBE
resolver el conflicto de forma determinista y con feedback claro, sin producir un
error genérico de servidor (500) por violación del índice único. (Testeable: el
comportamiento elegido en F1.4-A —reasignar o rechazar— se cumple y NO se filtra un
`P2002` como error interno.)

**R7 (Estado).** MIENTRAS el maestro edita una zona que ya es central, el sistema DEBE
prefijar el control "zona central" en activado. (Testeable: `mode="editar"` con
`zona.esCentral = true` → control activado en el render inicial.)

### Datos de zona y geografía (alcance sujeto a F1.4-B)

**R8 (Evento).** CUANDO el maestro crea una zona, el sistema DEBE capturar y persistir
`nombre`, `cobroVehiculo`, `esCentral`, el conjunto de distritos (`distritoIds`, al
menos uno) y las `tarifas` de la zona, respetando la regla condicional
`cobroVehiculo ↔ tarifas` ya definida en `lib/types/zona.ts`. (Testeable: payload
válido → zona creada con esos campos; payload que viola la regla → `validation_error`.)

**R9 (Evento).** CUANDO el maestro edita una zona, el sistema DEBE reemplazar por
completo `nombre`, `cobroVehiculo`, `esCentral`, `distritoIds` (≥1) y `tarifas` con
los valores enviados, y DEBE prefijar el formulario con los valores actuales de la
zona. (Testeable: edición con set nuevo de distritos/tarifas → estado final = enviado;
prefill correcto en render.)

**R10 (Estado — selector de distritos).** MIENTRAS el maestro compone los distritos de
una zona, el sistema DEBE permitirle navegar el catálogo geográfico global
provincia → cantón → distrito, y DEBE indicar los distritos ya asignados a OTRA zona
impidiendo seleccionarlos. (Testeable: acciones de catálogo devuelven provincias/
cantones/distritos; un distrito con `zonaId` de otra zona aparece deshabilitado con su
zona; en edición, los distritos de ESTA zona aparecen pre-marcados.)

### Feedback y errores

**R11 (Condicional).** SI la validación falla o el backend devuelve un conflicto de
dominio (nombre duplicado, distrito ya asignado a otra zona, distrito/vehículo
inexistente), ENTONCES el sistema DEBE mostrar el error junto al campo afectado y DEBE
conservar los valores ya ingresados sin cerrar el formulario. (Testeable: respuesta
`validation_error`/`conflict` → mensajes por campo; el modal no se cierra.)

**R12 (Evento).** CUANDO una zona se crea o edita con éxito, el sistema DEBE notificar
el éxito (toast) y refrescar el listado de zonas. (Testeable: `status: "ok"` →
toast de éxito + `mutate()` del listado + cierre del modal.)

### Reconciliación del drift schema/DB

**R13 (Ubicuo).** El sistema DEBE mantener el esquema Prisma alineado con el estado
real de la base de datos respecto de `provincia.zona_id`: dado que la columna fue
ELIMINADA en la DB por la migración `20260711120000_zonas_catalogo_global_pagos` y
NUNCA re-creada, el esquema NO DEBE declarar `Provincia.zonaId`, la relación
`Provincia.zona`, ni la relación inversa `Zona.provincias`. (Testeable:
`prisma validate` OK y un diff schema↔migraciones sin drift; typecheck 0 tras remover
los símbolos; ningún acceso de producción a `provincia.zonaId`/`zona.provincias`.)

**R14 (Ubicuo — seguridad de datos).** El sistema DEBE preservar la postura de RLS
existente (zona/provincia/cantón/distrito con RLS habilitado, acceso sólo vía service
role del servidor) sin introducir tablas nuevas ni policies para `anon`/`authenticated`.
(Testeable: la feature no crea tablas; las lecturas de catálogo geográfico ocurren
server-side vía Server Action autorizada a maestro.)

---

## Trazabilidad R → test previsto

| R | Test previsto (archivo::caso) | Tipo |
|---|---|---|
| R1 | `tests/integration/actions/zonas-action.test.ts` :: crear/editar rechaza no-maestro (forbidden) y no-auth (unauthenticated) | integration |
| R2 | `zonas-action.test.ts` :: entrada malformada → `validation_error`; mutación sólo por Server Action | integration |
| R3 | `tests/unit/services/zona-service.test.ts` + `tests/unit/repositories/zona-repository.test.ts` :: persiste `esCentral=true`; `findCentralZonaId` devuelve el id | unit |
| R4 | `zona-service.test.ts` :: persiste `esCentral=false` | unit |
| R5 | `tests/integration/db/zonas-migration.test.ts` :: índice `zona_es_central_unico` parcial presente | integration |
| R6 | `zona-service.test.ts` :: comportamiento F1.4-A (reasignar o rechazar) sin filtrar `P2002` | unit |
| R7 | `tests/components/zona-form.test.tsx` :: prefill del toggle en `editar` con `esCentral=true` | component |
| R8 | `tests/unit/types/zona-schema.test.ts` + `zona-service.test.ts` :: crea con todos los campos; regla `cobroVehiculo↔tarifas` | unit |
| R9 | `zona-form.test.tsx` + `zona-service.test.ts` :: edición reemplaza set; prefill de campos | component + unit |
| R10 | `tests/integration/actions/geo-action.test.ts` (nuevo) + `zona-form.test.tsx` :: catálogo global; distrito de otra zona deshabilitado; pre-marcado en edición | integration + component |
| R11 | `zona-form.test.tsx` :: `validation_error`/`conflict` → mensaje por campo, valores conservados, modal abierto | component |
| R12 | `tests/components/zonas-module.test.tsx` :: éxito → toast + mutate + cierre | component |
| R13 | `tests/integration/db/provincia-schema-drift.test.ts` (nuevo o extendido en `zonas-migration`) :: schema sin `Provincia.zonaId`; diff schema↔migraciones vacío; grep sin usos | integration/static |
| R14 | `zonas-migration.test.ts` / revisión estática :: sin tablas nuevas; RLS intacta | integration/static |

> El mapa definitivo R→test lo consolida el implementer en `progress/impl_55-…md` y lo
> verifica el reviewer (regla #4). Un R sin test es un fallo de la feature.

---

## Preguntas abiertas (F1.4) — requieren decisión humana antes de implementar

Cada una lleva **recomendación** + **alternativa**. NO están cerradas.

### F1.4-A — UX al marcar central cuando ya existe otra central (afecta R6)
- **Recomendación:** *Reasignar con confirmación*. Al marcar una zona como central,
  si ya hay otra, el servicio desmarca la anterior en la MISMA transacción y la UI pide
  confirmación ("La zona X dejará de ser central. ¿Continuar?"). Justificación:
  operativamente existe exactamente una zona central; la intención del maestro al marcar
  otra es *mover* la designación, y evita el callejón "hay que desmarcar primero".
- **Alternativa (descartable):** *Rechazar*. Devolver `conflict`/`validation_error`
  ("Ya existe una zona central: desmárcala primero"). Más explícito y sin efectos
  colaterales, pero exige dos pasos y más clics.
- En AMBOS casos: el servicio DEBE manejar el caso ANTES de que el índice único lance
  `P2002` (hoy no lo hace → sería un 500).

### F1.4-B — Alcance del ZonaForm: toggle mínimo vs. reconstrucción completa (afecta R8–R10)
- **Recomendación:** *Reconstrucción completa* del formulario (nombre, `cobroVehiculo`,
  toggle `esCentral`, selector de distritos vía **nuevas Server Actions de catálogo geo**
  y editor de `tarifas`). Justificación verificada en código: (1) el #40 stubbeó TODO el
  formulario salvo `nombre`; (2) `actualizar` es reemplazo completo y exige
  `distritoIds.min(1)`, por lo que un "toggle solo" NO puede editar una zona existente
  sin reenviar distritos+tarifas; (3) `crear` es imposible hoy (no hay selector de
  distritos), así que no se pueden autorizar zonas; un alcance menor recrea la misma
  deuda del stub.
- **Alternativa (descartable — unblock rápido / bajo riesgo):** *Acción parcial dedicada*
  `marcarZonaCentral(id, esCentral)` + un control mínimo (toggle/botón) en el listado de
  zonas, sin tocar distritos/tarifas. Desbloquea `findCentralZonaId` de inmediato sobre
  las zonas ya SEMBRADAS (el seed crea zonas con `es_central=false`) y deja el CRUD
  completo de distritos/tarifas como follow-up. Menor superficie y riesgo, pero deja
  crear/editar completo aún roto.
- **Nota de riesgo (para el implementer, no re-litigar feature 24):** el seed
  (`scripts/seed-zonas.ts`) asigna distritos a zonas por el ESCALAR `distrito.zonaId`,
  mientras el CRUD (`ZonaRepository`) y `distritosCount` usan el N:M `ZonaDistrito`.
  Una zona sembrada tendría `distritosCount = 0` y sus distritos NO aparecerían pre-marcados
  vía el N:M. Esta divergencia escalar↔N:M es de nivel feature-24; NO se resuelve aquí,
  pero condiciona el prefill de distritos en edición (Opción A) → documentar/decidir.

### F1.4-C — Reconciliación del drift `provincia.zonaId`: ¿schema-only o migración? (afecta R13)
- **Hallazgo real (verificado en migraciones):** la DB NO tiene `provincia.zona_id`
  (la dropea `20260711120000` línea 11; `20260711200000_provincia_zona_id_nullable`
  es un no-op guardado). El `schema.prisma` SÍ declara `Provincia.zonaId String? @map("zona_id")`,
  `Provincia.zona Zona?` y `Zona.provincias Provincia[]` (además el comentario del propio
  modelo Zona dice "provincia.zona_id fue ELIMINADO", contradiciéndose con el campo 3 líneas abajo).
- **Recomendación:** *Reconciliación schema-only hacia adelante*. Eliminar del
  `schema.prisma` los tres símbolos; NO se necesita nueva migración (la DB ya carece de la
  columna) ni `down.sql`. Verificar con `prisma validate` + diff schema↔migraciones sin drift.
- **Alternativa (descartable):** añadir una migración que re-cree `provincia.zona_id`
  nullable. Rechazada: contradice la decisión deliberada de feature 24/R4 (la zona deja de
  colgar de la provincia) y reintroduce esquema muerto.

### F1.4-D — ¿Sembrar/marcar una zona central por defecto (seed) o dejarlo 100% a la UI?
- **Recomendación:** *100% a la UI*. El seed es idempotente y NO debe pisar `es_central`
  editado por el maestro (`seedZonas` ya hace `update: {}` a propósito). Elegir la central
  es una decisión operativa del maestro, no un dato del catálogo CR. Basta con que la UI
  (F1.4-B) permita marcarla.
- **Alternativa (descartable):** sembrar una central por defecto (p. ej. la zona GAM
  histórica). Rechazada: reintroduce contexto hardcodeado (anti-patrón "sin hardcode de
  contexto") y puede chocar con la realidad del negocio si esa zona no existe en el XLSX.
