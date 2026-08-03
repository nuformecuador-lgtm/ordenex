# Feature 132 — analítica: tablero financiero · REVISIÓN

> Revisor: subagente `reviewer`. Worktree `C:/w132`, rama
> `feature/132-analitica-tablero-financiero`, HEAD `a02941ff` (5 commits desde `c6f86e22`).
> Todo lo que se afirma aquí está **medido en esta rama por el revisor**, no leído de la
> bitácora. El worktree quedó **sin modificar** (`git status --porcelain` vacío tras cada
> mutación); no se ejecutó ningún comando que mueva HEAD.

## VEREDICTO: **RECHAZADO** — 1 bloqueante, 5 menores

El trabajo es, en lo demás, de calidad alta: el código de producción **cumple** los 28
requisitos, los gates están verdes y la red de tests es genuinamente sensible (28 de 31
mutaciones propias la ponen roja). El rechazo es por **trazabilidad**, no por defecto
funcional: **R3 no tiene ningún test capaz de fallar** cuando se le viola exactamente como
el requisito describe, y la bitácora declara para R3 una mutación que **verifiqué que NO
pone nada rojo**. Es reparable con ~10 líneas en el guard que ya existe.

---

## 1. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con EARS numerados `R1`-`R28`.
- [x] `design.md` con alternativas descartadas y su porqué (diez, seccion 7).
- [x] `tasks.md`: **13 de 15** marcadas `[x]`. Las dos abiertas (T6.2 `./init.sh` completo,
      T6.3 sincronización + PR) son **del leader**, no del implementer, y así está escrito en
      el propio `tasks.md`. No se cuenta contra el implementer.

### Trazabilidad
- [ ] **Cada `R<n>` mapea a un test que lo verifica de verdad: 27 de 28.** Falla **R3**
      (seccion 3, BLOQUEANTE-1).
- [x] `progress/impl_...md` contiene el mapa `R<n> -> test` con los 28 números, sin saltos ni
      repetidos, y todas las rutas citadas existen. Su **tercera columna (la mutación) es
      inexacta en dos filas** (seccion 4, menor-3).

### Calidad de código (medido por mí, en esta rama)
- [x] `pnpm run typecheck` -> **0 errores** (exit 0).
- [x] `pnpm run lint` -> **0 errores**, 27 warnings, todos `_args`/`_input` en tests ajenos.
- [x] `pnpm test` (suite completa) -> `Test Files 1 failed | 841 passed | 8 skipped (850)`,
      `Tests 3 failed | 10513 passed | 130 skipped (10646)`, `Duration 434s`.
      **850 archivos** (= el total esperado) y **cero bloques `Errors` / `Unhandled Error`**:
      la suite arrancó entera, no reporta de menos. Los 3 rojos son
      `tests/integration/db/analytics-daily-migration.test.ts`, por falta de `.env` en este
      worktree; **lo comprobé**: con `DATABASE_URL` exportada ese archivo da **62/62 verde**.
      No es defecto de la 132 y no se creó ningún `.env`. El flake de
      `filter-component.test.tsx` que la bitácora reporta **no reapareció** en mi corrida.
      *Consecuencia operativa:* `./init.sh` a secas **no puede terminar verde dentro de
      `C:/w132`** mientras no haya `.env` o `DATABASE_URL`; el leader debe correrlo donde sí
      lo haya antes del PR (T6.2).
- [x] `pnpm exec next build` (**nunca `pnpm build`**) -> `Compiled successfully in 20.1s`,
      `Finished TypeScript in 111s`, `/analitica` como ruta **dinámica**. El fallo ajeno de
      `app/api/cron/corte-diario/route.ts` **no se manifestó** tampoco en mi corrida.
- [x] E2E: no aplica. Q5 lo difiere a la 133 con motivo escrito; el gate por rol queda
      cubierto por tests de página que enumeran los **seis** `RolValue` uno a uno.

### Datos y seguridad
- [x] No hay tablas, columnas ni migraciones nuevas -> RLS y `down.sql` no aplican.
- [x] Ningún secreto; ningún `process.env` en la región (censado por el test de R26).
- [x] No hay webhooks nuevos.

### Patrón de capas y permisos
- [x] La página no importa `lib/actions`, `lib/services` ni `lib/repositories` (hay un censo
      del propio fuente que lo afirma); el único acceso al dinero está encapsulado en
      `_components/financiero/cargar.ts`, que habla **solo** con el Server Action de la 127.
- [x] `adaptar.ts` es puro (sólo `import type`); `cargar.ts` no decide presentación ni
      permisos; los componentes reciben objetos planos por props.
- [x] Permisos validados **server-side** (`resolveActorFromSession` + `notFound()`); no se
      tocó `lib/auth/**` ni `lib/analytics/**` (`git diff a66daa8a HEAD -- lib/` vacío,
      verificado por mí).
- [x] Vivir en `app/(app)/analitica/_components/financiero/` en vez de `components/private/`
      está justificado por la regla «sin sobre-ingeniería» de `docs/architecture.md:142-145`
      (un solo consumidor). No es hallazgo.

### Multi-país / configuración
- [x] Ni símbolo, ni ISO, ni locale escritos: todo pasa por `formatearValor`. Censado, y la
      mutación que introduce un símbolo de moneda pone el guard rojo (M20).

### Verificación final
- [x] Este archivo existe.
- [ ] `progress/history.md` **no tiene entrada de la 132** y `feature_list.json` sigue en
      `in_progress`. Bookkeeping del leader, pendiente (menor-5).

---

## 2. Mutaciones PROPIAS

Generadas por mí, no reutilizadas de la bitácora. Cada una: se aplica sobre el fuente de
producción, se corre el subconjunto de tests pertinente y se **restaura el archivo**
(`dirty=0` comprobado tras cada una).

**Lanzadas: 31 · Discriminaron (pusieron rojo): 28 · SUPERVIVIENTES: 3.**

| # | R | Mutación | Resultado |
|---|---|---|---|
| M1 | R14 | pasar la prop `totales` a `TablaResumen` (la fila que el paquete calcula con `totalizar`) | **ROJA** |
| M2 | R14 | el total pintado se **deriva** sumando `vista.filas` en vez de leer `vista.total` | **SUPERVIVIENTE** |
| M3 | R4 | el panel `denegado` se pinta como error con motivo | ROJA (2 casos) |
| M4 | R15 | `aNumero` devuelve `0` en vez de `null` | ROJA (6) |
| M5 | R21 | `agruparCola` trunca con `slice` en vez de agrupar | ROJA (4) |
| M6 | R20 | se quita `agruparCola` de la serie por tienda | ROJA |
| M7 | R18 | "saldo al corte" siempre apagado | ROJA |
| M8 | R22 | el rango se recalcula en pantalla | ROJA |
| M9 | R23 | el panel en error pinta un `0` y pierde el `role="alert"` | ROJA (2) |
| M10 | R24 | el `cubo` se acorta antes de pintarlo | ROJA (3) |
| M11 | R16 | el KPI deja de pintar el `bruto` | ROJA |
| M12 | R17 | las dos vistas de `cod_recaudado` comparten nombre accesible | ROJA (5) |
| M13 | R26 | el rango por defecto pasa de `mes` a `dia` | ROJA (2) |
| M14 | R9 | se le pasa `deps` al Server Action | ROJA |
| M15 | R12 | `Promise.all` -> bucle `for ... await` | ROJA |
| M16 | R13 | se omite la octava métrica (`slice(0,7)`) | ROJA (4) |
| M17 | R23 | `validation_error` se normaliza a `denegado` | ROJA |
| M18 | R19 | se silencia el aviso de descuadre | ROJA (2) |
| M19 | R19 | el aviso pierde la **cantidad** de descuadrados | ROJA (2) |
| M20 | R25 | se escribe un símbolo de colón en un texto de la pantalla | ROJA (guard) |
| M21 | R27 | lista de ids financieros escrita a mano en `cargar.ts` | ROJA (guard) |
| M22 | R10 | `"use client"` en `page.tsx` | ROJA (guard) |
| M23 | R10 | se pasa `avisoRecorte={(m,r) => ...}` a `GraficaBarras` | ROJA (guard) |
| M24 | R7 | la región financiera se pinta siempre, con `EmptyState` | ROJA (3) |
| M25 | R6 | la región financiera se apila **encima** de la operativa | ROJA |
| M26 | R1 | la página deja de pasar la prop `financiero` | ROJA (3) |
| M27 | R3 | `esAccesoTotal(actor.rol)` -> lista de roles escrita a mano | **SUPERVIVIENTE** |
| M28 | R9 | el pre-fetch se mueve **delante** del gate | ROJA (7) |
| M29 | R5 | se ensancha `ROLES_ACCESO_ANALITICA` con `mensajero` | ROJA (6) |
| M30 | R19 | la tabla de conciliación pierde los cuatro totales por método | **SUPERVIVIENTE** |
| M31 | R11 | `"use client"` en `page.tsx` + **`pnpm exec next build`** | **ROJA de verdad**: `Module not found`, traza `page.tsx -> resolve-actor -> prisma-client -> pg` (Prisma al bundle del navegador) |

M31 es la que importa para la afirmación fuerte de la feature: **R11 no es un trámite**, el
build distingue de verdad y sin él ningún gate del repo vería ese fallo.

---

## 3. BLOQUEANTE

### BLOQUEANTE-1 - R3 no tiene red: la mutación que el requisito describe sobrevive

**Qué exige R3:** «El conjunto de roles para los que se renderiza la región financiera DEBE
derivarse del catálogo de métricas y de `esAccesoTotal`, y **NO de una lista de roles escrita
de nuevo en esta feature**.»

**Qué comprobé (M27):** sustituí en `app/(app)/analitica/page.tsx` la condición
`if (!esAccesoTotal(actor.rol))` por `if (!["maestro", "admin"].includes(actor.rol))` -es
decir, exactamente la lista que R3 prohíbe- y corrí `tests/components/AnaliticaPage.test.tsx`
más el guard de la feature: **51 tests, 51 verdes**. La violación literal de R3 pasa el gate
sin dejar rastro.

**Por qué el test mapeado no lo ve.** El caso «el conjunto de roles que ve la región coincide
exactamente con los que `esAccesoTotal` acepta» compara **comportamiento**, y `esAccesoTotal`
y la lista a mano **coinciden hoy**. R3 no es un requisito de comportamiento, es de **fuente
única**; sólo un censo del fuente puede distinguirlos. El guard de la feature censa
`"use client"`, prop-funciones, moneda/locale, la declaración de dominio y listas de ids -
pero **no** listas de roles.

**Agravante.** La bitácora (seccion 2, fila R3) declara como mutación que lo pone rojo
exactamente «Sustituir `esAccesoTotal(actor.rol)` por una lista de roles escrita a mano».
**Es falso**, y R28 convierte ese mapa en parte entregable de la feature.

**Qué falta para cumplirlo** (no lo arreglo yo): añadir a
`tests/unit/guards/tablero-financiero.guardia.test.ts` un quinto censo sobre los archivos ya
censados: (a) `page.tsx` **contiene** `esAccesoTotal(`; (b) ningún archivo de la región
contiene un literal de array con **dos o más** `RolValue` entrecomillados -mismo patrón que
`listasDeIdsAMano`, que ya está escrito ahí al lado y ya tiene autocomprobación-. Y corregir
la fila R3 del mapa de la bitácora.

---

## 4. Hallazgos menores

**menor-1 - R14: un importe derivado en el componente sobrevive (M2).** Sustituí los tres
`total={vista.total}` de `TableroFinanciero.tsx` por un total **calculado** sumando
`vista.filas` en coma flotante -la derivación exacta que R14 prohíbe- y el perímetro entero
(8 archivos, 118 tests) siguió **verde**. El motivo es la fixture: en
`cuenta_por_pagar_tienda` la suma de filas **coincide** con el total del DTO (121/110), y del
panel por método (donde no coinciden: filas 306,66 frente a total 311,11) **ningún caso
afirma el total**. R14 sí tiene red no vacua en `adaptar.ts` (M1, M4, M10 rojas), así que no
es bloqueante; pero la mitad "componente" del requisito está descubierta.
*Cómo cerrarlo:* afirmar en `TableroFinanciero.test.tsx` que la sección por método muestra
`cifra(311.11)` y **no** `cifra(306.66)`.

**menor-2 - R19: los totales por `(nivel, estado)` sobreviven (M30).** Anulé los cuatro
importes por método de cada fila (`valores[clave] = null`) y `PanelConciliacion.test.tsx`
siguió 6/6 verde. R19 pide «los conteos por `(nivel, estado)` **con sus totales**»; hoy se
verifican los conteos, el cuadre y el aviso, pero no los totales de fila.
*Cómo cerrarlo:* una aserción sobre `cifra(1000)` / `cifra(250.5)` dentro de la sección.

**menor-3 - la tercera columna del mapa de la bitácora es inexacta.** Además de R3
(bloqueante), la fila R14 declara «...o promediar/derivar cualquier importe» como mutación
letal: la mitad `totales` sí lo es (M1), la mitad "derivar" **no** (M2). El resto de la
columna que muestreé (R1, R4, R5, R6, R7, R9, R10, R11, R12, R13, R15, R16, R17, R18, R19,
R20, R21, R22, R23, R24, R25, R26, R27) **se sostiene**: la comprobé mutación a mutación.

**menor-4 - `design.md` seccion 5 quedó desalineado con el código y debería corregirse.** Los
paneles 6, 7 y 9 de la tabla siguen pidiendo "fila de totales" de `TablaResumen`. La
**desviación D1 del implementer es CORRECTA y no tapa ningún incumplimiento**: esa prop hace
que el paquete calcule la fila con `totalizar` (`TablaResumen.tsx:44-54`), que es una suma
derivada en coma flotante y por tanto una violación directa de R14 -y mi mutación M1 lo
confirma: activar `totales` **pone rojo** el test-. Lo que se pinta en su lugar es
`vista.total`, literal del DTO, con bruto y neto etiquetados y verificados. El defecto es del
**diseño**, no de la implementación: esa seccion debería decir «el `total` del DTO junto a la
tabla, nunca la prop `totales`», para que el próximo consumidor (131/134) no lo reintroduzca
leyendo el diseño.

**menor-5 - bookkeeping pendiente (leader).** `progress/history.md` no tiene entrada de la
132, `feature_list.json` sigue `in_progress`, y T6.2/T6.3 están abiertas. Además, `./init.sh`
completo **no puede salir verde dentro de `C:/w132`** sin `.env`/`DATABASE_URL`: hay que
correrlo donde lo haya (comprobado: con `DATABASE_URL` el archivo que falla da 62/62).

---

## 5. Los puntos que se pidieron mirar con lupa

- **La desviación D1 (no usar la prop `totales`)** -> **correcta**, y `design.md` seccion 5 es
  lo que debe corregirse (menor-4). No tapa nada: el `total` pintado sale literal del DTO y
  hay tests que lo afirman en sus dos formas.
- **R10/R11, la frontera RSC** -> **verificado por mí y con mordida real.** `pnpm exec next
  build` limpio en verde con `/analitica` dinámica; con `"use client"` en `page.tsx` el build
  **revienta** arrastrando `pg`/Prisma al bundle del navegador (M31), y el guard estático lo
  caza antes (M22). Ninguna prop-función cruza: la única del contrato (`avisoRecorte`) no se
  pasa nunca y meterla pone el guard rojo (M23).
- **R2/R4, que no se filtre nada por rol** -> **verificado.** Los cuatro roles sin acceso
  reciben `notFound()`, el cargador **no se invoca ni una vez** para ellos (M28 lo demuestra),
  y el caso de R2 barre `document.body` buscando la palabra de la región, la etiqueta de la
  métrica, las dos cifras (crudas y con separador de miles) y cualquier estado vacío. El
  doble del cargador devuelve un DTO con etiqueta y cifras **reconocibles**, así que no pasa
  por vacío. Ensanchar el gate lo pone rojo (M29). El panel `forbidden` no se pinta en cero,
  no deja hueco (8 secciones en vez de 9) y no muestra motivo (M3 rojo); el `denegado` que
  produce `cargar.ts` no lleva ni siquiera campo de motivo, y hay un test que cuenta sus
  claves.
- **R14, que no se derive ningún importe** -> el **código** no deriva nada (lo leí línea a
  línea: `adaptar.ts` sólo convierte, y la única suma es la cola que R20/R21 ordenan, sobre
  números de presentación). La **red de tests** tiene el hueco de menor-1.
- **R20/R21, la agrupación de cola** -> **verificado.** Agrupar conserva el total (y una cola
  entera sin dato produce una categoría **ausente**, no un cero); los doce cubos agrupados
  pasan por `prepararSeries` sin lanzar y los mismos sin agrupar **lanzan**
  `SeriesExcedidasError` -el contrapeso que impide que el caso pase por vacío-. Quitar
  `agruparCola` (M6) y truncar con `slice` (M5) ponen rojo.
- **Las otras cuatro desviaciones (D2-D5)** -> todas **declaradas con motivo suficiente** y
  ninguna es un requisito incumplido disfrazado. D2 (sin `EmptyState` financiero) ya venía
  decidida en `design.md` seccion 3.5 y ratificada en T0.4/Q4, y es lo que hace cierto R7. D3
  (prefijar los nombres accesibles internos) evita dos regiones anidadas homónimas y no
  oculta nada: los nombres esperados se derivan del DTO en el test. D4 (despacho por la
  **forma** del DTO y no por un `switch` de ids) es precisamente lo que evita reescribir la
  lista que R27 prohíbe. D5 (renombrar la clave `rango` a `etiquetaRango`) responde al censo
  de R26 y **no relaja el censo**: comprobado, el patrón de clave-rango sigue en pie y
  detecta `rango.ts`.
- **Los dos guards del repo que la feature puso rojos (`197d8b52`)** -> **no se relajó
  ninguno.** `tests/unit/guards/censo-simpe.test.ts` y
  `tests/unit/descarga/cobertura-tablas.guardia.test.ts` están **intactos** en el diff de los
  5 commits; lo único que cambió es el **dato** (`tests/unit/descarga/censo-tablas.ts`):
  `TablaResumen` declara sus dos montajes reales -que el propio guard verifica contra el
  árbol- y sustituye el motivo, sin mover los totales del censo (26 `con_descarga` / 7
  `fuera`), que siguen escritos y verdes. La corrección de SIMPE a SINPE es la grafía
  canónica del repo y la clave del DTO sigue en minúsculas.
- **Las decisiones de la puerta F1.4** -> implementadas tal como se decidieron: rango por
  defecto `mes` en **una** constante congelada (y un censo que impide un segundo origen);
  `tiendaId` **crudo**, con la limitación **visible en pantalla** -hay test de que aparece en
  los dos paneles de grano `tienda` y de que **no** aparece en los demás-; y sin gráfica de
  líneas. No las trato como defectos; están donde se dijo.

---

## 6. Qué falta para que esto sea `OK`

1. Cerrar **BLOQUEANTE-1**: censo de fuente para R3 en el guard existente y corregir la fila
   R3 del mapa de la bitácora.
2. Recomendado en el mismo paso (menores 1 y 2): dos aserciones más -el total del panel por
   método y los totales de fila de conciliación- que cierran los otros dos supervivientes.
3. Recomendado: corregir `design.md` seccion 5 (menor-4).
4. Leader: T6.2 (`./init.sh` completo donde haya `.env`), T6.3 (merge y PR), entrada en
   `progress/history.md` y estado en `feature_list.json`.
