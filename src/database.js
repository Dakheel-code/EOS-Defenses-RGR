const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;
const dbPath = path.join(__dirname, '..', 'data', 'submissions.db');

async function initDatabase() {
    const SQL = await initSqlJs();
    
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }
    
    db.run(`
        CREATE TABLE IF NOT EXISTS submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            code TEXT NOT NULL,
            message TEXT DEFAULT '',
            extra_mention TEXT DEFAULT '',
            image_data BLOB,
            image_filename TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            published INTEGER DEFAULT 0
        )
    `);
    
    // Add columns if they don't exist (for existing databases)
    try {
        db.run('ALTER TABLE submissions ADD COLUMN message TEXT DEFAULT ""');
    } catch (e) {}
    try {
        db.run('ALTER TABLE submissions ADD COLUMN extra_mention TEXT DEFAULT ""');
    } catch (e) {}
    
    saveDatabase();
    return db;
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

function getDb() {
    if (!db) throw new Error('Database not initialized');
    return db;
}

function resultToObjects(result) {
    if (!result || result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    });
}

function addSubmission(userId, username, code, imageData, imageFilename) {
    const d = getDb();
    d.run(`
        INSERT INTO submissions (user_id, username, code, image_data, image_filename)
        VALUES (?, ?, ?, ?, ?)
    `, [userId, username, code, imageData, imageFilename]);
    const result = d.exec('SELECT last_insert_rowid() as id');
    saveDatabase();
    return { lastInsertRowid: result[0].values[0][0] };
}

function getAllPendingSubmissions() {
    const d = getDb();
    const result = d.exec(`
        SELECT * FROM submissions 
        WHERE published = 0
        ORDER BY created_at ASC
    `);
    return resultToObjects(result);
}

function getSubmissionById(id) {
    const d = getDb();
    const result = d.exec('SELECT * FROM submissions WHERE id = ?', [id]);
    const rows = resultToObjects(result);
    return rows.length > 0 ? rows[0] : null;
}

function updateSubmission(id, code) {
    const d = getDb();
    d.run('UPDATE submissions SET code = ? WHERE id = ?', [code, id]);
    saveDatabase();
    return { changes: d.getRowsModified() };
}

function updateSubmissionMessage(id, message, extraMention = '') {
    const d = getDb();
    d.run('UPDATE submissions SET message = ?, extra_mention = ? WHERE id = ?', [message, extraMention, id]);
    saveDatabase();
    return { changes: d.getRowsModified() };
}

function deleteSubmission(id) {
    const d = getDb();
    d.run('DELETE FROM submissions WHERE id = ?', [id]);
    saveDatabase();
    return { changes: d.getRowsModified() };
}

function markAsPublished(id) {
    const d = getDb();
    d.run('UPDATE submissions SET published = 1 WHERE id = ?', [id]);
    saveDatabase();
    return { changes: d.getRowsModified() };
}

module.exports = {
    initDatabase,
    addSubmission,
    getAllPendingSubmissions,
    getSubmissionById,
    updateSubmission,
    updateSubmissionMessage,
    deleteSubmission,
    markAsPublished
};
