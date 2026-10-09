# 🩸 LifePulse | Real-Time Blood Bank System

LifePulse is an interactive, medical-grade blood bank management system featuring real-time browser GPS location tracking, Leaflet.js interactive OpenStreetMap visualization, stock inventory health gauges, emergency donor matching, and an encrypted emergency SMS dispatch center.

---

## ✨ Features

- 🏥 **Nearby Emergency Hospital Map**: Real-time GPS location tracking with Leaflet.js interactive maps and live distance calculations.
- 🩸 **Inventory Health Gauges**: Visual capacity indicators for all 8 blood groups (`A+`, `A-`, `B+`, `B-`, `O+`, `O-`, `AB+`, `AB-`) with 1-click interactive filtering.
- 📡 **Emergency Dispatch & SMS Alert Center**: Simulated 3-step encrypted SMS alert transmission payload (`Encrypting` ➔ `Alerting` ➔ `Confirmed`).
- 🔐 **Role-Based Access Control (RBAC)**: Secure multi-role access for Admins, Staff, and Donors backed by bcrypt password hashing and JWT authentication.
- 📱 **Progressive Web App (PWA)**: Desktop/Mobile installation manifest and Service Worker offline asset caching.
- 🛡️ **Hardened Security**: Includes security HTTP headers (`X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`), XSS input sanitization, and 100% SQL injection immunity.

---

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3 (Medical Palette), Vanilla JavaScript, Leaflet.js, FontAwesome.
- **Backend**: Node.js, Express.js.
- **Database**: SQLite3 (Parameterized SQL queries).
- **Authentication**: JWT (JSON Web Tokens) & Bcrypt password hashing.

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v16+ recommended)

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/Akshay-27-jain/Blood-Bsnk-System.git
   cd Blood-Bsnk-System/backend
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start the Server**
   ```bash
   node server.js
   ```

4. **Access the Application**
   Open your browser and navigate to: `http://localhost:5000`

---

## 🧪 Running Automated Tests

The repository includes a 21-point automated security and API test suite:

```bash
cd backend
node test_suite.js
```

---

## 🔒 Security & Vulnerability Reporting

Please refer to [SECURITY.md](SECURITY.md) for details on security policy and reporting vulnerabilities.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
