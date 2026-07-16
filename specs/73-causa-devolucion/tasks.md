# Feature 73 — Causa tipificada de la devolución — tasks.md

> **Gate F1.4 APROBADA (2026-07-15) → implementable.** Las decisiones y su registro viven en
> `requirements.md §F1.4`. Nada aquí está ya condicionado a una pregunta abierta.
>
> Checklist accionable. Cada task indica el/los `R<n>` que cubre y su criterio de **hecho**
> (el test que la verifica). `[P]` = paralelizable con otras `[P]` del mismo bloque (tocan
> archivos distintos). Orden global: baseline → esquema/migración → fuente de verdad → borde
> → capas → UI → no-regresión → verificación. Un solo ciclo, un PR.
>
> **Alcance tras F1.4-c: SÓLO CAPTURA.** El bloque de visualización en el historial se
> ELIMINÓ (junto con los 3 requisitos de visualización que proponía el spec). La causa se
> escribe y nadie la lee: es la decisión aprobada, no un olvido. **NO** tocar
> `OrdenHistorialEntradaDTO` ni `HistorialOrdenTimeline`.
>
> Totales: **22 requisitos · 26 tasks en 8 bloques (B0-B7).**

Convención de estado: `[ ]` pendiente · `[x]` hecho.

---

## Bloque 0 — Baseline (antes de tocar nada)

- [ ] **T0.1** MEDIR el baseline en un worktree limpio de la rama base: `./init.sh`,
  `typecheck`, `lint` y la suite de tests. Anotar los NÚMEROS medidos en
  `progress/impl_73-causa-devolucion.md`. `dev` viene de estar en rojo (feature 72) y el
  typecheck baseline NO es 0 → **no afirmar "verde" sin el número medido** (precedente 72:
  baseline falso).
  — Cubre: R21 (insumo). — **Hecho:** el archivo de progreso cita los 4 números con la fecha y
  el commit exacto sobre el que se midieron.

## Bloque 1 — Esquema + migración  (depende de B0)

> Orden OBLIGATORIO dentro del bloque: schema → `prisma generate` → todo lo demás. Hasta que
> el cliente se regenere, `CAUSA_DEVOLUCION_SEED` no compila (design §9).

- [ ] **T1.1** En `db/schema.prisma`: añadir el enum `GestionCausaDevolucion`
  (`not_found`/`wrong_number`/`wrong_address`, `@@map("gestion_causa_devolucion")`, espejo de
  `GestionResultado:374`) y la columna `causaDevolucion GestionCausaDevolucion?
  @map("causa_devolucion")` en `GestionOrden`, **nullable** (F1.4-a). Comentario que la marque
  como campo de la rama DEVOLUCIÓN (patrón de `:388-393`) **y que registre que nace SIN LECTOR
  por decisión F1.4-c** (para que no se lea como código muerto).
  — Cubre: R1, R11, R16. — **Hecho:** `pnpm prisma generate` emite el tipo
  `GestionCausaDevolucion`; `typecheck` no empeora el baseline de T0.1.
- [ ] **T1.2** Crear `db/migrations/<ts>_gestion_orden_causa_devolucion/migration.sql` con
  `pnpm run db:migrate:create` (solo crea, NO aplica): `CREATE TYPE` + `ALTER TABLE … ADD
  COLUMN`. Verificar que NO contiene ningún `ALTER`/`DROP` de columnas, índices, defaults o
  policies preexistentes, ni CHECK constraint (F1.4-b).
  — Cubre: R11, R15. — **Hecho:** revisión del SQL generado: exactamente 2 sentencias, ambas
  aditivas; ninguna toca `motivo` ni la RLS de `gestion_orden`.
- [ ] **T1.3** Escribir a mano `down.sql` (OBLIGATORIO, `docs/architecture.md`): `DROP COLUMN
  IF EXISTS` + `DROP TYPE IF EXISTS`, en orden inverso, con el comentario de precondición
  (patrón `20260714160000_gestion_orden_anulacion/down.sql`).
  — Cubre: R14. — **Hecho:** el `down.sql` existe y revierte EXACTAMENTE las 2 sentencias del UP.
- [ ] **T1.4** Demostrar el round-trip: `db:migrate` → `db:rollback` → `db:migrate`, con la
  salida pegada en `progress/impl_73-*.md`.
  — Cubre: R14, R15. — **Hecho:** las 3 ejecuciones terminan sin error; tras el `rollback`
  intermedio la columna y el tipo NO existen; tras el `migrate` final existen otra vez.
- [ ] **T1.5** `[P]` Afirmar que las gestiones `devuelta` PREEXISTENTES sobreviven a la
  migración con `causa_devolucion = NULL`, sin backfill ni default (F1.4-a).
  — Cubre: R16. — **Hecho:** test de integración: se siembra una gestión `devuelta` sin causa,
  se aplica la migración, la fila sigue ahí, con su `motivo` intacto y su causa en NULL.

## Bloque 2 — Fuente única de verdad valor→etiqueta  (depende de T1.1)

- [ ] **T2.1** Crear `lib/types/causa-devolucion.ts`: `CAUSA_DEVOLUCION_SEED` (`as const
  satisfies readonly GestionCausaDevolucion[]`), tipo `CausaDevolucion` y el chequeo
  `_EnsureExhaustive` (patrón `lib/types/metodo-pago.ts:13-21`). Sólo los 3 valores, sin
  reservar futuros (F1.4-d).
  — Cubre: R1, R2. — **Hecho:** unit que afirma que el SEED tiene EXACTAMENTE los 3 valores;
  + prueba de tipos documentada de que el doble candado rompe el build si SEED y enum divergen
  (SEED con valor fantasma / enum con valor no listado).
- [ ] **T2.2** `[P]` Crear `app/(app)/mis-asignaciones/_components/causa-devolucion-options.ts`
  con `CAUSA_DEVOLUCION_LABEL` (`Record<CausaDevolucion, string>`) + `CAUSA_DEVOLUCION_OPTIONS`
  derivadas del SEED. **Espejo EXACTO del hermano `metodo-pago-options.ts` de la misma
  carpeta** (design §2: un solo consumidor → colocado junto a la página, no en `shared/`).
  — Cubre: R3. — **Hecho:** unit: cada valor → su etiqueta exacta del pedido literal
  ("Cliente no localizado" / "Número de celular errado" / "Dirección errada"); las opciones
  salen del SEED (no de una lista literal paralela). Ningún componente duplica esas cadenas.

## Bloque 3 — Borde (zod)  (depende de B2)

- [ ] **T3.1** En `lib/types/gestion-orden.ts`: `causaDevolucionSchema =
  z.enum(CAUSA_DEVOLUCION_SEED, …)` y añadirlo SÓLO a la variante `devuelta` de
  `gestionarSchema` (`:112-116`). NO tocar `motivoSchema` (`:93`) ni las otras 3 variantes.
  — Cubre: R1, R6, R9, R10. — **Hecho:** unit del schema: `devuelta` con causa válida + motivo
  → parsea; sin causa → error en el campo `causaDevolucion`; con `"otro"` → error; con causa en
  la rama `entregada` → el objeto parseado NO contiene `causaDevolucion`.
- [ ] **T3.2** `[P]` Unit de la obligatoriedad CONSERVADA del motivo y del reporte conjunto.
  — Cubre: R7, R8. — **Hecho:** `devuelta` con causa y motivo `"   "` → error `motivo
  requerido`; `devuelta` sin causa y sin motivo → `fieldErrors` trae AMBAS claves en la misma
  respuesta.

## Bloque 4 — Action → Service → Repository  (depende de B3)

- [ ] **T4.1** `lib/actions/mis-asignaciones.ts`: añadir `"causaDevolucion"` a la lista de
  `rawFromFormData` (`:187`) y propagarla en la rama `devuelta` de `toGestionarInput` (`:217`).
  — Cubre: R6, R9. — **Hecho:** unit/integración de la action: FormData de `devuelta` con causa
  → llega al service; FormData sin causa → `validation_error` con `fieldErrors.causaDevolucion`
  y el service NO se invoca (cero efectos).
- [ ] **T4.2** Extender los contratos: `GestionarInput` variante `devuelta`
  (`IMisAsignacionesService.ts:93`) + `GestionOrdenData`
  (`IGestionOrdenRepository.ts:52-61`). NO tocar la firma de `crearGestionYTransicionar`
  (`:133-139`).
  — Cubre: R10, R13. — **Hecho:** `typecheck` no empeora el baseline; el diff no toca la firma
  del repo ni las otras 3 variantes de `GestionarInput`.
- [ ] **T4.3** `MisAsignacionesService.buildGestionData` (`:372-373`): la rama `devuelta`
  propaga `causaDevolucion` junto a `motivo`, sin decorar el motivo.
  — Cubre: R11, R12. — **Hecho:** unit del service con dobles: el `GestionOrdenData` emitido
  lleva `causaDevolucion: "wrong_address"` Y `motivo` EXACTAMENTE igual al de entrada (sin
  prefijo, sufijo ni concatenación).
- [ ] **T4.4** `[P]` Integración de la persistencia atómica.
  — Cubre: R11, R13. — **Hecho:** integración: una gestión `devuelta` deja la fila con
  `causa_devolucion` = el valor enviado; y si la tx falla (fallo forzado del append de
  seguimiento de la 47), NO queda gestión NI causa persistida.
- [ ] **T4.5** `[P]` Verificar que la feature no añade `order_status`, valores al enum
  `orden_historial_origen_tipo` ni columna materializada de contador.
  — Cubre: R20. — **Hecho:** el test de cobertura de escritura de estado de la 49
  (`orden-historial-cobertura.test.ts`) sigue verde **sin modificarse**; grep del diff: cero
  `ALTER TYPE "orden_historial_origen_tipo"`, cero cambios en `ORDER_STATUS_SEED`.

## Bloque 5 — UI del selector: RADIOS  (depende de B2, B3)

> F1.4-f resuelta: **radios**. `components/ui/` NO tiene `radio-group` → T5.0 lo añade
> EXPLÍCITAMENTE (no debe aparecer por sorpresa a mitad de la implementación).

- [ ] **T5.0** Primitiva de radio. **NO ejecutar `npx shadcn add radio-group`**: este repo NO
  usa Radix — sus primitivas van sobre `@base-ui/react` v1.6 (`package.json:23`,
  `components/ui/select.tsx:4`, `checkbox.tsx:3`). Pasos: (1) VERIFICAR contra los tipos
  INSTALADOS la superficie de radio de `@base-ui/react` v1.6 (`@base-ui/react/radio` y/o
  `/radio-group`) — no de memoria; (2) crear `components/ui/radio-group.tsx` siguiendo el
  patrón EXACTO de `Select`/`Checkbox` (headless + `cn()` + `data-slot`, contrato
  `value`/`onValueChange`/`options` + `aria-label`); (3) SI Base UI v1.6 no ofrece radio, tomar
  el fallback aprobado (`<input type="radio">` en `<fieldset>`/`<legend>`, design §6.1) y
  anotarlo en `progress/impl_73-*.md`.
  — Cubre: R4 (insumo). — **Hecho:** el camino tomado (primitiva Base UI o fallback nativo)
  queda escrito en el progreso con la evidencia de la verificación; rol `radiogroup` y
  navegación por teclado funcionando.
- [ ] **T5.1** `GestionarOrdenPanel.tsx`: estado `causaDevolucion` + reset en
  `elegirResultado` (`:212-220`) + `causaError` (junto a `:261-264`) + `buildRaw` (`:165`) +
  `buildFormData` (`:183-184`). NO tocar `MotivoField` (`:494-522`).
  — Cubre: R4, R9. — **Hecho:** test de componente: elegir "Devolver", escoger una causa,
  escribir motivo y confirmar → la action recibe FormData con `causaDevolucion` y `motivo`.
- [ ] **T5.2** `CausaField` en el mismo archivo (un solo consumidor), renderizando
  `CAUSA_DEVOLUCION_OPTIONS` con la primitiva de T5.0, con `role="alert"` y `aria-invalid`
  como `MotivoField`. Insertar en la rama `devuelta` del render (`:437-439`) ANTES del
  `<MotivoField>`.
  — Cubre: R3, R4. — **Hecho:** test de componente: en "Devolver" se ven las 3 opciones con sus
  etiquetas en español EXACTAS del pedido literal; ningún slug crudo
  (`not_found`/`wrong_number`/`wrong_address`) aparece en el texto renderizado.
- [ ] **T5.3** `[P]` El selector NO aparece fuera de `devuelta`, y confirmar sin causa muestra
  el error por campo sin enviar.
  — Cubre: R5, R6. — **Hecho:** test de componente: en "Entregar"/"Reprogramar"/"Rechazar" no
  hay control de causa; en "Devolver" sin causa → error visible junto al campo y la action NO
  se llama.
- [ ] **T5.4** `[P]` Cambiar de resultado y volver a "Devolver" no arrastra la causa anterior.
  — Cubre: R4. — **Hecho:** test de componente: elegir causa → "Atrás" → "Devolver" → ninguna
  opción seleccionada.

## Bloque 6 — No regresión 36 / 47 / 49  (depende de B4)

- [ ] **T6.1** La causa NO altera la regla de intentos de la feature 47 (F1.4-e).
  — Cubre: R17. — **Hecho:** unit del service: para la MISMA orden y el MISMO conteo previo, las
  3 causas producen el MISMO seguimiento (bajo umbral → bodega responsable con mensajero
  limpio; en umbral → `rechazada`). `resolverSeguimientoDevuelta` no lee la causa (verificable
  en el diff: no se toca).
- [ ] **T6.2** `[P]` El contador derivado de la 49 no cambia.
  — Cubre: R18. — **Hecho:** los tests de `contarIntentos` siguen verdes **sin modificarse**; N
  devoluciones con causas distintas → `contarIntentos` = N (la causa no es insumo del conteo).
- [ ] **T6.3** `[P]` Las otras 3 ramas intactas.
  — Cubre: R19. — **Hecho:** la suite previa de la feature 36/47 pasa **sin que se haya
  modificado ningún test existente para acomodar esta feature**; `rechazada` conserva motivo
  libre + evidencia y NO muestra selector de causa. Si algún test previo hubo que tocar, se
  justifica explícitamente en `progress/impl_73-*.md` (por defecto: es una regresión).
- [ ] **T6.4** `[P]` La superficie de lectura del historial NO se tocó (F1.4-c).
  — Cubre: R19. — **Hecho:** el diff no modifica `lib/types/orden-historial.ts`,
  `HistorialOrdenTimeline.tsx` ni `HistorialOrdenSheet.tsx`; sus tests siguen verdes sin
  cambios.

## Bloque 7 — Verificación y trazabilidad  (depende de todos)

- [ ] **T7.1** `./init.sh` + `typecheck` + `lint` + suite completa, comparados CONTRA los
  números de T0.1.
  — Cubre: R21. — **Hecho:** ningún error nuevo respecto al baseline medido; los números
  finales y el delta quedan escritos en `progress/impl_73-*.md`.
- [ ] **T7.2** Mapa `R1..R22` → test concreto (archivo + nombre del caso) en
  `progress/impl_73-causa-devolucion.md`.
  — Cubre: R22. — **Hecho:** los 22 requisitos tienen al menos un test citado por ruta y
  nombre; ninguno queda huérfano (el reviewer rechaza si falta alguno).
- [ ] **T7.3** Commits por task lógica (`docs/conventions.md`), formato
  `feat(73): …` / `test(73): …` / `chore(73): …`. No un mega-commit final.
  — Cubre: — (proceso). — **Hecho:** el historial del PR muestra commits por bloque, no uno solo.

---

## Mapa rápido requisito → task

| R | Task(s) |
| --- | --- |
| R1 catálogo cerrado de 3 | T1.1, T2.1, T3.1 |
| R2 fuente única de verdad | T2.1 |
| R3 etiquetas legibles | T2.2, T5.2 |
| R4 selector en `devuelta` | T5.0, T5.1, T5.2, T5.4 |
| R5 sin selector en otras ramas | T5.3 |
| R6 causa obligatoria | T3.1, T4.1, T5.3 |
| R7 motivo sigue obligatorio | T3.2 |
| R8 ambos errores a la vez | T3.2 |
| R9 mismo schema cliente+servidor | T3.1, T4.1, T5.1 |
| R10 causa fuera de las otras ramas | T3.1, T4.2 |
| R11 columna propia + enum | T1.1, T1.2, T4.3, T4.4 |
| R12 no concatenar en `motivo` | T4.3 |
| R13 atomicidad | T4.2, T4.4 |
| R14 migración + `down.sql` + round-trip | T1.3, T1.4 |
| R15 aditiva, sin RLS nueva | T1.2, T1.4 |
| R16 histórico sin causa, sin backfill | T1.1, T1.5 |
| R17 regla de intentos (47) intacta | T6.1 |
| R18 contador derivado (49) intacto | T6.2 |
| R19 otras 3 ramas sin regresión | T6.3, T6.4 |
| R20 sin estados/enums/columnas nuevas | T4.5 |
| R21 baseline medido, no empeorado | T0.1, T7.1 |
| R22 trazabilidad | T7.2 |

Los 22 requisitos tienen cobertura; ninguna task queda sin requisito salvo T7.3 (proceso).
