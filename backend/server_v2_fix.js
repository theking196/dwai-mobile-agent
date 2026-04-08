// DWAI Backend v2 FIX
// Adds: Task Feedback Handling + Logging Endpoint

const express = require("express");
const fs = require("fs");
const app = express();

app.use(express.json());

// Receive feedback from phone agent
app.post("/feedback", (req, res) => {
  const data = req.body;

  if (!data || !data.id) {
    return res.status(400).json({ error: "Invalid feedback" });
  }

  const path = `data/logs/${data.id}.json`;

  fs.writeFileSync(path, JSON.stringify(data, null, 2));

  console.log("[FEEDBACK RECEIVED]", data.id);

  res.json({ status: "saved" });
});

// Basic health check
app.get("/status", (req, res) => {
  res.json({ status: "running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on " + PORT));
