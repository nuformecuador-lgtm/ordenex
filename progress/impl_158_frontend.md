# Feature 158 — Implementación frontend, camino del MENSAJERO (Fase 2, T2.1–T2.6)

> Rama `feature/158-incidente-indemnizacion`, worktree `.claude/worktrees/lote-135`.
> Alcance: **T2.1 a T2.6** — frontend del camino del **MENSAJERO** (parte visible de R1–R36),
> dentro del **PR 1 de 2** decidido por el humano (Q-L).
> Fase anterior: **`progress/impl_158_backend.md`** (T1.1–T1.18).
> **NO se tocó** la Fase 2B (T2.7–T2.10, camino del ADMIN), ni backend (`lib/services`,
> `lib/repositories`, `lib/actions`, `db/`), ni `lib/auth/menu-visibility.ts`.

## Veredicto

**Fase 2 verde, con UNA task incompleta y declarada.** `./init.sh` OK:
**615 archivos / 6892 tests / 0 fallos**, lint **0 errores / 19 warnings** (los mismos 19 del
baseline). Delta sobre el baseline de la fase backend (610 / 6829): **+5 archivos de test,
+63 tests, 0 fallos, 0 warnings nuevos**.

**T2.3 queda SIN marcar**: dos de sus cuatro columnas (causa tipificada y monto de la
indemnización) no se pueden pintar porque **no viajan en el DTO** y poblarlas es trabajo de
backend. Detalle y candado en §5.

---

## 1. Qué se hizo, por task

### T2.1 — Panel del mensajero ✅

`app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx` +
`app/(app)/mis-asignaciones/_components/causa-incidente-options.ts` (nuevo).

- **`type Resultado`** gana `incidente` y `RESULTADO_BOTONES` su quinta entrada, marcada
  `aparte: true`. La grilla de desenlaces pinta `RESULTADO_BOTONES_NORMALES`; el incidente va
  **bajo un separador**, en su propio `role="group"` («Reportar un incidente con el paquete»),
  con borde punteado, tono de alerta y **un aviso en TEXTO** («El paquete ya no se puede
  entregar ni devolver: está dañado, perdido o robado»). La diferencia no se comunica sólo por
  color.
- **`causa-incidente-options.ts`**, hermano exacto de `causa-devolucion-options.ts` (73):
  `Record<CausaIncidente, string>` derivado del SEED. Etiquetas **con su acentuación**
  (`danado` → «Paquete dañado»); el value crudo del enum no se pinta nunca.
- **`CausaIncidenteField`**: radios (las 3 visibles de una, móvil-first, sin dropdown que
  abrir en la calle), calcado de `CausaField`. Vive en el mismo archivo, como sus hermanos
  (un solo consumidor, `docs/architecture.md` «sin sobre-ingeniería»).
- **`buildRaw` / `buildFormData`**: rama `incidente` con `causaIncidente` + `motivo` +
  `evidencias`. **Sin campos de recaudo**: al ser `discriminatedUnion` no existen en esta rama.
- **Copy de la evidencia (Q-B)**, que es el punto donde la decisión del humano duele: la foto
  se exige también en `perdido` y `robado`. En vez de un «campo requerido» seco, el campo lleva
  ayuda accesible (`aria-describedby`) que dice **qué fotografiar cuando no hay paquete**: el
  compartimento o el vehículo vacío, la guía o la etiqueta, el lugar del hecho, o la denuncia.
  `EvidenciasField` gana una prop `ayuda` **opcional** → las otras tres ramas no cambian.
- **El gate de verificación de guía (98) NO se tocó**: sigue siendo la puerta de entrada al
  paso de resultados, así que también gobierna el incidente (R12).

### T2.2 — Detalle del cierre del MENSAJERO ✅

`app/(app)/cierre-dia/_components/CierreDiaModule.tsx`.

- `incidente` entra en `ORDEN_RESULTADOS`, **al final**.
- Rama propia en `columnasPara`: comunes + motivo + evidencia firmada + acciones.
  **Cero columnas de dinero** (R17 / design §7.2): el snapshot de un incidente es `0.00` y
  pintarlo se leería como «me pagaron cero por esto»; la indemnización es plata de la tienda,
  no del mensajero.
- **Sí conserva «Devolver a gestión»** (Q-D/R14): un incidente se deshace por la misma vía que
  el resto mientras no esté vinculado a un cierre.
- La columna de evidencia se extrae a `columnaEvidencia` y la comparten `rechazada` e
  `incidente` (mismo render, sin duplicar).

### T2.3 — Detalle del cierre del ADMIN ⚠️ **PARCIAL (casilla SIN marcar)**

`app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`.

- `incidente` entra en `ORDEN_RESULTADOS`, al final.
- Rama propia en `columnasPara`: comunes + «A cobrar» + motivo + evidencia firmada. Fuera
  quedan, a propósito, las columnas de un rechazo (origen SLA/manual, conceptos de ingreso de
  Ordenex, pago al mensajero, ingreso de bodega): un incidente no deriva ninguno y serían «—»
  en todas las filas.
- La columna de evidencia se extrae a `COLUMNA_EVIDENCIA`, compartida con `rechazada`.
- **Lo que falta y por qué: ver §5.**

### T2.4 — Sub-modal de captura al aprobar ✅

`app/(app)/cierres-admin/_components/CierresAdminModule.tsx`.

- «Aprobar» abre el sub-modal **sólo si el detalle trae incidentes**; si no, aprueba directo
  con el **mismo payload `{ cierreId }`** de la 38 (R36 — el test de la 38 que lo fija sigue
  intacto y lo caza una mutación, ver §4).
- Una fila por incidente con la identificación de la orden (remisión · destinatario, Nº guía ·
  tienda · motivo) y su `Input` de monto, espejo del sub-modal de rechazo (`:471`).
- **Confirmar deshabilitado** mientras falte o sea inválido algún monto, con el **mismo
  criterio que el servidor**: `montoValido` de `wallet-labels` (> 0, hasta 2 decimales, sin
  `parseFloat`). Y el bloqueo se explica **con texto**, no sólo con un botón apagado.
- Los montos viajan **STRING tal cual** (sólo `.trim()`) en `{ cierreId, indemnizaciones }`.
- Los `validation_error` del servidor llegan con **clave = `gestionId`**
  (`CierresAdminService.validarCoberturaIndemnizaciones`) y se pintan **por fila**; el
  sub-modal **sigue abierto** (cerrarlo obligaría a recapturar todo) y teclear limpia el error
  de **esa** fila. Un `conflict`/`forbidden`/`no_encontrada` sigue el camino de la 38.
- Cerrar el detalle descarta los montos: reabrir otro cierre no hereda nada.

### T2.5 — Wallet ✅

`app/(app)/wallet/_components/DesgloseEgresosCard.tsx` (+ el test de la 45).

- **Se cierra el copy que la fase backend dejó INEXACTO a propósito.** La tarjeta se titulaba
  «Egresos administrativos» y eso era cierto mientras sus tres conceptos lo fueran. La
  indemnización por incidente es un egreso **OPERATIVO**: con la fila nueva dentro, el rótulo
  pasaba a ser falso, y encima falso sobre dinero.
  → Título **«Egresos»** + una línea de descripción que dice **qué entra** (gastos, sueldos e
  indemnizaciones del conjunto filtrado) **y qué no** (los pagos a tiendas y a mensajeros).
  Lo segundo **tampoco se decía antes**: la tarjeta nunca fue el total de todos los egresos de
  la caja, y ahora está escrito.
- El nombre accesible del grupo pasa a «Desglose de egresos». `wallet-labels.ts` y la fila del
  desglose ya venían de la fase backend; aquí se completa la superficie y sus tests.

### T2.6 — Cierre de fase ⚠️ **SIN marcar** (ver §5)

`./init.sh` verde con los tests de componente incluidos, y el mapa R→test de abajo completo.
La casilla no se marca porque **T2.3, de la que depende, está incompleta**.

---

## 2. Mapa R → test (la parte que aporta esta fase)

> Rutas relativas a la raíz. Los R que la fase backend ya cubrió están en
> `progress/impl_158_backend.md` §2; aquí van **los que llegaban sin test** (R12, R33, R34) y
> **la mitad de componente** de los que llegaban a medias (R31, R32), más lo visible de
> R1–R36 que esta fase toca.

| R | Test(s) de esta fase |
| --- | --- |
| **R12** *(llegaba SIN test)* | `tests/components/GestionarOrdenPanelIncidente.test.tsx` › bloque «R12 — el gate de verificación de guía sigue siendo la puerta…» (3 casos: sin verificar no hay ningún resultado **ni el incidente**; guía que no coincide → no se fija el puntero; guía correcta → el incidente queda disponible) |
| **R33** *(llegaba SIN test)* | `…/GestionarOrdenPanelIncidente.test.tsx` › bloque «R33 — la opción existe y está DIFERENCIADA» (3 casos) · bloque «R33 — el envío válido manda el FormData esperado» (2 casos) · bloque «R33 — cliente y servidor validan con el MISMO esquema» (1 caso estructural: los dos importan `gestionarSchema` del mismo módulo y el panel **no** define un schema paralelo) |
| **R34** *(llegaba SIN test)* | `tests/components/CierresAdminIndemnizacion.test.tsx` › bloque «R34 — con incidentes, aprobar pasa SIEMPRE por la captura» (6 casos + `it.each` de 7 montos inválidos) y «R34 — cerrar y reabrir no arrastra montos» (1 caso) |
| **R31** *(mitad de componente)* | `tests/unit/components/wallet-indemnizacion-libro.test.tsx` › «R31 — el concepto tiene etiqueta legible en el libro» (3 casos) y «R31 — el concepto es una opción del filtro por categoría» (3 casos, abriendo el `Select` de verdad) |
| **R32** *(mitad de componente)* | `tests/unit/components/wallet-desglose-egresos-card.test.tsx` › «Feature 158/R32 — la indemnización es una fila propia y suma al total» (3 casos) + «el copy del título deja de decir 'administrativos'» (2 casos) |
| **R30** *(refuerzo visible)* | `…/wallet-indemnizacion-libro.test.tsx` › «R30 — la indemnización NO ofrece reversa en el libro» (el backend lo tenía por servicio; aquí se fija que la UI **tampoco** ofrece el botón) |
| **R9** *(superficie)* | `…/GestionarOrdenPanelIncidente.test.tsx` › bloque «R9 — la causa es una lista CERRADA de 3, con etiqueta en español» (4 casos: las 3 del SEED con etiqueta acentuada y sin slug; sin causa no se envía; no se arrastra al cambiar de resultado; no aparece en las otras 4 ramas) |
| **R10 (Q-B)** *(superficie)* | `…/GestionarOrdenPanelIncidente.test.tsx` › bloque «R10 (Q-B) — la foto se exige en las TRES causas» (`it.each` de las 3 causas + el caso del **copy**, que exige que nombre alternativas concretas cuando no hay paquete, + 1..N fotos) |
| **R11** *(superficie)* | `…/GestionarOrdenPanelIncidente.test.tsx` › «R11 — sin motivo NO llama a la action…» |
| **R17** *(superficie)* | `tests/components/CierreDiaModuleIncidente.test.tsx` › «la tabla de incidentes NO tiene columna de ganancia ni de ningún monto» · `tests/components/CierreDetalleIncidente.test.tsx` › «sin origen SLA/manual, sin conceptos de ingreso, sin pago ni ingreso de bodega» |
| **R18** *(superficie, los DOS detalles)* | `tests/components/CierreDiaModuleIncidente.test.tsx` › bloque «R18 — el incidente es un grupo PROPIO del detalle del mensajero» (4 casos) · `tests/components/CierreDetalleIncidente.test.tsx` › bloque «R18 — `incidente` es un grupo propio del detalle de admin» (4 casos) |
| **R14 / Q-D** *(superficie)* | `tests/components/CierreDiaModuleIncidente.test.tsx` › «Q-D/R14 — un incidente SE PUEDE deshacer desde el detalle» |
| **R19/R20/R21** *(superficie)* | `tests/components/CierresAdminIndemnizacion.test.tsx` › «no deja confirmar mientras falte algún monto», `it.each` de montos inválidos, y bloque «R19/R21 — los errores del servidor se pintan POR FILA» (3 casos) |
| **R24** *(superficie)* | `…/CierresAdminIndemnizacion.test.tsx` › «envía … con los montos TAL CUAL (STRING)» + «un monto con espacios sobrantes se envía recortado, no re-formateado» · `…/wallet-desglose-egresos-card.test.tsx` › «un monto con muchos decimales o muy grande se muestra sin reformatear» |
| **R35** *(no regresión)* | `tests/components/CierreDiaModuleIncidente.test.tsx` › «la sección de una ENTREGA sí conserva sus columnas de dinero» · `tests/components/CierreDetalleIncidente.test.tsx` › «un RECHAZO conserva exactamente sus columnas» + «los cuatro previos conservan su orden exacto» · `…/GestionarOrdenPanelIncidente.test.tsx` › «el selector de causa del incidente NO aparece en los otros cuatro resultados» · **la suite de componente completa en verde sin tocar las expectativas de los 4 resultados previos** |
| **R36** *(no regresión)* | `tests/components/CierresAdminIndemnizacion.test.tsx` › «R36 — un cierre SIN incidentes se aprueba exactamente como hoy» (afirma que las claves del payload son **exactamente** `["cierreId"]`) · `tests/components/CierresAdminModule.test.tsx` › «R10: aprobar llama a aprobarCierre…» (el test de la 38, **intacto**) |

**Con esto, R1–R36 quedan todos con test concreto.** Los tres que llegaban sin cobertura
(R12, R33, R34) son ahora los mejor cubiertos de la fase. La única salvedad que sigue viva es
**R29**, que pide «exactamente DOS» emisores y en este PR hay **UNO** — está declarada por la
fase backend (`impl_158_backend.md` §6) y no cambia aquí.

---

## 3. Verificación por mutación

Todas en memoria; los archivos se restauraron (`git status` limpio antes de cada commit).

| # | mutación | resultado |
| --- | --- | --- |
| A | el panel se salta la validación en cliente **sólo** para `incidente` | **5 rojos** (sin causa, sin foto ×3 causas, sin motivo) |
| B | el incidente vuelve a la grilla de desenlaces normales (`aparte` fuera) | 1 rojo («vive FUERA del bloque de desenlaces normales») |
| C | el panel arranca en «resultados» (se salta el gate de guía) | **3 rojos** (los tres de R12) |
| D | el copy de la foto se degrada a «La foto de evidencia es obligatoria.» | 1 rojo (el caso que exige que el copy nombre qué fotografiar) |
| E | el `FormData` manda la **etiqueta** en vez del value del enum | 1 rojo |
| F | `incidente` sale de `ORDEN_RESULTADOS` del detalle del mensajero | **5 rojos** |
| G | el detalle del mensajero deja caer el incidente en la rama por defecto (con columnas de dinero) | 1 rojo |
| H | el incidente pierde la columna de acciones (no se puede deshacer) | 1 rojo |
| I | `incidente` sale de `ORDEN_RESULTADOS` del detalle de admin | 4 rojos |
| J | el detalle de admin deja caer el incidente en la rama del rechazo | 2 rojos |
| K | la etiqueta del grupo pasa a ser el slug (`"incidente"`) | 4 rojos |
| L | **el DTO gana `causaIncidente`** | **el BUILD rompe** (`tests/components/CierreDetalleIncidente.test.tsx: Type 'true' is not assignable to type 'never'`) — es el candado de §5 |
| M | «Aprobar» vuelve a aprobar directo (sin sub-modal) | **16 rojos** |
| N | el confirmar deja de guardarse con `montoValido` (sólo «no vacío») | **6 rojos** (los 6 montos inválidos que no son la cadena vacía) |
| O | el payload manda **siempre** `indemnizaciones` (rompe R36) | 2 rojos, **uno de ellos el test de la 38** |
| P | el monto se envía con `parseFloat` | 2 rojos |
| Q | los `fieldErrors` del servidor se tratan como error genérico | 2 rojos |
| R | el título de la tarjeta vuelve a «Egresos administrativos» | 1 rojo |
| S | se cae la fila «Indemnizaciones» del desglose | 2 rojos |
| T | la etiqueta de la categoría pasa a ser el slug | 4 rojos |
| U | la reversa deja de exigir `origen_tipo = "gasto"` | 1 rojo |
| V | el desglose parsea el monto con `parseFloat` | 1 rojo |

### La mutación que NO discriminó, dicha porque cambia lo que estos tests significan

**Mutación descartada:** hacer que la rama `incidente` mande `evidencias: undefined` cuando la
lista está vacía. **Los 19 casos siguieron en verde.** La razón es correcta y conviene tenerla
escrita: la regla «1..N obligatoria» **no vive en el componente**, vive en `evidenciasSchema`
(`lib/types/gestion-orden.ts`) y la protegen los tests de la fase backend (R10). Lo que los
tests de componente protegen es otra cosa, y es lo que **sí** se puede romper desde el
frontend: que el panel **valide con ese schema antes de llamar a la action** (mutación A: 5
rojos) y que el selector de fotos **exista** en la rama. No se afirma más que eso.

---

## 4. Tests de otras features que esta fase tocó

**Ninguno se borró ni se debilitó.** Uno se actualizó:

| archivo | afirmaba | ahora afirma | por qué |
| --- | --- | --- | --- |
| `tests/unit/components/wallet-desglose-egresos-card.test.tsx` (feature 45) | la tarjeta se titula «Egresos administrativos» y su grupo se llama «Desglose de egresos administrativos» | lo mismo sobre el copy corregido («Egresos» / «Desglose de egresos»), **y 4 casos nuevos** (fila de la indemnización, total que llega del servidor, money-safe con montos grandes, y que el título viejo **ya no aparece**) | el copy viejo se volvió **falso** al entrar la indemnización, que es un egreso operativo. El invariante que el test protegía (la tarjeta muestra sus conceptos y su total, money-safe) sigue protegido con **más** fuerza que antes |

El test de la 38 (`CierresAdminModule.test.tsx` › «R10: aprobar llama a aprobarCierre…`) **no
se tocó**: sigue exigiendo el payload `{ cierreId }` exacto, y es justamente el que caza la
mutación O.

---

## 5. Lo que NO se hizo, con su razón

### T2.3 — casilla SIN marcar (las dos columnas que faltan)

`tasks.md` T2.3 pide para el grupo `incidente` «causa, motivo, evidencias, **monto** o `—`».
Se hicieron **motivo y evidencias** (+ «A cobrar»). **Causa y monto NO se pintan**, y no es un
olvido:

- **El dato no llega.** `CierreDetalleGestion`
  (`lib/interfaces/services/ICierreDiaService.ts`) **no expone** `causaIncidente` ni
  `indemnizacion`. No es una carencia de esta feature: tampoco expone la `causaDevolucion` de
  la 73, así que el detalle del cierre **nunca** ha mostrado la causa tipificada de ninguna
  gestión. Ese es el estado del **código**, que es la fuente de verdad cuando la spec y el
  código se contradicen.
- **Traerlo es backend.** Exige tocar el DTO, el `select` de `CierresAdminRepository` y el
  mapper `toDetalleDTO` (`lib/services/CierreDiaService.ts`). La instrucción de esta fase es
  explícita: no tocar `lib/services`, `lib/repositories`, `lib/actions` ni `db/`, y **parar y
  decirlo** si una task lo necesita. Es lo que se hace aquí.
- **No se disimula con un «—».** Un guion en la columna se lee como «este incidente no tiene
  causa», que es falso: la causa **está persistida** (`gestion_orden.causa_incidente`, T1.2) y
  el monto también tras aprobar. Pintar «—» sería mentir sobre un dato que existe.
- **El hueco queda cerrado con un candado que rompe el build**, no con un comentario:

  ```ts
  // tests/components/CierreDetalleIncidente.test.tsx
  type _SinCausaEnElDto = "causaIncidente" extends keyof CierreDetalleGestion ? never : true;
  type _SinMontoEnElDto = "indemnizacion" extends keyof CierreDetalleGestion ? never : true;
  ```

  El día que el DTO gane cualquiera de los dos campos, `pnpm run typecheck` —que corre en
  `./init.sh`— **falla**, y quien lo añada tiene que completar las columnas. **Verificado por
  mutación** (§3, mutación L).

**Trabajo pendiente concreto, para quien lo retome:** añadir `causaIncidente` y
`indemnizacion` a `CierreDetalleGestion`, poblarlos en el `select`/mapper del repo de admin, y
entonces añadir las dos columnas (la de monto con `money()`, `null` → `—` mientras el cierre
no esté aprobado). Es media hora de backend y diez minutos de frontend; lo que no se puede es
hacerlo desde aquí sin saltarse la instrucción.

### T2.6 — casilla SIN marcar

`./init.sh` está **verde** y el mapa R→test de R1–R36 está **completo** (§2), que son sus dos
condiciones. Pero T2.6 declara `Depende de: T2.1-T2.5` y **T2.3 está incompleta**, así que
marcarla afirmaría que la fase cerró. No cerró. La casilla es del leader cuando T2.3 lo esté.

### Tasks que no son de esta fase

- **T2.7–T2.10 (Fase 2B, camino del ADMIN)** — fuera de alcance por instrucción explícita del
  humano (Q-L, dos PRs). En concreto y a propósito: **no** existe
  `app/(app)/ordenes/_components/ReportarIncidenteModal.tsx`, **no** existe
  `app/(app)/incidentes/`, y **no** se tocó `lib/auth/menu-visibility.ts`.
- **T1.19–T1.32 (Fase 1B)** — backend del camino del admin, PR 2.
- **T3.1 (humo manual del camino del mensajero)** — la UI ya existe, pero la prueba de humo
  exige correr la app contra la base y **operar de verdad** (reportar, deshacer, cerrar,
  aprobar y mirar la wallet). No se hizo aquí: no es algo que este agente pueda «declarar»
  sin ejecutarlo. Queda para el humano o para quien tenga el entorno levantado.
- **T3.3/T3.4/T3.5** — round-trip de migraciones, `feature_list.json` y follow-ups: del leader.

### Decisiones tomadas donde el spec no llegaba

- **Etiquetas de la causa.** El spec fija los values (`danado`/`perdido`/`robado`) y deja las
  etiquetas al frontend. Se eligió **«Paquete dañado» / «Paquete perdido» / «Paquete robado»**
  en vez de «Dañado/Perdido/Robado» a secas: el radiogroup se titula «Causa del incidente» y
  el sujeto explícito evita que se lea como el estado de la **entrega**.
- **Payload sin incidentes.** Con cero incidentes se manda `{ cierreId }` **sin** la clave
  `indemnizaciones`, aunque el schema tenga `.default([])`. Es lo que R36 pide literalmente
  («sin campos nuevos») y lo que el test de la 38 ya fijaba. Mandar `indemnizaciones: []`
  habría funcionado igual en el servidor y habría roto ese test: se prefirió no tocarlo.
- **Orden del grupo `incidente`.** Al final de las secciones, en los dos detalles. El spec no
  lo fija; se eligió el mismo criterio que en el panel (no es un desenlace más de la entrega).
- **Título de la tarjeta de la wallet.** El design decía «"Egresos" o similar». Se eligió
  «Egresos» **+ una descripción explícita de qué no incluye**, porque «Total de egresos» a
  secas seguiría siendo inexacto: la tarjeta nunca sumó los pagos a tiendas ni a mensajeros.

### Preguntas abiertas que deja esta fase

1. **¿Se muestran la causa y el monto en el detalle del cierre?** (la deuda de T2.3). El spec
   dice que sí; el código no lo permite todavía. **Necesita decisión + backend.**
2. **La causa tampoco se ve en el detalle del MENSAJERO** (T2.2), por el mismo motivo. Ahí el
   spec no la pedía explícitamente, pero es la misma carencia del DTO.
3. **Flake conocido de la suite de componentes.** En una corrida de `tests/components/` un
   archivo cayó por timeout bajo carga y pasó al repetir (es el fenómeno que documenta
   `vitest.config.ts:8-17`). `./init.sh` completo pasó a la primera. No se cambió el timeout.

---

## 6. Salida real de la verificación

```
$ ./init.sh
== Arnes SDD :: init ==
✓ node
✓ dependencias presentes
✓ regla max-2-por-zona respetada
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 19 problems (0 errors, 19 warnings)
✓ lint paso
-> pnpm run test
 Test Files  615 passed (615)
      Tests  6892 passed (6892)
   Duration  165.50s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline al empezar (cierre de la fase backend): **610 archivos / 6829 tests**, lint 0 errores
/ 19 warnings. **Delta: +5 archivos de test, +63 tests, 0 fallos, 0 warnings nuevos.**

---

## 7. Archivos creados / modificados

### Creados (6)

```
app/(app)/mis-asignaciones/_components/causa-incidente-options.ts
tests/components/GestionarOrdenPanelIncidente.test.tsx
tests/components/CierreDiaModuleIncidente.test.tsx
tests/components/CierreDetalleIncidente.test.tsx
tests/components/CierresAdminIndemnizacion.test.tsx
tests/unit/components/wallet-indemnizacion-libro.test.tsx
```

### Modificados — producción (4)

```
app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx
app/(app)/cierre-dia/_components/CierreDiaModule.tsx
app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx
app/(app)/cierres-admin/_components/CierresAdminModule.tsx
app/(app)/wallet/_components/DesgloseEgresosCard.tsx
```

*(`wallet-labels.ts` **no** se tocó en esta fase: su entrada de `CATEGORIA_LABEL` ya la puso la
fase backend por exhaustividad, y era correcta.)*

### Modificados — tests (1)

```
tests/unit/components/wallet-desglose-egresos-card.test.tsx   ← copy corregido + 4 casos nuevos
```

---

## 8. Commits

```
b7d1c13  feat(158…): quinta opcion "Reportar incidente" en el panel del mensajero      (T2.1)
5c9f445  feat(158…): grupo "Incidentes" en el detalle del cierre del mensajero          (T2.2)
4175074  feat(158…): grupo "Incidentes" en el detalle del cierre del admin              (T2.3, parcial)
35384ad  feat(158…): sub-modal de captura del monto al aprobar el cierre                (T2.4)
15b25d3  feat(158…): la indemnizacion en la superficie visible de la wallet             (T2.5)
```

**No se hizo `git push` ni se abrió PR**: lo decide el humano.
