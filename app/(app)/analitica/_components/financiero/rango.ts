// Feature 132 (T1.2) — la UNICA constante de rango del tablero financiero (R26).
//
// Que es `mes`: el preset de ventana MOVIL de 30 dias del resolutor de rangos
// (`lib/analytics/ranges.ts`, D3 de la 135). No es el mes calendario, y esa
// diferencia esta documentada alli a proposito; aqui solo se elige el preset.
//
// Por que `mes` y no otro (decidido en T0.1 / Q1 del spec): un tablero
// financiero abierto en `dia` a las 08:00 sale casi todo en cero y se lee como
// una averia del sistema, no como "todavia no hubo movimiento". `semana` (borde
// de calendario, desde el lunes) tiene el mismo problema los lunes por la
// manana, y `personalizado` exige dos fechas que aqui nadie puede elegir
// mientras no exista la barra de filtros.
//
// Por que UN objeto en UN archivo: cuando llegue la feature 131 con la barra de
// filtros, el cambio es sustituir este valor por el filtro del usuario dentro de
// `cargar.ts` y nada mas. Ningun otro archivo de la region financiera escribe un
// preset ni una fecha, y hay un test que lo censa.
//
// Este modulo no lee `searchParams`, no construye ningun `Date` y no mira
// `process.env`: si lo hiciera, el rango dejaria de ser una constante y pasaria
// a depender del momento y del entorno en que se importa.
//
// El objeto viaja como `unknown` al Server Action de la 127 y lo valida entero
// el esquema `.strict()` de la 135 (`prepararConsultaAnalitica`). Aqui NO se
// pre-parsea: validar dos veces es como se acaban aceptando dos formas de la
// misma entrada.

/** Filtro por defecto del tablero financiero mientras la 131 no aporte controles. */
export const FILTRO_FINANCIERO_POR_DEFECTO = Object.freeze({ rango: "mes" } as const);
