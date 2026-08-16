# Review — Feature 229 · Rastreo público del envío

Rama `feature/229-rastreo-publico-envio` (worktree `C:/w229`), cambio sin commitear.
Revisado el 2026-08-15 contra `specs/229-rastreo-publico-envio/`, `docs/` y `CHECKPOINTS.md`.

## Veredicto: **OK (APROBADO)** — sin bloqueantes.

## Checklist

### Especificación
- [x] `requirements.md` con 35 requisitos EARS (R1–R35) y tabla de decisiones G1–G14.
- [x] `design.md` con alternativas descartadas y su porqué (§D1.a/b, §5).
- [x] `tasks.md`: 27 tareas, todas `[x]`, 0 pendientes.

### Trazabilidad
- [x] Los 35 `R<n>` mapean a un test nombrado en `progress/impl_229.md` §4.
- [x] Verificado uno a uno: ningún test vacío ni tautológico. Las seis guardias llevan
      control de no-vacuidad y CONTRAPRUEBA (fuga inyectada en memoria).
- [x] R4/R5/R35 se apoyan en tests EXISTENTES sin modificar (`middleware.test.ts`,
      `paquete-url.test.ts`): comprobado que siguen intactos y verdes.

### Verificación ejecutable (corrida propia, no la del implementer)
- [x] `pnpm run typecheck` → 0 errores.
- [x] `pnpm run lint` → 0 errores, 69 warnings (2 nuevos, del mismo tipo preexistente).
- [x] `./init.sh` COMPLETO → `== init OK ==`, 1107 archivos / 14220 tests, exit 0.
      Coincide con la bitácora (delta +10 archivos / +127 tests, cero rojos).
- [x] Corrida focalizada de los 10 archivos de la feature + vecinos: 13/13, 179/179.

### Los tres modos de fallo que importaban
- [x] **No-enumeración.** `RastreoPublicoService.consultar` (líneas 81–100) NO tiene
      retorno temprano: busca la guía, normaliza AMBOS lados contra un centinela `""`
      cuando la fila es `null`, y evalúa `consultable && coincide && vigente` en una sola
      condición. Un único `return { estado:"no_encontrado" }` en ese camino. Los cuatro
      casos malos: mismo objeto, mismo conteo de llamadas (1,1,1,1) — medido, no supuesto.
- [x] **No-fuga de PII.** DTO enumerado campo a campo; `fila.id` se queda en el service.
      La guardia de lista blanca alimenta el service con filas MÁS ANCHAS que el contrato
      (actor, motivo, origenTipo, gestión, dirección, monto…) y compara el conjunto EXACTO
      de claves a cualquier profundidad + barrido de valores. `no_encontrado` no lleva payload.
- [x] **Exhaustividad.** `OrderStatusValue = (typeof ORDER_STATUS_SEED)[number]`, y el mapa
      es `as const satisfies Record<OrderStatusValue, HitoPublico>`. Reproducido en un tsc
      aislado: un value nuevo en el seed produce `TS1360: Property 'nuevo' is missing`.

### Puntos que el implementer declaró
- [x] **Allowlist del censo (4 entradas).** Motivo escrito y verdadero, incluido el efecto
      basename. Comprobado archivo a archivo: los únicos literales antiguos presentes son
      `en_bodega` (homónimo del hito público firmado) y `en_fulfillment` (dato de entrada
      del caso huérfano, mismo motivo que `analytics-daily-job`). NINGÚN literal de
      nomenclatura vieja real (`en_ruta`, `en_espera_aceptacion`, `en_ruta_bodega_principal`,
      `devuelta_origen`, `recibido_origen`) se cuela por esas entradas. Decisión humana del
      2026-08-15: el hito se queda como está.
- [x] **R3/R34 durables.** Ninguna guardia de la feature ejecuta git ni compara contra
      `origin/dev`; se comprobó por grep sobre los 11 archivos nuevos. Nada que retirar en el PR.
- [x] **DialogTrigger invertido.** `LandingNav` sigue siendo Server Component; el `<button>`
      lo emite `Dialog.Trigger` de Base UI, que renderiza `type="button"` (verificado en
      `useButton.js:168`), con las MISMAS clases y los mismos hijos. Diferencias respecto al
      DOM previo: se va el `disabled` y entran `data-slot`/`aria-*` del primitivo. Un test
      afirma que hay UN solo disparador.
- [x] **`<input>` crudo en vez de `Input`.** Cierto y documentado en `app/globals.css`:
      `tema-claro` fija tokens pero no apaga el variant `dark:`, e `Input` lleva
      `dark:bg-input/30` (`components/ui/input.tsx:12`). El `DialogContent` sí es la
      primitiva compartida, con `tema-claro` explícito. No es saltarse el sistema de diseño.

### Calidad, capas, seguridad
- [x] Sin tabla nueva, sin migración, sin RLS que activar (R34 verificado por guardia).
- [x] Sin webhooks nuevos. Sin secretos: solo umbrales por entorno con defecto en código.
- [x] Capas: repositorio con dos `select` explícitos y sin negocio; service sin Prisma ni
      `next/headers`; borde con zod y resultado discriminado; interfaces en `lib/interfaces/`.
- [x] Sin hardcode de contexto: zona horaria y umbrales salen de `lib/config/`.

## Hallazgos

**BLOQUEANTES: ninguno.**

**menor 1 — `validation_error` pinta un tercer texto en el modal.** `RastreoDialog.tsx:82-87`
muestra el mensaje de campo del schema ("Número de guía no válido."), distinto del rechazo único
y del de límite. R28 permite texto propio solo al límite. No discrimina existencia (se dispara
antes de tocar datos, solo por forma de la entrada), y está razonado en el archivo.

**menor 2 — historial vacío responde `no_encontrado` tras DOS lecturas.** `RastreoPublicoService.ts:109`.
La forma es idéntica, pero el trabajo no: solo alcanzable con guía Y factor correctos, así que no
es canal de enumeración. Declarado en la bitácora §6.f.

**menor 3 — `deps` como segundo parámetro de una Server Action pública.**
`lib/actions/rastreo-publico.ts:83-86`. Es el patrón del repo (idéntico en
`postulacion-mensajero.ts:78` y `conteos-publicos.ts:52`, los dos precedentes públicos citados
por el spec), no algo que introduzca esta feature. Comprobado que falla CERRADO: un `deps`
fabricado desde el cliente no puede transportar funciones, así que rompe con TypeError antes de
tocar datos y no permite saltarse el limitador. Sistémico, ficha aparte si algún día se cierra.

**menor 4 — R12 y R31 con cobertura parcial en la capa UI.** La guardia de frontera barre
`console.*` y `catch {}` sobre los 7 módulos de `lib/`, no sobre `RastreoDialog.tsx` (que hoy no
tiene ninguno de los dos). Y el foco atrapado que pide R31 se delega en el primitivo: el test
comprueba nombre accesible, Esc y etiquetas, no la trampa de foco.

**menor 5 — dos imprecisiones de la bitácora, no del código.** (a) §5.2 dice que los 69 warnings
de lint son «todos preexistentes»: 2 son nuevos, del mismo tipo tolerado (`_numGuia`, `_ordenId`
en el doble del service). (b) §4/R21 dice «con datos reales» del test de integración, que usa un
Prisma falso con semántica (el propio archivo lo declara en su cabecera, y es el patrón de
`tests/integration/repositories/`).

**menor 6 — pendiente de bookkeeping, no del implementer.** No hay entrada de la 229 en
`progress/history.md` y `feature_list.json` sigue en `in_progress`. Corresponde al leader al cerrar.

## Nota de alcance
No se re-abren las decisiones firmadas del gate (G1–G14), ni el limitador en memoria (§5.bis),
ni `sin_gestionar` → `en_reparto` (§5.ter), ni la ausencia de URL compartible.
