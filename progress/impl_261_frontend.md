# Feature 261 — BLOQUE FRONTEND

> Rama: `feat/261-dia-reparto-protege`. **Sin commit, sin PR** (así se pidió).
> Alcance de esta bitácora: **F1-F5 y F7**. El BLOQUE 0, el BACKEND y el CIERRE quedan fuera
> (`progress/impl_261_backend.md`). El gate (`./init.sh` completo, obligatorio en esta ficha por
> nombre de dinero) lo corre el leader.

---

## Veredicto en una línea

El bloqueo **se ve y se explica** en las cuatro superficies —las tres cards, el escáner, el botón
del pie de «Reparto» y el modal de la tienda—, con **una sola frase** que dice el día y ninguna
sigla; **9 mutaciones, 9 muertas**; y queda abierto **F6 (ver la app)**, que necesita un preview
desplegado y una cuenta de QA que no alcanzo.

---

## Lo que se decidió al implementar (y por qué), antes de la lista de archivos

**1 · El mensajero ve el control apagado; la tienda, el rechazo explicado. La asimetría está
escrita en los dos sitios.** No es comodidad y no se deduce del código: el mensajero está **en la
calle con el paquete en la mano** y enterarse al intentarlo le cuesta un viaje —o sacar la caja de
la furgoneta—; la tienda está en un escritorio, donde el rechazo es un clic y la respuesta es
inmediata. Deshabilitar también el control de la tienda exigiría meter el día en `NovedadDTO` y
derivar el booleano con un reloj en el servicio de novedades —tipo compartido, consulta, derivación
y tests— para una población que **M1 midió en 2 órdenes** (`design.md` §5.4, alternativa **A13**).
El motivo quedó **en el código** (`NovedadesModule.resolverDesdeAyuda`) y **en un test que se pone
rojo** si alguien apaga el botón «ya que estamos» (`GestionarDesdeAyudaModal.test.tsx`,
`NovedadesModule.test.tsx`): una decisión que sólo vive en un spec es una decisión que nadie relee.

**2 · La orden bloqueada NO se mueve de sitio.** Se queda en su grupo, con su badge, su posición de
ruta y su detalle completo montado. Es el patrón que el repo ya usa con el mensajero bloqueado por
un cierre pendiente (`RepartoModule`: «la deshabilitación restringe la ACCIÓN, no la visibilidad»),
y es lo que el humano firmó en **P3** descartando la sección propia (**A7**). **R9 no se
reescribió.**

**3 · Una guarda de más, declarada: `gestionarPedido`.** F3 pedía el botón de la card y
`seleccionar()`. Se añadió **además** la misma guarda suave en `RepartoModule.gestionarPedido`, y no
es adorno: **el panel de detalle arranca en la PRIMERA orden del grupo**, así que una reservada
puede estar delante sin que nadie haya pulsado ninguna card. Sin esa guarda el `conflict` del
servidor se traducía a **«Ya tienes otra orden activa en gestión.»** —falso, y manda a buscar un
problema que no existe—, que es justo lo que R13 prohíbe para el escáner. Tiene su test propio
(«y por el panel tampoco») y su mutación (**MF-g**). Lo alternativo era deshabilitar el botón del
panel, que es superficie nueva en `GestionarOrdenPanel`; no se hizo: **alcance nuevo se pregunta**.

**4 · El texto del `conflict` de recoger lo pinta el CLIENTE, con su fecha.** El servidor manda
`motivo: RESERVA_MOTIVO_SERVIDOR` (la frase **sin** día) y un `codigo` de máquina. La UI usa el
**código** para decidir —no compara prosa, que es para lo que el código existe— y pinta la variante
**con** el día, que la orden trae en `fechaRepartoISO`. Misma fuente, misma frase, más precisión
donde la hay.

---

## Archivos tocados

### Código

| Task | Archivo | Qué |
| --- | --- | --- |
| F1 | `app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts` | rechazo **antes** de llamar a la action si `esParaManana`; y la rama `conflict` con `codigo === "reservada_para_otro_dia"` pinta el mismo texto en vez del genérico |
| F2 | `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx` | la línea de aviso bajo el badge (`role="note"`), importada de la fuente única |
| F2 | `…/pos-card/PosOrderCardMosaico.tsx` | ídem |
| F2 | `…/pos-card/PosOrderCardDetalle.tsx` | ídem |
| F3 | `app/(app)/mis-asignaciones/_components/RepartoModule.tsx` | `esParaManana` entra en el `disabled` del botón «Gestionar»; `seleccionar()` la ignora; **y** la guarda suave de `gestionarPedido` (ver decisión 3) |
| F3 | `…/GestionarOrdenCardButton.tsx` | sólo la documentación de `disabled`: qué lo apaga y la regla de que el motivo va SIEMPRE en palabras al lado |
| F4 | `…/pos-card/PosOrderCard.tsx` | el comentario de la marca pasa a describir la **regla nueva** (los de Mosaico y Detalle los dejó ya el backend en su B9; **no se duplicaron**) |
| F7 | `app/(app)/novedades/_components/NovedadesModule.tsx` | sólo comentario: por este cable viaja el segundo rechazo, y **por qué el botón no se deshabilita** (A13) |

**Cero cambios en `lib/`, `db/` y `tests/integration/`**, como el bloque exigía. El único fichero de
`lib/` que este bloque **lee** es `lib/utils/dia-reparto-textos.ts` (B2, ya en la rama).

### Tests

| Task | Archivo | Qué prueba |
| --- | --- | --- |
| F5 | `tests/unit/utils/dia-reparto-textos.test.ts` **(nuevo)** | R11 (qué dice, con y sin fecha, sin siglas ni `YYYY-MM-DD`), R14 (el módulo no nombra `Date`/`Intl` **en su código**) y **R15, la fuente única**: seis superficies importan la frase y **ninguna la escribe** |
| F5 | `tests/components/PosCardParaManana.test.tsx` | el aviso **con la fecha legible** en las **tres** cards, sin fecha, la card entera (R9) y la caducidad sola (R7) |
| F5 | `tests/components/RecogerModule.test.tsx` | R13 en sus **dos ramas** (la suave y la del `conflict` con código), que el rechazo **no se disfraza**, que la de HOY se recoge igual (R8) y que la reservada **sigue en su grupo** (R9) |
| F5 | `tests/components/RepartoModule.test.tsx` | R12: el botón `disabled` **con su par positivo**, el aviso al lado, la card entera con su parada (R9/R10) y el panel (ver decisión 3) |
| F7 | `tests/components/GestionarDesdeAyudaModal.test.tsx` | el `conflict` de la reserva sube al padre intacto y **el confirmar estaba habilitado** (la asimetría, fijada) |
| F7 | `tests/components/NovedadesModule.test.tsx` | la pantalla pinta **el motivo del servidor con su día**, el control **no estaba apagado**, y no dice ni «resolvió» ni el motivo de la otra carrera |

> ⚠️ **Dos tests existentes afirmaban la regla VIEJA y había que invertirlos, no borrarlos:**
> `RecogerModule` → «R24: la orden reservada SE PUEDE RECOGER — la Server Action se llama con su
> id» y `RepartoModule` → «R24: la reservada SE PUEDE GESTIONAR — `escogerParaGestion` sí se
> llama». Eran correctos el 2026-08-20 y son falsos desde el 21. En su sitio quedan los casos de la
> regla nueva, **con la misma exigencia**: se afirma que la action **no** se llama, no que «no
> aparece un error» —que estaría verde también si no pasara nada—.
>
> Y el comentario de `PosCardParaManana` que decía que la reserva protegía del corte y no del
> mensajero se sustituyó por la regla nueva. `tests/` no está en el censo de la guardia de la B9,
> así que **ningún detector lo habría cazado**: era una mentira con vida propia.

---

## Comandos, con su salida real

```
$ pnpm run typecheck
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
                                    ← sin una sola línea de error
```

```
$ pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

> **99 = la línea base declarada en el encargo, y no sube.** Ninguno de los warnings cae en un
> archivo de este bloque (los últimos del listado son `_ordenId`, `_input`, `_err`, `_opciones` en
> tests de servicios y utils, todos preexistentes).

```
$ pnpm exec vitest run tests/components tests/unit/tablero-dia

 Test Files  235 passed (235)
      Tests  3199 passed | 26 skipped (3225)
   Duration  217.23s
```

```
$ pnpm exec vitest run tests/unit/utils/dia-reparto-textos.test.ts

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Duration  834ms
```

```
$ pnpm exec vitest run tests/unit/guards/d5-revertida.guardia.test.ts

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Duration  326ms
```

> **La guardia de la B9 en verde con el árbol del portal ya tocado**, que es lo que cierra **F4**:
> su cláusula (a) censa `app/(app)/mis-asignaciones/**` entero y no encuentra ninguna frase que
> afirme D5 como vigente.

```
$ pnpm exec vitest run tests/components tests/unit/tablero-dia \
    tests/unit/utils/dia-reparto-textos.test.ts tests/unit/guards

 Test Files  300 passed (300)
      Tests  4170 passed | 26 skipped (4196)
   Duration  221.78s
```

---

## Las mutaciones, una a una

**El arnés se autocomprueba** (en este repo ya reportó «9/9 supervivientes» dos veces sin haber
ejecutado un test): (1) si el patrón **no aparece** en el archivo, **revienta** en vez de reportar
«superviviente»; (2) el archivo tiene que **cambiar de verdad**, comparado con la copia previa y
**no con git**; (3) se imprime el **exit code real** de vitest con su recuento; (4) al restaurar se
comprueba que el contenido vuelve a ser **idéntico** al original. El arnés vivía fuera del repo
(directorio de scratch) y ya se borró.

| # | Mutación | Muere en | Salida real (exit + resumen) |
| --- | --- | --- | --- |
| **MF-a** | `avisoReservaParaOtroDia` devuelve **el texto viejo** («Esta orden es para mañana.») | textos + las tres cards | `exit=1` · `Tests 19 failed \| 26 passed (45)` — *«con la fecha del servidor, dice el DÍA en palabras»: expected 'Esta orden es para mañana.' to be 'Esta orden es para el reparto del 22 …'* y las 12 de `PosCardParaManana` |
| **MF-b** | **M-l** — la card escribe el literal en vez de importarlo | fuente única (R15) | `exit=1` · `Tests 1 failed \| 17 passed (18)` — *«PosOrderCardMosaico.tsx importa la frase de la fuente única y no la copia»: expected [ 'es para el reparto del', …(2) ] to deeply equal []* |
| **MF-c** | se quita el aviso de la card (queda el badge a secas) | `PosCardParaManana` (R11) | `exit=1` · `Tests 4 failed \| 23 passed (27)` — *«R11: la card detalle en fila dice desde QUÉ DÍA se podrá…»* |
| **MF-d** | se borra la guarda suave de recoger | `RecogerModule` (R13) | `exit=1` · `Tests 2 failed \| 32 passed (34)` — *«R13: teclear una guía reservada muestra el MOTIVO REAL y NO llama a la action»: expected "vi.fn()" to be called with arguments: [ Array(1) ]* |
| **MF-e** | el `conflict` con código vuelve al mensaje genérico | `RecogerModule` (R13, rama servidor) | `exit=1` · `Tests 1 failed \| 33 passed (34)` — *«el `conflict` del servidor con su código pinta EL MISMO texto, no el genérico»* |
| **MF-f** | se quita `esParaManana` del `disabled` del botón | `RepartoModule` (R12) | `exit=1` · `Tests 1 failed \| 87 passed (88)` — *«R12: el botón «Gestionar» de la reservada está DESHABILITADO, y el de la de hoy no»* |
| **MF-g** | se borra la guarda del panel (`gestionarPedido` escoge igual) | `RepartoModule` (decisión 3) | `exit=1` · `Tests 1 failed \| 87 passed (88)` — *«y por el panel tampoco — pulsar «Gestionar» dice el motivo y NO fija el puntero»* |
| **MF-h** | la tienda **reescribe** el motivo del servidor en vez de pintarlo tal cual | `NovedadesModule` (R32) | `exit=1` · `Tests 1 failed \| 69 passed (70)` — *«261/R32: la reserva se rechaza con palabras y con SU DÍA, y el botón NO estaba apagado»* |
| **MF-i** | el confirmar de la tienda **se deshabilita** (el alcance que A13 descartó) | `GestionarDesdeAyudaModal` | `exit=1` · *«261/R32: la reserva se rechaza con SU DÍA, y el confirmar nunca estuvo apagado por eso»* (entre otras 11) |

**9 mutaciones, 9 muertas. Ninguna superviviente**, y ninguna «murió» sin que el log muestre una
corrida con su recuento.

> **MF-h merece una línea aparte, porque es la que el test viejo NO cazaba.** La mutación sustituye
> `toast.warning(res.motivo)` por el literal *«Esta orden ya no está esperando tu respuesta.»* — y
> el caso que la 237 escribió para el `conflict` **sigue verde**, porque afirma exactamente esa
> cadena. Sin el caso nuevo, la pantalla podía dejar de decir el motivo real y ningún test se
> enteraba.

Después de la tanda: `git status` sin restos de mutación (comprobado archivo por archivo),
`pnpm typecheck` limpio y los siete archivos tocados en verde (**282 tests**).

---

## Mapa `R<n> → test` (lo que cubre este bloque)

| R | Test |
| --- | --- |
| R9 | `PosCardParaManana` («la card … sigue montada ENTERA») · `RecogerModule` («R9: y la reservada SIGUE en su grupo, contada y visible») · `RepartoModule` («R9: la card reservada NO se esconde ni se recorta») |
| R10 | `RepartoModule` (la reservada conserva su **parada de ruta**: no se degrada a «sin posición») |
| R11 | `dia-reparto-textos` (qué dice, con y sin fecha, sin siglas) · `PosCardParaManana` (las **tres** cards, con la fecha legible) · `RecogerModule` · `RepartoModule` |
| R12 | `RepartoModule` («el botón … DESHABILITADO» + **la mitad positiva** + el panel) |
| R13 | `RecogerModule` (rama suave, rama `conflict` con código, «no se disfraza», y **la de HOY se recoge igual**) |
| R14 | `dia-reparto-textos` (el módulo no nombra `Date`/`Intl` en su código, con autocomprobación del stripper de comentarios) |
| R15 | `dia-reparto-textos` (**las seis superficies importan y ninguna copia**) · `GestionarDesdeAyudaModal` y `NovedadesModule` (la frase es la que emite el servicio) |
| R7 | `PosCardParaManana` («deja de decirlo al llegar el día, sin que nadie escriba nada») |
| R8 | `RecogerModule` («la orden de HOY se recoge igual — el bloqueo no se come a las demás») |
| R24 | `d5-revertida.guardia` (a), **en verde con el árbol del portal ya tocado** → cierra F4 |
| R32 | `NovedadesModule` (pinta el motivo del servidor con su día) · `GestionarDesdeAyudaModal` (sube intacto, con el control **habilitado**) |

---

## Lo que queda abierto

### 1 · ⛔ F6 «Ver la app» — NO HECHA, y no por olvido

Necesita **un preview desplegado**, una cuenta de **mensajero de QA** y una de **tienda**, y
Playwright contra esa URL. No tengo ninguna de las tres cosas en este entorno: sin deploy no hay
dónde mirar, y el `dev` local no tiene los datos del escenario (una orden reservada para mañana en
«Por recoger», otra en «Reparto» y una de hoy).

**Por qué importa y no es un trámite:** en este repo **mirar la app encontró siete textos rotos que
doce mil tests daban por buenos**. Lo que hay que ver, en orden:

1. Mensajero, «Por recoger»: escanear/teclear la guía reservada → el mensaje con **el día**, y que
   la orden **siga en la lista** y contada en el banner.
2. Mensajero, «Reparto»: el botón «Gestionar» **gris** con el aviso al lado, en **las dos vistas**
   (mosaico y detalle) — la línea nueva es la primera de la card en mosaico y ahí es donde un texto
   largo puede romper el barrido.
3. Mensajero: una orden **de hoy**, para ver que todo funciona igual.
4. Que **KPIs y mapa no cambiaron** (R10).
5. Tienda, «Ayuda solicitada»: «Rechazar» sobre una reservada → el rechazo explicado, con su día.

**Riesgo concreto que esto deja vivo:** el aviso es la frase más larga que entra en la card de
mosaico y **ningún test mide ancho ni truncado**; jsdom no sabe de layout. Si desborda, se ve —no
se rompe—, pero se ve.

### 2 · Lo que este bloque NO tocó, a propósito

- **`NovedadDTO` y el botón de la tienda**: alternativa **A13**, descartada con su número. Está
  escrito en el código y fijado por dos tests. Si la población crece, es un cambio pequeño y
  localizado — pero es **alcance nuevo y se pregunta**.
- **El botón «Gestionar» del panel de detalle** (`GestionarOrdenPanel`): se le puso guarda suave en
  el llamador, no `disabled`. Deshabilitarlo es superficie nueva en un componente que no estaba en
  el encargo.

### 3 · Nota para quien lea el diff del backend y el mío juntos

El backend tocó **dos comentarios** de `app/(app)/mis-asignaciones/**` (`PosOrderCardMosaico`,
`PosOrderCardDetalle`) porque su **B9** dependía de F4 y dejar la guardia roja habría entregado la
suite en rojo; lo declaró en su bitácora. **No se duplicaron**: se leyeron, y F4 completó el
**tercero** que faltaba (`PosOrderCard.tsx`, la card que el portal no monta hoy pero que es
paralela a las otras dos, no una variante).

### 4 · Ninguna guardia ajena se puso roja

Se corrió `tests/unit/guards` entero (131 archivos en la corrida ampliada) además de
`tests/components` y `tests/unit/tablero-dia`: **cero rojos**. En particular la de prosa de la B9,
que es la que el backend avisó que se dispara con una **cita** del texto viejo — los comentarios
nuevos **parafrasean**, no citan.
