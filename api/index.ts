import express from "express";
import { createClient } from "@supabase/supabase-js";
import session from "express-session";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";
// No dotenv.config() needed for Vercel production to avoid file lookups


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
    console.error("CRITICAL: Supabase environment variables are missing!");
} else {
    console.log(`Supabase Client initialized with URL: ${supabaseUrl.substring(0, 15)}...`);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false
    }
});

const app = express();

async function seedTripsIfEmpty() {
    try {
        const { count, error: countError } = await supabase
            .from('trips')
            .select('*', { count: 'exact', head: true });

        if (count === 0) {
            console.log("Seeding database with trips...");
            const locations = ["Malete Campus", "Lagos", "Abuja", "Ibadan"];
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const newTrips = [];
            for (const origin of locations) {
                for (const dest of locations) {
                    if (origin !== dest) {
                        for (let i = 0; i < 7; i++) {
                            const date = new Date(today);
                            date.setDate(today.getDate() + i);
                            const dateStr = date.toISOString().split('T')[0];
                            newTrips.push({
                                origin,
                                destination: dest,
                                departure_date: dateStr,
                                price: origin === "Malete Campus" ? 12000 : 15000
                            });
                        }
                    }
                }
            }
            const { error } = await supabase.from('trips').insert(newTrips);
            if (error) console.error("Seeding error:", error);
            else console.log("Seeding successful!");
        }
    } catch (e) {
        console.error("Background seeding failed", e);
    }
}

const initTables = async () => {
    console.log("Database connection initialized via Supabase.");
    await seedTripsIfEmpty();
};

initTables();

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || "seamless-ride-secret-123",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
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
        const { data, error } = await supabase
            .from('users')
            .insert([{ full_name: fullName, matric_number: matricNumber, password: hashedPassword }])
            .select('id')
            .single();

        if (error) throw error;
        res.json({ success: true, userId: data.id });
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
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('matric_number', matricNumber)
            .single();

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
            const { data: user, error } = await supabase
                .from('users')
                .select('id, full_name, matric_number')
                .eq('id', userId)
                .single();

            if (user) {
                res.json({ user: { id: user.id, fullName: user.full_name, matricNumber: user.matric_number } });
            } else {
                res.json({ user: null });
            }
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
        const { data: trips, error } = await supabase
            .from('trips')
            .select('*')
            .eq('origin', origin as string)
            .eq('destination', destination as string)
            .eq('departure_date', date as string);

        if (error) throw error;
        res.json(trips || []);
    } catch (err: any) {
        const errorMsg = err.message || "Unknown connection error";
        console.error("Fetch trips error:", errorMsg);
        res.status(500).json({
            error: "Could not retrieve trips. Connection error.",
            debug: `Err: ${errorMsg.substring(0, 50)}`,
            hasUrl: !!process.env.SUPABASE_URL,
            hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        });
    }
});

app.get("/api/trips/:id/seats", async (req, res) => {
    try {
        const { data: reservations, error } = await supabase
            .from('reservations')
            .select('seat_number')
            .eq('trip_id', parseInt(req.params.id))
            .eq('payment_status', 'paid');

        if (error) throw error;
        res.json((reservations || []).map((r: any) => r.seat_number));
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
            const { data: existing, error: checkError } = await supabase
                .from('reservations')
                .select('id')
                .eq('trip_id', tripId)
                .eq('seat_number', seat)
                .eq('payment_status', 'paid')
                .maybeSingle();

            if (checkError) throw checkError;
            if (existing) throw new Error(`Seat ${seat} is already booked`);

            const { error: insertError } = await supabase
                .from('reservations')
                .insert([{ user_id: userId, trip_id: tripId, seat_number: seat, payment_status: 'paid' }]);

            if (insertError) throw insertError;
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
        const { data: reservations, error } = await supabase
            .from('reservations')
            .select(`
        *,
        trips (
          origin,
          destination,
          departure_date,
          price
        )
      `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const flattened = (reservations || []).map((r: any) => ({
            ...r,
            origin: r.trips.origin,
            destination: r.trips.destination,
            departure_date: r.trips.departure_date,
            price: r.trips.price
        }));

        res.json(flattened);
    } catch (err) {
        console.error("Fetch reservations error:", err);
        res.status(500).json({ error: "Failed to load reservations" });
    }
});

export default app;
