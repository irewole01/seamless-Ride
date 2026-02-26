import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bus,
  MapPin,
  Calendar,
  User,
  LogOut,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Armchair,
  CreditCard,
  History,
  Menu,
  X
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Trip {
  id: number;
  origin: string;
  destination: string;
  departure_date: string;
  price: number;
}

interface UserData {
  id: number;
  fullName: string;
  matricNumber: string;
}

interface Reservation {
  id: number;
  trip_id: number;
  seat_number: number;
  origin: string;
  destination: string;
  departure_date: string;
  price: number;
}

// --- Components ---

const Logo = () => (
  <div className="flex items-center gap-3">
    <img
      src="/favicon.png"
      alt="Seamless Ride Logo"
      className="h-14 w-auto object-contain drop-shadow-sm filter contrast-125 saturate-110"
    />
  </div>
);

const Spinner = ({ size = 20, color = "white" }: { size?: number, color?: string }) => (
  <motion.div
    animate={{ rotate: 360 }}
    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
    style={{ width: size, height: size, borderColor: color, borderTopColor: 'transparent' }}
    className="border-2 rounded-full"
  />
);

export default function App() {
  const [user, setUser] = useState<UserData | null>(null);
  const [view, setView] = useState<'home' | 'login' | 'register' | 'booking' | 'confirm' | 'history'>('home');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Booking State
  const [bookingData, setBookingData] = useState({
    origin: '',
    destination: '',
    date: new Date().toISOString().split('T')[0],
  });
  const [availableTrips, setAvailableTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<number[]>([]);
  const [occupiedSeats, setOccupiedSeats] = useState<number[]>([]);
  const [myReservations, setMyReservations] = useState<Reservation[]>([]);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/me');
      const data = await res.json();
      if (data.user) setUser(data.user);
    } catch (err) {
      console.error("Failed to fetch user", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
    setView('home');
  };

  const searchTrips = async () => {
    if (!bookingData.origin || !bookingData.destination) {
      setError("Please select both origin and destination");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/trips?origin=${bookingData.origin}&destination=${bookingData.destination}&date=${bookingData.date}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Server responded with ${res.status}`);
      }

      setAvailableTrips(data);
      if (data.length === 0) {
        setError("No trips found for the selected route and date.");
      } else {
        setError(null);
      }
    } catch (err: any) {
      console.error("Search error:", err);
      // Try to show detailed debug info if the server provided it
      let message = err.message || "Unknown error";
      if (err.debug) message += ` (${err.debug})`;
      if (err.hasUrl === false) message += " [URL Missing]";
      if (err.hasKey === false) message += " [Key Missing]";

      setError(`Search failed: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  const selectTrip = async (trip: Trip) => {
    setSelectedTrip(trip);
    setLoading(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}/seats`);
      const data = await res.json();
      setOccupiedSeats(data);
      setView('booking');
    } catch (err) {
      setError("Failed to fetch seats");
    } finally {
      setLoading(false);
    }
  };

  const handleSeatToggle = (seat: number) => {
    if (occupiedSeats.includes(seat)) return;
    if (selectedSeats.includes(seat)) {
      setSelectedSeats(selectedSeats.filter(s => s !== seat));
    } else {
      if (selectedSeats.length >= 2) {
        setError("You can only select a maximum of 2 seats.");
        setTimeout(() => setError(null), 3000);
        return;
      }
      setSelectedSeats([...selectedSeats, seat]);
    }
  };

  const handlePayment = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tripId: selectedTrip?.id, seats: selectedSeats })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess("Reservation successful! Your seats are confirmed.");
        setSelectedSeats([]);
        setSelectedTrip(null);
        setView('history');
        fetchReservations();
      } else {
        setError(data.error || "Payment failed");
      }
    } catch (err) {
      setError("Payment processing error");
    } finally {
      setLoading(false);
    }
  };

  const fetchReservations = async () => {
    try {
      const res = await fetch('/api/my-reservations');
      const data = await res.json();
      setMyReservations(data);
    } catch (err) {
      console.error("Failed to fetch reservations");
    }
  };

  if (loading && view === 'home') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen pb-20">
      <div className="brick-wall" />

      {/* Global Loading Overlay */}
      <AnimatePresence>
        {loading && view !== 'home' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white/40 backdrop-blur-[2px] flex items-center justify-center"
          >
            <div className="bg-white p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4 border border-slate-100">
              <Spinner size={40} color="#10b981" />
              <p className="text-sm font-bold text-slate-600 animate-pulse">Processing...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/70 backdrop-blur-lg border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="cursor-pointer" onClick={() => setView('home')}>
              <Logo />
            </div>
            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => { fetchReservations(); setView('history'); }}
                    className="text-slate-600 hover:text-emerald-600 font-medium text-sm flex items-center gap-1"
                  >
                    <History size={18} />
                    <span className="hidden sm:inline">My Trips</span>
                  </button>
                  <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full">
                    <User size={16} className="text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">{user.fullName.split(' ')[0]}</span>
                  </div>
                  <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors">
                    <LogOut size={20} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => setView('login')} className="text-slate-600 font-medium px-4 py-2 hover:bg-slate-100 rounded-lg transition-colors">Login</button>
                  <button onClick={() => setView('register')} className="bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-colors">Register</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 pt-8">
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3 shadow-sm"
            >
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={16} /></button>
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6 p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl flex items-center gap-3 shadow-sm"
            >
              <CheckCircle2 size={20} />
              <p className="text-sm font-medium">{success}</p>
              <button onClick={() => setSuccess(null)} className="ml-auto text-emerald-400 hover:text-emerald-600"><X size={16} /></button>
            </motion.div>
          )}

          {view === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-8"
            >
              <div className="text-center space-y-4">
                <h2 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
                  Your <span className="text-emerald-500">Seamless</span> Journey Starts Here
                </h2>
                <p className="text-lg text-slate-600 max-w-2xl mx-auto">
                  Safe, direct, and comfortable transportation for KWASU students. No more random stops or multiple bus changes.
                </p>
              </div>

              <div className="glass-card p-6 sm:p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin size={14} className="text-emerald-500" /> From
                    </label>
                    <select
                      value={bookingData.origin}
                      onChange={(e) => setBookingData({ ...bookingData, origin: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    >
                      <option value="">Select Origin</option>
                      <option value="Malete Campus">Malete Campus</option>
                      <option value="Lagos">Lagos</option>
                      <option value="Abuja">Abuja</option>
                      <option value="Ibadan">Ibadan</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin size={14} className="text-emerald-500" /> To
                    </label>
                    <select
                      value={bookingData.destination}
                      onChange={(e) => setBookingData({ ...bookingData, destination: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    >
                      <option value="">Select Destination</option>
                      <option value="Malete Campus">Malete Campus</option>
                      <option value="Lagos">Lagos</option>
                      <option value="Abuja">Abuja</option>
                      <option value="Ibadan">Ibadan</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar size={14} className="text-emerald-500" /> Date
                    </label>
                    <input
                      type="date"
                      value={bookingData.date}
                      onChange={(e) => setBookingData({ ...bookingData, date: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                  </div>
                </div>
                <button
                  onClick={searchTrips}
                  disabled={loading}
                  className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? (
                    <Spinner />
                  ) : (
                    <>
                      Search Available Buses
                      <ChevronRight size={20} />
                    </>
                  )}
                </button>
              </div>

              {availableTrips.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-xl font-bold text-slate-800">Available Buses</h3>
                  <div className="grid gap-4">
                    {availableTrips.map(trip => (
                      <motion.div
                        key={trip.id}
                        whileHover={{ y: -4 }}
                        className="glass-card p-5 flex flex-col sm:flex-row justify-between items-center gap-4 cursor-pointer hover:border-emerald-200 transition-all"
                        onClick={() => {
                          selectTrip(trip);
                        }}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">
                            <Bus size={24} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800">{trip.origin}</span>
                              <ChevronRight size={14} className="text-slate-400" />
                              <span className="font-bold text-slate-800">{trip.destination}</span>
                            </div>
                            <p className="text-sm text-slate-500">{trip.departure_date} • 18-Seater Executive</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                          <p className="text-2xl font-black text-emerald-600">₦{trip.price.toLocaleString()}</p>
                          <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-wider">View Seats</span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'login' && (
            <AuthForm
              type="login"
              onSuccess={(userData) => {
                setUser(userData);
                if (selectedTrip) setView('booking');
                else setView('home');
              }}
              onSwitch={() => setView('register')}
            />
          )}

          {view === 'register' && (
            <AuthForm
              type="register"
              onSuccess={() => setView('login')}
              onSwitch={() => setView('login')}
            />
          )}

          {view === 'booking' && selectedTrip && (
            <motion.div
              key="booking"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button onClick={() => setView('home')} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <ChevronRight className="rotate-180" />
                  </button>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">Select Your Seat</h2>
                    <p className="text-sm text-slate-500">
                      {selectedTrip.origin} to {selectedTrip.destination} • {18 - occupiedSeats.length} seats available
                    </p>
                  </div>
                </div>
                {!user && (
                  <button onClick={() => setView('login')} className="text-sm font-bold text-emerald-600 bg-emerald-50 px-4 py-2 rounded-lg hover:bg-emerald-100 transition-colors">
                    Login to Reserve
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Bus Diagram */}
                <div className="glass-card p-8 flex flex-col items-center relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/20" />

                  <div className="w-full max-w-[300px] bg-slate-50 rounded-[50px] p-8 border-x-8 border-t-8 border-b-[16px] border-slate-200 shadow-2xl relative">
                    {/* Windshield & Dashboard */}
                    <div className="w-full h-16 bg-slate-800 rounded-t-[40px] mb-10 flex items-center justify-between px-6 relative">
                      <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center text-slate-400 border-2 border-slate-600">
                        <User size={20} />
                      </div>
                      <div className="w-12 h-2 bg-slate-600 rounded-full" />
                      {/* Steering Wheel */}
                      <div className="absolute left-6 -bottom-2 w-8 h-8 border-4 border-slate-600 rounded-full" />
                    </div>

                    {/* Seats Grid - Toyota Hiace 18 Seater Layout */}
                    <div className="grid grid-cols-4 gap-y-6 gap-x-4">
                      {/* Row 1: Front (2 seats + Driver) */}
                      <div className="col-span-2" /> {/* Driver space */}
                      <Seat num={1} selected={selectedSeats.includes(1)} occupied={occupiedSeats.includes(1)} onClick={() => handleSeatToggle(1)} />
                      <Seat num={2} selected={selectedSeats.includes(2)} occupied={occupiedSeats.includes(2)} onClick={() => handleSeatToggle(2)} />

                      {/* Row 2: 3 seats (2 + Aisle + 1) */}
                      <Seat num={3} selected={selectedSeats.includes(3)} occupied={occupiedSeats.includes(3)} onClick={() => handleSeatToggle(3)} />
                      <Seat num={4} selected={selectedSeats.includes(4)} occupied={occupiedSeats.includes(4)} onClick={() => handleSeatToggle(4)} />
                      <div className="col-span-1" /> {/* Aisle */}
                      <Seat num={5} selected={selectedSeats.includes(5)} occupied={occupiedSeats.includes(5)} onClick={() => handleSeatToggle(5)} />

                      {/* Row 3: 3 seats */}
                      <Seat num={6} selected={selectedSeats.includes(6)} occupied={occupiedSeats.includes(6)} onClick={() => handleSeatToggle(6)} />
                      <Seat num={7} selected={selectedSeats.includes(7)} occupied={occupiedSeats.includes(7)} onClick={() => handleSeatToggle(7)} />
                      <div className="col-span-1" /> {/* Aisle */}
                      <Seat num={8} selected={selectedSeats.includes(8)} occupied={occupiedSeats.includes(8)} onClick={() => handleSeatToggle(8)} />

                      {/* Row 4: 3 seats */}
                      <Seat num={9} selected={selectedSeats.includes(9)} occupied={occupiedSeats.includes(9)} onClick={() => handleSeatToggle(9)} />
                      <Seat num={10} selected={selectedSeats.includes(10)} occupied={occupiedSeats.includes(10)} onClick={() => handleSeatToggle(10)} />
                      <div className="col-span-1" /> {/* Aisle */}
                      <Seat num={11} selected={selectedSeats.includes(11)} occupied={occupiedSeats.includes(11)} onClick={() => handleSeatToggle(11)} />

                      {/* Row 5: 3 seats */}
                      <Seat num={12} selected={selectedSeats.includes(12)} occupied={occupiedSeats.includes(12)} onClick={() => handleSeatToggle(12)} />
                      <Seat num={13} selected={selectedSeats.includes(13)} occupied={occupiedSeats.includes(13)} onClick={() => handleSeatToggle(13)} />
                      <div className="col-span-1" /> {/* Aisle */}
                      <Seat num={14} selected={selectedSeats.includes(14)} occupied={occupiedSeats.includes(14)} onClick={() => handleSeatToggle(14)} />

                      {/* Row 6: 4 seats (Back row) */}
                      {[15, 16, 17, 18].map(n => (
                        <Seat key={n} num={n} selected={selectedSeats.includes(n)} occupied={occupiedSeats.includes(n)} onClick={() => handleSeatToggle(n)} />
                      ))}
                    </div>

                    {/* Bus Rear */}
                    <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-20 h-2 bg-slate-300 rounded-full" />
                  </div>

                  <div className="mt-10 grid grid-cols-3 gap-6 text-xs font-bold uppercase tracking-wider">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-white border-2 border-slate-200 shadow-sm" />
                      <span className="text-slate-400">Available</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500 border-2 border-emerald-400 shadow-lg shadow-emerald-500/20" />
                      <span className="text-emerald-600">Selected</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-slate-200 border-2 border-slate-300 relative overflow-hidden">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-full h-[1px] bg-slate-300 rotate-45" />
                          <div className="w-full h-[1px] bg-slate-300 -rotate-45" />
                        </div>
                      </div>
                      <span className="text-slate-500">Occupied</span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="space-y-6">
                  <div className="glass-card p-6 space-y-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full -mr-12 -mt-12" />

                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                      <CreditCard className="text-emerald-500" /> Booking Summary
                    </h3>

                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                            <Bus size={16} className="text-emerald-500" />
                          </div>
                          <span className="text-sm font-medium text-slate-500">Trip ID</span>
                        </div>
                        <span className="font-bold text-slate-800">#{selectedTrip.id.toString().padStart(4, '0')}</span>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                            <MapPin size={16} className="text-emerald-500" />
                          </div>
                          <span className="text-sm font-medium text-slate-500">Route</span>
                        </div>
                        <span className="font-bold text-slate-800">{selectedTrip.origin} → {selectedTrip.destination}</span>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                            <Calendar size={16} className="text-emerald-500" />
                          </div>
                          <span className="text-sm font-medium text-slate-500">Departure</span>
                        </div>
                        <span className="font-bold text-slate-800">{selectedTrip.departure_date}</span>
                      </div>

                      <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm">
                            <Armchair size={16} className="text-emerald-500" />
                          </div>
                          <span className="text-sm font-medium text-slate-500">Seats</span>
                        </div>
                        <span className="font-bold text-slate-800">
                          {selectedSeats.length > 0 ? selectedSeats.sort((a, b) => a - b).join(', ') : 'None Selected'}
                        </span>
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Payable</p>
                          <p className="text-3xl font-black text-emerald-600">₦{(selectedTrip.price * selectedSeats.length).toLocaleString()}</p>
                        </div>
                        {selectedSeats.length > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Seats</p>
                            <p className="text-lg font-bold text-slate-800">x{selectedSeats.length}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {user ? (
                    <button
                      disabled={selectedSeats.length === 0}
                      onClick={() => setView('confirm')}
                      className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                      <span className="flex items-center justify-center gap-2">
                        Confirm Reservation
                        <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => setView('login')}
                      className="w-full bg-slate-800 text-white font-bold py-4 rounded-xl shadow-xl hover:bg-slate-900 transition-all"
                    >
                      Login to Complete Booking
                    </button>
                  )}

                  <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">
                    First-come, First-served basis
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'confirm' && selectedTrip && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-md mx-auto space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-slate-800">Review & Pay</h2>
                <p className="text-slate-500">Please confirm your details before making payment.</p>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="bg-emerald-500 p-6 text-white text-center">
                  <p className="text-sm font-medium opacity-80 uppercase tracking-widest">Amount to Pay</p>
                  <p className="text-4xl font-black">₦{(selectedTrip.price * selectedSeats.length).toLocaleString()}</p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                          <Bus size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase">Trip ID</p>
                          <p className="font-semibold text-slate-800">#{selectedTrip.id.toString().padStart(4, '0')}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                          <MapPin size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase">Route</p>
                          <p className="font-semibold text-slate-800">{selectedTrip.origin} → {selectedTrip.destination}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                          <User size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase">Passenger</p>
                          <p className="font-semibold text-slate-800">{user?.fullName}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                          <Bus size={16} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-400 uppercase">Seats</p>
                          <p className="font-semibold text-slate-800">{selectedSeats.join(', ')}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={handlePayment}
                      className="w-full btn-primary flex items-center justify-center gap-2"
                    >
                      <CreditCard size={20} />
                      Pay Now
                    </button>
                    <button
                      onClick={() => setView('booking')}
                      className="w-full py-3 text-slate-500 font-semibold hover:text-slate-800 transition-colors"
                    >
                      Go Back
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-800">My Reservations</h2>
                <button onClick={() => setView('home')} className="text-emerald-600 font-bold text-sm hover:underline">Book New Trip</button>
              </div>

              {myReservations.length === 0 ? (
                <div className="glass-card p-12 text-center space-y-4">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                    <Bus size={32} />
                  </div>
                  <p className="text-slate-500 font-medium">You haven't made any reservations yet.</p>
                  <button onClick={() => setView('home')} className="btn-primary">Start Booking</button>
                </div>
              ) : (
                <div className="grid gap-4">
                  {myReservations.map(res => {
                    const isUpcoming = new Date(res.departure_date) >= new Date(new Date().setHours(0, 0, 0, 0));
                    return (
                      <div key={res.id} className="glass-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-xl flex items-center justify-center shadow-sm",
                            isUpcoming ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"
                          )}>
                            <Bus size={24} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-800">{res.origin} → {res.destination}</p>
                              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">#{res.trip_id.toString().padStart(4, '0')}</span>
                            </div>
                            <p className="text-sm text-slate-500">{res.departure_date} • Seat {res.seat_number}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="text-sm font-bold text-slate-800">₦{res.price.toLocaleString()}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid</p>
                          </div>
                          <span className={cn(
                            "px-3 py-1 text-[10px] font-black rounded-full uppercase tracking-widest border",
                            isUpcoming
                              ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                              : "bg-slate-50 text-slate-400 border-slate-100"
                          )}>
                            {isUpcoming ? 'Upcoming' : 'Completed'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-0 w-full py-6 text-center text-slate-400 text-xs font-medium">
        <p>© 2026 SEAMLESS RIDE. A daughter company of iRexihub by Irewole.</p>
      </footer>
    </div>
  );
}

// --- Sub-components ---

interface SeatProps {
  num: number;
  selected: boolean;
  occupied: boolean;
  onClick: () => void;
}

const Seat: React.FC<SeatProps> = ({ num, selected, occupied, onClick }) => {
  return (
    <motion.button
      whileHover={!occupied ? { scale: 1.05, y: -2 } : {}}
      whileTap={!occupied ? { scale: 0.95 } : {}}
      disabled={occupied}
      onClick={onClick}
      className={cn(
        "w-12 h-12 rounded-xl flex items-center justify-center transition-all relative group",
        occupied
          ? "bg-slate-200 text-slate-400 cursor-not-allowed border-2 border-slate-300 shadow-inner"
          : selected
            ? "bg-emerald-500 text-white shadow-xl shadow-emerald-500/30 border-2 border-emerald-400 z-10"
            : "bg-white text-slate-600 hover:text-emerald-600 border-2 border-slate-200 hover:border-emerald-300 shadow-sm"
      )}
    >
      <div className="flex flex-col items-center gap-0.5">
        <Armchair size={18} className={cn(
          "transition-transform",
          selected && "scale-110",
          occupied && "opacity-50"
        )} />
        <span className={cn(
          "text-[10px] font-black",
          selected ? "text-emerald-100" : occupied ? "text-slate-400" : "text-slate-400 group-hover:text-emerald-500"
        )}>
          {num}
        </span>
      </div>

      {!occupied && !selected && (
        <div className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
      )}

      {occupied && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-full h-[2px] bg-slate-300 rotate-45 absolute" />
          <div className="w-full h-[2px] bg-slate-300 -rotate-45 absolute" />
        </div>
      )}

      {selected && (
        <motion.div
          layoutId="selected-glow"
          className="absolute -inset-1 bg-emerald-500/20 rounded-2xl blur-md -z-10"
        />
      )}
    </motion.button>
  );
};

function AuthForm({ type, onSuccess, onSwitch }: { type: 'login' | 'register', onSuccess: (data?: any) => void, onSwitch: () => void }) {
  const [formData, setFormData] = useState({ fullName: '', matricNumber: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = type === 'login' ? '/api/login' : '/api/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      let data;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid response: ${text.substring(0, 50)}...`);
      }

      if (data.success) {
        onSuccess(data.user);
      } else {
        setError(data.error || "Authentication failed");
      }
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message === "Failed to fetch" ? "Network error: Connection refused" : err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md mx-auto glass-card p-8 space-y-6"
    >
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">{type === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
        <p className="text-slate-500 text-sm">
          {type === 'login' ? 'Login with your matric number and password' : 'Register with your student details'}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {type === 'register' && (
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
            <input
              required
              type="text"
              placeholder="John Doe"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase">Matric Number</label>
          <input
            required
            type="text"
            placeholder="20/00/00/000"
            value={formData.matricNumber}
            onChange={(e) => setFormData({ ...formData, matricNumber: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-500 uppercase">Password</label>
          <input
            required
            type="password"
            placeholder="••••••••"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
          />
        </div>
        <button
          disabled={loading}
          type="submit"
          className="w-full btn-primary mt-2 flex items-center justify-center gap-2"
        >
          {loading ? (
            <Spinner />
          ) : (
            type === 'login' ? 'Login' : 'Create Account'
          )}
        </button>
      </form>

      <div className="text-center">
        <button onClick={onSwitch} className="text-sm font-semibold text-emerald-600 hover:underline">
          {type === 'login' ? "Don't have an account? Register" : "Already have an account? Login"}
        </button>
      </div>
    </motion.div>
  );
}
