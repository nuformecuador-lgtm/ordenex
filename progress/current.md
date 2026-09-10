# Estado — sesión del 2026-09-10

## Lo desplegado hoy

**Release PR #774**, `prod` en `46662bea`, despliegue **READY verificado** (no solo el PR mergeado).
Cero errores de runtime tras el despliegue y los dos jobs recurrentes con su fila del día siguiente.
**Sin migraciones.**

| Ficha | PR | Qué cierra |
|---|---|---|
| **404** | #770 | el mensajero viaja en el webhook, el listado y el detalle |
| **405** | #771 | el detalle expone el historial de gestiones |
| **406** | #772 | el enlace de evidencias deja de dar 404 garantizado |
| **407** | #773 | el operador puede autorizar la asignación de una orden sin ubicar |

Con eso, **lo que pidió el integrador el 2026-09-07 está completo**, fase 2 incluida. Su webhook
lleva entregando desde anoche: 340 eventos, cero fallidos.

Manual para él en `docs/api/manual-metricas-por-mensajero.md`. **La única puerta que sigue abierta
de esa release es mandárselo**: el CHANGELOG *es* el aviso.

## En curso ahora mismo

`dev` en `2d790a13`. Diseño de notificaciones aprobado por el humano, commiteado en
`design-notificaciones/` y publicado como lienzo.

| Ficha | Estado |
|---|---|
| **408** — el motivo de un rechazo automático se lee en lenguaje humano | **en `dev`** (PR #775) |
| **409** — el panel accionable, los atajos, la campana y dos avisos nuevos | backend en su rama; frontend implementándose |
| **411** — cohorte de carga en analítica | backend en su rama; frontend implementándose |
| **410** — notificaciones push | spec listo (52 req.); **entra cuando la 409 esté en `dev`** |
| **412 · 413 · 414** | registradas, sin empezar |

**169 requisitos especificados**, todos con test asignado y cero preguntas abiertas.

## ⚠️ Lo que hay que mirar antes de desplegar esto

1. **Mandarle el manual al integrador** (deuda de la release ya desplegada).
2. **Nadie ha visto en un navegador** el panel de la 407 ni el aviso de la 400. Todo medido en jsdom.
3. **3 de 18 mensajeros usan SOLO iPhone** (medido sobre ingresos reales): sin instalar la app en su
   pantalla de inicio, **no recibirán push**. No lo arregla el código.
4. **T7.5 de la 409, ya medida**: `por_devolver` tiene 27 órdenes y 7 pasan de 3 días — el umbral
   aguanta. Pero `por_devolver_a_tienda` está **vacío** y las 27 son de **una sola tienda**: tras
   desplegar, no ver nada de ese ámbito **puede ser lo correcto**.

## Decisiones del humano de hoy, para no reabrirlas

- **El plazo de los 5 días se cuenta desde que el paquete entra a bodega**, no desde el reporte del
  mensajero. Verificado que NO acumula entre intentos: el reloj se reinicia con cada devolución.
- **La autorización de asignar sin ubicación NO deja rastro** (407): decidido a sabiendas.
- **El vocabulario de las causas es el aprobado en la 73**, no uno nuevo.
- **Umbral de represamiento: 3 días, sobre `por_devolver`.** `devolviendo_a_tienda` NO se vigila:
  247 órdenes y ninguna pasa de día y medio — vigilarlo sería ruido sobre el cubo más grande.
- **Criterio del atajo**: «¿le acerca esta pantalla a resolverlo?», no «¿puede ejecutar la
  transición?». `geocodificacion_caida` es el único accionable sin atajo, y es deliberado.

## Deuda y hallazgos abiertos

- **Los rojos de `notificacion-evento-*-migration`** en gates ajenos son de la **base local
  compartida**, que tiene la migración de la 409 aún sin mergear. Medido dos veces, incluso contra
  `dev` limpio. **No se metió nada en `tests/baseline-rojos.json`**: se resuelve solo al mergear.
- **Otro localizador por fecha, latente**: `tests/unit/api/openapi-374-nodo-retirado.test.ts:118-127`
  ata su aserción a `2026-09-06`. Su gemelo ya explotó hoy.
- **~45 worktrees huérfanos** en `.claude/worktrees/`.
- **270** sigue `pending`: `geocode_precision` no lo lee nadie.

## Lecciones de esta sesión, medidas

- **El `INIT_EXIT` dentro del log salvó dos gates.** Dos corridas ROJAS llegaron anunciadas como
  «exit code 0». No es paranoia: es el comportamiento por defecto.
- **`git checkout` sobre archivos sin commitear mordió a dos agentes distintos.** Uno perdió dos
  correcciones y las detectó por un `grep` de comprobación; otro descartó una tanda entera de
  mediciones por contaminación. **Commitea antes de mutar.**
- **Una guardia impidió un texto que mentía**: al derivar por segunda vez el ancla de la devolución,
  el aviso habría dicho «3 días» sobre una orden a la que el cron le cuenta 5.
- **Un escenario imposible no prueba nada**: en la 405, una `devuelta` SIN foto describía un estado
  que no puede existir, y por eso una mutación sobrevivía a **9.446 tests en verde**.
- **Un requisito puede ser inalcanzable por construcción** (R19 de la 405): lo falso era la premisa
  del design, no la implementación.
- **Ver el rojo antes del arreglo**: el cierre de lazo de la 406 daba 404 en sus 4 casos, y el
  reviewer lo reprodujo revirtiendo el fix — 22 rojos en 4 archivos.
- **El diseño prometía lo que no existía.** Dos avisos del lienzo no tenían productor; se
  descubrieron al comprobar cada uno contra el código, no leyendo el mockup.
