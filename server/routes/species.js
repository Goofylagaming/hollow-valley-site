const express = require("express");
const fs = require("node:fs");
const path = require("node:path");

const router = express.Router();
const speciesPath = path.join(__dirname, "..", "data", "species.json");
const species = JSON.parse(fs.readFileSync(speciesPath, "utf8"));

router.get("/", (req, res) => {
  const { category } = req.query;
  if (category && category !== "all") {
    return res.json(species.filter((entry) => entry.category === category));
  }
  res.json(species);
});

module.exports = router;
