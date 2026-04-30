/**
 * TABLA DE SÍMBOLOS (Carga inicial)
 * Simula el diccionario de la Base de Datos con tablas, tipos de columnas y relaciones.
 * Es el "corazón" del análisis semántico.
 */
let symbolTable = {};

async function loadSymbolTable() {
    try {
        const response = await fetch('symbol_table.json');
        if (!response.ok) throw new Error('No se pudo cargar');
        symbolTable = await response.json();
        // Disparamos un evento para avisar a la interfaz que ya puede empezar a evaluar
        window.dispatchEvent(new Event('symbolTableLoaded'));
    } catch (e) {
        console.warn('Cargando tabla de símbolos estática de fallback.');
        // Fallback robusto por si el usuario lo abre sin Live Server
        symbolTable = {
            "employees": { "columns": { "EmployeeId": "NUMERIC", "LastName": "STRING", "FirstName": "STRING", "Title": "STRING", "ReportsTo": "NUMERIC", "City": "STRING", "Country": "STRING" }, "relations": { "customers": "employees.EmployeeId = customers.SupportRepId" } },
            "customers": { "columns": { "CustomerId": "NUMERIC", "FirstName": "STRING", "LastName": "STRING", "Company": "STRING", "City": "STRING", "Country": "STRING", "SupportRepId": "NUMERIC" }, "relations": { "employees": "customers.SupportRepId = employees.EmployeeId", "invoices": "customers.CustomerId = invoices.CustomerId" } },
            "invoices": { "columns": { "InvoiceId": "NUMERIC", "CustomerId": "NUMERIC", "InvoiceDate": "STRING", "BillingCity": "STRING", "Total": "NUMERIC" }, "relations": { "customers": "invoices.CustomerId = customers.CustomerId", "invoice_items": "invoices.InvoiceId = invoice_items.InvoiceId" } },
            "invoice_items": { "columns": { "InvoiceLineId": "NUMERIC", "InvoiceId": "NUMERIC", "TrackId": "NUMERIC", "UnitPrice": "NUMERIC", "Quantity": "NUMERIC" }, "relations": { "invoices": "invoice_items.InvoiceId = invoices.InvoiceId", "tracks": "invoice_items.TrackId = tracks.TrackId" } },
            "artists": { "columns": { "ArtistId": "NUMERIC", "Name": "STRING" }, "relations": { "albums": "artists.ArtistId = albums.ArtistId" } },
            "albums": { "columns": { "AlbumId": "NUMERIC", "Title": "STRING", "ArtistId": "NUMERIC" }, "relations": { "artists": "albums.ArtistId = artists.ArtistId", "tracks": "albums.AlbumId = tracks.AlbumId" } },
            "media_types": { "columns": { "MediaTypeId": "NUMERIC", "Name": "STRING" }, "relations": { "tracks": "media_types.MediaTypeId = tracks.MediaTypeId" } },
            "genres": { "columns": { "GenreId": "NUMERIC", "Name": "STRING" }, "relations": { "tracks": "genres.GenreId = tracks.GenreId" } },
            "tracks": { "columns": { "TrackId": "NUMERIC", "Name": "STRING", "AlbumId": "NUMERIC", "MediaTypeId": "NUMERIC", "GenreId": "NUMERIC", "Composer": "STRING", "UnitPrice": "NUMERIC" }, "relations": { "albums": "tracks.AlbumId = albums.AlbumId", "genres": "tracks.GenreId = genres.GenreId", "media_types": "tracks.MediaTypeId = media_types.MediaTypeId", "invoice_items": "tracks.TrackId = invoice_items.TrackId", "playlist_track": "tracks.TrackId = playlist_track.TrackId" } },
            "playlists": { "columns": { "PlaylistId": "NUMERIC", "Name": "STRING" }, "relations": { "playlist_track": "playlists.PlaylistId = playlist_track.PlaylistId" } },
            "playlist_track": { "columns": { "PlaylistId": "NUMERIC", "TrackId": "NUMERIC" }, "relations": { "playlists": "playlist_track.PlaylistId = playlists.PlaylistId", "tracks": "playlist_track.TrackId = tracks.TrackId" } }
        };
        window.dispatchEvent(new Event('symbolTableLoaded'));
    }
}
loadSymbolTable();

// Exponemos una función para que index.html pueda inyectar diccionarios extraídos dinámicamente
window.updateSymbolTable = function(newTable) {
    symbolTable = newTable;
    window.symbolTableDictionary = newTable;
    window.dispatchEvent(new Event('symbolTableLoaded'));
};

/**
 * FASE 1: ANÁLISIS LÉXICO (Lexer / Scanner)
 * Se agregó el seguimiento de Línea y Columna para el "Panic Mode".
 */
function lexer(input) {
    const rules = [
        // LIKE operators — deben ir ANTES que FILLER para que "QUE EMPIECE" no se consuma como QUE
        { type: 'LIKE_OP', regex: /^(QUE EMPIEC[EÉ][N]? CON|QUE INICIE[N]? CON|EMPIEZ[AE][N]? CON|INICIA[N]? CON)/i, standardize: 'LIKE_START' },
        { type: 'LIKE_OP', regex: /^(QUE CONTENGA[N]?|QUE CONTIENE[N]?|CONTIENE[N]?|QUE INCLUYA[N]?|CON LA PALABRA)/i, standardize: 'LIKE_CONTAINS' },
        { type: 'LIKE_OP', regex: /^(QUE TERMIN[EÉ][N]? CON|TERMINA[N]? CON)/i, standardize: 'LIKE_END' },
        // NULL checks — también antes que FILLER
        { type: 'NULL_OP', regex: /^(QUE NO TENGAN|QUE NO TIENE[N]?|NO TIENE[N]?|NO TENGAN|SIN)\b/i, standardize: 'ES_NULO' },

        // Relleno de lenguaje natural (se ignoran)
        { type: 'FILLER', regex: /^(POR FAVOR|PODRÍAS|PODRIAS|PODRÍA|PODRIA|LOS|LAS|EL|LA|UN|UNA|UNOS|UNAS|PARA|TODOS|TODAS|SU|SUS|A|AL|QUE|ME|TE|SEA|SEAN|ESTÉ|ESTE|ESTÉN|ESTEN|QUIÉN|QUIEN|QUIÉNES|QUIENES|TIENEN|TIENE|HAY|POR|FORMA|LETRA|PALABRA|REGISTRADOS|REGISTRADAS|TIPO|BASE DE DATOS|TABLA)\b/i },

        // Keywords estandarizados con alias
        { type: 'KEYWORD', regex: /^(MOSTRAR|ENSEÑAR|DAME|OBTENER|SELECCIONAR|BUSCAR|ENCUENTRA|MUÉSTRAME|MUESTRAME|ENSÉÑAME|ENSEÑAME|DIME|VER|TRÁEME|TRAEME|TRAER|QUIERO VER|QUIERO|NECESITO|ME GUSTARÍA|ME GUSTARIA|LISTAR|LISTA|MUESTRA)\b/i, standardize: 'MOSTRAR' },
        { type: 'KEYWORD', regex: /^(DESDE|DE|EN|DEL)\b/i, standardize: 'DE' },
        { type: 'KEYWORD', regex: /^(DÓNDE|DONDE|TENGAN|TENGA|CON|CUÁNDO|CUANDO|CUYOS|CUYAS|CUYO|CUYA)\b/i, standardize: 'DONDE' },
        { type: 'KEYWORD', regex: /^(LLAMADO|LLAMADA|NOMBRADO|NOMBRADA)\b/i, standardize: 'LLAMADO' },
        { type: 'KEYWORD', regex: /^(ORDENAR POR|ORDENAR|ORDENADO POR|ACOMODADO POR|ORDENADOS POR|ORDENADOS|ORDENADO|ORDENA)\b/i, standardize: 'ORDENAR' },
        { type: 'KEYWORD', regex: /^(DESCENDENTE|MÁS ALTOS?|MAS ALTOS?|MÁS ALTAS?|MAS ALTAS?|DE MAYOR A MENOR)\b/i, standardize: 'DESC' },
        { type: 'KEYWORD', regex: /^(ASCENDENTE|ALFABÉTIC[AO]|ALFABETIC[AO]|ALFABÉTICAMENTE|ALFABETICAMENTE|DE MENOR A MAYOR)\b/i, standardize: 'ASC' },
        { type: 'KEYWORD', regex: /^(UNIR CON|UNIR|JUNTO CON|COMBINADO CON|CRUZADO CON)\b/i, standardize: 'UNIR' },
        { type: 'KEYWORD', regex: /^(LOS PRIMEROS|LAS PRIMERAS|LOS ÚLTIMOS|LAS ÚLTIMAS|LÍMITE|LIMITE|TOP)\b/i, standardize: 'LIMITE' },
        { type: 'KEYWORD', regex: /^(Y|E)\b/i, standardize: 'Y' },
        { type: 'KEYWORD', regex: /^(O DE|O)\b/i, standardize: 'O' },

        // Operadores mapeados
        { type: 'OPERATOR', regex: /^(MAYORES QUE|MAYOR QUE|MAYOR A|MAYORES A|MÁS DE|MAS DE|MÁS QUE|MAS QUE|SUPERIOR A|>)/i, standardize: 'MAYOR A' },
        { type: 'OPERATOR', regex: /^(MENORES QUE|MENOR QUE|MENOR A|MENORES A|MENOS DE|MENOS QUE|INFERIOR A|<)/i, standardize: 'MENOR A' },
        { type: 'OPERATOR', regex: /^(IGUAL A|IGUAL QUE|IGUALES A|EXACTAMENTE ES|EXACTAMENTE|ES IGUAL A|SON|ES|=)/i, standardize: 'IGUAL A' },

        // Agregaciones
        { type: 'IDENTIFIER', regex: /^(CU[AÁ]NTOS|CU[AÁ]NTAS|N[UÚ]MERO DE|NÚMERO DE|CANTIDAD DE)\b/i, standardize: 'COUNT(*)' },
        { type: 'IDENTIFIER', regex: /^(SUMA DE|SUMAR|SUMA|SUM)\b/i, standardize: 'SUM' },
        { type: 'IDENTIFIER', regex: /^(PROMEDIO DE|PROMEDIO|MEDIA)\b/i, standardize: 'AVG' },

        { type: 'NUMBER', regex: /^\d+(\.\d+)?/ },
        { type: 'STRING', regex: /^"[^"]*"/ },
        { type: 'STRING', regex: /^'[^']*'/ },
        { type: 'PUNCTUATION', regex: /^[*+,]/ },
        { type: 'IDENTIFIER', regex: /^[a-zA-Z_áéíóúÁÉÍÓÚñÑ][a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ.]*/ }
    ];

    let tokens = [];
    let currentPosition = 0;
    let line = 1;
    let column = 1;

    while (currentPosition < input.length) {
        let substring = input.slice(currentPosition);
        
        let spaceMatch = substring.match(/^\s+/);
        if (spaceMatch) {
            // Actualizamos línea y columna al saltar espacios
            for (let char of spaceMatch[0]) {
                if (char === '\n') { line++; column = 1; }
                else { column++; }
            }
            currentPosition += spaceMatch[0].length;
            continue;
        }

        substring = input.slice(currentPosition);
        let matched = false;

        for (let rule of rules) {
            let match = substring.match(rule.regex);
            if (match) {
                if (rule.type !== 'FILLER') {
                    // Guardamos el token con su ubicación para el Panic Mode
                    tokens.push({ 
                        type: rule.type, 
                        value: rule.standardize ? rule.standardize : match[0],
                        originalValue: match[0],
                        line: line, 
                        column: column 
                    });
                }
                
                currentPosition += match[0].length;
                column += match[0].length;
                matched = true;
                break;
            }
        }

        if (!matched) {
            throw new Error(`Error léxico: Componente no reconocido en la línea ${line}, columna ${column} ("${input[currentPosition]}"). Intenta usar palabras más comunes o verifica la ortografía.`);
        }
    }

    return tokens;
}

/**
 * FASE 2: ANÁLISIS SINTÁCTICO (Parser)
 * PANIC MODE: Identifica errores y reporta línea y columna.
 */
function parser(tokens) {
    let current = 0;

    function walk() {
        let token = tokens[current];
        if (!token) return null;

        // Auto-inyectar MOSTRAR si la consulta empieza con COUNT(*), SUM o AVG
        if (token.type === 'IDENTIFIER' && (token.value === 'COUNT(*)' || token.value === 'SUM' || token.value === 'AVG')) {
            tokens.unshift({ type: 'KEYWORD', value: 'MOSTRAR', line: token.line, column: token.column });
            token = tokens[current]; // Re-leer token que ahora es MOSTRAR
        }

        let columns = [];
        let tables = [];
        let whereClause = null;
        let orderByClause = null;
        let limitClause = null;

        // Soporte a la sintaxis normal: MOSTRAR ... DE ...
        if (token.type === 'KEYWORD' && token.value.toUpperCase() === 'MOSTRAR') {
            current++;

            // Detectar "Muestra las 10 facturas..." → MOSTRAR NUMBER IDENTIFIER
            // El NUMBER es un LIMIT implícito; la tabla es el IDENTIFIER que sigue
            if (tokens[current] && tokens[current].type === 'NUMBER') {
                limitClause = parseInt(tokens[current].value);
                current++;
                // El siguiente IDENTIFIER es la tabla, columns = '*'
                if (tokens[current] && tokens[current].type === 'IDENTIFIER') {
                    tables.push(tokens[current].value);
                    current++;
                }
                columns = ['*'];
                // Consumir DONDE/CON y lo que siga hasta ORDER
                // (se seguirá procesando normalmente en los bloques de DONDE/ORDENAR abajo)
                // Pasar al bloque de sintaxis relajada no es necesario aquí —
                // el token actual puede ser DONDE/ORDENAR/DESC/etc.
            } else {
                while (current < tokens.length && (tokens[current].type === 'IDENTIFIER' || tokens[current].type === 'PUNCTUATION' || (tokens[current].type === 'KEYWORD' && tokens[current].value.toUpperCase() === 'Y'))) {
                    if (tokens[current].type === 'IDENTIFIER' || tokens[current].value === '*') {
                        columns.push(tokens[current].value);
                    }
                    current++;
                }

                if (columns.length === 0) {
                    let err = tokens[current] || tokens[current - 1] || {line: 1, column: 1};
                    throw new Error(`Error sintáctico: Se esperaba qué mostrar (ej. un Identificador) en la línea ${err.line}, columna ${err.column}.`);
                }
            }


            // Si la tabla ya fue capturada por el path MOSTRAR NUMBER, saltamos este bloque
            if (tables.length === 0) {
                token = tokens[current];

                if (token && token.type === 'KEYWORD' && token.value.toUpperCase() === 'DE') {
                    current++;
                    token = tokens[current];
                    if (!token || token.type !== 'IDENTIFIER') {
                        let err = token || tokens[current-1];
                        throw new Error(`Error sintáctico: Se esperaba un nombre de tabla después de DE en la línea ${err.line}, columna ${err.column}.`);
                    }
                    tables.push(token.value);
                    current++;

                    // Soporte a "DE tabla1 UNIR tabla2"
                    if (tokens[current] && tokens[current].type === 'KEYWORD' && tokens[current].value.toUpperCase() === 'UNIR') {
                        current++;
                        if (tokens[current] && tokens[current].type === 'IDENTIFIER') {
                            tables.push(tokens[current].value);
                            current++;
                        } else {
                            let err = tokens[current] || tokens[current-1];
                            throw new Error(`Error sintáctico: Se esperaba un nombre de tabla después de UNIR en la línea ${err.line}, columna ${err.column}.`);
                        }
                    }
                } else if (token && token.type === 'KEYWORD' && token.value.toUpperCase() === 'UNIR') {
                    // Soporte a "MOSTRAR * UNIR usuarios Y pedidos"
                    current++;
                    token = tokens[current];
                    if (!token || token.type !== 'IDENTIFIER') {
                        let err = token || tokens[current-1];
                        throw new Error(`Error sintáctico: Se esperaba el primer nombre de tabla en la línea ${err.line}, columna ${err.column}.`);
                    }
                    tables.push(token.value);
                    current++;

                    token = tokens[current];
                    if (!token || token.value.toUpperCase() !== 'Y') {
                        let err = token || tokens[current-1];
                        throw new Error(`Error sintáctico: Se esperaba 'Y' en la línea ${err.line}, columna ${err.column}.`);
                    }
                    current++;

                    token = tokens[current];
                    if (!token || token.type !== 'IDENTIFIER') {
                        let err = token || tokens[current-1];
                        throw new Error(`Error sintáctico: Se esperaba el segundo nombre de tabla en la línea ${err.line}, columna ${err.column}.`);
                    }
                    tables.push(token.value);
                    current++;
                } else if (!token || (token.type === 'KEYWORD' && (token.value === 'DONDE' || token.value === 'ORDENAR'))) {
                    // SINTAXIS RELAJADA: Asumir que si omitieron el "DE", la única columna proporcionada era en realidad la tabla
                    if (columns.length === 1 && columns[0] !== '*') {
                        tables.push(columns[0]);
                        columns = ['*'];
                    } else if (columns.length === 2 && columns[0] === 'COUNT(*)') {
                        tables.push(columns[1]);
                        columns = ['COUNT(*)'];
                    } else {
                        let err = token || tokens[current-1] || {line: 1, column: 1};
                        throw new Error(`Error sintáctico: Faltó especificar la tabla de origen (usando 'DE') en la línea ${err.line}, columna ${err.column}.`);
                    }
                } else {
                    let err = token || tokens[current-1];
                    throw new Error(`Error sintáctico: Se esperaba 'DE' o 'UNIR' en la línea ${err.line}, columna ${err.column}.`);
                }
            } // fin if (tables.length === 0)

        
        // Soporte a sintaxis "Joins Simplificados": UNIR usuarios Y pedidos
        } else if (token.type === 'KEYWORD' && token.value.toUpperCase() === 'UNIR') {
            columns = ['*']; // Implica seleccionar todo
            current++;
            token = tokens[current];
            if (!token || token.type !== 'IDENTIFIER') {
                let err = token || tokens[current-1];
                throw new Error(`Error sintáctico: Se esperaba el primer nombre de tabla en la línea ${err.line}, columna ${err.column}.`);
            }
            tables.push(token.value);
            current++;

            token = tokens[current];
            if (!token || token.value.toUpperCase() !== 'Y') {
                let err = token || tokens[current-1];
                throw new Error(`Error sintáctico: Se esperaba 'Y' en la línea ${err.line}, columna ${err.column}.`);
            }
            current++;

            token = tokens[current];
            if (!token || token.type !== 'IDENTIFIER') {
                let err = token || tokens[current-1];
                throw new Error(`Error sintáctico: Se esperaba el segundo nombre de tabla en la línea ${err.line}, columna ${err.column}.`);
            }
            tables.push(token.value);
            current++;

        } else if (token.type === 'KEYWORD' && token.value.toUpperCase() === 'ORDENAR') {
            // Sintaxis: "Ordena [columnas] de [tabla] [DESC|ASC]"
            // Infiere SELECT columna FROM tabla ORDER BY columna
            current++;

            // Leer columnas hasta el próximo DE o fin
            while (current < tokens.length &&
                   (tokens[current].type === 'IDENTIFIER' || tokens[current].type === 'PUNCTUATION' ||
                    (tokens[current].type === 'KEYWORD' && tokens[current].value === 'Y'))) {
                if (tokens[current].type === 'IDENTIFIER' || tokens[current].value === '*') {
                    columns.push(tokens[current].value);
                }
                current++;
            }
            if (columns.length === 0) columns = ['*'];

            // Leer tabla si viene un DE
            if (tokens[current] && tokens[current].value === 'DE') {
                current++;
                if (tokens[current] && tokens[current].type === 'IDENTIFIER') {
                    tables.push(tokens[current].value);
                    current++;
                }
            } else if (columns.length === 1 && columns[0] !== '*') {
                // "ordena pistas" → columna es la tabla, selecciona todo
                tables.push(columns[0]);
                columns = ['*'];
            }

            // Columna de ORDER BY: primera columna seleccionada, o '*'
            let orderCol = (columns[0] !== '*' && columns[0] !== 'COUNT(*)') ? columns[0] : (tables[0] || '*');
            orderByClause = { column: orderCol, direction: 'ASC' };

            // Consumir DE/ASC/DESC sobrantes (ej: "de forma alfabética")
            while (tokens[current] && (tokens[current].value === 'DE' ||
                   tokens[current].value === 'ASC' || tokens[current].value === 'DESC')) {
                if (tokens[current].value === 'DESC') orderByClause.direction = 'DESC';
                if (tokens[current].value === 'ASC')  orderByClause.direction = 'ASC';
                current++;
            }

        } else {
            throw new Error(`Error sintáctico: Toda consulta debe empezar con 'MOSTRAR' o 'UNIR'. Encontrado '${token.value}' en línea ${token.line}, columna ${token.column}.`);
        }


        // ── Análisis de WHERE (multiple conditions + LIKE + NULL + LLAMADO) ──
        token = tokens[current];
        if (token && token.type === 'KEYWORD' && token.value.toUpperCase() === 'DONDE') {
            current++;
            let conditions = [];

            function parseOneCondition(connector) {
                let left = tokens[current++];
                if (!left || (left.type !== 'IDENTIFIER' && left.type !== 'NUMBER' && left.type !== 'STRING')) {
                    let err = left || tokens[current-1];
                    throw new Error(`Error sintáctico: Se esperaba una columna en la condición WHERE en la línea ${err.line}, columna ${err.column}.`);
                }

                let next = tokens[current];

                // LIKE operator
                if (next && next.type === 'LIKE_OP') {
                    current++;
                    let right = tokens[current++];
                    if (!right) throw new Error(`Error sintáctico: Se esperaba un valor después del operador LIKE.`);
                    conditions.push({ left: left.value, leftType: left.type, operator: next.value, right: right.value, rightType: right.type, connector });
                    return;
                }

                // NULL check (no tengan compositor)
                if (next && next.type === 'NULL_OP') {
                    current++;
                    conditions.push({ left: left.value, leftType: left.type, operator: next.value, right: null, rightType: null, connector });
                    return;
                }

                // LLAMADO shorthand: "cliente llamado 'X'" → WHERE Name = 'X'
                if (next && next.type === 'KEYWORD' && next.value === 'LLAMADO') {
                    current++;
                    let right = tokens[current++];
                    if (!right) throw new Error(`Error sintáctico: Se esperaba un valor después de LLAMADO.`);
                    conditions.push({ left: left.value, leftType: left.type, operator: 'IGUAL A', right: right.value, rightType: right.type, connector });
                    return;
                }

                // Normal: left operator right
                let operator = tokens[current];
                // Sintaxis relajada: si no hay operador explícito, asumir IGUAL A
                if (operator && operator.type !== 'OPERATOR' && (operator.type === 'NUMBER' || operator.type === 'STRING' || operator.type === 'IDENTIFIER')) {
                    conditions.push({ left: left.value, leftType: left.type, operator: 'IGUAL A', right: operator.value, rightType: operator.type, connector });
                    current++;
                    return;
                }
                if (!operator || operator.type !== 'OPERATOR') {
                    let err = operator || tokens[current-1];
                    throw new Error(`Error sintáctico: Se esperaba un operador de comparación en la línea ${err ? err.line : '?'}, columna ${err ? err.column : '?'}.`);
                }
                current++;
                let right = tokens[current++];
                if (!right || (right.type !== 'NUMBER' && right.type !== 'IDENTIFIER' && right.type !== 'STRING')) {
                    let err = right || tokens[current-1];
                    throw new Error(`Error sintáctico: La condición WHERE requiere un valor contra qué comparar en la línea ${err.line}, columna ${err.column}.`);
                }
                conditions.push({ left: left.value, leftType: left.type, operator: operator.value.toUpperCase(), right: right.value, rightType: right.type, connector });
            }

            parseOneCondition(null);

            // Condiciones adicionales con Y (AND) u O (OR)
            while (tokens[current] && (tokens[current].value === 'Y' || tokens[current].value === 'O') &&
                   tokens[current + 1] && tokens[current + 1].type !== 'KEYWORD') {
                let connector = tokens[current].value === 'Y' ? 'AND' : 'OR';
                current++;
                // Skip optional DE between O and value (for "o de 'Germany'" pattern)
                if (tokens[current] && tokens[current].value === 'DE') current++;
                parseOneCondition(connector);
            }

            whereClause = conditions;
        }

        // ── ORDER BY + DESC/ASC + LIMIT ──
        token = tokens[current];
        if (token && token.type === 'KEYWORD' && token.value.toUpperCase() === 'ORDENAR') {
            current++;
            token = tokens[current++];
            if (!token || token.type !== 'IDENTIFIER') {
                let err = token || tokens[current-1];
                throw new Error(`Error sintáctico: Se esperaba un identificador después de ORDENAR en la línea ${err.line}, columna ${err.column}.`);
            }
            orderByClause = { column: token.value, direction: 'ASC' };
            // Optional DESC/ASC
            if (tokens[current] && (tokens[current].value === 'DESC' || tokens[current].value === 'ASC')) {
                orderByClause.direction = tokens[current].value;
                current++;
            }
        }

        // ── LIMIT ──
        token = tokens[current];
        if (token && token.type === 'KEYWORD' && token.value === 'LIMITE') {
            current++;
            let numTok = tokens[current++];
            if (numTok && numTok.type === 'NUMBER') {
                limitClause = parseInt(numTok.value);
                // If also ordering by most/least, infer DESC
                if (orderByClause && !orderByClause.direction) orderByClause.direction = 'DESC';
            }
        }

        if (current < tokens.length) {
            let err = tokens[current];
            throw new Error(`Error sintáctico: Tokens inesperados al final de la consulta ("${err.value}") en la línea ${err.line}, columna ${err.column}.`);
        }

        return {
            type: 'Query',
            columns: columns,
            tables: tables,
            where: whereClause,      // now an array or null
            orderBy: orderByClause,  // now { column, direction } or null
            limit: limitClause       // number or null
        };
    }

    return walk();
}

/**
 * ALGORITMOS NLP AVANZADOS (Fuzzy Matching + Stemming + Synonyms)
 */
function levenshteinDistance(a, b) {
    const matrix = [];
    let i, j;
    for (i = 0; i <= b.length; i++) matrix[i] = [i];
    for (j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (i = 1; i <= b.length; i++) {
        for (j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

function findBestMatch(word, candidates) {
    if (!word || word === '*' || word === 'COUNT(*)') return word;
    
    function searchMatch(target) {
        let exact = candidates.find(c => c.toLowerCase() === target.toLowerCase());
        if (exact) return exact;

        // Stemming básico (s, es)
        let stemTarget = target.toLowerCase().replace(/(es|s)$/, '');
        let stemMatch = candidates.find(c => c.toLowerCase().replace(/(es|s)$/, '') === stemTarget);
        if (stemMatch) return stemMatch;

        // Distancia Levenshtein
        let bestMatch = null;
        let minDist = Infinity;
        for (let c of candidates) {
            let dist = levenshteinDistance(target.toLowerCase(), c.toLowerCase());
            if (dist < minDist) { minDist = dist; bestMatch = c; }
        }
        let maxLen = Math.max(target.length, bestMatch.length);
        let sim = (maxLen - minDist) / maxLen;
        if (sim > 0.70) return bestMatch; // Mínimo 70% de similitud
        return null;
    }

    // 1. Intentar con la palabra original (Si la BD está en español o son match directo)
    let match = searchMatch(word);
    if (match) return match;

    // 2. Traducción Universal Fallback (Si la BD subida resulta estar en inglés)
    const synonymMap = {
        'factura': ['invoice'], 'facturas': ['invoices'], 'pedido': ['invoice', 'order'],
        'cliente': ['customer'], 'clientes': ['customers'],
        'empleado': ['employee'], 'empleados': ['employees'],
        'nombre': ['name', 'title', 'firstname'], 'nombres': ['name', 'firstname'],
        'apellido': ['lastname'], 'apellidos': ['lastname'],
        'título': ['title', 'name'], 'titulo': ['title', 'name'], 'títulos': ['title'], 'titulos': ['title'],
        'precio': ['unitprice', 'price'], 'costo': ['unitprice', 'price'], 'cantidad': ['quantity'],
        'total': ['total'], 'compositor': ['composer'],
        'cancion': ['track'], 'canciones': ['tracks'], 'pista': ['track'], 'pistas': ['tracks'],
        'ciudad': ['city', 'billingcity'], 'pais': ['country', 'billingcountry'], 'país': ['country'],
        'genero': ['genre'], 'género': ['genre'], 'artista': ['artist'], 'artistas': ['artists'],
        'albumes': ['albums'], 'álbumes': ['albums'], 'album': ['album'], 'álbum': ['album'],
        'correo': ['email'], 'email': ['email'], 'telefono': ['phone'], 'teléfono': ['phone'],
        'direccion': ['address'], 'dirección': ['address'],
        'codigo': ['postalcode'], 'código': ['postalcode'], 'postal': ['postalcode'],
        'empresa': ['company'], 'duracion': ['milliseconds'], 'duración': ['milliseconds'],
        'id': ['artistid', 'albumid', 'trackid', 'customerid', 'employeeid', 'invoiceid']
    };
    
    let stemWord = word.toLowerCase().replace(/(es|s)$/, '');
    let translations = synonymMap[word.toLowerCase()] || synonymMap[stemWord] || [];
    
    for (let translated of translations) {
        let matchTrans = searchMatch(translated);
        if (matchTrans) return matchTrans;
    }

    return null;
}

/**
 * FASE 2.5: ANÁLISIS SEMÁNTICO
 * Verifica tipos, existencia de tablas y columnas con la Tabla de Símbolos.
 */
function semanticAnalyzer(ast) {
    let dbTables = Object.keys(symbolTable);

    // Resolver y mutar Main Table
    let mainTableMatch = findBestMatch(ast.tables[0], dbTables);
    if (!mainTableMatch) throw new Error(`Error semántico: No se encontró una tabla parecida a '${ast.tables[0]}' en la base de datos.`);
    ast.tables[0] = mainTableMatch;
    let mainTable = ast.tables[0];

    // Resolver y mutar Joined Table
    let joinedTable = null;
    if (ast.tables.length > 1) {
        let joinedMatch = findBestMatch(ast.tables[1], dbTables);
        if (!joinedMatch) throw new Error(`Error semántico: No se encontró una tabla parecida a '${ast.tables[1]}' para unir.`);
        ast.tables[1] = joinedMatch;
        joinedTable = ast.tables[1];
    }

    // Validación de "Joins" Simplificados
    if (joinedTable) {
        let relations = symbolTable[mainTable].relations || {};
        let relationKey = Object.keys(relations).find(k => k.toLowerCase() === joinedTable.toLowerCase());
        
        if (!relationKey) {
            throw new Error(`Error semántico: No existe una relación lógica o Foreign Key para UNIR '${mainTable}' y '${joinedTable}'.`);
        }
        ast.joinCondition = relations[relationKey];
    }

    // Juntamos todas las columnas disponibles
    let availableColsObj = { ...symbolTable[mainTable].columns };
    if (joinedTable) availableColsObj = { ...availableColsObj, ...symbolTable[joinedTable].columns };
    let availableColumns = Object.keys(availableColsObj);

    // Resolver y mutar Columnas seleccionadas
    for (let i = 0; i < ast.columns.length; i++) {
        let col = ast.columns[i];
        if (col === '*' || col === 'COUNT(*)') continue;
        
        let colMatch = findBestMatch(col, availableColumns);
        if (!colMatch) throw new Error(`Error semántico: La columna '${col}' no existe ni se parece a ninguna en las tablas consultadas.`);
        ast.columns[i] = colMatch;
    }

    // Validamos cada condición del WHERE
    if (ast.where && Array.isArray(ast.where)) {
        for (let cond of ast.where) {
            if (cond.leftType === 'IDENTIFIER') {
                let m = findBestMatch(cond.left, availableColumns);
                if (!m) throw new Error(`Error semántico: La columna '${cond.left}' no existe en la condición WHERE.`);
                cond.left = m;
            }
            if (cond.right !== null && cond.rightType === 'IDENTIFIER') {
                let m = findBestMatch(cond.right, availableColumns);
                if (!m) throw new Error(`Error semántico: La columna '${cond.right}' no existe en la condición WHERE.`);
                cond.right = m;
            }
        }
    }

    // Validamos y mutamos la columna de ORDENAR
    if (ast.orderBy) {
        let orderMatch = findBestMatch(ast.orderBy.column, availableColumns);
        if (!orderMatch) throw new Error(`Error semántico: La columna '${ast.orderBy.column}' no existe para ordenar.`);
        ast.orderBy.column = orderMatch;
    }
}

/**
 * FASE 3: OPTIMIZADOR DE CÓDIGO
 * Limpia y mejora el AST antes de generar el código final.
 */
function optimizer(ast) {
    // 1. Eliminación de columnas duplicadas (Ej: MOSTRAR nombre, nombre)
    if (ast.columns && ast.columns.length > 0) {
        let uniqueCols = [...new Set(ast.columns)];
        ast.columns = uniqueCols;
    }

    // 2. Eliminación de condiciones redundantes (Ej: DONDE 1 IGUAL A 1)
    if (ast.where && Array.isArray(ast.where)) {
        ast.where = ast.where.filter(c => !(c.left === c.right && c.operator === 'IGUAL A'));
        if (ast.where.length === 0) ast.where = null;
    }

    return ast;
}

/**
 * FUNCIÓN PRINCIPAL DEL FRONT-END DEL TRANSPILADOR
 * Devuelve el AST validado para que los "Generators" construyan el código final.
 */
function compileToAST(input) {
    if (!input || input.trim() === '') return null;
    if (Object.keys(symbolTable).length === 0) throw new Error('Cargando Tabla de Símbolos...');
    
    // 1. Análisis Léxico
    const tokens = lexer(input);
    
    // 2. Análisis Sintáctico (Panic Mode)
    const rawAst = parser(tokens);

    // 3. Análisis Semántico
    semanticAnalyzer(rawAst);

    // 4. Optimización de Código
    const ast = optimizer(rawAst);
    
    // Devolvemos la representación intermedia (AST)
    return ast;
}

// Ya no retornamos SQL, retornamos el Árbol
window.compileToAST = compileToAST;
window.symbolTableDictionary = symbolTable; // Exportamos tabla para el autocompletado

/**
 * FUNCIÓN EXTENDIDA: Devuelve tokens, log semántico y AST para el visualizador de fases.
 */
window.compileWithDetails = function(input) {
    if (!input || input.trim() === '') return null;
    if (Object.keys(symbolTable).length === 0) throw new Error('Cargando Tabla de Símbolos...');

    // FASE 1: Léxico
    const tokens = lexer(input);

    // Copia profunda para el parser
    const tokensCopy = tokens.map(t => ({ ...t }));
    const rawAst = parser(tokensCopy);

    // Capturar estado pre-semántico
    const beforeTables = [...rawAst.tables];
    const beforeCols   = [...rawAst.columns];
    const beforeWhere  = rawAst.where ? rawAst.where.map(c => ({ left: c.left, right: c.right })) : null;

    // FASE 2.5: Semántico
    semanticAnalyzer(rawAst);

    // Construir log de resoluciones
    const semanticLog = [];
    rawAst.tables.forEach((t, i) => {
        semanticLog.push({ original: beforeTables[i] || t, resolved: t, type: 'Tabla', exact: beforeTables[i] === t });
    });
    rawAst.columns.forEach((c, i) => {
        if (c === '*' || c === 'COUNT(*)' || c === 'SUM' || c === 'AVG') return;
        semanticLog.push({ original: beforeCols[i] || c, resolved: c, type: 'Columna SELECT', exact: beforeCols[i] === c });
    });
    if (rawAst.where && beforeWhere) {
        rawAst.where.forEach((cond, i) => {
            if (beforeWhere[i] && beforeWhere[i].left !== cond.left)
                semanticLog.push({ original: beforeWhere[i].left, resolved: cond.left, type: 'Columna WHERE', exact: false });
        });
    }

    // FASE 3: Optimizador
    const ast = optimizer(rawAst);
    return { ast, tokens, semanticLog };
};

