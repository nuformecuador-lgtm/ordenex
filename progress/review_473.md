# Review 473 — Corregir la recepción de dinero de una satélite

- Revisado: `origin/feature/473-corregir-recepcion-satelite` @ `90be20f6` (HEAD desacoplado), diff `origin/dev...HEAD`.
- Fecha: 2026-10-05. Reviewer: agente reviewer (Opus).
- Herramientas: no usé el grafo `codebase-memory`. Los símbolos venían citados en el design y en el diff, y los leí directamente en el árbol.
- Entorno: worktree propio, `pnpm install --frozen-lockfile` + `prisma generate`, `.env` copiado del checkout principal, base `localhost:5432` (`migrate status`: up to date).

## Veredicto: **APROBADO** (para mergear a `dev`)

No hay bloqueantes. Antes de pasar a `done`, cerrar M1 (`tasks.md` sin marcar) y la entrada de `progress/history.md` (M4). Los mismos criterios se aplicaron en las reviews 462, 465 y 461: bloquean el `done`, no el merge.

## Checklist

### Especificación
- [x] `requirements.md` con R1–R17 en EARS.
- [x] `design.md` con tres alternativas descartadas (A tipo nuevo, B Desmarcar+Marcar, C booleano en `marcarConciliado`), cada una con su motivo.
- [ ] `tasks.md` con todas las tasks `[x]`: **0 de 6 marcadas**. T1–T5 están hechas y con evidencia, y T6 lo está salvo la verificación visual, que era opcional. → M1.

### Trazabilidad (R → test, comprobado en el archivo y corrido por mí)
| R | Test | Estado medido |
|---|---|---|
| R1 | `tests/integration/db/corregir-conciliacion.int.test.ts` · «R1: corregir una incompleta…» | verde; rojo con la mutación 1 |
| R2 | idem · «R2: …reescribe conciliado_por/conciliado_at y el espejo resuelto_*» (dos usuarios, marca envejecida) | verde; rojo con la mutación 1 |
| R3 | idem · «R3: la nota se sustituye; sin nota queda NULL» | verde |
| R4 | idem · «R4: deja exactamente UNA fila…» (Δ historial = 1, `valor_anterior` 177800.00, `valor_nuevo` 200800.00, `monto` nuevo, nota ausente del JSON) + unit repo R4 | verde |
| R5 | guardia `historial-accion-escrituras-cubiertas` · entrada `corregirConciliacion` (`abre_tx`) | verde |
| R6 | int · `it.each` pendiente / en-rechazo: `conflict`, fila idéntica e historial sin cambios | verde; rojo con la mutación 2 |
| R7 | int · id inexistente → `fuera_de_alcance`, 0 filas; servicio → `no_encontrada` | verde |
| R8 | unit repo · «R8: el WHERE … exige aprobado, conciliadoAt no nulo y el monto leido» + «count 0 tras leer → conflict sin appendAccion» | verde; rojo con la mutación 3 |
| R9 | servicio · «R9 corregir: un actor sin acceso total (%s) recibe forbidden y no se llama al repositorio» | verde |
| R10 | action · «R10 corregir sin sesion…» (entrada inválida a propósito, ninguna llamada al servicio) | verde |
| R11 | action · `it.each` con 7 casos (ausente, 0, negativo, 3 decimales, no numérico, clave extra, nota de 501) | verde (ver M2) |
| R12 | int · cuenta los tres libros antes y después, en REPEATABLE READ | verde |
| R13 | int · por SaldosSatelitesRepository: «a lo declarado → faltaPorRecibir 0.00» y «por debajo → 5000.00»; UI con los casos existentes de `wallet-satelites.test.tsx` | verde |
| R14 | `tests/integration/wallet-satelites.test.tsx` · «R14 — Corregir llama a la action de corregir y nunca a la de marcar» + `not.toHaveBeenCalled` en el caso de marcar | verde; rojo con la mutación 5 |
| R15 | idem · «R15 — … arranca con el monto registrado (485000.00) y su botón dice Corregir» | verde |
| R16 | idem · «R16 — corrección ok: …» (aviso en el visor, diálogo cerrado, `onCambio` y la lista vuelve a leerse) | verde |
| R17 | idem · `it.each` «R17 — conflict al corregir / al marcar» | verde; rojo con la mutación 5 (rama corregir) |

- [x] `progress/impl_473.md` contiene el mapa R → test (backend y frontend).

### Ejecución propia (no copiada de la bitácora)
- Vitest con los filtros corregir-conciliacion, conciliacion-satelites, wallet-satelites, marca-conciliacion, historial-accion-escrituras-cubiertas, superficie-de-uso y cierres-bodega-admin: **12 archivos, 283 tests en verde, 0 skipped** (la integración contra Postgres sí corrió).
- typecheck: exit 0. eslint sobre los archivos tocados: exit 0.
- Gate completo del frontend_dev (`progress/gate_473_frontend.log`, leído): `Test Files 2391 passed (2391)`, `Tests 33173 passed | 26 skipped`. Los 26 skipped son de AnaliticaPage y AnaliticaShell, y no hay ninguno en `integration/db`. El log trae `INIT_EXIT=0` y en él aparecen corregir-conciliacion.int (10 tests), superficie-de-uso (18) e historial-accion-escrituras-cubiertas (72) en verde. El gate completo no lo repetí: corrí los tests relacionados, typecheck y lint.

### Mutaciones re-medidas por mí (aplicar, correr, restaurar desde una copia y comparar byte a byte)
| # | Mutación | Resultado |
|---|---|---|
| 1 | WHERE de `corregirConciliacion`: `estado: ESTADO_APROBADO` → `ESTADO_SOLICITADO` | **ROJO** en la integración: 7 failed / 3 passed (R1, R2, R3, R4, R12, R13×2) |
| 2 | quitar `estado` y `conciliadoAt` del WHERE | **ROJO** en la integración: 2 failed (R6 pendiente y R6 en-rechazo) |
| 3 | quitar `montoRecibido: previo.montoRecibido` del WHERE | **ROJO** en el unitario del repo: 1 failed (R8) |
| 5 | `ConciliacionAcciones`: el modo corrección llama a `marcarConsolidacionRecibidaAction` | **ROJO** en `wallet-satelites.test.tsx`: 2 failed (R14, R17 al corregir) |

Coinciden con lo anotado en `progress/impl_473.md`. El árbol quedó restaurado byte a byte.

### Código frente al spec
- [x] El WHERE es el de design §2.1: `{ id, estado: aprobado, conciliadoAt: {not: null}, montoRecibido: previo.montoRecibido }`. No hay corte previo por `montoRecibido === null`. `appendAccion(tx, …)` va dentro del callback, con `valorAnterior`/`valorNuevo` y sin nota. El trío de desenlaces se resuelve fuera de la transacción.
- [x] Escribe exactamente las columnas que fija D3 (monto, nota, `conciliado_*` y el espejo `resuelto_*`) y no toca `estado`. El tratamiento del dinero es seguro: `Prisma.Decimal` y `toFixed(2)`, sin `Number` ni `parseFloat`.
- [x] Servicio: el guard `esAccesoTotal` va primero, llama a `corregirConciliacion` y nunca a `marcarConciliado`.
- [x] Action: sesión → `marcarConsolidacionRecibidaSchema.parse` (`.strict()`) → `service.corregirRecibida`, y devuelve `MarcaConciliacionActionResult` sin tipo nuevo.
- [x] La UI monta la action: «Corregir» (solo en `incompleto`) → `enviar` → `corregirConsolidacionRecibidaAction`, y «Marcar recibido» → marcar. La guardia `superficie-de-uso` está en verde sin `@sin-superficie`.
- [x] Historial: una sola fila `cierre_bodega_conciliado` con el monto anterior y el nuevo (medido en la integración R4 con el conteo de deltas).
- [x] Sin fallos mudos. Un `conflict` cierra el diálogo, muestra un toast y refresca la lista, así que el «Actualizando la lista» ahora es verdad. Un éxito muestra toast, cierra y refresca. El resto de estados conserva el aviso en el diálogo, igual que antes.
- [x] Textos de UI en `conciliacion-labels.ts`: «Corregir» y «Monto recibido corregido a ₡X.», con el formato de dinero `money()` existente. No hay sigla ni jerga.
- [x] Nada fuera de alcance: no hay migración ni archivos de `lib/types/`, el enum de historial no cambia (sigue en 65) y las pantallas contenedoras no se tocaron.

### Datos, seguridad y capas
- [x] No hay tablas nuevas (RLS no aplica) ni migraciones (`down.sql` no aplica).
- [x] Sin secretos: busqué cadenas de conexión y claves en los dos gate logs commiteados y salió 0.
- [x] No hay webhooks.
- [x] Capas: action (borde, sin DB) → service (rol, sin HTTP) → repository (Prisma). Las interfaces están en `lib/interfaces/`.
- [x] La mutación es una Server Action, no un fetch a una API route.
- [x] Nada de país, moneda ni cuenta hardcodeado: el formato de moneda se reutiliza.
- [~] E2E: la feature toca recaudo (conciliación de efectivo), pero el repo no tiene harness E2E, como declara el spec. El riesgo queda cubierto con la integración contra Postgres y el test de componente. Lo declaro no aplicable.

### Verificación final
- [x] `./init.sh` completo en verde (log del frontend_dev, `INIT_EXIT=0`), con mi re-ejecución parcial también en verde.
- [x] Este informe existe, con veredicto APROBADO.
- [ ] Entrada en `progress/history.md`. → M4.

## Hallazgos

### Bloqueantes
Ninguno.

### Menores
- **M1 — menor (bloquea el `done`, no el merge).** `specs/473-corregir-recepcion-satelite/tasks.md` tiene las 6 tasks en `[ ]`. T1–T5 están hechas y con evidencia, y T6 también salvo la verificación visual opcional. CHECKPOINTS pide marcarlas antes de `done`.
- **M2 — menor.** R11 dice «error de validación **por campo**», pero con una clave colada la action devuelve `validation_error` con `fieldErrors: {}`, porque zod la reporta como error de formulario. Es el mismo comportamiento que ya tenía marcar, está declarado en impl_473 y el test lo exime de forma explícita. No hay fallo mudo, porque el estado sigue siendo `validation_error`. Queda como deuda heredada.
- **M3 — menor, informativo.** Hay dos definiciones de «modo corrección»: `ConciliacionAcciones` usa `estado === "incompleto"` y `MarcarRecibidoDialog` usa `montoActual !== null`, es decir, todo lo que no es `pendiente`. Si la fila pasara a `recibido` con el diálogo abierto por un refresco externo, el diálogo seguiría rotulado «Corregir» pero enviaría a marcar. El WHERE de marcar lo rechaza con `conflict`, el diálogo se cierra y la lista se refresca, así que no se escribe nada indebido. Basta con unificar el criterio si se vuelve a tocar.
- **M4 — menor (cierre).** Falta la entrada en `progress/history.md`, que exige CHECKPOINTS. Le toca al leader al cerrar.
- **M5 — menor, declarado en el spec (D1/D3).** En el registro de acciones, una corrección se rotula «Marcó recibida una consolidación de bodega» y solo se distingue de una marca por `valor_anterior`. Además, la corrección mueve `resuelto_at`, así que la analítica la cuenta en el periodo de la corrección. Ambas decisiones las aprobó el humano. Las anoto para quien lea el registro o la analítica.
