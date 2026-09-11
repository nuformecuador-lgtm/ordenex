# Revisión — Feature 420: el paso de dependencias del gate mide en vez de afirmar

> Rama `fix/420-gate-dependencias-presentes`, commit **`8326209a`**, PR **#787**, base `origin/dev`.
> Revisado en worktree propio **`R:/wt/rev420`**, con `node_modules` **instalado de verdad**
> (`pnpm install --frozen-lockfile`, 16 s) — **no** por junction, porque esta revisión rompe el
> árbol a propósito y un junction habría roto el de todos los demás.
> El `.env` se copió para tener `DATABASE_URL` y **se borró al terminar**.
> Nunca se usó `git checkout --`: cada reversión es copia byte a byte desde `/r/wt/rev420_backup/`
> con SHA256 comparado.

**Veredicto: OK.** Sin bloqueantes. El entregable —el rojo— existe, corta donde debe y nombra el
paquete; lo verifiqué yo, no lo acepté de la bitácora. El gate completo **con base de datos**
termina en **`INIT_EXIT=0`**, 1942 archivos, 0 rojos.

---

## 1. Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `specs/420-gate-dependencias-presentes/requirements.md` con R1…R7 en EARS numerados.
- [x] `design.md` con alternativas descartadas **y su porqué medido**: A1 (`pnpm install`
      incondicional), A2 (`pnpm list`), A3 (`require.resolve`).
- [x] `tasks.md` con **T0…T9 todas marcadas `[x]`**. Comprobado una a una contra el árbol: cada
      una tiene artefacto real (no hay `[x]` sin respaldo).

### Trazabilidad
- [x] Cada `R<n>` mapea a un test concreto — y **ninguno está vacío**: maté los 13 casos con
      mutaciones dirigidas (sección 5).
- [x] `progress/impl_420.md` trae el mapa `R<n> -> test`, y es correcto.

### Calidad de código
- [x] `pnpm run typecheck` — `TYPECHECK_EXIT=0`.
- [x] `pnpm run lint` — 0 errores, 184 warnings **preexistentes en `dev`** (ninguna en archivos de
      esta ficha; comprobado).
- [x] `pnpm test` — dentro del gate completo: **1942 archivos, 28.177 pasados, 26 saltados, 0 rojos**.
- [n/a] E2E: no hay harness de Playwright ejecutable en este repo y la ficha no toca ningún flujo
      crítico de producto (toca el arnés). El riesgo se cubre por la vía de las secciones 3 y 4.

### Datos y seguridad
- [n/a] Tablas nuevas / RLS / migraciones: el diff **no toca la capa de datos** (verificado:
      `init.sh`, un `.mjs` que nadie importa, un test de guardia, `docs/` y `specs/`).
- [x] Sin secretos: el script solo lee `package.json` y `node_modules/<paquete>/package.json`.
      No imprime rutas absolutas ni variables de entorno. No hay credenciales en el diff.
- [n/a] Webhooks: no aplica.

### Patrón de capas
- [n/a] No hay controller/service/repository en el diff. El script vive en `scripts/`, junto a sus
      dos hermanos del gate (`validar-feature-list.mjs`, `comparar-baseline-rojos.mjs`), y respeta
      su mismo contrato: STDERR para el detalle, STDOUT para el resumen, exit code para el veredicto.

### Permisos / multi-país
- [x] Sin contexto hardcodeado: el script no fija país, moneda ni rutas; la raíz es
      `process.argv[2] ?? process.cwd()`.

### Verificación final
- [x] `./init.sh` completo **en verde** (sección 2).
- [x] Este archivo existe y su veredicto es OK.
- [ ] **Entrada en `progress/history.md`** — falta. Es del leader al cerrar la ficha, no del
      implementer. No bloquea el merge; sí bloquea el paso a `done`.

---

## 2. El gate, corrido por mí, CON base de datos

La bitácora declaró honestamente que su verde **saltó 129 archivos de `tests/integration/`** por
no tener `DATABASE_URL`. Ese hueco lo cerré: copié el `.env` al worktree y corrí el gate completo.

```
✓ DATABASE_URL resuelta: los 170 archivos de tests contra Postgres SI se ejecutan
...
 Test Files  1942 passed (1942)
      Tests  28177 passed | 26 skipped (28203)
   Duration  633.61s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1942 ejecutado(s), todos en el baseline conocido)
== init OK ==
INIT_EXIT=0
```

**26 saltados**, que son los 17 de `AnaliticaPage` + 9 de `AnaliticaShell` de siempre, y **cero de
`integration/db`**. O sea: este verde **sí** cubre la capa de datos. (Log:
`/r/wt/rev420_gate_completo_3.log`, con `INIT_EXIT=$?` **escrito dentro del log**, igual que los
otros cuatro.)

Los primeros pasos del gate, con el arreglo puesto:

```
✓ dependencias: 58 declaradas, todas presentes
✓ feature_list.json: sin ids duplicados (416 fichas), cupo por zona respetado (in_progress=0)...
✓ typecheck paso
✓ lint paso
```

### 2.1 El camino verde no se ha vuelto más lento

Medido en este árbol, 3 corridas de cada cosa:

| medición | corridas | resultado |
| --- | --- | --- |
| `node scripts/verificar-dependencias.mjs` (árbol completo) | 3 | **138 / 122 / 124 ms** |
| `pnpm install --frozen-lockfile` idempotente (la alternativa A1) | 3 | **1697 / 1692 / 1650 ms** |

Reproduce los números de la bitácora (114-130 ms y 1.573-1.772 ms) sin desviación relevante. El
paso 2 pasa de ~0 ms a ~0,13 s: **0,2 % del gate rápido** y **0,02 % del completo**. No es
apreciable. Y el modo rápido sigue negándose solo ante este diff, como manda el diseño:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    init.sh
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

La guardia nueva **se selecciona en modo rápido**: `vitest list guard` la lista con sus 13 casos,
así que corre siempre, que es el criterio de `docs/verification.md` para este tipo de comprobación.

### 2.2 Los dos rojos de la bitácora: la conclusión se sostiene, la explicación no del todo

La bitácora los llamó «flakes de saturación» y **no los baselineó** (correcto: el baseline prohíbe
comprar el verde). Rehíce la medición en vez de aceptarla, y corrí **seis suites completas**:

| # | árbol | entorno | duración | archivo rojo |
| --- | --- | --- | --- | --- |
| impl 1 | rama, **sin** `.env` (129 saltados) | cargado | 827,8 s | `recuperar-contrasena-form` |
| impl 2 | rama, **sin** `.env` (129 saltados) | cargado | 1405,8 s | `CierresDescargaColumnas` (timeout 20 s) |
| mío 1 | rama + `dev`, **con** `.env` | el gate del **421** corriendo en paralelo | 1511,2 s | `recuperar-contrasena-form` |
| mío 2 | rama + `dev`, **con** `.env` | máquina en calma, cachés frías | 1053,2 s | `recuperar-contrasena-form` (**otro** caso del mismo archivo) |
| mío 3 | **`dev` limpio**, con `.env` | cachés calientes | 615,5 s | **ninguno** — `INIT_EXIT=0` |
| mío 4 | rama + `dev`, con `.env` | cachés calientes | **633,6 s** | **ninguno** — `INIT_EXIT=0` |

Lo que dicen los números:

- **El rojo no es de la rama.** Aparece y desaparece según la **velocidad del entorno**, no según
  el árbol: `dev` limpio en régimen rápido sale verde, y la rama en régimen rápido sale verde
  también, con 633,6 s contra 615,5 s (3 % de diferencia, que es el archivo de guardia nuevo más
  ruido). Y el diff **no tiene camino de imports** hacia ese formulario: lo único de esta rama que
  vitest llega a ejecutar es la guardia nueva (0,9 s).
- **El delator es la duración del propio archivo frágil:**
  `tests/integration/recuperar-contrasena-form.test.tsx` tarda **7.879 / 7.894 ms y pasa**; tarda
  **9.958 / 11.890 / 16.076 ms y cae**. Aislado pasa **5 de 5** (yo), además de las 3 corridas del
  implementer. Los dos fallos son de la familia `userEvent`: en uno el input quedó `value=""` con
  `aria-invalid="true"` (las pulsaciones no llegaron antes del submit), en el otro no encontró la
  etiqueta porque la fase anterior no había terminado de navegar. No es un fallo de lógica: los
  otros 10 casos del mismo archivo, que también teclean, pasaron en la misma corrida.
- **Corrección a la bitácora (menor):** dice «cada corrida tumbó un archivo DISTINTO». Con las
  seis corridas a la vista, **el mismo archivo cayó 3 de 4 veces** entre las lentas. No es
  aleatorio: es **un archivo concreto y frágil** que enrojece cuando el entorno va lento. La
  conclusión («no es mío, no se baselinea») **se mantiene y queda ahora medida contra `dev`
  limpio**; la etiqueta «saturación» era imprecisa — mi corrida 2 fue con la máquina en calma y
  también salió roja.
- **Recomendación para el leader, no para esta ficha:**
  `tests/integration/recuperar-contrasena-form.test.tsx` merece ficha propia. Hoy es la mina que
  hace saltar cualquier gate completo que corra lento, y ya se ha llevado por delante tres
  corridas en un día.

---

## 3. El entregable: el rojo, reproducido por mí

Quitando **solo** el junction `node_modules/web-push` (sin tocar el store, para no romper nada más):

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
falta 1 de las 58 dependencias declaradas en package.json:
    - web-push
  Reparalo con: pnpm install --frozen-lockfile
  (medido el 2026-09-11: ~1,7 s sobre un arbol ya instalado)
✗ faltan dependencias declaradas (el detalle esta justo arriba)
INIT_EXIT=1
```

Corta **en el paso 2**, antes del typecheck, y **cita el paquete por su nombre** (R2), con el
comando de reparación ya escrito (R3). Log: `/r/wt/rev420_rojo_con_arreglo.log`.

**El contraste, sobre el mismo árbol roto y en el mismo minuto**, ejecutando el `init.sh` de
`origin/dev`:

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes          <- VERDE, con web-push fuera del arbol
```

Log: `/r/wt/rev420_verde_falso_sin_arreglo.log`. El defecto y su arreglo, lado a lado.

Y con **dos** paquetes fuera, el verificador los enumera y concuerda el verbo:

```
faltan 2 de las 58 dependencias declaradas en package.json:
    - web-push
    - @types/web-push
```

---

## 4. El hallazgo que agranda el agujero: **es cierto**, y lo medí aparte

La afirmación era: si falta **solo** el paquete de runtime y siguen sus tipos en
`node_modules/@types/`, el typecheck **pasa en verde**. Lo comprobé en tres estados del mismo árbol:

| estado del árbol | `pnpm run typecheck` | runtime |
| --- | --- | --- |
| completo | `TYPECHECK_EXIT=0` | `require("web-push")` resuelve |
| **sin `web-push`, con `@types/web-push`** | **`TYPECHECK_EXIT=0` (VERDE)** | **`MODULE_NOT_FOUND`** |
| sin `web-push` y sin `@types/web-push` | `TS2307` en `lib/push/web-push-sender.ts(11,21)`, `TYPECHECK_EXIT=2` | `MODULE_NOT_FOUND` |

Confirmado: **el typecheck nunca fue la red de seguridad de este fallo**; solo lo caza cuando
faltan los dos. En el caso de en medio el gate entero pasaba y el fallo salía **en ejecución**
— `lib/push/web-push-sender.ts:11` importa el paquete —. La ficha vale más de lo que la ficha
decía, y el paso nuevo es **estrictamente más fuerte** que el typecheck para esta familia.

---

## 5. Mutaciones

Reapliqué las dos de control y planté **cinco propias**. Todas revertidas por copia byte a byte
desde `/r/wt/rev420_backup/` con SHA256 comparado después (`init.sh` ->
`01106d91aa3bd7b52477cfec022169c907d6cd989c72867b0c90f621838a9be9`, que es **el mismo blob que
está en el remoto**; verificador -> `0a351a636b3ef8ae69e56fbc56e3b5e21e56d36e5a6637cbfa29b174a56ad799`).

Línea base antes de cada una: **13 de 13 en verde**.

| # | mutación | resultado | quién la mató |
| --- | --- | --- | --- |
| A (control) | el verificador nunca detecta ausencias (`false && ...`) | **MUERTA** | **6 de 13** — exactamente los 6 que dice la bitácora |
| B (control) | `init.sh` deja de llamar al verificador y vuelve a `ok "dependencias presentes"` | **MUERTA** | **2 de 13** — exactamente los 2 que dice la bitácora |
| C (mía) | `SECCIONES_EXIGIDAS = ["dependencies"]` (se olvida `devDependencies`) | **MUERTA** | 2 de 13 (`R4` la cifra, `R2` las de scope) |
| D (mía) | se borra `process.exitCode = 1`: imprime el rojo y **sale 0** | **MUERTA** | 5 de 13 |
| F (mía) | el verificador importa `zod` (un paquete de `node_modules`) | **MUERTA** | `R7 — solo importa modulos node:` |
| G (mía) | el verificador importa `node:child_process` | **MUERTA** | `R7 — no lanza procesos ni toca la red` |
| H (mía) | el install de arranque pierde `--frozen-lockfile` y el `|| fail` | **MUERTA** | `R5/R6 — la instalacion de arranque...` |
| **E (mía, adversaria)** | la llamada se traga el error **conservando la palabra `fail` en la línea** | **SOBREVIVE (13/13 verde)** | nadie — ver hallazgo M2 |

Los 13 casos quedan probados como **no vacíos**: cada uno muere ante una mutación dirigida, salvo
`R1 — el arbol REAL de este repo`, que no se mata con una mutación del fuente pero **sí se mata
rompiendo el árbol**, y eso está medido en la sección 3 (con `web-push` fuera devuelve exit 1 y
STDERR no vacío, que es justo lo que ese test prohíbe).

---

## 6. ¿Qué cuenta como «dependencia declarada»? Sondas propias

Monté árboles falsos y medí, en vez de leer el código y suponer:

| caso | veredicto del verificador | juicio |
| --- | --- | --- |
| `dependencies` con un paquete ausente | **rojo**, lo nombra | correcto (R1/R2) |
| `devDependencies` con un paquete ausente (incl. con scope) | **rojo**, lo nombra | correcto |
| `optionalDependencies` con un paquete ausente | **verde** | **correcto**: pueden faltar legítimamente. Y no es palabra: el test del caso verde mete siempre una opcional ausente, así que si alguien la exigiera, ese test se pondría rojo |
| `peerDependencies` con un paquete ausente | **verde** | correcto (las aporta el consumidor), pero **no está dicho en `design.md`** — ver hallazgo M3 |
| paquete presente con **versión distinta** de la declarada (`^99.0.0` declarado, `1.0.0` instalado) | **verde** | **límite declarado** en `design.md` y en `docs/verification.md`. Confirmado, no escondido |
| carpeta sin `package.json` dentro | **rojo** | correcto: Node tampoco resuelve eso |
| enlace simbólico **roto** (la forma real de pnpm) | **rojo** | correcto, y es el caso que un `existsSync` deja pasar |
| `node_modules` ausente por completo | **rojo**, con mensaje propio («sin instalar») y sin enumerar 58 | correcto (R5) |
| alias `npm:otro@^1` | verde si la carpeta existe | correcto: Node resuelve por nombre de carpeta |
| `package.json` de la raíz ausente o corrupto | exit 1 con **traza de Node sin capturar** | ver hallazgo M4 |

**Falsos positivos: ninguno encontrado.** Es lo que más me preocupaba — un verificador que bloquea
a todo el mundo por algo legítimo es peor que el defecto — y el árbol real del repo da verde en
las seis corridas sueltas que hice, además de en las tres suites completas de la rama.

---

## 7. La decisión de diseño: **estoy de acuerdo**, y añado un argumento

Descartar el `pnpm install --frozen-lockfile` incondicional (A1) es correcto. Reproduje los dos
números que sostienen la comparación (1,65-1,70 s contra 0,12-0,14 s, **13x**) y no es el precio
lo que decide. Lo que decide:

1. **A1 no produce el rojo, y el rojo es el entregable.** Y esto no es una preferencia estética:
   la propia ficha lo dice con mayúsculas en su `status_note` («EL ENTREGABLE ES EL ROJO»). Con A1
   el paso sale verde, nadie se entera de que el árbol estaba mal, y — por la sección 4 —
   **tampoco grita el typecheck**. Se cambiaría un fallo mudo por otro más callado. Es exactamente
   la familia que este repo persigue.
2. **Un paso que mide no debe escribir en lo que mide.** No es abstracto aquí: el gate corre en el
   worktree de cada agente, el cliente de Prisma vive dentro de `node_modules`, y este repo ya
   tiene medido lo que cuesta que un `node_modules` se mueva por debajo de una corrida ajena
   (rojos fantasma citando símbolos que no están en el árbol). Meter una escritura incondicional
   al arranque de **cada** gate de **cada** worktree es abrir esa puerta a propósito.
3. **El argumento que añado, y que a mi juicio cierra el debate: el viaje de ida y vuelta que
   justificaría A1 cuesta ~2 segundos, no una suite.** El paso es el **segundo** del gate: el rojo
   llega antes del typecheck, con el nombre del paquete y el comando ya escrito. No se tira una
   corrida de 10 minutos; se tiran dos segundos y se escribe un comando. Si esta comprobación
   viviera **después** de los tests yo defendería A1 sin dudar, porque ahí el coste del viaje sí
   sería real. Aquí no lo es.
4. **Matiz honesto, por si alguien usa «desatasca al que corre el gate» como argumento a favor:**
   A1 tampoco «repara siempre». Con `--frozen-lockfile`, si `package.json` y `pnpm-lock.yaml` no
   concuerdan, falla — correctamente — y el agente se come un rojo igual, pero dicho en el
   vocabulario de pnpm (`ERR_PNPM_OUTDATED_LOCKFILE`) en vez de «falta `web-push`». O sea: A1
   compra menos desatasco del que promete.

**Lo único que el leader debe saber es que al implementer se le contradijo la ficha.** La
`status_note` de la 420 prescribía literalmente el arreglo de una línea (`pnpm install
--frozen-lockfile` «puede correr SIEMPRE»). El implementer no lo hizo, lo midió y explicó por qué
en `design.md`, en `docs/verification.md` y en la cabecera de los dos archivos. Me parece la
decisión correcta y bien documentada, pero es **del humano** decidir si acepta el cambio de rumbo.

---

## 8. Hallazgos

### Bloqueantes

**Ninguno.**

### Menores

- **M1 — falta la entrada en `progress/history.md`.** Es del leader al cerrar; sin ella la ficha
  no cumple el último punto de `CHECKPOINTS.md` y no puede pasar a `done`.

- **M2 — la guardia de composición (R6) afirma sobre TEXTO, no sobre COMPORTAMIENTO, y hay una
  mutación plausible que la atraviesa.** El test busca la línea que contiene
  `scripts/verificar-dependencias.mjs` y exige que **contenga la palabra `fail`**. Medido: si la
  llamada se envuelve en `|| echo "no se pudo verificar"` — manteniendo `|| fail` al final de la
  misma línea, que es lo que alguien escribiría «para que el gate no se caiga en máquinas raras» —
  los **13 tests siguen en verde** y el gate vuelve a pasar por encima del árbol roto:

  ```
  falta 1 de las 58 dependencias declaradas en package.json:
      - web-push
  ✓ dependencias: no se pudo verificar        <- VERDE, y el gate sigue
  ```

  Es el mismo fallo mudo que la ficha cierra, un piso más abajo — el argumento que el propio T3
  escribe. No es bloqueante porque el rojo end-to-end **sí** está demostrado hoy (sección 3) y la
  mutación es hipotética, pero se cierra con una línea: anclar la aserción a la forma exacta de la
  invocación en vez de un `toContain("fail")` sobre la línea entera.

- **M3 — `peerDependencies` no se menciona en `design.md`.** El diseño explica por qué queda fuera
  `optionalDependencies` y calla sobre las peer. Medido: se ignoran, que es lo correcto, y el
  `package.json` de este repo hoy no declara ninguna (37 `dependencies` + 21 `devDependencies`,
  0 opcionales, 0 peer). Basta una frase en el mismo párrafo para que el día que aparezca una,
  nadie tenga que volver a medirlo.

- **M4 — `package.json` de la raíz ausente o corrupto sale por una traza de Node sin capturar.**
  El caso «ausente» es inalcanzable desde el gate (`if [ -f package.json ]` lo protege); el
  «corrupto» sí es alcanzable, y entonces el gate imprime un stack de `JSON.parse` seguido de
  `✗ faltan dependencias declaradas`, que es un diagnóstico equivocado. Probabilidad baja, arreglo
  barato (un `try/catch` con mensaje propio). No bloquea.

- **M5 — errata en `design.md`: «90 paquetes declarados».** Son **58** (37 + 21), que es lo que
  dice el resto de la ficha, lo que imprime el gate y lo que medí. Un número suelto y equivocado
  en el documento que justifica la decisión invita a rehacer la medición.

- **M6 — `scripts/verificar-dependencias.mjs` no está en `RUTAS_SENSIBLES`,** aunque es
  instrumento del gate por el mismo argumento con el que `init.sh` se vigila a sí mismo. Mitigado:
  su guardia corre **siempre** (comprobado: `vitest list guard` la selecciona con sus 13 casos),
  así que el modo rápido no la deja sin cubrir. Observación, no deuda.

- **M7 — la rama, tal cual está commiteada, tiene el paso 3 en rojo si se corre sin `dev` dentro.**
  Su base (`5fa73fa6`) todavía marcaba la 421 `in_progress` sin carpeta de specs, así que
  `validar-feature-list.mjs` la rechaza. Ya está resuelto en `dev` (`163de6b9`) y el PR mergea
  limpio (`MERGEABLE`, `CLEAN`); las corridas de gate que doy por válidas se hicieron sobre la
  **mezcla** rama + `origin/dev`, que es lo que va a aterrizar. No hay nada que arreglar en la
  rama: basta mergear o rebasar antes de correrle el gate.

- **M8 — corrección a la bitácora sobre los rojos.** Detallada en 2.2: la conclusión es correcta y
  ahora está medida contra `dev` limpio, pero «cada corrida tumbó un archivo DISTINTO» no es lo
  que muestran las seis corridas, y «saturación» no es la causa — una de las corridas rojas fue
  con la máquina en calma —. La causa medible es la **velocidad del entorno**, y el archivo frágil
  es siempre el mismo.

---

## 9. Lo que quedó fuera de esta revisión

- La ficha **421** corre en paralelo y toca `tests/` y `_postgres-real.ts`; su gate estuvo
  ejecutándose a la vez que mi primera corrida (medido: su `.vitest/rojos.json` se escribió a las
  15:26:43, dos minutos después de la mía). Nada de eso es de esta rama.
- No revisé el contenido de `tests/integration/recuperar-contrasena-form.test.tsx` más allá de lo
  necesario para clasificar su rojo; queda propuesto como ficha propia en 2.2.

---

## 10. Veredicto

**OK.** El paso 2 del gate ahora mide lo que afirma, el rojo está demostrado de punta a punta con
su contraste, el hallazgo del typecheck es cierto y comprobado por separado, los 13 tests están
vivos bajo mutación, no encontré un solo falso positivo, y el gate completo **con base de datos**
termina en `INIT_EXIT=0`. La decisión de no instalar incondicionalmente es la correcta y está
medida.

Los ocho hallazgos son menores. El único que recomiendo atender en este mismo PR — porque cuesta
una línea y cierra un agujero del mismo tipo que la ficha viene a cerrar — es **M2**.
