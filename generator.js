/**
 * GENERATOR.JS — Back-end del Compilador
 * Toma el AST validado y lo traduce a SQL (ANSI) o MongoDB.
 * Soporta: WHERE múltiple (AND/OR), LIKE, IS NULL, LIMIT, ORDER BY DESC/ASC, SUM/AVG.
 */

// ─── Utilidades ────────────────────────────────────────────────────────────────

/** Normaliza el valor de la derecha: siempre usa comillas simples en SQL,
 *  elimina las comillas dobles del usuario. */
function normalizeValue(val, type) {
    if (val === null || val === undefined) return 'NULL';
    if (type === 'NUMBER') return String(val);
    // Quitar comillas existentes y re-envolver con simples
    let clean = String(val).replace(/^["']|["']$/g, '');
    return `'${clean}'`;
}

/** Convierte un operador LIKE_OP y valor en fragmento SQL LIKE. */
function likeFragment(col, op, val) {
    let clean = String(val).replace(/^["']|["']$/g, '');
    if (op === 'LIKE_START')    return `${col} LIKE '${clean}%'`;
    if (op === 'LIKE_END')      return `${col} LIKE '%${clean}'`;
    if (op === 'LIKE_CONTAINS') return `${col} LIKE '%${clean}%'`;
    return `${col} = '${clean}'`;
}

/** Genera el fragmento SQL de UNA condición WHERE. */
function conditionSQL(cond) {
    const opMap = { 'MAYOR A': '>', 'MENOR A': '<', 'IGUAL A': '=' };

    if (cond.operator === 'ES_NULO')    return `${cond.left} IS NULL`;
    if (cond.operator === 'NO_ES_NULO') return `${cond.left} IS NOT NULL`;
    if (['LIKE_START','LIKE_CONTAINS','LIKE_END'].includes(cond.operator))
        return likeFragment(cond.left, cond.operator, cond.right);

    let sqlOp = opMap[cond.operator] || '=';
    let right  = normalizeValue(cond.right, cond.rightType);
    return `${cond.left} ${sqlOp} ${right}`;
}

/** Genera el bloque WHERE completo para SQL. */
function buildWhereSQL(conditions) {
    if (!conditions || conditions.length === 0) return '';
    let parts = conditions.map((c, i) => {
        let frag = conditionSQL(c);
        return i === 0 ? frag : `${c.connector} ${frag}`;
    });
    return `\nWHERE ${parts.join(' ')}`;
}

// ─── Target 1: SQL (ANSI) ─────────────────────────────────────────────────────

function generateSQL(ast) {
    if (ast.type !== 'Query') throw new Error('Error de generación: Tipo de nodo desconocido.');

    // Columnas — manejar SUM / AVG sobre columna específica
    let colList = ast.columns.map(c => {
        if (c === 'SUM' || c === 'AVG') return null; // se resuelve abajo
        return c;
    }).filter(Boolean);

    // Si hay SUM o AVG seguido de una columna, reformatear
    let selectPart = ast.columns.join(', ');
    if (ast.columns.includes('SUM') && ast.columns.length > 1) {
        let col = ast.columns.find(c => c !== 'SUM');
        selectPart = `SUM(${col || '*'})`;
    } else if (ast.columns.includes('AVG') && ast.columns.length > 1) {
        let col = ast.columns.find(c => c !== 'AVG');
        selectPart = `AVG(${col || '*'})`;
    } else if (ast.columns.includes('SUM')) {
        selectPart = 'SUM(*)';
    } else if (ast.columns.includes('AVG')) {
        selectPart = 'AVG(*)';
    }

    let sql = `SELECT ${selectPart}\nFROM ${ast.tables[0]}`;

    if (ast.tables.length > 1) {
        sql += `\nINNER JOIN ${ast.tables[1]} ON ${ast.joinCondition}`;
    }

    sql += buildWhereSQL(ast.where);

    if (ast.orderBy) {
        sql += `\nORDER BY ${ast.orderBy.column} ${ast.orderBy.direction}`;
    }

    if (ast.limit) {
        sql += `\nLIMIT ${ast.limit}`;
    }

    return sql + ';';
}

// ─── Target 2: MongoDB ────────────────────────────────────────────────────────

function generateMongo(ast) {
    if (ast.type !== 'Query') throw new Error('Nodo no soportado para MongoDB');

    let collection = ast.tables[0];

    if (ast.tables.length > 1) {
        return `// Los JOINs en MongoDB usan aggregate($lookup).\n// Simplificado a colección principal:\ndb.${collection}.find(...)`;
    }

    let query = {};
    if (ast.where && ast.where.length > 0) {
        const opMap = { 'MAYOR A': '$gt', 'MENOR A': '$lt', 'IGUAL A': '$eq' };

        if (ast.where.length === 1) {
            let c = ast.where[0];
            if (c.operator === 'ES_NULO')        query[c.left] = null;
            else if (c.operator === 'NO_ES_NULO') query[c.left] = { $ne: null };
            else if (c.operator === 'LIKE_START')    query[c.left] = { $regex: `^${c.right.replace(/^["']|["']$/g,'')}`, $options: 'i' };
            else if (c.operator === 'LIKE_CONTAINS') query[c.left] = { $regex: c.right.replace(/^["']|["']$/g,''), $options: 'i' };
            else if (c.operator === 'LIKE_END')      query[c.left] = { $regex: `${c.right.replace(/^["']|["']$/g,'')}$`, $options: 'i' };
            else {
                let rv = c.rightType === 'NUMBER' ? Number(c.right) : c.right.replace(/^["']|["']$/g,'');
                query[c.left] = { [opMap[c.operator] || '$eq']: rv };
            }
        } else {
            // Multiple conditions: $and / $or
            let hasOr = ast.where.some(c => c.connector === 'OR');
            let mongoKey = hasOr ? '$or' : '$and';
            query[mongoKey] = ast.where.map(c => {
                let sub = {};
                if (c.operator === 'ES_NULO')        sub[c.left] = null;
                else if (c.operator === 'NO_ES_NULO') sub[c.left] = { $ne: null };
                else if (c.operator.startsWith('LIKE')) {
                    let pat = c.right.replace(/^["']|["']$/g,'');
                    if (c.operator === 'LIKE_START')    sub[c.left] = { $regex: `^${pat}`, $options: 'i' };
                    else if (c.operator === 'LIKE_END') sub[c.left] = { $regex: `${pat}$`, $options: 'i' };
                    else sub[c.left] = { $regex: pat, $options: 'i' };
                } else {
                    let rv = c.rightType === 'NUMBER' ? Number(c.right) : c.right.replace(/^["']|["']$/g,'');
                    sub[c.left] = { [opMap[c.operator] || '$eq']: rv };
                }
                return sub;
            });
        }
    }

    let projection = {};
    if (!ast.columns.includes('*') && !ast.columns.includes('COUNT(*)') &&
        !ast.columns.includes('SUM') && !ast.columns.includes('AVG')) {
        ast.columns.forEach(col => projection[col] = 1);
        projection['_id'] = 0;
    }

    let sortStr = ast.orderBy ? `.sort({${ast.orderBy.column}: ${ast.orderBy.direction === 'DESC' ? -1 : 1}})` : '';
    let limitStr = ast.limit ? `.limit(${ast.limit})` : '';

    // Aggregation (COUNT/SUM/AVG)
    if (ast.columns.includes('COUNT(*)')) return `db.${collection}.countDocuments(${JSON.stringify(query)});`;
    if (ast.columns.includes('SUM') || ast.columns.includes('AVG')) {
        let fn  = ast.columns.includes('SUM') ? '$sum' : '$avg';
        let col = ast.columns.find(c => c !== 'SUM' && c !== 'AVG') || 'value';
        return `db.${collection}.aggregate([\n  { $match: ${JSON.stringify(query)} },\n  { $group: { _id: null, resultado: { ${fn}: "$${col}" } } }\n]);`;
    }

    let queryStr = JSON.stringify(query).replace(/"([^"]+)":/g, '$1:');
    let projStr  = JSON.stringify(projection).replace(/"([^"]+)":/g, '$1:');
    let findStr  = Object.keys(projection).length === 0 ? `db.${collection}.find(${queryStr})` : `db.${collection}.find(${queryStr}, ${projStr})`;

    return `${findStr}${sortStr}${limitStr};`;
}

// ─── Target 3: JS Filter (Sandbox) ───────────────────────────────────────────

function generateJSFilter(ast, dummyData) {
    let table = ast.tables[0];
    if (!dummyData[table]) return `Error: La tabla '${table}' no tiene datos en el Sandbox.`;

    let result = JSON.parse(JSON.stringify(dummyData[table]));

    if (ast.tables.length > 1) {
        let joinedTable = ast.tables[1];
        if (!dummyData[joinedTable]) return `Error: La tabla a unir '${joinedTable}' no tiene datos.`;
        let parts   = ast.joinCondition.split(' = ');
        let mainKey = parts[0].split('.')[1];
        let joinKey = parts[1].split('.')[1];
        let joined  = [];
        result.forEach(r1 => dummyData[joinedTable].forEach(r2 => { if (r1[mainKey] == r2[joinKey]) joined.push({...r1,...r2}); }));
        result = joined;
    }

    if (ast.where && ast.where.length > 0) {
        result = result.filter(row => {
            return ast.where.every((cond, i) => {
                let lv = row[cond.left];
                let rv = cond.right;
                if (cond.rightType === 'NUMBER') rv = Number(rv);
                if (rv) rv = String(rv).replace(/^["']|["']$/g, '');
                let match;
                if (cond.operator === 'ES_NULO')    match = lv === null || lv === undefined || lv === '';
                else if (cond.operator === 'NO_ES_NULO') match = lv !== null && lv !== undefined && lv !== '';
                else if (cond.operator === 'LIKE_START')    match = String(lv).toLowerCase().startsWith(rv.toLowerCase());
                else if (cond.operator === 'LIKE_END')      match = String(lv).toLowerCase().endsWith(rv.toLowerCase());
                else if (cond.operator === 'LIKE_CONTAINS') match = String(lv).toLowerCase().includes(rv.toLowerCase());
                else if (cond.operator === 'MAYOR A') match = lv > (isNaN(rv) ? rv : Number(rv));
                else if (cond.operator === 'MENOR A') match = lv < (isNaN(rv) ? rv : Number(rv));
                else match = String(lv).toLowerCase() === String(rv).toLowerCase();
                // Handle OR logic
                if (i > 0 && cond.connector === 'OR') return true; // simplified
                return match;
            });
        });
    }

    if (ast.orderBy) {
        let { column, direction } = ast.orderBy;
        result = result.sort((a, b) => {
            if (a[column] < b[column]) return direction === 'DESC' ? 1 : -1;
            if (a[column] > b[column]) return direction === 'DESC' ? -1 : 1;
            return 0;
        });
    }

    if (ast.limit) result = result.slice(0, ast.limit);

    if (!ast.columns.includes('*')) {
        let cols = ast.columns.filter(c => c !== 'SUM' && c !== 'AVG' && c !== 'COUNT(*)');
        if (cols.length > 0) result = result.map(row => { let r = {}; cols.forEach(c => { if (row[c] !== undefined) r[c] = row[c]; }); return r; });
    }

    return JSON.stringify(result, null, 2);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
window.generateSQL    = generateSQL;
window.generateMongo  = generateMongo;
window.generateJSFilter = generateJSFilter;
