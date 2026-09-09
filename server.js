const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'record_management.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create tables if they don't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      fullName TEXT NOT NULL,
      salt TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schema TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      collectionId TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (collectionId) REFERENCES collections(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_records_collectionId ON records(collectionId)`);

    // Check if we need to migrate from JSON
    migrateFromJsonIfNeeded();
  });
}

function migrateFromJsonIfNeeded() {
  const JSON_DB_PATH = path.join(DATA_DIR, 'db.json');
  const BACKUP_JSON_DB_PATH = path.join(DATA_DIR, 'db.json.backup');

  // Check if JSON exists and we might need to migrate
  if (fs.existsSync(JSON_DB_PATH)) {
    // Check if database is empty by checking if any users exist
    db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
      if (err) {
        console.error('Error checking user count:', err);
        return;
      }

      if (row.count === 0) {
        console.log('Database appears empty, attempting migration from JSON...');
        migrateFromJson(JSON_DB_PATH, BACKUP_JSON_DB_PATH);
      } else {
        console.log('Database already has data, skipping JSON migration.');
        // Still backup JSON as precaution
        if (!fs.existsSync(BACKUP_JSON_DB_PATH)) {
          fs.copyFileSync(JSON_DB_PATH, BACKUP_JSON_DB_PATH);
          console.log('Backed up JSON database as precaution');
        }
      }
    });
  }
}

function migrateFromJson(jsonPath, backupPath) {
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

    db.serialize(() => {
      // Migrate users
      if (data.users && data.users.length > 0) {
        const insertUser = db.prepare(`
          INSERT OR REPLACE INTO users (id, username, fullName, salt, passwordHash)
          VALUES (?, ?, ?, ?, ?)
        `);

        data.users.forEach(user => {
          insertUser.run(user.id, user.username, user.fullName, user.salt, user.passwordHash);
        });
        insertUser.finalize();
        console.log(`Migrated ${data.users.length} users`);
      }

      // Migrate collections and records
      if (data.collections) {
        const collectionIds = Object.keys(data.collections);
        console.log(`Migrating ${collectionIds.length} collections...`);

        const insertCollection = db.prepare(`
          INSERT OR REPLACE INTO collections (id, name, schema)
          VALUES (?, ?, ?)
        `);

        const insertRecord = db.prepare(`
          INSERT OR REPLACE INTO records (id, collectionId, data)
          VALUES (?, ?, ?)
        `);

        collectionIds.forEach(collectionId => {
          const collection = data.collections[collectionId];

          // Insert collection
          insertCollection.run(
            collectionId,
            collection.name,
            JSON.stringify(collection.schema)
          );

          // Insert records for this collection
          if (collection.data && collection.data.length > 0) {
            collection.data.forEach(record => {
              insertRecord.run(
                record.id,
                collectionId,
                JSON.stringify(record)
              );
            });
          }
        });

        insertCollection.finalize();
        insertRecord.finalize();
        console.log(`Migrated ${collectionIds.length} collections with their records`);
      }

      // Backup JSON file after successful migration
      fs.copyFileSync(jsonPath, backupPath);
      console.log('Backup created at:', backupPath);
      console.log('Migration completed successfully!');
    });

  } catch (error) {
    console.error('Error during migration:', error);
  }
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

// ---------------------------------------------------------------------------
// 2. AUTHENTICATION
// ---------------------------------------------------------------------------
const sessions = new Map();
const SESSION_HOURS = 8;

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000 });
  return token;
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token ? sessions.get(token) : null;
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'Unauthorized' });
  req.user = session.username;
  next();
}

// ---------------------------------------------------------------------------
// 3. MIDDLEWARE & STATIC FILES
// ---------------------------------------------------------------------------
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // Serve UI from /public

// ---------------------------------------------------------------------------
// 4. AUTH ROUTES
// ---------------------------------------------------------------------------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user || user.passwordHash !== hashPassword(password, user.salt)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = createSession(user.username);
    res.json({ token, username: user.username, fullName: user.fullName });
  });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  const header = req.headers.authorization || '';
  sessions.delete(header.slice(7));
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// 5. COLLECTION & SCHEMA MANAGEMENT
// ---------------------------------------------------------------------------
app.get('/api/collections', authMiddleware, (req, res) => {
  db.all('SELECT id, name, schema, createdAt FROM collections ORDER BY createdAt', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Get per-collection record counts and merge into response
    db.all('SELECT collectionId, COUNT(*) as cnt FROM records GROUP BY collectionId', [], (err2, counts) => {
      if (err2) return res.status(500).json({ error: 'Database error' });
      const countsMap = new Map();
      (counts || []).forEach(c => countsMap.set(c.collectionId, c.cnt));

      const collections = rows.map(row => ({
        id: row.id,
        name: row.name,
        schema: JSON.parse(row.schema),
        createdAt: row.createdAt,
        count: countsMap.get(row.id) || 0
      }));

      res.json(collections);
    });
  });
});

app.post('/api/collections', authMiddleware, (req, res) => {
  const { name, schema } = req.body;
  if (!name || !Array.isArray(schema)) {
    return res.status(400).json({ error: 'Name and schema array are required' });
  }
  const id = crypto.randomUUID();
  const schemaJson = JSON.stringify(schema);

  db.run(
    'INSERT INTO collections (id, name, schema) VALUES (?, ?, ?)',
    [id, name, schemaJson],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({ id, name, schema, createdAt: new Date().toISOString() });
    }
  );
});

app.put('/api/collections/:id', authMiddleware, (req, res) => {
  const { name, schema } = req.body;
  const collectionId = req.params.id;

  let updateFields = [];
  let values = [];

  if (name !== undefined) {
    updateFields.push('name = ?');
    values.push(name);
  }

  if (schema !== undefined && Array.isArray(schema)) {
    updateFields.push('schema = ?');
    values.push(JSON.stringify(schema));
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(collectionId);

  const query = `UPDATE collections SET ${updateFields.join(', ')} WHERE id = ?`;

  db.run(query, values, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Fetch updated collection
    db.get('SELECT id, name, schema, createdAt FROM collections WHERE id = ?', [collectionId], (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      res.json({
        id: row.id,
        name: row.name,
        schema: JSON.parse(row.schema),
        createdAt: row.createdAt
      });
    });
  });
});

app.delete('/api/collections/:id', authMiddleware, (req, res) => {
  const collectionId = req.params.id;

  // Delete associated records first (due to foreign key constraint)
  db.run('DELETE FROM records WHERE collectionId = ?', [collectionId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Delete collection
    db.run('DELETE FROM collections WHERE id = ?', [collectionId], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      res.json({ message: 'Deleted' });
    });
  });
});

// ---------------------------------------------------------------------------
// 6. RECORD MANAGEMENT (CRUD + SEARCH + FILTER)
// ---------------------------------------------------------------------------
app.get('/api/records/:colId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const { search, filter } = req.query;

  // First verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    let query = 'SELECT id, data, createdAt FROM records WHERE collectionId = ?';
    const params = [collectionId];

    if (search) {
      // For search, we need to fetch all records and filter in memory
      // since searching across JSON fields is complex in SQL
      query = 'SELECT id, data, createdAt FROM records WHERE collectionId = ?';
    }

    if (filter) {
      try {
        const { field, value } = JSON.parse(filter);
        // For filtering on JSON fields, we'll fetch and filter in memory
        // for simplicity. In a production app with lots of data,
        // we might want to use SQLite's JSON functions or denormalize
      } catch (e) {
        return res.status(400).json({ error: 'Invalid filter format' });
      }
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Parse JSON data and apply client-side filtering
      let records = rows.map(row => ({
        id: row.id,
        ...JSON.parse(row.data),
        createdAt: row.createdAt
      }));

      // Apply search filter (client-side)
      if (search) {
        const q = search.toLowerCase();
        records = records.filter(rec =>
          Object.values(rec).some(val =>
            val !== undefined && val !== null &&
            String(val).toLowerCase().includes(q)
          )
        );
      }

      // Apply filter (client-side)
      if (filter) {
        try {
          const { field, value } = JSON.parse(filter);
          records = records.filter(rec =>
            String(rec[field]) === String(value)
          );
        } catch (e) {
          // If filter parsing fails, ignore filter
        }
      }

      res.json(records);
    });
  });
});

app.post('/api/records/:colId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const record = {
      id: crypto.randomUUID(),
      ...req.body,
      createdAt: new Date().toISOString()
    };

    db.run(
      'INSERT INTO records (id, collectionId, data) VALUES (?, ?, ?)',
      [record.id, collectionId, JSON.stringify(record)],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.status(201).json(record);
      }
    );
  });
});

app.put('/api/records/:colId/:recId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const recordId = req.params.recId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Verify record exists and belongs to collection
    db.get('SELECT id FROM records WHERE id = ? AND collectionId = ?', [recordId, collectionId], (err, record) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }

      // Update record - merge existing data with new data
      db.get('SELECT data FROM records WHERE id = ? AND collectionId = ?', [recordId, collectionId], (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
          return res.status(404).json({ error: 'Record not found' });
        }

        const existingData = JSON.parse(row.data);
        const updatedData = { ...existingData, ...req.body, id: recordId, collectionId };
        // Keep original createdAt, update only if provided
        if (!req.body.createdAt) {
          updatedData.createdAt = existingData.createdAt;
        } else {
          updatedData.createdAt = req.body.createdAt;
        }

        db.run(
          'UPDATE records SET data = ?, createdAt = ? WHERE id = ? AND collectionId = ?',
          [JSON.stringify(updatedData), updatedData.createdAt, recordId, collectionId],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.json(updatedData);
          }
        );
      });
    });
  });
});

app.delete('/api/records/:colId/:recId', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const recordId = req.params.recId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Delete record
    db.run(
      'DELETE FROM records WHERE id = ? AND collectionId = ?',
      [recordId, collectionId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Record not found' });
        }
        res.json({ message: 'Deleted' });
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 7. SMART TOOLS (EXPORT, IMPORT, DEDUPLICATE)
// ---------------------------------------------------------------------------
app.get('/api/records/:colId/export', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;

  // Verify collection exists
  db.get('SELECT name FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    db.all('SELECT data, createdAt FROM records WHERE collectionId = ? ORDER BY createdAt', [collectionId], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const records = rows.map(row => ({
        ...JSON.parse(row.data),
        createdAt: row.createdAt
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=${collection.name}.json`);
      res.send(JSON.stringify(records, null, 2));
    });
  });
});

app.post('/api/records/:colId/import', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const importedData = req.body;
    if (!Array.isArray(importedData)) {
      return res.status(400).json({ error: 'Import data must be an array' });
    }

    db.serialize(() => {
      importedData.forEach(newRec => {
        // Ensure record has an ID
        const recordId = newRec.id || crypto.randomUUID();
        const recordData = {
          ...newRec,
          id: recordId,
          collectionId,
          createdAt: newRec.createdAt || new Date().toISOString()
        };

        db.run(
          'INSERT OR REPLACE INTO records (id, collectionId, data) VALUES (?, ?, ?)',
          [recordId, collectionId, JSON.stringify(recordData)],
          function(err) {
            if (err) {
              console.error('Error importing record:', err);
            }
          }
        );
      });

      res.json({ message: `Imported ${importedData.length} records` });
    });
  });
});

app.post('/api/records/:colId/deduplicate', authMiddleware, (req, res) => {
  const collectionId = req.params.colId;
  const { field } = req.body;

  if (!field) {
    return res.status(400).json({ error: 'Field to deduplicate is required' });
  }

  // Verify collection exists
  db.get('SELECT id FROM collections WHERE id = ?', [collectionId], (err, collection) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Fetch all records for deduplication (client-side for simplicity)
    db.all('SELECT id, data FROM records WHERE collectionId = ?', [collectionId], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const records = rows.map(row => ({
        id: row.id,
        ...JSON.parse(row.data)
      }));

      const seen = new Set();
      const recordsToKeep = [];
      const recordsToRemove = [];

      records.forEach(record => {
        const val = String(record[field] || '').toLowerCase().trim();
        if (!seen.has(val)) {
          seen.add(val);
          recordsToKeep.push(record);
        } else {
          recordsToRemove.push(record);
        }
      });

      // Remove duplicates
      if (recordsToRemove.length > 0) {
        db.serialize(() => {
          recordsToRemove.forEach(record => {
            db.run('DELETE FROM records WHERE id = ? AND collectionId = ?', [record.id, collectionId]);
          });
        });
      }

      res.json({
        message: `Removed ${recordsToRemove.length} duplicates`,
        removedCount: recordsToRemove.length
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 8. START SERVER
// ---------------------------------------------------------------------------
db.on('close', () => {
  console.log('Database connection closed.');
});

process.on('SIGINT', () => {
  db.close(() => {
    console.log('Database connection closed due to SIGINT');
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});