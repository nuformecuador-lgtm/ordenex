# 133 — analítica: recortes por rol · tasks

> Orden estricto salvo donde se marca `[P]` (paralelizable). Cada task lleva su **criterio de
> hecho** y los `R<n>` que cierra. Ninguna task de código arranca antes de cerrar **T0.1** y
> **T0.2** (bloqueantes).
>
> **Gate:** los subagentes corren `pnpm typecheck`, `pnpm lint` y `vitest related --run` de sus
> archivos. `./init.sh --rapido` al cerrar cada tanda y `./init.sh` completo antes del PR — lo
> corre el **leader** (`AGENTS.md > Regla del gate`).

---

## T0 — Puerta F1.4 (espejo de `requirements.md §5`)

> **PUERTA CERRADA el 2026-08-04.** El humano respondió las dos bloqueantes con la recomendación
> escrita y no objetó las cinco restantes.

- [x] **T0.1 — Q1 · BLOQUEANTE. RESUELTA: SÍ a los tres roles, y las constantes se FUNDEN
      DERIVANDO.** `ROLES_ACCESO_ANALITICA` pasa a derivarse de `ROLES_ANALITICA` (una sola
      declaración), y el caso (b) del guard de no-convergencia se **REEXPRESA** para vigilar que la
      derivación siga existiendo —que nadie vuelva a escribir la lista a mano—, **nunca se borra ni
      se relaja**. El propio guard trae esa salida escrita en sus líneas 34-38. El caso (a)
      —acceso ⊆ dominio— se conserva intacto.
- [x] **T0.2 — Q2 · BLOQUEANTE. RESUELTA: `mensajero` y `adminSatelite` CONSERVAN su aterrizaje
      actual** (R5). Un tablero de indicadores no es donde empieza el turno de nadie: `/analitica`
      se excluye del cálculo de `primerDestino` y **T5 entra en el alcance**.
      **Por qué importa más de lo que parece:** este cambio habría sido **silencioso**. El test que
      cubre el aterrizaje deriva el valor esperado de la misma función que juzga, así que no se
      habría puesto rojo y el desvío se habría descubierto por una llamada de un mensajero. El test
      nuevo debe enumerar los cinco roles y afirmar su destino **por valor**, no por derivación.
- [x] **T0.3 — Q3 a Q7 · no bloqueantes. SIN OBJECIÓN**, se aplican las recomendaciones: ocultar la
      faceta que el alcance ya fija (Q3); no ofrecer selectores cuyo catálogo responde `forbidden`,
      para no dejar controles muertos (Q4); rótulo por tipo de alcance, sin identificadores (Q5);
      E2E de los 3 roles nuevos + `maestro` (Q6); y la ficha del oráculo **ya registrada por el
      leader como la 184** (Q7).

---

## T1 — Módulo de recorte (servidor, puro)

- [x] **T1.1** Crear `lib/analytics/presentacion.ts`: `Faceta`, `RecortePresentacion`,
      `recorteDePresentacion(actor)`. Deriva el `alcance` de `resolverAlcance` (D5). Devuelve
      **enums y arrays de strings**: ni filas, ni ids, ni nombres.
      **Hecho:** `pnpm typecheck` limpio; el módulo importa sólo de `lib/analytics/**`. → **R18**
- [x] **T1.2** `tests/unit/analytics/presentacion.test.ts`: para los cinco roles, `facetas` = las
      tres menos la del `tipo`; `global` ⇒ las tres; sin actor ⇒ `denegado` y **cero** facetas; y
      el `tipo` es idéntico para **todas** las métricas operativas del catálogo.
      **Hecho:** test verde y con una mutación matada (devolver siempre las tres facetas lo pone
      rojo). → **R18**
- [x] **T1.3 `[P]`** Comprobar que `modulo-puro.guardia.test.ts` sigue verde con el archivo nuevo.
      **Hecho:** guardia verde sin tocarlo. → **R20**

## T2 — Abrir la ruta y el menú (depende de T0.1)

- [x] **T2.1** `lib/auth/menu-visibility.ts`: `ROLES_ACCESO_ANALITICA` pasa a derivarse de
      `ROLES_ANALITICA` (`lib/analytics/types.ts`). **Una sola edición**; el `roles` del ítem
      sigue apuntando a la constante, no a un literal.
      **Hecho:** `menu-visibility.test.ts` R10 verde sin tocarlo. → **R1, R2**
- [x] **T2.2** Reexpresar `tests/unit/guards/roles-analitica-acceso-vs-dominio.test.ts` caso (b):
      pasa de «los conjuntos no son iguales» a «el acceso **deriva** del dominio». Los casos (a)
      y «no vacío» quedan intactos. Escribir en la cabecera **por qué** cambió y qué mutación
      sigue matando (reescribir la lista a mano).
      **Hecho:** el guard mata la mutación «`ROLES_ACCESO_ANALITICA = ["maestro","admin"]` escrito
      a mano». → **R3, R29**
- [x] **T2.3** Reexpresar `tests/unit/auth/menu-visibility.test.ts`: R9 (líneas 341-359) deja
      `apiKey` + actor nulo como excluidos y añade los tres roles como incluidos; las tres listas
      por igualdad (161-200) incorporan "Analítica" en su posición.
      **Hecho:** siguen comparando por **igualdad**; un ítem no declarado sigue rompiendo.
      → **R1, R4, R29**
- [x] **T2.4 `[P]`** Añadir el caso de rol desconocido: un `RolValue` sintético fuera del conjunto
      no ve el ítem y no pasa el gate.
      **Hecho:** test verde. → **R4**

## T3 — La región financiera: prohibida, no vacía (depende de T2)

- [x] **T3.1** `app/(app)/analitica/page.tsx`: **no se toca** la bifurcación de `esAccesoTotal`
      (D2). Verificar por lectura que los tres roles nuevos caen en la rama sin prop `financiero`.
      **Hecho:** `tablero-financiero.guardia.test.ts` verde (sigue habiendo `esAccesoTotal(` y
      ningún array con dos o más nombres de rol). → **R6, R9**
- [x] **T3.2** Reexpresar en `tests/components/AnaliticaPage.test.tsx` los bloques 129-R3 (160),
      129-R6 (201), 132-R1/R8 (273), 132-R5 (362), 132-R9 (389) y 131-R26 (440): `apiKey` y sesión
      nula siguen con `notFound`; los tres roles **entran**.
      **Hecho:** los seis bloques verdes y ninguno pasa por vacío. → **R1, R8, R29**
- [x] **T3.3** Reexpresar el bloque **132-R2** (302-331) para que corra **con la página
      renderizada**: ni la región, ni su encabezado, ni la etiqueta de métrica, ni las cifras
      (crudas y con separador), ni «sin movimientos». Conservar el doble con etiqueta y cifras
      reconocibles.
      **Hecho:** el bloque falla si se pasa la prop `financiero` a un rol acotado. → **R6, R7, R29**
- [x] **T3.4** Añadir el test de **equivalencia** con el catálogo: para los cinco roles,
      «ve la región» ⟺ `listarMetricas({ dominio: "financiera", rol }).length > 0`.
      **Hecho:** test verde; abrir una financiera a `adminTienda` en una fixture lo pone rojo.
      → **R9**
- [x] **T3.5 `[P]`** Test de que no hay control de navegación que anuncie la región (cero enlaces
      o botones cuyo nombre accesible la nombre) para los tres roles.
      **Hecho:** test verde. → **R10**

## T4 — Paneles y facetas (depende de T1 y T2)

- [x] **T4.1** `FiltrosOperativos`: prop `facetas?: readonly Faceta[]` (por defecto las tres). Una
      faceta ausente **no se dibuja** — ni deshabilitada, ni con la nota de degradado.
      **Hecho:** `FiltrosOperativos.test.tsx` existente sigue verde sin pasar la prop.
      → **R14, R16, R17**
- [x] **T4.2** `page.tsx` pasa `facetas={recorte.facetas}` y `alcance={recorte.alcance}`. Props
      **planas**; ninguna función cruza la frontera RSC.
      **Hecho:** `tablero-financiero.guardia.test.ts` (censo de props-función) verde. → **R14, R24**
- [x] **T4.3** Casos por rol en `FiltrosOperativos.test.tsx`: `adminTienda` sin «Tienda» **y sin
      «Mensajero»**; `adminSatelite` sin «Zona»; `mensajero` sin «Mensajero»; los cinco con
      «Rango».
      **Hecho:** para `adminTienda`, además, **ningún nombre** de la fixture de mensajeros aparece
      en el documento. → **R14, R15, R16, R17**
- [x] **T4.4** `PanelesOperativos`: rótulo de alcance **único**, con textos en `textos.ts` por
      **tipo de alcance** (no por rol) y sin identificadores.
      **Hecho:** presente y único para acotado, ausente para `global`; el texto no contiene uuid ni
      nombres. → **R24, R25**
- [x] **T4.5** Test de que los **seis** paneles se pintan para los cinco roles.
      **Hecho:** verde; quitar un panel para un rol lo pone rojo. → **R11**
- [x] **T4.6 `[P]`** Censo sobre los archivos nuevos/tocados de la ruta: ni `estadoProduccion`, ni
      `listarMetricas`, ni `lib/analytics/metrics`.
      **Hecho:** `tablero-catalogo-paneles.test.ts` intacto y verde; **no** se le devuelve ninguna
      aserción sobre valores concretos del campo. → **R12, R13**

## T5 — El aterrizaje post-login (depende de T0.2; sólo si la respuesta es «conservar»)

- [x] **T5.1** Marcar el ítem "Analítica" como **no elegible** como destino inicial (campo
      opcional del `MenuItem`; **no** un literal de ruta dentro de `primerDestino`).
      **Hecho:** `menu-visibility.test.ts` R16 (posición del ítem) sigue verde. → **R5**
- [x] **T5.2** Test nuevo `tests/unit/auth/destino-post-login.test.ts`: destino **por valor** de
      los cinco roles (`maestro`, `admin`, `adminTienda`, `adminSatelite`, `mensajero`).
      **Hecho:** derivar el esperado de `primerDestino` en vez de escribirlo pone el caso en rojo
      (la tautología de `HomePageMaestro.test.tsx:150` queda cubierta). → **R5**

## T6 — Presentación ≠ datos (depende de T4)

- [x] **T6.1** Ampliar `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts`: la ruta
      sigue sin importar `alcance*`/`identidad` ni invocar `resolverAlcance`; se añade
      `lib/analytics/presentacion` como **arista nominal única** con (a) censo de que no hay otras
      y (b) aserción de que su retorno no contiene campos de datos. Documentar el porqué en la
      cabecera.
      **Hecho:** el guardia detecta una arista sintética no autorizada. → **R20, R29**
- [x] **T6.2** Test de **no-sustitución** (el que impide confundir los dos recortes): para un mismo
      actor y filtro, con y sin recorte de presentación, los argumentos enviados a
      `consultarAnaliticaOperativa` son **idénticos**.
      **Hecho:** verde; y su cabecera cita el aviso de la 122 (`design.md:466-468`). → **R21**
- [x] **T6.3** Con el parámetro de una faceta oculta presente en la URL, el `raw` que viaja al
      borde es el mismo que hoy y la UI no lo silencia.
      **Hecho:** verde. → **R19**
- [x] **T6.4** `forbidden` del borde sigue pintándose como prohibido y **no** como vacío, para los
      tres roles nuevos.
      **Hecho:** verde. → **R22**
- [x] **T6.5 `[P]`** Ningún id, nombre de tienda/zona/persona ajeno aparece en el documento para un
      rol acotado.
      **Hecho:** aserción sobre `document.body`, con fixture que **sí** trae esos valores. → **R23**
- [x] **T6.6** Test de frontera del oráculo: ocultar el selector «Mensajero» **no** cambia la
      respuesta del borde ante un `mensajero_id` inyectado por otra vía — la decisión es del
      borde, no de la UI.
      **Hecho:** verde, con comentario que remite a `requirements.md §4` y **prohíbe** leerlo como
      cierre de M-4. → **R27**
- [x] **T6.7 `[P]`** Censo: no existe ningún control de guardar/fijar/compartir filtro por etiqueta
      `Mensajero N`; donde la leyenda las use, hay advertencia de no-estabilidad.
      **Hecho:** verde. → **R26**

## T7 — E2E (depende de T3, T4)

- [x] **T7.1** `e2e/analitica-roles.spec.ts` (Playwright), siguiendo el patrón de los specs
      existentes: `adminTienda`, `adminSatelite`, `mensajero` entran a `/analitica`, ven el
      tablero operativo y **no** ven rastro de la región financiera; `maestro` sí la ve.
      **Hecho:** el spec corre en el runner de e2e del repo y sus aserciones fallan si se pasa la
      prop `financiero` a un rol acotado. → **R28**

## T8 — Cierre

- [x] **T8.1** `progress/impl_133-analitica-recortes-por-rol.md`: archivos tocados, mapa
      `R1..R29 → test` completo y la **tabla de los 9 bloques rojos por diseño** con archivo,
      línea, motivo y cómo se reexpresaron.
      **Hecho:** los 29 requisitos con test nombrado; cero relajaciones. → **R29**
- [ ] **T8.2** `./init.sh --rapido` verde al cerrar cada tanda (leader).
- [ ] **T8.3** `./init.sh` **completo** verde antes del PR (leader), y **medido en esta rama**: un
      baseline citado de otra sesión no vale.
- [ ] **T8.4** PR hacia `dev` (`gh pr create --base dev`), citando en el cuerpo los rojos por
      diseño y sus reexpresiones, más la ficha propuesta del oráculo (`requirements.md §4`).

---

### Dependencias en una vista

```
T0.1 ──> T2 ──> T3 ──┐
T0.2 ──> T5          ├──> T7 ──> T8
T1 ─────> T4 ────────┘
T1, T4 ──> T6
```

`[P]` dentro de una fase: T1.3, T2.4, T3.5, T4.6, T6.5, T6.7.
