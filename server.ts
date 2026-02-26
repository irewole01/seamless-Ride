import express from "express";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Supabase Client ──
const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!supabaseUrl || !supabaseKey) {
  console.error("CRITICAL: Supabase environment variables are missing!");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ── Express App ──
const app = express();

// Middleware to catch common errors
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

app.use(express.json());

// ── Serverless-friendly Session (cookie-session) ──
// Session data is stored inside a signed cookie — no server-side state needed.
// This eliminates the MemoryStore warning and works on Vercel Serverless Functions.
app.use(
  cookieSession({
    name: "sr_session",
    secret: process.env.SESSION_SECRET || "seamless-ride-secret-123",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  })
);

// ── Cache-Control for /api/* routes ──
// Prevents browsers & CDNs from caching API responses (fixes 304 Not Modified).
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// ── Seed Helper ──
async function seedTripsIfEmpty() {
  try {
    const { count } = await supabase
      .from("trips")
      .select("*", { count: "exact", head: true });

    if (count === 0) {
      console.log("Seeding database with trips...");
      const locations = ["Malete Campus", "Lagos", "Abuja", "Ibadan"];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const newTrips: any[] = [];
      for (const origin of locations) {
        for (const dest of locations) {
          if (origin !== dest) {
            for (let i = 0; i < 7; i++) {
              const date = new Date(today);
              date.setDate(today.getDate() + i);
              const dateStr = date.toISOString().split("T")[0];
              newTrips.push({
                origin,
                destination: dest,
                departure_date: dateStr,
                price: origin === "Malete Campus" ? 12000 : 15000,
              });
            }
          }
        }
      }
      const { error } = await supabase.from("trips").insert(newTrips);
      if (error) console.error("Seeding error:", error);
      else console.log("Seeding successful!");
    }
  } catch (e) {
    console.error("Background seeding failed", e);
  }
}

// Database init
const initTables = async () => {
  console.log("Database connection initialized via Supabase.");
  await seedTripsIfEmpty();
};

initTables();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AUTH ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post("/api/register", async (req, res) => {
  const { fullName, matricNumber, password } = req.body;
  if (!fullName || !matricNumber || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          full_name: fullName,
          matric_number: matricNumber,
          password: hashedPassword,
        },
      ])
      .select("id")
      .single();

    if (error) throw error;
    res.json({ success: true, userId: data.id });
  } catch (error: any) {
    console.error("Registration error:", error);
    const msg = (error.message || "").toLowerCase();
    res.status(400).json({
      error:
        msg.includes("unique") || msg.includes("already exists")
          ? "Matric number already registered"
          : "Registration failed. Try again.",
    });
  }
});

app.post("/api/login", async (req, res) => {
  const { matricNumber, password } = req.body;
  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("matric_number", matricNumber)
      .single();

    if (user && (await bcrypt.compare(password, user.password))) {
      (req as any).session.userId = user.id;
      (req as any).session.userName = user.full_name;
      res.json({
        success: true,
        user: {
          id: user.id,
          fullName: user.full_name,
          matricNumber: user.matric_number,
        },
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login system currently unavailable" });
  }
});

app.get("/api/me", async (req, res) => {
  const userId = (req as any).session?.userId;
  if (userId) {
    try {
      const { data: user } = await supabase
        .from("users")
        .select("id, full_name, matric_number")
        .eq("id", userId)
        .single();

      if (user) {
        return res.json({
          user: {
            id: user.id,
            fullName: user.full_name,
            matricNumber: user.matric_number,
          },
        });
      }
    } catch (_) {
      /* fall through */
    }
  }
  res.json({ user: null });
});

app.post("/api/logout", (req, res) => {
  (req as any).session = null; // cookie-session: set to null to clear
  res.json({ success: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRIP ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.get("/api/trips", async (req, res) => {
  const { origin, destination, date } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: "Missing search criteria" });
  }
  try {
    const { data: trips, error } = await supabase
      .from("trips")
      .select("*")
      .eq("origin", origin as string)
      .eq("destination", destination as string)
      .eq("departure_date", date as string);

    if (error) throw error;

    // If no trips found, run a quick seeding in background for the next request
    if (!trips || trips.length === 0) {
      seedTripsIfEmpty();
    }

    res.json(trips || []);
  } catch (err) {
    console.error("Fetch trips error:", err);
    res.status(500).json({ error: "Could not retrieve trips. Connection error." });
  }
});

app.get("/api/trips/:id/seats", async (req, res) => {
  try {
    const { data: reservations, error } = await supabase
      .from("reservations")
      .select("seat_number")
      .eq("trip_id", parseInt(req.params.id))
      .eq("payment_status", "paid");

    if (error) throw error;
    res.json((reservations || []).map((r: any) => r.seat_number));
  } catch (err) {
    console.error("Fetch seats error:", err);
    res.status(500).json({ error: "Could not fetch availability" });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESERVATION ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
app.post("/api/reserve", async (req, res) => {
  const { tripId, seats } = req.body;
  const userId = (req as any).session?.userId;
  if (!userId)
    return res.status(401).json({ error: "Please login to reserve" });
  if (!seats || seats.length === 0)
    return res.status(400).json({ error: "No seats selected" });
  if (seats.length > 2)
    return res.status(400).json({ error: "Max 2 seats per booking" });

  try {
    for (const seat of seats) {
      const { data: existing, error: checkError } = await supabase
        .from("reservations")
        .select("id")
        .eq("trip_id", tripId)
        .eq("seat_number", seat)
        .eq("payment_status", "paid")
        .maybeSingle();

      if (checkError) throw checkError;
      if (existing) throw new Error(`Seat ${seat} is already booked`);

      const { error: insertError } = await supabase
        .from("reservations")
        .insert([
          {
            user_id: userId,
            trip_id: tripId,
            seat_number: seat,
            payment_status: "paid",
          },
        ]);

      if (insertError) throw insertError;
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("Reservation error:", error);
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/my-reservations", async (req, res) => {
  const userId = (req as any).session?.userId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { data: reservations, error } = await supabase
      .from("reservations")
      .select(
        `
        *,
        trips (
          origin,
          destination,
          departure_date,
          price
        )
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const flattened = (reservations || []).map((r: any) => ({
      ...r,
      origin: r.trips.origin,
      destination: r.trips.destination,
      departure_date: r.trips.departure_date,
      price: r.trips.price,
    }));

    res.json(flattened);
  } catch (err) {
    console.error("Fetch reservations error:", err);
    res.status(500).json({ error: "Failed to load reservations" });
  }
});

// ── Static Files & Server ──
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
    if (req.path.startsWith("/api")) return next();
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
