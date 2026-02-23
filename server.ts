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

// --- Database Initialization ---
async function initDb() {
  console.log("Checking database tables...");
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

    // Seed trips if none exist
    const { rows } = await sql`SELECT COUNT(*) as count FROM trips`;
    const tripCount = parseInt(rows[0]?.count || "0");

    if (tripCount === 0) {
      console.log("Seeding database with trips...");
      const locations = ["Malete Campus", "Lagos", "Abuja", "Ibadan"];
      const tripsToInsert = [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const origin of locations) {
        for (const dest of locations) {
          if (origin !== dest) {
            for (let i = 0; i < 20; i++) {
              const date = new Date(today);
              date.setDate(today.getDate() + i);
              const dateStr = date.toISOString().split('T')[0];
              tripsToInsert.push({ origin, dest, dateStr, price: 15000 });
            }
          }
        }
      }

      // Insert in chunks
      for (let i = 0; i < tripsToInsert.length; i += 20) {
        const chunk = tripsToInsert.slice(i, i + 20);
        await Promise.all(chunk.map(t =>
          sql`INSERT INTO trips (origin, destination, departure_date, price) VALUES (${t.origin}, ${t.dest}, ${t.dateStr}, ${t.price})`
        ));
      }

      console.log(`Database seeded successfully with ${tripsToInsert.length} trips.`);
    } else {
      console.log(`Database already contains ${tripCount} trips.`);
    }
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Initialize DB
  await initDb();

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
      res.status(400).json({ error: error.message.includes("unique") ? "Matric number already registered" : "Registration failed" });
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
      res.status(500).json({ error: "Login failed" });
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
      return res.status(400).json({ error: "Missing required parameters" });
    }
    try {
      const { rows } = await sql`
        SELECT * FROM trips 
        WHERE origin = ${origin as string} 
        AND destination = ${destination as string} 
        AND departure_date = ${date as string}
      `;
      res.json(rows);
    } catch (err) {
      console.error("Fetch trips error:", err);
      res.status(500).json({ error: "Failed to fetch trips. Check database connection." });
    }
  });

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
      res.status(500).json({ error: "Failed to fetch seats" });
    }
  });

  // Reservation Routes
  app.post("/api/reserve", async (req, res) => {
    const { tripId, seats } = req.body;
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (seats.length > 2) return res.status(400).json({ error: "Maximum 2 seats allowed" });

    try {
      for (const seat of seats) {
        const { rows } = await sql`
          SELECT id FROM reservations 
          WHERE trip_id = ${tripId} 
          AND seat_number = ${seat} 
          AND payment_status = 'paid'
        `;
        if (rows.length > 0) throw new Error(`Seat ${seat} is already taken`);

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
      res.status(500).json({ error: "Failed to fetch reservations" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
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

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  return app;
}

export const appPromise = startServer();
export default appPromise;
