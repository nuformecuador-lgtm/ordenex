# Feature 93 — Optimización de ruta del mensajero (mitad FRONTEND) · implementación

Rama: `feature/93-optimizacion-ruta-mensajero-frontend` (worktree `ordenex-f93`, desde `origin/dev` @ 5244cf3).
Spec compartida con la 92: `specs/92-optimizacion-ruta-mensajero/` (reparto POR REQUISITO).
Alcance entregado: **R9, R25, R29, R30, R31, R32** (+ R28 en su parte de render).

---

## 🔴 ADVERTENCIA DE ORDEN DE MERGE — LEER ANTES DE MERGEAR

**Este PR NO DEBE MERGEARSE ANTES QUE EL DE LA FEATURE 92.**

La 92 (backend) está en `spec_ready` con **cero commits**: no existe
`OptimizacionRutaService`, ni el cliente de Route Optimization, ni las tablas de ruta, ni el gate de
asignabilidad que puebla los `motivo` de R9. El humano dio un override explícito para arrancar el
frontend igual, así que la 93 **declara los tipos por adelantado** (transcritos de `design.md`
§6.1/§6.2) y deja `lib/actions/ruta-mensajero.ts` sin cuerpo real.

Si esto se mergea antes que la 92:

- el botón "Sincronizar ruta" queda **muerto en producción**: la action devuelve `no_implementado`
  (el simulador está fenced y jamás se activa allí);
- el aviso de R30 nunca aparece (el servidor no envía `ruta`);
- los toasts de R9 nunca se disparan (nadie emite esos `motivo` todavía).

Nada de eso rompe la app —todo degrada a lo que ya había—, pero es funcionalidad que **finge existir
en el código y no existe en el producto**. El merge tiene que ir después de la 92.

---

## Archivos tocados

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `app/(app)/_components/geocodificacion-motivo-messages.ts` | R9: mapeo COMPARTIDO de los 5 `motivo` del gate a los 2 mensajes. Escrito una vez. |
| `hooks/useUbicacionActual.ts` | §6.3: `getCurrentPosition` con timeout + guarda dura; estado `{ coords, denegado }`. |
| `lib/actions/ruta-mensajero.ts` | Firma y resultados de `sincronizarRuta` (R31–R34). **Sin cuerpo real: `TODO(92)`.** |
| `lib/actions/_ruta-mensajero-simulado.ts` | Simulador de desarrollo **fenced**. No es el backend. |
| `tests/unit/components/guia-decision-error-messages.test.ts` | R9 a nivel mapper (los 5 motivos → 2 mensajes, en los DOS mappers). |
| `tests/unit/actions/ruta-mensajero-fencing.test.ts` | Fencing del simulador + desenlaces simulados. |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `app/(app)/ordenes/_components/guia-decision-error-messages.ts` | R9: rama que inspecciona `detalle[].motivo` **antes** del switch por `status`. |
| `app/(app)/recepcion-satelite/_components/asignacion-satelite-error-messages.ts` | R9: misma rama (es el mapper de `AsignarSateliteModal`). |
| `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx` | R30 (aviso), R31 (botón), R32/R25 (sincronizar + geolocalización). |
| `app/(app)/mis-asignaciones/page.tsx` | Baja `ruta` y `rol` por props (server → cliente, sin fetch). |
| `lib/interfaces/services/IMisAsignacionesService.ts` | Tipos de la 92 declarados por adelantado (ver abajo). |
| `lib/types/gestion-orden.ts` | Espejo de `ruta` en el resultado de la Server Action (ver abajo). |
| `tests/components/{GenerarGuiaModal,AsignarBodegaModal,MisAsignacionesModule}.test.tsx` | Casos nuevos de R9 / R25 / R29–R32. |

**Fuera de alcance, NO tocados:** `lib/services/`, `lib/repositories/`, `lib/clients/`,
`lib/config/`, `db/`, `PorAceptarSection`, el orden de `porRecoger`, mapas y visualización de ruta.

---

## Desviaciones del brief (declaradas, no silenciosas)

**1. Los tipos de la 92 se declaran OPCIONALES, no requeridos.**
`design.md` §6.1 dice que `MiAsignacionDTO` *gana* `secuenciaRuta: number | null` y que la rama `ok`
*gana* `ruta: {...}`. Declararlos **requeridos** rompe el typecheck de inmediato: quien construye
esos objetos es `MisAsignacionesService.toDTO` / `listarMisAsignaciones`, que están **fuera del
alcance de la 93** y todavía no los pueblan. Como el baseline exigido es 0 errores de typecheck, van
como `secuenciaRuta?: number | null` y `ruta?: RutaResumen`. La 92 los vuelve requeridos al
implementar el cuerpo. Ambos llevan el comentario pedido:
`// Feature 92 (§6.1) — declarado por la 93 por adelantado; ver status_note de la 93 en feature_list.json`.

**2. Se tocó un TERCER archivo no-UI: `lib/types/gestion-orden.ts`.**
El brief autorizaba 2 excepciones (`IMisAsignacionesService.ts` y `ruta-mensajero.ts`). Hizo falta
una tercera porque `ListarMisAsignacionesResult` (el resultado que devuelve la Server Action y que
lee la page) **repite a mano** la rama `"ok"` en vez de reutilizar la del service. Sin añadir `ruta?`
allí, `page.tsx` no puede leer `result.ruta` y R30 no tiene de dónde salir. El cambio es
type-only y aditivo. Es un olor preexistente del repo (contrato duplicado en dos sitios), anotado
como seguimiento.

**3. `feature_list.json` NO se tocó.** Es bookkeeping del leader, y el repo ya tiene historia de
altas ajenas sin commitear que se pierden si un subagente lo reescribe.

**4. R28 se cubre solo en su mitad de render.** El reordenado real (`porGestionar` ordenado por
secuencia asc + las sin posición al final) es del service, o sea de la 92. La 93 aporta la garantía
complementaria: **el cliente no reordena**.

---

## Decisiones de diseño que conviene mirar en review

**El frontend NO ordena. Regla dura.** `MisAsignacionesModule` renderiza `porGestionar` en el orden
recibido; no hay ningún `sort`, `toSorted`, ni `useMemo` que reordene. El test
`R28: renderiza las cards ... EN EL ORDEN RECIBIDO` pasa las órdenes desordenadas respecto de
**cualquier** criterio local plausible (`numRemision`, `destinatario`, `secuenciaRuta`), de modo que
se pone rojo si alguien mete un sort en cliente.

**R9 vive en el mapper, no en los modales.** Los cuatro modales (`GenerarGuiaModal`,
`AsignarBodegaModal`, `AsignarSateliteModal`, `RutearSateliteModal`) no leen `detalle`: delegan en
`guiaDecisionErrorMessage` / `asignacionSateliteErrorMessage`, que ramificaban **solo por `status`**
(verificado en `guia-decision-error-messages.ts:47-56`), así que el `motivo` se descartaba antes del
toast. La rama nueva se escribe UNA vez en `geocodificacion-motivo-messages.ts` y la consultan los
dos mappers antes de su switch. Mapeo:

| `motivo` | Mensaje |
| --- | --- |
| `direccion_no_geocodificable`, `geocodificacion_agotada` | **"Dirección no encontrada"** (literal pedido) |
| `geocodificacion_en_curso`, `geocodificacion_encolada`, `geocodificacion_no_encolable` | "La dirección aún se está validando. Vuelve a intentarlo en unos minutos." |

Si conviven un motivo definitivo y uno transitorio, gana el **definitivo** (es el que exige acción
del operador). Hay test de no-regresión: un `conflict` con cualquier otro motivo sigue cayendo en el
mensaje por `status`, y el de bodega satélite bloqueada conserva el suyo.

**R25 es un invariante, no un caso de error.** `useUbicacionActual.pedirUbicacion()` **siempre
resuelve**: `null` si el permiso se deniega, si expira el timeout o si el navegador no tiene
`geolocation`. El botón llama a la action **igual**, solo que sin `ubicacion`, y el backend degrada
al fallback de origen (R24). No hay ninguna rama que aborte por falta de permiso.

**Sin SWR ni fetcher de cliente.** El camino es el que el módulo ya usaba: Server Component → props
→ Server Action → `router.refresh()` (`MisAsignacionesModule` :81/:105/:120/:129/:140).

**Fail-closed en el rol.** El botón solo se renderiza con `rol === "mensajero"` explícito. Sin prop
`rol`, no se renderiza. La page ya hace `notFound()` para otros roles; esto es la tercera capa (la
segunda es la guarda de la action, R33).

---

## Q10 — PENDIENTE DE DECISIÓN DEL HUMANO

**`RutearSateliteModal` es el CUARTO consumidor del mapper compartido, y hereda R9 sin haberlo
pedido.**

`app/(app)/ordenes/_components/RutearSateliteModal.tsx` usa `guiaDecisionErrorMessage`. Al extender
ese mapper, el ruteo a bodega satélite **empieza a mostrar los mensajes nuevos de R9 quiera o no**.
No hay forma de evitarlo salvo duplicar la lógica, que es peor.

Según el brief, **NO se le añadió test dedicado**: Q10 sigue abierta y no es decisión de esta
implementación. Queda documentado aquí como pendiente:

- **Estado:** comportamiento CAMBIADO, cobertura dedicada AUSENTE.
- **Riesgo:** es exactamente la forma del drift "cambio el comportamiento y dejo un consumidor
  atrás" que el repo ya sufrió 8 veces.
- **Mitigación parcial:** el test del mapper (`tests/unit/components/guia-decision-error-messages.test.ts`)
  cubre la lógica que `RutearSateliteModal` consume, aunque no el cableado del modal.
- **Recomendación del spec_author (`requirements.md` Q10):** que entre en alcance CON su test.
- **Acción requerida:** decisión del humano. Si dice que sí, es un archivo de test más.

---

## Simulación del flujo sin backend (pedido del humano)

`lib/actions/ruta-mensajero.ts` **no finge que funciona**: sin el flag devuelve
`{ status: "no_implementado" }`. Detrás hay un simulador en memoria, en archivo aparte y con nombre
que no engaña (`lib/actions/_ruta-mensajero-simulado.ts`), para poder recorrer el flujo a mano.

### Cómo levantarlo

```sh
RUTA_SIMULADA=1 pnpm dev     # el flag es obligatorio y explícito
```

Entrá como usuario con rol `mensajero` y visitá **`/mis-asignaciones`**, con al menos 2 órdenes en
`en_reparto`. El botón **"Sincronizar ruta"** está a la derecha del título "En reparto / por
gestionar".

### Qué se ve en cada desenlace

| Acción | Qué esperar |
| --- | --- |
| 1.ª pulsación, permiso de GPS **concedido** | Prompt del navegador → toast "Ruta sincronizada." → `router.refresh()`. Origen `gps`, ruta `vigente`, **sin** aviso. |
| 2.ª pulsación (esperando >10 s) | Ruta `desactualizada` + `paradasSinOptimizar: 1` → **aparece el aviso amarillo de R30**. |
| 3.ª pulsación | Vuelve a `vigente` → el aviso **desaparece**. Alterna en cada sync. |
| Doble clic dentro de 10 s | Toast "Espera unos segundos antes de volver a sincronizar." (R34). Sin refresh. |
| Permiso **denegado** o timeout | La sincronización **sigue igual**, sin `ubicacion`. Origen `ultima_conocida`/`centroide`. Sin toast de error (R25). |
| Rol ≠ `mensajero` | El botón ni se renderiza (R31); si se invoca la action igual → `forbidden` (R33). |

### Límite honesto de la simulación

**Las cards NO se reordenan.** El orden lo decide el servidor (`porGestionar` ya ordenado por el
service) y eso es de la 92; el simulador solo devuelve una `secuencia` de mentira en el resultado de
la action. Simularlo en cliente exigiría un sort en el componente, que es justo lo que R28 prohíbe.
Lo que sí se recorre de punta a punta es: pulsar → permiso → action → resultado → aviso →
`router.refresh()`.

### Fencing (tres candados, con test)

1. Archivo aparte, prefijo `_` y la palabra `simulado` en el nombre.
2. Solo se activa con `RUTA_SIMULADA=1` explícito. **Apagado por defecto.**
3. **Nunca** se activa con `NODE_ENV === "production"`, ni con el flag puesto.

`tests/unit/actions/ruta-mensajero-fencing.test.ts` verifica los tres, **más una contraprueba** (con
flag y fuera de producción la action **sí** entra al simulador) para que los dos primeros tests no
pasen trivialmente si alguien hiciera que la action devolviera siempre `no_implementado`. Si alguien
borra una guarda, ese archivo se pone rojo.

---

## Trazabilidad `R<n>` → test

| Req | Test |
| --- | --- |
| **R9** | `tests/unit/components/guia-decision-error-messages.test.ts` (12 casos: los 5 motivos → 2 mensajes, en los DOS mappers; precedencia; no-regresión; entradas defensivas) |
| **R9** | `tests/components/GenerarGuiaModal.test.tsx` → `R9: conflict con motivo <5 motivos>` |
| **R9** | `tests/components/AsignarBodegaModal.test.tsx` → `R9: conflict con motivo <5 motivos>` |
| **R25** | `tests/components/MisAsignacionesModule.test.tsx` → `R25/R32: permiso CONCEDIDO…`, `R25: permiso DENEGADO…`, `R25: FALLO/TIMEOUT…`, `R25: navegador SIN geolocation…` |
| **R28** (render) | `MisAsignacionesModule.test.tsx` → `R28: renderiza las cards … EN EL ORDEN RECIBIDO (sin sort en cliente)` |
| **R29** | `MisAsignacionesModule.test.tsx` → `R29: NO altera el orden de 'Por recoger'` |
| **R30** | `MisAsignacionesModule.test.tsx` → 4 casos: `desactualizada`, `paradasSinOptimizar>0`, vigente+0 (sin aviso), sin datos de ruta (sin aviso) + `R30/R32: tras sincronizar…` |
| **R31** | `MisAsignacionesModule.test.tsx` → `R31: con rol mensajero…`, `R31: con rol <adminTienda/adminMaestro/bodega>…`, `R31: sin rol explícito (fail-closed)` |
| **R32** | `MisAsignacionesModule.test.tsx` → `R25/R32: permiso CONCEDIDO → envía ubicacion y refresca`, `R32: mientras la action no resuelve, el botón queda deshabilitado` |
| **R33/R34** (parte UI) | `MisAsignacionesModule.test.tsx` → `R34 (UI): un conflict…`; `tests/unit/actions/ruta-mensajero-fencing.test.ts` → `R33`, `R34` sobre el simulador |
| **Fencing** | `tests/unit/actions/ruta-mensajero-fencing.test.ts` (4 casos + contraprueba) |

Los tests de componente **mockean la Server Action**, no el simulador.

---

## Verificación (salida REAL, medida — no citada)

### `pnpm typecheck` → **0 errores** (baseline 0, mantenido)

```
> ordenex@0.1.0 typecheck C:\Users\Cristian\Documents\trabajo\arc\ordenex-f93
> tsc --noEmit
```

(sin salida = sin errores)

### `pnpm lint` → **0 errores**

```
✖ 143 problems (0 errors, 143 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

Los 143 warnings son preexistentes de `dev` (hooks/exhaustive-deps, no-unused-vars en
`cierres-admin.ts`, `EtiquetaGuiaService.ts`, etc.). Ninguno en archivos de esta feature.

### Tests de la feature → **100 passed / 100**

```
npx vitest run tests/components/MisAsignacionesModule.test.tsx \
  tests/components/MisAsignacionesPage.test.tsx \
  tests/components/GenerarGuiaModal.test.tsx \
  tests/components/AsignarBodegaModal.test.tsx \
  tests/components/AsignarSateliteModal.test.tsx \
  tests/unit/components/guia-decision-error-messages.test.ts \
  tests/unit/utils/guia-decision-error-message.test.ts \
  tests/unit/actions/ruta-mensajero-fencing.test.ts

 Test Files  8 passed (8)
      Tests  100 passed (100)
   Duration  12.36s
```

### Suite completa → **35 failed | 3558 passed (3593)**

```
 Test Files  13 failed | 351 passed (364)
      Tests  35 failed | 3558 passed (3593)
   Duration  115.15s
```

**Clasificación de los rojos — todos AJENOS, verificado en aislado:**

Se re-corrieron los 6 archivos que fallan de forma reproducible, **con y sin mis cambios**
(`git stash -u` → correr → `git stash pop`):

| Corrida | Resultado |
| --- | --- |
| CON mis cambios | `6 failed \| 2 passed (8)` — **26 failed** \| 69 passed |
| SIN mis cambios (`git stash -u`) | `6 failed (6)` — **26 failed** \| 63 passed |

**Mismos 26 fallos, mismos 6 archivos, con y sin la feature 93.** Son preexistentes en `dev` y
quedan fuera de alcance (no se arreglan):

- `tests/unit/components/ordenes-tabs.test.tsx` (12)
- `tests/components/OrdenesRevisionMaestro.test.tsx` (6)
- `tests/components/HistorialOrdenTimeline.test.tsx` (3)
- `tests/components/RecepcionSateliteModule.test.tsx` (2)
- `tests/components/EstatusLabel.test.ts` (1)
- `tests/unit/actions/mis-asignaciones-action.test.ts` (1)
- `tests/integration/actions/generar-gastos-fijos-route.test.ts` (1) — deuda conocida de la feature 90

Los 9 restantes de la suite completa (`HistorialOrdenSheet`, `OrdenesApartado`,
`OrdenesCargaResumenPaso`, `OrdenesEstatusLabelAdminTienda`, `EscanerRecepcionOrigen`,
`no-embalaje`, `CierreDiaPage`) son **flakes de timeout bajo carga**: no reaparecen al correrlos
aislados y varían entre corridas de la suite completa (`CierreDiaPage` y `no-embalaje` fallan en una
corrida y no en la siguiente). `CierreDiaPage.test.tsx` es además el fallo ajeno conocido por el
drift del PR #82.

**Ningún rojo es atribuible a la feature 93.**

---

## Seguimientos anotados

1. **Q10** (arriba): decisión del humano sobre `RutearSateliteModal`.
2. La 92 debe volver **requeridos** `secuenciaRuta` y `ruta` al implementar el cuerpo.
3. `ListarMisAsignacionesResult` (`lib/types/gestion-orden.ts`) **duplica a mano** la rama `"ok"` de
   `ListarMisAsignacionesServiceResult`. Cada campo nuevo hay que añadirlo en dos sitios o el borde
   lo pierde en silencio. Candidato a unificación en una feature de limpieza.
4. **Borrar `lib/actions/_ruta-mensajero-simulado.ts`** en cuanto la 92 aterrice con el cuerpo real.
5. `lib/actions/mis-asignaciones.ts:99,103` tiene `console.log("xyz AAA*")` de depuración, ajeno y
   preexistente. No se tocó (fuera de alcance), pero no debería llegar a producción.
