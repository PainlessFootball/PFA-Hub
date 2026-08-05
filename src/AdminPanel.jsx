import { useState, useEffect } from "react";
import { db } from "./auth.js";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";

// Same palette as App.jsx's own `C` — duplicated here rather than imported
// since App.jsx has no exports of its own to pull from.
const C = {
  panel: "#131E31",
  panelHi: "#1A2942",
  line: "#243450",
  chalk: "#EDE8DA",
  slate: "#8494AC",
  gold: "#E8A33D",
  turf: "#57B478",
  ember: "#D4604C",
};

const ROLES = ["user", "moderator", "admin"];

export default function AdminPanel({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, "users")).then((snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, []);

  async function updateRole(uid, newRole) {
    await updateDoc(doc(db, "users", uid), { role: newRole });
    setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, role: newRole } : u)));
  }

  async function toggleApproved(uid, current) {
    await updateDoc(doc(db, "users", uid), { approved: !current });
    setUsers((prev) => prev.map((u) => (u.id === uid ? { ...u, approved: !current } : u)));
  }

  const filtered = users.filter(
    (u) =>
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h2
        className="text-xl uppercase mb-4"
        style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: "0.06em", color: C.chalk }}
      >
        User Management
      </h2>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or name…"
        className="w-full mb-4 px-3 py-2 text-sm rounded"
        style={{ background: C.panelHi, border: `1px solid ${C.line}`, color: C.chalk }}
      />

      {loading ? (
        <div className="text-sm" style={{ color: C.slate }}>
          Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 px-4 py-3 rounded"
              style={{ background: C.panel, border: `1px solid ${C.line}` }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold" style={{ color: C.chalk }}>
                  {u.displayName || u.email}
                </div>
                <div className="text-xs" style={{ color: C.slate }}>
                  {u.email}
                </div>
              </div>

              <select
                value={u.role}
                onChange={(e) => updateRole(u.id, e.target.value)}
                disabled={u.id === currentUser.uid}
                className="px-2 py-1 text-xs rounded"
                style={{ background: C.panelHi, border: `1px solid ${C.line}`, color: C.gold }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <button
                onClick={() => toggleApproved(u.id, u.approved)}
                disabled={u.id === currentUser.uid}
                className="px-2.5 py-1 text-xs font-bold uppercase rounded"
                style={{
                  border: "none",
                  cursor: u.id === currentUser.uid ? "default" : "pointer",
                  background: u.approved ? "rgba(212,96,76,0.15)" : "rgba(87,180,120,0.15)",
                  color: u.approved ? C.ember : C.turf,
                }}
              >
                {u.approved ? "Ban" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
