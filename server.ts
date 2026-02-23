import express from "express";
import { createServer as createViteServer } from "vite";
import { sql } from "@vercel/postgres";
import session from "express-session";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- Database Initialization ---
// We create tables IMMEDIATELY on script load so they are ready
const initTables = async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        matric_number TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        origin TEXT NOT NULL,
        destination TEXT NOT NULL,
        departure_date TEXT NOT NULL,
        price INTEGER NOT NULL
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        trip_id INTEGER NOT NULL,
        seat_number INTEGER NOT NULL,
        payment_status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log("Tables verified/created.");
  } catch (err) {
    console.error("Critical: Table creation failed", err);
  }
};

// Background init
initTables();

// Middleware to catch common errors
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "seamless-ride-secret-123",
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
  if (!fullName || !matricNumber || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await sql`
      INSERT INTO users (full_name, matric_number, password) 
      VALUES (${fullName}, ${matricNumber}, ${hashedPassword})
      RETURNING id
    `;
    res.json({ success: true, userId: rows[0].id });
  } catch (error: any) {
    console.error("Registration error:", error);
    const msg = error.message.toLowerCase();
    res.status(400).json({
      error: msg.includes("unique") || msg.includes("already exists")
        ? "Matric number already registered"
        : "Registration failed. Try again."
    });
  }
});

app.post("/api/login", async (req, res) => {
  const { matricNumber, password } = req.body;
  try {
    const { rows } = await sql`SELECT * FROM users WHERE matric_number = ${matricNumber}`;
    const user = rows[0];
    if (user && await bcrypt.compare(password, user.password)) {
      (req.session as any).userId = user.id;
      (req.session as any).userName = user.full_name;
      res.json({ success: true, user: { id: user.id, fullName: user.full_name, matricNumber: user.matric_number } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login system currently unavailable" });
  }
});

app.get("/api/me", async (req, res) => {
  const userId = (req.session as any).userId;
  if (userId) {
    try {
      const { rows } = await sql`SELECT id, full_name as "fullName", matric_number as "matricNumber" FROM users WHERE id = ${userId}`;
      res.json({ user: rows[0] });
    } catch (err) {
      res.json({ user: null });
    }
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
app.get("/api/trips", async (req, res) => {
  const { origin, destination, date } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: "Missing search criteria" });
  }
  try {
    const { rows } = await sql`
      SELECT * FROM trips 
      WHERE origin = ${origin as string} 
      AND destination = ${destination as string} 
      AND departure_date = ${date as string}
      LIMIT 50
    `;

    // If no trips found, run a quick seeding in background for the next request
    if (rows.length === 0) {
      seedTripsIfEmpty();
    }

    res.json(rows);
  } catch (err) {
    console.error("Fetch trips error:", err);
    res.status(500).json({ error: "Could not retrieve trips. Connection error." });
  }
});

const seedTripsIfEmpty = async () => {
  try {
    const { rows: countRows } = await sql`SELECT COUNT(*) as count FROM trips`;
    if (parseInt(countRows[0].count) === 0) {
      console.log("Seeding in background...");
      const locations = ["Malete Campus", "Lagos", "Abuja", "Ibadan"];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Just seed a few for now to be fast
      for (const origin of locations) {
        for (const dest of locations) {
          if (origin !== dest) {
            for (let i = 0; i < 5; i++) { // Smaller initial batch
              const date = new Date(today);
              date.setDate(today.getDate() + i);
              const dateStr = date.toISOString().split('T')[0];
              await sql`INSERT INTO trips (origin, destination, departure_date, price) VALUES (${origin}, ${dest}, ${dateStr}, 15000)`;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Background seeding failed", e);
  }
};

app.get("/api/trips/:id/seats", async (req, res) => {
  try {
    const { rows } = await sql`
      SELECT seat_number FROM reservations 
      WHERE trip_id = ${parseInt(req.params.id)} 
      AND payment_status = 'paid'
    `;
    res.json(rows.map((r: any) => r.seat_number));
  } catch (err) {
    console.error("Fetch seats error:", err);
    res.status(500).json({ error: "Could not fetch availability" });
  }
});

// Reservation Routes
app.post("/api/reserve", async (req, res) => {
  const { tripId, seats } = req.body;
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Please login to reserve" });
  if (!seats || seats.length === 0) return res.status(400).json({ error: "No seats selected" });
  if (seats.length > 2) return res.status(400).json({ error: "Max 2 seats per booking" });

  try {
    for (const seat of seats) {
      const { rows } = await sql`
        SELECT id FROM reservations 
        WHERE trip_id = ${tripId} 
        AND seat_number = ${seat} 
        AND payment_status = 'paid'
      `;
      if (rows.length > 0) throw new Error(`Seat ${seat} is already booked`);

      await sql`
        INSERT INTO reservations (user_id, trip_id, seat_number, payment_status) 
        VALUES (${userId}, ${tripId}, ${seat}, 'paid')
      `;
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("Reservation error:", error);
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/my-reservations", async (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows } = await sql`
      SELECT r.*, t.origin, t.destination, t.departure_date, t.price 
      FROM reservations r 
      JOIN trips t ON r.trip_id = t.id 
      WHERE r.user_id = ${userId}
      ORDER BY r.created_at DESC
    `;
    res.json(rows);
  } catch (err) {
    console.error("Fetch reservations error:", err);
    res.status(500).json({ error: "Failed to load reservations" });
  }
});

// Service Static Files
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  }).then((vite) => {
    app.use(vite.middlewares);
  });
} else {
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });
}

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
