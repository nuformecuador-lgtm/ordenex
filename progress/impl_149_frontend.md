# Feature 149 — Bitácora de implementación (FRONTEND, bloque F6)

> Rama `feature/149-deshacer-asignacion`, worktree `ordenex-wt-149`.
> Alcance de esta bitácora: **F6 (UI)** de `specs/149-deshacer-asignacion/tasks.md`.
> El backend (F0–F5) ya estaba hecho y NO se tocó (ver `progress/impl_149_backend.md`).
> F7 (cierre) es del reviewer/leader.

---

## 1. Estado de las tasks de F6

| Task | Estado | Nota |
| --- | --- | --- |
| T6.1 — Modal del maestro | ✅ | `DeshacerAsignacionModal.tsx` + `deshacer-asignacion-error-messages.ts` |
| T6.2 — Cableado del listado | ✅ | acción `deshacer` en `por_recoger` y `en_ruta_bodega_satelite` |
| T6.3 — Bucket `asignadas` del service satélite | ⛔ **BLOQUEADA** | toca `lib/services` = backend, fuera del alcance del `frontend_dev`. Ver §4 |
| T6.4 — Sección y modal de la satélite | ✅ (UI) | sección + modal + `router.refresh()`; sus datos los alimenta T6.3 |
| T6.5 — Tests de UI | ✅ | `tests/unit/components/deshacer-asignacion.ui.test.tsx`, 30 tests |

---

## 2. Archivos creados / modificados

### Nuevos
- `app/(app)/ordenes/_components/deshacer-asignacion-error-messages.ts`
  — cotas del motivo (`MOTIVO_MIN_LEN=10`, `MOTIVO_MAX_LEN=300`, espejo del zod del borde),
  `motivoValido()`, textos del campo y traducción de CADA `status`/motivo a un mensaje
  accionable distinto (R39). **No duplica literales de motivo**: importa las constantes de
  `lib/services/mensajes-deshacer-asignacion.ts` (T2.3), que son constantes puras y por tanto
  seguras en un bundle de cliente. Patrón `recuperar-bodega-error-messages.ts` (feature 100).
- `app/(app)/ordenes/_components/DeshacerAsignacionModal.tsx`
  — `Modal` compartido + `Textarea` de motivo con `<label htmlFor>`, `aria-describedby` de
  ayuda y `aria-invalid` mientras no valide; `confirmDisabled` sin motivo válido o sin órdenes
  (R37, con guarda redundante dentro del handler); **UNA sola llamada** a
  `deshacerAsignacion({ ordenIds, motivo })` con el lote completo (el backend es todo-o-nada,
  R20 — a diferencia de `RecuperarABodegaModal`, que hace loop por orden); toast de éxito con
  el conteo que devuelve el SERVIDOR (`resultados.length`, R38); errores al canal de error del
  `Modal` (R39).
- `app/(app)/recepcion-satelite/_components/DeshacerAsignacionSateliteModal.tsx`
  — envoltorio delgado sobre el modal del maestro. `RecepcionSateliteDTO` cumple por estructura
  la forma mínima (`id`, `numRemision`, `zonaNombre`) que declara `DeshacerAsignacionOrdenUI`,
  así que las dos superficies comparten formulario, validación y traducción de errores en vez
  de duplicarlos (design §6.2 pide "mismo cuerpo"; duplicarlo habría hecho que un arreglo en
  una superficie no llegara a la otra).
- `tests/unit/components/deshacer-asignacion.ui.test.tsx` — 30 tests (§3).

### Modificados
- `app/(app)/ordenes/_components/OrdenesListado.tsx`
  — `ModalAbierto` suma `"deshacer-asignacion"`; `abrirDeshacer()` (SIN filtro por zona: el
  acceso total deshace órdenes de cualquier zona, R3); `accionesDe("por_recoger")` y
  `accionesDe("en_ruta_bodega_satelite")` suman
  `{ key: "deshacer", label: "Deshacer asignación", variant: "outline" }`; se monta
  `DeshacerAsignacionModal` con `onSuccess = handleSuccess` (cierra + revalida las tablas, R38).
  **`bloqueoSeleccion` NO se tocó** (design §6.1): ninguno de los dos estados está en
  `ESTADOS_ASIGNACION`, así que el bloqueo de checkbox por zona con cierre abierto no aplica —y
  no debe añadirse, por Q1 (CERRADA): el cierre pendiente del mensajero NO bloquea el deshacer.
  Hay un test que lo fija.
- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`
  — prop opcional `asignadas?: RecepcionSateliteDTO[]` (default `[]`), `Set` de selección
  PROPIO (independiente de "Recibidas" y "Por devolver"), columnas con checkbox + cabecera
  `SelectAllCheckbox` (patrón exacto de "Por devolver"), sección `aria-label="Asignadas (por
  recoger)"` con `DataTable` y botón "Deshacer asignación" (deshabilitado sin selección), y el
  modal satélite con `onSuccess ⇒ limpia selección + cierra + router.refresh()` (R38).
  El botón **no** consulta `bloqueoBodega` (Q1/R19: asimetría deliberada con "Asignar").
  "Por recibir" (`en_ruta_bodega_satelite`) queda intacta, sin acción de deshacer (R36).

**`app/(app)/ordenes/_components/ordenes-columns.tsx` NO se tocó** (imán de drift conocido).
Tampoco se tocó ningún archivo de `lib/`, `db/` ni tests ajenos.

---

## 3. Matriz de trazabilidad R34–R39 → test REAL

Todos en `tests/unit/components/deshacer-asignacion.ui.test.tsx` (componentes REALES; solo se
mockean Server Actions, toast y router).

| R | Bloque / test |
| --- | --- |
| R34 | `R34 — acción por lote en el listado del maestro` › `se ofrece con una selección en 'por_recoger'`, `se ofrece con una selección en 'en_ruta_bodega_satelite' (caso b)`, `NO se ofrece en un estado no elegible ('en_bodega_central')`, `el checkbox de 'por_recoger' NO se bloquea (Q1…)` |
| R35 | `R35/R36 — módulo de la bodega satélite` › `R35: lista sus 'por_recoger' y ofrece la acción por lote sobre ellas` |
| R36 | idem › `R36: la sección 'Por recibir' (en_ruta_bodega_satelite) NO ofrece deshacer` |
| R37 | `R37 — el confirmar depende del motivo` › `sin motivo el botón está deshabilitado`, `con un motivo demasiado corto (o solo espacios) sigue deshabilitado`, `con un motivo válido se habilita y la acción se invoca UNA vez con el lote completo`, `el predicado de validez es el mismo del borde (10..300 tras recortar)` |
| R38 | `R38 — éxito en el listado del maestro` › `revalida el listado y avisa cuántas órdenes se revirtieron` (refetch de `listarOrdenes` + toast con el conteo) y `R35/R36 …` › `R38: tras el éxito se relee el estado del servidor (router.refresh)` (superficie satélite) |
| R39 | `R39 — mensajes accionables por causa` › `%s produce un mensaje propio` (13 causas), `los mensajes son DISTINTOS entre sí`, `un status desconocido cae en el mensaje genérico`, `el 'validation_error' del motivo usa el texto del campo`; + `R38 …` › `un fallo muestra el mensaje accionable y NO avisa de éxito` (extremo a extremo por la UI) |
| R40 (refuerzo UI) | `R40: ningún mensaje expone UUIDs ni el motivo crudo del backend` |

Las 13 causas cubiertas por R39 son exactamente las que enumera el requisito: sin permiso/zona
ajena (`forbidden`), sin zona (`sin_zona`), sesión expirada, motivo inválido, catálogo
incompleto, zona central sin configurar, orden ya recogida, orden ya recibida en satélite,
orden borrada, orden inexistente, sin historial para derivar, incoherencia zona/destino y
carrera.

---

## 4. BLOQUEO abierto — T6.3 (backend de lectura)

`RecepcionSateliteService.listar` hoy NO lista las `por_recoger` de la zona, así que la sección
"Asignadas (por recoger)" del módulo satélite se renderiza VACÍA en producción hasta que se
haga T6.3. Es un cambio de `lib/services`, fuera del alcance del `frontend_dev`, y por eso se
paró y se reportó en vez de tocarlo.

Lo que falta (todo backend, ~4 puntos):

```
lib/services/RecepcionSateliteService.ts
  + const ESTADO_ASIGNADA = "por_recoger";
  + añadirlo al array de `findRecepcionSateliteByZona(zonaId, [...])`
  + bucket `asignadas` en el mismo bucle de clasificación (y `asignadas: []` en la rama sinZona)
lib/interfaces/services/IRecepcionSateliteService.ts
  + `asignadas: RecepcionSateliteDTO[]` en `ListarRecepcionSateliteServiceResult`
app/(app)/recepcion-satelite/page.tsx
  + `asignadas={result.asignadas}` al módulo
tests/unit/services/…  unit del nuevo bucket (criterio de HECHO de T6.3)
```

La UI ya está lista para consumirlo: la prop `asignadas` del módulo existe, es opcional
(default `[]`, sin regresión para el resto de la página) y está cubierta por tests.

Consecuencia de trazabilidad: **R35 está cubierto a nivel de UI** (dada la lista de órdenes, el
módulo la muestra y ofrece la acción), pero el extremo "el sistema muestra las órdenes de SU
zona" no queda completo hasta T6.3.

---

## 5. Números REALES (medidos en este worktree)

Baseline de partida (con el backend integrado, sin la UI): typecheck 0 errores; lint 0 errores /
154 warnings; test 525 archivos / 5420 tests, 0 fallos.

```
$ pnpm typecheck
(sin salida)                       → 0 errores                         delta 0

$ pnpm lint
✖ 154 problems (0 errors, 154 warnings)                                delta 0 / delta 0
   (los 3 archivos nuevos de UI no añaden ningún warning)

$ pnpm test
 Test Files  526 passed (526)      → +1 archivo (deshacer-asignacion.ui)
      Tests  5450 passed (5450)    → +30 tests
        Fallidos: 0                                                    delta de fallidos = 0
```

---

## 6. Notas para quien siga

1. **T6.3 sigue pendiente** (§4): es lo único que separa a la superficie satélite de estar
   completa. Hasta entonces la sección aparece vacía (con su mensaje "No hay órdenes asignadas
   por recoger."), lo cual es inocuo pero visible.
2. **Decisiones honradas, no reabiertas**: Q1 (el cierre de día NO bloquea el deshacer: ni el
   checkbox del listado ni el botón de la satélite lo consultan, con test que lo fija),
   D4 (motivo obligatorio validado en el formulario ANTES de llamar), R36 (la satélite nunca ve
   el caso (b)), R20 (una sola llamada con todo el lote), R40 (ningún mensaje de UI renderiza
   `ordenId` ni motivos crudos del backend).
3. **Sin `fetch` a `/api/*`**: la mutación va por Server Action; la revalidación es `mutate` de
   SWR en el listado y `router.refresh()` en la satélite, según la superficie.
