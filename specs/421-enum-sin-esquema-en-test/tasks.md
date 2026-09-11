# 421 — tareas

- [x] **T1. Censo.** Barrer `tests/` con tokenizador y contar consultas a catálogos sin acotar.
  *Hecho cuando:* hay un número, por archivo y línea. → 37 en 21 archivos (de 162 totales).
- [x] **T2. El helper.** `etiquetasDeEnum(cliente, tipo)` en `tests/integration/db/_postgres-real.ts`,
  acotando `n.nspname = 'public'`.
  *Hecho cuando:* typecheck verde y el archivo que enrojeció lo usa en sus 3 consultas.
- [x] **T3. El caso rojo (R1+R2).** `tests/integration/db/catalogo-consulta-acota-esquema.test.ts`:
  segundo esquema con su propio `notificacion_evento`; la consulta nueva ve 1 tipo, la vieja ve 2.
  *Hecho cuando:* con la consulta vieja en el helper el archivo sale **ROJO**, y con la nueva verde.
  Las dos corridas pegadas en la bitácora.
- [x] **T4. Limpieza (R6).** `finally` + `afterAll`, y barrido de huérfanos por edad.
  *Hecho cuando:* tras correr el archivo, `pg_namespace` no tiene esquemas `p421_%`.
- [x] **T5. Las otras 36.** Acotar en sitio, catálogo por catálogo. [P] con T3.
  *Hecho cuando:* el censo de T1 da **0** y los archivos tocados siguen verdes (R7).
- [x] **T6. La guardia (R3+R4+R5).** `tests/unit/db/catalogo-esquema-acotado.guardia.test.ts`,
  con autocomprobación sobre muestras sintéticas.
  *Hecho cuando:* la guardia está en verde sobre el árbol y roja sobre la muestra sin acotar.
- [x] **T7. Mutación de control.** Quitar el filtro de esquema del helper y comprobar que **muere**
  el caso de T3; reintroducir una consulta sin acotar y comprobar que **muere** la guardia.
  *Hecho cuando:* las dos salidas rojas están pegadas en la bitácora, con su nombre de test.
- [x] **T8. Gate completo** (`./init.sh`, sin tocarlo) + bitácora `progress/impl_421.md` + PR.
  *Hecho cuando:* `INIT_EXIT=0` escrito **dentro** del log, `skipped` = 26 y ninguno de
  `integration/db`.
