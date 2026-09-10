# 407 — Bitácora del FRONTEND: autorizar la asignación de una orden sin ubicación

> **Alcance de este documento: SOLO el frontend (T7–T11 + T8).** El backend (T1–T6) lo escribió
> otro agente sobre la rama base y su bitácora es `progress/impl_407_backend.md`. Aquí no se ha
> tocado ni un archivo de `lib/`, `db/` ni `app/api/`.

- **Rama:** `feat/407-autorizar-asignacion-sin-ubicacion-frontend`
- **Rama base:** `feat/407-autorizar-asignacion-sin-ubicacion` en `74e055c4` (backend completo)
- **Spec:** `specs/407-autorizar-asignacion-sin-ubicacion/{requirements,design,tasks}.md`
- **Commits del frontend:** `65cf8e2f` (vocabulario + guardias), `1a53fb5f` (los dos modales)

---

## 1. Qué se hizo, en una frase

Tras un intento de asignación bloqueado, los dos modales ofrecen **autorizar y asignar** las
órdenes que el gate bloqueó por una dirección que el mapa no reconoce; el operador lee la
consecuencia **antes** de decidir; la confirmación lanza **una sola** petición con la marca,
**acotada a las autorizables**, y el manifiesto **acumula** lo asignado en las dos peticiones.

---

## 2. Archivos

### Producción (3, exactamente los del design §9 «Frontend»)

| Archivo | Cambio |
| --- | --- |
| `app/(app)/_components/geocodificacion-motivo-messages.ts` | `MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION` (§5.1), `mensajeAsignadasSinUbicacionAutorizada(n)` (§5.2), `LABEL_AUTORIZAR_SIN_UBICACION` y el reexport de `esMotivoAutorizableSinUbicacion` |
| `app/(app)/ordenes/_components/AsignarBodegaModal.tsx` | panel de autorización en las dos fases, segunda petición acotada, manifiesto acumulado, aviso agregado propio |
| `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx` | espejo exacto |

**Cero archivos de backend tocados.** El diff del frontend son 10 archivos: 3 de producción y 7
de tests, y ninguno vive bajo `lib/`, `db/`, `app/api/` ni `components/`.

### Tests (7)

| Archivo | Qué |
| --- | --- |
| `tests/components/AsignarBodegaModal.autorizacion.test.tsx` | **nuevo**, 22 casos (T10) |
| `tests/components/AsignarSateliteModal.autorizacion.test.tsx` | **nuevo**, 22 casos (T11), espejo |
| `tests/unit/guards/autorizacion-texto-no-miente.guardia.test.ts` | **nuevo**, 20 casos (T9) |
| `tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` | ampliado (T8): el octavo estado en `MOTIVOS_DEL_GATE` + el bloque «los dos modales importan el predicado del MISMO módulo» |
| `tests/unit/components/geocodificacion-motivo-messages.test.ts` | ampliado (T7): 42 → 74 casos |
| `tests/components/AsignarBodegaModal.test.tsx` | **una** aserción acotada (ver §5) |
| `tests/components/AsignarSateliteModal.test.tsx` | **una** aserción acotada (ver §5) |

---

## 3. Mapa `R<n>` → test

Solo se listan los requisitos con parte de frontend. R1–R9 los cubre el backend y están en
`progress/impl_407_backend.md`; aquí no se rehacen.

| R | Test que lo cubre | Archivo |
| --- | --- | --- |
| **R10** | «con `sinUbicacionAutorizada: 2`, el aviso de la 407 y NO el de la 400» · «sin ninguna autorizada, el aviso de la 407 no aparece por ningún lado» (`toBe("Mensajero asignado a 1 orden(es).")`, exacto) | `AsignarBodegaModal.autorizacion` · `AsignarSateliteModal.autorizacion` |
| **R11** | «las dos cifras conviven sin mezclarse — una de la 400 y una de la 407»: el mismo toast contiene **los dos literales enteros**, escritos a mano, y ninguno sustituye al otro | ídem |
| **R12** | **Guardia:** `autorizacion-texto-no-miente.guardia` — el cuerpo de la función de la 407, leído del árbol sin comentarios, no contiene «no de la dirección», «problema del sistema» ni «Se ubicará más tarde»; y para `n = 1, 2, 7, 42` los dos avisos son distintos (esta mitad es la que caza el alias). **Comportamiento:** «con %i, NO dice…» y «los dos avisos son textos DISTINTOS». **UI:** el toast de la 407 no contiene ninguna de las dos frases | `autorizacion-texto-no-miente.guardia` · `geocodificacion-motivo-messages` · los dos de modal |
| **R13** | «con UNA orden, el literal exacto en singular», «con %i órdenes, el literal exacto en plural y con la cifra dentro», «con %i órdenes no hay aviso — cadena vacía», más «sin siglas ni jerga interna» — **todos contra el texto escrito a mano en el test**, copiado de design §5.2 | `geocodificacion-motivo-messages` |
| **R14** | «el literal de la consecuencia está en el documento ANTES de pulsar el control» (y la segunda petición aún no ha salido: `toHaveBeenCalledTimes(1)`) · «es EXACTAMENTE el literal aprobado en design.md §5.1» · «dice que la orden no tiene punto en el mapa, que irá al final y que no entra en el recorrido» | los dos de modal · `geocodificacion-motivo-messages` |
| **R15** | «el id interno de la orden NO aparece en el DOM, ni el teléfono» (bodega) · «ni el id interno, ni la dirección, ni el teléfono» (satélite) · «el texto de la consecuencia no lleva ni un dígito» · «el aviso agregado con %i solo lleva la cifra» (se le quita la cifra y no queda ni un dígito) · «la firma solo admite un `number`» (arity) | los dos de modal · `geocodificacion-motivo-messages` |
| **R16** | **R16-a** «`conflict` (nada asignado) pinta el panel Y el toast de error sigue saliendo» · **R16-b** «`partial` pinta el panel JUNTO a la lista de bloqueadas, sin pisarla» (se comprueba que ninguno contiene al otro) · **R16-c** «`geocodificacion_en_curso` no ofrece autorizar nada», y los otros tres estados de cola en tabla parametrizada · «un `ok` limpio no ofrece nada» | los dos de modal |
| **R17** | **Guardia T8:** los dos modales importan `esMotivoAutorizableSinUbicacion` del **mismo** módulo, con su no-vacuidad; el barrido de literales del gate sobre el código real de los dos modales, ya con **ocho** estados; y la contraprueba de un modal que filtrara por el literal a mano. **Comportamiento:** solo el desenlace determinista es autorizable; los cuatro de cola no | `geocodificacion-motivo-por-orden-mismo-modulo.guardia` · `geocodificacion-motivo-messages` |
| **R18** | «tras confirmar, se lanza UNA sola petición más, con la marca y el MISMO conjunto» — `toEqual` sobre el **argumento capturado**, no sobre el número de llamadas · «en la ruta `partial` la segunda petición NO reenvía el lote entero» · «pulsar dos veces no dispara dos peticiones» · **y su contraste**: «la PRIMERA petición no lleva ninguna marca» (R5) | los dos de modal |
| **R19** | «el panel identifica la orden por su número de remisión» · «el id interno NO aparece en el DOM» (los ids de las fixtures son uuids de verdad, para que las dos cosas se puedan medir) | los dos de modal |
| **R20** | «una asignada en la primera petición y otra en la segunda → el manifiesto pide las DOS»: se pulsa **Descargar manifiesto** y se afirma sobre el lote que el botón le pide al servidor · «la orden recién autorizada deja de figurar como bloqueada» | los dos de modal |

Extra que el spec no pedía y el control merece: **R3 hostil** — «la marca NO se contagia a la
orden del lote que no es autorizable» (el panel no la enseña y el conjunto enviado no la lleva);
y **R9 en la UI** — «al reabrir el modal la autorización NO sobrevive».

---

## 4. Mutaciones

Regla que se siguió: **cada caso nuevo se mató con una mutación antes de creérselo.** Son **15**,
aplicadas con un script que revierte al terminar y **comprueba por sha256 que los cuatro archivos
vigilados vuelven byte a byte a su estado previo** (`revert limpio: True`) — porque un arnés de
mutaciones que no demuestra que ejecutó algo ya mintió en este repo. Los conteos de rojos/verdes
de cada fila son la prueba de que la suite corrió de verdad: cambian mutación a mutación.

| # | Mutación | Qué rompe | Resultado |
| --- | --- | --- | --- |
| 1 | el modal ofrece autorizar CUALQUIER motivo bloqueado (se cae el predicado) | R2/R16-c/R17 | **MATA** — 12 rojos |
| 2 | la segunda petición reenvía el LOTE ENTERO en vez de las autorizables | R18/R3 | **MATA** — 1 rojo |
| 3 | la segunda petición NO lleva la marca | R18 | **MATA** — 2 rojos |
| 4 | el manifiesto se queda con la ÚLTIMA respuesta (no acumula) | R20 | **MATA** — 1 rojo |
| 5 | el aviso de la 407 pasa a ser un ALIAS del de la 400 | R12/R13 | **MATA** — 20 rojos |
| 6 | el panel solo existe en la fase resultado (desaparece de la ruta `conflict`) | R16-a | **MATA** — 14 rojos |
| 7 | el literal de consecuencia no se pinta (el operador autoriza a ciegas) | R14 | **MATA** — 2 rojos |
| 8 | el panel identifica las órdenes por su id interno en vez de por remisión | R19/R15 | **MATA** — 10 rojos |
| 9 | recoger las autorizables DESPUÉS del `throw` (no se ven en la ruta `conflict`) | R16-a | **MATA** — 16 rojos |
| 10 | el modal satélite decide con un literal propio en vez del predicado compartido | R17 (guardia T8) | **MATA** — 3 rojos |
| 11 | el satélite no manda la marca en su segunda petición | R18 (satélite) | **MATA** — 2 rojos |
| 12 | `MOTIVOS_DEL_GATE` pierde el octavo estado (la lista a mano se queda atrás) | T8 | **MATA** — 1 rojo |
| 13 | la cifra de la 400 se cuenta con el texto de la 407 (las dos causas se mezclan) | R11/R12 | **MATA** — 1 rojo |
| 14 | la lista de bloqueadas deja de excluir a la recién autorizada | R20 | **MATA** — 1 rojo |
| 15 | la autorización sobrevive a la reapertura del modal (se queda pegada) | R9 (UI) | **MATA** — 1 rojo |

**Ninguna sobrevivió. Supervivientes: 0.**

Las que más importan son la **2** y la **4**, porque son las dos que el propio spec señala como
«fáciles de romper» y ninguna de las dos rompería nada visible: la 2 haría que el writer abortara
el lote entero con «estado de origen no permitido» **solo en la ruta `partial`**, y la 4 produciría
un manifiesto al que le falta media asignación **sin un solo test rojo**. Y la **10**, que es la
que demuestra que el guardia de T8 no es decorativo: un modal que decide con su propio literal
pasa todos los tests de componente.

---

## 5. Las dos aserciones ajenas que se acotaron, y por qué no es aflojar un contrato

`AsignarBodegaModal.test.tsx` (T5.1) y `AsignarSateliteModal.test.tsx` (T6.1), las dos de la
**feature 368**, hacían:

```ts
expect(await screen.findByText(/NA-138/)).toBeInTheDocument();
expect(screen.getByText(/Dirección no encontrada/)).toBeInTheDocument();
```

Ese `NA-138` es una orden bloqueada por dirección irresoluble, así que **desde esta ficha aparece
también en el panel que ofrece autorizarla** y `findByText` sobre todo el documento encuentra dos
(`Found multiple elements`). Se acotaron a la lista de bloqueadas:

```ts
const bloqueadas = await screen.findByRole("alert");
expect(within(bloqueadas).getByText(/NA-138/)).toBeInTheDocument();
expect(within(bloqueadas).getByText(/Dirección no encontrada/)).toBeInTheDocument();
```

**Por qué esto no es cambiar un literal que era el contrato.** Lo que la 368 fijó (R10/R11) es
que *la orden bloqueada se identifica por su número de remisión y lleva el mensaje de SU propio
motivo*, y eso se sigue afirmando entero — ahora **en el sitio donde R10/R11 lo exigen**. Lo que
se retira es la suposición incidental de que ese texto aparecía **una sola vez en todo el
documento**, que nunca fue el requisito. La aserción acotada es de hecho más estricta: antes
habría pasado si el número apareciera en cualquier rincón del modal; ahora tiene que estar dentro
de la lista de bloqueadas.

Ningún test se borró y ninguna expectativa se relajó. Los 61 casos de esos dos archivos siguen
verdes.

---

## 6. Dos decisiones de implementación que conviene leer

### 6.1. `role="status"` en la consecuencia, y no `role="alert"` como sugería el design §4.2

El design proponía `role="alert"`. Se usa `role="status"` (y un `<section aria-label>` para el
panel entero) por dos razones que van en la misma dirección:

1. **A11y:** `alert` es el canal **asertivo**, para información importante y urgente que
   interrumpe. El panel no es un error: es una decisión que se **ofrece**. El error del modal es
   la lista de órdenes bloqueadas, que ya es el único `role="alert"` de esa pantalla; un segundo
   `alert` competiría con ella por la misma atención.
2. **No romper al vecino:** el caso `R35` de la feature 400 hace `findByRole("alert")` **en
   singular** sobre un `partial` con dirección irresoluble para comprobar que los dos avisos no
   comparten contenedor. Con un segundo `alert` ese caso se cae por ambigüedad, y habría que
   tocar una aserción ajena para poder pintar un panel que no es un error.

El literal aprobado no se toca: solo el rol con el que se anuncia. Los tests lo localizan por su
texto y por `getByRole("region", { name: … })`.

### 6.2. R20 se mide por donde el operador lo sufre

El manifiesto acumulado podría afirmarse mockeando `ManifiestoResultado` y leyendo sus props —
pero eso metería el uuid en el DOM y haría imposible medir R19 en el mismo archivo. En su lugar
se mockea `obtenerManifiesto` y **se pulsa el botón de descarga**, afirmando sobre el lote que el
botón le pide al servidor:

```ts
expect(obtenerManifiestoMock).toHaveBeenCalledWith({
  flujo: "generacion_guia",
  ordenIds: [ID_ASIGNABLE, ID_IRRESOLUBLE],
});
```

Es el camino real y completo, no una prop interceptada.

---

## 7. El gate

`./init.sh` **completo**. El rápido **se negó solo**, exactamente como predijo el design §9-3 —
el diff de la rama incluye el backend, que toca `lib/types/**`:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/types/orden-guia.ts
    lib/types/recepcion-satelite.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

El `.env` se copió al worktree a propósito, con el mismo criterio que el backend: sin él,
**~147 archivos de `tests/integration/db` se saltan** y la suite terminaría verde sin haber tocado
la capa de datos.

### La corrida — `1a53fb5f` — `INIT_EXIT=0`, **verde**

Log completo: `scratchpad/gate-407-front-1.log` (11.612 líneas; no se canalizó por `tail`, que
trunca el fichero en origen, y el `INIT_EXIT` se escribió DENTRO del log — un `echo` posterior
puede tapar el código de salida y hoy mismo un gate rojo llegó disfrazado de exit 0).

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 152 archivos de tests contra Postgres SI se ejecutan

 Test Files  1854 passed (1854)
      Tests  27014 passed | 26 skipped (27040)
   Duration  700.30s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1854 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` se leyeron, no solo el exit.** Son **26**, la misma cifra exacta que en las cuatro
corridas del backend, y **ninguno es un archivo entero**: son casos sueltos dentro de suites que
sí corrieron (`AnaliticaPage.test.tsx` 17, `AnaliticaShell.test.tsx` 9). Los **152 archivos de
`tests/integration/db`** se ejecutaron: el gate lo dice con su nombre y su cifra porque el `.env`
está presente. Ningún requisito de esta ficha depende de ellos —no se añade ni un test contra
Postgres— pero la cifra se anota igual.

**Una sola corrida y sin contención.** El leader avisó de otro agente escribiendo contra la misma
base local (síntoma `40P01`, «se ha detectado un deadlock», con 0 tests fallidos), y al backend le
pasó con **tres** archivos distintos de `tests/integration/db`. Aquí no apareció: los 1854 archivos
pasaron a la primera. No hay, por tanto, ninguna «segunda corrida aislada» que reportar — no hubo
nada que reproducir.

**El aviso amarillo de `down.sql` es preexistente y ajeno:** son tres migraciones del 2026-08-14
(la familia de ruta optimizada). Esta ficha **no toca `db/`**: ni una migración, ni el esquema, ni
una consulta.

### Poda del baseline (T14)

`tests/baseline-rojos.json` tiene hoy `"archivos": {}` — la lista está **vacía** tras las podas del
2026-08-28 y del 2026-09-03. El gate no propuso podar nada. **No se toca.**

---

## 8. Comandos sueltos

```
pnpm run typecheck   → sin errores
pnpm run lint        → 0 errores (183 warnings preexistentes, NINGUNO en archivos de esta ficha)
```

---

## 9. Lo que queda abierto

1. **No se ha visto la pantalla en un navegador.** Todo lo de arriba está medido con tests de
   componente sobre jsdom, que es lo que este arnés pide de un `frontend_dev`. Este repo tiene
   una lección propia al respecto: «ver la app encuentra lo que la suite no» —Playwright halló en
   minutos 7 textos rotos que 12.000 tests daban por buenos—. Lo que **no** cubren estos tests es
   cómo se ve el panel: si el bloque cabe sin desbordar el modal con un lote de veinte órdenes
   autorizables, y si el contraste del `bg-muted/40` es el que toca en los dos temas. Una pasada
   con la app levantada cerraría eso.
2. **Ningún defecto del backend encontrado.** El contrato que dejó documentado
   (`esMotivoAutorizableSinUbicacion`, el `autorizarSinUbicacionIds: string[]` de uuids, el
   `sinUbicacionAutorizada?` ausente en cero) se consumió tal cual y encajó sin una sola
   corrección. No se tocó ni un archivo suyo.
3. **`role="status"` en vez del `role="alert"` que sugería el design §4.2**, con su razonamiento
   en §6.1 de este documento. Es la única desviación del design y no afecta a ninguno de los dos
   literales aprobados. Si el reviewer prefiere `alert`, el cambio es de una palabra — pero
   arrastra tocar la aserción `findByRole("alert")` del caso R35 de la feature 400.
4. **El `.env` se copió al worktree** para que los 152 archivos contra Postgres se ejecutaran de
   verdad. Es el mismo criterio que siguió el backend, y está fuera del commit (`.env` está en
   `.gitignore`). El worktree también tiene su propio `node_modules` (`pnpm install
   --prefer-offline` + `prisma generate`), porque `git worktree add` no lo lleva.

---

## 10. Veredicto

Frontend completo y medido: los dos modales ofrecen autorizar en las dos rutas de un intento
bloqueado, con el literal de la consecuencia delante y solo para el desenlace determinista; la
segunda petición va acotada a las autorizables y lleva la marca; el manifiesto acumula lo asignado
en las dos peticiones; los dos avisos agregados conviven sin mezclarse y el de esta ficha no puede
volver a decir lo que dice el de la 400. **R13–R20 cubiertos, más la mitad cliente de R17 y R12.**
15 mutaciones aplicadas y 15 muertas, con revert verificado por sha256. Gate completo en verde a la
primera: `INIT_EXIT=0`, 1854 archivos y 27.014 tests, sin un solo rojo nuevo.
