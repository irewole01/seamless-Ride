import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import session from "express-session";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("seamless_ride.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    matric_number TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    departure_date TEXT NOT NULL,
    price INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    trip_id INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    payment_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(trip_id) REFERENCES trips(id)
  );
`);

// Seed some trips if none exist
const tripCount = db.prepare("SELECT COUNT(*) as count FROM trips").get() as { count: number };
if (tripCount.count === 0) {
  const insertTrip = db.prepare("INSERT INTO trips (origin, destination, departure_date, price) VALUES (?, ?, ?, ?)");
  const locations = ["Malete Campus", "Lagos", "Abuja", "Ibadan"];
  const dates = ["2026-03-01", "2026-03-02", "2026-03-03"];
  
  for (const origin of locations) {
    for (const dest of locations) {
      if (origin !== dest) {
        // Only allow trips to/from Malete as per requirements
        if (origin === "Malete Campus" || dest === "Malete Campus") {
          for (const date of dates) {
            insertTrip.run(origin, dest, date, 15000); // Sample price
          }
        }
      }
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(session({
    secret: "seamless-ride-secret-123",
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === "production",
      sameSite: 'none',
      httpOnly: true
    }
  }));

  // Auth Routes
  app.post("/api/register", async (req, res) => {
    const { fullName, matricNumber, password } = req.body;
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const info = db.prepare("INSERT INTO users (full_name, matric_number, password) VALUES (?, ?, ?)").run(fullName, matricNumber, hashedPassword);
      res.json({ success: true, userId: info.lastInsertRowid });
    } catch (error: any) {
      res.status(400).json({ error: error.message.includes("UNIQUE") ? "Matric number already registered" : "Registration failed" });
    }
  });

  app.post("/api/login", async (req, res) => {
    const { matricNumber, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE matric_number = ?").get(matricNumber) as any;
    if (user && await bcrypt.compare(password, user.password)) {
      (req.session as any).userId = user.id;
      (req.session as any).userName = user.full_name;
      res.json({ success: true, user: { id: user.id, fullName: user.full_name, matricNumber: user.matric_number } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/me", (req, res) => {
    if ((req.session as any).userId) {
      const user = db.prepare("SELECT id, full_name as fullName, matric_number as matricNumber FROM users WHERE id = ?").get((req.session as any).userId);
      res.json({ user });
    } else {
      res.json({ user: null });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // Trip Routes
  app.get("/api/trips", (req, res) => {
    const { origin, destination, date } = req.query;
    const trips = db.prepare("SELECT * FROM trips WHERE origin = ? AND destination = ? AND departure_date = ?").all(origin, destination, date);
    res.json(trips);
  });

  app.get("/api/trips/:id/seats", (req, res) => {
    const reservations = db.prepare("SELECT seat_number FROM reservations WHERE trip_id = ? AND payment_status = 'paid'").all(req.params.id);
    res.json(reservations.map((r: any) => r.seat_number));
  });

  // Reservation Routes
  app.post("/api/reserve", (req, res) => {
    const { tripId, seats } = req.body;
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (seats.length > 2) return res.status(400).json({ error: "Maximum 2 seats allowed" });

    const transaction = db.transaction(() => {
      for (const seat of seats) {
        // Check if seat is already taken
        const existing = db.prepare("SELECT id FROM reservations WHERE trip_id = ? AND seat_number = ? AND payment_status = 'paid'").get(tripId, seat);
        if (existing) throw new Error(`Seat ${seat} is already taken`);
        
        db.prepare("INSERT INTO reservations (user_id, trip_id, seat_number, payment_status) VALUES (?, ?, ?, 'paid')").run(userId, tripId, seat);
      }
    });

    try {
      transaction();
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/my-reservations", (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const reservations = db.prepare(`
      SELECT r.*, t.origin, t.destination, t.departure_date, t.price 
      FROM reservations r 
      JOIN trips t ON r.trip_id = t.id 
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `).all(userId);
    res.json(reservations);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  if (process.env.VERCEL) {
    return app;
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  return app;
}

export const appPromise = startServer();
export default appPromise;
