const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to SQLite database');
        db.run('PRAGMA foreign_keys = ON;');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS Users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT CHECK(role IN ('donor', 'staff', 'admin'))
        )`);

        // Donors Table
        db.run(`CREATE TABLE IF NOT EXISTS Donors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT,
            blood_group TEXT,
            phone TEXT,
            address TEXT,
            last_donation DATE,
            FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        )`);

        // Inventory Table
        db.run(`CREATE TABLE IF NOT EXISTS Inventory (
            blood_group TEXT PRIMARY KEY,
            units INTEGER DEFAULT 0,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        // Requests Table
        db.run(`CREATE TABLE IF NOT EXISTS Requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            requester_name TEXT,
            blood_group TEXT,
            units INTEGER,
            priority TEXT CHECK(priority IN ('Normal', 'Emergency')),
            status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Rejected')),
            request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES Users(id)
        )`);

        // Hospitals Table (lat/lng for Leaflet map)
        db.run(`CREATE TABLE IF NOT EXISTS Hospitals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            location TEXT,
            phone TEXT,
            emergency_contact TEXT,
            address TEXT,
            distance_km REAL,
            lat REAL DEFAULT 0.0,
            lng REAL DEFAULT 0.0
        )`);

        // Add lat/lng columns if they don't exist (migration for existing DBs)
        db.run(`ALTER TABLE Hospitals ADD COLUMN lat REAL DEFAULT 0.0`, () => {});
        db.run(`ALTER TABLE Hospitals ADD COLUMN lng REAL DEFAULT 0.0`, () => {});

        // Seed Inventory if empty
        db.get("SELECT COUNT(*) as count FROM Inventory", (err, row) => {
            if (row && row.count === 0) {
                const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
                const stmt = db.prepare("INSERT INTO Inventory (blood_group, units) VALUES (?, ?)");
                bloodGroups.forEach(group => {
                    stmt.run(group, Math.floor(Math.random() * 20) + 5);
                });
                stmt.finalize();
                console.log('Inventory seeded');
            }
        });

        // Seed Hospitals if empty (with real GPS coordinates)
        db.get("SELECT COUNT(*) as count FROM Hospitals", (err, row) => {
            if (row && row.count === 0) {
                const sampleHospitals = [
                    { name: 'MetroCare Emergency Hospital',    location: 'Downtown',      phone: '+1 (555) 019-2831', emergency_contact: '102 / 911-EXT-1', address: '450 Healthcare Blvd, Downtown Zone',       distance_km: 1.2, lat: 28.6139, lng: 77.2090 },
                    { name: 'St. Jude Trauma & Blood Center', location: 'North District', phone: '+1 (555) 048-9120', emergency_contact: '102 / 911-EXT-2', address: '12 Medical Plaza, North District',           distance_km: 3.5, lat: 28.6480, lng: 77.2070 },
                    { name: 'City Central Trauma Hospital',   location: 'Central Zone',  phone: '+1 (555) 082-3341', emergency_contact: '102 / 911-EXT-3', address: '89 Main Street, Central Hub',               distance_km: 2.1, lat: 28.6290, lng: 77.2200 },
                    { name: 'Sunrise LifeCare Medical Center',location: 'East Suburb',   phone: '+1 (555) 011-7788', emergency_contact: '102 / 911-EXT-4', address: '77 LifeCare Avenue, East Suburb',            distance_km: 4.8, lat: 28.6300, lng: 77.2600 },
                    { name: 'Apex General Health Institute',  location: 'South Zone',    phone: '+1 (555) 099-4455', emergency_contact: '102 / 911-EXT-5', address: '302 Apex Drive, South Medical Zone',        distance_km: 5.2, lat: 28.5900, lng: 77.2100 }
                ];
                const stmt = db.prepare("INSERT INTO Hospitals (name, location, phone, emergency_contact, address, distance_km, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                sampleHospitals.forEach(h => {
                    stmt.run(h.name, h.location, h.phone, h.emergency_contact, h.address, h.distance_km, h.lat, h.lng);
                });
                stmt.finalize();
                console.log('Hospitals seeded with GPS coordinates');
            }
        });

        // Seed Sample Donors with locations if empty
        db.get("SELECT COUNT(*) as count FROM Donors", (err, row) => {
            if (row && row.count === 0) {
                const sampleDonors = [
                    { name: 'Sarah Jenkins', blood_group: 'O-', phone: '+1 (555) 234-5678', address: 'Downtown', last_donation: '2026-05-10' },
                    { name: 'Marcus Vance', blood_group: 'A+', phone: '+1 (555) 876-5432', address: 'North District', last_donation: '2026-06-01' },
                    { name: 'Elena Rostova', blood_group: 'B+', phone: '+1 (555) 345-6789', address: 'Central Zone', last_donation: '2026-04-15' },
                    { name: 'David Kim', blood_group: 'AB+', phone: '+1 (555) 987-6543', address: 'East Suburb', last_donation: '2026-03-20' },
                    { name: 'Rachel Adams', blood_group: 'O+', phone: '+1 (555) 456-7890', address: 'South Zone', last_donation: '2026-06-25' }
                ];

                sampleDonors.forEach(d => {
                    db.run("INSERT INTO Users (username, password, role) VALUES (?, ?, ?)", [d.name.toLowerCase().replace(/\s+/g, ''), bcrypt.hashSync('donor123', 10), 'donor'], function(err) {
                        if (!err) {
                            db.run("INSERT INTO Donors (user_id, name, blood_group, phone, address, last_donation) VALUES (?, ?, ?, ?, ?, ?)",
                                [this.lastID, d.name, d.blood_group, d.phone, d.address, d.last_donation]
                            );
                        }
                    });
                });
                console.log('Sample donors seeded');
            }
        });

        // Create or update default admin with hashed password
        db.get("SELECT * FROM Users WHERE username = 'admin'", (err, row) => {
            if (!row) {
                const hashedPassword = bcrypt.hashSync('admin123', 10);
                db.run("INSERT INTO Users (username, password, role) VALUES (?, ?, ?)", ['admin', hashedPassword, 'admin']);
                console.log('Default admin created: admin/admin123');
            } else if (!row.password.startsWith('$2a$') && !row.password.startsWith('$2b$')) {
                const hashedPassword = bcrypt.hashSync('admin123', 10);
                db.run("UPDATE Users SET password = ? WHERE username = 'admin'", [hashedPassword]);
                console.log('Default admin password updated to hash');
            }
        });
    });
}

module.exports = db;
