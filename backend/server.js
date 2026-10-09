const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./database');

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'lifepulse-super-secret-key-2026';

app.use(cors());
app.use(bodyParser.json());

// Security Response Headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Serve static files from the 'frontend' directory
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// JWT & Authorization Middlewares
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
        if (!err) {
            req.user = decodedUser;
        }
        next();
    });
}

function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

function requireRole(allowedRoles = []) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient role permissions' });
        }
        next();
    };
}

app.use(authenticateToken);

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// --- Authentication Routes ---

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }

    const query = `
        SELECT u.id, u.username, u.password, u.role, 
               d.id as donor_id, d.name, d.blood_group, d.phone, d.address, d.last_donation 
        FROM Users u 
        LEFT JOIN Donors d ON u.id = d.user_id 
        WHERE u.username = ?
    `;

    db.get(query, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ message: 'Invalid username or password' });

        let isMatch = false;
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            isMatch = (password === user.password);
        }

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        const profile = {
            id: user.id,
            username: user.username,
            role: user.role,
            donor_id: user.donor_id || null,
            name: user.name || user.username,
            blood_group: user.blood_group || null,
            phone: user.phone || null,
            address: user.address || null,
            last_donation: user.last_donation || null
        };

        const token = jwt.sign(profile, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            message: 'Login successful',
            token,
            user: profile
        });
    });
});

app.post('/api/register', async (req, res) => {
    const { username, password, role, name, blood_group, phone, address } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const assignedRole = role || 'donor';

        db.run("INSERT INTO Users (username, password, role) VALUES (?, ?, ?)", [username, hashedPassword, assignedRole], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Username is already taken' });
                }
                return res.status(500).json({ error: err.message });
            }

            const userId = this.lastID;
            if (assignedRole === 'donor') {
                db.run(
                    "INSERT INTO Donors (user_id, name, blood_group, phone, address) VALUES (?, ?, ?, ?, ?)",
                    [userId, name || username, blood_group || 'A+', phone || '', address || ''],
                    (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ message: 'Registration successful! You can now login.' });
                    }
                );
            } else {
                res.json({ message: 'Registration successful! You can now login.' });
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- System Dashboard Stats ---

app.get('/api/stats', (req, res) => {
    db.serialize(() => {
        let stats = {
            totalDonors: 0,
            totalUnits: 0,
            pendingRequests: 0,
            approvedRequests: 0,
            hospitalsCount: 0
        };

        db.get("SELECT COUNT(*) as count FROM Donors", (err, row) => {
            if (row) stats.totalDonors = row.count;
            
            db.get("SELECT SUM(units) as total FROM Inventory", (err, row) => {
                if (row && row.total) stats.totalUnits = row.total;

                db.get("SELECT COUNT(*) as count FROM Requests WHERE status = 'Pending'", (err, row) => {
                    if (row) stats.pendingRequests = row.count;

                    db.get("SELECT COUNT(*) as count FROM Requests WHERE status = 'Approved'", (err, row) => {
                        if (row) stats.approvedRequests = row.count;

                        db.get("SELECT COUNT(*) as count FROM Hospitals", (err, row) => {
                            if (row) stats.hospitalsCount = row.count;
                            res.json(stats);
                        });
                    });
                });
            });
        });
    });
});

// --- Hospitals Routes ---

app.get('/api/hospitals', (req, res) => {
    const { location } = req.query;
    let sql = "SELECT * FROM Hospitals";
    let params = [];

    if (location) {
        sql += " WHERE location LIKE ? OR name LIKE ? OR address LIKE ?";
        const queryParam = `%${location}%`;
        params.push(queryParam, queryParam, queryParam);
    }

    sql += " ORDER BY distance_km ASC, name ASC";

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- Inventory Routes ---

app.get('/api/inventory', (req, res) => {
    db.all("SELECT * FROM Inventory ORDER BY blood_group ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/inventory/adjust', (req, res) => {
    const { blood_group, units } = req.body;
    if (!blood_group || units === undefined) {
        return res.status(400).json({ error: 'Blood group and units count are required' });
    }

    const newUnits = Math.max(0, parseInt(units));

    db.run(
        "UPDATE Inventory SET units = ?, last_updated = CURRENT_TIMESTAMP WHERE blood_group = ?",
        [newUnits, blood_group],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `Inventory for ${blood_group} set to ${newUnits} units.` });
        }
    );
});

// --- Blood Request Routes ---

app.post('/api/requests', (req, res) => {
    const { requester_name, blood_group, units, priority, user_id } = req.body;
    
    if (!requester_name || !blood_group || !units || units <= 0) {
        return res.status(400).json({ error: 'Please provide requester name, blood group, and valid units' });
    }

    db.run(
        "INSERT INTO Requests (requester_name, blood_group, units, priority, user_id) VALUES (?, ?, ?, ?, ?)",
        [requester_name, blood_group, parseInt(units), priority || 'Normal', user_id || (req.user ? req.user.id : null)],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Request submitted successfully', requestId: this.lastID });
        }
    );
});

app.get('/api/requests', (req, res) => {
    db.all(
        "SELECT * FROM Requests ORDER BY CASE WHEN priority = 'Emergency' THEN 0 ELSE 1 END, request_date DESC",
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.get('/api/requests/matching', (req, res) => {
    const { blood_group } = req.query;
    let sql = "SELECT * FROM Requests WHERE status = 'Pending'";
    let params = [];

    if (blood_group) {
        sql += " AND blood_group = ?";
        params.push(blood_group);
    }

    sql += " ORDER BY CASE WHEN priority = 'Emergency' THEN 0 ELSE 1 END, request_date DESC";

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.patch('/api/requests/:id', (req, res) => {
    const { status } = req.body;
    const requestId = req.params.id;

    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status update' });
    }

    db.get("SELECT * FROM Requests WHERE id = ?", [requestId], (err, request) => {
        if (err || !request) return res.status(404).json({ error: 'Request not found' });

        if (request.status !== 'Pending') {
            return res.status(400).json({ message: `Request is already ${request.status}` });
        }

        if (status === 'Approved') {
            db.get("SELECT units FROM Inventory WHERE blood_group = ?", [request.blood_group], (err, inv) => {
                if (err || !inv) {
                    return res.status(400).json({ message: 'Blood group not found in inventory' });
                }
                if (inv.units < request.units) {
                    return res.status(400).json({ message: `Insufficient inventory. Available: ${inv.units} units, Required: ${request.units} units.` });
                }

                db.serialize(() => {
                    db.run("UPDATE Inventory SET units = units - ?, last_updated = CURRENT_TIMESTAMP WHERE blood_group = ?", [request.units, request.blood_group]);
                    db.run("UPDATE Requests SET status = 'Approved' WHERE id = ?", [requestId]);
                    res.json({ message: 'Request approved and inventory updated successfully' });
                });
            });
        } else {
            db.run("UPDATE Requests SET status = 'Rejected' WHERE id = ?", [requestId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Request rejected' });
            });
        }
    });
});

// --- Donor Routes & Emergency Donor Finder ---

app.get('/api/donors', (req, res) => {
    db.all("SELECT * FROM Donors ORDER BY name ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/donors/emergency', (req, res) => {
    const { blood_group, location } = req.query;
    let sql = "SELECT id, name, blood_group, phone, address, last_donation FROM Donors WHERE 1=1";
    let params = [];

    if (blood_group) {
        sql += " AND blood_group = ?";
        params.push(blood_group);
    }
    if (location) {
        sql += " AND (address LIKE ? OR name LIKE ?)";
        const locParam = `%${location}%`;
        params.push(locParam, locParam);
    }

    sql += " ORDER BY name ASC";

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/donations', (req, res) => {
    let { donor_id, user_id, units } = req.body;
    
    if (!user_id && req.user) {
        user_id = req.user.id;
    }
    const donationUnits = parseInt(units) || 1;

    if (donationUnits <= 0) {
        return res.status(400).json({ error: 'Donation units must be greater than 0' });
    }

    const lookupQuery = user_id 
        ? "SELECT * FROM Donors WHERE user_id = ?"
        : "SELECT * FROM Donors WHERE id = ?";
    const lookupParam = user_id || donor_id;

    db.get(lookupQuery, [lookupParam], (err, donor) => {
        if (err || !donor) {
            return res.status(404).json({ error: 'Donor profile not found' });
        }

        const currentDateStr = new Date().toISOString().split('T')[0];

        db.serialize(() => {
            db.run("UPDATE Inventory SET units = units + ?, last_updated = CURRENT_TIMESTAMP WHERE blood_group = ?", [donationUnits, donor.blood_group]);
            db.run("UPDATE Donors SET last_donation = ? WHERE id = ?", [currentDateStr, donor.id]);
            
            res.json({ 
                message: 'Donation recorded successfully! Thank you for saving lives.',
                last_donation: currentDateStr,
                units_added: donationUnits
            });
        });
    });
});

// --- Reports Route ---

app.get('/api/reports/summary', (req, res) => {
    db.serialize(() => {
        let reportData = {
            generatedAt: new Date().toISOString(),
            inventory: [],
            totalDonors: 0,
            pendingRequestsCount: 0,
            approvedRequestsCount: 0,
            recentRequests: []
        };

        db.all("SELECT blood_group, units, last_updated FROM Inventory", (err, inv) => {
            reportData.inventory = inv || [];
            
            db.get("SELECT COUNT(*) as count FROM Donors", (err, dRow) => {
                reportData.totalDonors = dRow ? dRow.count : 0;
                
                db.all("SELECT * FROM Requests ORDER BY request_date DESC LIMIT 10", (err, reqs) => {
                    reportData.recentRequests = reqs || [];
                    reportData.pendingRequestsCount = (reqs || []).filter(r => r.status === 'Pending').length;
                    reportData.approvedRequestsCount = (reqs || []).filter(r => r.status === 'Approved').length;
                    
                    res.json(reportData);
                });
            });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
