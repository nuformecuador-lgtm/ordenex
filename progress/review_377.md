# Review — ficha 377 «una orden en bodega satélite puede quedarse sin dueño al cambiar de zona»

Reviewer (arnés SDD). Rama: `fix/377-bodega-satelite-sin-dueno`. HEAD revisado: **`0baaf518`**.
Base: `dev` (`988c1345`). Fecha: **2026-09-07**. PR #726.

## Veredicto: **OK** — 0 bloqueantes, 9 hallazgos menores

Todo lo de abajo se midió en este worktree, con `.env` copiado de la raíz y `node_modules` propio
(`pnpm install --frozen-lockfile` + `prisma generate`, ambos aislados de la raíz). No se tocó la
base más allá de lo que hacen los tests, que corren dentro de transacciones revertidas.

---

## 1. Gate ejecutable — reproducido, no creído

`./init.sh` completo, corrido por mí sobre el árbol limpio de `0baaf518`:

| medida | valor leído DENTRO del log |
| --- | --- |
| `INIT_EXIT` | **0** (línea 12006; no el exit code del shell) |
| archivos | **1770 passed (1770)** |
| tests | **25 295 passed, 26 skipped (25 321)** |
| skipped | 17 en `AnaliticaPage.test.tsx` + 9 en `AnaliticaShell.test.tsx` — **preexistentes y ajenos**, los únicos dos archivos con `skipped` en todo el log |
| Postgres | `DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan` (línea 332). **Cero saltados en `integration/db`** |
| baseline | `tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1770 ejecutado(s))` |
| typecheck | limpio |
| lint | `157 problems (0 errors, 157 warnings)` — todas preexistentes |

Coincide **exactamente** con lo que declara `progress/impl_377-bodega-satelite-sin-dueno.md`
(25 295 tests, 26 skipped, 1770 archivos, 132 archivos contra Postgres). El archivo de la ficha
corrió de verdad: `tests/integration/db/zona-reconciliacion-ordenes.test.ts (28 tests) 2338ms`.

## 2. Lo que NO se podía haber roto — la reconciliación EN TRÁNSITO. Medido.

Mutación pedida: invertir el corte (`notIn` → `in`) en `lib/repositories/ZonaRepository.ts:464`.
Ejecutada por mí sobre `tests/integration/db/zona-reconciliacion-ordenes.test.ts` +
`tests/unit/repositories/zona-repository.test.ts`:

> **`Tests  24 failed | 55 passed (79)` — 24 rojos, el número exacto que declara el implementador.**

Y entre los 24 está, literalmente:

```
× ⭑ 377/R3: una orden EN TRANSITO a una satelite SI se reconcilia (la 366, intacta)
```

**La reconciliación de `en_ruta_bodega_satelite` sigue viva y sigue defendida por un test que se
cae si alguien la apaga.** El atasco medido de la 366 (41 de 42 órdenes represadas el 2026-09-03)
no se deshizo.

Reparto real de los 24 rojos: **14 casos de la 366** + **9 de la 377** + **1 unit**
(«⭑ R2/R9: las dos consultas comparten el where base»). El implementador escribió «11 de la 366 y
8 de la 377» (= 19): el **total coincide**, el desglose no (menor-3).

### Las otras mutaciones, ejecutadas y revertidas

| Mutación | Rojos medidos por mí | Declarado | Casos que caen |
| --- | --- | --- | --- |
| `notIn` → `in` en el `findMany` | **24** | 24 | 366 (14) + 377 (9) + unit (1); **incluye 377/R3** |
| quitar `estatus.value notIn ESTANTE` del `findMany` | **6** | 6 | `377/R2/R6`, `377/R9`, `377/R7`, `377/R12`, `377/R1`, unit `R2/R9` |
| Q3: apagar el `if` del gate (`false && …`) | **3** | 3 | los tres de R15, exactamente |
| Q3: quitar `&& distrito.zonaId !== orden.zonaId` | **1** | 1 | «corregir el distrito DENTRO de la misma zona sigue permitido» (R16) |
| M3: guarda `> 0` → `>= 0` en `mensajeGuardado` | **2** | 2 | los dos de R10 |
| M6a sola (leer el campo también al crear) | **0** (11/11 verde) | 0 | — |
| M6b sola (frase antes del `esEditar`) | **0** (11/11 verde) | 0 | — |
| **M6a + M6b juntas** | **1** | 1 | «⭑ R13: crear zona no pinta el conteo aunque la respuesta lo trajera» |

**El «hallazgo honesto» del implementador es CIERTO y lo reproduje**: el caso de R13 no cae con
ninguna mutación de un solo punto —ni romper la rama de crear, ni romper el corte de `esEditar`—;
solo cae con las dos a la vez. Quien lea ese test que no le pida más de lo que da.

Tras cada mutación se restauró el archivo. `git status --short` y `git diff --stat` al terminar:
**vacíos**. Re-corrida de los 6 archivos tocados por la ficha: `6 passed / 147 tests passed`.

## 3. Trazabilidad R<n> → test — abierta y comprobada uno a uno

Los 16 títulos citados en la tabla de `tasks.md` **existen** en el árbol, se ejecutan en el gate y
afirman lo que dicen. No hay ninguno vacío ni auto-aprobatorio.

| R | Test | ¿existe? | ¿mide lo que dice? |
| --- | --- | --- | --- |
| R1 | `db/zona` «⭑ 377/R1: la bodega que TIENE el paquete lo sigue viendo…» | sí (línea 1140) | sí — ejercita el SQL real de `condicionesSatelite` vía `findRecepcionSatelitePaginada` en A y en B, y afirma `zonaId === A`, que es lo que compara `AsignacionSateliteService` antes de decir `zona_ajena`. Cae con las 2 mutaciones del `WHERE` |
| R2 | `db/zona` «⭑ 377/R2/R6…» | sí (789) | sí — con una orden ANTI-VACUIDAD (`en_bodega_central` del mismo distrito) que SÍ se mueve |
| R3 | `db/zona` «⭑ 377/R3…» | sí (834) | sí — **cae con la inversión del corte** |
| R4 | `db/zona` «⭑ 377/R4: cuenta el estado ACTUAL, no el historico» | sí (903) | sí — siembra `orden_historial_estado` con destino `en_bodega_satelite` y estado actual `en_reparto`; distingue `ESTADOS_PAQUETE_EN_ESTANTE` de `ESTADOS_CUSTODIA_SATELITE` |
| R5 | `db/zona` «⭑ 377/R5…» + los casos de la 366 | sí (863) | sí — gestión vigente `entregada` fuera del estante sigue sin moverse **y sin contar como retenida** |
| R6 | «⭑ 377/R2/R6…» + `unit/repo` «⭑ R8…» | sí | sí — `historialEnEstante` `toEqual([])` y `historialAccion.createMany` no llamado |
| R7 | `db/zona` «⭑ 377/R7: DISJUNTOS» + `unit/repo` «⭑ R7…ACUMULA» + `unit/svc` | sí | sí — 2 movidas / 3 retenidas con números distintos entre sí, y acumulación 1+3 / 2+5 por grupo |
| R8 | `db/zona` + `action` + **3 casos `form`** | sí | sí — el toast se compara con **texto literal**, nunca contra `mensajeGuardado` |
| R9 | `db/zona` «⭑ 377/R9…» (4 sub-casos) + `unit/repo` «⭑ R2/R9» | sí (936) | sí — 4 órdenes en estante, solo 1 cuenta |
| R10 | `db/zona` + `unit/svc` + 2 casos `form` | sí | sí — cae con M3 |
| R11 | `db/zona` «⭑ 377/R2/R6» + `form` «⭑ R11…» | sí (319) | sí — un solo clic, `onSaved` una vez, `queryByRole("dialog")` null |
| R12 | `db/zona` «⭑ 377/R12…» | sí (1068) | sí — segunda llamada `{reconciliadas: 0, retenidas: 1}` y el historial no crece |
| R13 | `db/zona` + `unit/repo` + `form` | sí | sí — **con la salvedad medida de M6** (ver §2) |
| R14 | `estados-bodega-satelite.test.ts` + inventario de transiciones, verdes **sin aparecer en el diff** | sí | sí, por construcción: `lib/types/order-status-transiciones.ts` no está en el diff |
| **R15** | `unit/q3` × 3 | sí (135, 146, 161) | sí — cae con «apagar el gate»: 3 rojos exactos |
| **R16** | `unit/q3` × 2 | sí (195, 213) | sí — cae con «quitar la comparación de zona»: 1 rojo exacto |

### Juicio sobre R15 y R16 (los que añadió el implementador)

**Describen lo que el código hace, y no son un requisito escrito para tapar el código a posteriori.**
Razones, en orden de peso:

1. **No nacen de la nada: nacen de Q3**, que ya estaba planteada en el `requirements.md` aprobado,
   con sus tres salidas enumeradas (i/ii/iii). R15 es la salida (iii) acotada y R16 es precisamente
   la acotación. No hay requisito nuevo: hay una pregunta abierta cerrada.
2. **Son verificables y están verificados con mutación**, no con un test de acompañamiento: apagar
   el gate mata 3 casos, quitar la comparación de zona mata 1. Un requisito de coartada no suele
   sobrevivir a que le maten el código.
3. **R16 es la mitad cara**: prohíbe la solución fácil (meter `en_bodega_satelite` en
   `ESTADOS_SIN_CORRECCION`) y la deja medida. Un requisito escrito para justificar no se pone
   restricciones a sí mismo.

Lo reprochable es de **forma**, no de fondo: se añadieron a un `requirements.md` ya aprobado y el
`design.md` sigue diciendo lo contrario en dos sitios (menor-5). Y la redacción de R16 filtra el
nombre del mecanismo (`ESTADOS_SIN_CORRECCION`), que es detalle de diseño dentro de un requisito.

## 4. La segunda puerta (Q3) — la derogación, y el daño colateral que NO ocurre

**La derogación está justificada y escrita.** Aparece, con su vuelta atrás («un solo `if`»), en
cuatro sitios: `requirements.md` §Decisiones, `tasks.md` T10 (que dice literalmente «esta task los
deroga a propósito»), `progress/impl_…md` §Decisiones y un comentario de 30 líneas junto al propio
`if`. En los cuatro está marcada como **decisión del leader, NO firmada por el humano**. El
argumento —«un arreglo que cierra una de las dos puertas al mismo agujero no es un arreglo», y
avisar convierte un fallo mudo en uno consentido— es el mismo que el `design.md` §2 usa para
descartar la mitad bloqueante de la salida (c). No es una desviación silenciosa.

**El rechazo solo dispara cuando el cambio movería la zona. Comprobado leyendo el camino entero:**

- El gate vive **dentro** de `if (CAMPOS_GEOGRAFIA.some((campo) => cambios.includes(campo)))`
  (`CorregirDatosClienteService.ts:259`), y
  `CAMPOS_GEOGRAFIA = ["provinciaId", "cantonId", "distritoId"]`
  (`lib/types/correccion-datos-cliente.ts:63`). **La `direccion` NO está ahí** (vive en
  `CAMPOS_UBICACION`, que es otra lista y solo decide el rastro).
  ⇒ corregir **nombre, teléfono, producto, notas, peso o dirección** no entra al bloque, no
  consulta el catálogo de distritos y no puede disparar el rechazo. El test
  «⭑ corregir el nombre o el telefono … sigue permitido» lo afirma además con
  `expect(findDistritoParaCorreccion).not.toHaveBeenCalled()`.
- Dentro del bloque, la condición es
  `paqueteEnEstanteSatelite(orden.estatusValue) && distrito.zonaId !== orden.zonaId` (línea 331).
  Un distrito distinto que resuelve la MISMA zona pasa (test de R16).
- El rechazo es `rechazoDeUbicacion(...)` →
  `{ status: "validation_error", fieldErrors: { distritoId: [...] } }`, y **retorna antes** de
  `data.zonaId = distrito.zonaId` (342) y antes de `this.repo.corregirDatosCliente(...)` (375).
  **No escribe nada**, ni siquiera `updated_at`.
- Va **antes** del gate del dinero (350): no se ofrece confirmar lo que se va a rechazar igual.
- `ESTADOS_SIN_CORRECCION` no aparece en el diff; `lib/types/correccion-datos-cliente.ts` tampoco.

## 5. Compara zona DERIVADA vs. ESTAMPADA, no `cambios.includes("distritoId")`

Literal en el código: `distrito.zonaId !== orden.zonaId`. Y no es solo una lectura: la sustitución
por `cambios.includes("distritoId")` **también la mata el test de R16**, porque ese caso cambia el
distrito (d-1 → d-2) dentro de la misma zona y espera `ok`; con el `includes` el gate dispararía.
El escenario de la 366 —mismo distrito, otra zona resuelta hoy— queda cubierto por construcción: el
gate lee la zona que se iba a escribir, no el diff de campos.

## 6. El hueco de cobertura de la 366 — cerrado de verdad

- `crearOrden` acepta `estatusValue?: OrderStatusValue` y lo resuelve con
  `tx.orderStatus.findUniqueOrThrow` — **fallo ruidoso**, no un `?? FKS.estatusId` que sembraría el
  estado equivocado en verde, ni un `if (!x) return;`.
- **El eje se varía de verdad:** los 11 casos nuevos siembran `en_bodega_satelite`,
  `en_ruta_bodega_satelite`, `en_bodega_central` y `en_reparto`, y el caso de humo `377/T2` afirma
  DOS estados distintos más el fallback, así que un fixture que ignorase el parámetro se cae.
- **Los casos previos de la 366 están intactos.** El `git diff dev...HEAD` de ese archivo **borra
  exactamente dos líneas**, las dos del fixture (`crearOrden: async ({...})` y
  `estatusId: FKS.estatusId`). **Ni un `expect` tocado.** Verificado con `git diff … | grep "^-"`.
  ⚠️ Precisión: ese archivo en `dev` tiene **12** `it(` (19 llamadas a `crearOrden`), no 17. Lo
  cualitativo es cierto; el número que circula en `design.md` §8 y en el informe, no (menor-4).

## 7. Cobertura contra Postgres real (el corte vive en un `WHERE`)

- 11 casos nuevos en `tests/integration/db/zona-reconciliacion-ordenes.test.ts`, ejecutados de
  verdad (28 tests, 0 saltados, `DATABASE_URL resuelta` en el log).
- Las dos mutaciones del `WHERE` los ponen en rojo (6 y 24). El corte **no se puede quitar ni
  invertir en silencio**.
- El unit con dobles dice en su propia cabecera lo que NO prueba: «un `where` que no excluyera nada
  los dejaría a todos en verde». Eso es exactamente la honestidad que este repo pide.
- El `where` base está en **una sola declaración** (`whereBaseElegible`) que leen las dos consultas,
  y el unit «⭑ R2/R9» compara los dos `where` completos contra un literal escrito a mano —no una
  consulta contra la otra—, así que quitar cualquiera de los cuatro cortes de la 366 se cae.

## 8. Aserciones contra su propia fuente y tests que se auto-aprueban

- `mensajeGuardado` **no se importa en ningún test**: su única aparición en `tests/` es un
  comentario que explica por qué no se compara contra él. Los 7 casos nuevos del toast comparan
  cadenas literales completas con `toHaveBeenCalledWith`.
- No hay ningún `if (!x) return;` en los tests nuevos. El archivo de integración lo declara
  explícitamente («NADA DE `if (!fks) return;`») y usa `findUniqueOrThrow`.
- `describeSiHayBase` usa `describe.skip` **visible** si no hay base; en esta corrida no se saltó
  nada de `integration/db`.

## 9. El texto de antes de la ficha — contrastado contra `git show dev:`

`git show dev:app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx` da, para
`mensajeGuardado`, exactamente `"Zona creada"`, `"Zona actualizada"` y
`Zona actualizada (N orden reubicada | N órdenes reubicadas)`. La versión nueva devuelve **las
mismas tres cadenas** cuando `retenidas === 0` o al crear. El cambio de `if (reconciliadas <= 0)` a
`reconciliadas > 0 ? … : "Zona actualizada"` es equivalente para todo entero. Los 4 casos de la 366
en el test de componente están intactos: el único cambio del archivo es un tercer parámetro
**opcional con default** en `renderForm`.

## 10. Calidad, capas y seguridad

- **Capas:** la constante de dominio y el predicado viven en `lib/utils/estados-bodega-satelite.ts`
  (módulo puro, sin Prisma ni React); el corte, en el `WHERE` del repositorio; el gate de negocio,
  en el servicio; el service reenvía el número **sin interpretarlo**; la Server Action no cambió y
  el campo fluye tipado (el test de la action afirma `Object.keys(r).sort()`, así que un campo de
  más o de menos se cae). Sin `any` nuevo.
- **Sin migración, sin tablas, sin columnas, sin índices, sin RLS que revisar, sin `down.sql` que
  exigir.** `db/` no aparece en el diff.
- **Sin secretos, sin hardcode de país/moneda/cuenta, sin webhooks** (los checkpoints de firma e
  idempotencia no aplican).
- **E2E:** inaplicable — en este repo no hay harness de Playwright ejecutable y los specs previos lo
  declaran así. El riesgo queda cubierto por el caso `377/R1`, que ejercita el SQL real del listado
  de la bodega contra Postgres.
- **T8 (lo intocable):** ninguno de los cuatro archivos declarados en `design.md` §7 aparece en el
  diff, ni `order-status-transiciones.ts`, ni `AsignacionSateliteService`, ni
  `DeshacerAsignacionService`, ni `OrdenRepository`.
- **¿Hay una tercera puerta a `orden.zona_id`?** La busqué. `OrdenRepository.toUpdateData` (2055)
  sí proyecta `zonaId`, pero los consumidores vivos de `OrdenRepository.update`
  (`DevolucionOrigenService`, `EnvioDevolucionCentralService`) no lo informan, y `BulkOrdenService`
  solo lo estampa al **crear**. **No hay tercera puerta viva** que pueda orfanar una orden en
  estante.

---

## Checklist CHECKPOINTS.md

### Especificación
- [x] `specs/377-bodega-satelite-sin-dueno/requirements.md` con EARS numerados R1..R16.
- [x] `design.md` con alternativas descartadas y su porqué (7 en la tabla de §11).
- [ ] `tasks.md` con **todas** las tasks marcadas `[x]` — **NO**: T1–T6, T8 y T9 siguen en `[ ]`
      (menor-1). La tabla «Estado real» del mismo archivo las da por hechas y lo verifiqué yo.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto — los 16, abiertos y comprobados (§3).
- [x] `progress/impl_377-bodega-satelite-sin-dueno.md` contiene el mapa `R<n> → test`.

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (157 warnings preexistentes).
- [x] `pnpm test` verde: 1770/1770 archivos, 25 295 tests, 0 rojos nuevos sobre el baseline.
- [~] E2E en flujo crítico — **inaplicable** (sin harness). Cubierto por el caso de integración
      `377/R1` contra Postgres real.

### Datos y seguridad
- [x] RLS — no aplica: sin tablas nuevas.
- [x] Migraciones reversibles — no aplica: sin migraciones.
- [x] Sin secretos hardcodeados.
- [x] Webhooks — no aplica.

### Patrón de capas
- [x] Controller (Server Action) sin lógica ni queries: no cambió.
- [x] Service sin HTTP; reenvía el conteo sin interpretarlo.
- [x] Repository solo Prisma; la regla de dominio se importa del módulo puro.
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.

### Permisos
- [x] Sin cambios de autorización: `actualizar` sigue `maestro`-only; el gate de Q3 aplica a todos
      los roles que hoy pueden corregir, incluido el `adminTienda` sobre sus propias órdenes.

### Multi-país / configuración
- [x] Sin hardcode de país, moneda ni cuenta.

### Verificación final
- [x] `./init.sh` termina en verde (`INIT_EXIT=0`, leído dentro del log).
- [x] `progress/review_377.md` existe y su veredicto es OK.
- [ ] Entrada en `progress/history.md` — **falta** (menor-7; paso de cierre del leader).

---

## Hallazgos

### BLOQUEANTES

**Ninguno.**

### Menores

- **menor-1 — `tasks.md`: T1–T6, T8 y T9 siguen con `[ ]`.** CHECKPOINTS exige todas en `[x]` para
  pasar a `done`. Es contabilidad, no código: la tabla «Estado real» del mismo archivo las declara
  hechas y yo verifiqué el contenido de cada una. **Marcarlas antes de mover la ficha a `done`.**
- **menor-2 — la fila T9 de `tasks.md` está caducada.** Dice «NO hecha — es previa al despliegue»,
  cuando `impl_377…md` (sección del leader, al principio del archivo) documenta que T9 se midió el
  2026-09-07 contra producción: **37 en estante / 215 en tránsito / 0 desalineadas / 0 desalineadas
  EN EL ESTANTE**. Quien lea solo `tasks.md` se lleva el dato viejo.
- **menor-3 — desglose de la mutación inexacto.** El informe dice «11 de la 366 y 8 de la 377»; lo
  medido es 14 + 9 + 1 unit = **24**. El total (24) coincide; el reparto no. Vale la pena
  corregirlo: es la cifra con la que alguien decidirá si el corte está protegido.
- **menor-4 — «17 casos» de la 366 no es el número real.** `design.md` §8 y el informe hablan de
  17; el archivo en `dev` tiene **12** `it(` y 19 llamadas a `crearOrden`. La afirmación de fondo
  («ninguno variaba el estado», «no se tocó un `expect`») es correcta y está verificada.
- **menor-5 — el `design.md` quedó contradiciendo al `requirements.md`.** §7
  («`CorregirDatosClienteService` — ni una línea (Q3)») y §10 («Fuera de alcance …
  `CorregirDatosClienteService`») siguen diciendo lo contrario de lo que hace la rama. La
  derogación está escrita en otros cuatro sitios, pero no en el documento al que deroga. Una línea
  en `design.md` («derogado por T10, ver requirements §Decisiones») evita que el próximo lector
  concluya que se incumplió el diseño. **Y la decisión Q3 sigue SIN firma del humano**: la vuelta
  atrás está medida (un `if` en el paso 6) y hay 3+1 tests que caen si se quita.
- **menor-6 — falta el caso «corregir SOLO la dirección de una orden en estante».** Es correcto por
  construcción (`direccion` no está en `CAMPOS_GEOGRAFIA`, así que no re-deriva zona), pero la
  ficha nombra explícitamente la dirección entre lo que NO quería bloquear y ese camino no tiene
  aserción propia. Un test de dos líneas lo cerraría.
- **menor-7 — no hay entrada en `progress/history.md`** para la 377. Paso de cierre del leader.
- **menor-8 — `feature_list.json` en la rama sigue con `status: "pending"` para la 377.** Es
  coherente con la regla de no escribir la ficha desde dentro de una rama de agente; queda apuntado
  para que el leader la mueva **en `dev`**, no aquí.
- **menor-9 — el texto del rechazo de Q3 va sin tildes** («ya esta», «ahi», «sacaria», «podria»,
  «Despachala»). Lo ve un humano en el modal de corrección. No es una regresión —los otros cuatro
  rechazos del mismo método están igual— pero es el único texto de usuario que esta ficha estrena.

## Lo que está bien, dicho aparte para distinguirlo de «no mirado»

1. **El corte está en el sitio correcto y se puede matar.** Vive en el `WHERE`, no en un `filter`
   de JS, y hay dos mutaciones que lo demuestran contra Postgres real. Es exactamente lo que este
   repo lleva cuatro medidas pidiendo.
2. **El par de casos R2/R3 es la pieza clave y está completo.** Uno impide que el corte se quite,
   el otro que se invierta. Con uno solo, una mutación sobrevivía. Los dos existen y los dos caen.
3. **El fixture aprendió a variar el estado sin tocar un solo `expect` previo.** El diff del archivo
   de integración borra dos líneas y ninguna es una aserción. Ese era el hueco por el que entró el
   defecto y quedó cerrado sin dañar la red de la 366.
4. **El conteo no puede divergir del corte:** un `whereBaseElegible` único, dos cláusulas
   complementarias y un unit que compara los dos `where` completos contra un literal.
5. **El toast se afirma con texto literal** y los tres mensajes anteriores a la ficha se conservan
   byte a byte. El cero se calla, y está razonado por qué.
6. **El gate de Q3 es el mínimo que cierra el daño:** no toca `ESTADOS_SIN_CORRECCION`, no bloquea
   nombre/teléfono/producto/notas/peso/dirección, y deja pasar el distrito que resuelve la misma
   zona. Hay un test por cada una de esas puertas abiertas, no solo por la cerrada.
7. **Las limitaciones se declaran donde duelen:** el unit con dobles dice en su cabecera lo que no
   prueba; el caso R9 dice que mide el `where` base y no la cláusula; el caso R1 dice en voz alta
   que no ejecuta la asignación. Es lo contrario de un test que se auto-aprueba.
8. **Cero deuda oculta en el diff:** 17 archivos, ninguno de los intocables, sin migración, sin
   `any`, sin `console.log`, y el comentario del `WHERE` deja la razón escrita para quien lo lea
   dentro de un año.

---

**Veredicto: OK.** Los 9 hallazgos son de documentación y contabilidad; ninguno vuelve al
implementador. Antes de mover la ficha a `done`: marcar las tasks (menor-1), actualizar la fila T9
(menor-2), corregir las dos cifras (menor-3, menor-4), anotar la derogación en `design.md`
(menor-5) y añadir la entrada a `progress/history.md` (menor-7). La decisión Q3 sigue pendiente de
firma del humano, con su vuelta atrás medida.
