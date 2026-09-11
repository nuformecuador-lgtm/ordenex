# impl_414 — El comprobante del mensajero deja de atribuirle gestiones que no hizo

- **Rama:** `feat/414-comprobante-mensajero-rechazo-contradictorio`
- **SHA base:** `919e6e17` (`docs(414): spec del comprobante contradictorio, y la ficha arranca`)
- **Commits:** `ecf4e082` (producción) · `050eea33` (tests) · éste (bitácora + casillas)
- **Zona:** frontend puro. Cero migraciones, cero `db/`, cero `lib/`, cero DTO, cero endpoints.
- **Fecha:** 2026-09-10

---

## 1. Qué se hizo

Las dos mitades del mismo defecto, con el criterio del spec: **en el comprobante, cada audiencia ve
lo mismo que ya ve en su propia tabla**. Fuera el distintivo que no puede afirmar nada cierto,
dentro la marca que sí.

| Superficie | Origen (`Automático`/`Manual`) | «La tienda» |
| --- | --- | --- |
| Comprobante ADMIN | sigue igual, **ni un carácter** | sigue sin estrenarse (R8) |
| Comprobante MENSAJERO | **se retira** (R1) | **entra** (R7) |

### Archivos de producción tocados (4)

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | **T1** — declara `GESTION_TIENDA_BADGE_LABEL` y `GESTION_TIENDA_BADGE_NOTA`, **mismo texto carácter por carácter** (verificado con `diff` contra el blob de `HEAD` del archivo viejo). Sigue sin React: son dos strings. |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | **T1** — **dos nombres más** en el import y **dos** en el bloque de re-exportación que ya existía. Nada más: `renderRechazoOrigen` y `COLUMNA_RECHAZO_ORIGEN` **sin tocar** (R6). |
| `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | **T1** — borra las dos declaraciones y **añade los dos nombres al import de `cierre-labels` que ya estaba escrito**. Deja en su sitio un comentario que dice dónde fueron y por qué. |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | **T2/T3/T4** — el `<span>` del badge de origen envuelto en `esMensajero ? null : (…)`; el argumento del motivo pasa a `!esMensajero && g.esRechazoSla`; la marca «La tienda» entra en el bloque desplegado, **FUERA del fragmento `rechazada`**. Los dos textos se **importan** por la puerta de T1. |

**Lo que NO se tocó, y es parte del criterio de «hecho»:** el `DatoFila` de «Ingreso de bodega por
rechazos» (R3, deuda heredada de la 408, fuera por decisión del humano), los cuatro
`RECHAZO_*_BADGE_*`, la firma y el cuerpo de `motivoGestionLegible`, y `CierreDiaRepository.ts:295`
— derivar el origen para el mensajero es la mutación 6 de la 408 y está descartado en `design.md` §6.

`git diff --stat 919e6e17..HEAD` no toca **ni un archivo de `lib/` ni de `db/`**, ni
`feature_list.json`, ni `progress/current.md`.

### Archivos de test (2 nuevos, **cero ajenos editados**)

| Archivo | Casos |
| --- | --- |
| `tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx` | 15 (R1, R2, R3, R4, R7, R8) |
| `tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx` | 5 (R5, R9) |

**Todos los literales van tecleados a mano.** Ningún caso compara contra `RECHAZO_*_BADGE_*`,
`GESTION_TIENDA_BADGE_*` ni contra una llamada a `motivoGestionLegible`: eso es «aserción contra su
propia fuente» y sale verde con las palabras rotas. **Ni un `toEqual` existente se tocó y no se
borró ningún test ajeno** (`git diff --numstat 919e6e17..HEAD` da **0 líneas** en todo
`tests/` salvo los dos archivos nuevos).

**El control de no-vacuidad está en todos los casos de ausencia.** El bloque desplegado vive dentro
de `{open ? … : null}`, así que un test que afirme la ausencia con la fila plegada pasa verde SIN el
arreglo. Cada caso despliega la fila y lo demuestra afirmando primero algo que sólo existe abierta
(el texto largo del motivo; en dos casos, el motivo libre o «Recibido»). La mutación 8 es la
autocomprobación de ese control y salió **VERDE**, como exigía el spec.

---

## 2. Mapa `R<n>` → test

| R | Qué exige | Test que lo cubre |
| --- | --- | --- |
| **R1** | mensajero: ni `Manual`, ni `Automático`, ni sus notas | `ComprobanteMensajeroOrigenRechazo.test.tsx` → «la fila del rechazo del cron no lleva «Manual» ni «Automático» ni sus notas» + «tampoco se la lleva la frase que le atribuía el rechazo a él» (barre **todos** los `[title]` del DOM: la nota viaja también en ese atributo) + «y un rechazo que el mensajero SÍ registró tampoco lo lleva» |
| **R2** | admin: los dos rótulos con sus dos notas, sin cambiar un carácter | mismo archivo → «un rechazo del cron mantiene «Automático» con su nota accesible completa» y «un rechazo del mensajero mantiene «Manual» con la suya». Es la pareja que impide «arreglarlo» borrando el distintivo para todos |
| **R3** | el renglón del ingreso y el motivo siguen | mismo archivo → «el renglón «Ingreso de bodega por rechazos» sigue con su monto, y el motivo entero»: `₡1.500` y el texto largo completo, los dos a mano |
| **R4** | texto largo **si y sólo si** no hay distintivo | mismo archivo, los **tres** casos: (1) mensajero + `false` → largo y sin distintivo; (2) admin + `true` → celda **exactamente** `"Dirección errada"` y badge `Automático`; (3) **mensajero + `true`** → largo igual y sin distintivo, declarado en el test como contrato del componente (estado que el servidor no produce hoy) |
| **R5** | la pantalla real ya no lo muestra | `CierreDiaComprobanteMarcasDeOrigen.test.tsx` → monta `CierreDiaModule`, abre el cierre pasado con `verCierrePasado` mockeado, despliega la fila y repite R1 (3 casos). Cubre el hueco que R1 no puede: que la pantalla **pase** `audiencia="mensajero"` |
| **R6** | las superficies de admin no cambian | los que ya existen y **siguen verdes sin editarlos**: `CierreMotivoRechazoAutomatico.test.tsx` (8), `CierresAdminModule.test.tsx` (32), `tests/unit/descarga/*` (3 archivos) y `cierre-detalle-superficies.guardia.test.ts` (4). Evidencia estructural: el diff no cambia una línea de `renderRechazoOrigen`, `COLUMNA_RECHAZO_ORIGEN` ni de las celdas `origenRechazo`; lo único que gana `cierre-detalle-shared.tsx` son **dos nombres** en el import y **dos** en la re-exportación. Medido además con una mutación (ver §3, addendum) |
| **R7** | la marca, **sea cual sea el resultado** | `ComprobanteMensajeroOrigenRechazo.test.tsx` → **una `entregada` y una `rechazada`**, las dos `desdeAyudaTienda: true`, en el mismo comprobante, más «la marca convive con el motivo». Rótulo y nota completos, a mano |
| **R8** | la ausencia también afirma | mismo archivo, emparejado con R7: `desdeAyudaTienda: false` en mensajero, `true` en admin (rechazo **y** entrega). Los tres con control de no-vacuidad |
| **R9** | un solo texto para las dos superficies | `CierreDiaComprobanteMarcasDeOrigen.test.tsx` → en el MISMO montaje, una gestión de la tabla **en vivo** y otra del **comprobante**; el rótulo y la nota se teclean **una sola vez** y se afirman en las dos. Test de comportamiento: ni un `grep` del fuente, ni importar la constante |

---

## 3. Las ocho mutaciones (T8)

Cada una se aplicó **sobre el árbol ya commiteado**, se corrieron los cuatro archivos del conjunto
—los **dos de la ficha** más `CierreMotivoRechazoAutomatico.test.tsx` y `CierreDiaModule.test.tsx`,
que son los ajenos que el `design.md` nombra—, se anotó el número de rojos y se revirtió con
`git checkout --`. **Baseline del conjunto: 103 casos en 4 archivos, todos verdes**, comprobado
antes de la primera y **otra vez después de la última** (103/103, árbol limpio).

| # | Mutación | Rojos | Archivos | Qué la mató |
| --- | --- | --- | --- | --- |
| 1 | revertir (a): el distintivo vuelve a pintarse para el mensajero | **8** | 2 | R1 (×3), R4 (casos 1 y 3), R5 (×2) y el caso de convivencia de R9 |
| 2 | ocultar el distintivo **también** para el admin | **3** | 1 | R2 (×2) y R4 caso 2 |
| 3 | volver a `g.esRechazoSla` en el argumento (b) | **1** | 1 | **sólo** el caso 3 de R4, exactamente como el spec anunció |
| 4 | esconder el fragmento `rechazada` entero para el mensajero | **1** | 1 | R3 — se llevaba por delante el renglón del ingreso |
| 5 | **anidar «La tienda» dentro del fragmento `rechazada`** | **1** | 1 | el caso de la **`entregada`** de R7. Es el fallo mudo de la mitad nueva: sin esto, una entrega registrada por la tienda se quedaría muda y nadie vería un error |
| 6 | pintar «La tienda» también para el admin | **2** | 1 | R8 (el rechazo y la entrega del admin) |
| 7 | **duplicar** la nota de «La tienda» en `cierre-factura.tsx` con una palabra cambiada (`foto`→`imagen`) | **3** | 2 | **R9** —que existe justo para esto— y los dos casos de R7 |
| 8 | quitar el control de no-vacuidad de los casos de ausencia **y** aplicar la mutación 1 | **VERDE (0)** | — | **Es la autocomprobación, y debía salir verde.** Ver abajo |

**Ninguna de las siete primeras sobrevivió.**

### La mutación 8, con su evidencia, porque es la que valida a las otras

Se escribió `tests/components/M8AutocomprobacionSinControl.test.tsx` (temporal, **borrado después**)
con los **mismos cuatro casos de ausencia** de R1 y R8 pero **sin desplegar la fila y sin el control**.
Con la mutación 1 encima —el distintivo pintándose otra vez para el mensajero— la corrida fue:

```
 Test Files  1 failed | 1 passed (2)
      Tests  5 failed | 14 passed (19)
```

El archivo **sin** control: **4/4 en VERDE**. El archivo real, con el control: **5 rojos**. O sea: lo
único que separa el falso verde del verde de verdad es desplegar la fila y demostrarlo. Después se
revirtió la mutación y se borró el archivo temporal (`git status` vacío).

### Addendum medido: la predicción del `design.md` sobre la mutación 2

El spec anotaba que la mutación 2 «debe hacer caer `CierreMotivoRechazoAutomatico`». **No cae, y la
razón es buena:** ese archivo cubre la **tabla del admin** (`DetalleSecciones` → `renderRechazoOrigen`,
en `cierre-detalle-shared.tsx`), no el badge del **comprobante** (`cierre-factura.tsx`), que son dos
caminos de código distintos. Quien protege la tabla es R6, y se midió aparte para no darlo por
supuesto: haciendo que `renderRechazoOrigen` devuelva `null`, `CierreMotivoRechazoAutomatico.test.tsx`
se pone en **2 rojos** («la fila mantiene el badge «Automático»…» y «un rechazo del mensajero sigue
marcado «Manual»»). Revertido. Así que la superficie del admin **sí** está protegida; lo que no era
exacto es por cuál de las dos mutaciones.

---

## 4. Gate

### El rápido se niega solo, como el spec anunció

No se intentó: los cuatro archivos llevan `cierre` en el nombre, que está en la lista de nombres de
dinero de `docs/verification.md`. Se corrió **`./init.sh` completo** desde el primer momento.

### `./init.sh` completo — **INIT_EXIT=1**, y el rojo es AJENO y está medido

```
✓ feature_list.json: sin ids duplicados (412 fichas), cupo por zona respetado (in_progress=2)
✓ typecheck paso
✓ lint paso                              (184 warnings preexistentes, 0 errores)
✓ DATABASE_URL resuelta: los 160 archivos de tests contra Postgres SI se ejecutan
 Test Files  5 failed | 1902 passed (1907)
      Tests  6 failed | 27661 passed | 26 skipped (27693)
   Duration  1328.23s
ROJOS NUEVOS (5 archivo(s) que no estan en el baseline):
  - tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
  - tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts
  - tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts
✗ hay rojos NUEVOS respecto del baseline
INIT_EXIT=1
```

El `INIT_EXIT=$?` se escribió **dentro del log** (`{ ./init.sh; echo "INIT_EXIT=$?"; } > "$LOG" 2>&1`),
no por un `echo` posterior en consola, y el log tiene **ruta propia del agente** — no un
`/tmp/gate.log` genérico que otro worktree pueda pisar. **El comando envolvente terminó en «exit code
0» con el gate ROJO dentro**: es exactamente el modo de fallo contra el que existe esta regla.

**Los cinco rojos NO son de esta ficha, y no se apuntan como suposición:**

1. **Mismo error en los seis casos:** `2BP01 — no se puede eliminar tipo notificacion_evento_old
   porque otros objetos dependen de él`. Es la base local **compartida**, que tiene aplicada la
   migración de la ficha **410** (sigue en su rama): los `down.sql` históricos de estas cinco fichas
   son fotos de su momento y no pueden dropear el enum viejo cuando la base ganó valores después.
2. **Reproducido aislado** (no es contención: **cero `40P01`** en toda la corrida): los cinco
   archivos solos → `Test Files 5 failed (5) · Tests 6 failed | 98 passed (104)`. Los mismos seis.
3. **Reproducido contra `dev` limpio**: se dejó la rama en un `HEAD` desacoplado sobre
   `origin/dev` (`d64281a9`) y esos cinco archivos dan **los mismos 6 rojos**, sin una sola línea
   mía en el árbol. Después se volvió a la rama, con los dos commits intactos.
4. **Mi diff no toca `db/`, ni migraciones, ni `lib/`, ni un DTO.** Son cuatro archivos de `app/` y
   dos de `tests/components/`.

**NO se añadieron a `tests/baseline-rojos.json`.** Es deuda de una rama en vuelo, no de `dev`, y
meterla en la lista la fosilizaría — la lista se mantiene corta a propósito.

**Los `skipped`, mirados y no sólo el exit code:**

- **`integration/db`: SÍ corrieron.** El worktree nace sin `.env`; se copió el del checkout principal
  **tras comprobar que su `DATABASE_URL` activa apunta a `localhost:5432/ordenex`** (la de Supabase
  está comentada en ese archivo). El gate lo confirma con su propia cifra: **160 archivos contra
  Postgres ejecutados**, y en el log aparecen **245 archivos distintos** bajo `tests/integration/db/`.
  El `.env` está gitignorado, **no se commiteó** y se borra al terminar.
- **26 casos `skipped`, ninguno de esta ficha:** 17 en `tests/components/AnaliticaPage.test.tsx` y 9
  en `tests/components/AnaliticaShell.test.tsx`. Preexistentes y ajenos.
- **Cero `40P01`:** no hubo contención con otro agente.

**Los diez archivos que esta ficha vigila, verdes en la corrida completa:**

```
✓ tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx     (15 tests)
✓ tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx    ( 5 tests)
✓ tests/components/CierreMotivoRechazoAutomatico.test.tsx         ( 8 tests)
✓ tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx      ( 7 tests)
✓ tests/components/CierreDiaModule.test.tsx                       (75 tests)
✓ tests/components/CierresAdminModule.test.tsx                    (32 tests)
✓ tests/components/CierreFacturaPapel.test.tsx                    (35 tests)
✓ tests/components/CierreFacturaSinGestionar.test.tsx             (20 tests)
✓ tests/components/CierreDetallePagos.test.tsx                    (11 tests)
✓ tests/unit/guards/cierre-detalle-superficies.guardia.test.ts    ( 4 tests)
```

Y los tres de `tests/unit/descarga/` también, dentro de los 1902 archivos en verde.

---

## 5. Lo que queda abierto, y lo que se rompió por el camino

1. **Los 5 rojos de `notificacion-evento-*-migration`** siguen ahí hasta que la 410 se mergee o la
   base local se rehaga. No es acción de esta ficha: está dicho arriba con sus tres medidas.
2. **Sincronización con `dev`:** `origin/dev` avanzó de `919e6e17` a `2f32c2d2` mientras corría esta
   ficha, con **un commit de sólo specs (417) y `feature_list.json`**. Cero intersección con los
   cuatro archivos de producción, así que **no se mergeó**: el gate medido sigue valiendo y el PR
   entra limpio (mismo criterio que la 408). Si `dev` gana código antes del merge, hay que volver a
   medir.
3. **La deuda que esta ficha protege pero no resuelve** (R3, `design.md` §8.1): el renglón «Ingreso
   de bodega por rechazos» en el comprobante del mensajero es plata de la BODEGA. Antes de moverlo
   hay que medir *¿ese importe entra en lo que se le paga al mensajero, sí o no?*, y se responde en
   el dinero (`pagoMensajero` e `ingresoBodegaRechazo` son dos columnas snapshot distintas), no
   leyendo el componente.
4. **El día que se derive el origen para la vista del mensajero**, la condición a tocar es UNA y
   tiene el comentario puesto en `cierre-factura.tsx` (el `esMensajero ? null :` del badge), con el
   aviso de que el argumento de `motivoGestionLegible` depende de la misma decisión. Quién decide si
   debe verlo es quien reabra la 102, no esta ficha.
5. **Un tropiezo propio, escrito para que no se repita:** al revertir la **primera** mutación con
   `git checkout -- <archivo>` **antes de haber commiteado**, se borró el trabajo de
   `cierre-factura.tsx`. Se rehízo íntegro (mismo `--numstat`, 70/20, y los 103 casos otra vez en
   verde) y **a partir de ahí las mutaciones se corrieron sobre el árbol ya commiteado**. La lección
   ya estaba escrita en el encargo; ahora está medida: *primero commitear, después mutar*.
6. **`feature_list.json` y `progress/current.md` NO se tocaron**, como pedía el encargo.
7. **El worktree nació sin `node_modules`**: se resolvió con `pnpm install --frozen-lockfile` (25 s)
   + `pnpm exec prisma generate`, y no con el junction al árbol principal — con otra sesión viva el
   junction reproduce rojos fantasma, y además `prisma generate` a través de él escribe en el
   `node_modules` del repo principal.
