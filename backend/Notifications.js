import React, { useEffect, useState } from "react";
import axios from "axios";

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await axios.get("http://localhost:5000/api/notifications");
      setNotifications(res.data);
    } catch (err) {
      console.error("Notification fetch error:", err);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>🔔 Notifications</h2>

      {notifications.length === 0 && <p>No notifications yet.</p>}

      {notifications.map((n) => (
        <div
          key={n.id}
          style={{
            background: "#fee2e2",
            padding: "12px",
            marginBottom: "10px",
            borderRadius: "8px",
            borderLeft: "5px solid #dc2626"
          }}
        >
          <b>{n.factoryId}</b> — {n.message}
          <br />
          <small>{new Date(n.time).toLocaleString()}</small>
        </div>
      ))}
    </div>
  );
}
