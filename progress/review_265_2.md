# Review 2 — Feature 265 · el optimizador de ruta lee lo que el proveedor le dice

> **Re-revisión de solo lectura** sobre `dev` en **`85b5a017`**, contra `96940710` (la base de
> `progress/review_265.md`, que **no se ha tocado**: sigue intacto en su blob `879ade4a`).
> Cierran hallazgos: **PR #467** (`bc640875`, `fb53e9de` → `B1`, `B2`, `m1`) y **PR #471**
> (`8f4b2811`, `8b28edcf` → siete menores). En el rango entró también la **262** (PR #470/#472):
> **no se revisa**, y donde interfiere se dice.
>
> **VEREDICTO: OK** — **0 bloqueantes**, **7 menores** (3 heredados y abiertos a propósito + 4 de
> bookkeeping nuevos). ⚠️ **OK no es «pasa a `done`»**: ver la sección 8.

---

## 1 · Verificación ejecutable, corrida por mí

`pnpm exec prisma generate --schema db/schema.prisma` antes (el cliente vive en un `node_modules`
compartido por *junction*) y después `./init.sh` **completo**, con el `echo` **dentro** del redirect:

```
== Arnes SDD :: init (modo: completo) ==
-> pnpm run typecheck        OK
-> pnpm run lint             99 problems (0 errors, 99 warnings)  -> lint paso
-> pnpm run test
 Test Files  1324 passed (1324)
      Tests  17866 passed | 26 skipped (17892)
 test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
== init OK ==
INIT_EXIT=0
```

**La aritmética cuadra, y esa es la comprobación —no el color—:**

- **1319 → 1324 archivos.** Contados por mí con `--diff-filter=A/D` sobre `tests/`: **5 añadidos, 0
  borrados**. Uno es de esta ficha (`RutaMapaInner.test.tsx`); los otros cuatro son de la 262.
- **17.793 → 17.866 tests (+73).** De esos, **+7 son de la 265** —3 de `m3` y 4 de `m7`, tal como
  dice la bitácora— y **+66** son de la 262. **Ningún archivo de test desapareció.**
- **99 warnings, 0 errores**: los mismos de las cuatro corridas anteriores. Ninguno sale de aquí.
- La lista de «migraciones sin `down.sql`» **no crece**: las tres `ruta_*` del 2026-08-14 y nada más.
- Árbol **limpio** al terminar y tras cada mutación (`git diff --stat` vacío, comprobado en el
  `finally` de cada arnés). **No he editado una línea de código.**

---

## 2 · `B1` — reproducido por mí, en las dos direcciones

Es la afirmación central del arreglo, así que no se acepta leída. Arnés propio (fuera del repo, en el
scratchpad) que **aborta** si el bloque a mutar no está tal cual, corre la **base sin mutar** antes de
nada, y **restaura siempre** verificando el diff.

**`M-ae`** = mover el bloque `optlog("client/google — el proveedor informa saltos …")` **detrás del
`return { status: "ok" … }`**, o sea dentro de la rama de `sin_solucion`: «solo se avisa cuando ya
es tarde», que es literalmente el defecto que R8 vigila.

**(a) Con el test de HOY — la mutación MUERE:**

```
=== BASE SIN MUTAR (hoy) ===   Test Files 1 passed (1)   Tests  32 passed (32)   exit = 0
=== MUTADO M-ae ===            Test Files 1 failed (1)   Tests  1 failed | 31 passed (32)
   x R8: una respuesta UTILIZABLE que ademas trae avisos sigue siendo `ok` Y QUEDA ESCRITA
   AssertionError: la respuesta era UTILIZABLE y traia avisos: la traza tenia que decirlo IGUAL:
                   expected undefined to be defined
   exit = 1
=== RESTAURADO. git diff --stat: vacio ===
```

**(b) Con el test ANTERIOR (`96940710`) — la misma mutación SOBREVIVE:**

```
--- test ANTERIOR (96940710) puesto en su sitio ---
=== BASE SIN MUTAR (antes) ===   Tests  32 passed (32)   exit = 0
=== MUTADO M-ae ===              Tests  32 passed (32)   exit = 0   <- VERDE
=== RESTAURADO. git diff --stat: vacio ===
```

**Confirmado: el arreglo es una medición, no una promesa.** Cae **1 de 32** y sobreviven **31**,
entre ellos el test de R1 —que es exactamente por qué el agujero existía—. El conteo **no cambia**
(32 antes y después): no se añadió un test, se le pusieron dientes al que ya estaba. El diff del
archivo de test lo confirma: la única aserción retirada es el `toMatchObject({status:"ok"})` suelto,
que **se conserva** dentro del test nuevo como «Mitad 1».

`design.md` seccion 10.4 tiene la fila de **`M-ae`**, que era el otro medio de B1.

**B1 CERRADO.**

---

## 3 · `B2` — `tasks.md` dice la verdad: 38 `[x]` · 5 `[ ]`

Contado por mí sobre el archivo en `dev`: **38** líneas `- [x]` y **5** `- [ ]`, y las cinco son
exactamente **B0.1, C3, C5, C7, C8**. Cada una lleva su motivo **al lado**, no solo en la tabla de
cabecera. Verificado además:

- **Los `[x]` que se podían comprobar en el árbol, se comprueban.** `B0.3` (¿sigue el `console.log`
  del token en `origin/dev`?) lo repetí yo contra el remoto: **cero coincidencias**. `B0.2` tiene su
  snippet y sus tres números, y el que de verdad usa la guarda —origen hacia el **centroide**,
  1.028,9960 km— coincide con el que yo calculé por mi cuenta en la revisión anterior (1.028,99).
- **Tres `[x]` llevan su letra pequeña**, que es lo que impide que un `[x]` liso esconda deuda:
  `B0.4` (M1 volvió «no medible», de ahí nace C3), `B16` (las mutaciones se corrieron repartidas
  entre los dos bloques) y `F6` (hecha en **local**, no en preview).
- **Las cinco vivas llevan de quién son** (cerrada / leader / release), que es lo que hace accionable
  la lista.

**B2 CERRADO.** ⚠️ Con una corrección de estado que la propia ficha ya no puede ver: **C5 quedó
desbloqueada** — ver `m12`.

---

## 4 · Los siete menores que se dieron por cerrados: verificados uno a uno

| # | Qué comprobé yo | Veredicto |
| --- | --- | --- |
| **m1** | El snippet de `B0.2` está pegado con sus tres números y `distanciaHaversineKm` del repo; el de la guarda (origen hacia centroide) coincide con mi propio cálculo | CERRADO |
| **m3** | `RutaMapaInner.test.tsx` existe (3 casos: `local` punteada, `routes` continua, sin trazado punteada) y la polilínea del fixture se **codifica** con `codificarPolilinea` en vez de ser una cadena mágica. **Corrí `M-af`** (borrar el `dashArray`): base 97 verdes, mutado **2 fallos de 97**, y `RepartoModule.test.tsx` **sobrevive entero** — o sea que antes de este test nadie lo miraba. El diseño corrige además que en el DOM hay **dos** textos, no tres | CERRADO Y MEDIDO |
| **m4** | Leí `tests/integration/repositories/ruta-optimizada-repo.test.ts:1-50`: Prisma es `vi.fn()`, `$transaction` falso, y la cabecera lo dice. `design.md` ya no lo llama «el único sitio donde el `WHERE` real se mira»: dice que afirma **argumentos**, nombra quién sí mira el SQL y **escribe la consecuencia** (un `WHERE` mutado que Prisma acepte pasa ese test en verde) | CERRADO |
| **m5** | `google-route-optimization.ts:208` ya no miente y deja escrito **qué decía antes y por qué caducó**. Rehíce **yo** el barrido de `RUTA_DEBUG_LOG` sobre el repo: `.env.example` dice «**enciende** … APAGADA por defecto desde la feature 265», `optimizer-log.ts` lleva su enmienda en el renglón siguiente, `jest-dom.ts` conserva su nota y `requirements.md:39` está anotado. **El barrido no fue exhaustivo del todo** -> `m15` (dos copias sin daño) | CERRADO, con matiz |
| **m6** | `design.md` seccion 1 y 16.1 ya dicen que **P7 entra** y que el default se invirtió, con el texto viejo citado dentro de la corrección; `C7` apunta de vuelta. Verificado contra `activo()`, que es lista blanca (`1`/`true`) | CERRADO |
| **m7** | Leí los 4 tests nuevos (dos guardas cortarían a la vez, se afirma **cuál gana** por su `razon` y por lo que se ahorra). El de la huella **no reimplementa el hash**: lo lee de lo que persistió la primera corrida. **Corrí `M-ah`** (adelantar el intervalo mínimo a la obsolescencia) **en las dos direcciones**: con los tests de hoy **1 fallo de 40**, y con el archivo anterior a `8f4b2811` **36 de 36 verdes, exit 0**. El agujero que `m7` describía está **medido**, no supuesto | CERRADO Y MEDIDO |
| **m9** | Los dos directorios `20260822140000_*` existen, son distintos y **no se han tocado**. Mi gate completo pasa con las dos aplicadas | VERIFICADO, SIN ACCION (correcto: renombrar una migración aplicada es drift) |
| **m11** | Los dos `defaultLogger` no-op llevan ahora el límite declarado 5 escrito **en el código**, con la consecuencia práctica (no cuelgues nada de estos `warn`), y el comentario que decía que servían «para que un operador note…» está corregido | CERRADO |

**Y lo que no cambió, que es la mitad del trabajo:** el diff de `lib/` del PR #471 son **solo
comentarios** —lo leí línea a línea— y el de `tests/unit/services/optimizacion-ruta-service.test.ts`
es **puramente aditivo** (cero líneas borradas). **Ningún test ajeno se relajó, encogió ni
desapareció**, y los cuatro commits de la 265 no tocan `db/`, `app/`, `lib/types/` ni
`feature_list.json`.

---

## 5 · Los tres menores abiertos: el motivo es cierto y está escrito

- **`m2` · `F6` sigue a medias, y el motivo es real.** «Y **no** se llama al proveedor con ese
  origen» exige distinguir una llamada que se hizo de una que no; en local **no hay credencial**, así
  que `FallbackRouteOptimizationClient` degrada por `RutaNoConfiguradoError` **siempre** y los dos
  escenarios producen la misma observación. No es que nadie lo intentara: **el experimento no tiene
  poder de resolución ahí**. La mitad viva la cubre el unitario que afirma el **argumento** de
  `client.optimizar` (y esta tanda le añadió uno más fuerte: el centroide es el de las paradas **que
  se envían**). Queda escrito en `F6` y en la bitácora. **Repetir en preview antes de la release.**
- **`m8` · La entrada de `progress/history.md` no existe** — lo comprobé: cero entradas de la 265.
  Es **del leader** y es correcto que falte: `history.md` es el registro de **cierre** y la ficha
  sigue `in_progress` con pendientes reales.
- **`m10` · La mina de `getByRole("alert")` en singular** sigue en `RepartoModule.test.tsx:839`,
  `:1152`, `:1463`, **intacta y verde**: ese archivo no lo tocó ninguno de los cuatro commits.
  Dejarla es una decisión razonada (editar tests ajenos y verdes en un archivo de 2.700 líneas que
  otras ramas están tocando), no un descuido, y está declarada en tres sitios.

---

## 6 · Los cinco puntos que la ficha declara a deber: siguen siendo ciertos y escritos

1. **P1 y P5 sin resolver.** SI. `C4` las lista como abiertas, `B0.1` explica por qué **no se puede
   tomar** (P4 se lleva la traza), el `respuestaSchema` sigue defensivo y R7 tolerante (**R49** con
   test propio). No se han rellenado con un supuesto.
2. **`RUTA_ORIGEN_MAX_KM = 200` sin calibrar, y los 1.040 km como artefacto de pruebas.** SI. Escrito
   en los tres sitios; el comentario de contrato de `lib/config/route-optimization.ts` sigue diciendo
   «M1 NO SE PUDO MEDIR» y que fue **una prueba del propio humano**. Lo vigila la guardia, que corre
   verde en mi gate. La ficha 265 de `feature_list.json` lo repite con todas sus letras.
3. **El default de `RUTA_DEBUG_LOG` invertido.** SI. `activo()` es lista blanca; ni un typo, ni `0`,
   ni la variable ausente la encienden. `.env.example` lo documenta con la advertencia de PII.
4. **`F6` en local y no en preview.** SI. Declarado en `tasks.md` (letra pequeña), en
   `impl_265_frontend.md` y en el anexo 9.2. Es `m2`.
5. **La tercera señal de R43 no es un texto.** SI, y desde `m3` **además tiene test**: `RepartoModule`
   afirma los dos textos y que la geometría `local` llega a las props; `RutaMapaInner` afirma que esas
   props se convierten en `dashArray`. La deuda que quedaba se cerró.

---

## 7 · Mapa `R<n>` hacia test, revisado

De los 49 requisitos, **46 conservan intacto** el test verificado archivo a archivo en
`review_265.md` seccion 4 (los releí en el mapa y en la suite; ninguno perdió el suyo). **Los tres
que cambiaron:**

| R | Antes | Ahora | Muerde? |
| --- | --- | --- | --- |
| **R8** | «el test llamado R8 afirma **solo** `status: ok`» -> **B1** | `google-route-optimization.test.ts` -> «R8: … sigue siendo `ok` **Y QUEDA ESCRITA**»: enciende la traza y exige la línea con `skippedShipments: 0`, `validationErrors: true`, `skippedMandatoryShipmentCount: null` | SI, **medido por mí** (seccion 2): muere con el test de hoy, sobrevive con el de antes |
| **R33** | el «mismo orden» no se afirmaba como orden (**m7**) | lo de antes **+** `describe("265/R33 — las guardas cortan EN ESTE ORDEN")`, 4 casos con dos guardas compitiendo | SI, **medido por mí**: `M-ah` mata 1 de 40 hoy y **sobrevive** con los 36 de antes |
| **R43** | llegaba hasta las props del mapa (**m3**) | lo de antes **+** `RutaMapaInner.test.tsx` (3 casos sobre `dashArray`) | SI, **medido por mí**: `M-af` mata 2 de 3 y `RepartoModule` no se entera |

**Busqué hermanos del fallo de R8** —un test cuyo nombre promete más que su cuerpo— contando las
aserciones de cada `it` de los cuatro archivos de la ficha: no aparece ninguno más. Los `it` con una
sola aserción son los que **piden** una sola cosa (un desenlace, un throw, un argumento), y los dos
`it` de saneo que a primera vista no tienen `expect` los delegan en `assertLimpio`, que sí los tiene.
Los estrechamientos de tipo de los tests nuevos siguen precedidos de su `expect`.

**Los `toEqual` literales del contrato no se ablandaron**, y la tabla de mutaciones del diseño pasa
de 30 a **37 filas** — las conté: 37, que es lo que el texto dice.

---

## 8 · Checklist de `CHECKPOINTS.md`

| Punto | Estado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — R1-R49, con los anexos de las dos puertas humanas |
| `design.md` con alternativa descartada y su porqué | OK — 17 alternativas razonadas |
| `tasks.md` y **todas** marcadas `[x]` | PARCIAL — **38 `[x]` · 5 `[ ]`**, cada viva con su motivo y su dueño. **Cumple lo que exigí al rechazar** (lo hecho en `[x]`, lo vivo en `[ ]` con su estado), pero **el checkpoint literal no se cumple**: mientras C3/C5/C7/C8 sigan abiertas la ficha **no puede pasar a `done`**. No es un bloqueante de la implementación; es la puerta de la release |
| Cada `R<n>` mapea a un test concreto **que muerde** | OK — **los 49**, con R8, R33 y R43 medidos por mí con mutación |
| `progress/impl_<feature>.md` con el mapa R hacia test | OK — backend y frontend, con la fila de R8 **corregida** donde mentía y el anexo 9.14 ampliando R33 y R43 |
| `pnpm run typecheck` · `lint` (0 errores) · `pnpm test` | OK, OK, OK (seccion 1) |
| E2E de flujo crítico | NO APLICA — no hay harness E2E ejecutable y el reparto no está en la lista (auth/pagos/recaudo/ingesta/webhooks). Su sustituto es `F6`, hecho en local -> `m2` |
| RLS en tabla nueva | NO APLICA — no hay tabla nueva; la columna cuelga de `ruta_optimizada`, con RLS habilitada sin policies desde su migración original |
| Migraciones versionadas y reversibles | OK — `20260822140000_ruta_secuencia_fuente/` con `migration.sql` **y `down.sql`**, fijado por test estático. **No se tocó `db/` en esta tanda** |
| Sin secretos hardcodeados | OK — `.env.example` documenta **nombres**, sin un solo valor |
| Webhooks con firma e idempotencia | NO APLICA |
| Controller sin queries · Service sin HTTP · Repository sin negocio | OK, OK, OK (sin cambios: el diff de `lib/` de esta tanda son comentarios) |
| Interfaces en `lib/interfaces/` por categoría | OK |
| Páginas protegidas validan en servidor · props · Server Actions | OK, OK, OK |
| Sin hardcode de país/moneda/cuenta | OK — el umbral es configuración, y su guardia lo vigila |
| `./init.sh` en verde | OK — `INIT_EXIT=0` **dentro** del log (seccion 1) |
| `progress/review_<feature>.md` con veredicto OK | OK — **este archivo** |
| Entrada en `progress/history.md` | FALTA -> `m8` (del leader, y correcta mientras la ficha siga `in_progress`) |

---

## 9 · Hallazgos

### BLOQUEANTES

**Ninguno.** Los dos de `review_265.md` están cerrados y **verificados con mutación por mí**, no
leídos de la bitácora.

### Menores

**Heredados y abiertos con motivo cierto** (seccion 5): **`m2`** (la mitad de `F6` que solo se ve en
preview, **pre-release**), **`m8`** (la entrada de `history.md`, del leader) y **`m10`** (la mina de
`getByRole("alert")`, abierta a propósito).

**Nuevos, todos de bookkeeping y ninguno de comportamiento:**

- **`m12` · `C5` ya está desbloqueada y `tasks.md` no lo sabe.** La ficha de H1 **existe: es la 270**
  (`geocode_precision` se escribe y no lo lee nadie), registrada el 2026-08-23, y su propia nota dice
  «**DESBLOQUEA `C5` de la 265**». `tasks.md` sigue diciendo «**H1 no tiene ficha**» (medición
  fechada del 2026-08-22, correcta entonces) y la tabla de cabecera la da como viva por ese motivo.
  Con H2 resuelto y H1 registrado, **C5 se puede cerrar**: de las cinco tareas vivas, en sustancia
  quedan **cuatro**. Es del **leader**.
- **`m13` · `progress/current.md` quedó atrás.** Sigue diciendo que la 265 debe «**11 menores**», que
  `google-route-optimization.ts:208` «miente», que el diseño llama «el único sitio donde el `WHERE`
  real se mira» a un archivo mockeado, y que **H1 no tiene ficha**. Las cuatro cosas ya no son
  ciertas. Importa porque `current.md` es lo primero que lee la sesión siguiente. Es del **leader**.
- **`m14` · `tasks.md` `B16` dice «son 31» mutaciones**; el diseño tiene **37** filas y lo dice con
  letras. Desfase de una línea, del cierre de menores.
- **`m15` · El barrido de `m5` no fue exhaustivo, aunque su tabla lo da por cerrado.** Dice que «la
  única otra copia viva estaba en el glosario de `requirements.md`», y quedan dos más con el marco
  antiguo: `tasks.md:394` (criterio de hecho de `B25`: «`RUTA_DEBUG_LOG` deja claro que **se apaga con
  `0`**», cuando lo que se escribió en `.env.example` —mejor— es «**enciende** … APAGADA por
  defecto») y `design.md:454` («y con `RUTA_DEBUG_LOG=0` (P4)…»). **Ninguna hace daño** y el archivo
  que el operador lee está bien. Y una que **no** hay que «arreglar»: `requirements.md:510` describe
  el estado del código **en el momento de decidir P7** —es el registro fechado de la decisión— y ahí
  la frase vieja es la correcta.

---

## 10 · Lo que conviene decir a favor

- **Las dos afirmaciones centrales del arreglo se sostienen bajo mi propia mano.** `M-ae` y `M-ah`
  reproducidas **en las dos direcciones**, con el árbol restaurado y verificado cada vez. En una casa
  donde un arnés ya reportó «9/9 supervivientes» sin ejecutar un test, eso no es un trámite.
- **Se midió antes de arreglar.** `m7` no dice «ahora está probado»: dice **39 tests de 40 sobreviven
  a reordenar las guardas**, y lo demuestra corriendo la mutación contra el archivo anterior. Lo mismo
  `m3`, con `RepartoModule` sobreviviendo entero a que se borre el `dashArray`.
- **Lo que no se pudo cerrar se dice con precisión y sin adorno**, que es más difícil que cerrarlo:
  `m2` no dice «no se pudo», dice **por qué el experimento no tiene poder de resolución en local**.
- **Los tres comentarios corregidos conservan lo que decían antes** en vez de borrarlo, así que el
  siguiente lector no lee un cambio arbitrario sino una enmienda fechada.
- **Cero líneas de lógica en dos PRs de cierre de hallazgos.** Lo que cambió es qué se pone rojo.

---

## Veredicto

**OK.** **0 bloqueantes** y **7 menores** —3 abiertos a propósito con motivo verificado, 4 de
bookkeeping—, ninguno de comportamiento. Gate completo verde en mi propia corrida (`INIT_EXIT=0`,
17.866 tests), trazabilidad completa de los 49 requisitos, y las tres piezas que cambiaron **medidas
con mutación por mí**.

⚠️ **Esto no es un pase a `done`.** Antes de cerrar la ficha faltan, y son del leader o de la
release: **C3** (re-medir M1 con `ruta_optimizada_parada` con filas, y **parar y preguntar** si el
máximo legítimo se acerca a 200 km), **C7**, **C8** (contar los `optimizacion_ruta` en `failed`
posteriores al despliegue), la mitad de **`F6` en preview** (`m2`) y la entrada en `history.md`
(`m8`). **C5** ya se puede marcar (`m12`).
